// ============================================================================
// ECS iON (Elite Consultancy Services iON) - Core Application Engine
// Supports 25 Official Exam Formats (80–200 Qs per sitting), Variable Marking
// with 1/4th Negative, Graduate vs Under-Graduate Difficulty, & MAT 200–800 Scale
// ============================================================================

(function () {
  "use strict";

  // Safe localStorage wrapper (Canvas & sandbox compliant)
  const Storage = {
    get(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) {
        return fallback;
      }
    },
    set(key, val) {
      try {
        window.localStorage.setItem(key, JSON.stringify(val));
      } catch (e) {
        // Ignore storage quota or sandbox errors
      }
    }
  };

  // Global Application State
  const AppState = {
    mode: "terminal", // 'terminal' | 'instructions' | 'loading_api' | 'exam' | 'submit_confirm' | 'feedback' | 'result' | 'admin'
    instructionsPage: 1, // 1 = General TCS iON Instructions, 2 = Paper Format & Declaration
    activeExamId: Storage.get("ecs_active_exam_id", "SBI_PO"),
    sectorFilter: "ALL", // Filter across the 25 exams in Admin & Terminal
    optionalLanguageChoice: "english", // 'english' | 'hindi_lang' for RRB/IBPS Mains Section 4
    customExams: Storage.get("ecs_custom_exams", {}),
    candidates: Storage.get("ecs_candidates", window.ECS_DEFAULT_CANDIDATES),
    attempts: Storage.get("ecs_attempts", [
      {
        attemptId: "ATT-1001",
        rollNo: "2409100482",
        candidateName: "Priya Nair",
        examId: "SBI_PO",
        examTitle: "SBI PO (Preliminary) Examination",
        timestamp: "2026-10-20 18:40",
        score: 68.50,
        maxScore: 100.0,
        accuracy: 86.2,
        answeredCount: 78,
        correctCount: 71,
        wrongCount: 10,
        unansweredCount: 19,
        timeTakenSeconds: 3410,
        feedbackRating: 4.8,
        feedbackComment: "Smooth ECS iON interface, all 100 questions loaded in one batch with zero lag."
      }
    ]),

    // Login & Waiting Lobby State
    selectedCandidateRoll: "2409100481",
    loginRollInput: "2409100481",
    loginPasswordInput: "1999-08-15",
    waitingSecondsLeft: 10,
    waitingTimerInterval: null,
    virtualKeyboardOpen: false,
    activeKeyboardField: "loginRollInput",

    // Pre-exam Declaration State
    defaultLanguage: "en", // 'en' | 'hi' | 'bilingual'
    declarationChecked: false,

    // API Batch Loader State
    apiSourceMode: Storage.get("ecs_api_source_mode", "hybrid"), // 'hybrid' | 'live_opentdb' | 'curated'
    apiLoadLogs: [],
    apiBatchProgress: 0,
    lastApiLatencyMs: 0,

    // Active Exam Session State
    session: null,
    examTimerInterval: null,

    // UI Controls inside Exam Console
    sidebarCollapsed: false,
    mobilePaletteOpen: false,
    activeModal: null, // null | 'question_paper' | 'instructions' | 'profile' | 'calculator' | 'section_submit'
    paletteFilter: "all", // 'all' | 'answered' | 'not_answered' | 'review'
    fontSizeScale: 100, // 90, 100, 115, 130
    darkMode: false,

    // On-Screen Calculator State
    calcExpression: "",
    calcDisplay: "0",
    calcMemory: 0,
    calcDegMode: "DEG",

    // Post-Exam Feedback State
    feedbackRatings: {
      hardware: 5,
      questions: 5,
      interface: 5,
      instructions: 5
    },
    feedbackExperience: "Excellent",
    feedbackComments: "",

    // Admin Portal Tab State
    adminTab: "presets" // 'presets' | 'builder' | 'api_lab' | 'candidates' | 'analytics'
  };

  // Helper to get all available exams (25 built-in presets + admin custom exams)
  function getAllExams() {
    return Object.assign({}, window.ECS_EXAM_PRESETS, AppState.customExams);
  }

  function getActiveExam() {
    const all = getAllExams();
    return all[AppState.activeExamId] || all["SBI_PO"];
  }

  function getExamTotalQuestions(exam) {
    return exam.sections.reduce((acc, s) => acc + (parseInt(s.questionCount, 10) || 0), 0);
  }

  function getExamTotalMaxMarks(exam) {
    if (exam.totalMaxMarks) return exam.totalMaxMarks;
    return exam.sections.reduce(
      (acc, s) => acc + (s.maxMarks ? Number(s.maxMarks) : (Number(s.questionCount) || 0) * (Number(s.positiveMarks || exam.positiveMarks) || 1)),
      0
    );
  }

  function getCurrentCandidate() {
    return (
      AppState.candidates.find((c) => c.rollNo === AppState.loginRollInput.trim()) ||
      AppState.candidates[0]
    );
  }

  // Toast Notification Helper (Replaces native alert)
  function showToast(message, type = "info") {
    const container = document.getElementById("ecs-toast-container");
    if (!container) return;
    const colors = {
      info: "bg-slate-900 border-sky-500 text-white",
      success: "bg-emerald-900 border-emerald-400 text-white",
      warning: "bg-amber-900 border-amber-400 text-white",
      error: "bg-rose-900 border-rose-400 text-white"
    };
    const toast = document.createElement("div");
    toast.className = `flex items-center gap-3 px-4 py-3 rounded-lg shadow-xl border-l-4 text-xs sm:text-sm font-medium transition-all duration-300 ${colors[type] || colors.info}`;
    toast.innerHTML = `
      <span class="flex-1">${message}</span>
      <button type="button" class="text-slate-300 hover:text-white font-bold px-1" onclick="this.parentElement.remove()">✕</button>
    `;
    container.appendChild(toast);
    setTimeout(() => {
      if (toast.parentElement) toast.remove();
    }, 4200);
  }

  // HTML Entity Decoder for OpenTDB API strings
  function decodeHtmlEntities(str) {
    if (!str) return "";
    const txt = document.createElement("textarea");
    txt.innerHTML = str;
    return txt.value;
  }

  // Normalize options array to exact required count (4 or 5 options) while preserving correctIndex
  function normalizeQuestionOptions(rawQ, targetOptionsCount, indexNumber) {
    let optionsEn = Array.isArray(rawQ.optionsEn) ? [...rawQ.optionsEn] : [];
    let optionsHi = Array.isArray(rawQ.optionsHi) ? [...rawQ.optionsHi] : [...optionsEn];
    let correctIdx = typeof rawQ.correctIndex === "number" ? rawQ.correctIndex : 0;

    if (targetOptionsCount === 5) {
      while (optionsEn.length < 5) {
        const fallbackE =
          optionsEn.length === 4
            ? "None of these / Cannot be determined"
            : `Option ${optionsEn.length + 1}`;
        const fallbackEHi =
          optionsHi.length === 4
            ? "इनमें से कोई नहीं / निर्धारित नहीं किया जा सकता"
            : `विकल्प ${optionsHi.length + 1}`;
        optionsEn.push(fallbackE);
        optionsHi.push(fallbackEHi);
      }
      if (optionsEn.length > 5) {
        optionsEn = optionsEn.slice(0, 5);
        optionsHi = optionsHi.slice(0, 5);
        if (correctIdx >= 5) correctIdx = 0;
      }
    } else {
      if (optionsEn.length > 4) {
        const correctOptEn = optionsEn[correctIdx];
        const correctOptHi = optionsHi[correctIdx] || correctOptEn;
        if (correctIdx >= 4) {
          optionsEn[3] = correctOptEn;
          optionsHi[3] = correctOptHi;
          correctIdx = 3;
        }
        optionsEn = optionsEn.slice(0, 4);
        optionsHi = optionsHi.slice(0, 4);
      }
      while (optionsEn.length < 4) {
        optionsEn.push("None of the above");
        optionsHi.push("उपर्युक्त में से कोई नहीं");
      }
    }

    // Deterministically rotate correct option position based on indexNumber so correct answers are distributed across A, B, C, D, (E)
    const modPos = indexNumber % targetOptionsCount;
    if (modPos !== correctIdx && modPos < optionsEn.length) {
      const tmpEn = optionsEn[modPos];
      const tmpHi = optionsHi[modPos];
      optionsEn[modPos] = optionsEn[correctIdx];
      optionsHi[modPos] = optionsHi[correctIdx];
      optionsEn[correctIdx] = tmpEn;
      optionsHi[correctIdx] = tmpHi;
      correctIdx = modPos;
    }

    return {
      id: rawQ.id || `Q-${indexNumber}`,
      topic: rawQ.topic || "General Assessment",
      source: rawQ.source || "ECS iON Question API",
      passageEn: rawQ.passageEn || null,
      passageHi: rawQ.passageHi || null,
      questionEn: rawQ.questionEn,
      questionHi: rawQ.questionHi || rawQ.questionEn,
      optionsEn,
      optionsHi,
      correctIndex: correctIdx,
      isTita: Boolean(rawQ.isTita),
      titaAnswer: rawQ.titaAnswer || null,
      explanation: rawQ.explanation || "Verified per official ECS iON evaluation key."
    };
  }

  // ============================================================================
  // All-At-Once API Batch Question Engine
  // Fetches & synthesizes all 80 to 200 questions across all exam sections in
  // one single upfront batch before Question 1 renders!
  // ============================================================================
  async function loadAllExamQuestionsBatch(examConfig, onProgress) {
    const startTime = performance.now();
    AppState.apiLoadLogs = [];
    const logStep = (msg, progress) => {
      AppState.apiLoadLogs.push({ time: new Date().toLocaleTimeString(), msg });
      AppState.apiBatchProgress = progress;
      if (typeof onProgress === "function") onProgress(msg, progress);
    };

    const totalExpectedQs = getExamTotalQuestions(examConfig);
    logStep(
      `Initializing ECS iON Batch Synchronizer for ${examConfig.code} (${totalExpectedQs} Questions • ${examConfig.optionsCount}-Option Format • ${examConfig.difficultyLabel || "Standard"})...`,
      10
    );

    const openTdbCategoryMap = {
      numerical: 19,   // Mathematics
      science: 17,     // Science & Nature
      engineering: 17, // Science & Engineering
      computer: 18,    // Computers
      reasoning: 18,   // Logic & CS
      awareness: 9,    // General Knowledge
      banking: 9,      // General / Economy
      english: 10      // Books / Verbal
    };

    const liveApiCache = {};

    if (AppState.apiSourceMode === "hybrid" || AppState.apiSourceMode === "live_opentdb") {
      const uniqueSubjects = [
        ...new Set(
          examConfig.sections.map((s) =>
            s.isOptionalLanguage ? AppState.optionalLanguageChoice : s.subject || "numerical"
          )
        )
      ];
      logStep(`Requesting parallel REST API batches for [${uniqueSubjects.join(", ").toUpperCase()}]...`, 30);

      await Promise.all(
        uniqueSubjects.map(async (subj) => {
          liveApiCache[subj] = [];
          if (subj === "hindi_lang") return; // Hindi uses dedicated Devanagari bank
          const catId = openTdbCategoryMap[subj] || 9;
          const diffParam =
            examConfig.difficulty === "undergraduate"
              ? "&difficulty=easy"
              : examConfig.difficulty === "mains"
              ? "&difficulty=hard"
              : "";
          const url = `https://opentdb.com/api.php?amount=15&category=${catId}&type=multiple${diffParam}`;
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2800);
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (res.ok) {
              const data = await res.json();
              if (data && Array.isArray(data.results) && data.results.length > 0) {
                liveApiCache[subj] = data.results.map((item, idx) => {
                  const correctText = decodeHtmlEntities(item.correct_answer);
                  const incorrects = (item.incorrect_answers || []).map(decodeHtmlEntities);
                  const allOpts = [correctText, ...incorrects];
                  return {
                    id: `API-${subj.toUpperCase()}-${idx + 1}`,
                    topic: `${decodeHtmlEntities(item.category || subj)} (${item.difficulty || examConfig.difficulty || "standard"})`,
                    source: "Live OpenTDB REST API",
                    questionEn: decodeHtmlEntities(item.question),
                    questionHi: `${decodeHtmlEntities(item.question)} [भाषांतरित प्रश्न — ${subj.toUpperCase()}]`,
                    optionsEn: allOpts,
                    optionsHi: allOpts,
                    correctIndex: 0,
                    explanation: `Official Answer: ${correctText} (Source: Live OpenTDB API Category ${catId}, Difficulty: ${item.difficulty || "calibrated"}).`
                  };
                });
                logStep(`✓ Live API returned ${liveApiCache[subj].length} items for ${subj.toUpperCase()}.`, 55);
              }
            }
          } catch (err) {
            logStep(`ℹ Using ECS iON Edge Competitive Question Synthesizer for ${subj.toUpperCase()}.`, 55);
          }
        })
      );
    } else {
      logStep(`Loading from ECS iON Verified Competitive Exam Repository (${examConfig.difficultyLabel || "Standard"})...`, 50);
    }

    // Assemble complete section-wise question arrays in one single sitting payload
    let globalQNumber = 1;
    const assembledSections = examConfig.sections.map((sec, secIdx) => {
      const effectiveSubject = sec.isOptionalLanguage
        ? AppState.optionalLanguageChoice
        : sec.subject || "numerical";
      const effectiveSectionName = sec.isOptionalLanguage
        ? AppState.optionalLanguageChoice === "hindi_lang"
          ? "Hindi Language (हिन्दी भाषा)"
          : "English Language"
        : sec.name;

      const targetCount = Math.max(1, parseInt(sec.questionCount, 10) || 25);
      const curatedPool = [
        ...(window.ECS_CURATED_QUESTION_BANK[effectiveSubject] ||
          window.ECS_CURATED_QUESTION_BANK.numerical)
      ];
      const livePool = [...(liveApiCache[effectiveSubject] || [])];
      const parametricPool = window.ECS_GENERATE_PARAMETRIC_QUESTIONS
        ? window.ECS_GENERATE_PARAMETRIC_QUESTIONS(
            effectiveSubject,
            targetCount,
            examConfig.difficulty || "graduate"
          )
        : [];

      let combinedPool = [];
      if (AppState.apiSourceMode === "live_opentdb" && livePool.length > 0) {
        combinedPool = [...livePool, ...curatedPool, ...parametricPool];
      } else if (AppState.apiSourceMode === "hybrid") {
        combinedPool = [
          ...curatedPool.map((q) => ({ ...q, source: "ECS iON Competitive API" })),
          ...livePool,
          ...parametricPool.map((q) => ({ ...q, source: "ECS iON Parametric API" }))
        ];
      } else {
        combinedPool = [
          ...curatedPool.map((q) => ({ ...q, source: "ECS iON Competitive API" })),
          ...parametricPool.map((q) => ({ ...q, source: "ECS iON Competitive API" }))
        ];
      }

      const sectionQuestions = [];
      for (let i = 0; i < targetCount; i++) {
        const templateQ = combinedPool[i % combinedPool.length];
        const normalized = normalizeQuestionOptions(templateQ, examConfig.optionsCount, globalQNumber);
        const isCatTita = examConfig.id === "CAT_IIM" && templateQ.titaEligible && i % 5 === 4;

        // Calculate exact positiveMarks & 1/4th negativeMarks if variableDistribution is specified
        let qPosMarks = Number(sec.positiveMarks ?? examConfig.positiveMarks ?? 1.0);
        let qNegMarks = Number(sec.negativeMarks ?? examConfig.negativeMarks ?? 0.25);

        if (sec.variableDistribution) {
          const vd = sec.variableDistribution;
          if (i < vd.highCount) {
            qPosMarks = vd.highMark;
          } else {
            qPosMarks = vd.lowMark;
          }
          // Constant 1/4th negative marking of the marks awarded for that question!
          qNegMarks = Number((qPosMarks * 0.25).toFixed(4));
        }

        if (isCatTita) {
          qNegMarks = 0;
        }

        sectionQuestions.push({
          ...normalized,
          globalNumber: globalQNumber++,
          sectionIndex: secIdx,
          sectionQuestionNumber: i + 1,
          isTita: isCatTita,
          positiveMarks: qPosMarks,
          negativeMarks: qNegMarks,
          status: secIdx === 0 && i === 0 ? "not-answered" : "not-visited",
          selectedOption: null,
          titaInput: "",
          timeSpentSeconds: 0,
          bookmarked: false
        });
      }

      const computedMaxMarks =
        sec.maxMarks ||
        Number(sectionQuestions.reduce((acc, q) => acc + Number(q.positiveMarks), 0).toFixed(2));

      return {
        ...sec,
        name: effectiveSectionName,
        subject: effectiveSubject,
        maxMarks: computedMaxMarks,
        remainingSeconds: (parseInt(sec.durationMinutes, 10) || 20) * 60,
        completed: false,
        questions: sectionQuestions
      };
    });

    AppState.lastApiLatencyMs = Math.round(performance.now() - startTime);
    logStep(
      `✓ Batch complete: ${globalQNumber - 1} unique questions across ${assembledSections.length} sections loaded in ${AppState.lastApiLatencyMs} ms.`,
      100
    );

    return assembledSections;
  }

  // ============================================================================
  // Timer Management (Waiting Lobby Timer & Active Exam Console Timer)
  // ============================================================================
  function startWaitingLobbyTimer() {
    clearInterval(AppState.waitingTimerInterval);
    const exam = getActiveExam();
    AppState.waitingSecondsLeft = typeof exam.waitingRoomSeconds === "number" ? exam.waitingRoomSeconds : 10;

    AppState.waitingTimerInterval = setInterval(() => {
      if (AppState.mode !== "terminal") {
        clearInterval(AppState.waitingTimerInterval);
        return;
      }
      if (AppState.waitingSecondsLeft > 0) {
        AppState.waitingSecondsLeft -= 1;
        updateWaitingLobbyDOM();
      } else {
        clearInterval(AppState.waitingTimerInterval);
        updateWaitingLobbyDOM();
      }
    }, 1000);
  }

  function updateWaitingLobbyDOM() {
    const badgeEl = document.getElementById("ecs-waiting-countdown-text");
    const barEl = document.getElementById("ecs-waiting-progress-bar");
    const loginBtn = document.getElementById("ecs-terminal-signin-btn");
    const statusBox = document.getElementById("ecs-gate-status-banner");
    const exam = getActiveExam();
    const totalWait = Math.max(1, exam.waitingRoomSeconds || 10);

    if (badgeEl) {
      const mins = String(Math.floor(AppState.waitingSecondsLeft / 60)).padStart(2, "0");
      const secs = String(AppState.waitingSecondsLeft % 60).padStart(2, "0");
      badgeEl.textContent = `${mins}:${secs}`;
    }
    if (barEl) {
      const pct = Math.min(100, Math.round(((totalWait - AppState.waitingSecondsLeft) / totalWait) * 100));
      barEl.style.width = `${pct}%`;
    }
    if (loginBtn) {
      if (AppState.waitingSecondsLeft <= 0) {
        loginBtn.disabled = false;
        loginBtn.className =
          "w-full py-3 px-5 rounded-lg font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-md transition flex items-center justify-center gap-2 cursor-pointer";
        loginBtn.innerHTML = `<span>Sign In to Assessment Console</span> <span>→</span>`;
      } else {
        loginBtn.disabled = true;
        loginBtn.className =
          "w-full py-3 px-5 rounded-lg font-bold text-slate-400 bg-slate-200 border border-slate-300 flex items-center justify-center gap-2 cursor-not-allowed";
        loginBtn.innerHTML = `<span>🔒 Gate Locked — Wait ${AppState.waitingSecondsLeft}s</span>`;
      }
    }
    if (statusBox && AppState.waitingSecondsLeft <= 0) {
      statusBox.className = "rounded-lg p-3 bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs flex items-center justify-between gap-2";
      statusBox.innerHTML = `
        <div class="flex items-center gap-2">
          <span class="inline-block w-2.5 h-2.5 rounded-full bg-emerald-600 animate-ping"></span>
          <span class="font-semibold">Invigilator Broadcast Received: Login Gate is now OPEN.</span>
        </div>
        <span class="font-mono font-bold text-emerald-700">READY</span>
      `;
    }
  }

  function startExamSessionTimer() {
    clearInterval(AppState.examTimerInterval);
    AppState.examTimerInterval = setInterval(() => {
      if (AppState.mode !== "exam" || !AppState.session) {
        clearInterval(AppState.examTimerInterval);
        return;
      }

      const s = AppState.session;
      const activeSec = s.sections[s.activeSectionIndex];
      const activeQ = activeSec.questions[s.activeQuestionIndex];

      if (activeQ) activeQ.timeSpentSeconds += 1;
      s.totalElapsedSeconds += 1;

      if (s.examConfig.sectionalTiming) {
        if (activeSec.remainingSeconds > 0) {
          activeSec.remainingSeconds -= 1;
        }
        s.totalRemainingSeconds = s.sections.reduce((acc, sec) => acc + sec.remainingSeconds, 0);

        if (activeSec.remainingSeconds <= 0) {
          activeSec.completed = true;
          if (s.activeSectionIndex < s.sections.length - 1) {
            s.activeSectionIndex += 1;
            s.activeQuestionIndex = 0;
            const nextSec = s.sections[s.activeSectionIndex];
            if (nextSec.questions[0] && nextSec.questions[0].status === "not-visited") {
              nextSec.questions[0].status = "not-answered";
            }
            showToast(`Section time expired! Automatically switched to section: ${nextSec.name}`, "warning");
            renderApp();
            return;
          } else {
            clearInterval(AppState.examTimerInterval);
            showToast("Exam time limit reached! Submitting your responses automatically.", "warning");
            finalizeExamSubmission();
            return;
          }
        }
      } else {
        if (s.totalRemainingSeconds > 0) {
          s.totalRemainingSeconds -= 1;
        } else {
          clearInterval(AppState.examTimerInterval);
          showToast("Total exam time expired! Auto-submitting your test.", "warning");
          finalizeExamSubmission();
          return;
        }
      }

      updateLiveExamClockDOM();
    }, 1000);
  }

  function formatSecondsMMSS(totalSecs) {
    const secs = Math.max(0, Math.floor(totalSecs));
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) {
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function updateLiveExamClockDOM() {
    if (!AppState.session) return;
    const s = AppState.session;
    const activeSec = s.sections[s.activeSectionIndex];
    const activeQ = activeSec.questions[s.activeQuestionIndex];

    const displaySecs = s.examConfig.sectionalTiming ? activeSec.remainingSeconds : s.totalRemainingSeconds;
    const clockEl = document.getElementById("ecs-live-timer-display");
    if (clockEl) {
      clockEl.textContent = formatSecondsMMSS(displaySecs);
      if (displaySecs <= 180) {
        clockEl.className = "font-mono font-extrabold text-sm sm:text-base px-2.5 py-1 rounded bg-rose-600 text-white animate-pulse";
      }
    }

    const qTimerEl = document.getElementById("ecs-question-timer-display");
    if (qTimerEl && activeQ) {
      qTimerEl.textContent = formatSecondsMMSS(activeQ.timeSpentSeconds);
    }
  }

  // ============================================================================
  // Question State Computation & Section Summary Helpers
  // ============================================================================
  function getQuestionStateCounts(questions) {
    const counts = {
      total: questions.length,
      answered: 0,
      "not-answered": 0,
      "not-visited": 0,
      review: 0,
      "ans-review": 0
    };
    questions.forEach((q) => {
      if (counts[q.status] !== undefined) {
        counts[q.status] += 1;
      }
    });
    return counts;
  }

  function hasValidResponse(q) {
    if (q.isTita) {
      return String(q.titaInput || "").trim().length > 0;
    }
    return typeof q.selectedOption === "number" && q.selectedOption >= 0;
  }

  function navigateToQuestion(qIdx) {
    if (!AppState.session) return;
    const sec = AppState.session.sections[AppState.session.activeSectionIndex];
    if (qIdx < 0 || qIdx >= sec.questions.length) return;

    const currentQ = sec.questions[AppState.session.activeQuestionIndex];
    if (currentQ && currentQ.status === "not-visited") {
      currentQ.status = "not-answered";
    }

    AppState.session.activeQuestionIndex = qIdx;
    const targetQ = sec.questions[qIdx];
    if (targetQ && targetQ.status === "not-visited") {
      targetQ.status = "not-answered";
    }
    AppState.mobilePaletteOpen = false;
    renderApp();
  }

  function advanceToNextQuestion() {
    if (!AppState.session) return;
    const sec = AppState.session.sections[AppState.session.activeSectionIndex];
    if (AppState.session.activeQuestionIndex < sec.questions.length - 1) {
      navigateToQuestion(AppState.session.activeQuestionIndex + 1);
    } else if (!AppState.session.examConfig.sectionalTiming && AppState.session.activeSectionIndex < AppState.session.sections.length - 1) {
      AppState.session.activeSectionIndex += 1;
      AppState.session.activeQuestionIndex = 0;
      const nextSecQ = AppState.session.sections[AppState.session.activeSectionIndex].questions[0];
      if (nextSecQ && nextSecQ.status === "not-visited") {
        nextSecQ.status = "not-answered";
      }
      showToast(`Moved to section: ${AppState.session.sections[AppState.session.activeSectionIndex].name}`, "info");
      renderApp();
    } else {
      navigateToQuestion(0);
      showToast("Reached end of section — wrapped to Question 1.", "info");
    }
  }

  function handleSaveAndNext() {
    if (!AppState.session) return;
    const sec = AppState.session.sections[AppState.session.activeSectionIndex];
    const q = sec.questions[AppState.session.activeQuestionIndex];
    if (hasValidResponse(q)) {
      q.status = "answered";
    } else {
      q.status = "not-answered";
    }
    advanceToNextQuestion();
  }

  function handleMarkForReviewAndNext() {
    if (!AppState.session) return;
    const sec = AppState.session.sections[AppState.session.activeSectionIndex];
    const q = sec.questions[AppState.session.activeQuestionIndex];
    if (hasValidResponse(q)) {
      q.status = "ans-review";
    } else {
      q.status = "review";
    }
    advanceToNextQuestion();
  }

  function handleClearResponse() {
    if (!AppState.session) return;
    const sec = AppState.session.sections[AppState.session.activeSectionIndex];
    const q = sec.questions[AppState.session.activeQuestionIndex];
    q.selectedOption = null;
    q.titaInput = "";
    q.status = "not-answered";
    renderApp();
  }

  function finalizeExamSubmission() {
    clearInterval(AppState.examTimerInterval);
    AppState.activeModal = null;
    AppState.mode = "feedback";
    renderApp();
  }

  // Calculate Final Score (including MAT 200–800 Composite Scaling & Percentile)
  function evaluateAndSaveAttempt() {
    const s = AppState.session;
    if (!s) return;

    let totalScore = 0;
    let maxScore = getExamTotalMaxMarks(s.examConfig);
    let answeredCount = 0;
    let correctCount = 0;
    let wrongCount = 0;
    let unansweredCount = 0;

    const sectionResults = s.sections.map((sec) => {
      let secRawScore = 0;
      let secRawMax = 0;
      let secCorrect = 0;
      let secWrong = 0;
      let secUnanswered = 0;

      sec.questions.forEach((q) => {
        const pos = Number(q.positiveMarks) || 1;
        const neg = Number(q.negativeMarks) || 0;
        secRawMax += pos;

        const isEvaluated = (q.status === "answered" || q.status === "ans-review") && hasValidResponse(q);

        if (isEvaluated) {
          answeredCount += 1;
          let isCorrect = false;
          if (q.isTita) {
            isCorrect = String(q.titaInput).trim() === String(q.titaAnswer).trim();
          } else {
            isCorrect = q.selectedOption === q.correctIndex;
          }

          if (isCorrect) {
            secCorrect += 1;
            correctCount += 1;
            secRawScore += pos;
          } else {
            secWrong += 1;
            wrongCount += 1;
            secRawScore -= neg;
          }
        } else {
          secUnanswered += 1;
          unansweredCount += 1;
        }
      });

      const targetSecMax = Number(sec.maxMarks || secRawMax);
      const scaledSecScore =
        secRawMax > 0 ? Number(((secRawScore / secRawMax) * targetSecMax).toFixed(2)) : 0;
      totalScore += scaledSecScore;

      return {
        name: sec.name,
        score: scaledSecScore,
        maxScore: Number(targetSecMax.toFixed(2)),
        correct: secCorrect,
        wrong: secWrong,
        unanswered: secUnanswered,
        totalQuestions: sec.questions.length
      };
    });

    const accuracy = answeredCount > 0 ? Number(((correctCount / answeredCount) * 100).toFixed(1)) : 0;
    const avgFeedback = Number(
      (
        (AppState.feedbackRatings.hardware +
          AppState.feedbackRatings.questions +
          AppState.feedbackRatings.interface +
          AppState.feedbackRatings.instructions) /
        4
      ).toFixed(1)
    );

    // Special MAT 200–800 Composite Score & Percentile Calculation (primarily from the first 4 sections)
    let matCompositeScore = null;
    let matPercentile = null;
    if (s.examConfig.isMatComposite || s.examConfig.id === "MAT_AIMA") {
      const firstFourSecs = sectionResults.slice(0, 4);
      const firstFourRaw = firstFourSecs.reduce((acc, sec) => acc + sec.score, 0);
      const firstFourMax = firstFourSecs.reduce((acc, sec) => acc + sec.maxScore, 0) || 120;
      const clampedRatio = Math.max(0, Math.min(1, firstFourRaw / firstFourMax));
      matCompositeScore = Math.round(200 + clampedRatio * 600);
      matPercentile = Number(Math.min(99.99, Math.max(12.5, 25 + clampedRatio * 74.9)).toFixed(2));
    }

    const attemptRecord = {
      attemptId: `ATT-${Date.now().toString().slice(-4)}`,
      rollNo: s.candidate.rollNo,
      candidateName: s.candidate.name,
      systemNo: s.candidate.systemNo,
      examId: s.examConfig.id,
      examTitle: s.examConfig.title,
      timestamp: new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }),
      score: Number(totalScore.toFixed(2)),
      maxScore: Number(maxScore.toFixed(2)),
      cutoffTotal: s.examConfig.cutoffTotal || Number((maxScore * 0.55).toFixed(1)),
      matCompositeScore,
      matPercentile,
      accuracy,
      answeredCount,
      correctCount,
      wrongCount,
      unansweredCount,
      timeTakenSeconds: s.totalElapsedSeconds,
      sectionResults,
      feedbackRating: avgFeedback,
      feedbackExperience: AppState.feedbackExperience,
      feedbackComment: AppState.feedbackComments || "Completed mandatory TCS/ECS iON post-test survey."
    };

    s.resultSummary = attemptRecord;
    AppState.attempts.unshift(attemptRecord);
    Storage.set("ecs_attempts", AppState.attempts);
  }

  // ============================================================================
  // UI Renderers for Each Stage of ECS iON
  // ============================================================================
  function renderGlobalTopBar() {
    const exam = getActiveExam();
    const isExamActive = AppState.mode === "exam" || AppState.mode === "submit_confirm";
    const totalQs = getExamTotalQuestions(exam);
    const totalMarks = getExamTotalMaxMarks(exam);

    return `
      <header class="bg-[#0c2340] text-white border-b border-blue-900 shadow-md no-print">
        <div class="max-w-[1600px] mx-auto px-3 sm:px-5 py-2 flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-3">
            <div class="flex items-center bg-white text-[#0c2340] px-2.5 py-1 rounded font-black tracking-tight text-sm sm:text-base shadow-sm">
              <span class="text-blue-700">ECS</span>
              <span class="mx-0.5 text-sky-500 font-extrabold">iON</span>
            </div>
            <div>
              <div class="flex items-center gap-2">
                <span class="font-bold text-xs sm:text-sm tracking-wide text-white">Elite Consultancy Services iON</span>
                <span class="hidden md:inline-block text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-blue-800/80 text-sky-200 border border-blue-700">Digital CBT Engine v5.2</span>
              </div>
              <p class="text-[11px] text-slate-300 truncate max-w-[260px] sm:max-w-[540px]">${exam.title} (${totalQs} Qs • ${totalMarks} Marks • ${exam.optionsCount} Options • ${exam.sectionalTiming ? "Sectional Timer" : "Composite Timer"})</p>
            </div>
          </div>

          <div class="flex items-center gap-2 flex-wrap">
            ${
              !isExamActive
                ? `
                <button type="button" onclick="window.ECSApp.switchMode('terminal')" class="px-3 py-1.5 rounded text-xs font-semibold transition flex items-center gap-1.5 ${
                  AppState.mode !== "admin"
                    ? "bg-sky-500 text-white shadow-sm"
                    : "bg-slate-800 text-slate-200 hover:bg-slate-700"
                }">
                  <span>🖥️</span> <span>Candidate Terminal</span>
                </button>
                <button type="button" onclick="window.ECSApp.switchMode('admin')" class="px-3 py-1.5 rounded text-xs font-semibold transition flex items-center gap-1.5 ${
                  AppState.mode === "admin"
                    ? "bg-amber-500 text-slate-950 font-bold shadow-sm"
                    : "bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-600"
                }">
                  <span>⚙️</span> <span>Admin Exam Control (${Object.keys(getAllExams()).length} Official Formats)</span>
                </button>
              `
                : `
                <div class="flex items-center gap-1.5 bg-slate-800/90 px-2.5 py-1 rounded border border-slate-700 text-xs">
                  <button type="button" onclick="window.ECSApp.adjustFontSize(-10)" class="px-1.5 py-0.5 rounded bg-slate-700 hover:bg-slate-600 font-bold" title="Decrease Font Size">A-</button>
                  <button type="button" onclick="window.ECSApp.adjustFontSize(0)" class="px-1.5 py-0.5 rounded bg-slate-700 hover:bg-slate-600 font-bold" title="Reset Font Size">A</button>
                  <button type="button" onclick="window.ECSApp.adjustFontSize(15)" class="px-1.5 py-0.5 rounded bg-slate-700 hover:bg-slate-600 font-bold" title="Increase Font Size">A+</button>
                  <span class="text-slate-500">|</span>
                  <button type="button" onclick="window.ECSApp.toggleDarkMode()" class="px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-[11px]" title="Toggle Contrast Theme">
                    ${AppState.darkMode ? "☀️ Light" : "🌙 Contrast"}
                  </button>
                </div>
                <button type="button" onclick="window.ECSApp.openModal('question_paper')" class="px-2.5 py-1 rounded bg-blue-800 hover:bg-blue-700 text-xs font-semibold border border-blue-600">
                  📄 Question Paper
                </button>
                <button type="button" onclick="window.ECSApp.openModal('instructions')" class="px-2.5 py-1 rounded bg-blue-800 hover:bg-blue-700 text-xs font-semibold border border-blue-600">
                  ℹ️ Instructions
                </button>
                ${
                  exam.calculatorMode !== "none"
                    ? `<button type="button" onclick="window.ECSApp.openModal('calculator')" class="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold shadow">
                        🧮 Calculator
                      </button>`
                    : ""
                }
              `
            }
          </div>
        </div>
      </header>
    `;
  }

  // ============================================================================
  // 1. CANDIDATE WAITING LOBBY & ROLL NUMBER / PASSWORD LOGIN TERMINAL
  // ============================================================================
  function renderCandidateTerminal() {
    const exam = getActiveExam();
    const candidate = getCurrentCandidate();
    const allExams = Object.values(getAllExams());
    const totalQs = getExamTotalQuestions(exam);
    const totalMarks = getExamTotalMaxMarks(exam);
    const mins = String(Math.floor(AppState.waitingSecondsLeft / 60)).padStart(2, "0");
    const secs = String(AppState.waitingSecondsLeft % 60).padStart(2, "0");
    const totalWait = Math.max(1, exam.waitingRoomSeconds || 10);
    const pct = Math.min(100, Math.round(((totalWait - AppState.waitingSecondsLeft) / totalWait) * 100));

    return `
      <div class="min-h-[calc(100vh-56px)] flex flex-col justify-between bg-slate-100">
        <!-- TCS iON System Info Strip -->
        <div class="bg-[#1e3a5f] text-white border-b border-slate-700 shadow">
          <div class="max-w-7xl mx-auto px-4 py-3 grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
            <!-- System Number -->
            <div class="bg-[#152c4a] p-3 rounded-lg border border-blue-800/80">
              <div class="text-[11px] uppercase tracking-wider text-sky-300 font-semibold">System Name / Terminal ID</div>
              <div class="text-2xl sm:text-3xl font-black tracking-tight text-amber-400 font-mono mt-0.5">${candidate.systemNo}</div>
              <div class="text-[11px] text-slate-300 mt-0.5 truncate">📍 ${candidate.labName}</div>
            </div>

            <!-- Active Exam & Quick Format Selector (All 25 Exams) -->
            <div class="bg-[#152c4a] p-3 rounded-lg border border-blue-800/80">
              <div class="flex items-center justify-between gap-2">
                <span class="text-[11px] uppercase tracking-wider text-sky-300 font-semibold">Select Examination (${allExams.length} Formats)</span>
                <span class="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-semibold">${totalQs} Qs • ${totalMarks}M</span>
              </div>
              <div class="mt-1.5">
                <select aria-label="Select Exam Format" onchange="window.ECSApp.selectExamPreset(this.value)" class="w-full bg-[#0c2340] text-white text-xs sm:text-sm font-bold rounded px-2.5 py-1.5 border border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-400">
                  ${allExams
                    .map(
                      (ex) =>
                        `<option value="${ex.id}" ${ex.id === exam.id ? "selected" : ""}>${ex.title} [${getExamTotalQuestions(ex)} Qs • ${ex.totalDurationMinutes}m • ${ex.optionsCount} Opts]</option>`
                    )
                    .join("")}
                </select>
              </div>
              <div class="text-[11px] text-slate-300 mt-1 flex items-center justify-between">
                <span>⏱️ Time: <strong>${exam.totalDurationMinutes} Mins</strong></span>
                <span>🔒 Sectional Timer: <strong>${exam.sectionalTiming ? "YES (Locked)" : "NO (Composite)"}</strong></span>
              </div>
            </div>

            <!-- Candidate Registered Biometric Profile -->
            <div class="bg-[#152c4a] p-3 rounded-lg border border-blue-800/80 flex items-center gap-3.5">
              <div class="w-16 h-16 rounded-lg border-2 border-amber-400 bg-slate-800 flex items-center justify-center overflow-hidden shrink-0 shadow-inner">
                ${renderCandidateAvatarSVG(candidate)}
              </div>
              <div class="min-w-0 flex-1">
                <div class="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold flex items-center gap-1">
                  <span>✓ Biometric Verified</span>
                </div>
                <div class="text-base sm:text-lg font-extrabold text-white truncate">${candidate.name}</div>
                <div class="text-xs text-amber-300 font-mono font-semibold">Roll No: ${candidate.rollNo}</div>
                <div class="text-[11px] text-slate-300 truncate">${candidate.shift}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Main Center Login & Waiting Gate Card -->
        <div class="max-w-6xl w-full mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <!-- Left Column: Pre-Exam Waiting Gate + Candidate Login Box (7 cols) -->
          <div class="lg:col-span-7 bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden">
            <div class="bg-gradient-to-r from-[#1e3a8a] to-[#2563eb] text-white px-5 py-3.5 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="text-lg">🔐</span>
                <h1 class="font-bold text-sm sm:text-base tracking-wide">Candidate Exam Login Console</h1>
              </div>
              <span class="text-xs bg-blue-900/80 px-2.5 py-0.5 rounded font-mono border border-blue-400/30">${exam.code}</span>
            </div>

            <div class="p-5 space-y-4">
              <!-- Pre-Exam Waiting Countdown Gate -->
              <div class="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-2.5">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div class="text-xs font-bold uppercase tracking-wider text-slate-500">Pre-Exam Waiting Lobby Synchronization</div>
                    <p class="text-xs text-slate-600 mt-0.5">Candidates must wait for the central server countdown before signing in with Roll No. & Password.</p>
                  </div>
                  <div class="flex items-center gap-2">
                    <div class="bg-slate-900 text-amber-400 font-mono font-black text-lg px-3 py-1 rounded border border-slate-700" id="ecs-waiting-countdown-text">
                      ${mins}:${secs}
                    </div>
                    ${
                      AppState.waitingSecondsLeft > 0
                        ? `<button type="button" onclick="window.ECSApp.skipWaitingTimer()" class="text-xs px-2.5 py-1.5 rounded bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold border border-amber-300 transition" title="Invigilator Override to unlock immediately">
                            ⚡ Skip Wait
                          </button>`
                        : ""
                    }
                  </div>
                </div>
                <div class="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div id="ecs-waiting-progress-bar" class="h-full bg-gradient-to-r from-blue-600 to-emerald-500 transition-all duration-500" style="width: ${pct}%"></div>
                </div>
                <div id="ecs-gate-status-banner" class="rounded-lg p-2.5 text-xs flex items-center justify-between gap-2 ${
                  AppState.waitingSecondsLeft <= 0
                    ? "bg-emerald-50 border border-emerald-300 text-emerald-900"
                    : "bg-amber-50 border border-amber-300 text-amber-900"
                }">
                  ${
                    AppState.waitingSecondsLeft <= 0
                      ? `<div class="flex items-center gap-2"><span class="inline-block w-2.5 h-2.5 rounded-full bg-emerald-600 animate-ping"></span><span class="font-semibold">Invigilator Broadcast Received: Login Gate is now OPEN.</span></div><span class="font-mono font-bold text-emerald-700">READY</span>`
                      : `<div class="flex items-center gap-2"><span class="inline-block w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse"></span><span>Waiting for Exam Server Synchronization (${AppState.waitingSecondsLeft}s remaining)...</span></div><span class="font-mono font-bold">WAITING</span>`
                  }
                </div>
              </div>

              <!-- Login Credentials Form -->
              <div class="space-y-3.5">
                <div>
                  <label class="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1" for="ecs-input-roll">
                    Candidate Roll Number / Registration ID
                  </label>
                  <div class="flex gap-2">
                    <div class="relative flex-1">
                      <span class="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400">👤</span>
                      <input
                        id="ecs-input-roll"
                        type="text"
                        value="${AppState.loginRollInput}"
                        oninput="window.ECSApp.updateLoginInput('loginRollInput', this.value)"
                        onfocus="window.ECSApp.setActiveKeyboardField('loginRollInput')"
                        placeholder="Enter 10-digit Roll Number"
                        class="w-full pl-9 pr-3 py-2.5 rounded-lg border border-slate-300 font-mono text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>
                    <button type="button" onclick="window.ECSApp.toggleVirtualKeyboard('loginRollInput')" class="px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 text-xs font-semibold" title="Toggle TCS iON Virtual Keypad">
                      ⌨️ Keypad
                    </button>
                  </div>
                </div>

                <div>
                  <label class="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1" for="ecs-input-pass">
                    Password / Date of Birth Pin (YYYY-MM-DD)
                  </label>
                  <div class="flex gap-2">
                    <div class="relative flex-1">
                      <span class="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400">🔑</span>
                      <input
                        id="ecs-input-pass"
                        type="text"
                        value="${AppState.loginPasswordInput}"
                        oninput="window.ECSApp.updateLoginInput('loginPasswordInput', this.value)"
                        onfocus="window.ECSApp.setActiveKeyboardField('loginPasswordInput')"
                        placeholder="Enter Password (e.g. 1999-08-15)"
                        class="w-full pl-9 pr-3 py-2.5 rounded-lg border border-slate-300 font-mono text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>
                    <button type="button" onclick="window.ECSApp.toggleVirtualKeyboard('loginPasswordInput')" class="px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 text-xs font-semibold" title="Toggle TCS iON Virtual Keypad">
                      ⌨️ Keypad
                    </button>
                  </div>
                </div>

                ${AppState.virtualKeyboardOpen ? renderVirtualKeypad() : ""}

                <div class="pt-1">
                  <button
                    id="ecs-terminal-signin-btn"
                    type="button"
                    onclick="window.ECSApp.handleCandidateLogin()"
                    ${AppState.waitingSecondsLeft > 0 ? "disabled" : ""}
                    class="${
                      AppState.waitingSecondsLeft <= 0
                        ? "w-full py-3 px-5 rounded-lg font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-md transition flex items-center justify-center gap-2 cursor-pointer"
                        : "w-full py-3 px-5 rounded-lg font-bold text-slate-400 bg-slate-200 border border-slate-300 flex items-center justify-center gap-2 cursor-not-allowed"
                    }"
                  >
                    ${
                      AppState.waitingSecondsLeft <= 0
                        ? `<span>Sign In to Assessment Console</span> <span>→</span>`
                        : `<span>🔒 Gate Locked — Wait ${AppState.waitingSecondsLeft}s</span>`
                    }
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Right Column: Multi-Candidate Quick Switcher & Active Exam Blueprint (5 cols) -->
          <div class="lg:col-span-5 space-y-4">
            <!-- Selected Exam Blueprint Summary Card -->
            <div class="bg-white rounded-xl shadow-md border border-slate-200 p-4 space-y-3">
              <div class="flex items-center justify-between gap-2">
                <h2 class="text-xs font-extrabold uppercase tracking-wider text-slate-700">📋 Active Paper Format Blueprint</h2>
                <button type="button" onclick="window.ECSApp.switchMode('admin')" class="text-xs text-blue-600 hover:underline font-semibold">Browse All 25 Formats →</button>
              </div>
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-900 border border-blue-200">${exam.sector || "Competitive CBT"}</span>
                <span class="px-2 py-0.5 rounded text-[10px] font-bold ${
                  exam.difficulty === "undergraduate"
                    ? "bg-emerald-100 text-emerald-900 border border-emerald-200"
                    : exam.difficulty === "mains"
                    ? "bg-purple-100 text-purple-900 border border-purple-200"
                    : "bg-amber-100 text-amber-900 border border-amber-200"
                }">${exam.difficultyLabel || "Graduate Level"}</span>
              </div>
              <div class="text-xs text-slate-600 leading-relaxed">${exam.description}</div>
              <div class="grid grid-cols-3 gap-2 text-xs">
                <div class="p-2 rounded bg-slate-50 border border-slate-200">
                  <span class="text-slate-500 block text-[10px] uppercase">Total Qs / Marks</span>
                  <span class="font-bold text-slate-900">${totalQs} Qs / ${totalMarks}M</span>
                </div>
                <div class="p-2 rounded bg-slate-50 border border-slate-200">
                  <span class="text-slate-500 block text-[10px] uppercase">Options</span>
                  <span class="font-bold text-slate-900">${exam.optionsCount} (A–${exam.optionsCount === 5 ? "E" : "D"})</span>
                </div>
                <div class="p-2 rounded bg-slate-50 border border-slate-200">
                  <span class="text-slate-500 block text-[10px] uppercase">Marking</span>
                  <span class="font-bold text-emerald-700">+${exam.positiveMarks}</span> / <span class="font-bold text-rose-600">-${exam.negativeMarks}</span>
                </div>
              </div>
              <div class="border-t border-slate-200 pt-2">
                <div class="text-[11px] font-bold text-slate-700 mb-1.5">Section Structure (${exam.sections.length} Sections — Upfront Batch API Load):</div>
                <div class="space-y-1 max-h-40 overflow-y-auto ecs-scroll pr-1">
                  ${exam.sections
                    .map(
                      (s, idx) => `
                    <div class="flex items-center justify-between text-xs bg-slate-50 px-2.5 py-1.5 rounded border border-slate-200">
                      <span class="font-medium text-slate-800 truncate pr-2">${idx + 1}. ${s.name}</span>
                      <span class="font-mono text-[11px] text-slate-700 shrink-0"><strong>${s.questionCount} Qs</strong> • ${s.displayedMaxMarks || s.maxMarks || s.questionCount}M • ${exam.sectionalTiming ? `${s.durationMinutes}m` : "Comp."}</span>
                    </div>
                  `
                    )
                    .join("")}
                </div>
              </div>
            </div>

            <!-- Quick Candidate Selector Card -->
            <div class="bg-white rounded-xl shadow-md border border-slate-200 p-4">
              <div class="flex items-center justify-between mb-2">
                <h2 class="text-xs font-extrabold uppercase tracking-wider text-slate-700">👥 Multi-Candidate Shift Roster (1-Click Fill)</h2>
                <span class="text-[11px] text-blue-600 font-semibold">${AppState.candidates.length} Registered</span>
              </div>
              <div class="space-y-2 max-h-40 overflow-y-auto ecs-scroll pr-1">
                ${AppState.candidates
                  .map(
                    (c) => `
                  <button
                    type="button"
                    onclick="window.ECSApp.selectDemoCandidate('${c.rollNo}')"
                    class="w-full text-left p-2 rounded-lg border transition flex items-center justify-between gap-2 ${
                      AppState.loginRollInput === c.rollNo
                        ? "bg-blue-50 border-blue-500 ring-1 ring-blue-500"
                        : "bg-slate-50 hover:bg-slate-100 border-slate-200"
                    }"
                  >
                    <div class="min-w-0">
                      <div class="font-bold text-xs text-slate-900 truncate">${c.name} <span class="text-[10px] font-normal text-slate-500">(${c.category})</span></div>
                      <div class="text-[11px] font-mono text-slate-600">Roll: <strong>${c.rollNo}</strong> • Pass: <strong>${c.password}</strong></div>
                    </div>
                    <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-200 text-slate-800 shrink-0">${c.systemNo}</span>
                  </button>
                `
                  )
                  .join("")}
              </div>
            </div>
          </div>
        </div>

        <!-- Bottom TCS iON System Status Footer -->
        <footer class="bg-slate-900 text-slate-400 text-xs py-2.5 px-4 border-t border-slate-800">
          <div class="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
            <span>© 2026 Elite Consultancy Services iON (ECS iON) — Supporting 25 Official Exam Formats (SBI, IBPS, RRB, RBI, SSC, Railways, CAT, MAT)</span>
            <span class="font-mono text-[11px] text-emerald-400">● Upfront Single-Sitting Batch API Ready • Responsive Across All Resolutions</span>
          </div>
        </footer>
      </div>
    `;
  }

  function renderCandidateAvatarSVG(candidate) {
    const hue = candidate.avatarHue || 215;
    const initials = candidate.name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
    return `
      <svg viewBox="0 0 80 80" class="w-full h-full">
        <defs>
          <linearGradient id="avGrad-${candidate.rollNo}" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="hsl(${hue}, 70%, 38%)" />
            <stop offset="100%" stop-color="hsl(${hue}, 80%, 22%)" />
          </linearGradient>
        </defs>
        <rect width="80" height="80" fill="url(#avGrad-${candidate.rollNo})" />
        <circle cx="40" cy="30" r="14" fill="rgba(255,255,255,0.85)" />
        <path d="M16 74 C16 54, 64 54, 64 74" fill="rgba(255,255,255,0.85)" />
        <text x="40" y="73" text-anchor="middle" fill="hsl(${hue}, 80%, 20%)" font-size="11" font-weight="900" font-family="Inter, sans-serif">${initials}</text>
      </svg>
    `;
  }

  function renderVirtualKeypad() {
    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-"];
    return `
      <div class="p-3 rounded-lg bg-slate-100 border border-slate-300 space-y-2">
        <div class="flex items-center justify-between text-xs text-slate-600 font-semibold">
          <span>TCS iON Virtual On-Screen Keypad (Editing: ${AppState.activeKeyboardField === "loginRollInput" ? "Roll Number" : "Password"})</span>
          <button type="button" onclick="window.ECSApp.toggleVirtualKeyboard()" class="text-rose-600 font-bold">Close ✕</button>
        </div>
        <div class="flex flex-wrap gap-1.5">
          ${keys
            .map(
              (k) =>
                `<button type="button" onclick="window.ECSApp.pressVirtualKey('${k}')" class="px-3 py-1.5 rounded bg-white hover:bg-blue-50 border border-slate-300 font-mono font-bold text-sm shadow-sm">${k}</button>`
            )
            .join("")}
          <button type="button" onclick="window.ECSApp.pressVirtualKey('BACKSPACE')" class="px-3 py-1.5 rounded bg-amber-100 hover:bg-amber-200 border border-amber-300 font-mono font-bold text-xs">⌫ Backspace</button>
          <button type="button" onclick="window.ECSApp.pressVirtualKey('CLEAR')" class="px-3 py-1.5 rounded bg-rose-100 hover:bg-rose-200 border border-rose-300 font-mono font-bold text-xs">Clear</button>
        </div>
      </div>
    `;
  }

  // ============================================================================
  // 2. OFFICIAL TCS iON GENERAL INSTRUCTIONS & EXAM DECLARATION (2-Page Flow)
  // ============================================================================
  function renderInstructionsFlow() {
    const exam = getActiveExam();
    const candidate = getCurrentCandidate();
    const totalQuestions = getExamTotalQuestions(exam);
    const totalMaxMarks = getExamTotalMaxMarks(exam);

    return `
      <div class="h-[calc(100vh-56px)] flex flex-col lg:flex-row bg-white overflow-hidden">
        <div class="flex-1 flex flex-col h-full overflow-hidden border-r border-slate-300">
          <!-- Subheader -->
          <div class="bg-[#38a9eb] text-white px-5 py-2.5 flex items-center justify-between shrink-0">
            <h1 class="font-bold text-sm sm:text-base tracking-wide">
              ${AppState.instructionsPage === 1 ? "General Instructions (कृपया निम्नलिखित निर्देशों को ध्यान से पढ़ें)" : `Paper Format, Marking Scheme & Candidate Declaration — ${exam.code}`}
            </h1>
            <div class="flex items-center gap-2 text-xs">
              <span>View Instructions In:</span>
              <select aria-label="View Instructions Language" onchange="window.ECSApp.setDefaultLanguage(this.value)" class="bg-white text-slate-900 font-bold px-2 py-1 rounded text-xs">
                <option value="en" ${AppState.defaultLanguage === "en" ? "selected" : ""}>English</option>
                <option value="hi" ${AppState.defaultLanguage === "hi" ? "selected" : ""}>हिन्दी (Hindi)</option>
                <option value="bilingual" ${AppState.defaultLanguage === "bilingual" ? "selected" : ""}>Bilingual (English + हिन्दी)</option>
              </select>
            </div>
          </div>

          <!-- Scrollable Instructions Body -->
          <div class="flex-1 overflow-y-auto ecs-scroll p-5 sm:p-7 space-y-5 text-xs sm:text-sm text-slate-800 leading-relaxed">
            ${
              AppState.instructionsPage === 1
                ? `
              <div class="space-y-4">
                <h2 class="text-base font-extrabold text-slate-900 underline">Please read the instructions carefully:</h2>
                <ol class="list-decimal pl-5 space-y-2.5">
                  <li>Total duration of the <strong>${exam.title}</strong> is <strong>${exam.totalDurationMinutes} minutes</strong> for <strong>${totalQuestions} questions</strong> (Max Marks: <strong>${totalMaxMarks}</strong>). ${
                    exam.sectionalTiming
                      ? `<span class="text-rose-700 font-semibold">Sectional timing is ACTIVE: each section has its own dedicated timer and automatically advances upon expiry.</span>`
                      : `<span class="text-emerald-700 font-semibold">Composite timing is ACTIVE: candidates may freely navigate across any section during the ${exam.totalDurationMinutes} minutes.</span>`
                  }</li>
                  <li>The clock will be set at the server. The countdown timer in the top right corner of screen will display the remaining time available for you to complete the examination. When the timer reaches zero, the examination will end by itself.</li>
                  <li>All <strong>${totalQuestions} questions</strong> for this exam sitting are fetched and synchronized <strong>in one single batch upfront</strong> so you experience zero loading delay while switching questions.</li>
                  <li>The Question Palette displayed on the right side of screen will show the status of each question using one of the following authentic <strong>ECS iON / TCS iON</strong> symbols:</li>
                </ol>

                <div class="bg-slate-50 border border-slate-300 rounded-xl p-4 space-y-3 my-4">
                  <div class="flex items-center gap-4">
                    <span class="tcs-badge state-not-visited">1</span>
                    <span>You have <strong>not visited</strong> the question yet. (आपने अभी तक प्रश्न नहीं देखा है।)</span>
                  </div>
                  <div class="flex items-center gap-4">
                    <span class="tcs-badge state-not-answered">3</span>
                    <span>You have <strong>not answered</strong> the question. (आपने प्रश्न का उत्तर नहीं दिया है।)</span>
                  </div>
                  <div class="flex items-center gap-4">
                    <span class="tcs-badge state-answered">5</span>
                    <span>You have <strong>answered</strong> the question. (आपने प्रश्न का उत्तर दे दिया है।)</span>
                  </div>
                  <div class="flex items-center gap-4">
                    <span class="tcs-badge state-review">7</span>
                    <span>You have <strong>NOT answered</strong> the question, but have <strong>marked the question for review</strong>. (आपने प्रश्न का उत्तर नहीं दिया है, पर पुनर्विचार के लिए चिह्नित किया है।)</span>
                  </div>
                  <div class="flex items-center gap-4">
                    <span class="tcs-badge state-ans-review">9</span>
                    <span>The question(s) <strong>"Answered and Marked for Review"</strong> will be <strong>considered for evaluation</strong>. (प्रश्न जिसका उत्तर दिया गया है और समीक्षा के लिए भी चिह्नित है, उसका मूल्यांकन किया जाएगा।)</span>
                  </div>
                </div>

                <h3 class="font-extrabold text-slate-900 underline">Navigating to a Question & Answering:</h3>
                <ol class="list-decimal pl-5 space-y-2" start="5">
                  <li>Click on the question number in the Question Palette at the right of your screen to go to that numbered question directly. Note that using this option does NOT save your answer to the current question.</li>
                  <li>Click on <strong>Save & Next</strong> to save your answer for the current question and then go to the next question.</li>
                  <li>Click on <strong>Mark for Review & Next</strong> to save your answer for the current question, mark it for review, and then go to the next question.</li>
                  <li>To deselect your chosen answer, click on the chosen option again or click on the <strong>Clear Response</strong> button.</li>
                </ol>
              </div>
            `
                : `
              <!-- Page 2: Exam Paper Structure, Marking Scheme & Candidate Declaration -->
              <div class="space-y-5">
                <div class="bg-blue-50 border border-blue-200 rounded-xl p-4">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <h2 class="text-base font-extrabold text-blue-950">${exam.title} — Official Paper Format</h2>
                    <span class="px-2.5 py-0.5 rounded text-xs font-bold bg-blue-900 text-white">${exam.difficultyLabel || "Standard Competitive Level"}</span>
                  </div>
                  <p class="text-xs text-blue-800 mt-1">Conducting Body: <strong>${exam.conductingBody}</strong> • Option Format: <strong>${exam.optionsCount} Options per MCQ</strong> • Marking Rule: <strong>${exam.markingNote || `+${exam.positiveMarks} / -${exam.negativeMarks}`}</strong></p>
                </div>

                <div class="overflow-x-auto">
                  <table class="w-full border-collapse border border-slate-300 text-xs sm:text-sm">
                    <thead>
                      <tr class="bg-slate-800 text-white">
                        <th class="border border-slate-600 p-2.5 text-left">Sr. No.</th>
                        <th class="border border-slate-600 p-2.5 text-left">Section / Subject Name</th>
                        <th class="border border-slate-600 p-2.5 text-center">No. of Questions</th>
                        <th class="border border-slate-600 p-2.5 text-center">Max Marks</th>
                        <th class="border border-slate-600 p-2.5 text-center">Marking Scheme</th>
                        <th class="border border-slate-600 p-2.5 text-center">Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${exam.sections
                        .map((s, i) => {
                          const schemeText = s.variableDistribution
                            ? `+${s.variableDistribution.highMark}/+${s.variableDistribution.lowMark} (-1/4th)`
                            : `+${s.positiveMarks || exam.positiveMarks} / -${s.negativeMarks ?? exam.negativeMarks}`;
                          return `
                            <tr class="odd:bg-white even:bg-slate-50">
                              <td class="border border-slate-300 p-2.5 font-mono font-bold">${i + 1}</td>
                              <td class="border border-slate-300 p-2.5 font-bold text-slate-900">${s.name}</td>
                              <td class="border border-slate-300 p-2.5 text-center font-mono font-bold">${s.questionCount}</td>
                              <td class="border border-slate-300 p-2.5 text-center font-mono font-bold text-blue-800">${s.displayedMaxMarks || s.maxMarks || s.questionCount}</td>
                              <td class="border border-slate-300 p-2.5 text-center font-mono text-xs">${schemeText}</td>
                              <td class="border border-slate-300 p-2.5 text-center font-mono">${
                                exam.sectionalTiming ? `${s.durationMinutes} Mins (Separately Timed)` : "Composite"
                              }</td>
                            </tr>
                          `;
                        })
                        .join("")}
                      <tr class="bg-slate-100 font-extrabold">
                        <td colspan="2" class="border border-slate-300 p-2.5 text-right">Total Sitting Summary</td>
                        <td class="border border-slate-300 p-2.5 text-center font-mono text-blue-900">${totalQuestions} Questions</td>
                        <td class="border border-slate-300 p-2.5 text-center font-mono text-blue-900">${totalMaxMarks} Marks</td>
                        <td class="border border-slate-300 p-2.5 text-center">${exam.optionsCount} Options (${exam.optionsCount === 5 ? "Banking A–E" : "Standard A–D"})</td>
                        <td class="border border-slate-300 p-2.5 text-center font-mono">${exam.totalDurationMinutes} Mins</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                ${
                  exam.hasOptionalLanguageSection
                    ? `
                  <div class="bg-indigo-50 border border-indigo-300 rounded-xl p-4 space-y-2">
                    <label for="ecs-optional-lang-sec" class="block font-extrabold text-indigo-950 text-xs sm:text-sm">
                      📌 Mandatory Section 4 Language Paper Choice (English Language OR Hindi Language — 40 Questions):
                    </label>
                    <select
                      id="ecs-optional-lang-sec"
                      onchange="window.ECSApp.setOptionalLanguageChoice(this.value)"
                      class="bg-white border-2 border-indigo-600 rounded-lg px-3 py-2 font-bold text-xs sm:text-sm text-slate-900"
                    >
                      <option value="english" ${AppState.optionalLanguageChoice === "english" ? "selected" : ""}>Opt for Section 4A: English Language (40 Questions • 40 Marks)</option>
                      <option value="hindi_lang" ${AppState.optionalLanguageChoice === "hindi_lang" ? "selected" : ""}>Opt for Section 4B: Hindi Language / हिन्दी भाषा (40 Questions • 40 Marks)</option>
                    </select>
                  </div>
                `
                    : ""
                }

                <!-- Language Selection & Mandatory Declaration Box -->
                <div class="bg-amber-50/90 border border-amber-300 rounded-xl p-4 space-y-3">
                  <div class="flex flex-wrap items-center gap-3">
                    <label for="ecs-default-lang-select" class="font-bold text-slate-900 text-xs sm:text-sm">
                      Choose your default question display language:
                    </label>
                    <select
                      id="ecs-default-lang-select"
                      onchange="window.ECSApp.setDefaultLanguage(this.value)"
                      class="bg-white border border-slate-400 rounded px-3 py-1.5 font-bold text-xs sm:text-sm text-slate-900"
                    >
                      <option value="en" ${AppState.defaultLanguage === "en" ? "selected" : ""}>English</option>
                      <option value="hi" ${AppState.defaultLanguage === "hi" ? "selected" : ""}>हिन्दी (Hindi)</option>
                      <option value="bilingual" ${AppState.defaultLanguage === "bilingual" ? "selected" : ""}>Bilingual (Both English & Hindi)</option>
                    </select>
                  </div>
                  <p class="text-xs text-rose-700 font-semibold">
                    Please note all questions will appear in your default language. This language can also be changed for a particular question later on during the examination.
                  </p>

                  <label class="flex items-start gap-3 cursor-pointer pt-2 border-t border-amber-200">
                    <input
                      type="checkbox"
                      ${AppState.declarationChecked ? "checked" : ""}
                      onchange="window.ECSApp.toggleDeclaration(this.checked)"
                      class="mt-1 w-4 h-4 accent-blue-600 rounded cursor-pointer shrink-0"
                    />
                    <span class="text-xs text-slate-800 leading-relaxed">
                      <strong>Candidate Declaration:</strong> I have read and understood all the instructions. All computer hardware allotted to me are in proper working condition. I declare that I am not in possession of / not wearing / not carrying any prohibited gadget like mobile phone, bluetooth devices etc. I agree that in case of not adhering to the instructions, I shall be liable to be debarred from this test and/or to disciplinary action.
                    </span>
                  </label>
                </div>
              </div>
            `
            }
          </div>

          <!-- Instructions Bottom Action Bar -->
          <div class="bg-slate-100 border-t border-slate-300 px-5 py-3 flex items-center justify-between gap-3 shrink-0">
            ${
              AppState.instructionsPage === 1
                ? `
                <button type="button" onclick="window.ECSApp.switchMode('terminal')" class="px-4 py-2 rounded border border-slate-400 bg-white hover:bg-slate-50 text-xs sm:text-sm font-semibold text-slate-700">
                  ← Back to Login Terminal
                </button>
                <button type="button" onclick="window.ECSApp.setInstructionsPage(2)" class="px-6 py-2.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-bold shadow">
                  Next &gt;
                </button>
              `
                : `
                <button type="button" onclick="window.ECSApp.setInstructionsPage(1)" class="px-4 py-2 rounded border border-slate-400 bg-white hover:bg-slate-50 text-xs sm:text-sm font-semibold text-slate-700">
                  &lt; Previous
                </button>
                <button
                  type="button"
                  onclick="window.ECSApp.beginExamBatchLoad()"
                  ${!AppState.declarationChecked ? "disabled" : ""}
                  class="${
                    AppState.declarationChecked
                      ? "px-7 py-2.5 rounded bg-[#2563eb] hover:bg-blue-700 text-white text-xs sm:text-sm font-extrabold shadow-md cursor-pointer transition"
                      : "px-7 py-2.5 rounded bg-slate-300 text-slate-500 text-xs sm:text-sm font-bold cursor-not-allowed"
                  }"
                >
                  I am ready to begin (${totalQuestions} Qs)
                </button>
              `
            }
          </div>
        </div>

        <!-- Right Candidate Sidebar -->
        <aside class="w-full lg:w-72 bg-slate-50 p-5 flex flex-row lg:flex-col items-center justify-center gap-4 border-t lg:border-t-0 shrink-0">
          <div class="w-20 h-20 lg:w-28 lg:h-28 rounded-xl border-2 border-slate-300 shadow overflow-hidden shrink-0">
            ${renderCandidateAvatarSVG(candidate)}
          </div>
          <div class="text-left lg:text-center">
            <div class="font-extrabold text-base text-slate-900">${candidate.name}</div>
            <div class="text-xs font-mono text-blue-700 font-semibold mt-0.5">Roll No: ${candidate.rollNo}</div>
            <div class="text-xs text-slate-500 mt-1">${candidate.systemNo}</div>
            <span class="inline-block mt-2 px-2.5 py-0.5 rounded-full text-[11px] bg-emerald-100 text-emerald-800 font-semibold border border-emerald-300">
              Verified Candidate
            </span>
          </div>
        </aside>
      </div>
    `;
  }

  // ============================================================================
  // 3. UPFRONT BATCH API QUESTION LOADING OVERLAY
  // ============================================================================
  function renderApiBatchLoadingScreen() {
    const exam = getActiveExam();
    return `
      <div class="min-h-[calc(100vh-56px)] flex items-center justify-center bg-slate-900 text-white p-4">
        <div class="max-w-xl w-full bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl p-6 space-y-5">
          <div class="flex items-center gap-3">
            <div class="w-11 h-11 rounded-xl bg-blue-600 flex items-center justify-center font-black text-xl animate-pulse">⚡</div>
            <div>
              <h2 class="text-base sm:text-lg font-extrabold">Synchronizing Single-Sitting Question Batch via API</h2>
              <p class="text-xs text-slate-300">Loading all ${getExamTotalQuestions(exam)} questions upfront into encrypted browser memory (${exam.code})</p>
            </div>
          </div>

          <div class="w-full h-3 bg-slate-950 rounded-full overflow-hidden border border-slate-700">
            <div id="ecs-api-batch-bar" class="h-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-all duration-300" style="width: ${AppState.apiBatchProgress}%"></div>
          </div>

          <div id="ecs-api-log-box" class="bg-slate-950 rounded-xl p-3.5 border border-slate-800 font-mono text-xs text-emerald-400 space-y-1.5 max-h-48 overflow-y-auto">
            ${AppState.apiLoadLogs.map((l) => `<div>[${l.time}] ${l.msg}</div>`).join("")}
          </div>
        </div>
      </div>
    `;
  }

  // ============================================================================
  // 4. FULL TCS iON LIVE ASSESSMENT CONSOLE
  // ============================================================================
  function renderExamConsole() {
    const s = AppState.session;
    if (!s) return "";
    const exam = s.examConfig;
    const activeSec = s.sections[s.activeSectionIndex];
    const activeQ = activeSec.questions[s.activeQuestionIndex];
    const displaySecs = exam.sectionalTiming ? activeSec.remainingSeconds : s.totalRemainingSeconds;
    const sectionCounts = getQuestionStateCounts(activeSec.questions);

    const filteredQuestions = activeSec.questions.filter((q) => {
      if (AppState.paletteFilter === "answered") return q.status === "answered" || q.status === "ans-review";
      if (AppState.paletteFilter === "not_answered") return q.status === "not-answered" || q.status === "not-visited";
      if (AppState.paletteFilter === "review") return q.status === "review" || q.status === "ans-review";
      return true;
    });

    const optionLetters = ["A", "B", "C", "D", "E"];

    return `
      <div class="h-[calc(100vh-48px)] flex flex-col bg-white ecs-surface overflow-hidden select-none" style="--ecs-question-font-size: ${AppState.fontSizeScale}%">
        <!-- TCS iON Group / Section Strip + Timer Bar -->
        <div class="bg-[#f1f5f9] ecs-subsurface border-b border-slate-300 px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <!-- Section Tabs -->
          <div class="flex items-center gap-1.5 overflow-x-auto ecs-scroll py-0.5 max-w-full">
            <span class="text-[11px] font-bold uppercase tracking-wider text-slate-500 mr-1 hidden sm:inline">Sections:</span>
            ${s.sections
              .map((sec, idx) => {
                const isActive = idx === s.activeSectionIndex;
                const isLocked = exam.sectionalTiming && !isActive;
                const counts = getQuestionStateCounts(sec.questions);
                return `
                  <button
                    type="button"
                    onclick="window.ECSApp.switchSection(${idx})"
                    class="px-3 py-1.5 rounded text-xs font-bold transition flex items-center gap-1.5 shrink-0 ${
                      isActive
                        ? "bg-[#2563eb] text-white shadow-sm"
                        : isLocked
                        ? "bg-slate-200 text-slate-500 border border-slate-300 cursor-not-allowed"
                        : "bg-white text-slate-800 hover:bg-blue-50 border border-slate-300"
                    }"
                    title="${sec.name}: ${counts.answered + counts["ans-review"]}/${counts.total} Answered (Max Marks: ${sec.maxMarks})"
                  >
                    <span>${isLocked ? "🔒 " : ""}${sec.name}</span>
                    <span class="inline-flex items-center justify-center px-1.5 py-0.2 rounded-full text-[10px] ${
                      isActive ? "bg-blue-900 text-sky-200" : "bg-slate-200 text-slate-700"
                    }">${counts.answered + counts["ans-review"]}/${counts.total}</span>
                  </button>
                `;
              })
              .join("")}
            ${
              exam.sectionalTiming && s.activeSectionIndex < s.sections.length - 1
                ? `<button type="button" onclick="window.ECSApp.openModal('section_submit')" class="ml-1 px-2.5 py-1 rounded bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 text-[11px] font-bold shrink-0" title="Finish current timed section early and unlock next section">
                    ⏭️ Submit Section
                  </button>`
                : ""
            }
          </div>

          <!-- Right Countdown Clock & Mobile Palette Trigger -->
          <div class="flex items-center gap-2 ml-auto">
            <div class="flex items-center gap-1.5 bg-slate-900 text-white px-2.5 py-1 rounded shadow-inner">
              <span class="text-[11px] text-slate-300 font-medium">${exam.sectionalTiming ? "Section Time Left:" : "Time Left:"}</span>
              <span id="ecs-live-timer-display" class="font-mono font-extrabold text-sm sm:text-base text-amber-400">
                ${formatSecondsMMSS(displaySecs)}
              </span>
            </div>
            <button
              type="button"
              onclick="window.ECSApp.toggleMobilePalette()"
              class="lg:hidden px-2.5 py-1.5 rounded bg-blue-600 text-white text-xs font-bold flex items-center gap-1 shadow"
            >
              <span>🔢 Palette (${sectionCounts.answered + sectionCounts["ans-review"]}/${sectionCounts.total})</span>
            </button>
          </div>
        </div>

        <!-- Main Workspace + Right Question Palette Split -->
        <div class="flex-1 flex overflow-hidden relative">
          <!-- Left Question Area -->
          <div class="flex-1 flex flex-col h-full overflow-hidden">
            <!-- Question Metadata Sub-Bar -->
            <div class="bg-white ecs-surface border-b border-slate-300 px-4 py-2 flex flex-wrap items-center justify-between gap-2 shrink-0">
              <div class="flex items-center gap-2.5 flex-wrap">
                <span class="font-extrabold text-sm sm:text-base text-blue-900 dark:text-sky-300">
                  Question No. ${activeQ.sectionQuestionNumber} <span class="text-xs font-normal text-slate-500">of ${activeSec.questions.length}</span>
                </span>
                <span class="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-300 font-semibold">
                  ${activeQ.isTita ? "Type In The Answer (TITA)" : `MCQ (${exam.optionsCount} Options)`}
                </span>
                <span class="text-xs text-slate-500 hidden sm:inline">Topic: <strong>${activeQ.topic}</strong></span>
                <span class="text-[11px] px-2 py-0.5 rounded bg-sky-50 text-sky-800 border border-sky-200 hidden md:inline">
                  ⚡ ${activeQ.source}
                </span>
              </div>

              <div class="flex items-center gap-3 flex-wrap text-xs">
                <div class="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1 rounded border border-slate-200">
                  <span class="text-slate-500">Marks:</span>
                  <span class="font-bold text-emerald-700">+${activeQ.positiveMarks}</span>
                  <span class="text-slate-400">|</span>
                  <span class="font-bold text-rose-600">-${activeQ.negativeMarks}</span>
                </div>
                <div class="flex items-center gap-1 text-slate-600 font-mono">
                  <span>⏱️ Q-Time:</span>
                  <span id="ecs-question-timer-display" class="font-bold">${formatSecondsMMSS(activeQ.timeSpentSeconds)}</span>
                </div>
                <div class="flex items-center gap-1">
                  <span class="text-slate-500 hidden sm:inline">View In:</span>
                  <select
                    aria-label="Question Language"
                    onchange="window.ECSApp.setDefaultLanguage(this.value)"
                    class="border border-slate-300 rounded px-2 py-1 text-xs font-bold bg-white text-slate-800"
                  >
                    <option value="en" ${AppState.defaultLanguage === "en" ? "selected" : ""}>English</option>
                    <option value="hi" ${AppState.defaultLanguage === "hi" ? "selected" : ""}>हिन्दी (Hindi)</option>
                    <option value="bilingual" ${AppState.defaultLanguage === "bilingual" ? "selected" : ""}>Bilingual</option>
                  </select>
                </div>
                <button
                  type="button"
                  onclick="window.ECSApp.toggleBookmarkCurrentQuestion()"
                  class="px-2 py-1 rounded border text-xs font-semibold transition ${
                    activeQ.bookmarked
                      ? "bg-amber-100 border-amber-400 text-amber-900"
                      : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50"
                  }"
                  title="Bookmark Question for Revision"
                >
                  ${activeQ.bookmarked ? "★ Bookmarked" : "☆ Bookmark"}
                </button>
              </div>
            </div>

            <!-- Question Body -->
            <div class="flex-1 overflow-y-auto ecs-scroll p-4 sm:p-6 question-content-area cbt-watermark-bg">
              <div class="${
                activeQ.passageEn
                  ? "grid grid-cols-1 lg:grid-cols-12 gap-6 items-start"
                  : "max-w-4xl space-y-5"
              }">
                ${
                  activeQ.passageEn
                    ? `
                    <div class="lg:col-span-6 bg-slate-50 ecs-subsurface p-4 rounded-xl border border-slate-300 space-y-3">
                      <div class="text-xs font-bold uppercase tracking-wider text-blue-800 border-b border-slate-200 pb-1.5">
                        📊 Reference Data / Passage Set
                      </div>
                      ${
                        AppState.defaultLanguage === "en" || AppState.defaultLanguage === "bilingual"
                          ? `<div class="text-slate-800 dark:text-slate-100 leading-relaxed">${activeQ.passageEn}</div>`
                          : ""
                      }
                      ${
                        (AppState.defaultLanguage === "hi" || AppState.defaultLanguage === "bilingual") && activeQ.passageHi
                          ? `<div class="text-slate-700 dark:text-slate-200 leading-relaxed pt-2 border-t border-slate-200">${activeQ.passageHi}</div>`
                          : ""
                      }
                    </div>
                  `
                    : ""
                }

                <div class="${activeQ.passageEn ? "lg:col-span-6 space-y-5" : "space-y-5"}">
                  <div class="p-4 rounded-xl bg-slate-50/70 ecs-subsurface border border-slate-200 space-y-2.5">
                    ${
                      AppState.defaultLanguage === "en" || AppState.defaultLanguage === "bilingual"
                        ? `<div class="font-medium text-slate-900 dark:text-white leading-relaxed">${activeQ.questionEn}</div>`
                        : ""
                    }
                    ${
                      AppState.defaultLanguage === "hi" || AppState.defaultLanguage === "bilingual"
                        ? `<div class="font-medium text-slate-800 dark:text-slate-200 leading-relaxed ${
                            AppState.defaultLanguage === "bilingual" ? "pt-2 border-t border-slate-200 text-slate-700" : ""
                          }">${activeQ.questionHi}</div>`
                        : ""
                    }
                  </div>

                  ${
                    activeQ.isTita
                      ? renderTitaKeypadInput(activeQ)
                      : `
                      <div class="space-y-2.5" role="radiogroup" aria-label="Question Options">
                        ${activeQ.optionsEn
                          .slice(0, exam.optionsCount)
                          .map((optEn, optIdx) => {
                            const optHi = activeQ.optionsHi[optIdx] || optEn;
                            const isSelected = activeQ.selectedOption === optIdx;
                            return `
                              <div
                                onclick="window.ECSApp.selectOption(${optIdx})"
                                class="cbt-option-row cursor-pointer rounded-xl border p-3.5 flex items-start gap-3.5 ${
                                  isSelected ? "selected-option" : "border-slate-300 bg-white"
                                }"
                              >
                                <div class="flex items-center gap-2.5 pt-0.5 shrink-0">
                                  <input
                                    type="radio"
                                    name="ecs-mcq-option"
                                    ${isSelected ? "checked" : ""}
                                    onchange="window.ECSApp.selectOption(${optIdx})"
                                    class="w-4 h-4 accent-blue-600 cursor-pointer"
                                  />
                                  <span class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-extrabold ${
                                    isSelected
                                      ? "bg-blue-600 text-white"
                                      : "bg-slate-100 text-slate-700 border border-slate-300"
                                  }">
                                    ${optionLetters[optIdx]}
                                  </span>
                                </div>
                                <div class="flex-1 text-slate-900 dark:text-slate-100">
                                  ${
                                    AppState.defaultLanguage === "en" || AppState.defaultLanguage === "bilingual"
                                      ? `<div class="font-medium">${optEn}</div>`
                                      : ""
                                  }
                                  ${
                                    (AppState.defaultLanguage === "hi" || AppState.defaultLanguage === "bilingual") &&
                                    (AppState.defaultLanguage === "hi" || optHi !== optEn)
                                      ? `<div class="text-slate-600 dark:text-slate-300 text-sm mt-0.5">${optHi}</div>`
                                      : ""
                                  }
                                </div>
                              </div>
                            `;
                          })
                          .join("")}
                      </div>
                    `
                  }
                </div>
              </div>
            </div>

            <!-- TCS iON Bottom Action Bar -->
            <div class="bg-slate-100 ecs-subsurface border-t border-slate-300 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 shrink-0">
              <div class="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onclick="window.ECSApp.handleMarkForReviewAndNext()"
                  class="px-3.5 py-2 rounded border border-purple-300 bg-purple-50 hover:bg-purple-100 text-purple-900 text-xs sm:text-sm font-bold transition shadow-sm"
                >
                  🟣 Mark for Review & Next
                </button>
                <button
                  type="button"
                  onclick="window.ECSApp.handleClearResponse()"
                  class="px-3.5 py-2 rounded border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs sm:text-sm font-semibold transition"
                >
                  Clear Response
                </button>
              </div>

              <div class="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onclick="window.ECSApp.navigateRelative(-1)"
                  ${s.activeQuestionIndex === 0 ? "disabled" : ""}
                  class="px-3.5 py-2 rounded border text-xs sm:text-sm font-semibold transition ${
                    s.activeQuestionIndex === 0
                      ? "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
                      : "border-slate-300 bg-white hover:bg-slate-100 text-slate-800"
                  }"
                >
                  &lt; Previous
                </button>
                <button
                  type="button"
                  onclick="window.ECSApp.handleSaveAndNext()"
                  class="px-5 py-2 rounded bg-[#16a34a] hover:bg-green-700 text-white text-xs sm:text-sm font-extrabold shadow transition"
                >
                  Save & Next &gt;
                </button>
              </div>
            </div>
          </div>

          <!-- Collapse/Expand Handle on Desktop -->
          <button
            type="button"
            onclick="window.ECSApp.toggleDesktopSidebar()"
            class="hidden lg:flex items-center justify-center w-4 bg-slate-300 hover:bg-blue-500 hover:text-white text-slate-700 font-bold text-xs border-l border-slate-400 transition shrink-0"
            title="Collapse / Expand Question Palette"
          >
            ${AppState.sidebarCollapsed ? "◀" : "▶"}
          </button>

          <!-- Right Side TCS iON Candidate & Question Palette Panel -->
          <aside class="${
            AppState.mobilePaletteOpen
              ? "fixed inset-y-0 right-0 z-50 w-80 max-w-[90vw] flex"
              : AppState.sidebarCollapsed
              ? "hidden"
              : "hidden lg:flex w-80"
          } flex-col bg-[#eef5fc] ecs-subsurface border-l border-slate-300 h-full shrink-0 shadow-xl lg:shadow-none">
            <div class="p-3 bg-white ecs-surface border-b border-slate-300 flex items-center justify-between gap-2.5 shrink-0">
              <div class="flex items-center gap-2.5 min-w-0">
                <div class="w-11 h-11 rounded-lg border border-slate-300 overflow-hidden shrink-0">
                  ${renderCandidateAvatarSVG(s.candidate)}
                </div>
                <div class="min-w-0">
                  <div class="font-extrabold text-xs sm:text-sm text-slate-900 dark:text-white truncate">${s.candidate.name}</div>
                  <div class="text-[11px] font-mono text-slate-600 dark:text-slate-300">Roll: ${s.candidate.rollNo}</div>
                  <button type="button" onclick="window.ECSApp.openModal('profile')" class="text-[10px] text-blue-600 hover:underline font-semibold">View Profile</button>
                </div>
              </div>
              <button
                type="button"
                onclick="window.ECSApp.toggleMobilePalette()"
                class="lg:hidden px-2 py-1 rounded bg-slate-200 text-slate-800 text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <!-- 5-State Live Legend Counter Box -->
            <div class="p-3 bg-white ecs-surface border-b border-slate-300 grid grid-cols-2 gap-2 text-[11px] shrink-0">
              <div class="flex items-center gap-2">
                <span class="tcs-badge state-answered">${sectionCounts.answered}</span>
                <span class="font-medium leading-tight">Answered</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="tcs-badge state-not-answered">${sectionCounts["not-answered"]}</span>
                <span class="font-medium leading-tight">Not Answered</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="tcs-badge state-not-visited">${sectionCounts["not-visited"]}</span>
                <span class="font-medium leading-tight">Not Visited</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="tcs-badge state-review">${sectionCounts.review}</span>
                <span class="font-medium leading-tight">Marked for Review</span>
              </div>
              <div class="col-span-2 flex items-center gap-2 pt-1 border-t border-slate-100">
                <span class="tcs-badge state-ans-review">${sectionCounts["ans-review"]}</span>
                <span class="font-medium leading-tight">Answered & Marked for Review <span class="text-emerald-700 font-bold">(Will be evaluated)</span></span>
              </div>
            </div>

            <!-- Section Palette Banner & Filter Pills -->
            <div class="bg-[#2563eb] text-white px-3 py-1.5 text-xs font-bold flex items-center justify-between shrink-0">
              <span class="truncate">${activeSec.name}</span>
              <span class="text-[10px] bg-blue-900 px-1.5 py-0.5 rounded">${activeSec.questions.length} Qs • ${activeSec.maxMarks}M</span>
            </div>

            <div class="px-3 py-1.5 bg-slate-200/70 border-b border-slate-300 flex items-center gap-1 text-[10px] font-bold shrink-0">
              ${[
                { id: "all", label: `All (${activeSec.questions.length})` },
                { id: "answered", label: "Answered" },
                { id: "not_answered", label: "Unanswered" },
                { id: "review", label: "Review" }
              ]
                .map(
                  (f) => `
                <button
                  type="button"
                  onclick="window.ECSApp.setPaletteFilter('${f.id}')"
                  class="px-2 py-0.5 rounded transition ${
                    AppState.paletteFilter === f.id
                      ? "bg-blue-700 text-white"
                      : "bg-white text-slate-700 hover:bg-slate-100"
                  }"
                >${f.label}</button>
              `
                )
                .join("")}
            </div>

            <!-- Question Number Grid (Scrolls smoothly for 30, 40, 50, 60 questions) -->
            <div class="flex-1 overflow-y-auto ecs-scroll p-3">
              <div class="grid grid-cols-5 gap-2.5 justify-items-center">
                ${filteredQuestions
                  .map((q) => {
                    const idx = q.sectionQuestionNumber - 1;
                    const isCurrent = idx === s.activeQuestionIndex;
                    return `
                      <button
                        type="button"
                        onclick="window.ECSApp.navigateToQuestion(${idx})"
                        class="tcs-badge state-${q.status} ${isCurrent ? "active-question" : ""}"
                        title="Question ${q.sectionQuestionNumber} (+${q.positiveMarks}/-${q.negativeMarks})"
                      >
                        ${q.sectionQuestionNumber}
                      </button>
                    `;
                  })
                  .join("")}
              </div>
            </div>

            <!-- Submit Exam Button Footer -->
            <div class="p-3 bg-slate-200 ecs-subsurface border-t border-slate-300 shrink-0">
              <button
                type="button"
                onclick="window.ECSApp.openSubmissionConfirmation()"
                class="w-full py-2.5 px-4 rounded-lg bg-[#0284c7] hover:bg-sky-700 text-white font-extrabold text-sm shadow-md transition"
              >
                Submit Exam
              </button>
            </div>
          </aside>
        </div>

        ${renderActiveConsoleModal()}
      </div>
    `;
  }

  function renderTitaKeypadInput(activeQ) {
    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", ".", "-"];
    return `
      <div class="max-w-sm bg-slate-100 ecs-subsurface p-4 rounded-xl border border-slate-300 space-y-3">
        <div class="text-xs font-bold uppercase tracking-wider text-blue-800">
          🔢 Type In The Answer (TITA — No Negative Marking)
        </div>
        <input
          type="text"
          readonly
          value="${activeQ.titaInput || ""}"
          placeholder="Use keypad below..."
          class="w-full px-3 py-2 rounded-lg bg-white border-2 border-blue-500 font-mono font-extrabold text-lg text-slate-900"
        />
        <div class="grid grid-cols-3 gap-2">
          ${keys
            .map(
              (k) => `
            <button
              type="button"
              onclick="window.ECSApp.pressTitaKey('${k}')"
              class="py-2 rounded-lg bg-white hover:bg-blue-50 border border-slate-300 font-mono font-bold text-base text-slate-900 shadow-sm"
            >${k}</button>
          `
            )
            .join("")}
          <button
            type="button"
            onclick="window.ECSApp.pressTitaKey('BACKSPACE')"
            class="col-span-2 py-2 rounded-lg bg-amber-100 hover:bg-amber-200 border border-amber-300 font-bold text-xs text-amber-900"
          >⌫ Backspace</button>
          <button
            type="button"
            onclick="window.ECSApp.pressTitaKey('CLEAR')"
            class="py-2 rounded-lg bg-rose-100 hover:bg-rose-200 border border-rose-300 font-bold text-xs text-rose-900"
          >Clear</button>
        </div>
      </div>
    `;
  }

  function renderActiveConsoleModal() {
    if (!AppState.activeModal || !AppState.session) return "";
    const s = AppState.session;
    const activeSec = s.sections[s.activeSectionIndex];

    if (AppState.activeModal === "question_paper") {
      return `
        <div class="fixed inset-0 z-50 bg-slate-950/70 flex items-center justify-center p-4">
          <div class="bg-white text-slate-900 rounded-xl shadow-2xl max-w-4xl w-full max-h-[85vh] flex flex-col overflow-hidden">
            <div class="bg-[#0c2340] text-white px-5 py-3 flex items-center justify-between">
              <h3 class="font-bold text-sm sm:text-base">📄 Complete Section Question Paper — ${activeSec.name} (${activeSec.questions.length} Qs)</h3>
              <button type="button" onclick="window.ECSApp.closeModal()" class="text-slate-300 hover:text-white font-bold">✕ Close</button>
            </div>
            <div class="p-5 overflow-y-auto ecs-scroll space-y-4 text-xs sm:text-sm">
              ${activeSec.questions
                .map(
                  (q) => `
                <div class="p-3.5 rounded-lg border border-slate-200 bg-slate-50 space-y-2">
                  <div class="flex items-center justify-between">
                    <span class="font-extrabold text-blue-900">Q.${q.sectionQuestionNumber} (${q.topic} • +${q.positiveMarks}/-${q.negativeMarks})</span>
                    <button type="button" onclick="window.ECSApp.navigateToQuestion(${q.sectionQuestionNumber - 1}); window.ECSApp.closeModal();" class="text-xs px-2.5 py-1 rounded bg-blue-600 text-white font-semibold">Jump to Q.${q.sectionQuestionNumber}</button>
                  </div>
                  <div class="text-slate-800">${q.questionEn}</div>
                </div>
              `
                )
                .join("")}
            </div>
          </div>
        </div>
      `;
    }

    if (AppState.activeModal === "instructions") {
      return `
        <div class="fixed inset-0 z-50 bg-slate-950/70 flex items-center justify-center p-4">
          <div class="bg-white text-slate-900 rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col overflow-hidden">
            <div class="bg-[#0c2340] text-white px-5 py-3 flex items-center justify-between">
              <h3 class="font-bold text-sm sm:text-base">ℹ️ ECS iON Exam Instructions & Marking Summary</h3>
              <button type="button" onclick="window.ECSApp.closeModal()" class="text-slate-300 hover:text-white font-bold">✕ Close</button>
            </div>
            <div class="p-5 overflow-y-auto space-y-3 text-xs sm:text-sm text-slate-700">
              <p><strong>Exam:</strong> ${s.examConfig.title} (${s.examConfig.optionsCount} Options • ${getExamTotalQuestions(s.examConfig)} Questions • ${getExamTotalMaxMarks(s.examConfig)} Max Marks)</p>
              <p><strong>Marking Scheme:</strong> ${s.examConfig.markingNote || `+${s.examConfig.positiveMarks} for correct response, -${s.examConfig.negativeMarks} for incorrect response`}.</p>
              <p><strong>Important TCS iON Rule:</strong> Questions marked as <em>"Answered and Marked for Review"</em> (purple circle with green checkmark) <strong>WILL be evaluated</strong> during final scoring.</p>
            </div>
          </div>
        </div>
      `;
    }

    if (AppState.activeModal === "profile") {
      return `
        <div class="fixed inset-0 z-50 bg-slate-950/70 flex items-center justify-center p-4">
          <div class="bg-white text-slate-900 rounded-xl shadow-2xl max-w-md w-full overflow-hidden">
            <div class="bg-[#0c2340] text-white px-5 py-3 flex items-center justify-between">
              <h3 class="font-bold text-sm">👤 Candidate Biometric Profile</h3>
              <button type="button" onclick="window.ECSApp.closeModal()" class="text-slate-300 hover:text-white font-bold">✕</button>
            </div>
            <div class="p-5 flex items-center gap-4">
              <div class="w-20 h-20 rounded-xl border-2 border-blue-600 overflow-hidden shrink-0">
                ${renderCandidateAvatarSVG(s.candidate)}
              </div>
              <div class="text-xs space-y-1">
                <div class="text-base font-extrabold text-slate-900">${s.candidate.name}</div>
                <div><strong>Roll No:</strong> ${s.candidate.rollNo}</div>
                <div><strong>DOB:</strong> ${s.candidate.dob}</div>
                <div><strong>Category:</strong> ${s.candidate.category}</div>
                <div><strong>System ID:</strong> ${s.candidate.systemNo}</div>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    if (AppState.activeModal === "section_submit") {
      return `
        <div class="fixed inset-0 z-50 bg-slate-950/70 flex items-center justify-center p-4">
          <div class="bg-white text-slate-900 rounded-xl shadow-2xl max-w-md w-full overflow-hidden">
            <div class="bg-amber-600 text-white px-5 py-3 flex items-center justify-between">
              <h3 class="font-bold text-sm">⏭️ Submit Current Section & Proceed?</h3>
              <button type="button" onclick="window.ECSApp.closeModal()" class="text-white font-bold">✕</button>
            </div>
            <div class="p-5 space-y-4 text-xs sm:text-sm text-slate-700">
              <p>Sectional timing is active for this exam. Once you submit <strong>${activeSec.name}</strong> and move to the next section, you will not be able to return to this section.</p>
              <div class="flex justify-end gap-2">
                <button type="button" onclick="window.ECSApp.closeModal()" class="px-4 py-2 rounded border border-slate-300 font-semibold">Cancel</button>
                <button type="button" onclick="window.ECSApp.confirmCompleteCurrentSection()" class="px-4 py-2 rounded bg-blue-600 text-white font-bold">Yes, Proceed to Next Section →</button>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    if (AppState.activeModal === "calculator") {
      return renderScientificCalculatorModal();
    }

    return "";
  }

  function renderScientificCalculatorModal() {
    const sciButtons = [
      ["sin", "cos", "tan", "√", "x²"],
      ["log", "ln", "(", ")", "1/x"],
      ["7", "8", "9", "/", "C"],
      ["4", "5", "6", "*", "⌫"],
      ["1", "2", "3", "-", "π"],
      ["0", ".", "e", "+", "="]
    ];
    return `
      <div class="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
        <div class="bg-slate-800 text-white rounded-xl shadow-2xl border border-slate-600 w-80 overflow-hidden">
          <div class="bg-[#0c2340] px-4 py-2.5 flex items-center justify-between border-b border-slate-700">
            <span class="text-xs font-bold tracking-wide">🧮 ECS iON Scientific Calculator</span>
            <button type="button" onclick="window.ECSApp.closeModal()" class="text-slate-300 hover:text-white font-bold text-xs">✕</button>
          </div>
          <div class="p-3 space-y-2.5">
            <div class="bg-slate-950 p-2.5 rounded-lg border border-slate-700 text-right font-mono">
              <div class="text-[11px] text-slate-400 h-4 truncate">${AppState.calcExpression || " "}</div>
              <div class="text-xl font-extrabold text-emerald-400 truncate">${AppState.calcDisplay}</div>
            </div>
            <div class="grid grid-cols-5 gap-1.5">
              ${sciButtons
                .flat()
                .map(
                  (btn) => `
                <button
                  type="button"
                  onclick="window.ECSApp.handleCalculatorKey('${btn}')"
                  class="calc-btn py-2 rounded font-mono font-bold text-xs ${
                    btn === "="
                      ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                      : btn === "C" || btn === "⌫"
                      ? "bg-rose-600 hover:bg-rose-500 text-white"
                      : ["+", "-", "*", "/"].includes(btn)
                      ? "bg-blue-600 hover:bg-blue-500 text-white"
                      : "bg-slate-700 hover:bg-slate-600 text-slate-100"
                  }"
                >${btn}</button>
              `
                )
                .join("")}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ============================================================================
  // 5. EXAM SUBMISSION CONFIRMATION SUMMARY TABLE
  // ============================================================================
  function renderSubmissionConfirmationScreen() {
    const s = AppState.session;
    if (!s) return "";

    return `
      <div class="min-h-[calc(100vh-56px)] bg-slate-100 py-8 px-4 flex items-center justify-center">
        <div class="max-w-4xl w-full bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
          <div class="bg-[#0c2340] text-white px-6 py-4 flex items-center justify-between">
            <div>
              <h2 class="text-base sm:text-lg font-extrabold">Exam Summary — Confirm Final Submission</h2>
              <p class="text-xs text-slate-300">Candidate: ${s.candidate.name} (${s.candidate.rollNo}) • ${s.examConfig.title}</p>
            </div>
            <span class="font-mono text-sm bg-amber-500 text-slate-950 font-black px-3 py-1 rounded">
              Time Left: ${formatSecondsMMSS(s.totalRemainingSeconds)}
            </span>
          </div>

          <div class="p-6 space-y-5">
            <div class="overflow-x-auto">
              <table class="w-full border-collapse border border-slate-300 text-xs sm:text-sm">
                <thead>
                  <tr class="bg-slate-800 text-white">
                    <th class="border border-slate-600 p-2.5 text-left">Section Name</th>
                    <th class="border border-slate-600 p-2.5 text-center">No. of Questions</th>
                    <th class="border border-slate-600 p-2.5 text-center">Answered</th>
                    <th class="border border-slate-600 p-2.5 text-center">Not Answered</th>
                    <th class="border border-slate-600 p-2.5 text-center">Marked for Review</th>
                    <th class="border border-slate-600 p-2.5 text-center">Answered & Marked for Review</th>
                    <th class="border border-slate-600 p-2.5 text-center">Not Visited</th>
                  </tr>
                </thead>
                <tbody>
                  ${s.sections
                    .map((sec) => {
                      const c = getQuestionStateCounts(sec.questions);
                      return `
                        <tr class="odd:bg-white even:bg-slate-50">
                          <td class="border border-slate-300 p-2.5 font-bold text-slate-900">${sec.name}</td>
                          <td class="border border-slate-300 p-2.5 text-center font-mono font-bold">${c.total}</td>
                          <td class="border border-slate-300 p-2.5 text-center font-mono text-emerald-700 font-bold">${c.answered}</td>
                          <td class="border border-slate-300 p-2.5 text-center font-mono text-rose-600 font-bold">${c["not-answered"]}</td>
                          <td class="border border-slate-300 p-2.5 text-center font-mono text-purple-700 font-bold">${c.review}</td>
                          <td class="border border-slate-300 p-2.5 text-center font-mono text-indigo-700 font-bold">${c["ans-review"]}</td>
                          <td class="border border-slate-300 p-2.5 text-center font-mono text-slate-500">${c["not-visited"]}</td>
                        </tr>
                      `;
                    })
                    .join("")}
                </tbody>
              </table>
            </div>

            <div class="bg-amber-50 border border-amber-300 rounded-xl p-4 text-xs sm:text-sm text-amber-950">
              <strong>Are you sure you want to submit this exam group?</strong> Once submitted, you will not be able to modify your answers, and you will proceed to the mandatory <strong>ECS iON Candidate Feedback Form</strong> before exiting the test screen.
            </div>

            <div class="flex flex-wrap items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onclick="window.ECSApp.returnToExamFromConfirm()"
                class="px-5 py-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 text-xs sm:text-sm font-bold"
              >
                ← No, Return to Test Console
              </button>
              <button
                type="button"
                onclick="window.ECSApp.confirmFinalSubmit()"
                class="px-6 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-extrabold shadow-md"
              >
                ✓ Yes, Submit Exam & Proceed to Feedback
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ============================================================================
  // 6. MANDATORY POST-EXAM CANDIDATE FEEDBACK FORM
  // ============================================================================
  function renderCandidateFeedbackForm() {
    const s = AppState.session;
    const candidate = s ? s.candidate : getCurrentCandidate();
    const exam = s ? s.examConfig : getActiveExam();

    const criteria = [
      { key: "hardware", label: "1. Terminal Hardware, Display Resolution & System Speed" },
      { key: "questions", label: "2. Batch API Question Loading Speed & Bilingual Clarity" },
      { key: "interface", label: "3. ECS iON Question Palette & Navigation Responsiveness" },
      { key: "instructions", label: "4. Pre-Exam Waiting Lobby & Instructions Clarity" }
    ];

    return `
      <div class="min-h-[calc(100vh-56px)] bg-slate-100 py-8 px-4 flex items-center justify-center">
        <div class="max-w-3xl w-full bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
          <div class="bg-gradient-to-r from-[#0c2340] to-[#1e3a8a] text-white px-6 py-4 flex items-center justify-between">
            <div>
              <span class="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 font-bold">Responses Recorded</span>
              <h2 class="text-base sm:text-lg font-extrabold mt-1">Mandatory Candidate Post-Examination Feedback</h2>
              <p class="text-xs text-slate-300">${candidate.name} (${candidate.rollNo}) • ${exam.title}</p>
            </div>
            <div class="text-right hidden sm:block">
              <div class="text-xs font-mono text-amber-300">${candidate.systemNo}</div>
              <div class="text-[11px] text-slate-300">Step: Feedback & Exit</div>
            </div>
          </div>

          <div class="p-6 space-y-5">
            <p class="text-xs sm:text-sm text-slate-600">
              Dear Candidate, your examination responses have been securely encrypted and locked. Please complete this brief feedback survey to exit the examination terminal and view your provisional scorecard.
            </p>

            <div class="space-y-3">
              ${criteria
                .map(
                  (item) => `
                <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <span class="text-xs sm:text-sm font-bold text-slate-800">${item.label}</span>
                  <div class="flex items-center gap-1.5">
                    ${[1, 2, 3, 4, 5]
                      .map(
                        (star) => `
                      <button
                        type="button"
                        onclick="window.ECSApp.setFeedbackRating('${item.key}', ${star})"
                        class="w-8 h-8 rounded-lg font-bold text-xs transition border ${
                          AppState.feedbackRatings[item.key] >= star
                            ? "bg-amber-400 border-amber-500 text-slate-950 shadow-sm"
                            : "bg-white border-slate-300 text-slate-400 hover:bg-slate-100"
                        }"
                      >★${star}</button>
                    `
                      )
                      .join("")}
                  </div>
                </div>
              `
                )
                .join("")}
            </div>

            <div>
              <label class="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1" for="ecs-feedback-comments">
                Additional Remarks / Exam Center Experience (Optional)
              </label>
              <textarea
                id="ecs-feedback-comments"
                rows="2"
                oninput="window.ECSApp.updateFeedbackComments(this.value)"
                placeholder="Share your feedback about the ECS iON CBT test experience..."
                class="w-full rounded-lg border border-slate-300 p-2.5 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
              >${AppState.feedbackComments}</textarea>
            </div>

            <div class="pt-2 flex items-center justify-end">
              <button
                type="button"
                onclick="window.ECSApp.submitFeedbackAndExit()"
                class="w-full sm:w-auto px-7 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-sm shadow-lg transition cursor-pointer"
              >
                Submit Feedback & Exit Test Screen →
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ============================================================================
  // 7. EXIT SCREEN, PROVISIONAL SCORECARD & ANSWER KEY REVIEW
  // ============================================================================
  function renderResultAndExitScreen() {
    const s = AppState.session;
    if (!s || !s.resultSummary) return "";
    const res = s.resultSummary;
    const passedCutoff = res.score >= res.cutoffTotal;

    return `
      <div class="min-h-[calc(100vh-56px)] bg-slate-100 py-6 px-4">
        <div class="max-w-6xl mx-auto space-y-6">
          <!-- Exit Banner & Top Actions -->
          <div class="bg-[#0c2340] text-white rounded-2xl p-5 shadow-lg flex flex-wrap items-center justify-between gap-4">
            <div class="flex items-center gap-4">
              <div class="w-16 h-16 rounded-xl border-2 border-amber-400 overflow-hidden shrink-0">
                ${renderCandidateAvatarSVG(s.candidate)}
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                    ✓ Test Completed & Feedback Submitted
                  </span>
                  <span class="text-xs font-mono text-amber-300">${res.attemptId}</span>
                </div>
                <h1 class="text-lg sm:text-xl font-black mt-1">${res.candidateName} — Provisional CBT Scorecard</h1>
                <p class="text-xs text-slate-300">${res.examTitle} • Roll No: ${res.rollNo} • System: ${s.candidate.systemNo}</p>
              </div>
            </div>

            <div class="flex items-center gap-2.5 flex-wrap no-print">
              <button
                type="button"
                onclick="window.print()"
                class="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-bold text-white"
              >
                🖨️ Print Scorecard
              </button>
              <button
                type="button"
                onclick="window.ECSApp.exitToTerminalForNextCandidate()"
                class="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs sm:text-sm font-extrabold shadow"
              >
                🔄 Exit to Terminal (Next Candidate Login)
              </button>
            </div>
          </div>

          ${
            res.matCompositeScore
              ? `
            <!-- MAT Special 200-800 Composite Score & Percentile Banner -->
            <div class="bg-gradient-to-r from-indigo-900 to-blue-900 text-white rounded-2xl p-5 shadow-md border border-indigo-700 flex flex-wrap items-center justify-between gap-4">
              <div>
                <span class="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-amber-400 text-slate-950 font-black">Official AIMA MAT Composite Scaling</span>
                <h2 class="text-base sm:text-lg font-extrabold mt-1">MAT Scaled Composite Score (200–800 Range) & Percentile</h2>
                <p class="text-xs text-indigo-200">Calculated primarily from the first four sections (Language Comprehension, Intelligence & Critical Reasoning, Data Analysis, Mathematical Skills).</p>
              </div>
              <div class="flex items-center gap-4">
                <div class="bg-slate-950/60 px-4 py-2.5 rounded-xl border border-indigo-500 text-center">
                  <div class="text-[10px] uppercase text-indigo-300 font-bold">Composite Score</div>
                  <div class="text-2xl font-black text-amber-400 font-mono">${res.matCompositeScore} <span class="text-xs text-slate-300">/ 800</span></div>
                </div>
                <div class="bg-slate-950/60 px-4 py-2.5 rounded-xl border border-emerald-500 text-center">
                  <div class="text-[10px] uppercase text-emerald-300 font-bold">MAT Percentile</div>
                  <div class="text-2xl font-black text-emerald-400 font-mono">${res.matPercentile}%ile</div>
                </div>
              </div>
            </div>
          `
              : ""
          }

          <!-- KPI Metric Cards -->
          <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <div class="text-[11px] font-bold uppercase text-slate-500">Total Score</div>
              <div class="text-2xl font-black text-blue-700 mt-1">${res.score} <span class="text-xs font-normal text-slate-500">/ ${res.maxScore}</span></div>
            </div>
            <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <div class="text-[11px] font-bold uppercase text-slate-500">Cutoff Status</div>
              <div class="text-base font-black mt-1.5 ${passedCutoff ? "text-emerald-600" : "text-amber-600"}">
                ${passedCutoff ? "✓ QUALIFIED" : `Cutoff: ${res.cutoffTotal}`}
              </div>
            </div>
            <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <div class="text-[11px] font-bold uppercase text-slate-500">Accuracy</div>
              <div class="text-2xl font-black text-emerald-600 mt-1">${res.accuracy}%</div>
            </div>
            <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <div class="text-[11px] font-bold uppercase text-slate-500">Correct / Wrong</div>
              <div class="text-xl font-black mt-1">
                <span class="text-emerald-600">${res.correctCount}</span> / <span class="text-rose-600">${res.wrongCount}</span>
              </div>
            </div>
            <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <div class="text-[11px] font-bold uppercase text-slate-500">Time Taken</div>
              <div class="text-xl font-black text-slate-800 font-mono mt-1">${formatSecondsMMSS(res.timeTakenSeconds)}</div>
            </div>
            <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <div class="text-[11px] font-bold uppercase text-slate-500">Feedback Rating</div>
              <div class="text-xl font-black text-amber-500 mt-1">★ ${res.feedbackRating} / 5.0</div>
            </div>
          </div>

          <!-- Section-Wise Performance Table -->
          <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
            <h2 class="text-sm font-extrabold uppercase tracking-wider text-slate-800">📊 Section-Wise Score Breakdown</h2>
            <div class="overflow-x-auto">
              <table class="w-full border-collapse border border-slate-300 text-xs sm:text-sm">
                <thead>
                  <tr class="bg-slate-800 text-white">
                    <th class="border border-slate-600 p-2.5 text-left">Section</th>
                    <th class="border border-slate-600 p-2.5 text-center">Total Qs</th>
                    <th class="border border-slate-600 p-2.5 text-center">Correct</th>
                    <th class="border border-slate-600 p-2.5 text-center">Wrong</th>
                    <th class="border border-slate-600 p-2.5 text-center">Unattempted</th>
                    <th class="border border-slate-600 p-2.5 text-center">Net Score</th>
                  </tr>
                </thead>
                <tbody>
                  ${res.sectionResults
                    .map(
                      (sec) => `
                    <tr class="odd:bg-white even:bg-slate-50">
                      <td class="border border-slate-300 p-2.5 font-bold">${sec.name}</td>
                      <td class="border border-slate-300 p-2.5 text-center font-mono">${sec.totalQuestions}</td>
                      <td class="border border-slate-300 p-2.5 text-center font-mono text-emerald-700 font-bold">${sec.correct}</td>
                      <td class="border border-slate-300 p-2.5 text-center font-mono text-rose-600 font-bold">${sec.wrong}</td>
                      <td class="border border-slate-300 p-2.5 text-center font-mono text-slate-500">${sec.unanswered}</td>
                      <td class="border border-slate-300 p-2.5 text-center font-mono font-extrabold text-blue-800">${sec.score} / ${sec.maxScore}</td>
                    </tr>
                  `
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
          </div>

          <!-- Question-by-Question Answer Key & Detailed Solutions -->
          <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
            <h2 class="text-sm font-extrabold uppercase tracking-wider text-slate-800">🔑 Official Answer Key & Question-Wise Explanations</h2>
            <div class="space-y-3 max-h-[520px] overflow-y-auto ecs-scroll pr-1">
              ${s.sections
                .map((sec) =>
                  sec.questions
                    .map((q) => {
                      const evaluated = (q.status === "answered" || q.status === "ans-review") && hasValidResponse(q);
                      const isCorrect = evaluated
                        ? q.isTita
                          ? String(q.titaInput).trim() === String(q.titaAnswer).trim()
                          : q.selectedOption === q.correctIndex
                        : false;
                      const optionLetters = ["A", "B", "C", "D", "E"];
                      const userAnsText = !evaluated
                        ? "Not Answered"
                        : q.isTita
                        ? q.titaInput
                        : `(${optionLetters[q.selectedOption]}) ${q.optionsEn[q.selectedOption]}`;
                      const correctAnsText = q.isTita
                        ? q.titaAnswer
                        : `(${optionLetters[q.correctIndex]}) ${q.optionsEn[q.correctIndex]}`;

                      return `
                        <div class="p-4 rounded-xl border ${
                          !evaluated
                            ? "border-slate-200 bg-slate-50"
                            : isCorrect
                            ? "border-emerald-300 bg-emerald-50/40"
                            : "border-rose-300 bg-rose-50/40"
                        } space-y-2 text-xs sm:text-sm">
                          <div class="flex flex-wrap items-center justify-between gap-2">
                            <span class="font-extrabold text-slate-900">[${sec.name}] Q.${q.sectionQuestionNumber} — ${q.topic}</span>
                            <span class="px-2.5 py-0.5 rounded font-bold text-xs ${
                              !evaluated
                                ? "bg-slate-200 text-slate-700"
                                : isCorrect
                                ? "bg-emerald-600 text-white"
                                : "bg-rose-600 text-white"
                            }">
                              ${!evaluated ? "Unattempted (0)" : isCorrect ? `✓ Correct (+${q.positiveMarks})` : `✕ Incorrect (-${q.negativeMarks})`}
                            </span>
                          </div>
                          <div class="text-slate-800">${q.questionEn}</div>
                          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-xs">
                            <div class="p-2 rounded bg-white border border-slate-200">
                              <span class="text-slate-500">Your Response:</span>
                              <strong class="ml-1 ${isCorrect ? "text-emerald-700" : "text-rose-700"}">${userAnsText}</strong>
                            </div>
                            <div class="p-2 rounded bg-white border border-slate-200">
                              <span class="text-slate-500">Official Answer:</span>
                              <strong class="ml-1 text-emerald-700">${correctAnsText}</strong>
                            </div>
                          </div>
                          <div class="text-xs text-slate-600 bg-white/80 p-2.5 rounded border border-slate-200">
                            <strong>Explanation:</strong> ${q.explanation}
                          </div>
                        </div>
                      `;
                    })
                    .join("")
                )
                .join("")}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ============================================================================
  // 8. ADMIN EXAM COMMAND CENTER (All 25 Formats, Filter by Sector, Custom Builder)
  // ============================================================================
  function renderAdminPortal() {
    const activeExam = getActiveExam();
    const allExams = Object.values(getAllExams());
    const sectors = ["ALL", "Banking", "Regional Rural Banks", "RBI / Central Bank", "Railways", "Railways Technical", "SSC / Govt", "Management"];
    const filteredExams =
      AppState.sectorFilter === "ALL"
        ? allExams
        : allExams.filter((ex) => (ex.sector || "Banking") === AppState.sectorFilter);

    return `
      <div class="min-h-[calc(100vh-56px)] bg-slate-100 py-6 px-4">
        <div class="max-w-7xl mx-auto space-y-6">
          <!-- Admin Top Banner -->
          <div class="bg-gradient-to-r from-[#0c2340] to-[#1e3a8a] text-white rounded-2xl p-5 shadow-lg flex flex-wrap items-center justify-between gap-4">
            <div>
              <span class="text-[10px] uppercase tracking-wider px-2.5 py-0.5 rounded bg-amber-400 text-slate-950 font-black">ECS iON Controller Mode</span>
              <h1 class="text-lg sm:text-2xl font-black mt-1">Admin Examination Format & Candidate Command Center (${allExams.length} Formats)</h1>
              <p class="text-xs text-slate-300">Includes all 25 official SBI, IBPS, RRB (Regional Rural Banks), RBI Assistant, Railway (NTPC Grad/UG, Group-D, Section Controller, Technician Signal), SSC (CGL, CHSL), CAT & MAT formats.</p>
            </div>
            <button
              type="button"
              onclick="window.ECSApp.switchMode('terminal')"
              class="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-xs sm:text-sm shadow-md transition"
            >
              🖥️ Launch Candidate Terminal with Active Exam →
            </button>
          </div>

          <!-- Admin Navigation Tabs -->
          <div class="flex flex-wrap gap-2 border-b border-slate-300 pb-2">
            ${[
              { id: "presets", label: `📚 All ${allExams.length} Official Exam Formats` },
              { id: "builder", label: "🛠️ Custom Exam & Marking Builder" },
              { id: "api_lab", label: "🌐 Question Batch API Configuration" },
              { id: "candidates", label: `👥 Candidate Roster (${AppState.candidates.length})` },
              { id: "analytics", label: `📈 Completed Attempts & Feedback (${AppState.attempts.length})` }
            ]
              .map(
                (tab) => `
              <button
                type="button"
                onclick="window.ECSApp.setAdminTab('${tab.id}')"
                class="px-4 py-2 rounded-lg text-xs sm:text-sm font-bold transition ${
                  AppState.adminTab === tab.id
                    ? "bg-[#0c2340] text-white shadow"
                    : "bg-white text-slate-700 hover:bg-slate-200 border border-slate-300"
                }"
              >${tab.label}</button>
            `
              )
              .join("")}
          </div>

          <!-- Tab 1: All 25 Exam Presets with Sector Filter -->
          ${
            AppState.adminTab === "presets"
              ? `
            <div class="space-y-4">
              <div class="flex flex-wrap items-center gap-1.5 bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
                <span class="text-xs font-extrabold uppercase text-slate-500 mr-2">Filter by Sector:</span>
                ${sectors
                  .map(
                    (sec) => `
                  <button
                    type="button"
                    onclick="window.ECSApp.setSectorFilter('${sec}')"
                    class="px-3 py-1 rounded-lg text-xs font-bold transition ${
                      AppState.sectorFilter === sec
                        ? "bg-blue-600 text-white shadow-sm"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }"
                  >${sec === "ALL" ? `All (${allExams.length})` : sec}</button>
                `
                  )
                  .join("")}
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                ${filteredExams
                  .map((ex) => {
                    const isSelected = ex.id === activeExam.id;
                    const totalQ = getExamTotalQuestions(ex);
                    const totalM = getExamTotalMaxMarks(ex);
                    return `
                      <div class="bg-white rounded-xl border-2 p-5 flex flex-col justify-between transition shadow-sm ${
                        isSelected ? "border-blue-600 ring-2 ring-blue-500/20" : "border-slate-200 hover:border-slate-300"
                      }">
                        <div class="space-y-3">
                          <div class="flex items-center justify-between gap-2 flex-wrap">
                            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${
                              ex.optionsCount === 5
                                ? "bg-purple-100 text-purple-900 border border-purple-300"
                                : "bg-sky-100 text-sky-900 border border-sky-300"
                            }">
                              ${ex.optionsCount} Options (${ex.optionsCount === 5 ? "A–E Banking" : "A–D Govt/Mgmt"})
                            </span>
                            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${
                              ex.difficulty === "undergraduate"
                                ? "bg-emerald-100 text-emerald-900"
                                : ex.difficulty === "mains"
                                ? "bg-rose-100 text-rose-900"
                                : "bg-amber-100 text-amber-900"
                            }">${ex.difficultyLabel || "Graduate"}</span>
                          </div>
                          <h3 class="font-extrabold text-sm sm:text-base text-slate-900">${ex.title}</h3>
                          <p class="text-xs text-slate-600 leading-relaxed">${ex.description}</p>
                          <div class="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-3 rounded-lg border border-slate-200">
                            <div><span class="text-slate-500 block text-[10px]">Total Qs / Max Marks</span><strong>${totalQ} Qs • ${totalM} Marks</strong></div>
                            <div><span class="text-slate-500 block text-[10px]">Sectional Timing</span><strong>${ex.sectionalTiming ? "YES (Locked)" : "NO (Composite)"}</strong></div>
                            <div><span class="text-slate-500 block text-[10px]">Duration</span><strong>${ex.totalDurationMinutes} Mins (${ex.sections.length} Secs)</strong></div>
                            <div><span class="text-slate-500 block text-[10px]">Marking</span><strong>+${ex.positiveMarks} / -${ex.negativeMarks}</strong></div>
                          </div>
                        </div>
                        <div class="pt-4 mt-4 border-t border-slate-200 flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onclick="window.ECSApp.selectExamPreset('${ex.id}')"
                            class="flex-1 py-2 px-3 rounded-lg font-bold text-xs transition ${
                              isSelected
                                ? "bg-emerald-600 text-white"
                                : "bg-blue-600 hover:bg-blue-700 text-white"
                            }"
                          >
                            ${isSelected ? "✓ Currently Active on Terminal" : "Activate This Exam Format"}
                          </button>
                        </div>
                      </div>
                    `;
                  })
                  .join("")}
              </div>
            </div>
          `
              : ""
          }

          <!-- Tab 2: Live Custom Exam & Marking Scheme Builder -->
          ${
            AppState.adminTab === "builder"
              ? `
            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
              <div class="border-b border-slate-200 pb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 class="text-base font-extrabold text-slate-900">🛠️ Customize Active Exam Parameters (${activeExam.title})</h2>
                  <p class="text-xs text-slate-500">Modify the active exam's option count (4 vs 5), sectional timing, marking scheme, or create a brand-new custom exam format.</p>
                </div>
                <span class="text-xs font-mono px-2.5 py-1 rounded bg-blue-50 text-blue-800 border border-blue-200">Editing: ${activeExam.id}</span>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs sm:text-sm">
                <div class="sm:col-span-2">
                  <label class="block text-xs font-bold uppercase text-slate-700 mb-1" for="adm-exam-title">Exam Title</label>
                  <input id="adm-exam-title" type="text" value="${activeExam.title}" class="w-full rounded-lg border border-slate-300 px-3 py-2 font-semibold" />
                </div>
                <div>
                  <label class="block text-xs font-bold uppercase text-slate-700 mb-1" for="adm-exam-options">Options per Question</label>
                  <select id="adm-exam-options" class="w-full rounded-lg border border-slate-300 px-3 py-2 font-bold bg-white">
                    <option value="5" ${activeExam.optionsCount === 5 ? "selected" : ""}>5 Options (A, B, C, D, E — Banking/SBI/IBPS/RBI)</option>
                    <option value="4" ${activeExam.optionsCount === 4 ? "selected" : ""}>4 Options (A, B, C, D — SSC/Railways/CAT/MAT)</option>
                  </select>
                </div>
                <div>
                  <label class="block text-xs font-bold uppercase text-slate-700 mb-1" for="adm-exam-sectional">Sectional Timing Mode</label>
                  <select id="adm-exam-sectional" class="w-full rounded-lg border border-slate-300 px-3 py-2 font-bold bg-white">
                    <option value="true" ${activeExam.sectionalTiming ? "selected" : ""}>ON — Strict Locked Sectional Timers</option>
                    <option value="false" ${!activeExam.sectionalTiming ? "selected" : ""}>OFF — Composite Timer (Free Section Switch)</option>
                  </select>
                </div>

                <div>
                  <label class="block text-xs font-bold uppercase text-slate-700 mb-1" for="adm-exam-pos">Positive Marks (+)</label>
                  <input id="adm-exam-pos" type="number" step="0.25" min="0.5" max="10" value="${activeExam.positiveMarks}" class="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono font-bold text-emerald-700" />
                </div>
                <div>
                  <label class="block text-xs font-bold uppercase text-slate-700 mb-1" for="adm-exam-neg">Negative Marks (-)</label>
                  <input id="adm-exam-neg" type="number" step="0.01" min="0" max="5" value="${activeExam.negativeMarks}" class="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono font-bold text-rose-600" />
                </div>
                <div>
                  <label class="block text-xs font-bold uppercase text-slate-700 mb-1" for="adm-exam-wait">Pre-Login Wait Timer (Sec)</label>
                  <input id="adm-exam-wait" type="number" min="0" max="300" value="${activeExam.waitingRoomSeconds}" class="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono font-bold" />
                </div>
                <div>
                  <label class="block text-xs font-bold uppercase text-slate-700 mb-1" for="adm-exam-calc">On-Screen Calculator</label>
                  <select id="adm-exam-calc" class="w-full rounded-lg border border-slate-300 px-3 py-2 font-bold bg-white">
                    <option value="none" ${activeExam.calculatorMode === "none" ? "selected" : ""}>Disabled (Standard Govt/Banking CBT)</option>
                    <option value="scientific" ${activeExam.calculatorMode === "scientific" ? "selected" : ""}>TCS iON Scientific Calculator (CAT/GATE)</option>
                    <option value="basic" ${activeExam.calculatorMode === "basic" ? "selected" : ""}>Basic Arithmetic Calculator</option>
                  </select>
                </div>
              </div>

              <div class="pt-3 flex flex-wrap gap-3">
                <button
                  type="button"
                  onclick="window.ECSApp.saveAdminExamChanges(false)"
                  class="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs sm:text-sm shadow"
                >
                  💾 Save Changes to Active Exam (${activeExam.id})
                </button>
                <button
                  type="button"
                  onclick="window.ECSApp.saveAdminExamChanges(true)"
                  class="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs sm:text-sm"
                >
                  ➕ Save as New Custom Exam Preset
                </button>
              </div>
            </div>
          `
              : ""
          }

          <!-- Tab 3: Question Batch API Lab -->
          ${
            AppState.adminTab === "api_lab"
              ? `
            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
              <h2 class="text-base font-extrabold text-slate-900">🌐 Single-Sitting Question Batch API Engine</h2>
              <p class="text-xs sm:text-sm text-slate-600">
                Choose how ECS iON populates questions across Numerical Ability, Reasoning Ability, General Science, Basic Science & Engineering, Computer Knowledge, Banking Awareness, and English/Hindi. Regardless of mode, <strong>100% of questions (up to 200 per sitting) are fetched in one batch before Question 1 renders</strong>.
              </p>

              <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                ${[
                  {
                    id: "hybrid",
                    title: "⚡ Hybrid Live API + Competitive Synthesizer (Recommended)",
                    desc: "Combines live REST API fetches from OpenTDB with ECS iON's bilingual Indian competitive exam bank and parametric question generator for 100% unique 80–200 question papers."
                  },
                  {
                    id: "live_opentdb",
                    title: "🌐 Prioritize Live OpenTDB REST API",
                    desc: "Prioritizes live external HTTP fetches from opentdb.com mapped by section category and difficulty, automatically synthesizing a 5th option when 5-option Banking mode is active."
                  },
                  {
                    id: "curated",
                    title: "🏛️ Verified Indian Competitive Bank Only",
                    desc: "Uses strictly authentic SBI/IBPS/SSC/RRB/CAT pattern questions with full Hindi & English bilingual translations and step-by-step solutions."
                  }
                ]
                  .map(
                    (m) => `
                  <div
                    onclick="window.ECSApp.setApiSourceMode('${m.id}')"
                    class="p-4 rounded-xl border-2 cursor-pointer transition ${
                      AppState.apiSourceMode === m.id
                        ? "border-blue-600 bg-blue-50/50"
                        : "border-slate-200 hover:border-slate-300"
                    }"
                  >
                    <div class="font-extrabold text-xs sm:text-sm text-slate-900">${m.title}</div>
                    <p class="text-xs text-slate-600 mt-1.5 leading-relaxed">${m.desc}</p>
                  </div>
                `
                  )
                  .join("")}
              </div>

              <div class="pt-2">
                <button
                  type="button"
                  onclick="window.ECSApp.testBatchApiInAdmin()"
                  class="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs sm:text-sm shadow"
                >
                  🚀 Test Upfront Batch API Load Now (${getExamTotalQuestions(activeExam)} Qs)
                </button>
              </div>

              ${
                AppState.apiLoadLogs.length > 0
                  ? `
                <div class="bg-slate-950 text-emerald-400 font-mono text-xs p-4 rounded-xl space-y-1">
                  ${AppState.apiLoadLogs.map((l) => `<div>[${l.time}] ${l.msg}</div>`).join("")}
                </div>
              `
                  : ""
              }
            </div>
          `
              : ""
          }

          <!-- Tab 4: Multi-Candidate Roster Management -->
          ${
            AppState.adminTab === "candidates"
              ? `
            <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div class="lg:col-span-5 bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3.5">
                <h2 class="text-sm font-extrabold uppercase tracking-wider text-slate-800">➕ Register New Candidate for Shift</h2>
                <div>
                  <label class="block text-xs font-bold text-slate-700 mb-1" for="new-cand-name">Full Name</label>
                  <input id="new-cand-name" type="text" placeholder="e.g. Siddharth Mukherjee" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs sm:text-sm" />
                </div>
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="block text-xs font-bold text-slate-700 mb-1" for="new-cand-roll">Roll Number</label>
                    <input id="new-cand-roll" type="text" value="24091004${85 + AppState.candidates.length}" class="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs sm:text-sm" />
                  </div>
                  <div>
                    <label class="block text-xs font-bold text-slate-700 mb-1" for="new-cand-pass">Password / DOB</label>
                    <input id="new-cand-pass" type="text" value="2000-05-12" class="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs sm:text-sm" />
                  </div>
                </div>
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="block text-xs font-bold text-slate-700 mb-1" for="new-cand-sys">Assigned System No.</label>
                    <input id="new-cand-sys" type="text" value="ECS-KOL-C0${30 + AppState.candidates.length}" class="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs sm:text-sm" />
                  </div>
                  <div>
                    <label class="block text-xs font-bold text-slate-700 mb-1" for="new-cand-cat">Category</label>
                    <select id="new-cand-cat" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs sm:text-sm bg-white">
                      <option value="UR (General)">UR (General)</option>
                      <option value="OBC-NCL">OBC-NCL</option>
                      <option value="EWS">EWS</option>
                      <option value="SC">SC</option>
                      <option value="ST">ST</option>
                    </select>
                  </div>
                </div>
                <button
                  type="button"
                  onclick="window.ECSApp.registerNewCandidate()"
                  class="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs sm:text-sm shadow"
                >
                  Register Candidate & Assign Terminal
                </button>
              </div>

              <div class="lg:col-span-7 bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
                <h2 class="text-sm font-extrabold uppercase tracking-wider text-slate-800">📋 Registered Candidate Roster</h2>
                <div class="overflow-x-auto">
                  <table class="w-full border-collapse border border-slate-300 text-xs">
                    <thead>
                      <tr class="bg-slate-800 text-white">
                        <th class="border border-slate-600 p-2 text-left">Roll No.</th>
                        <th class="border border-slate-600 p-2 text-left">Candidate Name</th>
                        <th class="border border-slate-600 p-2 text-left">Password</th>
                        <th class="border border-slate-600 p-2 text-left">System ID</th>
                        <th class="border border-slate-600 p-2 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${AppState.candidates
                        .map(
                          (c) => `
                        <tr class="odd:bg-white even:bg-slate-50">
                          <td class="border border-slate-300 p-2 font-mono font-bold">${c.rollNo}</td>
                          <td class="border border-slate-300 p-2 font-bold">${c.name} (${c.category})</td>
                          <td class="border border-slate-300 p-2 font-mono">${c.password}</td>
                          <td class="border border-slate-300 p-2 font-mono">${c.systemNo}</td>
                          <td class="border border-slate-300 p-2 text-center">
                            <button type="button" onclick="window.ECSApp.selectDemoCandidate('${c.rollNo}'); window.ECSApp.switchMode('terminal');" class="px-2.5 py-1 rounded bg-blue-600 text-white font-bold">Login as ${c.name.split(" ")[0]}</button>
                          </td>
                        </tr>
                      `
                        )
                        .join("")}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          `
              : ""
          }

          <!-- Tab 5: Completed Candidate Attempts & Post-Exam Feedback -->
          ${
            AppState.adminTab === "analytics"
              ? `
            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
              <h2 class="text-sm font-extrabold uppercase tracking-wider text-slate-800">📈 Multi-Candidate Attempt Leaderboard & Feedback Audit</h2>
              <div class="overflow-x-auto">
                <table class="w-full border-collapse border border-slate-300 text-xs sm:text-sm">
                  <thead>
                    <tr class="bg-slate-800 text-white">
                      <th class="border border-slate-600 p-2.5 text-left">Attempt ID</th>
                      <th class="border border-slate-600 p-2.5 text-left">Candidate (Roll No.)</th>
                      <th class="border border-slate-600 p-2.5 text-left">Examination</th>
                      <th class="border border-slate-600 p-2.5 text-center">Score</th>
                      <th class="border border-slate-600 p-2.5 text-center">Accuracy</th>
                      <th class="border border-slate-600 p-2.5 text-center">Feedback Rating</th>
                      <th class="border border-slate-600 p-2.5 text-left">Candidate Feedback Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${AppState.attempts
                      .map(
                        (a) => `
                      <tr class="odd:bg-white even:bg-slate-50">
                        <td class="border border-slate-300 p-2.5 font-mono font-bold">${a.attemptId}</td>
                        <td class="border border-slate-300 p-2.5 font-bold">${a.candidateName} <span class="font-mono text-xs text-slate-500">(${a.rollNo})</span></td>
                        <td class="border border-slate-300 p-2.5">${a.examTitle}</td>
                        <td class="border border-slate-300 p-2.5 text-center font-mono font-extrabold text-blue-700">${a.score} / ${a.maxScore}${a.matCompositeScore ? ` (MAT: ${a.matCompositeScore}/800)` : ""}</td>
                        <td class="border border-slate-300 p-2.5 text-center font-mono text-emerald-700 font-bold">${a.accuracy}%</td>
                        <td class="border border-slate-300 p-2.5 text-center font-bold text-amber-600">★ ${a.feedbackRating}</td>
                        <td class="border border-slate-300 p-2.5 text-xs text-slate-600">${a.feedbackComment}</td>
                      </tr>
                    `
                      )
                      .join("")}
                  </tbody>
                </table>
              </div>
            </div>
          `
              : ""
          }
        </div>
      </div>
    `;
  }

  // ============================================================================
  // Master Render Function
  // ============================================================================
  function renderApp() {
    const root = document.getElementById("ecs-app-root");
    if (!root) return;

    document.body.classList.toggle("ecs-dark-mode", AppState.darkMode);

    let mainView = "";
    switch (AppState.mode) {
      case "terminal":
        mainView = renderCandidateTerminal();
        break;
      case "instructions":
        mainView = renderInstructionsFlow();
        break;
      case "loading_api":
        mainView = renderApiBatchLoadingScreen();
        break;
      case "exam":
        mainView = renderExamConsole();
        break;
      case "submit_confirm":
        mainView = renderSubmissionConfirmationScreen();
        break;
      case "feedback":
        mainView = renderCandidateFeedbackForm();
        break;
      case "result":
        mainView = renderResultAndExitScreen();
        break;
      case "admin":
        mainView = renderAdminPortal();
        break;
      default:
        mainView = renderCandidateTerminal();
    }

    root.innerHTML = renderGlobalTopBar() + mainView;
  }

  // ============================================================================
  // Public Controller Actions (Exposed on window.ECSApp)
  // ============================================================================
  window.ECSApp = {
    init() {
      renderApp();
      startWaitingLobbyTimer();
    },

    switchMode(newMode) {
      AppState.mode = newMode;
      if (newMode === "terminal") {
        startWaitingLobbyTimer();
      }
      renderApp();
    },

    selectExamPreset(examId) {
      AppState.activeExamId = examId;
      Storage.set("ecs_active_exam_id", examId);
      startWaitingLobbyTimer();
      renderApp();
      const exam = getActiveExam();
      showToast(
        `Activated: ${exam.title} (${getExamTotalQuestions(exam)} Qs • ${exam.optionsCount} Options)`,
        "info"
      );
    },

    setSectorFilter(sector) {
      AppState.sectorFilter = sector;
      renderApp();
    },

    setOptionalLanguageChoice(choice) {
      AppState.optionalLanguageChoice = choice;
      renderApp();
    },

    skipWaitingTimer() {
      AppState.waitingSecondsLeft = 0;
      clearInterval(AppState.waitingTimerInterval);
      updateWaitingLobbyDOM();
      showToast("Invigilator override applied: Login Gate unlocked!", "success");
    },

    updateLoginInput(field, val) {
      AppState[field] = val;
    },

    setActiveKeyboardField(field) {
      AppState.activeKeyboardField = field;
    },

    toggleVirtualKeyboard(field) {
      if (field && AppState.activeKeyboardField !== field) {
        AppState.activeKeyboardField = field;
        AppState.virtualKeyboardOpen = true;
      } else {
        AppState.virtualKeyboardOpen = !AppState.virtualKeyboardOpen;
      }
      renderApp();
    },

    pressVirtualKey(key) {
      const f = AppState.activeKeyboardField || "loginRollInput";
      if (key === "CLEAR") {
        AppState[f] = "";
      } else if (key === "BACKSPACE") {
        AppState[f] = String(AppState[f] || "").slice(0, -1);
      } else {
        AppState[f] = String(AppState[f] || "") + key;
      }
      renderApp();
    },

    selectDemoCandidate(rollNo) {
      const cand = AppState.candidates.find((c) => c.rollNo === rollNo);
      if (cand) {
        AppState.selectedCandidateRoll = cand.rollNo;
        AppState.loginRollInput = cand.rollNo;
        AppState.loginPasswordInput = cand.password;
        renderApp();
        showToast(`Loaded credentials for ${cand.name} (${cand.rollNo})`, "info");
      }
    },

    handleCandidateLogin() {
      if (AppState.waitingSecondsLeft > 0) {
        showToast(`Please wait ${AppState.waitingSecondsLeft} seconds or click 'Skip Wait' to unlock.`, "warning");
        return;
      }
      const roll = AppState.loginRollInput.trim();
      const pass = AppState.loginPasswordInput.trim();
      if (!roll || !pass) {
        showToast("Please enter both Roll Number and Password to sign in.", "error");
        return;
      }

      let cand = AppState.candidates.find((c) => c.rollNo === roll);
      if (!cand) {
        cand = {
          rollNo: roll,
          password: pass,
          name: `Candidate #${roll.slice(-4)}`,
          category: "UR (General)",
          dob: pass,
          systemNo: "ECS-KOL-C099",
          labName: "Ion Digital Zone IDZ Central Lab",
          shift: "Shift-1",
          avatarHue: 195
        };
        AppState.candidates.push(cand);
        Storage.set("ecs_candidates", AppState.candidates);
      } else if (cand.password !== pass) {
        showToast(`Invalid password for Roll No. ${roll}. Expected: ${cand.password}`, "error");
        return;
      }

      AppState.instructionsPage = 1;
      AppState.declarationChecked = false;
      AppState.mode = "instructions";
      renderApp();
      showToast(`Signed in as ${cand.name}. Please read the exam instructions.`, "success");
    },

    setInstructionsPage(pageNum) {
      AppState.instructionsPage = pageNum;
      renderApp();
    },

    setDefaultLanguage(lang) {
      AppState.defaultLanguage = lang;
      renderApp();
    },

    toggleDeclaration(checked) {
      AppState.declarationChecked = Boolean(checked);
      renderApp();
    },

    async beginExamBatchLoad() {
      if (!AppState.declarationChecked) {
        showToast("Please check the mandatory Candidate Declaration box first.", "warning");
        return;
      }
      const exam = getActiveExam();
      const candidate = getCurrentCandidate();

      AppState.mode = "loading_api";
      renderApp();

      const assembledSections = await loadAllExamQuestionsBatch(exam, () => {
        const bar = document.getElementById("ecs-api-batch-bar");
        const logBox = document.getElementById("ecs-api-log-box");
        if (bar) bar.style.width = `${AppState.apiBatchProgress}%`;
        if (logBox) {
          logBox.innerHTML = AppState.apiLoadLogs.map((l) => `<div>[${l.time}] ${l.msg}</div>`).join("");
        }
      });

      const totalDurationSeconds = (parseInt(exam.totalDurationMinutes, 10) || 60) * 60;

      AppState.session = {
        examConfig: JSON.parse(JSON.stringify(exam)),
        candidate: JSON.parse(JSON.stringify(candidate)),
        sections: assembledSections,
        activeSectionIndex: 0,
        activeQuestionIndex: 0,
        totalRemainingSeconds: totalDurationSeconds,
        totalElapsedSeconds: 0,
        resultSummary: null
      };

      setTimeout(() => {
        AppState.mode = "exam";
        AppState.paletteFilter = "all";
        renderApp();
        startExamSessionTimer();
        showToast(
          `Loaded all ${assembledSections.reduce((a, s) => a + s.questions.length, 0)} questions in one batch (${AppState.lastApiLatencyMs} ms). Best of luck!`,
          "success"
        );
      }, 450);
    },

    switchSection(secIdx) {
      if (!AppState.session) return;
      const s = AppState.session;
      if (secIdx === s.activeSectionIndex) return;

      if (s.examConfig.sectionalTiming) {
        showToast(
          "Sectional timing is locked for this exam! Click '⏭️ Submit Section' if you want to finish this section early and move to the next.",
          "warning"
        );
        return;
      }

      s.activeSectionIndex = secIdx;
      s.activeQuestionIndex = 0;
      const firstQ = s.sections[secIdx].questions[0];
      if (firstQ && firstQ.status === "not-visited") {
        firstQ.status = "not-answered";
      }
      renderApp();
    },

    confirmCompleteCurrentSection() {
      if (!AppState.session) return;
      const s = AppState.session;
      const currentSec = s.sections[s.activeSectionIndex];
      currentSec.completed = true;
      currentSec.remainingSeconds = 0;
      AppState.activeModal = null;

      if (s.activeSectionIndex < s.sections.length - 1) {
        s.activeSectionIndex += 1;
        s.activeQuestionIndex = 0;
        const nextQ = s.sections[s.activeSectionIndex].questions[0];
        if (nextQ && nextQ.status === "not-visited") {
          nextQ.status = "not-answered";
        }
        showToast(`Unlocked section: ${s.sections[s.activeSectionIndex].name}`, "success");
        renderApp();
      } else {
        AppState.mode = "submit_confirm";
        renderApp();
      }
    },

    navigateToQuestion(qIdx) {
      navigateToQuestion(qIdx);
    },

    navigateRelative(delta) {
      if (!AppState.session) return;
      navigateToQuestion(AppState.session.activeQuestionIndex + delta);
    },

    selectOption(optIdx) {
      if (!AppState.session) return;
      const sec = AppState.session.sections[AppState.session.activeSectionIndex];
      const q = sec.questions[AppState.session.activeQuestionIndex];
      if (q.selectedOption === optIdx) {
        q.selectedOption = null;
      } else {
        q.selectedOption = optIdx;
      }
      renderApp();
    },

    pressTitaKey(key) {
      if (!AppState.session) return;
      const sec = AppState.session.sections[AppState.session.activeSectionIndex];
      const q = sec.questions[AppState.session.activeQuestionIndex];
      let val = String(q.titaInput || "");
      if (key === "CLEAR") {
        val = "";
      } else if (key === "BACKSPACE") {
        val = val.slice(0, -1);
      } else {
        val += key;
      }
      q.titaInput = val;
      renderApp();
    },

    handleSaveAndNext() {
      handleSaveAndNext();
    },

    handleMarkForReviewAndNext() {
      handleMarkForReviewAndNext();
    },

    handleClearResponse() {
      handleClearResponse();
    },

    toggleBookmarkCurrentQuestion() {
      if (!AppState.session) return;
      const sec = AppState.session.sections[AppState.session.activeSectionIndex];
      const q = sec.questions[AppState.session.activeQuestionIndex];
      q.bookmarked = !q.bookmarked;
      renderApp();
    },

    setPaletteFilter(filterId) {
      AppState.paletteFilter = filterId;
      renderApp();
    },

    toggleDesktopSidebar() {
      AppState.sidebarCollapsed = !AppState.sidebarCollapsed;
      renderApp();
    },

    toggleMobilePalette() {
      AppState.mobilePaletteOpen = !AppState.mobilePaletteOpen;
      renderApp();
    },

    adjustFontSize(delta) {
      if (delta === 0) {
        AppState.fontSizeScale = 100;
      } else {
        AppState.fontSizeScale = Math.min(135, Math.max(85, AppState.fontSizeScale + delta));
      }
      renderApp();
    },

    toggleDarkMode() {
      AppState.darkMode = !AppState.darkMode;
      renderApp();
    },

    openModal(modalName) {
      AppState.activeModal = modalName;
      renderApp();
    },

    closeModal() {
      AppState.activeModal = null;
      renderApp();
    },

    handleCalculatorKey(key) {
      if (key === "C") {
        AppState.calcExpression = "";
        AppState.calcDisplay = "0";
      } else if (key === "⌫") {
        AppState.calcExpression = AppState.calcExpression.slice(0, -1);
        AppState.calcDisplay = AppState.calcExpression || "0";
      } else if (key === "π") {
        AppState.calcExpression += String(Math.PI.toFixed(6));
        AppState.calcDisplay = AppState.calcExpression;
      } else if (key === "e") {
        AppState.calcExpression += String(Math.E.toFixed(6));
        AppState.calcDisplay = AppState.calcExpression;
      } else if (["sin", "cos", "tan", "√", "log", "ln", "x²", "1/x"].includes(key)) {
        const currentVal = parseFloat(AppState.calcDisplay) || 0;
        let out = 0;
        if (key === "sin") out = Math.sin((currentVal * Math.PI) / 180);
        if (key === "cos") out = Math.cos((currentVal * Math.PI) / 180);
        if (key === "tan") out = Math.tan((currentVal * Math.PI) / 180);
        if (key === "√") out = Math.sqrt(currentVal);
        if (key === "log") out = Math.log10(currentVal);
        if (key === "ln") out = Math.log(currentVal);
        if (key === "x²") out = currentVal * currentVal;
        if (key === "1/x") out = currentVal !== 0 ? 1 / currentVal : 0;
        AppState.calcDisplay = Number(out.toFixed(6)).toString();
        AppState.calcExpression = AppState.calcDisplay;
      } else if (key === "=") {
        try {
          const sanitized = AppState.calcExpression.replace(/[^0-9+\-*/().]/g, "");
          // eslint-disable-next-line no-new-func
          const result = Function(`"use strict"; return (${sanitized || "0"})`)();
          AppState.calcDisplay = Number(Number(result).toFixed(6)).toString();
          AppState.calcExpression = AppState.calcDisplay;
        } catch (e) {
          AppState.calcDisplay = "Error";
        }
      } else {
        AppState.calcExpression += key;
        AppState.calcDisplay = AppState.calcExpression;
      }
      renderApp();
    },

    openSubmissionConfirmation() {
      AppState.mobilePaletteOpen = false;
      AppState.mode = "submit_confirm";
      renderApp();
    },

    returnToExamFromConfirm() {
      AppState.mode = "exam";
      renderApp();
    },

    confirmFinalSubmit() {
      finalizeExamSubmission();
    },

    setFeedbackRating(key, rating) {
      AppState.feedbackRatings[key] = rating;
      renderApp();
    },

    updateFeedbackComments(val) {
      AppState.feedbackComments = val;
    },

    submitFeedbackAndExit() {
      evaluateAndSaveAttempt();
      AppState.mode = "result";
      renderApp();
      showToast("Thank you for your feedback! Your official provisional scorecard is ready.", "success");
    },

    exitToTerminalForNextCandidate() {
      const currentIdx = AppState.candidates.findIndex((c) => c.rollNo === AppState.loginRollInput);
      const nextCand = AppState.candidates[(currentIdx + 1) % AppState.candidates.length];
      if (nextCand) {
        AppState.loginRollInput = nextCand.rollNo;
        AppState.loginPasswordInput = nextCand.password;
      }
      AppState.session = null;
      AppState.mode = "terminal";
      startWaitingLobbyTimer();
      renderApp();
      showToast("Exited exam console. Terminal ready for the next candidate login.", "info");
    },

    setAdminTab(tabId) {
      AppState.adminTab = tabId;
      renderApp();
    },

    saveAdminExamChanges(asNewPreset) {
      const baseExam = JSON.parse(JSON.stringify(getActiveExam()));
      const titleEl = document.getElementById("adm-exam-title");
      const optsEl = document.getElementById("adm-exam-options");
      const secEl = document.getElementById("adm-exam-sectional");
      const posEl = document.getElementById("adm-exam-pos");
      const negEl = document.getElementById("adm-exam-neg");
      const waitEl = document.getElementById("adm-exam-wait");
      const calcEl = document.getElementById("adm-exam-calc");

      baseExam.title = titleEl ? titleEl.value.trim() || baseExam.title : baseExam.title;
      baseExam.optionsCount = optsEl ? parseInt(optsEl.value, 10) : baseExam.optionsCount;
      baseExam.sectionalTiming = secEl ? secEl.value === "true" : baseExam.sectionalTiming;
      baseExam.positiveMarks = posEl ? parseFloat(posEl.value) : baseExam.positiveMarks;
      baseExam.negativeMarks = negEl ? parseFloat(negEl.value) : baseExam.negativeMarks;
      baseExam.waitingRoomSeconds = waitEl ? parseInt(waitEl.value, 10) : baseExam.waitingRoomSeconds;
      baseExam.calculatorMode = calcEl ? calcEl.value : baseExam.calculatorMode;

      baseExam.sections = baseExam.sections.map((s) => ({
        ...s,
        positiveMarks: baseExam.positiveMarks,
        negativeMarks: baseExam.negativeMarks
      }));

      if (asNewPreset) {
        const newId = `CUSTOM_${Object.keys(AppState.customExams).length + 1}`;
        baseExam.id = newId;
        baseExam.code = `ECS-${newId}-2026`;
        AppState.customExams[newId] = baseExam;
        AppState.activeExamId = newId;
      } else {
        if (window.ECS_EXAM_PRESETS[baseExam.id]) {
          window.ECS_EXAM_PRESETS[baseExam.id] = baseExam;
        } else {
          AppState.customExams[baseExam.id] = baseExam;
        }
      }

      Storage.set("ecs_custom_exams", AppState.customExams);
      Storage.set("ecs_active_exam_id", AppState.activeExamId);
      renderApp();
      showToast(
        `Saved configuration: ${baseExam.title} (${baseExam.optionsCount} Options, +${baseExam.positiveMarks}/-${baseExam.negativeMarks})`,
        "success"
      );
    },

    setApiSourceMode(mode) {
      AppState.apiSourceMode = mode;
      Storage.set("ecs_api_source_mode", mode);
      renderApp();
      showToast(`Question API mode set to: ${mode.toUpperCase()}`, "info");
    },

    async testBatchApiInAdmin() {
      const exam = getActiveExam();
      await loadAllExamQuestionsBatch(exam);
      renderApp();
      showToast(`Verified upfront batch load of ${getExamTotalQuestions(exam)} questions (${AppState.lastApiLatencyMs} ms)!`, "success");
    },

    registerNewCandidate() {
      const nameEl = document.getElementById("new-cand-name");
      const rollEl = document.getElementById("new-cand-roll");
      const passEl = document.getElementById("new-cand-pass");
      const sysEl = document.getElementById("new-cand-sys");
      const catEl = document.getElementById("new-cand-cat");

      const name = nameEl && nameEl.value.trim() ? nameEl.value.trim() : "New Candidate";
      const rollNo = rollEl && rollEl.value.trim() ? rollEl.value.trim() : `24091009${AppState.candidates.length}`;
      const password = passEl && passEl.value.trim() ? passEl.value.trim() : "2000-01-01";
      const systemNo = sysEl && sysEl.value.trim() ? sysEl.value.trim() : "ECS-KOL-C050";
      const category = catEl ? catEl.value : "UR (General)";

      AppState.candidates.push({
        rollNo,
        password,
        name,
        category,
        dob: password,
        systemNo,
        labName: "Ion Digital Zone IDZ Salt Lake Sector V",
        shift: "Shift-1 (09:00 AM - 11:00 AM)",
        avatarHue: (AppState.candidates.length * 67) % 360
      });
      Storage.set("ecs_candidates", AppState.candidates);
      renderApp();
      showToast(`Registered candidate ${name} (Roll: ${rollNo})`, "success");
    }
  };

  window.addEventListener("DOMContentLoaded", () => {
    window.ECSApp.init();
  });
})();

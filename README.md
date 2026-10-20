# ECS iON — Elite Consultancy Services iON (Online CBT Platform)

**ECS iON** is a full-featured, responsive clone of the **TCS iON Digital Assessment System** built for seamless deployment on **Netlify**.

## Key Features Included

1. **Admin Exam Format & Marking Command Center**:
   - Pre-configured official blueprints for **SBI PO** (5 options, sectional timing), **IBPS PO** (5 options, sectional timing), **SSC CGL Tier-I** (4 options, composite timer, +2/-0.50), **RRB NTPC** (4 options, -0.33 negative marking), **IIM CAT** (4 options + TITA non-MCQ keypad + On-Screen Scientific Calculator), and **AIMA MAT** (5 sections, basic calculator).
   - **Custom Exam Builder**: Configure 4 vs. 5 options, positive/negative marking scheme, locked sectional timing vs. composite timing, pre-login countdown timer, and on-screen calculator mode.
   - **Multi-Candidate Roster & Attempt Analytics**: Register new candidate roll numbers & passwords, switch between candidates, and inspect completed scorecards and post-exam feedback ratings.

2. **Candidate Pre-Exam Waiting Lobby & Terminal Login**:
   - Authentic system terminal header (`ECS-KOL-C001`), candidate biometric profile card, live countdown gate before login unlocks (with an Invigilator Instant Unlock override button for testing), Roll Number & Password validation, and an on-screen TCS iON Virtual Keypad.

3. **Official Two-Step Instructions & Bilingual Support**:
   - General Instructions with the exact 5 TCS iON Question Palette status shapes (`Not Visited`, `Not Answered`, `Answered`, `Marked for Review`, and `Answered & Marked for Review — Considered for Evaluation`).
   - Paper-specific marking table, default language selector (**English**, **Hindi**, or **Bilingual Both**), and mandatory candidate declaration checkbox.

4. **Upfront Single-Sitting Batch Question API Engine**:
   - Fetches and synchronizes all questions across every section **all at once in a single batch** before Question 1 loads (combining live REST API requests to `opentdb.com` by subject category with a curated bilingual Indian competitive exam repository).
   - Automatically normalizes every MCQ to **5 options (A–E)** for Banking exams or **4 options (A–D)** for SSC/RRB/CAT/MAT exams.

5. **Responsive TCS iON Assessment Console**:
   - Section tabs with answered/total counters and sectional lock enforcement.
   - Split-screen support for Data Interpretation (DI) tables and Reading Comprehension passages.
   - Right-hand Question Palette with 5-state TCS iON badges, status counters, and filter pills (`All`, `Answered`, `Unanswered`, `Review`), collapsing into a slide-over drawer on mobile and tablet screens.
   - Built-in **Question Paper Modal**, **Instructions Modal**, **Candidate Profile Modal**, **On-Screen Scientific Calculator**, Font Size (`A-`, `A`, `A+`) scaling, and Contrast Mode.

6. **Submission Summary, Mandatory Post-Exam Feedback & Provisional Scorecard**:
   - Section-wise confirmation summary table prior to final submission.
   - Mandatory 5-star candidate feedback survey before exiting the test screen.
   - Detailed Provisional Scorecard with cutoff qualification status, section breakdown, and question-by-question answer key with explanations.

## Deploying to Netlify

### Method 1: Netlify Drop (Fastest — 10 Seconds)
1. Extract `ecs_ion_netlify_cbt.zip`.
2. Go to [app.netlify.com/drop](https://app.netlify.com/drop).
3. Drag and drop the extracted folder onto the page. Your site will be live immediately!

### Method 2: Git Repository Deploy
1. Push the contents of this folder to a GitHub, GitLab, or Bitbucket repository.
2. Import the repository into Netlify (`netlify.toml` is pre-configured with publish directory `.` and SPA routing headers).

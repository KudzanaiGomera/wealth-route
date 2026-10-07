# WealthRoute

Personal finance & wealth planning assistant, version **3.0**. Core files:
`index.html` (the whole app), `tests.html` (test suite),
`manifest.webmanifest`, `service-worker.js` (PWA install/offline shell), and
`worker.js`/`wrangler.toml` (optional Cloudflare Worker for live rates and the
AI assistant). No bundler or TypeScript compiler for the app itself:
everything is inlined into a single `<script>`/`<style>` tag per file.
Use npm for validation and to prepare the bundled DOMPurify dependency.

**Architecture change in 2.0: real accounts, not local-only storage.**
Every visitor signs up or logs in (email/password or Google) before seeing
any data; all financial records live in Firestore under that account, not in
this browser. Log into the same account from a phone, another computer, or
after clearing browser data, and your data is exactly as you left it. See
"Accounts, data, and privacy" below for the full picture, including what
this means for offline use.

## What's new in 3.0

- **Balance-first dashboard:** a subtly accent-tinted net-worth card with two-column
  balance rows, emergency fund and total assets, a compact annual overview,
  and direct links to Transactions, Budget, Savings, and Goals.
- **Dashboard privacy:** the eye button hides or shows all dashboard amounts,
  monetary deltas, chart contents, debt progress details, and financial
  recommendation details together. The preference is remembered on this
  browser per account and reapplied when the dashboard rerenders.
- **Password visibility:** login and signup have a separate show/hide button.
  Passwords start hidden on each form; toggling never changes the typed value
  or stores a password. Password reset remains email-based.
- **Responsive controls:** two-column balance rows on phones, larger touch
  targets, compact mobile shortcuts, and existing light/dark and PWA
  safe-area support.
- **Cleaner transaction view:** compact spending cards and a date-grouped
  activity ledger with signed amounts, inline editing, and labeled fields on phones.
- **Version 3.0.0** in package metadata, Settings, and exported backups;
  the service-worker shell cache is refreshed for the release.
- **Payday budgets:** expected income less advances, reserved expenses, debt
  payments, and linked savings allocations funds the day-to-day budget once
  payday is confirmed. Positive and negative balances carry forward.

### Payday Budgeting

Payday is the **25th**. The budget named October runs from **25 September
through 24 October**; November begins on 25 October. Dashboard and the
payday-enabled Transactions view use these same date boundaries.

On Income, select a budget month and review the expected income **before
advances**, fixed expenses, variable reservations, and debt payments. New
plans default to recurring income/fixed expenses, the larger of planned and
actual variable expenses, and monthly-equivalent debt minimums. These are
editable reservations, not automatic bill or debt payments. Saved cycles
keep their own amounts; changes to recurring sources do not rewrite them.

Record each wage advance with its received date and future payday. It adds
available money when received and reduces that future payday's salary.
The advance principal is **not** also a variable expense or a debt payment.
If already recorded as an Add money transaction, link that matching date
and amount instead of crediting it again. Linked entries cannot be edited
or deleted independently. Remove the link on Income first; removing a
linked advance preserves the original transaction. Separate advance fees
remain expenses. Confirmed cycles must be unconfirmed before their
advances can be changed.

Select a savings pot and amount under **Savings from payday**. Multiple
allocations are supported. Save unchecked for a plan; check **Pay received
and listed savings transferred** only after payday and the real transfer.
Confirmation credits the pots and funds the spending budget in one
Firestore transaction. Repeated saves do not duplicate money. Editing an
allocation or unconfirming adjusts/reverses the pot credits atomically.
Reversal is blocked if that money is no longer in the pot. Future paydays
cannot be confirmed; these operations require an online connection.

**New budget = expected income - advances - fixed reservations - variable
reservations - debt reservations - savings allocations.**

**Remaining = carry-over + confirmed new budget + extra money received -
everyday spending.** Carry-over includes overspending; negative balances
are never reset to zero. The progress bar shows the percentage of available
money remaining, including carry-over and extra receipts, clamped to 0-100%.

Transactions remains in its existing calendar-month mode until a payday
plan or advance exists. In payday mode, mark payments already included in
Income reservations as **Already reserved on Income**; they must not
reduce the everyday balance a second time. Payday funding and unlinked
advance receipts are calculated automatically, not copied into editable
transaction rows.

**Existing-data setup:** export a backup first. Remove advance principal
from Variable Expenses yourself, link any existing advance receipt, and
reconcile the initial balance and earlier Add money entries before
confirming historical payday funding. Do not also enter a funded payday
budget as Add money or manually add its savings to a pot. Existing records
are not automatically deleted or reclassified, because names alone cannot
reliably identify an advance, salary deposit, or duplicate savings transfer.
An old manual payday top-up must be reconciled before confirming that same
payday. Legacy general-savings entries are not automatically linked to pots.

### Previous release: 2.0

- **Real accounts**: email/password and Google sign-in, a required unique
  username, password reset, all backed by Firebase Auth.
- **Firestore is the only data store.** IndexedDB is gone entirely \u2014 every
  account's data lives under its own path in Firestore, enforced by security
  rules, so one account can never see another's data, even on a shared
  browser.
- **Every page is gated behind sign-in.** Nothing renders \u2014 not even the
  shell \u2014 until Firebase resolves an authenticated user.
- **Redesigned navigation**: a horizontal quick-access bar (Dashboard,
  Transactions, Debts, Savings, Settings) on wider screens, plus a
  grouped dropdown for everything else, with no duplicate entries between
  the two. Mobile keeps the full list in the dropdown since it has no
  horizontal bar.
- **Installable PWA, properly this time**: real app icons (192/512/maskable)
  replace the previously empty manifest icon list, plus iOS home-screen meta
  tags. Previously the empty icon list silently blocked Chrome/Android's
  install prompt.
- **Retired** the local-only backup mechanisms that only made sense before
  accounts existed: folder-based auto-backup (File System Access API) and
  the passphrase + Cloudflare Worker encrypted cloud backup. Manual JSON
  export/import is kept in Settings \u2192 Data Management, now reading/writing
  your Firestore data instead of a local database.

## Design

Light and dark mode (toggle in the top bar, defaults to your system
preference, remembered after that). Deep emerald as the primary accent,
warm gold reserved for medium-priority signal, a serif used for the net
worth figure and headings, sans-serif for everything functional. No
external font/icon dependencies \u2014 system font stacks only, so this doesn't
add to the "needs internet" list beyond the Excel tab and your account
(see below).

The 3.0 dashboard uses a theme-matched balance card with unframed balance rows,
a separate annual overview, and compact icon shortcuts. Cards retain a
maximum 8px corner radius; mobile rows and long amounts reflow without
page-level horizontal scrolling. Spending cards use concise share labels;
transaction activity groups rows by date and stacks editable fields on phones.

## Accounts, data, and privacy

Settings \u2192 **Profile** shows your username and email, lets you change your
username (must be unique, 3\u201320 characters, letters/numbers/underscores),
and \u2014 for email/password accounts \u2014 send yourself a password reset email.
Google accounts manage their password through Google instead.

Each account's financial records live under `users/{uid}/...` in Firestore,
scoped entirely to that account by security rules
(`request.auth.uid == uid`) \u2014 not just hidden by the UI. Nobody else who
signs into this app, on this device or any other, can read or write your
data.

**Balance visibility is display privacy, not encryption or access control.**
The dashboard eye button replaces displayed amounts and sensitive details
with placeholders, including charts and closed spending breakdowns. Original
content is restored when you show balances again. Other pages, exports, and
stored financial records are unchanged; hide mode does not conceal bill names,
health scores, or recommendation titles. Only the visibility preference is
saved in localStorage under a per-account key, never passwords or balances.
If browser storage is unavailable, the toggle still works for the current view.

**Offline behavior changed from 1.x.** The app previously worked fully
offline via IndexedDB with no login at all. Now: the very first sign-in on
any device needs a network connection, but after that Firestore's built-in
offline cache lets you keep reading and editing while offline \u2014 writes queue
up and sync automatically once you're back online.

**One remaining caveat:** login only controls what's *shown*. If more than
one person signs into different accounts on the *same physical browser
profile*, they will not see each other's Firestore data (that's enforced
server-side), but there is currently no separate "profile switcher" for
purely local, no-account use on a shared device.

## This pass: editing, Excel fix, and a professionalism pass

**Editable everywhere.** Transactions, Debts, Assets, Investments, and
Spreadsheet all have inline-editable cells now (previously some only
supported delete). Every table: confirms before deleting, flashes green on
a successful save, and clamps numeric fields to non-negative instead of
silently accepting bad input.

**Excel import bug fixed.** `readSheetRows` assumed column headers always
sit in row 1 and relied on SheetJS's default object-conversion, which
silently drops any column with a blank header cell. Real spreadsheets
routinely violate the row-1 assumption \u2014 including your own source
workbook, whose month sheets have headers at row 14, row 26, etc. Fixed
with a header-row picker in the Excel tab and a rewritten row parser that
gives blank headers a synthetic label instead of dropping them. Also fixed
amount parsing to handle accounting-style negatives like `(500.00)`.
Verified against a simulated sheet shaped like your actual workbook.

**Expense Categories now has a UI** (Settings \u2192 Expense Categories) \u2014 tag
fixed/variable expenses essential or discretionary, assign them on
Transactions or Spreadsheet. This is what actually turns on accurate
essential-expense-based emergency fund math and the "discretionary
spending increased" recommendation; without it those features were running
on a fallback approximation.

**Debts now carry a currency**, and net worth conversion actually applies
it \u2014 previously debts were silently assumed to already be in your base
currency regardless of what you entered.

**Health score's net worth trend is smoothed** across a small window of
recent snapshots instead of comparing only the two most recent points, so
one noisy data point can't swing the whole score.

**New Reports tab**: income vs expenses by month, essential vs
discretionary spending by month, spending by category, and assets/
liabilities history \u2014 built from `aggregateMonthlyTotals` and
`aggregateSpendingByCategory`, two new pure functions, both tested.

**Transactions is now sortable** by clicking any column header.

**Debt edit no longer loses focus.** Editing a debt's numbers needs to
recalculate the payoff projection (which depends on every debt together),
but that used to re-render the whole page; now only the projection section
re-renders, so the row you're editing keeps focus.

## How to run this

Requires a Firebase project (Authentication + Firestore) \u2014 see "Setting up
your own Firebase project" below if you're deploying your own copy. This
repo's `index.html` already points at a live project, so you can also just
serve the files as-is to try it.

**`file://` pages won't work** \u2014 Firebase Auth (popups/redirects) and
Firestore both need `http://` or `https://`. **GitHub Pages works out of the
box**, since it serves everything over `https://`.

For local testing:
```bash
python3 -m http.server 8000
# open http://localhost:8000
```

The Excel tab loads SheetJS from a CDN (`cdn.jsdelivr.net`), and signing in
needs a network connection the first time on any device \u2014 after that,
Firestore's offline cache keeps the app usable without a connection.

## Setting up your own Firebase project

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com).
2. **Authentication** \u2192 Sign-in method \u2192 enable **Email/Password** (and
  **Google** if you want that option too). **Anonymous** is optional for
  browser tests; the runner can use a disposable email/password account.
3. **Firestore Database** \u2192 create a database, then set these security
  rules (Rules tab \u2192 replace everything \u2192 Publish):
  ```
  rules_version = '2';
  service cloud.firestore {
    match /databases/{database}/documents {
      match /usernames/{username} {
        allow read: if true;
        allow create: if request.auth != null && request.resource.data.uid == request.auth.uid;
        allow delete: if request.auth != null && resource.data.uid == request.auth.uid;
        allow update: if false;
      }
      match /users/{uid} {
        allow read, write: if request.auth != null && request.auth.uid == uid;
        match /{document=**} {
          allow read, write: if request.auth != null && request.auth.uid == uid;
        }
      }
    }
  }
  ```
4. Project settings \u2192 add a Web app \u2192 copy the six `firebaseConfig` values
  (they're public identifiers, not secrets) into `FIREBASE_CONFIG` near the
  top of the `WR.account` module in `index.html`, and into the matching
  `FIREBASE_CONFIG` in `tests.html`.

## Running tests

Run `npm install`, `npm run build`, and `npm test` for the production-helper
checks. On Windows with a restricted PowerShell execution policy, use
`npm.cmd` instead of `npm`. The build copies DOMPurify into the local
`vendor` folder; ship that folder alongside the HTML and service worker.

Serve the folder (see above), then open `tests.html` for browser tests.
Storage tests use an isolated Firebase app with in-memory authentication,
falling back to a disposable email/password user if anonymous sign-in is
disabled. Test records and the test user are removed afterward. The runner
does not reuse a signed-in app user's authentication session.

Version 3.0 checks cover dashboard masking and exact restoration, preference
retention across rerenders and separation between accounts, unavailable
localStorage, password show/hide without changing the value, and matching
release versions. The browser UI suite loads the production visibility helpers
without signing in or accessing financial records. Responsive visual checks
should include 320px, 375px, 768px, and 1440px widths in both themes, keyboard
focus on the eye buttons, and login/signup/reset modes. Real iOS home-screen
safe-area behavior still requires an on-device check.

`npm test` also exercises the production payday functions with isolated,
in-memory transactional fixtures: date boundaries, cent-rounded funding,
positive/negative carry-over, future dates, planned versus confirmed funding,
advance receipt linking and duplicate guards, savings confirmation/edit/reversal,
missing pots, insufficient reversal balances, and pre-advance Income defaults.
These tests never access a real account. Browser form/layout checks should
also cover Income, Transactions, Dashboard, and Savings in both themes.

## What's built

The main navigation now opens Transactions for day-to-day activity and keeps
monthly variable-expense budgeting in its own page. Savings combines general
savings, editable pots (including transfers and archived goals), and the
emergency fund with its own editable target. Wealth combines investment
tracking and assets; Goals tracks
independent personal targets. Reports, Forecast, Excel and Wealth Assistant
remain available through their existing direct routes, but are not in the
main navigation.

Annual dashboard income counts recurring sources from the first month with a
dated financial record in that year through the selected month. Set an income
source's start and end months on the Income page if its range differs.

Savings entries are new monthly contributions, not repeated account balances.
Unused general savings carry into later months; moving them into a pot changes
their location without increasing the combined balance. Payoff Strategy uses
the current debt balance, annual interest rate, and monthly-equivalent minimum
payments (weekly 52/12, biweekly 26/12, quarterly 1/3, yearly 1/12). Dates
and interest are estimates; actual interest, rate changes, and new borrowing
must be reconciled against lender statements.

**Dashboard** \u2014 net worth, payday budget, remaining money, carry-over, debt, emergency fund
months, financial health score with a transparent per-component breakdown,
the "What Should I Do Now?" recommendations panel, cash flow and net worth
charts, one-click net worth snapshot recording.

**Transactions** \u2014 date-grouped, inline-editable everyday activity,
connected payday funding, carry-over, and remaining-budget progress.
**Variable Expenses** retains monthly budget-vs-actual expense planning.

**Debts** \u2014 inline-editable including currency, plus avalanche/snowball/
hybrid prioritisation with a month-by-month payoff simulator: total months
to debt-free, total interest paid, and interest/time saved from an
adjustable extra monthly payment.

The page separates "Debts I owe" and "Owed to me" into tabs. Loan details,
paid-off history, the monthly tracker, and payoff settings can be expanded
as needed. Dashboard Paid/Unpaid actions share the debt payment ledger and
update balances atomically; payment changes require an online connection.
The dashboard's Budgeted for the month deducts advances, expense/debt
reservations, and linked payday savings. Recommendations use the payday
budget where a cycle is saved; otherwise they retain the legacy cash-flow
calculation. Reservation changes do not mark debts as paid.

The separate **Money owed to me** section records personal loans and bills
paid on someone else's behalf, including the person, principal, currency,
source account, dates, notes, and optional one-off interest percentage.
Partial repayments reduce the outstanding amount; fully repaid entries keep
their repayment history. Source accounts are descriptive records only:
entries and repayments do not automatically debit or credit account balances,
change your own debts, or enter net worth calculations.

**Assets / Investments** \u2014 inline-editable tracking, liquidity tagging
(drives the emergency fund calculation), risk category.

**Forecast** \u2014 configurable multi-year net worth projection (debt paydown +
investment growth), clearly labelled as a projection, not a promise.

**Reports** \u2014 income vs expenses by month, essential vs discretionary
spending by month, spending by category, assets/liabilities history \u2014 built
from every month of data on record.

**Spreadsheet** \u2014 month/year navigation with an editable table for the
selected month, writing directly to the same store the Dashboard reads.

**Excel** \u2014 import (upload \u2192 pick sheet \u2192 pick header row \u2192 map columns \u2192
preview with per-row validation \u2192 confirm) and export (all current data to
a new workbook).

**Wealth Assistant** \u2014 optional, off by default. Uses a Cloudflare Worker so the provider key never reaches the browser. See "Live updates and assistant" below.

**Settings** \u2014 base currency, country, emergency fund target, assumed
investment return, risk profile, expense categories (essential/
discretionary tagging), live or manually-entered exchange rates, JSON
export/import for portability, delete-all-data. Plus a **Profile** section
for account management (username, password reset, log out) \u2014 see
"Accounts, data, and privacy" above.

## Live updates and assistant

`worker.js` is a Cloudflare Worker with two routes: `/rates` proxies the
free Frankfurter exchange-rate service and `/assistant` sends only the
calculated financial snapshot to Google Gemini. The provider key is a
Cloudflare secret, never a browser setting or repository file.

1. Create a free Gemini API key in Google AI Studio. Gemini's free developer
  tier is suitable for personal use, subject to Google's current quotas.
2. Install Wrangler, sign in, and deploy from this folder:
  ```bash
  npm install -g wrangler
  wrangler login
  wrangler secret put GEMINI_API_KEY
  wrangler deploy
  ```
3. In the Cloudflare Worker dashboard, add a plain-text `ALLOWED_ORIGINS`
  variable with the exact app origin, for example
  `https://your-account.github.io`. For local testing add
  `http://localhost:8000` too, comma-separated.
4. Copy the deployed `https://...workers.dev` URL into Settings > Live
  Updates & Wealth Assistant.

For a second free option, Groq offers a rate-limited developer API and can
replace the Gemini request in `worker.js`. Do not put either provider key in
`index.html`, local storage, or `wrangler.toml`. Configure Cloudflare rate
limiting/WAF before sharing a public Worker, because browser-origin checks
are helpful but are not user authentication.

## Honest deviations from the original 42-point brief

Built everything reasonably achievable in a static, dependency-light app.
A few things were deliberately simplified or left out \u2014 flagged here rather
than left for you to discover:

- **Goal Tracker and Habit Tracker**: excluded entirely, per your explicit
  instruction. No representation anywhere in the data model or UI.
- **AI Assistant needs your deployed Worker.** It is off by default and
  works only after a Cloudflare Worker URL and Gemini secret are configured.
  Provider free tiers are quota-limited and may change.
- **Excel import uses generic column mapping**, not a hardcoded parser tied
  to your exact 16-sheet workbook layout. This is more robust (survives
  structural differences, works with any spreadsheet) but means it won't
  auto-detect your original workbook's sections \u2014 you map columns yourself
  once per import.
- **Excel export produces WealthRoute's own data model** (one sheet per
  entity), not a reproduction of the original Annual Overview / 12 month
  sheets / Networth / Goal / Habit template.
- **Forecast models debt paydown and investment growth only.** Property,
  vehicles, and other assets are held constant in projections \u2014 deliberately,
  since guessing future property appreciation is exactly the kind of
  unfounded certainty your brief warned against. Income/expense growth
  assumptions aren't modelled as separate scenario presets (section 18's
  "reduce expenses" / "increase income" scenario buttons) \u2014 you can
  approximate these by adjusting the debt payment / investment contribution
  inputs directly.
- **Expense anomaly detection is limited** to one thing: discretionary
  spend vs. the prior month, as a percentage change. The brief's fuller
  vision (subscription creep detection, lifestyle inflation trends, unusual
  transaction flags) isn't built \u2014 it needs transaction-level history over
  many months, which nothing in this version has yet.
- **No income-opportunity suggestions** (section 19's "eventually suggest
  income-generating opportunities based on skills/capital/time") \u2014 out of
  scope for a static app with no external data sources.
- **Multi-currency supports a free live lookup** through the Worker, with
  manual entry and the last saved rate retained as fallbacks. It fixes the
  source workbook's actual bug: USD assets and foreign-currency debts are
  converted into net worth instead of silently assumed to be at parity.

## Project layout (development only \u2014 not part of the shipped app)

The two shipped files are self-contained. During development this was built
and verified as separate modules before being concatenated \u2014 mentioned here
in case you want to extend it that way rather than editing the single files
directly:

```
db, repository, repositories, models       storage layer (Sprint 1)
financial/cashflow, debt              core calculations (Sprint 2)
financial/networth, emergencyfund,
  healthscore, debtpayoff, investment,
  forecast, reports                Phase 2/3 + reporting calculations
recommendations/rules              "What Should I Do Now?" engine
excel/io                     Excel import/export
charts                       hand-rolled SVG bar/line charts
ui/snapshot, dashboard, transactions,
  debts, assets-investments, forecast,
  reports, spreadsheet, excel-view,
  settings, assistant, router          views + navigation
bootstrap                     app entry point
```

## Known remaining gaps (not fixed in this pass)

Flagging what's still open rather than letting it be a surprise:

- **No sorting/filtering** on Debts, Assets, or Investments tables (only
  Transactions has it). Fine at small scale, will get unwieldy with many
  records.
- **No undo** after a delete confirmation \u2014 the confirmation dialog is the
  only safety net.
- **No per-account local storage isolation on a shared browser.** Login
  controls what's shown and Firestore enforces real data isolation
  server-side, but there's no separate "who's using this browser" profile
  switcher for people who deliberately want to avoid a real account.
- **Not every page was click-tested during the 2.0 migration** \u2014
  authentication, navigation, the Dashboard, Debts, and Settings/Profile
  were all verified live in a real browser against a live Firebase project,
  but Transactions, Assets, Investments, Forecast, the Excel workflow, and
  the Reports charts were carried over unchanged and re-verified only by
  code review, not by clicking through them post-migration.

## Roadmap: Phase 1, 2, 3 (no demo data)

This roadmap keeps WealthRoute lightweight and dependency-light (still no
build step) while improving professionalism for sharing with a small group
now and wider individual use later. As of 2.0, "local-first" has been
superseded by accounts + Firestore (see "Accounts, data, and privacy"
above) \u2014 items below predate that change where they still say otherwise.

### Phase 1 — Friend-ready polish (current distribution)

- [x] Add a first-run setup flow: base currency, country, emergency target,
  recurring income, and first debt.
- [x] Add guided setup cues on the Dashboard and Settings so users know what to do next.
- [x] Add stronger confirmation and safety UX for destructive actions
  (restore/import/reset/delete).
- [x] Add an audit trail panel for important events (imports, resets, snapshots,
  debt payment edits).
- [x] Add runtime validation messages for common data issues (invalid dates,
  start/end month mismatches, payment over balance).
- [x] Run browser click-through QA across all routes and fix UX defects
  (verified live via automated browser testing during the 2.0 migration:
  sign-up/login/logout, Dashboard, Debts, Settings/Profile, nav, and PWA
  install assets all confirmed working end-to-end against a live Firebase
  project).
- [x] Update tests.html schema/repository coverage to match index.html
  (fully rebuilt against Firestore in 2.0, using the same repository code
  and an anonymous test account — no longer a separate IndexedDB mock).

### Phase 2 — Market-quality foundation

- Split the single-file app into maintainable modules for storage,
  calculations, and UI while preserving local-first behavior.
- Create a dedicated, fully tested financial-core module for formulas.
- Add integrity checks on app startup with non-blocking warnings.
- Add import/export hardening: row-level failure report and stronger schema
  migration checks.
- Improve responsive behavior and mobile ergonomics across table-heavy views.
- Add product-grade help content: methodology, assumptions, and limitations.

### Phase 3 — Lightweight public release readiness

- [x] Package as a lightweight installable PWA (real icons + manifest fixed
  in 2.0).
- [x] Add secure sync architecture (Firebase Auth + Firestore, per-account
  data isolation, in 2.0 \u2014 superseded the original "keep local-first as
  default" framing).
- [x] Add release versioning (this README's version header + in-app Release
  Notes in Settings) and a user-facing changelog ("What's new in 2.0" above).
- [x] Publish clear privacy and data ownership messaging ("Accounts, data,
  and privacy" above).
- [ ] Add onboarding docs for first-time users and account recovery docs
  beyond the built-in password reset email.
- [ ] Add a simple feedback loop for early users to report UX and calculation
  issues.

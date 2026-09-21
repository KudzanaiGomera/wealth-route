# WealthRoute

Personal finance & wealth planning assistant, version **2.0**. Core files:
`index.html` (the whole app), `tests.html` (test suite),
`manifest.webmanifest`, `service-worker.js` (PWA install/offline shell), and
`worker.js`/`wrangler.toml` (optional Cloudflare Worker for live rates and the
AI assistant). No npm, no bundler, no build step, no TypeScript compiler for
the app itself \u2014 everything is inlined into a single `<script>`/`<style>`
tag per file.

**Architecture change in 2.0: real accounts, not local-only storage.**
Every visitor signs up or logs in (email/password or Google) before seeing
any data; all financial records live in Firestore under that account, not in
this browser. Log into the same account from a phone, another computer, or
after clearing browser data, and your data is exactly as you left it. See
"Accounts, data, and privacy" below for the full picture, including what
this means for offline use.

## What's new in 2.0

- **Real accounts**: email/password and Google sign-in, a required unique
  username, password reset, all backed by Firebase Auth.
- **Firestore is the only data store.** IndexedDB is gone entirely \u2014 every
  account's data lives under its own path in Firestore, enforced by security
  rules, so one account can never see another's data, even on a shared
  browser.
- **Every page is gated behind sign-in.** Nothing renders \u2014 not even the
  shell \u2014 until Firebase resolves an authenticated user.
- **Redesigned navigation**: a horizontal quick-access bar (Dashboard,
  Variable Expenses, Debts, Reports, Settings) on wider screens, plus a
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
  **Google** if you want that option too). Enable **Anonymous** as well if
  you plan to run `tests.html` (see below).
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

Serve the folder (see above), open `tests.html`. Results render directly on
the page. Storage-layer tests run against the same Firestore backend the
real app uses (via an anonymous test account on your Firebase project),
clearing that account's data before each test rather than deleting a local
database.

## What's built

**Dashboard** \u2014 net worth, income, expenses, surplus, debt, emergency fund
months, financial health score with a transparent per-component breakdown,
the "What Should I Do Now?" recommendations panel, cash flow and net worth
charts, one-click net worth snapshot recording.

**Transactions** \u2014 sortable, category-taggable, inline-editable budget
lines (income, fixed, variable, savings, debt payment) per month,
budget-vs-actual-vs-difference.

**Debts** \u2014 inline-editable including currency, plus avalanche/snowball/
hybrid prioritisation with a month-by-month payoff simulator: total months
to debt-free, total interest paid, and interest/time saved from an
adjustable extra monthly payment.

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

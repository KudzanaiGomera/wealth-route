# WealthRoute

Local-first personal finance & wealth planning assistant. Core files:
`index.html` (the whole app), `tests.html` (test suite),
`manifest.webmanifest`, and `service-worker.js` (PWA install/offline shell).
No
npm, no bundler, no build step, no TypeScript compiler. Everything is
inlined into a single `<script>`/`<style>` tag per file.

## Latest UX changes

- Navigation was simplified around the core objective: daily/annual money
  management flows are primary, while Spreadsheet/Excel/Wealth Assistant are
  grouped under **More**.
- Mobile navigation now uses a hamburger menu with a dropdown panel.
- Desktop includes a quick jump dropdown for section switching.
- Dashboard top area is laid out as two responsive cards:
  - **Your Financial Position**
  - **Annual Financial Summary**

## Design

Light and dark mode (toggle in the top bar, defaults to your system
preference, remembered after that). Deep emerald as the primary accent,
warm gold reserved for medium-priority signal, a serif used for the net
worth figure and headings, sans-serif for everything functional. No
external font/icon dependencies \u2014 system font stacks only, so this doesn't
add to the "needs internet" list beyond the Excel tab (see below).

## Display name

Settings has an optional "Display name" field, shown as a time-of-day
greeting on the Dashboard ("Good afternoon, [name]"). Purely cosmetic \u2014 no
security or access-control meaning. Since each visitor's browser already
has its own completely separate IndexedDB database (per-origin, per-browser
isolation, not something WealthRoute has to build), there's no shared data
for a login system to protect, so there isn't one \u2014 adding a login screen
here would only create a false impression of a security boundary that
doesn't exist, plus an unrecoverable-password failure mode with no backend
to reset it.

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

**Chrome and Edge block IndexedDB on `file://` pages** \u2014 double-clicking
`index.html` will load the page but every save will silently fail in those
browsers. Firefox allows `file://` + IndexedDB. **GitHub Pages has no issue
at all**, since it serves everything over `https://`.

For local testing:
```bash
python3 -m http.server 8000
# open http://localhost:8000
```

The Excel tab loads SheetJS from a CDN (`cdn.jsdelivr.net`) \u2014 this needs
internet the first time it's used. Every other part of the app, including
IndexedDB storage, the financial engine, dashboard, and forecasting, works
fully offline.

## Running tests

Serve the folder (see above), open `tests.html`. Results render directly on
the page. Storage-layer tests require a real browser because they use
IndexedDB.

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

**Wealth Assistant** \u2014 optional, off by default. See "AI Assistant" below.

**Settings** \u2014 base currency, country, emergency fund target, assumed
investment return, risk profile, expense categories (essential/
discretionary tagging), manually-entered exchange rates, JSON
backup/export/restore, delete-all-data.

## Honest deviations from the original 42-point brief

Built everything reasonably achievable in a static, dependency-light app.
A few things were deliberately simplified or left out \u2014 flagged here rather
than left for you to discover:

- **Goal Tracker and Habit Tracker**: excluded entirely, per your explicit
  instruction. No representation anywhere in the data model or UI.
- **AI Assistant is not a built-in AI.** A static file has no server to hold
  credentials safely, so this only works if you paste in your own Anthropic
  API key (Settings \u2192 Wealth Assistant). It's off by default, the key stays
  in your browser's local storage, and it costs your own API usage \u2014 this
  is the most significant deviation from "just works out of the box."
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
- **Multi-currency requires exchange rates entered manually** in Settings.
  No live rate lookup (matches your MVP instruction to avoid required paid
  APIs) \u2014 but it does fix the source workbook's actual bug (USD assets, and
  now foreign-currency debts too, are properly converted into the net worth
  total instead of silently assumed to already be in base currency).

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
- **UI/DOM code is still unverified in a real browser** by me \u2014 only the
  pure financial-engine functions get executed and checked during
  development (this sandbox has no browser). Everything DOM-related
  (routing, forms, the Excel workflow, the Reports charts) is verified only
  by syntax-checking and code review, not by actually running it. You
  clicking through it is still the first real test.

## Roadmap: Phase 1, 2, 3 (no demo data)

This roadmap keeps WealthRoute lightweight and local-first while improving
professionalism for sharing with a small group now and wider individual use
later.

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
- [ ] Run browser click-through QA across all routes and fix UX defects.
- [~] Update tests.html schema/repository coverage to match index.html
  (core store parity added; full logic parity still pending).

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

- Package as a lightweight installable PWA.
- Add optional secure sync architecture planning (while keeping local-first as
  default mode).
- Add release versioning, migration notes, and a user-facing changelog.
- Publish clear privacy and data ownership messaging.
- Add onboarding docs for first-time users and backup/restore recovery docs.
- Add a simple feedback loop for early users to report UX and calculation
  issues.

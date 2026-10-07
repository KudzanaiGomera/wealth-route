const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const acorn = require('acorn');

const root = path.resolve(__dirname, '..');
if (process.argv.includes('--prepare')) {
  fs.mkdirSync(path.join(root, 'vendor'), { recursive: true });
  fs.copyFileSync(require.resolve('dompurify/dist/purify.min.js'), path.join(root, 'vendor/purify.min.js'));
}

const htmlPath = path.join(root, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');
const functions = new Map();
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => walk(child, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}

for (const match of [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].reverse()) {
  const source = match[1];
  if (!source.trim()) continue;
  const tree = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
  let setter;
  walk(tree, node => {
    if (node.type === 'FunctionDeclaration') {
      if (node.id.name === 'setHTML') setter = node;
      if (!functions.has(node.id.name)) functions.set(node.id.name, source.slice(node.start, node.end));
    }
  });
  const replacements = [];
  walk(tree, node => {
    if (node.type !== 'AssignmentExpression' || node.operator !== '=' || node.left.type !== 'MemberExpression' || node.left.property.name !== 'innerHTML') return;
    if (setter && node.start >= setter.start && node.end <= setter.end) return;
    if (!process.argv.includes('--migrate-html')) throw new Error('Unsafe innerHTML assignment outside setHTML');
    replacements.push({ start: node.start, end: node.end, text: `WR.ui.setHTML(${source.slice(node.left.object.start, node.left.object.end)}, ${source.slice(node.right.start, node.right.end)})` });
  });
  if (process.argv.includes('--escape-values')) {
    walk(tree, node => {
      if (node.type !== 'TemplateLiteral') return;
      node.expressions.forEach((expression, index) => {
        if (expression.type === 'CallExpression' && /esc|escape/i.test(source.slice(expression.callee.start, expression.callee.end))) return;
        const attribute = /(?:value|data-id|title)="$/.test(node.quasis[index].value.raw);
        const text = expression.type === 'MemberExpression' && ['name', 'description', 'note', 'displayName', 'country', 'borrower', 'category', 'label', 'title'].includes(expression.property.name);
        if (attribute || text) replacements.push({ start: expression.start, end: expression.end, text: `WR.ui.escapeText(${source.slice(expression.start, expression.end)})` });
      });
    });
  }
  if (replacements.length) {
    let updated = source;
    const outermost = replacements.sort((left, right) => left.start - right.start || right.end - left.end).filter((replacement, index, list) => !list.slice(0, index).some(previous => previous.start <= replacement.start && previous.end >= replacement.end));
    for (const replacement of outermost.sort((left, right) => right.start - left.start)) {
      updated = updated.slice(0, replacement.start) + replacement.text + updated.slice(replacement.end);
    }
    const offset = match.index + match[0].indexOf('>') + 1;
    html = html.slice(0, offset) + updated + html.slice(offset + source.length);
  }
}
if (process.argv.includes('--migrate-html') || process.argv.includes('--escape-values')) fs.writeFileSync(htmlPath, html);
acorn.parse(fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8'), { ecmaVersion: 'latest' });
for (const match of fs.readFileSync(path.join(root, 'tests.html'), 'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
  acorn.parse(match[1], { ecmaVersion: 'latest' });
}

const names = ['visibilityIcon', 'bindPasswordVisibility', 'bindFinancialVisibility', 'escapeText', 'assertActiveView', 'monthlyMinPayment', 'debtValueInCurrency', 'calculateTotalDebt', 'calculateTotalMinPayments', 'calculateDebtToIncomeRatio', 'convertCurrency', 'sumActualByType', 'calculateCashFlowSummary', 'calculateMoneyOwed', 'trackedPaymentForMonth', 'updateDebtPaidOffDate', 'setDebtPaymentStatus'];
const context = { WR: { financial: {} } };
vm.createContext(context);
vm.runInContext(names.filter(name => functions.has(name)).map(name => functions.get(name)).join('\n'), context);
context.WR.financial.convertCurrency = context.convertCurrency;
assert.equal(context.escapeText('<img onerror="test">'), '&lt;img onerror=&quot;test&quot;&gt;');
assert.throws(() => context.assertActiveView({ closest: () => ({ isConnected: false }) }), { name: 'AbortError' });
assert.doesNotThrow(() => context.assertActiveView({ closest: () => ({ isConnected: true }) }));
assert.equal(context.calculateMoneyOwed({ amount: 1000, interestRatePct: 10, repayments: [{ amount: 250 }] }).remaining, 850);
assert.equal(context.calculateMoneyOwed({ amount: 0.3, repayments: [{ amount: 0.1 }, { amount: 0.2 }] }).remaining, 0);
const cashflow = context.calculateCashFlowSummary([{ type: 'income', actualAmount: 10000 }, { type: 'fixed', actualAmount: 3000 }, { type: 'variable', actualAmount: 1500 }], 500);
assert.equal(cashflow.income - cashflow.totalExpenses, 5500);
assert.equal(cashflow.availableSurplus, 5000);
assert.equal(cashflow.monthlySurplus, 5500);
const rates = [{ fromCurrency: 'USD', toCurrency: 'ZAR', rate: 20, date: '2026-10-06' }];
const debts = [{ currency: 'USD', currentBalance: 2000, minPayment: 100 }, { currency: 'ZAR', currentBalance: 0, minPayment: 500 }];
assert.equal(context.calculateTotalMinPayments(debts, rates, 'ZAR'), 2000);
assert.equal(context.calculateTotalDebt(debts, rates, 'ZAR'), 40000);
assert.equal(context.calculateDebtToIncomeRatio(debts, 30000, rates, 'ZAR'), 2000 / 30000);
assert.equal(context.calculateTotalMinPayments(debts, [], 'ZAR'), 0);
console.log('Production scripts, safe HTML boundaries, escaping, lending balances, and surplus checks passed.');

function checkVisibility() {
  const stored = new Map();
  let uid = 'privacy-test';
  context.WR.account = { getCurrentUser: () => ({ uid }) };
  context.localStorage = { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) };
  context.document = { createTextNode: textContent => ({ textContent }) };
  context.setHTML = (element, markup) => { element.markup = markup; };
  function control(detail = false) {
    return {
      childNodes: [{ textContent: 'ZAR 12,345.67' }],
      attributes: {}, events: {}, type: 'password', value: 'test-only-value',
      parentElement: { closest: () => null }, classList: { toggle() {} },
      hasAttribute: name => detail && name === 'data-private-detail',
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, listener) { this.events[name] = listener; },
      replaceChildren(...children) { this.childNodes = children; },
    };
  }
  const input = control();
  const passwordButton = control();
  context.bindPasswordVisibility(input, passwordButton);
  assert.equal(input.type, 'password');
  assert.equal(passwordButton.attributes['aria-label'], 'Show password');
  passwordButton.events.click();
  assert.equal(input.type, 'text');
  assert.equal(passwordButton.attributes['aria-pressed'], 'true');
  passwordButton.events.click();
  assert.equal(input.type, 'password');
  assert.equal(input.value, 'test-only-value');

  function dashboard() {
    const button = control();
    const amount = control();
    const detail = control(true);
    const originalAmount = amount.childNodes[0];
    const root = { querySelector: () => button, querySelectorAll: () => [amount, detail] };
    context.bindFinancialVisibility(root);
    return { button, amount, detail, originalAmount };
  }
  const first = dashboard();
  first.button.events.click();
  assert.equal(first.amount.childNodes[0].textContent, '****');
  assert.equal(first.detail.childNodes[0].textContent, 'Hidden for privacy');
  assert.equal(first.button.attributes['aria-label'], 'Show dashboard balances');
  assert.equal(dashboard().amount.childNodes[0].textContent, '****');
  first.button.events.click();
  assert.equal(first.amount.childNodes[0], first.originalAmount);
  first.button.events.click();
  uid = 'other-account';
  assert.equal(dashboard().amount.childNodes[0].textContent, 'ZAR 12,345.67');
  context.localStorage = { getItem() { throw new Error('Unavailable'); }, setItem() { throw new Error('Unavailable'); } };
  const restricted = dashboard();
  assert.doesNotThrow(() => restricted.button.events.click());
  assert.equal(restricted.amount.childNodes[0].textContent, '****');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version, '3.0.0');
  assert.ok(html.includes("const APP_VERSION = '3.0.0'"));
  console.log('Balance masking/restoration, per-account preferences, unavailable storage, password visibility, and version checks passed.');
}
checkVisibility();

async function checkTransactionLayout() {
  const transactions = [
    { id: 'first', date: '2026-10-07', kind: 'spend', amount: 84.23, category: 'Bank charges', description: '<unsafe>' },
    { id: 'second', date: '2026-10-07', kind: 'spend', amount: 13.77, category: 'Bank charges' },
    { id: 'third', date: '2026-10-06', kind: 'add', amount: 800 },
  ];
  let markup = '';
  const selectors = [];
  const repo = records => ({ getAll: async () => records });
  const layoutContext = {
    WR: {
      repos: {
        dayToDayAccounts: repo([]), dayToDayTransactions: repo(transactions),
        expenseCategories: repo([]), emergencyFundContributions: repo([]), payCycles: repo([]), payAdvances: repo([]),
      },
      ui: {
        _dayMonth: '2026-10', getOrCreateProfile: async () => ({ baseCurrency: 'ZAR' }),
        previousMonthKey: () => '2026-09', escapeText: context.escapeText,
        syncBudgetMonth() {},
        payCycleDates: () => ({ start: '2026-09-25', endExclusive: '2026-10-25' }),
        calculatePayCycleBudget: () => ({ carryOver: 9999, funding: 4321, added: 800, spent: 98, remaining: 4223 }),
        calculateBudgetRemainingPercentage: () => 0,
        buildSnapshot: async () => ({ payCycles: [], paydayFunding: { budget: 4321 } }),
        fmt: amount => Number(amount).toFixed(2),
        calculateDayToDayMonthBalance: () => ({ balanceBeforeMonth: 0, currentBalance: 702 }),
        setHTML: (_container, value) => { markup = value; },
      },
    },
    document: { getElementById: () => ({ addEventListener() {} }) },
  };
  vm.createContext(layoutContext);
  vm.runInContext(functions.get('renderDayToDay'), layoutContext);
  const container = { querySelectorAll: selector => { selectors.push(selector); return []; } };
  await layoutContext.renderDayToDay(container);
  assert.equal((markup.match(/class="day-date-group"/g) || []).length, 1);
  assert.equal((markup.match(/<tr data-id=/g) || []).length, 2);
  assert.ok(markup.includes('2 transactions'));
  assert.ok(!markup.includes('data-field="kind"'));
  assert.ok(!markup.includes('name="kind"'));
  assert.ok(!markup.includes('data-id="third"'));
  assert.ok(functions.get('renderDayToDay').includes("kind: 'spend'"));
  assert.ok(markup.includes('data-label="Amount (ZAR)"'));
  assert.ok(markup.includes('&lt;unsafe&gt;'));
  assert.ok(!markup.includes("of this month's day-to-day spending"));
  assert.ok(selectors.includes('.day-ledger tbody tr[data-id]'));
  assert.ok(markup.includes('Balance at start of month</span><span class="stat-value">ZAR 4321.00'));
  assert.ok(!markup.includes('coveredByBudget'));
  assert.ok(!markup.includes('Reserved expense'));
  assert.ok(!markup.includes('day-balance-form'));
  assert.ok(markup.includes('Current balance</span><span class="stat-value ">ZAR 4223.00'));
  assert.equal((markup.match(/class="day-category-row/g) || []).length, 1);
  assert.ok(markup.includes('class="day-category-list" role="list"'));
  assert.ok(!markup.includes('day-category-card'));
  assert.ok(!markup.includes('stat-label">Buffer'));
  assert.ok(!markup.includes('Money added to buffer'));
  assert.ok(!markup.includes('<th>Note</th>'));
  assert.ok(!markup.includes('data-field="note"'));
  assert.ok(markup.includes('colspan="5" scope="rowgroup"'));
  transactions.length = 0;
  await layoutContext.renderDayToDay(container);
  assert.ok(markup.includes('No day-to-day transactions yet.'));
  assert.equal((markup.match(/class="day-date-group"/g) || []).length, 0);
  console.log('Transaction date grouping, counts, mobile labels, escaping, edit binding, and empty-state checks passed.');
}
checkTransactionLayout().catch(error => { console.error(error); process.exitCode = 1; });

async function checkSavingsActivity() {
  const savingsContext = {
    escapeEf: context.escapeText,
    WR: {
      ui: {
        getOrCreateProfile: async () => ({ baseCurrency: 'ZAR', emergencyFundAccounts: [{ id: 'main', label: 'Emergency savings' }] }),
        currentMonthKey: () => '2026-10', escapeText: context.escapeText,
        fmt: number => Number(number).toFixed(2),
        buildSnapshot: async () => ({ essentialVsDiscretionary: { essential: 1000 }, cashflow: { fixedExpenses: 1000 }, emergencyFundTargetMonths: 3 }),
        setHTML: (container, markup) => { container.markup = markup; },
      },
      repos: { emergencyFundContributions: { getAll: async () => [{ id: 'contribution', date: '2026-10-07', account: 'main', amount: 90.53 }] } },
    },
  };
  vm.createContext(savingsContext);
  vm.runInContext(functions.get('renderEmergencyFund'), savingsContext);
  const host = id => ({ id, querySelectorAll: () => [], querySelector: selector => selector === '#emergency-fund-month' && id === 'emergency-savings' ? null : { addEventListener() {} } });
  const savings = host('emergency-savings');
  await savingsContext.renderEmergencyFund(savings);
  assert.ok(!savings.markup.includes('ef-activity-card'));
  assert.ok(!savings.markup.includes('id="emergency-fund-month"'));
  assert.ok(savings.markup.includes('ZAR 90.53'));
  assert.ok(savings.markup.includes('id="emergency-add-form"'));
  const standalone = host('content');
  await savingsContext.renderEmergencyFund(standalone);
  assert.ok(standalone.markup.includes('ef-activity-card'));
  assert.ok(standalone.markup.includes('id="emergency-fund-month"'));
  console.log('Savings hides emergency activity while preserving balances, contribution controls, and standalone history.');
}
checkSavingsActivity().catch(error => { console.error(error); process.exitCode = 1; });

function checkNavigationLayout() {
  const classes = new Set();
  let width = 1440;
  const elements = Object.fromEntries([['.brand', 180], ['.nav-horizontal', 950], ['.nav-wide-actions', 130], ['.theme-toggle', 44], ['.nav-account', 0]].map(([selector, size]) => [selector, { scrollWidth: size, getBoundingClientRect: () => ({ width: size }), styles: { display: size ? 'flex' : 'none' } }]));
  let expanded;
  const topbar = {
    isConnected: true, get clientWidth() { return width; },
    styles: { columnGap: '16px', paddingLeft: '24px', paddingRight: '24px' },
    classList: { add: value => classes.add(value), remove: value => classes.delete(value), toggle: (value, enabled) => enabled ? classes.add(value) : classes.delete(value) },
    querySelector: selector => elements[selector],
    querySelectorAll: () => [{ setAttribute: (_name, value) => { expanded = value; } }],
  };
  const navContext = { window: { matchMedia: () => ({ matches: width >= 901 }) }, getComputedStyle: element => element.styles };
  vm.createContext(navContext);
  vm.runInContext(functions.get('updateNavigationLayout'), navContext);
  navContext.updateNavigationLayout(topbar);
  assert.equal(classes.has('nav-expanded'), true);
  assert.equal(expanded, 'false');
  width = 1280;
  navContext.updateNavigationLayout(topbar);
  assert.equal(classes.has('nav-expanded'), false);
  width = 1920;
  navContext.updateNavigationLayout(topbar);
  assert.equal(classes.has('nav-expanded'), true);
  width = 375;
  navContext.updateNavigationLayout(topbar);
  assert.equal(classes.has('nav-expanded'), false);
  assert.equal(classes.has('nav-measuring'), false);
  console.log('Navigation expands only when all links and actions fit and collapses cleanly on smaller screens.');
}
checkNavigationLayout();

async function checkPaydayBudget() {
  const documents = new Map();
  const copy = value => JSON.parse(JSON.stringify(value));
  const api = {
    doc: (_database, ...parts) => parts.join('/'),
    runTransaction: async (_database, operation) => {
      const writes = [];
      const result = await operation({
        get: async key => ({ exists: () => documents.has(key), data: () => copy(documents.get(key)) }),
        set: (key, value) => writes.push(() => documents.set(key, copy(value))),
        update: (key, value) => writes.push(() => documents.set(key, { ...documents.get(key), ...copy(value) })),
        delete: key => writes.push(() => documents.delete(key)),
      });
      writes.forEach(write => write());
      return result;
    },
  };
  const paydayContext = { WR: { ui: {}, account: { getCurrentUser: () => ({ uid: 'payday-test' }), getFirestoreApi: () => api, getDb: () => ({}) } } };
  vm.createContext(paydayContext);
  vm.runInContext(['currentMonthKey', 'previousMonthKey', 'payCycleDates', 'currentBudgetMonth', 'syncBudgetMonth', 'calculatePayCycleFunding', 'calculateBudgetRemainingPercentage', 'calculatePayCycleBudget', 'ensurePaydayRollover', 'savePayCycle', 'savePayAdvance'].map(name => functions.get(name)).join('\n'), paydayContext);
  Object.assign(paydayContext.WR.ui, { payCycleDates: paydayContext.payCycleDates, currentBudgetMonth: paydayContext.currentBudgetMonth, previousMonthKey: paydayContext.previousMonthKey, syncBudgetMonth: paydayContext.syncBudgetMonth, calculatePayCycleFunding: paydayContext.calculatePayCycleFunding, calculatePayCycleBudget: paydayContext.calculatePayCycleBudget });
  const funding = { expectedIncome: 10000, advanceAmount: 2000, fixedAmount: 1500, variableAmount: 500, debtAmount: 1000, allocations: [{ potId: 'holiday', amount: 1000 }] };
  assert.equal(paydayContext.calculatePayCycleFunding(funding).budget, 4000);
  assert.equal(paydayContext.calculatePayCycleFunding(funding).salary, 8000);
  assert.equal(paydayContext.calculatePayCycleFunding({ ...funding, shortfallAmount: 500 }).budget, 3500);
  assert.deepEqual(copy(paydayContext.payCycleDates('2027-01')), { start: '2026-12-25', endExclusive: '2027-01-25' });
  assert.equal(paydayContext.payCycleDates('2026-03', 31).start, '2026-02-28');
  const cycles = [{ ...funding, month: '2026-10', payDate: '2026-09-25', confirmed: true }];
  const transactions = [{ date: '2026-09-26', kind: 'spend', amount: 1000 }, { date: '2026-09-27', kind: 'spend', amount: 1500, coveredByBudget: true }];
  const advances = [{ receivedDate: '2026-09-20', amount: 2000 }];
  const accounts = [{ year: 2026, startingBalance: 500 }];
  const budget = paydayContext.calculatePayCycleBudget(accounts, transactions, cycles, advances, '2026-10', 25, '2026-10-24');
  assert.equal(budget.carryOver, 2500);
  assert.equal(budget.remaining, 1500);
  assert.equal(budget.spent, 2500);
  assert.equal(paydayContext.calculateBudgetRemainingPercentage(10000, 7000), 70);
  assert.equal(paydayContext.calculateBudgetRemainingPercentage(0, 7000), 0);
  assert.equal(paydayContext.calculateBudgetRemainingPercentage(10000, -500), 0);
  assert.equal(paydayContext.calculateBudgetRemainingPercentage(10000, 12000), 100);
  const percentageBudget = paydayContext.calculatePayCycleBudget([], [{ date: '2026-09-26', kind: 'spend', amount: 1500 }, { date: '2026-09-27', kind: 'add', amount: 500 }], cycles, [], '2026-10', 25, '2026-10-24');
  assert.equal(percentageBudget.remaining, 2500);
  assert.equal(percentageBudget.available, 4000);
  assert.equal(percentageBudget.remainingPct, 62.5);
  assert.equal(percentageBudget.funding - percentageBudget.remaining, percentageBudget.spent);
  const withBuffer = paydayContext.calculatePayCycleBudget(accounts, transactions, [{ ...cycles[0], bufferAmount: 2000 }], advances, '2026-10', 25, '2026-10-24');
  assert.equal(withBuffer.remaining, budget.remaining + 2000);
  assert.equal(withBuffer.funding, 6000);
  assert.equal(withBuffer.available, budget.available + 2000);
  assert.equal(paydayContext.calculatePayCycleFunding({ ...funding, bufferAmount: 2000 }).totalIncome, 9000);
  const linked = paydayContext.calculatePayCycleBudget(accounts, [...transactions, { id: 'receipt', date: '2026-09-20', kind: 'add', amount: 2000 }], cycles, [{ ...advances[0], transactionId: 'receipt' }], '2026-10', 25, '2026-10-24');
  assert.equal(linked.remaining, budget.remaining);
  const next = paydayContext.calculatePayCycleBudget(accounts, [...transactions, { date: '2026-10-25', kind: 'spend', amount: 500 }], [...cycles, { ...funding, expectedIncome: 8000, month: '2026-11', payDate: '2026-10-25', confirmed: true }], advances, '2026-11', 25, '2026-11-01');
  assert.equal(next.carryOver, 4000);
  assert.equal(next.remaining, 1500);
  const onlyBudget = paydayContext.calculatePayCycleBudget(accounts, transactions, [], [], '2026-10', 25, '2026-10-24', 4000);
  assert.equal(onlyBudget.remaining, 1500);
  assert.equal(onlyBudget.available, 4000);
  const lockedCycle = { ...cycles[0], rolloverApplied: true, rolloverAvailable: 1500, bufferAmount: 1000 };
  const locked = paydayContext.calculatePayCycleBudget([{ year: 2026, startingBalance: 99999 }], transactions, [lockedCycle], [], '2026-10', 25, '2026-10-24');
  assert.equal(locked.carryOver, 1500);
  assert.equal(locked.funding, 5000);
  assert.equal(locked.remaining, 2500);
  const following = paydayContext.calculatePayCycleBudget([], transactions, [lockedCycle], [], '2026-11', 25, '2026-11-01');
  assert.equal(following.carryOver, 3000);
  const deficitCycle = { ...cycles[0], rolloverApplied: true, rolloverAvailable: -500, shortfallAmount: 500 };
  const deficitNext = paydayContext.calculatePayCycleBudget([], [], [deficitCycle], [], '2026-11', 25, '2026-11-01');
  assert.equal(deficitNext.carryOver, 3500);
  assert.equal(paydayContext.syncBudgetMonth(new Date(2026, 11, 24, 23, 59)), false);
  paydayContext.WR.ui._dayMonth = '2026-12';
  paydayContext.WR.ui._paydayMonth = '2026-11';
  assert.equal(paydayContext.syncBudgetMonth(new Date(2026, 11, 25)), true);
  assert.equal(paydayContext.WR.ui._dayMonth, '2027-01');
  assert.equal(paydayContext.WR.ui._paydayMonth, '2026-11');
  assert.equal(paydayContext.syncBudgetMonth(new Date(2026, 11, 25)), false);
  assert.equal(paydayContext.calculatePayCycleBudget([], [{ date: '2026-09-26', kind: 'spend', amount: 6000 }], cycles, [], '2026-10', 25, '2026-10-24').remaining, -2000);
  assert.equal(paydayContext.calculatePayCycleBudget([], [{ date: '2026-10-25', kind: 'spend', amount: 100 }], cycles, [], '2026-10', 25, '2026-10-24').remaining, 4000);
  assert.equal(paydayContext.calculatePayCycleBudget([], [], [{ ...cycles[0], confirmed: false }], [], '2026-10', 25, '2026-10-24').funding, 0);

  const base = 'users/payday-test/';
  const today = new Date();
  const payDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-25`;
  const past = new Date(today.getFullYear(), today.getMonth() - 2, 25);
  const month = paydayContext.currentBudgetMonth(past);
  const earlierDate = new Date(past.getFullYear(), past.getMonth(), 20);
  const receivedDate = `${earlierDate.getFullYear()}-${String(earlierDate.getMonth() + 1).padStart(2, '0')}-20`;
  const earlierPayday = paydayContext.payCycleDates(month).start;
  documents.set(base + 'savingsPots/holiday', { currentAmount: 500, archived: false });
  documents.set(base + 'savingsPots/buffer', { currentAmount: 100, archived: false });
  await paydayContext.savePayAdvance('advance', { amount: 2000, receivedDate, payDate: earlierPayday });
  await paydayContext.savePayAdvance('advance', { amount: 2000, receivedDate, payDate: earlierPayday });
  assert.equal(documents.get(base + 'payCycles/' + month).advanceAmount, 2000);
  await paydayContext.savePayCycle(month, { ...funding, confirmed: false });
  assert.equal(documents.get(base + 'savingsPots/holiday').currentAmount, 500);
  await paydayContext.savePayCycle(month, { ...funding, confirmed: true });
  await paydayContext.savePayCycle(month, { ...funding, confirmed: true });
  assert.equal(documents.get(base + 'savingsPots/holiday').currentAmount, 1500);
  await assert.rejects(() => paydayContext.savePayAdvance('advance', {}, true), /Unconfirm/);
  await paydayContext.savePayCycle(month, { ...funding, allocations: [{ potId: 'buffer', amount: 700 }], confirmed: true });
  assert.equal(documents.get(base + 'savingsPots/holiday').currentAmount, 500);
  assert.equal(documents.get(base + 'savingsPots/buffer').currentAmount, 800);
  documents.set(base + 'savingsPots/buffer', { currentAmount: 0, archived: false });
  await assert.rejects(() => paydayContext.savePayCycle(month, { ...funding, allocations: [], confirmed: false }), /Cannot reverse/);
  assert.equal(documents.get(base + 'payCycles/' + month).confirmed, true);
  documents.set(base + 'savingsPots/buffer', { currentAmount: 800, archived: false });
  await paydayContext.savePayCycle(month, { ...funding, allocations: [], confirmed: false });
  assert.equal(documents.get(base + 'savingsPots/buffer').currentAmount, 100);
  await paydayContext.savePayAdvance('advance', {}, true);
  assert.equal(documents.get(base + 'payCycles/' + month).advanceAmount, 0);
  await assert.rejects(() => paydayContext.savePayCycle(month, { ...funding, allocations: [{ potId: 'missing', amount: 100 }], confirmed: true }), /no longer exists/);
  const futureMonth = paydayContext.currentBudgetMonth(new Date(today.getFullYear() + 1, today.getMonth(), 25));
  await assert.rejects(() => paydayContext.savePayCycle(futureMonth, { ...funding, confirmed: true }), /future payday/);
  documents.set(base + 'dayToDayTransactions/receipt', { date: receivedDate, kind: 'add', amount: 100 });
  await paydayContext.savePayAdvance('linked', { amount: 100, receivedDate, payDate: earlierPayday, transactionId: 'receipt' });
  assert.equal(documents.get(base + 'dayToDayTransactions/receipt').paydayAdvanceId, 'linked');
  await assert.rejects(() => paydayContext.savePayAdvance('duplicate-link', { amount: 100, receivedDate, payDate: earlierPayday, transactionId: 'receipt' }), /already be linked/);
  await paydayContext.savePayAdvance('linked', {}, true);
  assert.equal(documents.get(base + 'dayToDayTransactions/receipt').amount, 100);
  assert.equal(documents.get(base + 'dayToDayTransactions/receipt').paydayAdvanceId, '');
  await assert.rejects(() => paydayContext.savePayAdvance('invalid', { amount: 100, receivedDate: '2026-02-30', payDate }), /positive advance/);
  Object.assign(paydayContext.WR.ui, { isActiveForMonth: () => true, monthlyAmountFromFrequency: amount => Number(amount) });
  documents.set(base + 'incomeSources/salary', { id: 'salary', year: Number(month.slice(0, 4)), name: 'Salary', amount: 10000, frequency: 'monthly' });
  documents.set(base + 'incomeSources/claim', { id: 'claim', year: Number(month.slice(0, 4)), name: 'Claim', amount: 500, frequency: 'monthly' });
  const tableFields = { fixedAmount: 1500, variableAmount: 500, debtAmount: 700, incomeTable: { sources: [{ id: 'salary' }, { id: 'claim' }], sourceId: 'salary', availableBuffer: 2000, bufferAmount: 1000, adjustment: { advanceAmount: 2000, savingsAmount: 1000 } } };
  await paydayContext.savePayCycle(month, tableFields);
  await paydayContext.savePayCycle(month, tableFields);
  assert.equal(documents.get(base + 'savingsPots/holiday').currentAmount, 500);
  const tableCycle = documents.get(base + 'payCycles/' + month);
  assert.equal(tableCycle.mode, 'income-table');
  assert.equal(tableCycle.expectedIncome, 10500);
  assert.equal(paydayContext.calculatePayCycleFunding(tableCycle).totalIncome, 8500);
  assert.equal(paydayContext.calculatePayCycleFunding(tableCycle).budget, 5800);
  await paydayContext.savePayCycle(month, { fixedAmount: 1500, variableAmount: 500, debtAmount: 700, incomeTable: { sources: [{ id: 'salary' }, { id: 'claim' }], sourceId: 'claim', availableBuffer: 2000, adjustment: { advanceAmount: 100, allocations: [] } } });
  assert.equal(documents.get(base + 'payCycles/' + month).advanceAmount, 2100);
  assert.equal(documents.get(base + 'payCycles/' + month).sourceAdjustments.salary.savingsAmount, 1000);
  await assert.rejects(() => paydayContext.savePayCycle(month, { fixedAmount: 1500, variableAmount: 500, debtAmount: 700, incomeTable: { sources: [{ id: 'salary' }, { id: 'claim' }], sourceId: 'salary', sourceFields: { amount: 100 }, availableBuffer: 2000 } }), /Advances exceed/);
  assert.equal(documents.get(base + 'incomeSources/salary').amount, 10000);
  await assert.rejects(() => paydayContext.savePayCycle(month, { fixedAmount: 1500, variableAmount: 500, debtAmount: 700, incomeTable: { sources: [{ id: 'salary' }, { id: 'claim' }], availableBuffer: 2000, bufferAmount: 2001 } }), /Buffer exceeds/);
  await paydayContext.savePayCycle(month, { fixedAmount: 1500, variableAmount: 500, debtAmount: 700, incomeTable: { sources: [{ id: 'salary' }, { id: 'claim' }], sourceId: 'salary', adjustment: { savingsAmount: 0 }, availableBuffer: 2000 } });
  assert.equal(documents.get(base + 'savingsPots/holiday').currentAmount, 500);
  assert.equal(documents.get(base + 'payCycles/' + month).savingsAmount, 0);
  documents.set(base + 'payCycles/' + month, { ...tableCycle, savingsAmount: undefined, allocations: [{ potId: 'holiday', amount: 1000 }], sourceAdjustments: { salary: { advanceAmount: 2000, allocations: [{ potId: 'holiday', amount: 1000 }] } } });
  documents.set(base + 'savingsPots/holiday', { currentAmount: 1500, archived: false });
  await paydayContext.savePayCycle(month, { fixedAmount: 1500, variableAmount: 500, debtAmount: 700, incomeTable: { sources: [{ id: 'salary' }, { id: 'claim' }], sourceId: 'salary', adjustment: { savingsAmount: 700 }, availableBuffer: 2000 } });
  assert.equal(documents.get(base + 'savingsPots/holiday').currentAmount, 1500);
  assert.equal(documents.get(base + 'payCycles/' + month).savingsAmount, 700);
  assert.equal(documents.get(base + 'payCycles/' + month).legacySavingsAllocations[0].amount, 1000);
  paydayContext.WR.repos = { incomeSources: { getAll: async () => [documents.get(base + 'incomeSources/salary'), documents.get(base + 'incomeSources/claim')] } };
  paydayContext.WR.financial = { calculateTotalMinPayments: context.calculateTotalMinPayments };
  paydayContext.WR.ui._activeBudgetMonth = undefined;
  documents.set(base + 'userProfile/profile', { id: 'profile', baseCurrency: 'ZAR', autoUseBuffer: false });
  const rolloverData = { profile: { id: 'profile', baseCurrency: 'ZAR' }, incomeSources: [{ id: 'roll-salary', year: 2026, amount: 10000, frequency: 'monthly' }], fixedExpenses: [], budgetLines: [], debts: [], exchangeRates: [], accounts: [], transactions: [{ date: '2026-10-24', kind: 'spend', amount: 2500 }, { date: '2026-10-25', kind: 'spend', amount: 999 }], cycles: [{ ...funding, month: '2026-10', payDate: '2026-09-25', confirmed: true }], advances: [] };
  assert.equal(await paydayContext.ensurePaydayRollover(rolloverData, '2026-11', '2026-10-24'), undefined);
  const manualRollover = await paydayContext.ensurePaydayRollover(rolloverData, '2026-11', '2026-10-25');
  assert.equal(manualRollover.rolloverAvailable, 1500);
  assert.equal(manualRollover.bufferAmount, 0);
  const repeatRollover = await paydayContext.ensurePaydayRollover({ ...rolloverData, accounts: [{ year: 2026, startingBalance: 9999 }] }, '2026-11', '2026-10-25');
  assert.equal(repeatRollover.rolloverAvailable, 1500);
  assert.equal(repeatRollover.bufferAmount, 0);
  documents.delete(base + 'payCycles/2026-11');
  documents.set(base + 'userProfile/profile', { id: 'profile', baseCurrency: 'ZAR', autoUseBuffer: true });
  const autoRollover = await paydayContext.ensurePaydayRollover(rolloverData, '2026-11', '2026-10-25');
  assert.equal(autoRollover.bufferAmount, 1500);
  assert.equal(paydayContext.calculatePayCycleFunding(autoRollover).budget, 11500);
  documents.delete(base + 'payCycles/2026-11');
  const negativeRollover = await paydayContext.ensurePaydayRollover({ ...rolloverData, transactions: [{ date: '2026-10-24', kind: 'spend', amount: 4500 }] }, '2026-11', '2026-10-25');
  assert.equal(negativeRollover.rolloverAvailable, -500);
  assert.equal(negativeRollover.bufferAmount, 0);
  assert.equal(negativeRollover.shortfallAmount, 500);
  assert.equal(paydayContext.calculatePayCycleFunding(negativeRollover).budget, 9500);
  const yearRollover = await paydayContext.ensurePaydayRollover({ ...rolloverData, incomeSources: [{ id: 'new-year-salary', year: 2027, amount: 10000, frequency: 'monthly' }], transactions: [], cycles: [{ ...funding, month: '2026-12', payDate: '2026-11-25', confirmed: true }] }, '2027-01', '2026-12-25');
  assert.equal(yearRollover.rolloverSourceMonth, '2026-12');
  assert.equal(yearRollover.rolloverAvailable, 4000);
  const correction = { fixedAmount: 0, variableAmount: 0, debtAmount: 0, incomeTable: { sources: [{ id: 'salary' }, { id: 'claim' }], profileId: 'profile', availableBuffer: 4000, openingBuffer: 0 } };
  await paydayContext.savePayCycle(month, correction);
  assert.equal(documents.get(base + 'payCycles/' + month).rolloverAvailable, 0);
  assert.equal(documents.get(base + 'payCycles/' + month).bufferAmount, 0);
  assert.equal(documents.get(base + 'payCycles/' + month).shortfallAmount, 0);
  assert.equal(documents.get(base + 'payCycles/' + month).bufferCorrected, true);
  await paydayContext.savePayCycle(month, { ...correction, incomeTable: { ...correction.incomeTable, openingBuffer: 1200 } });
  assert.equal(documents.get(base + 'payCycles/' + month).bufferAmount, 1200);
  documents.set(base + 'userProfile/profile', { id: 'profile', baseCurrency: 'ZAR', autoUseBuffer: false });
  await paydayContext.savePayCycle(month, { ...correction, incomeTable: { ...correction.incomeTable, openingBuffer: 500 } });
  assert.equal(documents.get(base + 'payCycles/' + month).bufferAmount, 500);
  await paydayContext.savePayCycle(month, { ...correction, incomeTable: { ...correction.incomeTable, openingBuffer: -250 } });
  assert.equal(documents.get(base + 'payCycles/' + month).bufferAmount, 0);
  assert.equal(documents.get(base + 'payCycles/' + month).shortfallAmount, 250);
  await assert.rejects(() => paydayContext.savePayCycle(month, { ...correction, incomeTable: { ...correction.incomeTable, openingBuffer: 'invalid' } }), /valid buffer/);
  const depositMonth = paydayContext.currentBudgetMonth();
  const depositPath = base + 'payCycles/' + depositMonth;
  documents.set(depositPath, { id: depositMonth, month: depositMonth, payDate: paydayContext.payCycleDates(depositMonth).start, mode: 'income-table', confirmed: true, expectedIncome: 10500, advanceAmount: 0, savingsAmount: 0, fixedAmount: 1500, variableAmount: 500, debtAmount: 600, rolloverApplied: true, rolloverAvailable: 1000, bufferAmount: 400, sourceAdjustments: {} });
  const depositFields = { fixedAmount: 1500, variableAmount: 500, debtAmount: 600, incomeTable: { sources: [{ id: 'salary' }, { id: 'claim' }], profileId: 'profile', availableBuffer: 1000, addFunds: { id: 'funds-one', amount: 500 } } };
  await paydayContext.savePayCycle(depositMonth, depositFields);
  await paydayContext.savePayCycle(depositMonth, depositFields);
  assert.equal(documents.get(depositPath).rolloverAvailable, 1500);
  assert.equal(documents.get(depositPath).bufferAmount, 400);
  assert.equal(Object.keys(documents.get(depositPath).bufferDeposits).length, 1);
  assert.equal(documents.get(base + 'savingsPots/holiday').currentAmount, 1500);
  await assert.rejects(() => paydayContext.savePayCycle(depositMonth, { ...depositFields, incomeTable: { ...depositFields.incomeTable, addFunds: { id: 'zero-funds', amount: 0 } } }), /greater than zero/);
  await assert.rejects(() => paydayContext.savePayCycle(depositMonth, { ...depositFields, incomeTable: { ...depositFields.incomeTable, addFunds: { id: 'negative-funds', amount: -100 } } }), /zero or greater/);
  documents.set(base + 'userProfile/profile', { id: 'profile', baseCurrency: 'ZAR', autoUseBuffer: true });
  await paydayContext.savePayCycle(depositMonth, { ...depositFields, incomeTable: { ...depositFields.incomeTable, addFunds: { id: 'funds-two', amount: 250 } } });
  assert.equal(documents.get(depositPath).rolloverAvailable, 1750);
  assert.equal(documents.get(depositPath).bufferAmount, 1750);
  documents.set(depositPath, { ...documents.get(depositPath), rolloverAvailable: -300, bufferAmount: 0, shortfallAmount: 300 });
  await paydayContext.savePayCycle(depositMonth, { ...depositFields, incomeTable: { ...depositFields.incomeTable, addFunds: { id: 'cover-shortfall', amount: 200 } } });
  assert.equal(documents.get(depositPath).rolloverAvailable, -100);
  assert.equal(documents.get(depositPath).shortfallAmount, 100);
  assert.equal(documents.get(depositPath).bufferAmount, 0);
  paydayContext.WR.ui.buildSnapshot = async () => ({ cashflow: { fixedExpenses: 1500, variableExpenses: 500 }, debts: [{ currency: 'ZAR', currentBalance: 10000, minPayment: 600, paymentFrequency: 'monthly' }], exchangeRates: [], profile: { baseCurrency: 'ZAR' }, payCycleBudget: { carryOver: 2000 }, debtPayments: [{ month, amount: 9999 }] });
  vm.runInContext(functions.get('saveIncomeBudget'), paydayContext);
  await paydayContext.saveIncomeBudget(month);
  assert.equal(documents.get(base + 'payCycles/' + month).debtAmount, 600);
  assert.ok(!functions.get('renderDashboard').includes('since last recorded snapshot'));
  let paydayMarkup = '';
  paydayContext.WR.repos = Object.fromEntries(['payCycles', 'payAdvances', 'savingsPots', 'dayToDayTransactions'].map(store => [store, { getAll: async () => store === 'payCycles' ? [{ month: '2026-10', advanceAmount: 2000 }] : [] }]));
  paydayContext.WR.repos.incomeSources = { getAll: async () => [{ id: 'salary', name: 'Salary', year: 2026, amount: 10000, frequency: 'monthly', startMonth: '2026-01', endMonth: '2026-12' }] };
  paydayContext.WR.models = { newId: () => 'preview' };
  Object.assign(paydayContext.WR.ui, {
    _paydayMonth: '2026-10', getOrCreateProfile: async () => ({ baseCurrency: 'ZAR' }),
    buildSnapshot: async () => ({ payCycleBudget: { carryOver: 500 } }),
    currentMonthKey: paydayContext.currentMonthKey, escapeText: context.escapeText,
    fmt: number => Number(number).toFixed(2), setHTML: (_container, markup) => { paydayMarkup = markup; },
  });
  paydayContext.document = { getElementById: () => ({ addEventListener() {} }) };
  paydayContext.RECURRING_FREQUENCIES = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];
  vm.runInContext(functions.get('recurringFrequencyOptions') + '\n' + functions.get('renderIncome'), paydayContext);
  await paydayContext.renderIncome({ querySelector: () => ({ addEventListener() {} }), querySelectorAll: () => [] });
  assert.ok(paydayMarkup.includes('id="income-total">ZAR 8000.00'));
  assert.ok(paydayMarkup.includes('<th>Advance</th><th>Savings taken</th>'));
  assert.ok(paydayMarkup.includes('<h2>Buffer</h2>'));
  assert.ok(paydayMarkup.includes('id="income-buffer-opening-form"'));
  assert.ok(paydayMarkup.includes('id="income-buffer-funds-form"'));
  assert.ok(paydayMarkup.includes('<summary>Edit balance</summary>'));
  assert.ok(paydayMarkup.includes('class="buffer-layout"'));
  assert.ok(paydayMarkup.includes('type="checkbox" role="switch"'));
  assert.ok(!paydayMarkup.includes('next payday excluded'));
  assert.ok(!paydayMarkup.includes('id="payday-form"'));
  assert.ok(!paydayMarkup.includes('data-field="potId"'));
  const controls = Object.fromEntries(['amount', 'advanceAmount', 'savingsAmount'].map(field => [field, { dataset: { field }, value: field === 'amount' ? '10000' : field === 'advanceAmount' ? '2000' : '0', events: {}, addEventListener(event, listener) { this.events[event] = listener; } }]));
  const row = { dataset: { id: 'salary' }, querySelectorAll: () => Object.values(controls), querySelector: selector => controls[selector.match(/data-field="([^"]+)"/)[1]] };
  const total = {};
  const liveContainer = { querySelector: () => total, querySelectorAll: selector => selector === '.income-table tbody tr[data-id]' ? [row] : [] };
  await paydayContext.renderIncome(liveContainer);
  controls.advanceAmount.value = '3000';
  controls.advanceAmount.events.input();
  assert.equal(total.textContent, 'ZAR 7000.00');
  controls.savingsAmount.value = '500';
  controls.savingsAmount.events.input();
  assert.equal(total.textContent, 'ZAR 6500.00');
  let freshReads = 0;
  const cached = { docs: [{ data: () => ({ advanceAmount: 2000 }) }] };
  const current = { docs: [{ data: () => ({ advanceAmount: 3000 }) }] };
  const repositoryContext = {
    requireContext: () => ({ uid: 'test', db: {}, api: { collection: () => ({ path: 'payCycles' }), getDocsFromServer: async () => { freshReads++; return current; } } }),
    readDocs: async () => cached,
  };
  vm.createContext(repositoryContext);
  vm.runInContext(functions.get('createRepository'), repositoryContext);
  const cycleRepo = repositoryContext.createRepository('payCycles');
  assert.equal((await cycleRepo.getAll())[0].advanceAmount, 2000);
  assert.equal((await cycleRepo.getAll({ fresh: true }))[0].advanceAmount, 3000);
  assert.equal(freshReads, 1);
  console.log('Payday funding, inline income deductions, buffer single counting, atomic savings, linked receipts, and compact Income layout passed.');
}
checkPaydayBudget().catch(error => { console.error(error); process.exitCode = 1; });

async function checkPayments() {
  const documents = new Map();
  const debtPath = 'users/test/debts/loan';
  const ledgerPath = 'users/test/debtPayments';
  const copy = value => JSON.parse(JSON.stringify(value));
  const api = {
    doc: (_database, ...parts) => parts.join('/'),
    collection: (_database, ...parts) => parts.join('/'),
    where: (field, _operator, value) => ({ field, value }),
    query: (collection, filter) => ({ collection, filter }),
    getDocsFromServer: async query => {
      const collection = typeof query === 'string' ? query : query.collection;
      const filter = typeof query === 'string' ? null : query.filter;
      return { docs: [...documents].filter(([key, value]) => key.startsWith(collection + '/') && (!filter || value[filter.field] === filter.value)).map(([key, value]) => ({ id: key.split('/').pop(), data: () => copy(value) })) };
    },
    runTransaction: async (_database, operation) => operation({
      get: async key => ({ exists: () => documents.has(key), data: () => copy(documents.get(key)) }),
      set: (key, value) => documents.set(key, copy(value)),
      delete: key => documents.delete(key),
    }),
  };
  context.WR.financial.monthlyMinPayment = context.monthlyMinPayment;
  context.WR.ui = { getOrCreateProfile: async () => ({ baseCurrency: 'ZAR' }) };
  context.WR.account = { getCurrentUser: () => ({ uid: 'test' }), getFirestoreApi: () => api, getDb: () => ({}) };
  documents.set(debtPath, { id: 'loan', currency: 'USD', currentBalance: 2000, minPayment: 100, paymentFrequency: 'monthly' });
  await context.setDebtPaymentStatus('loan', '2026-10', true);
  await context.setDebtPaymentStatus('loan', '2026-10', true);
  assert.equal(documents.get(debtPath).currentBalance, 1900);
  assert.equal([...documents.keys()].filter(key => key.startsWith(ledgerPath)).length, 1);
  await context.setDebtPaymentStatus('loan', '2026-10', false);
  await context.setDebtPaymentStatus('loan', '2026-10', false);
  assert.equal(documents.get(debtPath).currentBalance, 2000);
  assert.equal([...documents.keys()].filter(key => key.startsWith(ledgerPath)).length, 0);
  documents.set(debtPath, { ...documents.get(debtPath), currentBalance: 75 });
  await context.setDebtPaymentStatus('loan', '2026-10', true);
  assert.equal(documents.get(debtPath).currentBalance, 0);
  assert.equal(documents.get(ledgerPath + '/monthly-loan-2026-10').amount, 75);
  assert.ok(documents.get(debtPath).paidOffDate);
  await context.setDebtPaymentStatus('loan', '2026-10', false);
  assert.equal(documents.get(debtPath).currentBalance, 75);
  assert.equal(documents.get(debtPath).paidOffDate, undefined);
  documents.set(debtPath, { ...documents.get(debtPath), currentBalance: 150 });
  documents.set(ledgerPath + '/legacy', { id: 'legacy', debtId: 'loan', month: '2026-10', amount: 50 });
  await context.setDebtPaymentStatus('loan', '2026-10', true);
  assert.equal(documents.get(debtPath).currentBalance, 150);
  await context.setDebtPaymentStatus('loan', '2026-10', false);
  assert.equal(documents.get(debtPath).currentBalance, 200);
  console.log('Payment idempotency, reversal, final installments, and legacy-record checks passed.');
}
checkPayments().catch(error => { console.error(error); process.exitCode = 1; });
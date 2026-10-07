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
        expenseCategories: repo([]), emergencyFundContributions: repo([]),
      },
      ui: {
        _dayMonth: '2026-10', getOrCreateProfile: async () => ({ baseCurrency: 'ZAR' }),
        previousMonthKey: () => '2026-09', escapeText: context.escapeText,
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
  assert.equal((markup.match(/class="day-date-group"/g) || []).length, 2);
  assert.equal((markup.match(/<tr data-id=/g) || []).length, 3);
  assert.ok(markup.includes('2 transactions'));
  assert.ok(markup.includes('1 transaction</span>'));
  assert.ok(markup.includes('day-credit'));
  assert.ok(markup.includes('data-label="Amount (ZAR)"'));
  assert.ok(markup.includes('&lt;unsafe&gt;'));
  assert.ok(!markup.includes("of this month's day-to-day spending"));
  assert.ok(selectors.includes('.day-ledger tbody tr[data-id]'));
  transactions.length = 0;
  await layoutContext.renderDayToDay(container);
  assert.ok(markup.includes('No day-to-day transactions yet.'));
  assert.equal((markup.match(/class="day-date-group"/g) || []).length, 0);
  console.log('Transaction date grouping, counts, mobile labels, escaping, edit binding, and empty-state checks passed.');
}
checkTransactionLayout().catch(error => { console.error(error); process.exitCode = 1; });

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
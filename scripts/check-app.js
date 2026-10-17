const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const acorn = require('acorn');

const root = path.resolve(__dirname, '..');
if (process.argv.includes('--prepare')) {
  fs.mkdirSync(path.join(root, 'vendor'), { recursive: true });
  fs.copyFileSync(require.resolve('dompurify/dist/purify.min.js'), path.join(root, 'vendor/purify.min.js'));
  fs.copyFileSync(require.resolve('papaparse/papaparse.min.js'), path.join(root, 'vendor/papaparse.min.js'));
}

const htmlPath = path.join(root, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');
const functions = new Map();
let themeModule;
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
    if (node.type === 'FunctionExpression' && node.body.body.some(statement => statement.type === 'FunctionDeclaration' && statement.id.name === 'followSystemTheme')) {
      themeModule = source.slice(node.start, node.end);
    }
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
const serviceWorkerSource = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
acorn.parse(serviceWorkerSource, { ecmaVersion: 'latest' });
const passkeyWorkerSource = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');
acorn.parse(passkeyWorkerSource, { ecmaVersion: 'latest', sourceType: 'module' });
const passkeyMigration = fs.readFileSync(path.join(root, 'migrations/0001_passkeys.sql'), 'utf8');
assert.match(passkeyWorkerSource, /securetoken\.google\.com\/\$\{env\.FIREBASE_PROJECT_ID\}/);
assert.match(passkeyWorkerSource, /DELETE FROM passkey_challenges WHERE challenge_id = \? AND purpose = \? AND expires_at > \? RETURNING/);
assert.match(passkeyWorkerSource, /requireUserVerification: true/);
assert.match(passkeyWorkerSource, /\/passkeys\/register\/options/);
assert.match(passkeyWorkerSource, /\/passkeys\/auth\/verify/);
assert.match(passkeyWorkerSource, /private_key_id/);
assert.match(passkeyMigration, /CREATE TABLE passkeys/);
assert.match(passkeyMigration, /CREATE TABLE passkey_challenges/);
assert.match(html, /PASSKEY_WORKER_URL/);
assert.match(html, /wr_passkey_lock_pending/);
assert.match(html, /auth-passkey-btn/);
async function checkServiceWorkerFallbacks() {
  const handlers = {};
  const cachedResponses = new Map();
  const origin = 'https://example.com';
  const workerContext = {
    URL, Response,
    self: { location: { origin }, addEventListener: (type, handler) => { handlers[type] = handler; } },
    caches: { match: async request => cachedResponses.get(typeof request === 'string' ? request : request.url) },
    fetch: async () => { throw new Error('Network unavailable'); },
  };
  vm.runInNewContext(serviceWorkerSource, workerContext);
  const shell = new Response('<html>App shell</html>', { headers: { 'Content-Type': 'text/html' } });
  cachedResponses.set('./index.html', shell);
  function dispatch(url, mode, destination) {
    let response;
    handlers.fetch({ request: { url, method: 'GET', mode, destination }, respondWith: value => { response = value; } });
    return response;
  }
  assert.equal(dispatch('https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js', 'cors', 'script'), undefined, 'External modules must bypass the app-shell worker');
  assert.equal((await dispatch(`${origin}/vendor/missing.js`, 'cors', 'script')).type, 'error', 'Failed scripts must never receive HTML');
  assert.equal(await dispatch(`${origin}/wealth-route/`, 'navigate', 'document'), shell, 'Offline navigations should still receive the app shell');
  cachedResponses.delete('./index.html');
  cachedResponses.set('./', shell);
  assert.equal(await dispatch(`${origin}/wealth-route/`, 'navigate', 'document'), shell, 'Navigation fallback must await the index lookup before trying the root');
  const script = new Response('window.cached = true;', { headers: { 'Content-Type': 'text/javascript' } });
  cachedResponses.set(`${origin}/vendor/cached.js`, script);
  assert.equal(await dispatch(`${origin}/vendor/cached.js`, 'cors', 'script'), script, 'Cached local scripts must remain available offline');
  cachedResponses.clear();
  assert.equal((await dispatch(`${origin}/wealth-route/`, 'navigate', 'document')).type, 'error');
  console.log('Service-worker script MIME safety and offline navigation checks passed.');
}
checkServiceWorkerFallbacks().catch(error => { console.error(error); process.exitCode = 1; });
assert.ok(!/<(?:input|select|textarea)\b[^>]*\bname="(?:name|target)"/i.test(html), 'Form field names must survive DOM-clobbering sanitization');
for (const match of fs.readFileSync(path.join(root, 'tests.html'), 'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
  acorn.parse(match[1], { ecmaVersion: 'latest' });
}

const names = ['visibilityIcon', 'bindPasswordVisibility', 'bindFinancialVisibility', 'escapeText', 'assertActiveView', 'authErrorMessage', 'monthlyMinPayment', 'debtValueInCurrency', 'calculateTotalDebt', 'calculateTotalMinPayments', 'calculateDebtToIncomeRatio', 'calculateWeightedAverageInterestRate', 'calculateLiquidAssets', 'convertCurrency', 'calculateWealth', 'calculateNetWorth', 'calculateTotalInvestments', 'sumInBaseCurrency', 'sumActualByType', 'calculateCashFlowSummary', 'calculateMoneyOwed', 'trackedPaymentForMonth', 'updateDebtPaidOffDate', 'setDebtPaymentStatus', 'parseAmount', 'normalizeTransactionImportDate', 'transactionImportDuplicateKey', 'prepareTransactionImportRows', 'findRecurringSpendPatterns', 'summarizeTransactionPeriod'];
const context = { WR: { financial: {} } };
vm.createContext(context);
vm.runInContext(functions.get('calculateEmergencyBorrowing'), context);
context.WR.financial.calculateEmergencyBorrowing = context.calculateEmergencyBorrowing;
vm.runInContext(functions.get('calculateEmergencyAccountSummary'), context);
context.WR.financial.calculateEmergencyAccountSummary = context.calculateEmergencyAccountSummary;
vm.runInContext(names.filter(name => functions.has(name)).map(name => functions.get(name)).join('\n'), context);
context.WR.financial.convertCurrency = context.convertCurrency;
const importContext = { WR: { excel: { parseAmount: context.parseAmount } } };
vm.createContext(importContext);
vm.runInContext(['normalizeTransactionImportDate', 'transactionImportDuplicateKey', 'prepareTransactionImportRows', 'findRecurringSpendPatterns'].map(name => functions.get(name)).join('\n'), importContext);
assert.equal(importContext.normalizeTransactionImportDate('31/01/2026', 'dmy'), '2026-01-31');
assert.equal(importContext.normalizeTransactionImportDate('04/05/2026', 'dmy'), '2026-05-04');
assert.equal(importContext.normalizeTransactionImportDate('04/05/2026', 'mdy'), '2026-04-05');
assert.equal(importContext.normalizeTransactionImportDate('31/02/2026', 'dmy'), '');
const importRows = importContext.prepareTransactionImportRows([
  { Date: '2026-01-02', Description: 'Coffee Shop', Amount: '(18.50)', Category: 'Food', Type: 'Card purchase' },
  { Date: '2026-01-03', Description: 'Transfer to savings', Amount: '(200)', Category: '', Type: 'Transfer' },
  { Date: '2026-01-04', Description: 'Coffee Shop', Amount: '(12)', Category: 'Food', Type: 'Card purchase' },
  { Date: '2026-01-05', Description: 'Salary deposit', Amount: '1500', Category: 'Income', Type: 'Deposit' },
], { date: 'Date', description: 'Description', amount: 'Amount', category: 'Category', type: 'Type' }, { dateFormat: 'dmy', spendSign: 'negative' }, [
  { date: '2026-01-02', description: 'coffee shop', amount: 18.5 },
]);
assert.equal(importRows[0].duplicate, true);
assert.equal(importRows[0].include, false);
assert.equal(importRows[1].possibleTransfer, true);
assert.equal(importRows[1].include, false);
assert.equal(importRows[2].amount, 12);
assert.equal(importRows[2].include, true);
assert.equal(importRows[3].notSpend, true);
assert.equal(importRows[3].problems.length, 0);
assert.equal(importRows[3].include, false);
const recurringTransactions = [
  { date: '2026-03-05', description: 'Music Plan', category: 'Subscriptions', amount: 99, kind: 'spend' },
  { date: '2026-04-05', description: 'Music Plan', category: 'Subscriptions', amount: 101, kind: 'spend' },
  { date: '2026-05-05', description: 'Music Plan', category: 'Subscriptions', amount: 100, kind: 'spend' },
  { date: '2026-06-05', description: 'Music Plan', category: 'Subscriptions', amount: 100, kind: 'spend' },
  { date: '2026-06-10', description: 'One-off', category: 'Food', amount: 500, kind: 'spend' },
  { date: '2026-06-12', description: 'Transfer', category: 'Transfer', amount: 100, kind: 'add' },
];
const recurringPatterns = importContext.findRecurringSpendPatterns(recurringTransactions, '2026-06');
assert.equal(recurringPatterns.length, 1);
assert.equal(recurringPatterns[0].description, 'Music Plan');
assert.equal(recurringPatterns[0].occurrences, 4);
assert.equal(recurringPatterns[0].averageAmount, 100);
const periodSummary = context.summarizeTransactionPeriod([
  { date: '2026-06-01', kind: 'spend', amount: 25, category: 'Food' },
  { date: '2026-06-02', kind: 'spend', amount: 50, category: '' },
  { date: '2026-05-31', kind: 'spend', amount: 999, category: 'Food' },
  { date: '2026-06-03', kind: 'add', amount: 500, category: 'Income' },
], '2026-06-01', '2026-07-01');
assert.equal(periodSummary.count, 2);
assert.equal(periodSummary.spent, 75);
assert.equal(periodSummary.topCategory.name, 'Uncategorised');
assert.equal(periodSummary.topCategory.amount, 50);
assert.equal(context.escapeText('<img onerror="test">'), '&lt;img onerror=&quot;test&quot;&gt;');
assert.match(context.authErrorMessage({ code: 'auth/unauthorized-domain' }, true), /authorized/i);
assert.match(context.authErrorMessage({ code: 'auth/new-code' }, true), /auth\/new-code/);
assert.throws(() => context.assertActiveView({ closest: () => ({ isConnected: false }) }), { name: 'AbortError' });
assert.doesNotThrow(() => context.assertActiveView({ closest: () => ({ isConnected: true }) }));
assert.equal(context.calculateMoneyOwed({ amount: 1000, interestRatePct: 10, repayments: [{ amount: 250 }] }).remaining, 850);
assert.equal(context.calculateMoneyOwed({ amount: 0.3, repayments: [{ amount: 0.1 }, { amount: 0.2 }] }).remaining, 0);
const cashflow = context.calculateCashFlowSummary([{ type: 'income', actualAmount: 10000 }, { type: 'fixed', actualAmount: 3000 }, { type: 'variable', actualAmount: 1500 }], 500);
assert.equal(cashflow.income - cashflow.totalExpenses, 5500);
assert.equal(cashflow.availableSurplus, 5000);
assert.equal(cashflow.monthlySurplus, 5500);
vm.runInContext(functions.get('calculateBudgetSpending'), context);
assert.equal(context.calculateBudgetSpending(1000, 1250).percentage, 125);
assert.equal(context.calculateBudgetSpending(1000, 1250).barPercentage, 100);
assert.equal(context.calculateBudgetSpending(1000, 1250).overBudget, 250);
assert.equal(context.calculateBudgetSpending(1000, 500).percentage, 50);
assert.equal(context.calculateBudgetSpending(0, 250).percentage, null);
assert.equal(context.calculateBudgetSpending(0, 250).overBudget, 250);
assert.equal(context.calculateBudgetSpending(1000, -100).percentage, 0);
const rates = [{ fromCurrency: 'USD', toCurrency: 'ZAR', rate: 20, date: '2026-10-06' }];
const debts = [{ currency: 'USD', currentBalance: 2000, minPayment: 100 }, { currency: 'ZAR', currentBalance: 0, minPayment: 500 }];
assert.equal(context.calculateTotalMinPayments(debts, rates, 'ZAR'), 2000);
assert.equal(context.calculateTotalDebt(debts, rates, 'ZAR'), 40000);
assert.equal(context.calculateDebtToIncomeRatio(debts, 30000, rates, 'ZAR'), 2000 / 30000);
assert.equal(context.calculateTotalMinPayments(debts, [], 'ZAR'), 0);
const investments = [{ name: 'Local', currentValue: 500, currency: 'ZAR' }, { name: 'Foreign', currentValue: 100, currency: 'USD' }];
assert.equal(context.calculateTotalInvestments(investments, rates, 'ZAR'), 2500);
assert.equal(context.calculateTotalInvestments([], rates, 'ZAR'), 0);
assert.equal(context.calculateTotalInvestments(investments, [], 'ZAR'), 500);
assert.ok(functions.get('buildSnapshot').includes('annualSummary.totalInvested = F.calculateTotalInvestments(investments, exchangeRates, profile.baseCurrency)'));
const wealthItems = [{ name: 'Home', currentValue: 10000, currency: 'ZAR' }, ...investments];
assert.equal(context.sumInBaseCurrency(wealthItems, 'currentValue', rates, 'ZAR').total, 12500);
assert.equal(context.sumInBaseCurrency([], 'currentValue', rates, 'ZAR').total, 0);
assert.equal(context.sumInBaseCurrency(wealthItems, 'currentValue', [], 'ZAR').total, 10500);
assert.equal(context.convertCurrency(100, 'EUR', 'ZAR', []).value, 0);
assert.equal(context.convertCurrency(100, 'EUR', 'ZAR', []).converted, false);
assert.equal(context.convertCurrency('100', ' zar ', 'ZAR', []).value, 100);
assert.equal(context.convertCurrency(100, 'USD', 'ZAR', [{ fromCurrency: 'ZAR', toCurrency: 'USD', rate: 0.05 }]).value, 2000);
for (const rate of [0, -2, Infinity, NaN]) {
  assert.equal(context.convertCurrency(100, 'USD', 'ZAR', [{ fromCurrency: 'USD', toCurrency: 'ZAR', rate }]).converted, false);
}
assert.equal(context.convertCurrency(1e308, 'USD', 'ZAR', rates).converted, false);
assert.equal(context.calculateNetWorth(wealthItems, [], [{ currency: 'EUR', currentBalance: 500 }], [], 'ZAR').netWorth, 10500);
const savingsBalances = [{ currentAmount: 179.23 }, { currentAmount: 999, archived: true }];
const emergencyBalances = [{ amount: 300 }, { amount: -58.47 }, { amount: -80, returned: true }];
const completeWorth = context.calculateNetWorth([{ currentValue: 144.97, currency: 'ZAR' }], [], [{ currentBalance: 7041 }], [], 'ZAR', savingsBalances, emergencyBalances);
assert.ok(Math.abs(completeWorth.totalAssets - 565.73) < 0.000001);
assert.ok(Math.abs(completeWorth.netWorth - (-6475.27)) < 0.000001);
assert.equal(completeWorth.wealth.savingsTotal, 179.23);
assert.equal(completeWorth.wealth.emergencyFundTotal, 241.53);
assert.equal(context.calculateWealth([{ currentValue: 179.23, wealthSource: 'savings' }, { currentValue: 241.53, wealthSource: 'emergency' }], [], savingsBalances, emergencyBalances, [], 'ZAR').assetsTotal, 0);
assert.equal(context.calculateWealth([], [], [{ currentAmount: 10, currency: 'USD' }], [{ amount: 5, currency: 'USD' }], rates, 'ZAR').totalWealth, 300);
assert.equal(context.calculateWealth([], [], [{ currentAmount: 10, currency: 'EUR' }], [], [], 'ZAR').unconvertedItems.length, 1);
assert.equal(context.calculateWealth([], [], [{ currentAmount: -10 }], [{ amount: -5 }], [], 'ZAR').totalWealth, -15);
assert.equal(context.calculateWealth([], [], [], [], [], 'ZAR').totalWealth, 0);
vm.runInContext(functions.get('calculateReserveBorrowing'), context);
const reserveLoans = [
  { borrowings: [{ amount: 200.3, repayments: [{ amount: 50.1 }] }, { amount: 100, repayments: [{ amount: 100 }] }] },
  { archived: true, borrowings: [{ amount: 10, repayments: [] }] },
];
const reserveEmergency = [{ amount: 1000 }, { amount: -50.25 }, { amount: -80, returned: true }, { amount: -100, transferId: 'transfer' }];
const reserveBorrowing = context.calculateReserveBorrowing(reserveLoans, reserveEmergency, [], 'ZAR');
assert.equal(reserveBorrowing.savings, 160.2);
assert.equal(reserveBorrowing.emergency, 50.25);
assert.equal(reserveBorrowing.total, 210.45);
assert.equal(context.calculateReserveBorrowing([], [], [], 'ZAR').total, 0);
const partialEmergency = { amount: -200.3, repayments: [{ amount: 50.1, date: '2026-10-10' }] };
const accountEntries = [
  { account: 'fnb', amount: 551 }, { account: 'fnb', amount: -100 }, { account: 'moneyclub', amount: -140.53 },
];
const fnbSummary = context.calculateEmergencyAccountSummary(accountEntries, 'fnb', 'moneyclub');
assert.equal(fnbSummary.total, 451);
assert.equal(fnbSummary.outstanding, 100);
const correctedAccountEntries = [...accountEntries,
  { account: 'fnb', amount: -450, balanceAdjustment: true },
  { account: 'moneyclub', amount: 140.53, balanceAdjustment: true },
];
assert.equal(context.calculateEmergencyAccountSummary(correctedAccountEntries, 'fnb', 'moneyclub').total, 1);
assert.equal(context.calculateEmergencyAccountSummary(correctedAccountEntries, 'moneyclub', 'moneyclub').total, 0);
assert.equal(context.calculateEmergencyBorrowing(correctedAccountEntries[3]).remaining, 0);
assert.equal(context.calculateReserveBorrowing([], correctedAccountEntries, [], 'ZAR').emergency, 240.53);
assert.equal(Math.round(context.calculateWealth([], [], [], correctedAccountEntries, [], 'ZAR').emergencyFundTotal * 100), 100);
assert.equal(context.calculateEmergencyAccountSummary(accountEntries, 'moneyclub', 'moneyclub').total, -140.53);
assert.equal(context.calculateEmergencyAccountSummary([{ account: 'fnb', ...partialEmergency }, { account: 'fnb', amount: 500 }], 'fnb', 'moneyclub').total, 349.8);
assert.equal(context.calculateEmergencyAccountSummary([{ account: 'fnb', amount: -100, returned: true }], 'fnb', 'moneyclub').total, 0);
assert.equal(context.calculateEmergencyAccountSummary([{ account: 'fnb', amount: -100, transferId: 'move' }], 'fnb', 'moneyclub').outstanding, 0);
assert.equal(context.calculateEmergencyBorrowing(partialEmergency).remaining, 150.2);
assert.equal(context.calculateReserveBorrowing([], [partialEmergency], [], 'ZAR').emergency, 150.2);
assert.equal(Math.round(context.calculateWealth([], [], [], [{ amount: 500 }, partialEmergency], [], 'ZAR').emergencyFundTotal * 100), 34980);
assert.equal(context.calculateEmergencyBorrowing({ ...partialEmergency, returned: true }).remaining, 0);
assert.equal(context.calculateEmergencyBorrowing({ amount: -0.3, repayments: [{ amount: 0.1 }, { amount: 0.2 }] }).remaining, 0);
assert.equal(context.calculateEmergencyBorrowing({ ...partialEmergency, transferId: 'transfer' }).repaid, 0);
assert.equal(context.calculateReserveBorrowing([{ currency: 'USD', borrowings: [{ amount: 10 }] }], [{ currency: 'USD', amount: -5 }], rates, 'ZAR').total, 300);
assert.equal(context.calculateReserveBorrowing([{ borrowings: [{ amount: 0.3, repayments: [{ amount: 0.1 }, { amount: 0.2 }] }] }], [], [], 'ZAR').total, 0);
assert.ok(functions.get('buildSnapshot').includes('reserveBorrowing: calculateReserveBorrowing('));
assert.ok(functions.get('renderDashboard').includes('Borrowed from Reserves'));
assert.ok(functions.get('renderDashboard').includes('fmt(s.reserveBorrowing.total)'));
assert.ok(!functions.get('renderTransactions').includes('data-field="categoryId"'));
assert.ok(!functions.get('renderTransactions').includes('name="categoryId"'));
assert.ok(!functions.get('renderTransactions').includes('form.categoryId'));
assert.ok(!functions.get('renderEmergencyFund').includes('createBudgetLine'));
assert.ok(functions.get('renderAssets').includes('wealthSource: form.elements.wealthSource.value'));
assert.ok(functions.get('renderAssets').includes('data-field="wealthSource"'));
assert.ok(functions.get('ensureMonthlyNetWorthSnapshot').includes('s.activePotBalance || s.emergencyFundBalance'));
assert.equal(context.calculateLiquidAssets([{ currency: 'USD', currentValue: 100, liquidity: 'high' }, { currency: 'ZAR', currentValue: 500, liquidity: 'high' }], rates, 'ZAR'), 2500);
assert.equal(context.calculateLiquidAssets([{ currency: 'USD', currentValue: 100, liquidity: 'high' }], [], 'ZAR'), 0);
assert.ok(Math.abs(context.calculateWeightedAverageInterestRate([{ currency: 'USD', currentBalance: 100, interestRate: 0.1 }, { currency: 'ZAR', currentBalance: 1000, interestRate: 0.2 }], rates, 'ZAR') - 0.13333333333333333) < 1e-10);
assert.ok(functions.get('buildSnapshot').includes('annualSummary.totalWealth = netWorth.totalAssets'));
assert.ok(functions.get('buildSnapshot').includes('F.calculateNetWorth(assets, investments, debts, exchangeRates, profile.baseCurrency, savingsPots, emergencyFundContributions)'));
assert.ok(functions.get('refreshWealthSummary').includes('WR.financial.calculateWealth(assets, investments, savingsPots, emergencyFundContributions, exchangeRates, profile.baseCurrency)'));
assert.ok(!functions.get('renderDashboard').includes('${fmt(s.annualSummary.totalWealth)}</span>'));
assert.ok(!functions.get('renderDashboard').includes('${fmt(s.annualSummary.totalSavedAndInvested)}</span>'));
assert.ok(functions.get('renderDashboard').includes('>Total wealth</span>'));
assert.ok(functions.get('renderDashboard').includes('aria-label="Year-to-date totals"'));
assert.ok(functions.get('renderDashboard').includes('aria-label="Year-to-date overview"'));
assert.ok(functions.get('renderDashboard').includes('class="annual-heading"'));
assert.ok(functions.get('renderDashboard').includes('class="stat annual-income"'));
assert.ok(functions.get('renderDashboard').includes('class="stat annual-debt"'));
assert.ok(!functions.get('renderDashboard').includes('aria-label="Current balances"'));
assert.ok(functions.get('renderDashboard').indexOf('class="dashboard-actions"') < functions.get('renderDashboard').indexOf('class="dashboard-card annual-card"'));
assert.ok(functions.get('renderDashboard').indexOf('class="dashboard-card bills-card"') < functions.get('renderDashboard').indexOf('class="dashboard-card annual-card"'));
assert.ok(!functions.get('renderDashboard').includes('>Total Investments</span>'));
for (const viewName of ['renderAssets', 'renderInvestments']) {
  assert.ok(functions.get(viewName).includes('WR.ui.sortRecords'), `${viewName} must use the shared table sort helper`);
  assert.ok(functions.get(viewName).includes('WR.ui.recordSortHeader'), `${viewName} must use the shared table header helper`);
  assert.ok(functions.get(viewName).includes('WR.ui.bindRecordTableControls'), `${viewName} must use the shared table controls`);
}
console.log('Production scripts, safe HTML boundaries, escaping, lending balances, and surplus checks passed.');

function checkThemePreferences() {
  function start({ dark = false, saved = null, blocked = false, legacy = false, mediaAvailable = true } = {}) {
    const attributes = {};
    const button = { setAttribute: (name, value) => { attributes[name] = value; } };
    let stored = saved;
    let onChange;
    const media = { matches: dark };
    media[legacy ? 'addListener' : 'addEventListener'] = (...args) => { onChange = args[args.length - 1]; };
    const themeContext = {
      WR: { ui: { setHTML() {} } },
      window: { matchMedia: mediaAvailable ? () => media : undefined },
      document: {
        documentElement: { setAttribute: (name, value) => { attributes[name] = value; }, getAttribute: name => attributes[name] },
        getElementById: () => button,
      },
      localStorage: {
        getItem() { if (blocked) throw Error('Unavailable'); return stored; },
        setItem(_key, value) { if (blocked) throw Error('Unavailable'); stored = value; },
        removeItem() { if (blocked) throw Error('Unavailable'); stored = null; },
      },
    };
    vm.createContext(themeContext);
    vm.runInContext(`(${themeModule})();`, themeContext);
    return {
      theme: () => attributes['data-theme'], label: () => attributes['aria-label'],
      stored: () => stored, toggle: () => themeContext.WR.ui.toggleTheme(),
      preference: value => themeContext.WR.ui.setThemePreference(value),
      change(value) { media.matches = value; onChange(); },
    };
  }
  const automatic = start();
  assert.equal(automatic.theme(), 'light');
  automatic.change(true);
  assert.equal(automatic.theme(), 'dark');
  assert.equal(automatic.label(), 'Switch to light mode');
  automatic.change(false);
  assert.equal(automatic.theme(), 'light');
  assert.equal(automatic.stored(), null);
  const dark = start({ dark: true });
  assert.equal(dark.theme(), 'dark');
  dark.toggle();
  assert.equal(dark.theme(), 'light');
  assert.equal(dark.stored(), 'light');
  dark.change(false);
  dark.change(true);
  assert.equal(dark.theme(), 'light');
  dark.toggle();
  assert.equal(dark.theme(), 'dark');
  assert.equal(dark.stored(), 'dark');
  dark.preference('system');
  assert.equal(dark.stored(), null);
  dark.change(false);
  assert.equal(dark.theme(), 'light');
  dark.change(true);
  assert.equal(dark.theme(), 'dark');
  for (const saved of ['light', 'dark']) {
    const manual = start({ dark: saved === 'light', saved });
    assert.equal(manual.theme(), saved);
    manual.change(saved !== 'dark');
    assert.equal(manual.theme(), saved);
  }
  const invalid = start({ saved: 'invalid', dark: true, legacy: true });
  invalid.change(false);
  assert.equal(invalid.theme(), 'light');
  const restricted = start({ blocked: true, dark: true });
  restricted.change(false);
  assert.equal(restricted.theme(), 'light');
  assert.doesNotThrow(() => restricted.toggle());
  restricted.change(false);
  assert.equal(restricted.theme(), 'dark');
  assert.equal(start({ mediaAvailable: false }).theme(), 'light');
  console.log('Device theme defaults, live changes, manual overrides, legacy listeners, and unavailable storage checks passed.');
}
checkThemePreferences();

async function checkDeleteUndo() {
  const records = new Map([['entry-1', { id: 'entry-1', amount: 75 }]]);
  let undoAction;
  let refreshed = 0;
  const context = {
    WR: { ui: {} },
    notifyUndo(_message, action) { undoAction = action; },
  };
  vm.createContext(context);
  vm.runInContext(functions.get('removeWithUndo'), context);
  await context.removeWithUndo({
    repo: {
      async getById(id) { return records.get(id); },
      async remove(id) { records.delete(id); },
      async add(item) { records.set(item.id, item); },
    },
    id: 'entry-1',
    entityLabel: 'Test entry',
    afterChange: async () => { refreshed += 1; },
  });
  assert.equal(records.has('entry-1'), false);
  assert.equal(refreshed, 1);
  assert.equal(typeof undoAction, 'function');
  await undoAction();
  assert.deepEqual(records.get('entry-1'), { id: 'entry-1', amount: 75 });
  assert.equal(refreshed, 2);
  console.log('Record deletion and Undo restore the original entry and refresh the view.');
}
checkDeleteUndo().catch(error => { console.error(error); process.exitCode = 1; });

async function checkSaveFeedback() {
  const status = { dataset: {}, textContent: '' };
  const feedback = { dataset: {}, textContent: '' };
  const controls = [{ value: 'Unsaved entry', disabled: false }, { disabled: true }];
  const form = {
    dataset: {}, attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    querySelectorAll: () => controls, querySelector: () => feedback,
  };
  const listeners = new Map();
  const state = { pending: 0, failed: false, saved: false };
  let expireSaved;
  const saveContext = {
    state, navigator: { onLine: true },
    setTimeout(callback, delay) { assert.equal(delay, 2500); expireSaved = callback; return 1; },
    clearTimeout() { expireSaved = null; },
    document: { getElementById: () => status },
    window: { addEventListener: (name, listener) => listeners.set(name, listener), removeEventListener: name => listeners.delete(name) },
    WR: { saves: { state }, ui: { notify() {} } },
  };
  vm.createContext(saveContext);
  vm.runInContext('let savedTimer = null;\n' + ['trackSave', 'renderSaveStatus', 'submitWithFeedback'].map(name => functions.get(name)).join('\n'), saveContext);
  saveContext.WR.ui.renderSaveStatus = saveContext.renderSaveStatus;
  saveContext.renderSaveStatus();
  assert.equal(status.textContent, '');
  assert.equal(status.hidden, true);
  let acknowledge;
  let writes = 0;
  const operation = () => saveContext.trackSave(() => { writes += 1; return new Promise(resolve => { acknowledge = resolve; }); });
  const pending = saveContext.submitWithFeedback(form, operation);
  assert.equal(status.textContent, 'Saving...');
  assert.equal(status.hidden, false);
  assert.equal(form.attributes['aria-busy'], 'true');
  assert.ok(controls.every(control => control.disabled));
  assert.equal(await saveContext.submitWithFeedback(form, operation), false);
  assert.equal(writes, 1);
  saveContext.navigator.onLine = false;
  saveContext.renderSaveStatus();
  listeners.get('offline')();
  assert.equal(status.textContent, 'Offline - waiting to sync');
  assert.equal(feedback.textContent, 'Offline - waiting to sync');
  assert.equal(state.saved, false);
  saveContext.navigator.onLine = true;
  acknowledge();
  assert.equal(await pending, true);
  assert.equal(status.textContent, 'Saved');
  assert.equal(controls[0].disabled, false);
  assert.equal(controls[1].disabled, true);
  assert.equal(listeners.size, 0);
  expireSaved();
  assert.equal(state.saved, false);
  assert.equal(status.hidden, true);
  assert.equal(status.textContent, '');
  const failed = await saveContext.submitWithFeedback(form, () => saveContext.trackSave(() => Promise.reject(Error('Denied'))));
  assert.equal(failed, false);
  assert.equal(controls[0].value, 'Unsaved entry');
  assert.equal(feedback.dataset.state, 'error');
  assert.equal(status.dataset.state, 'error');
  assert.equal(state.pending, 0);
  assert.equal(form.attributes['aria-busy'], 'false');
  assert.equal(await saveContext.submitWithFeedback(form, () => saveContext.trackSave(() => Promise.resolve())), true);
  assert.equal(status.textContent, 'Saved');
  expireSaved();
  assert.equal(status.hidden, true);
  console.log('Pending/offline acknowledgement, duplicate-submit guards, failure/retry, preserved entries, and control restoration checks passed.');
}
checkSaveFeedback().catch(error => { console.error(error); process.exitCode = 1; });

async function checkReliableDrafts() {
  let uid = 'first';
  const draftContext = {
    WR: { account: { getCurrentUser: () => ({ uid }) }, ui: { notify() {} } },
    window: { location: { hash: '#/settings' }, addEventListener() {}, removeEventListener() {} },
    navigator: { onLine: true },
  };
  vm.createContext(draftContext);
  vm.runInContext('const formDrafts = new Map(); const pendingForms = new Set();\n' + ['formDraftKey', 'draftFields', 'captureFormDraft', 'captureFormDrafts', 'clearFormDraft', 'clearFormDrafts', 'submitWithFeedback', 'bindReliableForm'].map(name => functions.get(name)).join('\n'), draftContext);
  function form() {
    const fields = [{ name: 'name', type: 'text', value: '', disabled: false }, { name: 'amount', type: 'number', value: '', disabled: false }, { name: 'password', type: 'password', value: '', disabled: false }];
    const feedback = { dataset: {}, textContent: '' };
    return {
      id: 'test-form', dataset: {}, fields, feedback, events: {}, isConnected: true,
      querySelectorAll: () => fields, querySelector: () => feedback,
      closest: () => ({ open: false }), setAttribute() {},
      addEventListener(event, listener) { this.events[event] = listener; },
    };
  }
  let saved = false;
  const original = form();
  draftContext.bindReliableForm(original, async () => { throw Error('Denied'); });
  original.fields[0].value = 'Unsaved name';
  original.fields[1].value = '120';
  original.fields[2].value = 'do-not-retain';
  original.events.input();
  await original.events.submit({ preventDefault() {} });
  assert.equal(original.feedback.dataset.state, 'error');
  const restored = form();
  draftContext.bindReliableForm(restored, async () => {}, () => { saved = true; });
  assert.equal(restored.fields[0].value, 'Unsaved name');
  assert.equal(restored.fields[1].value, '120');
  assert.equal(restored.fields[2].value, '');
  uid = 'second';
  const isolated = form();
  draftContext.bindReliableForm(isolated, async () => {});
  assert.equal(isolated.fields[0].value, '');
  uid = 'first';
  await restored.events.submit({ preventDefault() {} });
  assert.equal(saved, true);
  const clean = form();
  draftContext.bindReliableForm(clean, async () => {});
  assert.equal(clean.fields[0].value, '');
  original.events.input();
  draftContext.clearFormDrafts();
  const signedOut = form();
  draftContext.bindReliableForm(signedOut, async () => {});
  assert.equal(signedOut.fields[0].value, '');
  console.log('Session draft restoration, save failure/retry, password exclusion, account isolation, and sign-out clearing checks passed.');
}
checkReliableDrafts().catch(error => { console.error(error); process.exitCode = 1; });

async function checkEmergencyAtomicWrites() {
  const records = new Map();
  let rejectCommit = false;
  const api = {
    doc: (_db, ...parts) => parts.join('/'),
    async runTransaction(_db, operation) {
      const writes = [];
      await operation({ set: (key, value) => writes.push(() => records.set(key, value)) });
      if (rejectCommit) throw Error('Rejected commit');
      writes.forEach(write => write());
    },
  };
  const emergencyContext = { WR: { account: { getCurrentUser: () => ({ uid: 'test' }), getFirestoreApi: () => api, getDb: () => ({}) } } };
  vm.createContext(emergencyContext);
  vm.runInContext(functions.get('saveEmergencyFundEntries'), emergencyContext);
  const entries = [{ id: 'out', amount: -100, note: undefined }, { id: 'in', amount: 100 }];
  rejectCommit = true;
  await assert.rejects(emergencyContext.saveEmergencyFundEntries(entries));
  assert.equal(records.size, 0);
  rejectCommit = false;
  await emergencyContext.saveEmergencyFundEntries(entries);
  assert.equal(records.size, 2);
  assert.equal(records.get('users/test/emergencyFundContributions/out').amount, -100);
  assert.ok(!Object.hasOwn(records.get('users/test/emergencyFundContributions/out'), 'note'));
  records.clear();
  await emergencyContext.saveEmergencyFundEntries([entries[0]]);
  assert.equal(records.size, 1);
  assert.equal(records.get('users/test/emergencyFundContributions/out').amount, -100);
  assert.ok([...records.keys()].every(key => key.includes('/emergencyFundContributions/')));
  console.log('Emergency transfers remain atomic; borrowing records only fund activity, with no variable expense.');
}
checkEmergencyAtomicWrites().catch(error => { console.error(error); process.exitCode = 1; });

async function checkSavingsBorrowing() {
  let pot = { id: 'holiday', currentAmount: 500, archived: false };
  let rejectCommit = false;
  const copy = value => JSON.parse(JSON.stringify(value));
  const api = {
    doc: (_db, ...parts) => parts.join('/'),
    async runTransaction(_db, operation) {
      let pending;
      await operation({
        get: async ref => {
          assert.equal(ref, 'users/test/savingsPots/holiday');
          return { exists: () => Boolean(pot), data: () => copy(pot) };
        },
        update: (_ref, fields) => { pending = copy(fields); },
      });
      if (rejectCommit) throw new Error('Rejected commit');
      if (pending) pot = { ...pot, ...pending };
    },
  };
  const savingsContext = { WR: { account: { getCurrentUser: () => ({ uid: 'test' }), getFirestoreApi: () => api, getDb: () => ({}) } } };
  vm.createContext(savingsContext);
  vm.runInContext(['calculateSavingsLoan', 'saveSavingsBorrowing'].map(name => functions.get(name)).join('\n'), savingsContext);
  const save = (entry, loanId) => savingsContext.saveSavingsBorrowing('holiday', entry, loanId);
  const borrow = { id: 'loan', amount: 200.3, date: '2026-01-01', note: 'Car repair' };
  rejectCommit = true;
  await assert.rejects(save(borrow), /Rejected commit/);
  assert.equal(pot.currentAmount, 500);
  assert.equal(pot.borrowings, undefined);
  rejectCommit = false;
  await save(borrow);
  assert.equal(pot.currentAmount, 299.7);
  assert.equal(pot.borrowings[0].note, 'Car repair');
  await save(borrow);
  assert.equal(pot.currentAmount, 299.7);
  assert.equal(pot.borrowings.length, 1);
  const unchanged = JSON.stringify(pot);
  await assert.rejects(save({ ...borrow, id: 'too-large', amount: 300 }), /Insufficient/);
  for (const invalid of [0, -1, NaN, Infinity, 0.001]) await assert.rejects(save({ ...borrow, amount: invalid }));
  for (const date of ['2026-02-30', 'bad-date', '2999-01-01']) await assert.rejects(save({ ...borrow, date }));
  await assert.rejects(save({ id: 'payment', amount: 10, date: '2025-12-31' }, 'loan'), /before/);
  await assert.rejects(save({ id: 'payment', amount: 201, date: '2026-01-02' }, 'loan'), /outstanding/);
  await assert.rejects(save({ id: 'payment', amount: 10, date: '2026-01-02' }, 'missing'), /no longer exists/);
  assert.equal(JSON.stringify(pot), unchanged);
  const payment = { id: 'payment', amount: 50.1, date: '2026-01-02' };
  rejectCommit = true;
  await assert.rejects(save(payment, 'loan'));
  assert.equal(JSON.stringify(pot), unchanged);
  rejectCommit = false;
  await save(payment, 'loan');
  assert.equal(pot.currentAmount, 349.8);
  assert.equal(savingsContext.calculateSavingsLoan(pot.borrowings[0]).remaining, 150.2);
  await save(payment, 'loan');
  assert.equal(pot.currentAmount, 349.8);
  assert.equal(pot.borrowings[0].repayments.length, 1);
  pot.archived = true;
  await assert.rejects(save({ ...borrow, id: 'archived' }), /active/);
  await save({ id: 'final', amount: 150.2, date: '2026-01-03' }, 'loan');
  assert.equal(pot.currentAmount, 500);
  assert.equal(savingsContext.calculateSavingsLoan(pot.borrowings[0]).remaining, 0);
  assert.deepEqual(pot.borrowings[0].repayments.map(item => item.date), ['2026-01-02', '2026-01-03']);
  await assert.rejects(save({ id: 'extra', amount: 0.01, date: '2026-01-04' }, 'loan'), /outstanding/);
  pot = null;
  await assert.rejects(save(borrow), /no longer exists/);
  console.log('Savings borrowing, partial/full repayment history, cent precision, duplicate guards, archived repayment, and atomic failure checks passed.');
}
checkSavingsBorrowing().catch(error => { console.error(error); process.exitCode = 1; });

async function checkEmergencyRepayments() {
  let loan = { id: 'loan', amount: -200.3, account: 'main', date: '2026-01-01', returned: false };
  let rejectCommit = false;
  const copy = value => JSON.parse(JSON.stringify(value));
  const api = {
    doc: (_db, ...parts) => parts.join('/'),
    async runTransaction(_db, operation) {
      let pending;
      await operation({
        get: async ref => {
          assert.equal(ref, 'users/test/emergencyFundContributions/loan');
          return { exists: () => Boolean(loan), data: () => copy(loan) };
        },
        update: (_ref, fields) => { pending = copy(fields); },
      });
      if (rejectCommit) throw Error('Rejected commit');
      if (pending) loan = { ...loan, ...pending };
    },
  };
  const emergencyContext = { WR: { financial: { calculateEmergencyBorrowing: context.calculateEmergencyBorrowing }, account: { getCurrentUser: () => ({ uid: 'test' }), getFirestoreApi: () => api, getDb: () => ({}) } } };
  vm.createContext(emergencyContext);
  vm.runInContext(functions.get('saveEmergencyRepayment'), emergencyContext);
  const save = payment => emergencyContext.saveEmergencyRepayment('loan', payment);
  const payment = { id: 'partial', amount: 50.1, date: '2026-01-02' };
  const original = JSON.stringify(loan);
  rejectCommit = true;
  await assert.rejects(save(payment), /Rejected commit/);
  assert.equal(JSON.stringify(loan), original);
  rejectCommit = false;
  for (const amount of [0, -1, NaN, Infinity, 0.001, 201]) await assert.rejects(save({ ...payment, amount }));
  for (const date of ['2025-12-31', '2026-02-30', 'bad-date', '2999-01-01']) await assert.rejects(save({ ...payment, date }));
  assert.equal(JSON.stringify(loan), original);
  await save(payment);
  assert.equal(loan.returned, false);
  assert.equal(loan.amount, -200.3);
  assert.equal(context.calculateEmergencyBorrowing(loan).remaining, 150.2);
  await save(payment);
  assert.equal(loan.repayments.length, 1);
  await save({ id: 'final', amount: 150.2, date: '2026-02-01' });
  assert.equal(loan.returned, true);
  assert.equal(context.calculateEmergencyBorrowing(loan).remaining, 0);
  assert.deepEqual(loan.repayments.map(entry => entry.date), ['2026-01-02', '2026-02-01']);
  assert.equal(Math.round(context.calculateWealth([], [], [], [{ amount: 500 }, loan], [], 'ZAR').emergencyFundTotal * 100), 50000);
  assert.equal(context.calculateReserveBorrowing([], [loan], [], 'ZAR').total, 0);
  await assert.rejects(save({ id: 'extra', amount: 0.01, date: '2026-02-02' }), /outstanding/);
  loan = { id: 'loan', amount: -100, returned: true, date: '2026-01-01' };
  await assert.rejects(save(payment), /outstanding/);
  loan = { id: 'loan', amount: -100, transferId: 'transfer', date: '2026-01-01' };
  await assert.rejects(save(payment), /borrowing record/);
  loan = { id: 'loan', amount: 100, date: '2026-01-01' };
  await assert.rejects(save(payment), /borrowing record/);
  loan = null;
  await assert.rejects(save(payment), /no longer exists/);
  console.log('Emergency partial/full repayments, dated history, duplicate guards, rejected commits, legacy returns, balance restoration and dashboard totals passed.');
}
checkEmergencyRepayments().catch(error => { console.error(error); process.exitCode = 1; });

async function checkRouteRaces() {
  let current;
  let headingFocused = false;
  let retry;
  function view() {
    return {
      dataset: {}, isConnected: true, children: [], classList: { toggle() {} }, markup: '',
      closest() { return this; }, cloneNode() { return view(); },
      replaceWith(next) { this.isConnected = false; current = next; },
      setAttribute() {},
      querySelector(selector) { return selector === 'h1' ? { focus() { headingFocused = true; } } : { addEventListener(_event, listener) { retry = listener; } }; },
    };
  }
  current = view();
  let finishFirst;
  let renders = 0;
  const routeContext = {
    lastRoutedHash: '', navigationId: 0, SKELETON_HTML: 'Loading',
    ROUTES: { '#/income': 'renderIncome', '#/settings': 'renderSettings' },
    window: { location: { hash: '#/income' } },
    document: { getElementById: () => current }, console: { error() {} },
    WR: { account: { isConfigured: () => false }, saves: { state: { pending: 0 } }, ui: {
      setActiveNav() {}, captureFormDrafts() {}, escapeText: context.escapeText,
      setHTML(element, markup) { context.assertActiveView(element); element.markup = markup; },
      async renderIncome(element) { const render = ++renders; if (render === 1) await new Promise(resolve => { finishFirst = resolve; }); routeContext.WR.ui.setHTML(element, render === 1 ? 'old' : 'new'); },
      async renderSettings(element) { routeContext.WR.ui.setHTML(element, 'settings'); },
    } },
  };
  vm.createContext(routeContext);
  vm.runInContext(functions.get('handleRoute'), routeContext);
  const first = routeContext.handleRoute();
  await routeContext.handleRoute();
  finishFirst();
  await first;
  assert.equal(current.markup, 'new');
  assert.equal(current.inert, false);
  routeContext.window.location.hash = '#/settings';
  await routeContext.handleRoute();
  assert.equal(current.markup, 'settings');
  assert.equal(headingFocused, true);
  routeContext.WR.ui.renderSettings = async () => { throw Error('<img src=x onerror=alert(1)>'); };
  await routeContext.handleRoute();
  assert.ok(current.markup.includes('&lt;img'));
  assert.ok(current.markup.includes('route-retry-btn'));
  routeContext.WR.ui.renderSettings = async element => routeContext.WR.ui.setHTML(element, 'retried');
  await retry();
  assert.equal(current.markup, 'retried');
  console.log('Same-route race isolation, active-view focus, escaped load errors, and page retry checks passed.');
}
checkRouteRaces().catch(error => { console.error(error); process.exitCode = 1; });

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
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version, '3.1.0');
  assert.ok(html.includes("const APP_VERSION = '3.1.0'"));
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
  let container;
  const inertControl = { addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } };
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
        setHTML: (target, value) => { if (target === container) markup = value; else target.markup = value; },
      },
    },
    document: { getElementById: () => ({ addEventListener() {} }) },
  };
  vm.createContext(layoutContext);
  vm.runInContext(`${functions.get('findRecurringSpendPatterns')}\n${functions.get('renderDayToDay')}`, layoutContext);
  const nextDate = { hidden: false, classList: { contains: () => true } };
  const secondRow = { hidden: false, classList: { contains: () => false }, nextElementSibling: nextDate };
  const firstRow = { hidden: false, classList: { contains: () => false }, nextElementSibling: secondRow };
  const dateToggle = {
    dataset: { date: '2026-10-07' }, attributes: {},
    closest: () => ({ nextElementSibling: firstRow }),
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(_name, listener) { this.click = listener; },
  };
  container = {
    querySelector: () => inertControl,
    querySelectorAll: selector => { selectors.push(selector); return selector === '.day-date-toggle' ? [dateToggle] : []; },
  };
  await layoutContext.renderDayToDay(container);
  assert.ok(markup.indexOf('id="day-add-form"') < markup.indexOf('id="day-activity-title"'));
  assert.ok(markup.indexOf('id="day-activity-title"') < markup.indexOf('Where your money is going'));
  assert.ok(markup.includes('id="day-today"'));
  assert.ok(markup.includes('id="day-collapse-all"'));
  assert.ok(markup.includes('id="day-expand-all"'));
  assert.ok(markup.includes('inputmode="decimal"'));
  assert.ok(markup.includes('<label>Description<input'));
  assert.ok(markup.includes('<details class="day-disclosure">'));
  dateToggle.click();
  assert.equal(firstRow.hidden, true);
  assert.equal(secondRow.hidden, true);
  assert.equal(nextDate.hidden, false);
  assert.equal(dateToggle.attributes['aria-expanded'], 'false');
  await layoutContext.renderDayToDay(container);
  assert.ok(markup.includes('<tr data-id="first" hidden>'));
  assert.ok(markup.includes('<tr data-id="second" hidden>'));
  dateToggle.click();
  assert.equal(firstRow.hidden, false);
  assert.equal(secondRow.hidden, false);
  assert.equal(dateToggle.attributes['aria-expanded'], 'true');
  await layoutContext.renderDayToDay(container);
  assert.ok(!markup.includes('<tr data-id="first" hidden>'));
  assert.equal((markup.match(/class="day-date-group"/g) || []).length, 1);
  assert.equal((markup.match(/<tr data-id=/g) || []).length, 2);
  assert.ok(markup.includes('2 transactions'));
  assert.ok(!markup.includes('data-field="kind"'));
  assert.ok(!markup.includes('name="kind"'));
  assert.ok(!markup.includes('data-id="third"'));
  assert.ok(functions.get('renderDayToDay').includes("kind: 'spend'"));
  assert.ok(markup.includes('data-label="Amount (ZAR)"'));
  assert.ok(!markup.includes("of this month's day-to-day spending"));
  assert.ok(selectors.includes('.day-ledger tbody tr[data-id]'));
  assert.ok(markup.includes('Balance at start of month</span><span class="stat-value">ZAR 4321.00'));
  assert.ok(!markup.includes('coveredByBudget'));
  assert.ok(!markup.includes('Reserved expense'));
  assert.ok(!markup.includes('day-balance-form'));
  assert.ok(markup.includes('Current balance</span><span class="stat-value ">ZAR 4223.00'));
  assert.equal((markup.match(/class="day-category-row/g) || []).length, 1);
  assert.ok(markup.includes('class="day-category-list" role="list"'));
  assert.ok(markup.includes('aria-label="Filter activity by date"'));
  assert.ok(markup.includes('id="day-date-from" type="date"'));
  assert.ok(markup.includes('id="day-date-to" type="date"'));
  assert.ok(!markup.includes('day-category-card'));
  assert.ok(!markup.includes('stat-label">Buffer'));
  assert.ok(!markup.includes('Money added to buffer'));
  assert.equal((markup.match(/class="day-row-toggle"/g) || []).length, 2);
  assert.equal((markup.match(/class="day-mobile-value day-mobile-description"/g) || []).length, 2);
  assert.ok(markup.includes('class="day-mobile-value day-mobile-amount"'));
  assert.ok(markup.includes('aria-expanded="false"'));
  assert.ok(!markup.includes('<th>Note</th>'));
  assert.ok(!markup.includes('data-field="note"'));
  assert.ok(!markup.includes('name="note"'));
  assert.ok(!functions.get('renderDayToDay').includes('form.note'));
  assert.ok(markup.includes('colspan="5" scope="rowgroup"'));
  layoutContext.WR.ui._dayEditingId = 'first';
  await layoutContext.renderDayToDay(container);
  assert.ok(markup.includes('<tr data-id="first" class="is-editing">'));
  assert.ok(markup.includes('aria-expanded="true"'));
  transactions.length = 0;
  await layoutContext.renderDayToDay(container);
  assert.ok(markup.includes('No day-to-day transactions yet.'));
  assert.equal((markup.match(/class="day-date-group"/g) || []).length, 0);
  transactions.push(
    { id: 'first', date: '2026-10-07', kind: 'spend', amount: 84.23, category: 'Bank charges', description: 'Charge' },
    { id: 'second', date: '2026-10-07', kind: 'spend', amount: 13.77, category: 'Bank charges' },
    { id: 'third', date: '2026-10-06', kind: 'add', amount: 800 },
  );
  layoutContext.WR.ui._dayDateFrom = '2026-10-07';
  await layoutContext.renderDayToDay(container);
  assert.equal((markup.match(/<tr data-id=/g) || []).length, 2);
  assert.ok(markup.includes('Showing 2 of 2'));
  assert.ok(markup.includes('2026') && !markup.includes('>2026-10-07<span>'));
  assert.ok(markup.includes('Clear dates'));
  console.log('Transaction date grouping, counts, mobile labels, escaping, edit binding, and empty-state checks passed.');
}
checkTransactionLayout().catch(error => { console.error(error); process.exitCode = 1; });

async function checkSavingsActivity() {
  const savingsContext = {
    escapeEf: context.escapeText,
    getEmergencyFundAccounts: profile => profile.emergencyFundAccounts,
    WR: {
      financial: { calculateEmergencyBorrowing: context.calculateEmergencyBorrowing, calculateEmergencyAccountSummary: context.calculateEmergencyAccountSummary },
      ui: {
        getOrCreateProfile: async () => ({ baseCurrency: 'ZAR', emergencyFundAccounts: [{ id: 'main', label: 'Emergency savings' }] }),
        currentMonthKey: () => '2026-10', escapeText: context.escapeText,
        fmt: number => Number(number).toFixed(2),
        bindReliableForm() {},
        buildSnapshot: async () => ({ essentialVsDiscretionary: { essential: 1000 }, cashflow: { fixedExpenses: 1000 }, emergencyFundTargetMonths: 3 }),
        setHTML: (container, markup) => { container.markup = markup; },
      },
      repos: { emergencyFundContributions: { getAll: async () => [
        { id: 'contribution', date: '2026-10-07', account: 'main', amount: 100 },
        { id: 'borrowed', date: '2026-10-08', account: 'main', amount: -9.47, note: 'Borrowed: repair' },
        { id: 'repaid', date: '2026-10-09', account: 'main', amount: -20, returned: true },
        { id: 'older-borrowing', date: '2026-09-09', account: 'main', amount: -5, returned: true },
        { id: 'older-contribution', date: '2026-09-01', account: 'main', amount: 0 },
      ] } },
    },
  };
  vm.createContext(savingsContext);
  vm.runInContext(functions.get('renderEmergencyFund'), savingsContext);
  const host = id => ({ id, querySelectorAll: () => [], querySelector: () => ({ addEventListener() {} }) });
  const savings = host('emergency-savings');
  await savingsContext.renderEmergencyFund(savings);
  assert.ok(savings.markup.includes('ef-activity-card'));
  assert.ok(savings.markup.includes('id="emergency-fund-month"'));
  assert.ok(savings.markup.includes('Account activity'));
  assert.ok(!savings.markup.includes('Borrowed: repair'));
  assert.ok(!savings.markup.includes('class="emergency-repayment card-edit-form"'));
  assert.ok(!savings.markup.includes('emergency-borrow-form'));
  assert.ok(!functions.get('renderSavingsPots').includes('borrow-savings'));
  assert.ok(!savings.markup.includes('toggle-emergency-return'));
  assert.ok(!savings.markup.includes('data-id="older-borrowing"'));
  assert.ok(savings.markup.includes('ZAR 90.53'));
  assert.ok(savings.markup.includes('Available balance'));
  assert.ok(!savings.markup.includes('ef-account-breakdown'));
  assert.ok(!savings.markup.includes('Owed back to this account'));
  assert.ok(savings.markup.includes('id="emergency-add-form"'));
  const standalone = host('content');
  await savingsContext.renderEmergencyFund(standalone);
  assert.ok(standalone.markup.includes('ef-activity-card'));
  assert.ok(standalone.markup.includes('id="emergency-fund-month"'));
  savingsContext.WR.ui._emergencyFundMonth = '2026-09';
  await savingsContext.renderEmergencyFund(savings);
  assert.ok(savings.markup.includes('data-id="older-contribution"'));
  assert.ok(!savings.markup.includes('data-id="borrowed"'));
  console.log('Emergency ledger keeps contributions/transfers and month filtering without duplicating combined borrowing controls or changing balances.');
}
checkSavingsActivity().catch(error => { console.error(error); process.exitCode = 1; });

function checkCombinedBorrowingSources() {
  assert.ok(functions.get('renderReserveBorrowing').includes('<details class="borrowing-row">'));
  assert.ok(!functions.get('renderReserveBorrowing').includes('class="goal-card pot-card"'));
  assert.ok(functions.get('renderReserveBorrowing').includes('class="reserve-repayment card-edit-form"'));
  assert.ok(functions.get('renderReserveBorrowing').includes('class="reserve-borrowing-edit card-edit-form"'));
  assert.ok(functions.get('renderReserveBorrowing').includes('Confirm delete'));
  const combinedContext = { WR: { financial: { calculateEmergencyBorrowing: context.calculateEmergencyBorrowing } } };
  vm.createContext(combinedContext);
  vm.runInContext(['calculateSavingsLoan', 'collectReserveBorrowings', 'filterReserveBorrowings'].map(name => functions.get(name)).join('\n'), combinedContext);
  const accounts = [{ id: 'shared', label: 'Emergency account' }];
  const loans = combinedContext.collectReserveBorrowings([
    { id: 'shared', name: 'Savings pot', archived: true, borrowings: [{ id: 'same-id', amount: 100, date: '2026-10-01', repayments: [{ amount: 20 }] }] },
  ], [
    { id: 'same-id', amount: -50, date: '2026-10-02', repayments: [{ amount: 10 }] },
    { id: 'legacy', amount: -25, date: '2026-09-01', returned: true },
    { id: 'transfer', amount: -500, date: '2026-10-03', transferId: 'move' },
    { id: 'deposit', amount: 1000, date: '2026-10-03' },
    { id: 'correction', amount: -450, date: '2026-10-04', balanceAdjustment: true },
  ], accounts, 'ZAR');
  assert.equal(loans.length, 3);
  assert.equal(loans[0].sourceKey, 'emergency:shared');
  assert.equal(loans[0].remaining, 40);
  assert.equal(loans[1].sourceKey, 'savings:shared');
  assert.equal(loans[1].remaining, 80);
  assert.equal(loans[2].remaining, 0);
  assert.equal(loans[2].legacyReturned, true);
  assert.equal(loans[0].sourceName, 'Emergency account');
  assert.equal(loans[1].sourceName, 'Savings pot');
  assert.equal(combinedContext.filterReserveBorrowings(loans, '2026-10').length, 2);
  assert.equal(combinedContext.filterReserveBorrowings(loans, '2026-09')[0].id, 'legacy');
  assert.equal(combinedContext.filterReserveBorrowings(loans, '2025-10').length, 0);
  assert.equal(combinedContext.filterReserveBorrowings(loans, '2026-12').length, 0);
  assert.equal(combinedContext.filterReserveBorrowings(loans, 'all').length, 3);
  assert.equal(combinedContext.filterReserveBorrowings(loans, '2026-10')[0].sourceKey, 'emergency:shared');
  assert.ok(functions.get('renderReserveBorrowing').includes('id="borrowing-history-month"'));
  assert.ok(functions.get('renderReserveBorrowing').includes('WR.ui._borrowingHistoryMonth || today.slice(0, 7)'));
  assert.equal(combinedContext.collectReserveBorrowings([], [], accounts, 'ZAR').length, 0);
  console.log('Combined borrowing preserves source identity, partial balances, archived loans and legacy returns without including transfers.');
}
checkCombinedBorrowingSources();

async function checkUnifiedEmergencyBorrowing() {
  const entries = [
    { id: 'main-deposit', account: 'main', amount: 500 },
    { id: 'other-deposit', account: 'other', amount: 100 },
    { id: 'old-loan', account: 'other', amount: -50, repayments: [{ amount: 20 }] },
  ];
  const unifiedContext = {
    getEmergencyFundAccounts: profile => profile.emergencyFundAccounts,
    saveEmergencyFundEntries: async rows => { entries.push(...rows); },
    WR: {
      ui: { getOrCreateProfile: async () => ({ emergencyFundAccounts: [{ id: 'main' }, { id: 'other' }] }) },
      financial: { calculateEmergencyBorrowing: context.calculateEmergencyBorrowing },
      repos: { emergencyFundContributions: { getAll: async () => entries } },
    },
  };
  vm.createContext(unifiedContext);
  vm.runInContext(functions.get('saveEmergencyBorrowing'), unifiedContext);
  const entry = { id: 'new-loan', amount: 70, date: '2026-01-01', note: 'Repair' };
  await assert.rejects(unifiedContext.saveEmergencyBorrowing('other', { ...entry, amount: 70.01 }), /Insufficient/);
  await assert.rejects(unifiedContext.saveEmergencyBorrowing('missing', entry), /Choose/);
  for (const amount of [0, -1, NaN, Infinity]) await assert.rejects(unifiedContext.saveEmergencyBorrowing('other', { ...entry, amount }));
  for (const date of ['2026-02-30', 'bad-date', '2999-01-01']) await assert.rejects(unifiedContext.saveEmergencyBorrowing('other', { ...entry, date }));
  assert.equal(entries.length, 3);
  await unifiedContext.saveEmergencyBorrowing('other', entry);
  assert.equal(entries.length, 4);
  assert.equal(entries[3].account, 'other');
  assert.equal(entries[3].amount, -70);
  assert.equal(entries[3].note, 'Repair');
  await unifiedContext.saveEmergencyBorrowing('other', entry);
  assert.equal(entries.length, 4);
  console.log('Unified emergency borrowing validates the selected account and dates, includes repayments in availability, and avoids duplicate records.');
}
checkUnifiedEmergencyBorrowing().catch(error => { console.error(error); process.exitCode = 1; });

async function checkBorrowingCorrections() {
  const records = new Map();
  const potKey = 'users/test/savingsPots/pot';
  const emergencyKey = 'users/test/emergencyFundContributions/loan';
  const depositKey = 'users/test/emergencyFundContributions/deposit';
  const copy = value => JSON.parse(JSON.stringify(value));
  let rejectCommit = false;
  const api = {
    doc: (_db, ...parts) => parts.join('/'),
    async runTransaction(_db, operation) {
      const writes = [];
      await operation({
        get: async key => ({ exists: () => records.has(key), data: () => copy(records.get(key)) }),
        update: (key, fields) => writes.push(() => records.set(key, { ...records.get(key), ...copy(fields) })),
        delete: key => writes.push(() => records.delete(key)),
      });
      if (rejectCommit) throw Error('Rejected commit');
      writes.forEach(write => write());
    },
  };
  const correctionContext = { WR: {
    account: { getCurrentUser: () => ({ uid: 'test' }), getFirestoreApi: () => api, getDb: () => ({}) },
    ui: { getOrCreateProfile: async () => ({}), getEmergencyFundAccounts: () => [{ id: 'main' }] },
    financial: { calculateEmergencyAccountSummary: context.calculateEmergencyAccountSummary },
    repos: { emergencyFundContributions: { getAll: async () => [...records.entries()].filter(([key]) => key.includes('/emergencyFundContributions/')).map(([, value]) => copy(value)) } },
  } };
  vm.createContext(correctionContext);
  vm.runInContext(functions.get('updateReserveBorrowing'), correctionContext);
  const fields = { amount: 120, date: '2026-01-01', note: 'Corrected' };
  records.set(potKey, { id: 'pot', currentAmount: 850, borrowings: [{ id: 'loan', amount: 200, date: '2026-01-01', repayments: [{ amount: 50, date: '2026-01-02' }] }] });
  const changePot = (next, remove) => correctionContext.updateReserveBorrowing('savings', 'pot', 'loan', next, remove);
  rejectCommit = true;
  await assert.rejects(changePot(fields), /Rejected/);
  assert.equal(records.get(potKey).currentAmount, 850);
  rejectCommit = false;
  await assert.rejects(changePot({ ...fields, amount: 49 }), /repayments/);
  await assert.rejects(changePot({ ...fields, date: '2026-01-03' }), /after/);
  await assert.rejects(changePot({ ...fields, amount: 2000 }), /Insufficient/);
  await changePot(fields);
  assert.equal(records.get(potKey).currentAmount, 930);
  assert.equal(records.get(potKey).borrowings[0].repayments.length, 1);
  await changePot({}, true);
  assert.equal(records.get(potKey).currentAmount, 1000);
  assert.equal(records.get(potKey).borrowings.length, 0);
  records.set(depositKey, { id: 'deposit', account: 'main', amount: 500 });
  records.set(emergencyKey, { id: 'loan', account: 'main', amount: -200, date: '2026-01-01', repayments: [{ amount: 50, date: '2026-01-02' }] });
  const changeEmergency = (next, remove) => correctionContext.updateReserveBorrowing('emergency', 'main', 'loan', next, remove);
  await assert.rejects(changeEmergency({ ...fields, amount: 600 }), /Insufficient/);
  await changeEmergency(fields);
  assert.equal(records.get(emergencyKey).amount, -120);
  assert.equal(records.get(emergencyKey).repayments.length, 1);
  await changeEmergency({ ...fields, amount: 50 });
  assert.equal(records.get(emergencyKey).returned, true);
  await changeEmergency({}, true);
  assert.equal(records.has(emergencyKey), false);
  assert.equal(records.get(depositKey).amount, 500);
  records.set(emergencyKey, { id: 'loan', account: 'main', amount: -100, date: '2026-01-01', returned: true });
  await assert.rejects(changeEmergency(fields), /previously returned/);
  await changeEmergency({ ...fields, amount: 100 });
  assert.equal(records.get(emergencyKey).returned, true);
  await changeEmergency({}, true);
  assert.equal(records.has(emergencyKey), false);
  console.log('Borrowing edits/deletes preserve repayments, reverse only outstanding savings, reject invalid corrections and commit atomically.');
}
checkBorrowingCorrections().catch(error => { console.error(error); process.exitCode = 1; });

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

function checkMobileNavigation() {
  const makeElement = () => {
    const classes = new Set();
    const attributes = new Map();
    return {
      style: { top: '' }, classes, attributes,
      classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value), toggle: (value, enabled) => enabled ? classes.add(value) : classes.delete(value) },
      setAttribute: (name, value) => attributes.set(name, value),
      removeAttribute: name => attributes.delete(name),
      toggleAttribute: (name, enabled) => enabled ? attributes.set(name, '') : attributes.delete(name),
      getClientRects: () => [1], focus() { this.focused = true; },
    };
  };
  const body = makeElement();
  const topbar = makeElement();
  const content = makeElement();
  const more = makeElement();
  const link = makeElement();
  const nav = makeElement();
  nav.querySelectorAll = () => [link];
  let mobile = true;
  const ui = {};
  const browser = { scrollY: 240, matchMedia: () => ({ matches: mobile }), scrollTo: (_horizontal, vertical) => { browser.scrollY = vertical; } };
  const navContext = {
    WR: { ui }, window: browser,
    document: { body, querySelector: () => topbar, querySelectorAll: () => [more], getElementById: id => ({ nav, content, 'mobile-more-btn': more, 'nav-toggle-btn': more })[id] },
  };
  vm.createContext(navContext);
  vm.runInContext(functions.get('setNavigationOpen'), navContext);
  navContext.setNavigationOpen(true);
  assert.equal(body.classes.has('nav-scroll-locked'), true);
  assert.equal(body.style.top, '-240px');
  assert.equal(content.attributes.has('inert'), true);
  assert.equal(nav.attributes.get('aria-hidden'), 'false');
  assert.equal(more.attributes.get('aria-expanded'), 'true');
  browser.scrollY = 0;
  navContext.setNavigationOpen(true);
  assert.equal(ui._navScrollLock.scrollY, 240);
  navContext.setNavigationOpen(false, true);
  assert.equal(body.classes.has('nav-scroll-locked'), false);
  assert.equal(body.style.top, '');
  assert.equal(browser.scrollY, 240);
  assert.equal(content.attributes.has('inert'), false);
  assert.equal(nav.attributes.get('aria-hidden'), 'true');
  assert.equal(link.attributes.get('tabindex'), '-1');
  assert.equal(more.focused, true);
  navContext.setNavigationOpen(true);
  mobile = false;
  navContext.setNavigationOpen(false);
  assert.equal(body.classes.has('nav-scroll-locked'), false);
  navContext.setNavigationOpen(true);
  assert.equal(body.classes.has('nav-scroll-locked'), false);
  assert.ok(functions.get('renderShell').includes("event.target.closest('a, #nav-logout-btn, #nav-logout-wide')"));
  assert.ok(html.includes('body, .app-splash, .auth-screen { background: var(--bg); }'));
  console.log('Mobile menu locks and restores page scrolling, hides closed links, and leaves desktop scrolling unlocked.');
}
checkMobileNavigation();

async function checkPullRefresh() {
  let user = { uid: 'refresh-user' };
  let reads = 0;
  let renders = 0;
  let duringRead = () => {};
  const refreshContext = {
    navigator: { onLine: true }, window: { location: { hash: '#/dashboard' } },
    WR: {
      account: { getCurrentUser: () => user },
      saves: { state: { pending: 0 } },
      repos: { sample: { getAll: async options => { assert.equal(options.fresh, true); reads++; duringRead(); return []; } } },
      ui: { reRenderCurrentRoute: async () => { renders++; } },
    },
  };
  vm.createContext(refreshContext);
  vm.runInContext(functions.get('refreshCurrentPage'), refreshContext);
  await refreshContext.refreshCurrentPage();
  assert.equal(reads, 1);
  assert.equal(renders, 1);
  refreshContext.WR.saves.state.pending = 1;
  await refreshContext.refreshCurrentPage();
  assert.equal(reads, 1);
  refreshContext.WR.saves.state.pending = 0;
  user = null;
  await refreshContext.refreshCurrentPage();
  assert.equal(reads, 1);
  user = { uid: 'refresh-user' };
  refreshContext.navigator.onLine = false;
  await assert.rejects(refreshContext.refreshCurrentPage(), /offline/);
  assert.equal(reads, 1);
  refreshContext.navigator.onLine = true;
  duringRead = () => { refreshContext.window.location.hash = '#/settings'; };
  await refreshContext.refreshCurrentPage();
  assert.equal(renders, 1);
  duringRead = () => { user = { uid: 'different-user' }; };
  await refreshContext.refreshCurrentPage();
  assert.equal(renders, 1);
  duringRead = () => { throw new Error('Refresh failed'); };
  await assert.rejects(refreshContext.refreshCurrentPage(), /Refresh failed/);
  assert.equal(renders, 1);
  console.log('Pull refresh requests fresh data, skips pending saves, and handles offline errors and account/route changes.');
}
checkPullRefresh().catch(error => { console.error(error); process.exitCode = 1; });

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
  paydayContext.WR.ui._transactionsMonth = '2026-12';
  assert.equal(paydayContext.syncBudgetMonth(new Date(2026, 11, 25)), true);
  assert.equal(paydayContext.WR.ui._dayMonth, '2027-01');
  assert.equal(paydayContext.WR.ui._paydayMonth, '2026-11');
  assert.equal(paydayContext.WR.ui._transactionsMonth, '2027-01');
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
  assert.ok(functions.get('renderDashboard').includes('Left to spend</span><span class="hero-value ${s.dayToDaySummary.currentBalance < 0'));
  assert.ok(functions.get('renderDashboard').includes('aria-label="Net worth summary"'));
  assert.ok(functions.get('renderDashboard').includes('${fmt(s.netWorth.totalAssets)}</span>'));
  assert.ok(functions.get('renderDashboard').includes('${fmt(s.netWorth.totalLiabilities)}</span>'));
  assert.ok(functions.get('renderDashboard').includes('aria-label="Current budget period"'));
  assert.ok(functions.get('renderDashboard').includes('<dl class="budget-spending-head" aria-label="Spending summary">'));
  assert.ok(functions.get('renderDashboard').includes('<dt>Spent</dt><dd class="budget-spent-value">${currency} ${fmt(budgetSpent)}</dd>'));
  assert.ok(functions.get('renderDashboard').includes("<dt>Budget</dt><dd>${spending.percentage === null ? 'Not set'"));
  assert.ok(functions.get('renderDashboard').includes('Included in total wealth and net worth'));
  assert.ok(functions.get('renderDashboard').includes('class="dashboard-card reserve-card emergency-card" aria-label="Emergency fund balance"'));
  assert.ok(functions.get('renderDashboard').includes('class="dashboard-card reserve-card savings-card" aria-label="Savings balance"'));
  assert.ok(functions.get('renderDashboard').includes('${fmt(s.dayToDaySummary.currentBalance)}</span>'));
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
  paydayContext.WR.ui.bindReliableForm = () => {};
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
  let accountUid = 'test';
  const repositoryContext = {
    WR: { account: { getCurrentUser: () => ({ uid: accountUid }) } },
    requireContext: () => ({ uid: 'test', db: {}, api: { collection: () => ({ path: 'payCycles' }), getDocsFromServer: async () => { freshReads++; return current; } } }),
    readDocs: async () => cached,
  };
  vm.createContext(repositoryContext);
  vm.runInContext(functions.get('assertAccount') + '\n' + functions.get('createRepository'), repositoryContext);
  const cycleRepo = repositoryContext.createRepository('payCycles');
  assert.equal((await cycleRepo.getAll())[0].advanceAmount, 2000);
  assert.equal((await cycleRepo.getAll({ fresh: true }))[0].advanceAmount, 3000);
  assert.equal(freshReads, 1);
  let releaseRead;
  repositoryContext.readDocs = () => new Promise(resolve => { releaseRead = resolve; });
  const staleRead = cycleRepo.getAll();
  accountUid = 'other-account';
  releaseRead(cached);
  await assert.rejects(staleRead, { name: 'AbortError' });
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
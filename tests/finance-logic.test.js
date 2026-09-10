const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const htmlPath = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const scriptStart = html.toLowerCase().indexOf('<script>');
const scriptEnd = html.toLowerCase().lastIndexOf('</script>');
assert.ok(scriptStart >= 0 && scriptEnd > scriptStart, 'Expected embedded script in index.html');
const script = html.slice(scriptStart + '<script>'.length, scriptEnd);

function makeElement(id = '') {
  return {
    id,
    value: '0',
    textContent: '',
    className: '',
    children: [],
    addEventListener() {},
    appendChild(child) { this.children.push(child); },
    replaceChildren() { this.children = []; }
  };
}

function makeContext() {
  const ids = [
    'monthlyIncome', 'monthlyExpenses', 'cash', 'investments', 'property',
    'debtBalance', 'debtApr', 'debtMinimum', 'totalAssets', 'totalDebt',
    'netWorth', 'freeCash', 'planSteps', 'planStatus', 'netWorthContext'
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, makeElement(id)]));
  const document = {
    getElementById(id) {
      if (!elements[id]) elements[id] = makeElement(id);
      return elements[id];
    },
    createElement() {
      return makeElement();
    }
  };
  const localStorage = { getItem: () => null, setItem: () => {} };
  const context = { document, localStorage, Intl };
  vm.createContext(context);
  vm.runInContext(script, context);
  return { context, elements };
}

test('negative free cash flow returns only stabilization guidance', () => {
  const { context, elements } = makeContext();
  elements.monthlyIncome.value = '1000';
  elements.monthlyExpenses.value = '1500';
  elements.debtBalance.value = '3000';
  elements.debtApr.value = '20';
  elements.debtMinimum.value = '200';
  context.render();

  const titles = elements.planSteps.children.map((li) => li.children[0].textContent);
  assert.equal(titles.length, 1);
  assert.match(titles[0], /Stabilize your monthly cash flow immediately/);
});

test('high-interest debt and low cash prioritizes starter buffer then debt attack', () => {
  const { context, elements } = makeContext();
  elements.monthlyIncome.value = '5000';
  elements.monthlyExpenses.value = '2000';
  elements.cash.value = '100';
  elements.debtBalance.value = '5000';
  elements.debtApr.value = '20';
  elements.debtMinimum.value = '150';
  context.render();

  const titles = elements.planSteps.children.map((li) => li.children[0].textContent);
  assert.equal(titles[0], 'Build a 1-month starter emergency buffer, then attack high-interest debt');
  assert.ok(!titles.includes('Build a 3-month emergency buffer'));
});

test('debt minimum is ignored when debt balance is zero', () => {
  const { context, elements } = makeContext();
  elements.monthlyIncome.value = '3000';
  elements.monthlyExpenses.value = '2000';
  elements.debtBalance.value = '0';
  elements.debtMinimum.value = '900';
  context.render();

  assert.equal(elements.freeCash.textContent, '$1,000.00');
});

test('3-month emergency buffer appears only after starter buffer is complete', () => {
  const { context, elements } = makeContext();
  elements.monthlyIncome.value = '5000';
  elements.monthlyExpenses.value = '2000';
  elements.cash.value = '2000';
  elements.debtBalance.value = '1000';
  elements.debtApr.value = '5';
  elements.debtMinimum.value = '100';
  context.render();

  const titles = elements.planSteps.children.map((li) => li.children[0].textContent);
  assert.equal(titles[0], 'Build a 3-month emergency buffer');
  assert.ok(!titles.includes('Build a 1-month starter emergency buffer first'));
});

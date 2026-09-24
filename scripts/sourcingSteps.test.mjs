// Assertion tests for what Step by step shows about the choices made so far.
// Plain Node - no test framework (the project has none). Run:
//   node scripts/sourcingSteps.test.mjs
import {
  compareOption, contractTypeSummary, savingsBasisSummary, consumptionSummary,
  termSummary, stepSummaries, resultSummary, savingsCategoriesSummary, contractComparison,
} from '../src/utils/sourcingSteps.js';
import {
  buildSavings, normalizeScenario, monthlySeries, forwardSeries, normalizeSettles,
  SHIPPED_SETTLES, SHIPPED_FORWARD,
} from '../src/utils/nymexSavings.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { passed++; } else { failed++; console.error(`FAIL  ${name}\n        expected ${b}\n        got      ${a}`); }
}
function ok(cond, name) { eq(!!cond, true, name); }
function near(actual, expected, tol, name) {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) { passed++; }
  else { failed++; console.error(`FAIL  ${name}\n        expected ${expected} ±${tol}\n        got      ${actual}`); }
}

const series = monthlySeries(normalizeSettles(SHIPPED_SETTLES));
const curve = forwardSeries(SHIPPED_FORWARD);
const scenario = normalizeScenario({
  name: 'Joliet', startYear: 2026, startMonth: 11, termMonths: 24,
  annualVolumeDth: 120000, basis: 0.1, adder: 0.35,
  contractType: 'layered', fixedRate: 3.6,
  layers: [{ label: 'Block', pct: 50, price: 3.2 }],
  savingsBasis: 'contract', currentRate: 3.9, noActionPct: 4, strategyPct: 1,
}, series, curve);
const run = buildSavings(scenario, series, curve);

{
  const byType = compareOption(scenario, series, curve, 'contractType', ['fixed', 'index', 'layered']);
  near(byType.layered.saving, run.totals.saving, 1e-6, 'the chosen type\'s what-if is the page\'s own figure');
  near(byType.fixed.avgContractAllIn, 3.6, 1e-9, 'the fixed what-if prices at the fixed rate');
  near(byType.fixed.saving, (3.9 - 3.6) * byType.fixed.volume, 1e-6, 'and is measured the chosen way (vs the current contract)');
  const byBasis = compareOption(scenario, series, curve, 'savingsBasis', ['index', 'contract', 'avoided']);
  near(byBasis.contract.saving, run.totals.saving, 1e-6, 'the chosen basis\'s what-if is the page\'s own figure');
  near(byBasis.avoided.savingPerDth, byBasis.avoided.avgContractAllIn * 0.03, 1e-9, 'cost avoidance is the 3% gap on the contract rate');
  eq(byBasis.index.contractCost, byBasis.contract.contractCost, 'the basis changes the saving, never the contract cost');
}

eq(contractTypeSummary(scenario, run.hedge), 'Block & Index (Layered), 50% locked at $3.200', 'layered names its locked share');
eq(contractTypeSummary({ ...scenario, contractType: 'fixed' }), 'Fixed All-In Rate, $3.600 all-in', 'fixed names its rate');
eq(contractTypeSummary({ ...scenario, contractType: 'index' }), 'Index + Fixed Basis, nothing locked', 'index says nothing is locked');
eq(savingsBasisSummary(scenario), 'Contract Over Contract, vs $3.900 today', 'contract over contract names the current rate');
eq(savingsBasisSummary({ ...scenario, savingsBasis: 'avoided' }), 'Cost Avoidance, 3.0% avoided', 'cost avoidance names the gap');
eq(savingsBasisSummary({ ...scenario, savingsBasis: 'index' }), 'Against the index', 'the index needs nothing more');
eq(consumptionSummary(scenario, run.totals), '120,000 Dth a year, even', 'a shaped volume names the annual figure and the shape');
eq(consumptionSummary(scenario, { volume: 90000, enteredVolumeMonths: 3 }), '90,000 Dth over the term, 3 months entered', 'entered months are named');
eq(termSummary(scenario), 'Nov 2026 to Oct 2028, 24 mo', 'the term runs through its last month');
eq(stepSummaries({ ...scenario, name: '  ' }, run)[0].value, 'Not named yet', 'an unnamed site says so');
eq(stepSummaries(scenario, run).map(x => x.label), ['Site', 'Contract type', 'Consumption', 'Contract details', 'Savings'], 'a line for every step, savings last');
eq(
  savingsCategoriesSummary({ index: { saving: 143445.2 }, contract: { saving: 9299 }, avoided: { saving: -52371 } }),
  'Index $143,445 · Contract $9,299 · Avoided -$52,371',
  'the last step\'s line gives the saving under every category',
);
eq(savingsCategoriesSummary(null), '-', 'with nothing worked out yet it says so');
{
  const byBasis = compareOption(scenario, series, curve, 'savingsBasis', ['index', 'contract', 'avoided']);
  eq(stepSummaries(scenario, run, byBasis)[4].value, savingsCategoriesSummary(byBasis), 'and the strip uses it');
}
eq(resultSummary({ totals: { saving: -1234.4, savingPerDth: -0.01 } }), { saving: '-$1,234', perDth: '-$0.010', good: false }, 'a loss reads as one');

// Contract 1 vs Contract 2, and what the retail adder did.
{
  eq(normalizeScenario({}, series, curve).currentAdder, null, 'Contract 1\'s adder is unknown until given');
  eq(normalizeScenario({ currentAdder: '0.4' }, series, curve).currentAdder, 0.4, 'and reads as typed');
  eq(normalizeScenario({ currentAdder: '' }, series, curve).currentAdder, null, 'a cleared box is unknown again');

  const totals = { volume: 100000, contractCost: 330000, avgContractAllIn: 3.3 };
  const noAdder = contractComparison({ currentRate: 3.5, adder: 0.25, currentAdder: null }, totals);
  near(noAdder.saving, 20000, 1e-6, 'contract over contract: ($3.50 - $3.30) x 100,000 = $20,000');
  near(noAdder.savingPct, 20000 / 350000, 1e-12, 'as a share of Contract 1');
  eq(noAdder.adder, null, 'with no Contract 1 adder there is nothing to split');

  const split = contractComparison({ currentRate: 3.5, adder: 0.25, currentAdder: 0.4 }, totals);
  near(split.adder.perDth, 0.15, 1e-12, 'the adder went from $0.40 to $0.25, $0.15 a Dth');
  near(split.adder.saving, 15000, 1e-6, 'which is $15,000 of the saving');
  near(split.adder.rest, 5000, 1e-6, 'and commodity and basis did the other $5,000');
  near(split.adder.saving + split.adder.rest, split.saving, 1e-9, 'the two add back up to the whole');

  const worse = contractComparison({ currentRate: 3.5, adder: 0.5, currentAdder: 0.3 }, totals);
  near(worse.adder.saving, -20000, 1e-6, 'a higher adder on Contract 2 is a cost, and says so');
}

// Contract 1 on the index: no all-in to enter, index + basis + its adder.
{
  const idx = normalizeScenario({
    startYear: 2025, startMonth: 12, termMonths: 12, annualVolumeDth: 53297,
    basis: 0.05, adder: -0.092, contractType: 'index',
    currentType: 'index', currentRate: 9.99, currentAdder: -0.276, savingsBasis: 'contract',
  }, series, curve);
  eq(idx.currentType, 'index', 'Contract 1 can be an index contract');
  eq(normalizeScenario({}, series, curve).currentType, 'fixed', 'and is fixed until told otherwise, as saved sites were');
  const r = buildSavings(idx, series, curve);
  ok(r.months.every(m => Math.abs(m.contract1AllIn - (m.index + 0.05 - 0.276)) < 1e-12), 'each month is that month\'s index plus basis and Contract 1\'s adder');
  ok(r.months.every(m => m.contract1AllIn !== 9.99), 'the fixed all-in plays no part');
  const cmp = contractComparison(idx, r.totals);
  near(cmp.saving, (-0.276 - -0.092) * r.totals.volume, 1e-6, 'two index contracts differ only by their adders');
  near(cmp.adder.rest, 0, 1e-6, 'so commodity and basis contribute nothing');
  near(r.totals.saving, cmp.saving, 1e-6, 'and contract over contract says the same');
  eq(savingsBasisSummary(idx), 'Contract Over Contract, vs index + -$0.276 today', 'the strip names it as index plus the adder');

  const fixed1 = buildSavings({ ...idx, currentType: 'fixed' }, series, curve);
  ok(fixed1.months.every(m => m.contract1AllIn === 9.99), 'a fixed Contract 1 still bills its all-in every month');
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

// Assertion tests for what Step by step shows about the choices made so far.
// Plain Node - no test framework (the project has none). Run:
//   node scripts/sourcingSteps.test.mjs
import {
  compareOption, contractTypeSummary, savingsBasisSummary, consumptionSummary,
  termSummary, stepSummaries, resultSummary, savingsCategoriesSummary,
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

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

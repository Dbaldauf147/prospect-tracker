// Assertion tests for the savings analysis on the Sourcing scenario: what a
// contract's saving is measured against. Against the index (the default),
// Contract Over Contract, or Cost Avoidance.
// Plain Node - no test framework (the project has none). Run:
//   node scripts/savingsBasis.test.mjs
//
// Pinned hardest: the two worked examples the categories were defined with
// come out to the dollar, and the default leaves every saved scenario
// pricing exactly as it did.
import {
  SAVINGS_BASES, DEFAULT_SAVINGS_BASIS, normalizeScenario, buildSavings,
  monthlySeries, forwardSeries, normalizeSettles, SHIPPED_SETTLES, SHIPPED_FORWARD,
} from '../src/utils/nymexSavings.js';
import { savingsScenarioRows } from '../src/utils/savingsExport.js';

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

eq(Object.keys(SAVINGS_BASES), ['index', 'contract', 'avoided'], 'three ways to measure a saving');
eq(DEFAULT_SAVINGS_BASIS, 'index', 'against the index is the default');

{
  const base = normalizeScenario({}, series, curve);
  eq(base.savingsBasis, 'index', 'a scenario saved before the choice existed is measured against the index');
  ok(base.currentRate > 0, 'with a current rate to start from');
  eq([base.noActionPct, base.strategyPct], [4, 1], 'and the cost-avoidance example percentages');
  eq(normalizeScenario({ savingsBasis: 'vibes' }, series, curve).savingsBasis, 'index', 'an unknown basis falls back to the index');
}

// A fixed contract, so every month's contract all-in is one known number.
const scenario = {
  startYear: 2021, startMonth: 1, termMonths: 24, lookback: 0,
  annualVolumeDth: 1000000, basis: 0, adder: 0,
  contractType: 'fixed',
};

{
  const legacy = buildSavings({ ...scenario, fixedRate: 3 }, series, curve);
  const index = buildSavings({ ...scenario, fixedRate: 3, savingsBasis: 'index' }, series, curve);
  eq(index.totals.saving, legacy.totals.saving, 'the index basis prices exactly as before');
  near(index.totals.saving, index.totals.indexCost - index.totals.contractCost, 1e-6, 'and is still At index less On contract');
}

{
  // The Contract Over Contract example: $0.06 today, $0.0525 renewed, over
  // 2,000,000 units across 24 months, saves $15,000.
  const run = buildSavings({ ...scenario, fixedRate: 0.0525, savingsBasis: 'contract', currentRate: 0.06 }, series, curve);
  near(run.totals.volume, 2000000, 1e-6, 'the example volume over the 24-month term');
  near(run.totals.saving, 15000, 1e-6, 'contract over contract: 2,000,000 x $0.0075 = $15,000');
  near(run.totals.savingPerDth, 0.0075, 1e-12, 'which is the rate difference per unit');
  ok(run.months.every(m => m.baselineAllIn === 0.06), 'every month is measured against the current rate');
}

{
  // The Cost Avoidance example: 4% with no action, 1% on the strategy, so 3%
  // avoided; on a $0.1667 rate that is $0.005 a unit, and over 50,000,000
  // units, $250,000.
  const rate = 0.005 / 0.03;
  const run = buildSavings({
    ...scenario, annualVolumeDth: 25000000, fixedRate: rate,
    savingsBasis: 'avoided', noActionPct: 4, strategyPct: 1,
  }, series, curve);
  near(run.totals.volume, 50000000, 1e-3, 'the example contract volume');
  near(run.totals.savingPerDth, 0.005, 1e-9, 'the avoided cost per unit is 3% of the rate');
  near(run.totals.saving, 250000, 1e-3, 'cost avoidance: $0.005 x 50,000,000 = $250,000');
  near(run.totals.contractCost, rate * 50000000, 1e-3, 'the contract itself still costs its rate');
}

{
  const rows = (sc) => savingsScenarioRows(buildSavings(sc, series, curve));
  const find = (sc, label) => rows(sc).find(r => r.label === label);
  eq(find({ ...scenario, fixedRate: 3, savingsBasis: 'contract', currentRate: 3.5 }, 'Savings analysis')?.value, 'Contract Over Contract', 'the export names the basis');
  ok(find({ ...scenario, fixedRate: 3, savingsBasis: 'contract', currentRate: 3.5 }, 'On the current contract'), 'and what the saving is taken from');
  ok(find({ ...scenario, fixedRate: 3, savingsBasis: 'avoided' }, 'Increase with no action'), 'and the cost-avoidance percentages');
  ok(find({ ...scenario, fixedRate: 3 }, 'Saving against index'), 'the index basis keeps its label');
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

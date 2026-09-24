// Assertion tests for the contract type on the Sourcing scenario: Fixed
// All-In, Index + Fixed Basis, and Block & Index (Layered).
// Plain Node - no test framework (the project has none). Run:
//   node scripts/savingsContractType.test.mjs
//
// The three share one pricing formula and differ only in what is locked, so
// what to pin is that each prices the way its name says: a fixed contract
// bills its rate every month, an index one tracks the index every month, and
// a layered one is what the page always did.
import {
  CONTRACT_TYPES, DEFAULT_CONTRACT_TYPE, normalizeScenario, contractHedge, buildSavings,
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

eq(Object.keys(CONTRACT_TYPES), ['fixed', 'index', 'layered'], 'three contract types, least risk first');
eq(DEFAULT_CONTRACT_TYPE, 'layered', 'layered is the default');

{
  const base = normalizeScenario({}, series, curve);
  eq(base.contractType, 'layered', 'a scenario saved before the choice existed stays layered');
  ok(base.fixedRate > 0, 'and comes with a fixed rate to start from');
  eq(normalizeScenario({ contractType: 'swap' }, series, curve).contractType, 'layered', 'an unknown type falls back to layered');
  eq(normalizeScenario({ contractType: 'fixed', fixedRate: -3 }, series, curve).fixedRate, 0, 'a fixed rate cannot be negative');
  const kept = normalizeScenario({ contractType: 'index', layers: [{ label: 'Q1', pct: 50, price: 3 }] }, series, curve);
  eq(kept.layers.map(l => l.label), ['Q1'], 'switching away from layered keeps the layers for switching back');
}

const scenario = {
  startYear: 2021, startMonth: 1, termMonths: 24, lookback: 0,
  annualVolumeDth: 120000, basis: 0.25, adder: 0.35,
  layers: [{ label: 'Block', pct: 50, price: 3.2 }],
};

{
  const run = buildSavings({ ...scenario, contractType: 'fixed', fixedRate: 4.1 }, series, curve);
  eq(run.hedge.type, 'fixed', 'fixed reports its type');
  eq(run.hedge.pct, 100, 'fixed locks all of the volume');
  near(run.hedge.price, 4.1 - 0.25 - 0.35, 1e-9, 'its Henry Hub strike is the rate less basis and adder');
  ok(run.months.every(m => Math.abs(m.contractAllIn - 4.1) < 1e-9), 'every month bills the fixed all-in rate');
  near(run.totals.contractCost, 4.1 * run.totals.volume, 1e-6, 'so the contract cost is the rate times the volume');
}

{
  const run = buildSavings({ ...scenario, contractType: 'index' }, series, curve);
  eq(run.hedge.pct, 0, 'index locks nothing');
  eq(run.hedge.price, null, 'and has no strike');
  ok(run.months.every(m => Math.abs(m.contractAllIn - (m.index + 0.25 + 0.35)) < 1e-9), 'every month is the index plus the fixed basis and adder');
  near(run.totals.saving, 0, 1e-6, 'so against the index it saves nothing either way');
}

{
  const layered = buildSavings({ ...scenario, contractType: 'layered' }, series, curve);
  const legacy = buildSavings(scenario, series, curve);
  eq(layered.totals, legacy.totals, 'layered prices exactly as a scenario with no type did');
  eq(layered.hedge.pct, 50, 'off its layers');
  eq(contractHedge({ contractType: 'layered', layers: [{ pct: 30, price: 3 }] }).price, 3, 'contractHedge reads the layers for layered');
}

{
  const rows = (sc) => savingsScenarioRows(buildSavings(sc, series, curve));
  const labels = (sc) => rows(sc).map(r => r.label);
  eq(rows({ ...scenario, contractType: 'fixed', fixedRate: 4.1 }).find(r => r.label === 'Contract type')?.value, 'Fixed All-In Rate', 'the export names the contract type');
  ok(labels({ ...scenario, contractType: 'fixed', fixedRate: 4.1 }).some(l => l.startsWith('Fixed all-in rate')), 'and a fixed contract its rate');
  ok(!labels({ ...scenario, contractType: 'index' }).some(l => l.startsWith('Layer ')), 'layers are only listed when they price the contract');
  ok(labels({ ...scenario, contractType: 'layered' }).some(l => l.startsWith('Layer ')), 'which is on a layered one');
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

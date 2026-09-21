// Assertion tests for the look-back on Contract savings: the months BEFORE
// the term, priced off the same tables and the same hedge.
// Plain Node - no test framework (the project has none). Run:
//   node scripts/savingsLookback.test.mjs
//
// Four things are worth pinning hard, because each one is a way for the page
// to make a claim it has not earned.
//
// THE TERM DOES NOT MOVE. A look-back is a second reading, not a longer
// term. Every figure the page called "the term" before this existed has to
// come back identical with four hundred months of history in front of it -
// the saving, the volume, the counts, the ladder. The moment the look-back
// leaks into `totals`, a forward deal is taking credit for a backtest.
//
// THE RECORD DECIDES HOW FAR BACK. "All of it" is a question that only has
// an answer once there is a settle table, and a different answer the moment
// somebody pastes a longer one. So it is resolved against the record at
// build time rather than frozen into a saved number.
//
// POSITION, BACKWARDS. The history volumes are indexed from the term end of
// the run rather than from its start, because the term is the thing that
// does not move. Deepening the look-back must not slide a single entered
// volume onto a different month; indexing history forwards from its own
// first month is exactly how it would.
//
// THE MONTHS JOIN UP. History then term has to be one unbroken run of
// calendar months with no gap and no month counted twice, or every chart
// drawn off `all` is quietly wrong in the middle.
import {
  buildSavings, termLadder, normalizeScenario, defaultScenario, lookbackMonths,
  historySlot, monthlySeries, forwardSeries, normalizeSettles, addMonths, monthKey,
  LOOKBACK_ALL, MAX_LOOKBACK_MONTHS, SHIPPED_SETTLES, SHIPPED_FORWARD,
} from '../src/utils/nymexSavings.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}
function ok(label, cond) { check(label, !!cond, true); }
function near(label, actual, expected, tol) {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${expected} +/- ${tol}\n  actual   ${actual}`);
}

const series = monthlySeries(SHIPPED_SETTLES);
const curve = forwardSeries(SHIPPED_FORWARD);

const scenario = {
  name: 'Look-back',
  startYear: 2027,
  startMonth: 1,
  termMonths: 24,
  annualVolumeDth: 240000,
  volumeShape: 'even',
  basis: 0.15,
  adder: 0.35,
  forwardPrice: 4.1,
  layers: [{ id: 'L1', label: 'Layer 1', pct: 60, price: 3.5 }],
};

// ── how far back "all of it" reaches ─────────────────────────────────────
check('all of the record reaches the first settled month',
  lookbackMonths({ ...scenario, lookback: LOOKBACK_ALL }, series),
  (2027 * 12) - (series[0].year * 12 + (series[0].month - 1)));
check('which is where the shipped table starts', series[0].label, 'Jun 1990');

// The same scenario against a SHORTER record looks back less, without the
// scenario changing: "as far back as the data I gave you" has to follow the
// data rather than freeze the day it was first asked.
const shortSeries = monthlySeries(normalizeSettles([
  [2025, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5],
  [2026, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
]));
check('a shorter table means a shorter look-back, off the same scenario',
  lookbackMonths({ ...scenario, lookback: LOOKBACK_ALL }, shortSeries), 24);
check('no table at all means no look-back rather than a throw',
  lookbackMonths({ ...scenario, lookback: LOOKBACK_ALL }, []), 0);
check('a term opening before the record looks back over nothing',
  lookbackMonths({ ...scenario, startYear: 1980, lookback: LOOKBACK_ALL }, series), 0);
check('a number is taken as that many months', lookbackMonths({ ...scenario, lookback: 18 }, series), 18);
check('a negative look-back is none', lookbackMonths({ ...scenario, lookback: -5 }, series), 0);
check('and one longer than the page holds is clipped',
  lookbackMonths({ ...scenario, lookback: 99999 }, series), MAX_LOOKBACK_MONTHS);

// ── what the scenario stores ─────────────────────────────────────────────
check('a scenario saved before the look-back existed takes the default',
  normalizeScenario({ startYear: 2027, startMonth: 1 }, series, curve).lookback, LOOKBACK_ALL);
check('and the default is the whole record', defaultScenario(series, curve).lookback, LOOKBACK_ALL);
check('a stored number survives the round trip',
  normalizeScenario({ lookback: 36 }, series, curve).lookback, 36);
check('a stored zero means none, not "unset, so all of it"',
  normalizeScenario({ lookback: 0 }, series, curve).lookback, 0);
check('and something nobody meant falls back rather than throwing',
  normalizeScenario({ lookback: 'banana' }, series, curve).lookback, LOOKBACK_ALL);

// ── the term does not move ───────────────────────────────────────────────
const bare = buildSavings({ ...scenario, lookback: 0 }, series, curve);
const deep = buildSavings({ ...scenario, lookback: LOOKBACK_ALL }, series, curve);
check('the look-back runs the months the record has', deep.lookback, deep.history.length);
ok('and it is hundreds of months, off the shipped table', deep.history.length > 400);
check('the term is the same months either way',
  deep.months.map(m => m.key), bare.months.map(m => m.key));
check('and every figure the page calls the term is untouched',
  JSON.stringify(deep.totals), JSON.stringify(bare.totals));
check('including the year rows',
  JSON.stringify(deep.years), JSON.stringify(bare.years));
check('the ladder compares term lengths, not look-backs',
  JSON.stringify(termLadder({ ...scenario, lookback: LOOKBACK_ALL }, series, curve)),
  JSON.stringify(termLadder({ ...scenario, lookback: 0 }, series, curve)));

// ── the look-back is its own reading ─────────────────────────────────────
const back = buildSavings({ ...scenario, lookback: 24 }, series, curve);
check('it ends on the month before the term opens', back.history[back.history.length - 1].label, 'Dec 2026');
check('and starts a look-back before that', back.history[0].label, 'Jan 2025');
// The look-back takes its prices off the same three places in the same
// order, so a look-back that runs past the last settle is quoted rather than
// measured and says so. That is the case here: the shipped settles stop in
// September 2026 and this term opens the following January, so the last
// three months of the look-back are market that has not settled yet.
check('a look-back is measured where the settles reach', back.historyTotals.settledMonths, 21);
check('and quoted or assumed where they do not',
  [back.historyTotals.forwardMonths, back.historyTotals.assumedMonths], [2, 1]);
check('which is the whole look-back accounted for',
  back.historyTotals.settledMonths + back.historyTotals.forwardMonths + back.historyTotals.assumedMonths, 24);
// A term that opens on the month after the last settle looks back over
// nothing but settled market, which is the reading the feature is for.
const measured = buildSavings(
  { ...scenario, startYear: 2026, startMonth: 10, lookback: 24 }, series, curve,
);
check('a look-back behind the last settle is measured throughout',
  measured.historyTotals.settledMonths, 24);
check('so it is a backtest rather than a forecast',
  measured.historyTotals.pricedMonths, 24);
near('the two readings add up to the pair',
  back.allTotals.saving, back.historyTotals.saving + back.totals.saving, 1e-6);
near('and so do their volumes',
  back.allTotals.volume, back.historyTotals.volume + back.totals.volume, 1e-6);
check('the pair counts every month once', back.allTotals.months, 24 + 24);

// ── the months join up ───────────────────────────────────────────────────
check('all is the look-back then the term', back.all.length, back.history.length + back.months.length);
check('in one unbroken run of calendar months',
  back.all.map((m, i) => {
    if (!i) return true;
    const prev = back.all[i - 1];
    const next = addMonths(prev.year, prev.month, 1);
    return m.key === monthKey(next.year, next.month);
  }).every(Boolean), true);
check('each month says which reading it belongs to',
  [back.all[0].phase, back.all[23].phase, back.all[24].phase], ['history', 'history', 'term']);
// The term's running saving still opens at the month the term opens, so the
// chart under it is not off by a backtest.
near('the term running total starts from zero on month one',
  back.months[0].cumulative, back.months[0].saving, 1e-9);
near('while the running total across the window carries the look-back in',
  back.months[0].cumulativeAll, back.historyTotals.saving + back.months[0].saving, 1e-6);
near('and it ends on the pair total', back.all[back.all.length - 1].cumulativeAll, back.allTotals.saving, 1e-6);

// ── history volumes are indexed backwards from the term ──────────────────
check('slot 0 is the month right before the term', historySlot(24, 23), 0);
check('and the oldest month is the last slot', historySlot(24, 0), 23);

const withVolumes = { ...scenario, lookback: 24, historyVolumes: [7000, 6500, null, 0] };
const v24 = buildSavings(withVolumes, series, curve);
const by = (run, label) => run.all.find(m => m.label === label);
check('the month before the term takes the first entered value', by(v24, 'Dec 2026').volume, 7000);
check('the one before that takes the second', by(v24, 'Nov 2026').volume, 6500);
check('a blank in the middle stays on the shape', by(v24, 'Oct 2026').volumeSource, 'shape');
check('and a typed zero is a volume, not a blank', by(v24, 'Sep 2026').volume, 0);
check('which counts as entered', by(v24, 'Sep 2026').volumeSource, 'entered');
check('three of the four given months are entered', v24.historyTotals.enteredVolumeMonths, 3);

// Deepening the look-back must not slide a single one of them.
const v48 = buildSavings({ ...withVolumes, lookback: 48 }, series, curve);
check('a deeper look-back leaves every entered volume on its own month',
  ['Dec 2026', 'Nov 2026', 'Sep 2026'].map(l => by(v48, l).volume),
  ['Dec 2026', 'Nov 2026', 'Sep 2026'].map(l => by(v24, l).volume));
check('and the months it gains are on the shape',
  new Set(v48.history.slice(0, 24).map(m => m.volumeSource)), new Set(['shape']));

// Re-dating the term moves them with it, the same way the term's own list
// moves: the list is tied to the term rather than to the calendar.
const moved = buildSavings({ ...withVolumes, startYear: 2026 }, series, curve);
check('re-dating the term carries the look-back volumes along',
  moved.history[moved.history.length - 1].label, 'Dec 2025');
check('and the first entered value is still on the month before the term',
  moved.history[moved.history.length - 1].volume, 7000);

// ── volumes scale both legs, here as much as on the term ─────────────────
const flatVol = buildSavings({ ...scenario, lookback: 12, historyVolumes: Array(12).fill(1000) }, series, curve);
const doubleVol = buildSavings({ ...scenario, lookback: 12, historyVolumes: Array(12).fill(2000) }, series, curve);
near('doubling the look-back volume doubles its saving',
  doubleVol.historyTotals.saving, flatVol.historyTotals.saving * 2, 1e-6);
near('and leaves the saving per Dth exactly where it was',
  doubleVol.historyTotals.savingPerDth, flatVol.historyTotals.savingPerDth, 1e-9);
check('while the term is none the wiser',
  doubleVol.totals.saving, flatVol.totals.saving);

// ── nothing to look back over ────────────────────────────────────────────
const none = buildSavings({ ...scenario, lookback: 0 }, series, curve);
check('no look-back is an empty run, not a missing one', none.history, []);
check('with totals that are zero rather than null', none.historyTotals.saving, 0);
check('and the pair is just the term', none.allTotals.saving, none.totals.saving);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

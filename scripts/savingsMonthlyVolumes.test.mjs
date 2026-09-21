// Assertion tests for monthly consumption on Contract savings: the paste
// that reads it, the normalizing that stores it, and what it does to the
// priced term.
// Plain Node - no test framework (the project has none). Run:
//   node scripts/savingsMonthlyVolumes.test.mjs
//
// Three things here are worth pinning hard, because each one is a way for
// the page to quietly lie about somebody's gas.
//
// POSITION. The list is a value per month of the TERM, indexed from the
// first one. So a blank in the middle of a pasted column has to come back as
// a blank in that position: compacting it slides April's volume onto March,
// and the page would go on pricing confidently off a year that is one month
// out of step with itself.
//
// ZERO IS NOT BLANK. A typed zero asserts that nothing burns that month. A
// blank asserts nothing at all and falls back to the annual volume over the
// shape. Collapsing the two would turn "I have no figure for June" into "we
// burn nothing in June" and take a month of cost out of the bill.
//
// THE SAVING IS STILL A MEASUREMENT. Volumes scale both legs, so scaling
// every month by the same factor has to scale the bill and the saving and
// leave the saving PER DTH alone. Moving volume between months is the one
// that may change the rate, and has to: a month's saving is that month's
// index against the strike, which is the whole reason real consumption is
// worth entering rather than spreading an annual number flat.
import {
  normalizeMonthlyVolumes, parseMonthlyVolumes, volumeSummary, normalizeScenario,
  buildSavings, monthlySeries, forwardSeries, defaultScenario, termLadder,
  SHIPPED_SETTLES, SHIPPED_FORWARD, VOLUME_SHAPES,
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

// ── reading a paste ──────────────────────────────────────────────────────
// A column copied out of a spreadsheet, header and all, with a hole in it.
const pasted = parseMonthlyVolumes('Month\tDth\nJan 2027\t3,100\nFeb 2027\t2,780\n\nApr 2027\t1,490\n');
check('the header is skipped rather than read as a volume', pasted.volumes, [3100, 2780, null, 1490]);
check('and reported, so nothing vanishes silently', pasted.skipped, ['Month Dth']);
check('the count is the months that got a number', pasted.count, 3);
check('and the blanks are counted separately', pasted.blanks, 1);

check('a thousands separator is part of the number', parseMonthlyVolumes('3,100').volumes, [3100]);
check('a bare column reads straight through',
  parseMonthlyVolumes('3100\n2780\n2240\n1490').volumes, [3100, 2780, 2240, 1490]);
check('a row copied across reads as the run, blanks and all',
  parseMonthlyVolumes('3100\t2780\t2240\t\t1070').volumes, [3100, 2780, 2240, null, 1070]);
// ── the month boxes copy back in ─────────────────────────────────────────
// The obvious thing to do with a grid of month boxes is copy it and paste it
// back, and off the page that gives a label and a value on alternate lines.
// Every label but January holds no number; "Jan 2027" holds 2027. Read as a
// volume it is a burn of two thousand Dth in January AND a shift of every
// month after it, which is the worst kind of wrong: plausible, and silent.
const roundTrip = parseMonthlyVolumes('Nov\n20,833\nDec\n4371.8\nJan 2027\n8205.2\nFeb\n20,833');
check('a month label on its own is a label, year and all',
  roundTrip.volumes, [20833, 4371.8, 8205.2, 20833]);
check('so January does not become its own year', roundTrip.volumes.includes(2027), false);
check('the labels are reported as labels',
  roundTrip.labels, ['Nov', 'Dec', 'Jan 2027', 'Feb']);
check('and not as lines nothing could be made of', roundTrip.skipped, []);
check('every way a month gets written reads as one',
  parseMonthlyVolumes("January\nJan\nJan.\nJan 27\nJan '27\nJan 2027\nSEPT").labels.length, 7);
// The label only wins when it is the WHOLE line. A label with a volume past
// it is the format the box has always documented and must not change.
check('a label with a number past it still gives up the number',
  parseMonthlyVolumes('Jan 2027\t3,100\nFeb 2027\t2,780').volumes, [3100, 2780]);
check('and a word that is not a month is still a line it could not read',
  parseMonthlyVolumes('Total\n500\nDth').skipped, ['Total', 'Dth']);
check('a bare year is a number, because nothing says otherwise',
  parseMonthlyVolumes('2027').volumes, [2027]);

check('a label in front is ignored and the number taken from the end',
  parseMonthlyVolumes('Month 1: 3100 Dth\nMonth 2: 2,780 Dth').volumes, [3100, 2780]);
check('so is a unit after it', parseMonthlyVolumes('3,100 Dth').volumes, [3100]);
check('decimals survive', parseMonthlyVolumes('3100.5').volumes, [3100.5]);
check('a zero is a volume', parseMonthlyVolumes('3100\n0\n2240').volumes, [3100, 0, 2240]);
check('a negative volume is not, and holds its place',
  parseMonthlyVolumes('3100\n-50\n2240').volumes, [3100, null, 2240]);
check('and is reported', parseMonthlyVolumes('3100\n-50\n2240').skipped, ['-50']);
check('trailing blanks carry no information and are dropped',
  parseMonthlyVolumes('3100\n2780\n\n\n').volumes, [3100, 2780]);
check('nothing usable reads as nothing', parseMonthlyVolumes('Month\tDth\ntotal').count, 0);
check('and says what it could not read',
  parseMonthlyVolumes('Month\tDth\ntotal').skipped, ['Month Dth', 'total']);
check('an empty paste is empty', parseMonthlyVolumes('').volumes, []);
check('and so is nothing at all', parseMonthlyVolumes(null).volumes, []);

// A single line with ONE number is a column of one, not a row.
check('one value is one month', parseMonthlyVolumes('3100').volumes, [3100]);

// ── storing it ───────────────────────────────────────────────────────────
check('a blank in the middle holds its position',
  normalizeMonthlyVolumes([3100, null, 2240]), [3100, null, 2240]);
check('an empty string is a blank, not a zero',
  normalizeMonthlyVolumes([3100, '', 2240]), [3100, null, 2240]);
check('text is a blank too', normalizeMonthlyVolumes([3100, 'n/a', 2240]), [3100, null, 2240]);
check('a negative is a blank', normalizeMonthlyVolumes([-5]), []);
check('a numeric string is a number', normalizeMonthlyVolumes(['3100']), [3100]);
check('a zero is kept', normalizeMonthlyVolumes([0, 1]), [0, 1]);
check('not an array is nothing', normalizeMonthlyVolumes('3100'), []);
check('nothing is nothing', normalizeMonthlyVolumes(null), []);
ok('a list longer than the longest term is cut to it',
  normalizeMonthlyVolumes(Array.from({ length: 400 }, () => 100)).length === 120);

check('a scenario carries its volumes through settings',
  normalizeScenario({ monthlyVolumes: [3100, null, 2240] }, series, curve).monthlyVolumes,
  [3100, null, 2240]);
check('a scenario that never had any opens without',
  normalizeScenario({}, series, curve).monthlyVolumes, []);
check('and so does the shipped default', defaultScenario(series, curve).monthlyVolumes, []);
check('junk in the settings document does not break the scenario',
  normalizeScenario({ monthlyVolumes: { 0: 3100 } }, series, curve).monthlyVolumes, []);

// ── pricing the term off them ────────────────────────────────────────────
const base = {
  name: 'volumes', startYear: 2024, startMonth: 1, termMonths: 4,
  annualVolumeDth: 1200, volumeShape: 'even', basis: 0.1, adder: 0.25,
  forwardPrice: 5, layers: [{ id: 'L1', label: 'Layer 1', pct: 100, price: 3 }],
};
const shaped = buildSavings(base, series, curve);
check('with no volumes given, every month is the annual number over the shape',
  shaped.months.map(m => m.volume), [100, 100, 100, 100]);
check('and every month says so', new Set(shaped.months.map(m => m.volumeSource)), new Set(['shape']));
check('the totals count them as shaped', shaped.totals.enteredVolumeMonths, 0);
check('all of them', shaped.totals.shapedVolumeMonths, 4);
check('and the summary says as much', volumeSummary(shaped.totals), '4 off the shape');

const given = buildSavings({ ...base, monthlyVolumes: [500, 0, null, 250] }, series, curve);
check('a volume given is the volume used', given.months.map(m => m.volume), [500, 0, 100, 250]);
check('a typed zero is a month that burns nothing, not a month with no figure',
  given.months[1].volumeSource, 'entered');
check('a blank is the month with no figure, and it prices off the shape',
  given.months[2].volumeSource, 'shape');
check('the counts keep the two apart', given.totals.enteredVolumeMonths, 3);
check('and the rest', given.totals.shapedVolumeMonths, 1);
check('the summary names both', volumeSummary(given.totals), '3 entered, 1 off the shape');
near('the term volume is what the months actually burn', given.totals.volume, 850, 1e-9);

// Scaling every month by the same factor scales the bill and the saving with
// it and leaves the saving per Dth alone: the saving is the strike against
// the index, and doubling the gas cannot move that rate.
const doubled = buildSavings({ ...base, monthlyVolumes: [200, 200, 200, 200] }, series, curve);
near('twice the volume, twice the bill', doubled.totals.indexCost, shaped.totals.indexCost * 2, 1e-6);
near('twice the saving', doubled.totals.saving, shaped.totals.saving * 2, 1e-6);
near('the same saving per Dth', doubled.totals.savingPerDth, shaped.totals.savingPerDth, 1e-9);

// Moving volume BETWEEN months is a different matter, and it is the whole
// reason real consumption is worth entering: a month's saving is that
// month's index against the strike, so a term that burns most of its gas in
// the dear months saves differently from the same gas spread flat. A page
// that gave the same answer either way would be reading the shape and
// ignoring the volumes.
const front = buildSavings({ ...base, monthlyVolumes: [400, 0, 0, 0] }, series, curve);
const back = buildSavings({ ...base, monthlyVolumes: [0, 0, 0, 400] }, series, curve);
near('the same gas, the same bill weight', front.totals.volume, back.totals.volume, 1e-9);
ok('but not the same saving, because it burns against a different month',
  Math.abs(front.totals.saving - back.totals.saving) > 1);
near('and the term saving is still the months added up',
  given.totals.saving, given.months.reduce((n, m) => n + m.saving, 0), 1e-9);

// A month past the end of the list is shaped, not zero: a term lengthened
// after the volumes were pasted must not silently price the tail at nothing.
const lengthened = buildSavings({ ...base, termMonths: 6, monthlyVolumes: [500, 500] }, series, curve);
check('months past the end of the list fall back to the shape',
  lengthened.months.map(m => m.volumeSource),
  ['entered', 'entered', 'shape', 'shape', 'shape', 'shape']);
ok('and none of them is priced at no volume', lengthened.months.every(m => m.volume > 0));

// A term shortened below the list prices only the months it runs, and the
// values past its end are simply unused.
const shortened = buildSavings({ ...base, termMonths: 2, monthlyVolumes: [500, 0, null, 250] }, series, curve);
check('a shortened term uses only the months it runs', shortened.months.map(m => m.volume), [500, 0]);
near('and its volume is only theirs', shortened.totals.volume, 500, 1e-9);

// The year rows carry the same split, which is what the export reads.
const acrossYears = buildSavings(
  { ...base, startMonth: 12, termMonths: 3, monthlyVolumes: [400, null, 600] }, series, curve,
);
check('a year row counts the volumes that were given',
  acrossYears.years.map(y => [y.year, y.months, y.enteredVolume]), [[2024, 1, 1], [2025, 2, 1]]);

// The ladder re-prices the same hedge over other term lengths, so it has to
// read the volumes the same way rather than quietly reverting to the shape.
const withVolumes = { ...base, termMonths: 12, monthlyVolumes: [500, 500] };
const ladder = termLadder(withVolumes, series, curve);
ok('every rung of the ladder is priced', ladder.length === 5);
near('a rung is the same term priced on its own',
  ladder[0].saving, buildSavings({ ...withVolumes, termMonths: 12 }, series, curve).totals.saving, 1e-9);
ok('and the volumes reached it, so it is not the shaped answer',
  Math.abs(ladder[0].saving - termLadder({ ...base, termMonths: 12 }, series, curve)[0].saving) > 1);
// The shape still prices the months the list does not reach, which on a
// 12 month rung is ten of them.
near('the shaped tail is the annual number over the shape',
  buildSavings({ ...withVolumes, termMonths: 12 }, series, curve).totals.volume,
  500 + 500 + VOLUME_SHAPES.even.weights[2] * 1200 * 10, 1e-6);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

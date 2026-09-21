// Assertion tests for the Contract savings month by month export.
// Plain Node - no test framework (the project has none). Run:
//   node scripts/savingsExport.test.mjs
//
// What is worth pinning here is that the file says the same thing the page
// says.
//
// Every money and price cell has to leave as a NUMBER, because the only
// thing anybody does with a column of savings is total it, and a cell
// holding "$3,906" will not total. So the rows are checked for type as well
// as value, and the term total is recomputed off the month rows rather than
// trusted.
//
// The other half is provenance. A month priced off the forward curve and a
// month priced at the flat assumption are different claims from a settled
// one, and on screen each carries its own flag. A spreadsheet has nowhere to
// hang a flag, so the export owes them a column and the scenario sheet owes
// the reader the strike, the basis, the adder and the date the curve was
// quoted at. A file with none of that is a column of savings nobody can
// check.
import {
  SAVINGS_MONTH_HEADERS, SAVINGS_MONTH_FORMATS, savingsMonthAoa,
  savingsScenarioRows, savingsScenarioAoa, savingsFilename, columnWidths,
} from '../src/utils/savingsExport.js';
import { buildSavings, monthlySeries, forwardSeries, SHIPPED_SETTLES, SHIPPED_FORWARD } from '../src/utils/nymexSavings.js';

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

// A term that deliberately runs through all three pricing states: it starts
// inside the settles, crosses the gap the shipped tables leave, runs through
// the curve and comes out the far side of it.
//
// No look-back on it, because everything below is about what the TERM
// exports and the look-back is a separate block of rows with its own total.
// It gets its own scenario further down rather than being mixed into this
// one, where it would put four hundred settled months in front of every
// assertion about the first month of the term.
const scenario = {
  name: 'Midwest plants, 2027 renewal',
  startYear: series[series.length - 1].year,
  startMonth: 1,
  termMonths: 60,
  lookback: 0,
  annualVolumeDth: 250000,
  volumeShape: 'heating',
  basis: 0.15,
  adder: 0.35,
  forwardPrice: 4.1,
  layers: [
    { id: 'L1', label: 'Layer 1', pct: 40, price: 3.5 },
    { id: 'L2', label: 'Layer 2', pct: 25, price: 3.7 },
  ],
};
const run = buildSavings(scenario, series, curve);
const aoa = savingsMonthAoa(run);
const [header, ...rows] = aoa;
// Columns are looked up by name rather than counted: the last time a column
// was added in the middle, every index below it pointed one place left and
// five assertions failed for a reason that had nothing to do with them.
const col = (name) => {
  const i = header.findIndex(h => h === name || h.startsWith(`${name} (`));
  if (i < 0) throw new Error(`no column named ${name}`);
  return i;
};
const C = {
  month: col('Month'), period: col('Period'), from: col('Priced from'), index: col('Index'),
  volume: col('Volume (Dth)'), volumeFrom: col('Volume from'),
  atIndex: col('At index'), onContract: col('On contract'),
  saving: col('Saving'), running: col('Running saving'),
};
const monthRows = rows.slice(0, -1);
const totalRow = rows[rows.length - 1];

// ── the sheet is the table ───────────────────────────────────────────────
check('the header is the table\'s own columns', header, SAVINGS_MONTH_HEADERS);
check('a row per month of the term, plus the total', rows.length, run.months.length + 1);
check('with no look-back there is no look-back block', run.history.length, 0);
check('and every month row is the term', new Set(monthRows.map(r => r[C.period])), new Set(['Term']));
check('a format for every column', SAVINGS_MONTH_FORMATS.length, SAVINGS_MONTH_HEADERS.length);
check('the months come out in term order', monthRows.map(r => r[0]).slice(0, 3),
  run.months.slice(0, 3).map(m => m.label));
check('the first month is the month the term starts', monthRows[0][C.month], run.months[0].label);

// ── numbers stay numbers ─────────────────────────────────────────────────
const numericCols = SAVINGS_MONTH_FORMATS.map((f, i) => (f ? i : -1)).filter(i => i >= 0);
ok('every formatted cell of every month row is a number',
  monthRows.every(r => numericCols.every(c => typeof r[c] === 'number' && Number.isFinite(r[c]))));
ok('and so is every one on the total row',
  numericCols.every(c => typeof totalRow[c] === 'number' && Number.isFinite(totalRow[c])));
ok('nothing leaked a dollar sign into a cell',
  rows.every(r => !r.some(v => typeof v === 'string' && v.includes('$'))));

// ── the total row totals ─────────────────────────────────────────────────
const sumCol = (c) => monthRows.reduce((n, r) => n + r[c], 0);
check('the total row is labelled', totalRow[C.month], 'Term total');
near('volume on the total row is the sum of the months', totalRow[C.volume], sumCol(C.volume), 0.5);
near('at index likewise', totalRow[C.atIndex], sumCol(C.atIndex), 0.5);
near('on contract likewise', totalRow[C.onContract], sumCol(C.onContract), 0.5);
near('and the saving', totalRow[C.saving], sumCol(C.saving), 0.5);
// The three price columns average rather than sum - a summed $/Dth is a
// number that means nothing, and the Year by year table does the same.
near('the price columns carry the term average, not a sum',
  totalRow[C.index], monthRows.reduce((n, r) => n + r[C.index], 0) / monthRows.length, 1e-6);
near('the running column ends where the saving does',
  monthRows[monthRows.length - 1][C.running], totalRow[C.saving], 0.5);
near('the saving is index minus contract', totalRow[C.saving], totalRow[C.atIndex] - totalRow[C.onContract], 0.5);

// ── provenance, month by month ───────────────────────────────────────────
const sources = new Set(monthRows.map(r => r[C.from]));
ok('this term really does hit all three states', sources.size === 3);
check('and they are named in full', [...sources].sort(),
  ['Flat assumption', 'Forward curve', 'Settled']);
check('the settled months are the ones the run settled',
  monthRows.filter(r => r[C.from] === 'Settled').length, run.totals.settledMonths);
check('the curve months likewise',
  monthRows.filter(r => r[C.from] === 'Forward curve').length, run.totals.forwardMonths);
check('and the flat ones',
  monthRows.filter(r => r[C.from] === 'Flat assumption').length, run.totals.assumedMonths);
ok('the total row says where the term was priced from',
  /settled/.test(totalRow[C.from]) && /flat assumption/.test(totalRow[C.from]));

const meta = { forwardAsOf: 'quoted 2026-09-12', customSettles: false, customForward: true };

// ── provenance, volume by volume ─────────────────────────────────────────
// A volume somebody gave and a volume the page spread off an annual number
// are different claims too, and the file has to keep them apart the same way
// the prices are kept apart.
check('a term with no volumes of its own says so on every row',
  new Set(monthRows.map(r => r[C.volumeFrom])), new Set(['Annual volume and shape']));

const mixed = buildSavings({ ...scenario, monthlyVolumes: [3100, 2780, null, 0] }, series, curve);
const mixedRows = savingsMonthAoa(mixed).slice(1, -1);
check('an entered volume is used as given', mixedRows[0][C.volume], 3100);
check('and named as entered', mixedRows[0][C.volumeFrom], 'Entered');
check('a blank month falls back to the shape', mixedRows[2][C.volumeFrom], 'Annual volume and shape');
check('a typed zero is a volume, not a blank', mixedRows[3][C.volume], 0);
check('and it counts as entered', mixedRows[3][C.volumeFrom], 'Entered');
check('past the end of the list every month is shaped',
  new Set(mixedRows.slice(4).map(r => r[C.volumeFrom])), new Set(['Annual volume and shape']));
check('the total row counts both kinds',
  savingsMonthAoa(mixed).slice(-1)[0][C.volumeFrom], '3 entered, 57 off the shape');
check('and the scenario sheet says the same',
  savingsScenarioRows(mixed, meta).find(n => n.label === 'Monthly volumes').value,
  '3 entered, 57 off the shape');

// ── the scenario sheet ───────────────────────────────────────────────────
const notes = savingsScenarioRows(run, meta);
const noteOf = (label) => notes.find(n => n.label === label);
check('the scenario is named', noteOf('Scenario').value, 'Midwest plants, 2027 renewal');
check('the term is spelled out', noteOf('Term').value,
  `${run.months[0].label} to ${run.months[run.months.length - 1].label}`);
check('the basis travels', noteOf('Basis ($/Dth)').value, 0.15);
check('the adder travels', noteOf('Retail adder ($/Dth)').value, 0.35);
check('the flat assumption travels', noteOf('Flat assumption ($/Dth)').value, 4.1);
check('the strike travels', noteOf('Blended strike ($/Dth)').value, run.hedge.price);
check('the hedged share goes out as a fraction for a percent format',
  noteOf('Hedged share').value, run.hedge.pct / 100);
check('every layer is listed', notes.filter(n => /^Layer \d+:/.test(n.label)).length, 2);
check('a layer reads as its share and its price',
  noteOf('Layer 1: Layer 1').value, '40% at $3.500');
check('the volume shape is named, not left as a key',
  noteOf('Volume shape').value.startsWith('Heating load'), true);
check('a pasted curve says so, with the date it was quoted at',
  noteOf('Forward curve').value, 'pasted, quoted 2026-09-12');
check('a shipped settle table says so too',
  noteOf('Settles table').value, 'shipped with the app');
check('the saving is on the sheet as a number', typeof noteOf('Saving').value, 'number');
near('and it is the same saving the months add up to',
  noteOf('Saving').value, totalRow[C.saving], 0.5);

const noteAoa = savingsScenarioAoa(run, meta);
check('the scenario sheet is two columns', noteAoa[0], ['Assumption', 'Value']);
check('one row per note, under the header', noteAoa.length, notes.length + 1);

// A hedge of nothing is a real scenario - it is how somebody prices the term
// at index - and it must not put a null where a price goes.
const atIndex = buildSavings({ ...scenario, layers: [{ id: 'L1', label: 'Layer 1', pct: 0, price: 0 }] }, series, curve);
check('an unhedged term says so rather than showing an empty strike',
  savingsScenarioRows(atIndex, meta).find(n => n.label === 'Blended strike ($/Dth)').value,
  'nothing locked');
near('and it saves nothing, because it is the index twice',
  savingsMonthAoa(atIndex).slice(1).pop()[C.saving], 0, 0.5);

// ── the look-back ────────────────────────────────────────────────────────
// The months BEFORE the term, priced off the same tables and the same hedge.
// Two things have to hold or the file makes a claim the page does not.
//
// They stay APART from the term. A look-back is settled market the contract
// never covered; adding its saving to the term's would hand a forward deal
// credit for a backtest. So each block carries its own total, and the row
// that adds them is last and says so.
//
// And a reader must be able to tell which is which without counting rows,
// because the first thing anybody does with this sheet is sort it.
const lookedBack = buildSavings({ ...scenario, termMonths: 12, lookback: 24 }, series, curve);
const backRows = savingsMonthAoa(lookedBack).slice(1);
check('the look-back runs the months it was asked for', lookedBack.history.length, 24);
check('ending on the month before the term opens',
  lookedBack.history[lookedBack.history.length - 1].label,
  `Dec ${scenario.startYear - 1}`);
check('every row says which reading it belongs to',
  [...new Set(backRows.map(r => r[C.period]))].sort(), ['', 'Look-back', 'Term']);
check('the look-back comes first, then the term',
  backRows.map(r => r[C.period]).indexOf('Term') > backRows.map(r => r[C.period]).lastIndexOf('Look-back'),
  true);
check('a block per reading plus the pair, each with its own total',
  backRows.length, 24 + 1 + 12 + 1 + 1);
const backTotal = backRows.find(r => r[C.month] === 'Look-back total');
const termTotal = backRows.find(r => r[C.month] === 'Term total');
const bothTotal = backRows[backRows.length - 1];
check('the pair row is labelled and last', bothTotal[C.month], 'Look-back and term');
near('the look-back total sums the look-back months only',
  backTotal[C.saving],
  backRows.filter(r => r[C.period] === 'Look-back').reduce((n, r) => n + r[C.saving], 0), 0.5);
near('the term total is untouched by the months in front of it',
  termTotal[C.saving],
  buildSavings({ ...scenario, termMonths: 12, lookback: 0 }, series, curve).totals.saving, 0.5);
near('and the pair row is the two added up',
  bothTotal[C.saving], backTotal[C.saving] + termTotal[C.saving], 0.5);
// Every month before this term has settled, which is the whole reason the
// look-back is worth having: it is measured rather than quoted.
check('the look-back months are settled market',
  new Set(backRows.filter(r => r[C.period] === 'Look-back').map(r => r[C.from])),
  new Set(['Settled']));
const backNotes = savingsScenarioRows(lookedBack, meta);
check('the scenario sheet spells the look-back out',
  backNotes.find(n => n.label === 'Look-back').value,
  `${lookedBack.history[0].label} to ${lookedBack.history[lookedBack.history.length - 1].label}`);
check('and counts its months', backNotes.find(n => n.label === 'Look-back months').value, 24);
check('a term with none says so rather than leaving the reader guessing',
  savingsScenarioRows(run, meta).find(n => n.label === 'Look-back').value, 'none, the term only');
// A volume given for a look-back month is used for it, the same way the
// term's own list is: the point of entering history is that it is real.
const backVolumes = buildSavings(
  { ...scenario, termMonths: 12, lookback: 24, historyVolumes: [7000, 6500] }, series, curve,
);
const backVolRows = savingsMonthAoa(backVolumes).slice(1).filter(r => r[C.period] === 'Look-back');
check('the last look-back month takes the first entered history volume',
  backVolRows[backVolRows.length - 1][C.volume], 7000);
check('and the one before it takes the second',
  backVolRows[backVolRows.length - 2][C.volume], 6500);
check('named as entered, like any other volume somebody gave',
  backVolRows[backVolRows.length - 1][C.volumeFrom], 'Entered');
check('while the months nobody gave stay on the shape',
  new Set(backVolRows.slice(0, -2).map(r => r[C.volumeFrom])), new Set(['Annual volume and shape']));

// ── widths and the filename ──────────────────────────────────────────────
const widths = columnWidths(aoa, { min: 14, max: 28 });
check('a width per column', widths.length, header.length);
ok('widths stay inside the cap', widths.every(w => w.wch >= 14 && w.wch <= 28));

const stamp = new Date('2026-09-18T12:00:00Z');
check('the filename carries the scenario and the day',
  savingsFilename('Midwest plants, 2027 renewal', stamp),
  'Midwest_plants_2027_renewal_savings_by_month_2026-09-18.xlsx');
check('an unnamed scenario still downloads',
  savingsFilename('', stamp), 'hedge_savings_by_month_2026-09-18.xlsx');
check('and a name of nothing but punctuation does too',
  savingsFilename('///', stamp), 'hedge_savings_by_month_2026-09-18.xlsx');

// ── an empty term ────────────────────────────────────────────────────────
// The panel refuses to export one, but the builder must not invent a total
// row for months that do not exist.
check('no months means the header alone', savingsMonthAoa({ months: [], totals: {} }), [SAVINGS_MONTH_HEADERS]);
check('and a look-back with no term behind it still exports its own block',
  savingsMonthAoa({ months: [], totals: {}, history: [], historyTotals: {} }), [SAVINGS_MONTH_HEADERS]);
check('and nothing at all does not throw', savingsMonthAoa(null), [SAVINGS_MONTH_HEADERS]);
check('an empty term still describes itself',
  savingsScenarioRows({ months: [], totals: {}, scenario: {}, hedge: {} }).find(n => n.label === 'Term').value,
  'no months');

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

// Assertion tests for the Master Analysis Summary tab's Interval Data
// section. Plain Node — no test framework (the project has none). Run:
//   node scripts/intervalDataSummary.test.mjs
//
// This builds a real worksheet with the real exceljs and reads back what
// landed, rather than asserting against a mock. The section is a layout, and
// the things that break a layout silently — a row in the wrong order, a data
// bar scaled to itself so every percentage fills the whole width — only show
// up in what actually got written.
import ExcelJS from 'exceljs';
import { appendIntervalDataSummary } from '../src/utils/intervalDataSummary.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
function ok(value, name) { eq(!!value, true, name); }

// A sheet with something already on it: the section appends below whatever
// the Summary ended on, which varies by portfolio.
function build(coverage, priorRows = 1) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Summary');
  for (let i = 1; i <= priorRows; i += 1) ws.getCell(i, 1).value = `prior ${i}`;
  appendIntervalDataSummary(ws, coverage);
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (r, n) => rows.push({ n, value: r.getCell(1).value, height: r.height }));
  return { ws, rows: rows.filter(r => r.n > priorRows) };
}

const COVERAGE = { totalSites: 2546, mapped: 2471, intervalYes: 2357, mappedInterval: 2320 };

// --- the order asked for, top to bottom -----------------------------------
// Heading, then each KPI under its own bar, then the caption. The bar goes
// ABOVE its label, so a reader meets the shape before the sentence.
{
  const { rows } = build(COVERAGE);
  eq(rows.length, 8, 'the section is eight rows: a heading, three bar+label pairs, and a caption');
  eq(rows[0].value, 'Interval Data', 'row 1 is the heading');
  eq(rows[1].value, 0.97, 'row 2 is the bar for the mapped share');
  ok(String(rows[2].value).startsWith('Sites mapped to a known utility:'), 'row 3 is the mapped label, under its bar');
  eq(rows[3].value, 0.93, 'row 4 is the bar for the interval-data share');
  ok(String(rows[4].value).startsWith('Sites with utility interval data:'), 'row 5 is the interval label, under its bar');
  eq(rows[5].value, 0.91, 'row 6 is the bar for the intersection');
  ok(String(rows[6].value).startsWith('Sites both mapped and with interval data:'), 'row 7 is the intersection label');
  ok(String(rows[7].value).startsWith('How many sites % are mapped and have interval data'), 'row 8 is the caption asked for');

  // The definition stays with the caption: without it, "93%" is a number
  // nobody can check.
  ok(String(rows[7].value).includes('Status reports interval data available'), 'the caption keeps the definition of interval data');
  // And it now says the two shares are NOT nested, which is what makes the
  // third line necessary rather than redundant.
  ok(String(rows[7].value).includes('rather than one inside the other'), 'the caption says the first two are separate shares');
}

// --- the intersection is counted, not derived -----------------------------
// It cannot be got by multiplying the two shares: each is already a share of
// ALL sites, so 93% of 97% would apply the mapped filter twice. Nor are they
// nested — a site's interval answer comes from its mapping-table row, which
// exists even when the mapped value is not a known utility. So the count is
// passed in, and the section must use it verbatim.
{
  // An intersection LOWER than both inputs: some interval-yes sites are
  // unmapped. Multiplying the shares (0.97 × 0.93 = 90%) would be a
  // coincidence here, not a derivation — the point is that this reads the
  // supplied number.
  const { rows } = build({ totalSites: 1000, mapped: 900, intervalYes: 800, mappedInterval: 700 });
  eq(rows[5].value, 0.7, 'the intersection bar is the supplied count over all sites');
  eq(rows[6].value, 'Sites both mapped and with interval data:  70%   (700 of 1,000 sites · 78% of mapped sites)',
    'the label carries both denominators, so neither reading is ambiguous');

  // An intersection EQUAL to intervalYes — the nested case. Still read from
  // the count rather than assumed.
  const nested = build({ totalSites: 1000, mapped: 900, intervalYes: 800, mappedInterval: 800 });
  eq(nested.rows[6].value, 'Sites both mapped and with interval data:  80%   (800 of 1,000 sites · 89% of mapped sites)',
    'a genuinely nested portfolio reports the same count, not a re-derived one');
}

// An older caller that supplies no intersection omits the line rather than
// inventing one from the two shares.
{
  const { rows } = build({ totalSites: 2546, mapped: 2471, intervalYes: 2357 });
  eq(rows.length, 6, 'without the count the section is the previous six rows');
  ok(!rows.some(r => String(r.value).startsWith('Sites both mapped')), 'and no intersection line is fabricated');
}

// Zero mapped sites can't yield a "% of mapped" — it is dropped rather than
// dividing by zero.
{
  const { rows } = build({ totalSites: 100, mapped: 0, intervalYes: 0, mappedInterval: 0 });
  eq(rows[6].value, 'Sites both mapped and with interval data:  0%   (0 of 100 sites)',
    'with nothing mapped the "% of mapped" clause is omitted, not NaN');
}

// The labels carry the percentage and the counts, as they read on the
// Utility Mapping tab.
{
  const { rows } = build(COVERAGE);
  eq(rows[2].value, 'Sites mapped to a known utility:  97%   (2,471 of 2,546 sites)', 'the mapped label reads exactly as specified');
  eq(rows[4].value, 'Sites with utility interval data:  93%   (2,357 of 2,546 sites)', 'the interval label reads exactly as specified');
}

// --- the bars are real data bars, scaled 0..100 ---------------------------
// Left to itself Excel scales a data bar to the min and max of its range,
// which for a single cell fills the whole width whatever the number is — 60%
// and 97% would both read as "all of it". The explicit 0..1 is what makes the
// bar mean something.
{
  const { ws } = build(COVERAGE);
  const cf = ws.conditionalFormattings || [];
  eq(cf.length, 3, 'one data bar per KPI');
  for (const block of cf) {
    const rule = block.rules[0];
    eq(rule.type, 'dataBar', 'the rule is a data bar');
    eq(rule.cfvo, [{ type: 'num', value: 0 }, { type: 'num', value: 1 }], 'scaled from 0 to 1, not to the range');
  }
  // Each bar sits on the row directly above its label.
  eq(cf.map(b => b.ref).sort(), ['A4:H4', 'A6:H6', 'A8:H8'], 'the bars cover the three bar rows, full width');
}

// The bar cell is a NUMBER with a percent format, not text: a data bar over
// text renders nothing, and the format is what keeps 0.97 reading as 97%.
{
  const { ws } = build(COVERAGE);
  for (const row of [4, 6, 8]) {
    eq(typeof ws.getCell(row, 1).value, 'number', `row ${row} holds a number so the bar has something to scale`);
    eq(ws.getCell(row, 1).numFmt, '0%', `row ${row} is formatted as a percentage`);
  }
}

// --- it appends, wherever the Summary ended -------------------------------
// The sections above vary in length (the top-states table has a row per
// state), so nothing here may assume a row number.
{
  const a = build(COVERAGE, 1);
  const b = build(COVERAGE, 20);
  eq(a.rows.map(r => r.value), b.rows.map(r => r.value), 'the same section is written wherever it lands');
  eq(b.rows[0].n, 22, 'it starts a blank row below what was already there');
}

// --- refusing to write ----------------------------------------------------
// No sites is not "0% of them": it means the coverage was never measured, and
// a band of zeros would be read as a finding.
{
  for (const [label, coverage] of [
    ['no coverage at all', null],
    ['undefined coverage', undefined],
    ['zero sites', { totalSites: 0, mapped: 0, intervalYes: 0 }],
    ['missing totalSites', { mapped: 10, intervalYes: 5 }],
  ]) {
    eq(build(coverage).rows.length, 0, `${label} writes nothing rather than a row of zeros`);
  }
  // A missing worksheet is a caller bug, not a crash in the export.
  eq(appendIntervalDataSummary(null, COVERAGE), undefined, 'no worksheet returns quietly');
}

// Real coverage with genuinely zero on one figure IS written — that is a
// finding, unlike an unmeasured portfolio.
{
  const { rows } = build({ totalSites: 100, mapped: 100, intervalYes: 0 });
  eq(rows.length, 6, 'a real zero share is still written');
  eq(rows[3].value, 0, 'the bar shows nothing, honestly');
  ok(String(rows[4].value).includes('0%   (0 of 100 sites)'), 'and the label says none of them');
}

// Rounding is to whole points, and the label and the bar agree.
{
  const { rows } = build({ totalSites: 3, mapped: 2, intervalYes: 1 });
  eq(rows[1].value, 0.67, 'two thirds rounds to 67% on the bar');
  ok(String(rows[2].value).includes('67%   (2 of 3 sites)'), 'and the label says 67% too');
  eq(rows[3].value, 0.33, 'one third rounds to 33%');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

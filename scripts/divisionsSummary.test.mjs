// Assertion tests for the Master Analysis "Divisions" tab. Plain Node — no
// test framework (the project has none). Run:
//   node scripts/divisionsSummary.test.mjs
//
// Two halves. The first checks the aggregation: what lands in which bucket,
// how a site outside the compliance scope is treated, and how divisions and
// markets are ordered. The second builds a real worksheet with the real
// exceljs and reads back what got written — the ISO picker is a dropdown
// plus formulas, and the ways that breaks silently (a validation pointing at
// the wrong range, an HLOOKUP row index off by one, a cached result that
// disagrees with the matrix under it) only show up in the file.
import ExcelJS from 'exceljs';
import {
  summarizeDivisions, buildDivisionsSheet, divisionLabel, isoLabel,
  NO_DIVISION_LABEL, ALL_ISO_LABEL, UNKNOWN_ISO_LABEL,
} from '../src/utils/divisionsSummary.js';
import { NONE_WECC } from '../src/utils/isoLookup.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
function ok(value, name) { eq(!!value, true, name); }

const site = (division, iso, over = {}) => ({
  division, iso,
  mapped: false, interval: null,
  compliance: null,
  ...over,
});
const screened = (over = {}) => ({
  matched: true,
  eligible: { bbs: false, audits: false, bps: false },
  penalty: null,
  ...over,
});

// ---- aggregation --------------------------------------------------------

{
  const facts = [
    site('Retail', 'PJM', { mapped: true, interval: true, compliance: screened({ eligible: { bbs: true, audits: false, bps: true }, penalty: 5000 }) }),
    site('Retail', 'PJM', { mapped: true, interval: false, compliance: screened({ eligible: { bbs: true, audits: false, bps: false }, penalty: 2000 }) }),
    site('Retail', 'ERCOT', { mapped: false, interval: null, compliance: null }),
    site('Industrial', 'ERCOT', { mapped: true, interval: true, compliance: screened({ matched: false }) }),
    site('', null, { mapped: false, interval: null }),
  ];
  const savings = {
    Retail: { electricDeregSites: 2, electricSpend: 100000, electricLow: 2000, electricHigh: 4000, gasDeregSites: 1, gasSpend: 50000, gasLow: 1000, gasHigh: 2000 },
    Industrial: { electricDeregSites: 1, electricSpend: 20000, electricLow: 400, electricHigh: 800 },
  };
  const s = summarizeDivisions(facts, savings);

  eq(s.divisions.map(d => d.name), ['Retail', 'Industrial', NO_DIVISION_LABEL],
    'divisions run biggest first with the unassigned bucket last');

  const retail = s.divisions[0];
  eq(retail.sites, 3, 'every site in the division counts toward its site total');
  eq(retail.screened, 2, 'only sites the compliance screening covered count as screened');
  eq([retail.jurisdiction, retail.bbs, retail.audits, retail.bps, retail.anyMandate], [2, 2, 0, 1, 2],
    'compliance counts come off the per-site screening verdicts');
  eq([retail.penalty, retail.penaltyKnown], [7000, true], 'penalty exposure sums the eligible categories');
  eq([retail.mapped, retail.intervalYes, retail.intervalNo, retail.intervalUnknown], [2, 1, 1, 1],
    'interval data splits yes / no / unknown, with unknown counted apart from a confirmed no');
  eq([retail.savingsLow, retail.savingsHigh, retail.deregSpend], [3000, 6000, 150000],
    'savings and spend combine both commodities');

  const industrial = s.divisions[1];
  eq([industrial.screened, industrial.jurisdiction, industrial.anyMandate], [1, 0, 0],
    'a screened site in no mandate jurisdiction still counts as screened');
  eq(industrial.penaltyKnown, false, 'a division with no computable fine reports its exposure as unknown');

  eq(s.divisions[2].sites, 1, 'sites with no division roll up under their own bucket');

  eq(s.isoLabels, ['ERCOT', 'PJM', UNKNOWN_ISO_LABEL],
    'markets run most-sited first with the unresolved bucket last');
  eq([retail.iso.PJM, retail.iso.ERCOT], [2, 1], 'each division counts its sites per market');

  eq([s.totals.sites, s.totals.screened, s.totals.penalty, s.totals.savingsHigh], [5, 3, 7000, 6800],
    'the totals row sums every division');
  eq(s.totals.iso, { PJM: 2, ERCOT: 2, [UNKNOWN_ISO_LABEL]: 1 }, 'market totals sum across divisions');
}

eq(divisionLabel('  '), NO_DIVISION_LABEL, 'a blank division gets the one shared label');
eq(divisionLabel(' Retail '), 'Retail', 'a division name is trimmed, not otherwise rewritten');
eq(isoLabel(NONE_WECC), 'Non-ISO (WECC)', 'a sentence-length non-ISO answer is shortened for the matrix header');
eq(isoLabel(null), UNKNOWN_ISO_LABEL, 'an unresolved market reads as Unknown, not as a blank');

// ---- the sheet ----------------------------------------------------------

function build(facts, savings) {
  const wb = new ExcelJS.Workbook();
  const summary = summarizeDivisions(facts, savings);
  const ws = buildDivisionsSheet(wb, summary, { companyName: 'Acme Corp', generatedAt: '1/2/2026' });
  return { wb, ws, summary };
}

{
  const facts = [
    site('Retail', 'PJM', { mapped: true, interval: true, compliance: screened({ eligible: { bbs: true, audits: false, bps: false }, penalty: 5000 }) }),
    site('Retail', 'PJM'),
    site('Retail', 'ERCOT'),
    site('Industrial', 'ERCOT', { mapped: true, interval: true }),
    site('Industrial', NONE_WECC),
  ];
  const { ws } = build(facts, {
    Retail: { electricDeregSites: 2, electricSpend: 100000, electricLow: 2000, electricHigh: 4000 },
    Industrial: { electricDeregSites: 1, electricSpend: 20000, electricLow: 400, electricHigh: 800 },
  });

  // Every section is present, in the order the tab is meant to read in.
  const banners = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    const v = row.getCell(1).value;
    if (typeof v === 'string' && /by Division|by Market|ISO \/ RTO Market/.test(v)) banners.push({ n, v });
  });
  eq(banners.map(b => b.v), [
    'Energy Procurement Savings Opportunity by Division',
    'Building Compliance by Division',
    'Interval Data by Division',
    'Sites by ISO / RTO Market, by Division',
  ], 'the four sections are written in order');

  // Find the market matrix by its caption — the picker cell above it also
  // holds a market name, so matching on the market alone finds the wrong row.
  let matrixHeaderRow = 0;
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (row.getCell(1).value === 'Division × market matrix') matrixHeaderRow = n + 1;
  });
  ok(matrixHeaderRow > 0, 'the market matrix has a header row');
  eq(ws.getCell(matrixHeaderRow, 1).value, 'Division', 'the matrix header names the division column');
  const headerLabels = [2, 3, 4, 5].map(c => ws.getCell(matrixHeaderRow, c).value);
  eq(headerLabels, ['ERCOT', 'PJM', 'Non-ISO (WECC)', ALL_ISO_LABEL],
    'the matrix carries one column per market plus the roll-up');

  // The matrix itself: counts per division, and a totals row that adds up.
  eq([2, 3, 4, 5].map(c => ws.getCell(matrixHeaderRow + 1, c).value), [1, 2, 0, 3],
    "Retail's market counts sum to its site total");
  eq([2, 3, 4, 5].map(c => ws.getCell(matrixHeaderRow + 2, c).value), [1, 0, 1, 2],
    "Industrial's market counts sum to its site total");
  eq([2, 3, 4, 5].map(c => ws.getCell(matrixHeaderRow + 3, c).value), [2, 2, 1, 5],
    'the matrix totals row sums every division');

  // The picker: a real list validation over the matrix's own header row, so
  // the options can't fall out of step with the columns they read.
  let pickerRow = 0;
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (!pickerRow && row.getCell(1).value === 'ISO / RTO market') pickerRow = n;
  });
  ok(pickerRow > 0, 'the ISO picker has a labelled row');
  const dv = ws.getCell(pickerRow, 2).dataValidation;
  eq(dv?.type, 'list', 'the picker cell is a dropdown');
  eq(dv?.formulae, [`$B$${matrixHeaderRow}:$E$${matrixHeaderRow}`],
    'the dropdown reads the matrix header row rather than an inline list');
  eq(ws.getCell(pickerRow, 2).value, 'ERCOT',
    'the picker opens on the market the most sites sit in');

  // The selected-market table reads the matrix by formula, and its cached
  // results agree with what the matrix says for the default selection.
  const selFirstRow = pickerRow + 3;
  const retailCell = ws.getCell(selFirstRow, 2);
  eq(ws.getCell(selFirstRow, 1).value, 'Retail', 'the selected-market table lists divisions in the same order');
  eq(retailCell.value.formula, `IFERROR(HLOOKUP($B$${pickerRow},$B$${matrixHeaderRow}:$E$${matrixHeaderRow + 3},2,FALSE),0)`,
    "the count is an HLOOKUP into this division's matrix row");
  eq(retailCell.value.result, 1, 'the cached count matches the matrix for the default market');
  eq(ws.getCell(selFirstRow, 3).value.result, 1 / 3, "the share is the count over the division's site total");
  eq(ws.getCell(selFirstRow + 1, 2).value.result, 1, 'the second division reads its own matrix row');
  eq(ws.getCell(selFirstRow + 2, 2).value.result, 2, 'the totals row reads the matrix totals row');

  // The shortened market name is restated, so a header nobody can read in
  // full still resolves.
  let footnote = '';
  ws.eachRow({ includeEmpty: false }, (row) => {
    const v = row.getCell(1).value;
    if (typeof v === 'string' && v.startsWith('Shortened market names:')) footnote = v;
  });
  ok(footnote.includes(NONE_WECC), 'a shortened market name is spelled out in a footnote');
}

{
  // A site list with no Division column mapped: the tab still ships, says so,
  // and reports the portfolio as one estate rather than looking broken.
  const { ws } = build([site('', 'PJM'), site('', 'PJM')], {});
  const sub = String(ws.getCell(2, 1).value);
  ok(sub.includes('No Division column is mapped'), 'an unmapped Division column is explained on the sheet');
  ok(sub.includes('2 sites'), 'the subtitle still reports the site count');
}

{
  // No sites at all — the tab is part of a fixed set, so it ships empty
  // rather than being skipped.
  const { ws } = build([], {});
  let sawEmptyNotice = false;
  ws.eachRow({ includeEmpty: false }, (row) => {
    if (row.getCell(1).value === 'No sites in scope.') sawEmptyNotice = true;
  });
  ok(sawEmptyNotice, 'an empty portfolio writes the tab with a notice rather than blank rows');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

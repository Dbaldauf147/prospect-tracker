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
  summarizeDivisions, buildDivisionsSheet, divisionLabel, isoLabel, toDth,
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
    'Energy Consumption by Division',
    'Building Compliance by Division',
    'Interval Data by Division',
    'Sites by ISO / RTO Market, by Division',
  ], 'the five sections are written in order');

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
  eq(ws.getCell(selFirstRow, 3).value.formula, `B${selFirstRow}`,
    'the bar column mirrors the count so it moves with the picker');
  eq(ws.getCell(selFirstRow, 3).numFmt, ';;;', 'and shows the bar rather than repeating the number');
  eq(ws.getCell(selFirstRow, 4).value.result, 1 / 3, "the share is the count over the division's site total");
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

// ---- energy consumption -------------------------------------------------

{
  // Consumption sums over EVERY site, not just the deregulated ones the
  // savings section prices — a regulated site still uses power, and a
  // division total that quietly dropped it would understate the estate.
  const energy = (kwh, therms, over = {}) => ({
    kwh, therms, kwhModelled: false, thermsModelled: false, ...over,
  });
  const facts = [
    site('Retail', 'PJM', { energy: energy(1_000_000, 5_000) }),
    site('Retail', 'PJM', { energy: energy(500_000, 2_500, { kwhModelled: true, thermsModelled: true }) }),
    // No gas figure at all: counts as a site, contributes no volume, and is
    // not counted among the sites that have gas data.
    site('Retail', 'ERCOT', { energy: energy(250_000, null) }),
    // A site the upload said nothing about on either commodity.
    site('Industrial', 'ERCOT', { energy: energy(null, null) }),
    site('Industrial', 'ERCOT', { energy: energy(2_000_000, 10_000, { kwhModelled: true }) }),
    // Facts with no energy block at all (an older caller) must not throw.
    site('Industrial', 'ERCOT'),
  ];
  const s = summarizeDivisions(facts, {});
  const retail = s.divisions.find(d => d.name === 'Retail');
  const industrial = s.divisions.find(d => d.name === 'Industrial');

  eq(retail.kwh, 1_750_000, 'electric volume sums across the division');
  eq(retail.kwhSites, 3, 'every site with a kWh figure is counted');
  eq(retail.therms, 7_500, 'gas volume sums across the division');
  eq(retail.thermsSites, 2, 'a site with no gas figure is not counted as having one');
  eq(retail.kwhModelled, 500_000, 'the modelled share is the part that came from the estimate');
  eq(retail.thermsModelled, 2_500, 'and the same for gas');
  eq(industrial.kwh, 2_000_000, 'a division with sites carrying no figures still totals the ones that do');
  eq(industrial.kwhSites, 1, 'sites without a figure are left out of the with-data count');
  eq(industrial.sites, 3, 'but they still count as sites in the division');
  eq(industrial.kwhModelled, 2_000_000, 'a wholly modelled division says so');
  eq(industrial.thermsModelled, 0, 'a measured gas figure is not counted as modelled');

  eq(s.totals.kwh, 3_750_000, 'the portfolio total adds the divisions up');
  eq(s.totals.therms, 17_500, 'and the same for gas');
  eq(s.totals.kwhSites, 4, 'as do the with-data counts');
  eq(s.totals.thermsSites, 3, 'as do the with-data counts for gas');

  eq(toDth(17_500), 1_750, 'therms convert to Dth at ten to one');
  eq(toDth(null), 0, 'a missing figure converts to zero rather than NaN');
}

{
  // The section as written: units, the conversion, the shares, and the
  // totals row.
  const withEnergy = (division, kwh, therms, over = {}) =>
    site(division, 'PJM', { energy: { kwh, therms, kwhModelled: false, thermsModelled: false, ...over } });
  const { ws } = build([
    withEnergy('Retail', 3_000_000, 15_000),
    withEnergy('Retail', 1_000_000, 5_000, { kwhModelled: true }),
    withEnergy('Industrial', 1_000_000, 5_000),
  ], {});

  let headerRow = 0;
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (row.getCell(1).value === 'Energy Consumption by Division') headerRow = n + 2;
  });
  ok(headerRow > 0, 'the consumption section has a header row');
  eq([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(c => ws.getCell(headerRow, c).value), [
    'Division', 'Sites', 'Sites with Electric Data', 'Annual Electric (kWh)',
    'kWh Scale', 'of which Modelled (kWh)', '% of Portfolio kWh',
    'Sites with Gas Data', 'Annual Gas (Dth)', 'of which Modelled (Dth)',
    '% of Portfolio Dth',
  ], 'the consumption columns name their units, with the bar in one of its own');

  const retailRow = headerRow + 1;
  eq(ws.getCell(retailRow, 1).value, 'Retail', 'the biggest division leads');
  eq(ws.getCell(retailRow, 4).value, 4_000_000, "the division's electric volume is its sites' summed");
  eq(ws.getCell(retailRow, 6).value, 1_000_000, 'the modelled column carries the estimated part only');
  eq(ws.getCell(retailRow, 7).value, 0.8, 'the share is against the portfolio total');
  eq(ws.getCell(retailRow, 9).value, 2_000, 'gas is written in Dth, not therms');
  eq(ws.getCell(retailRow, 10).value, 0, 'a measured division shows no modelled gas');

  const totalRow = headerRow + 3;
  eq(ws.getCell(totalRow, 1).value, 'All divisions', 'the section totals every division');
  eq(ws.getCell(totalRow, 4).value, 5_000_000, 'the totals row adds the electric volume up');
  eq(ws.getCell(totalRow, 9).value, 2_500, 'and the gas volume, in Dth');
  eq(ws.getCell(totalRow, 7).value, 1, 'the portfolio is 100% of itself');
}

{
  // A portfolio with no consumption anywhere: zeros, not #DIV/0! or NaN.
  const { ws } = build([site('Retail', 'PJM')], {});
  let headerRow = 0;
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (row.getCell(1).value === 'Energy Consumption by Division') headerRow = n + 2;
  });
  eq(ws.getCell(headerRow + 1, 4).value, 0, 'no consumption reads as zero volume');
  eq(ws.getCell(headerRow + 1, 7).value, 0, 'and as a zero share rather than a divide by zero');
}

// ---- bars in a column of their own --------------------------------------
// A data bar is painted behind the cell it is applied to, so a bar on the
// figure runs straight through the digits — which on a portfolio whose
// largest division sets the scale hid the biggest numbers on the tab behind
// a block of green. Every bar now sits in its own column beside the figure
// it charts.
{
  const facts = [
    site('Retail', 'PJM', {
      mapped: true, interval: true,
      compliance: screened({ eligible: { bbs: true, audits: false, bps: false }, penalty: 9000 }),
      energy: { kwh: 4_000_000, therms: 20_000, kwhModelled: false, thermsModelled: false },
    }),
    site('Retail', 'PJM', {
      mapped: true, interval: true,
      compliance: screened({ eligible: { bbs: true, audits: false, bps: false }, penalty: 3000 }),
      energy: { kwh: 1_000_000, therms: 5_000, kwhModelled: false, thermsModelled: false },
    }),
    site('Industrial', 'ERCOT', {
      compliance: screened({ penalty: 1000 }),
      energy: { kwh: 500_000, therms: 2_000, kwhModelled: false, thermsModelled: false },
    }),
  ];
  const { ws } = build(facts, {
    Retail: { electricDeregSites: 2, electricSpend: 100000, electricLow: 2000, electricHigh: 4000 },
    Industrial: { electricDeregSites: 1, electricSpend: 20000, electricLow: 400, electricHigh: 800 },
  });

  const bars = ws.conditionalFormattings.filter(cf => cf.rules.some(r => r.type === 'dataBar'));
  eq(bars.length, 5, 'every table on the tab charts one figure');

  const colOf = (ref) => ref.match(/^([A-Z]+)/)[1];
  const rowsOf = (ref) => ref.match(/(\d+):[A-Z]+(\d+)/).slice(1).map(Number);
  const colNum = (letters) => [...letters].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0);

  for (const cf of bars) {
    const col = colNum(colOf(cf.ref));
    const [firstRow, lastRow] = rowsOf(cf.ref);
    // The bar column is a column of its own: its header names it a scale and
    // it shows nothing but the bar.
    const header = String(ws.getCell(firstRow - 1, col).value || '');
    ok(header.endsWith('Scale'), `the bar column is headed as a scale (${header || 'blank'})`);
    eq(ws.getCell(firstRow, col).numFmt, ';;;', `${header}: the bar cell displays no number`);
    // It still HOLDS the figure — the bar is scaled from it.
    const held = ws.getCell(firstRow, col).value;
    ok(typeof held === 'number' ? held > 0 : !!held?.formula,
      `${header}: the bar cell carries the value the bar is drawn from`);
    // And the figure it charts is readable in the column to its left, with
    // no bar of its own over it.
    const figure = ws.getCell(firstRow, col - 1);
    ok(figure.numFmt !== ';;;', `${header}: the figure beside it is displayed`);
    // Compared within this table's own rows: the tabs are stacked, so the
    // same sheet column carries a bar in one table and a figure in another.
    ok(!bars.some(b => {
      if (colNum(colOf(b.ref)) !== col - 1) return false;
      const [bFirst, bLast] = rowsOf(b.ref);
      return bFirst <= lastRow && bLast >= firstRow;
    }), `${header}: nothing is charted over the figure column`);
    // The totals row sits outside the range — a bar scaled against the
    // total would draw every division as a sliver — and is left empty.
    eq(ws.getCell(lastRow + 1, col).value, null, `${header}: the totals row carries no bar`);
  }

  // The two the reader asked about, spelled out: the big numbers are plain
  // numeric cells, and the bar is the column after each.
  let consumptionHeader = 0;
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (row.getCell(1).value === 'Energy Consumption by Division') consumptionHeader = n + 2;
  });
  eq(ws.getCell(consumptionHeader, 4).value, 'Annual Electric (kWh)', 'the kWh figure keeps its column');
  eq(ws.getCell(consumptionHeader, 5).value, 'kWh Scale', 'and the bar has the next one');
  eq(ws.getCell(consumptionHeader + 1, 4).value, 5_000_000, 'the figure cell holds the number');
  eq(ws.getCell(consumptionHeader + 1, 4).numFmt, '#,##0', 'formatted to be read');
  eq(ws.getCell(consumptionHeader + 1, 5).value, 5_000_000, 'the bar cell holds the same number');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

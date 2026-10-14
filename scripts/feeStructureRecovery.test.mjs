// Saved fee structures rebuilt from the Pricing page's Excel exports
// (utils/feeStructureRecovery). The Cost deltas and Fee deltas sheets are
// written by the real writer (feeSummarySheets) and read back through
// ExcelJS; As built is laid out the way FeeBuilderTab's exportPlan writes
// it. Plain Node. Run:
//   node scripts/feeStructureRecovery.test.mjs
import ExcelJS from 'exceljs';
import { addFeeComparisonSheet } from '../src/utils/feeSummarySheets.js';
import { sheetRows, parseExport, parsePastedCostDeltas, recoverFeeStructures, addRecoveredStructures, recoveredName } from '../src/utils/feeStructureRecovery.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// The deal in the incident's export, cut down: WBUDC and BPS each build
// their own year 1 / year 2+ fees, and two services share Program monthly.
const builderRows = [
  { name: 'Program monthly', service: 'Emissions Management Advanced', type: 'Recurring (monthly)', feePerUnit: 600, unit: 'Fixed', unitCount: 1, startMonth: 1, years: [7200], term: 7200 },
  { name: 'Program monthly', service: 'Commercial Client Management', type: 'Recurring (monthly)', feePerUnit: 190, unit: 'Fixed', unitCount: 1, startMonth: 1, years: [2280], term: 2280 },
  { name: 'Year 1 WBUDC', service: 'WBUDC', type: 'One Time', feePerUnit: 50, unit: 'Per Site', unitCount: 40, startMonth: 1, years: [2000], term: 2000 },
  { name: 'Year 2+ WBUDC', service: 'WBUDC', type: 'Recurring (monthly)', feePerUnit: 4, unit: 'Per Site', unitCount: 40, startMonth: 13, years: [0, 1920], term: 1920 },
  { name: 'Kickoff', service: 'WBUDC', type: 'One Time', feePerUnit: 1500, unit: 'Fixed', unitCount: 1, startMonth: 1, years: [1500], term: 1500 },
  { name: 'Legacy fee', service: null, type: 'One Time', feePerUnit: 10, unit: 'Fixed', unitCount: 1, startMonth: 1, years: [10], term: 10 },
];
const costLines = [
  { lineItem: 'Emissions Management Advanced (RA) Support', type: 'Recurring (monthly)', pricingFee: '', builderFee: 'Program monthly', pricedInto: 'Program monthly', moved: true, byYear: [21719] },
  { lineItem: 'Emissions Management Advanced (RA) Support', type: 'Setup', pricingFee: '', builderFee: 'Program monthly', pricedInto: 'Program monthly', moved: true, byYear: [1394] },
  { lineItem: 'Commercial Client Management NAM', type: 'Recurring (monthly)', pricingFee: 'Program fee', builderFee: 'Program monthly', pricedInto: 'Program monthly', moved: true, byYear: [6418] },
  { lineItem: 'Whole Building Utility Data Collection', type: 'Recurring (monthly)', pricingFee: '', builderFee: 'Year 2+ WBUDC', pricedInto: 'Year 2+ WBUDC', moved: true, byYear: [3512] },
  { lineItem: 'Whole Building Utility Data Collection', type: 'One Time', pricingFee: '', builderFee: 'Year 1 WBUDC', pricedInto: 'Year 1 WBUDC', moved: true, byYear: [2369] },
  { lineItem: 'Communication Support', type: 'One Time', pricingFee: '', builderFee: '', pricedInto: '', byYear: [0] },
];
const mapping = {
  'emissions management advanced (ra) support': ['Emissions Management Advanced'],
  'commercial client management nam': ['Commercial Client Management'],
  'whole building utility data collection': ['WBUDC'],
  'communication support': ['WBUDC'],
};
const servicesFor = (li) => mapping[li.trim().toLowerCase()] || [];
const knownServices = ['Emissions Management Advanced', 'Commercial Client Management', 'WBUDC'];

async function exportFile({ withAsBuilt }) {
  const wb = new ExcelJS.Workbook();
  if (withAsBuilt) {
    const ws = wb.addWorksheet('As built');
    ws.addRow(['Fee', 'From', 'Type', 'Fee / Unit', 'Unit', 'Unit Count', 'Start Month', 'Y1', 'Y2', 'Term', 'Margin']);
    ws.addRow(['Program monthly', 'Emissions Management Advanced, Commercial Client Management', 'Recurring (monthly)', 790, 'Fixed', 1, 1, 9480, 0, 9480, 0.3]);
    for (const r of builderRows.slice(0, 2)) {
      const sub = ws.addRow([r.name, r.service, r.type, r.feePerUnit, r.unit, r.unitCount, r.startMonth, r.years[0], 0, r.term, 0.3]);
      sub.outlineLevel = 1;
    }
    for (const r of builderRows.slice(2)) ws.addRow([r.name, r.service || 'On the schedule', r.type, r.feePerUnit, r.unit, r.unitCount, r.startMonth, r.years[0], r.years[1] || 0, r.term, 0.3]);
    ws.addRow(['Total', '', '', null, '', null, null, 1, 1, 1, 0.3]);
  }
  addFeeComparisonSheet(wb, { costLines, pricing: { rows: [], totals: { feeByYear: [0, 0], costByYear: [0, 0] } }, builder: { rows: builderRows, totals: { feeByYear: [0, 0], costByYear: [0, 0] } }, numYears: 2 });
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(await wb.xlsx.writeBuffer());
  const sheets = {};
  for (const n of ['As built', 'Cost deltas', 'Fee deltas']) sheets[n] = sheetRows(back.getWorksheet(n));
  return parseExport(sheets);
}

// --- Fee Builder export (As built names each fee's service)
const parsed = await exportFile({ withAsBuilt: true });
eq(parsed.feeRows.map(r => [r.feeName, r.services]), [
  ['Program monthly', ['Emissions Management Advanced']],
  ['Program monthly', ['Commercial Client Management']],
  ['Year 1 WBUDC', ['WBUDC']],
  ['Year 2+ WBUDC', ['WBUDC']],
  ['Kickoff', ['WBUDC']],
], 'As built: a shared fee reads as its sub-rows, a row on the schedule is left out');
eq(parsed.costLines.find(c => c.type === 'Setup'), { lineItem: 'Emissions Management Advanced (RA) Support', type: 'Setup', fee: 'Program monthly' },
  'Cost deltas: the fee a cost line is priced into');

const rec = recoverFeeStructures(parsed, { servicesFor, knownServices });
eq(Object.keys(rec).sort(), ['commercial client management', 'emissions management advanced', 'wbudc'], 'a structure per service that built a fee');
eq(rec.wbudc.rows, [
  { feeName: 'Year 1 WBUDC', type: 'One Time', fee: null, unit: 'Per Site', unitCount: null, startMonth: null, passThrough: false },
  { feeName: 'Year 2+ WBUDC', type: 'Recurring (monthly)', fee: null, unit: 'Per Site', unitCount: null, startMonth: 13, passThrough: false },
  { feeName: 'Kickoff', type: 'One Time', fee: 1500, unit: 'Fixed', unitCount: null, startMonth: null, passThrough: false },
], 'fees priced from costs derive again; a fee no cost feeds keeps its typed fee; a later start month is kept');
eq(rec.wbudc.allocations, {
  'whole building utility data collection::recurring (monthly)': { fee: 'year 2+ wbudc' },
  'whole building utility data collection::one time': { fee: 'year 1 wbudc' },
  'communication support::one time': { fee: '' },
}, 'each cost line points at the fee it was priced into, or at no fee');
eq(rec['emissions management advanced'].allocations['emissions management advanced (ra) support::setup'], { fee: 'program monthly', roll: true },
  'a setup cost priced into a monthly fee was rolled over the term');
eq(rec['commercial client management'].rows.map(r => r.feeName), ['Program monthly'], 'a shared fee goes to each service that built it');

// --- Fee Margin export (no As built): services come from the cost lines
const margin = await exportFile({ withAsBuilt: false });
const recM = recoverFeeStructures(margin, { servicesFor, knownServices });
eq(recM.wbudc.rows.map(r => [r.feeName, r.fee]), [['Year 1 WBUDC', null], ['Year 2+ WBUDC', null]],
  'without As built, a fee goes to the services of the costs priced into it');
eq(Object.keys(recM).sort(), ['commercial client management', 'emissions management advanced', 'wbudc'], 'a shared fee still reaches both services');

// --- Adding them beside what is saved
const saved = { wbudc: { structures: [{ id: 'keep', name: 'Standard', rows: [] }], standardId: 'keep' } };
const first = addRecoveredStructures(saved, rec, 'Recovered Option 1 (2026-10-10)');
eq(first.next.wbudc.structures.map(s => s.name), ['Standard', 'Recovered Option 1 (2026-10-10)'], 'added beside a saved structure, never over it');
eq(first.next.wbudc.standardId, 'keep', 'the saved standard stays the standard');
eq(first.next['commercial client management'].standardId, first.next['commercial client management'].structures[0].id, 'a service with none gets the recovered one as standard');
const again = addRecoveredStructures(first.next, rec, 'Recovered Option 1 (2026-10-10)');
eq([again.added, again.already.length], [[], 3], 'the same file recovered twice adds nothing');

eq(recoveredName('fee-schedule-Option-1-2026-10-10.xlsx'), 'Recovered Option 1 (2026-10-10)', 'a Fee Builder file name reads back as option and date');
eq(recoveredName('margin.xlsx'), 'Recovered margin', 'any other file by its name');
eq(parseExport({}), null, 'a file with no fee sheet is not an export');

// --- Cost deltas tables pasted out of Excel (the user's own paste, cut down)
const pasted = "\t\tPricing tab\t\tFee Builder\nCost line item\tType\tLogged on fee\tTerm cost\tLogged on fee\tTerm cost\tPriced into fee\tDelta\tStatus\nEfficiency - Energy Maturity Assessment\tRecurring (monthly)\tNo fee\t$0\tYear 1 EMA (year 2)\t$50,374\tYear 1 EMA (year 2)\t$50,374\tMoved\nEfficiency - Energy Maturity Assessment\tOne Time\tNo fee\t$0\tYear 1 EMA\t$40,186\tYear 1 EMA\t$40,186\tMoved\n\t\tPricing tab\t\tFee Builder\nCost line item\tType\tLogged on fee\tTerm cost\tLogged on fee\tTerm cost\tPriced into fee\tDelta\tStatus\nInvoice Collection\tRecurring (monthly)\tNo fee\t$0\tPer account monthly\t$7,391\tPer account monthly\t$7,391\tMoved\nEnterprise Data - Setup Project Mngd\tSetup Rolled\tNo fee\t$0\tPer account monthly\t$1,322\tPer account monthly\t$1,322\tMoved\nBudgets - Industrial A/C Level Detail\tRecurring (monthly)\tPer account\t$21,045\tPer account\t$21,045\tPer site monthly\t$0\tOn a different fee\nBuilding Benchmark Submission\tOne Time\tPer site\t$279\tBBS per site\t$279\tBBS per site\t$0\tMoved\nWater Cost Recovery\tFee = 50% success fee (non-negotiable)\tNo fee\t$0\tNo fee\t$0\t\t$0\tOn no fee in either\nTotal\t\t\t$157,419\t\t$166,160\t\t$8,740\t";
const tables = parsePastedCostDeltas(pasted);
eq(tables.length, 2, 'each pasted table is its own recovery');
eq(tables[1].feeRows.map(r => [r.feeName, r.type, r.unit]), [
  ['Per account monthly', 'Recurring (monthly)', 'Per Account'],
  ['Per site monthly', 'Recurring (monthly)', 'Per Site'],
  ['BBS per site', 'One Time', 'Per Site'],
], 'a fee is read off its name and the costs priced into it');
eq(tables[1].costLines.find(c => c.lineItem.startsWith('Budgets')).fee, 'Per site monthly', 'the fee priced into wins over the one logged on');
const pasteMap = {
  'invoice collection': ['Utility Bill Management'],
  'enterprise data - setup project mngd': ['Utility Bill Management'],
  'budgets - industrial a/c level detail': ['Budgets (site level)'],
  'building benchmark submission': ['Benchmarking'],
  'water cost recovery': ['Water'],
  'efficiency - energy maturity assessment': ['Energy Maturity Assessment'],
};
const recP = recoverFeeStructures(tables[1], { servicesFor: (li) => pasteMap[li.trim().toLowerCase()] || [] });
eq(Object.keys(recP).sort(), ['benchmarking', 'budgets (site level)', 'utility bill management'], 'a structure per mapped service; one with only no-fee lines is left out');
eq(recP['utility bill management'].rows.map(r => [r.feeName, r.fee]), [['Per account monthly', null]], 'a pasted fee derives from its costs');
eq(recP['utility bill management'].allocations['enterprise data - setup project mngd::setup rolled'], { fee: 'per account monthly' }, 'a rolled setup cost needs no roll flag');
eq(Object.keys(recoverFeeStructures(tables[0], { servicesFor: (li) => pasteMap[li.trim().toLowerCase()] || [] })), ['energy maturity assessment'], 'the EMA table rebuilds its service');
eq(parsePastedCostDeltas('nothing useful'), [], 'text with no Cost deltas header gives nothing');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

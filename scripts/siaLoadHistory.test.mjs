// Assertion tests for the SIA load history entry.
// Plain Node - no test framework (the project has none). Run:
//   node scripts/siaLoadHistory.test.mjs
//
// What is worth pinning: the parser reads the SIA header block (Date,
// Salesperson, # Sites, ...) into label / value pairs with the date turned
// back from its Excel serial; the history entry keeps every cost line with
// its section, and none of the parser's raw row copies; and the list's
// summary takes sites and accounts off whichever option carries them.
import * as XLSX from 'xlsx';
import { parsePricingWorkbook } from '../src/utils/pricingParse.js';
import { buildSiaHistoryEntry, siaHistorySummary, mergeSiaHistory, siaKeyFacts, siaCostLineMatches } from '../src/utils/siaHistoryEntry.js';
import { buildSiaHistoryWorkbook, siaHistoryFileName } from '../src/utils/siaHistoryWorkbook.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

function optionSheet({ sites, accounts, salesperson }) {
  const rows = Array.from({ length: 18 }, () => []);
  rows[0] = ['Date', 46000];
  rows[1] = ['Salesperson:', salesperson];
  rows[2] = ['Client', '', 'Acme Corp'];
  if (sites != null) rows[3] = ['# of Sites', sites];
  if (accounts != null) rows[4] = ['# of Accounts', accounts];
  rows[5] = ['Solution description', 'Bill pay and sourcing'];
  rows[6] = ['Annual Spend', '$1,250,000.50'];
  rows[7] = ['Annual kWh', 8400000];
  rows[8] = ['Annual Gas (Dth)', 52000];
  rows.push(['Delivery Team Inputs']);
  rows.push(['Line Item', 'Type', 'CTS', 'Start Month', 'Comments']);
  rows.push(['Bill processing', 'Recurring', 1200, '1', 'per month']);
  rows.push(['Onboarding', 'Setup', 300, '', '']);
  rows.push(['Cost Summary']);
  return XLSX.utils.aoa_to_sheet(rows);
}

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, optionSheet({ sites: 12, accounts: 40, salesperson: 'Pat' }), 'Option 1');
XLSX.utils.book_append_sheet(wb, optionSheet({ salesperson: 'Pat' }), 'Option 2');
const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
const parsed = parsePricingWorkbook(buf);

// --- header block ------------------------------------------------------
{
  const d = parsed.options[0].headerDetails;
  check('date serial comes back as a date', d.find(x => x.label === 'Date')?.value, '2025-12-09');
  check('trailing colon dropped from the label', d.find(x => x.label === 'Salesperson')?.value, 'Pat');
  check('value found past a blank cell', d.find(x => x.label === 'Client')?.value, 'Acme Corp');
  check('sites row kept as a detail too', d.find(x => x.label === '# of Sites')?.value, '12');
  check('site count still parsed', parsed.options[0].siteCount, 12);
}

// --- history entry -----------------------------------------------------
const entry = buildSiaHistoryEntry({ id: 'wb_1', fileName: 'Acme SIA.xlsx', loadedAt: 1000, sizeBytes: buf.byteLength, options: parsed.options });
{
  const o = entry.options[0];
  check('cost lines kept in sheet order', o.costItems.map(i => [i.description, i.type, i.cts]), [['Bill processing', 'Recurring', 1200], ['Onboarding', 'Setup', 300]]);
  check('cost line carries its comments', o.costItems[0].comments, 'per month');
  check('no raw row copies', 'raw' in o.costItems[0], false);
  check('no diagnostic sample', 'rawSample' in o, false);
  check('solution description kept', o.solutionDescription, 'Bill pay and sourcing');
  check('round-trips through JSON', JSON.parse(JSON.stringify(entry)), entry);
}

// --- summary -----------------------------------------------------------
{
  const s = siaHistorySummary(entry);
  check('summary', s, {
    optionCount: 2, sites: 12, accounts: 40, costLines: 4, ctsTotal: 3000, salesperson: 'Pat',
    company: 'Acme Corp', date: '2025-12-09', annualSpend: 1250000.5, annualKwh: 8400000, annualGas: 52000, gasUnit: 'Dth',
  });
  check('empty entry', siaHistorySummary({}), {
    optionCount: 0, sites: null, accounts: null, costLines: 0, ctsTotal: 0, salesperson: '',
    company: '', date: '', annualSpend: null, annualKwh: null, annualGas: null, gasUnit: '',
  });
}

// --- key facts ---------------------------------------------------------
// Labels differ between SIA templates; the gas unit follows the label.
{
  const facts = (details) => siaKeyFacts([{ headerDetails: details.map(([label, value]) => ({ label, value })) }]);
  check('company name label, MMBtu gas', facts([['Company Name', 'Globex'], ['SIA Date', '2026-01-05'], ['Annual MMBtu', '1,200']]), {
    company: 'Globex', date: '2026-01-05', annualSpend: null, annualKwh: null, annualGas: 1200, gasUnit: 'MMBtu',
  });
  check('a text value is not a figure', facts([['Annual Spend', 'TBD'], ['Annual Utility Spend', '$9,000']]).annualSpend, 9000);
  check('# of Accounts is not the company', facts([['# of Accounts', '40'], ['Customer', 'Initech']]).company, 'Initech');
  check('later option fills a gap', siaKeyFacts([{ headerDetails: [] }, { headerDetails: [{ label: 'Client', value: 'Umbrella' }] }]).company, 'Umbrella');
}

// --- cost line search ---------------------------------------------------
{
  check('matches a line item, per option', siaCostLineMatches(entry, 'bill PROC'), [[0], [0]]);
  check('matches comments and type too', siaCostLineMatches(entry, 'per month'), [[0], [0]]);
  check('matches the section', siaCostLineMatches(entry, 'delivery team').map(h => h.length), [2, 2]);
  check('no match', siaCostLineMatches(entry, 'zzz'), [[], []]);
  check('empty search matches nothing', siaCostLineMatches(entry, '  '), [[], []]);
}

// --- merge -------------------------------------------------------------
{
  const a = { id: 'a', loadedAt: 1 };
  const b = { id: 'b', loadedAt: 3 };
  const a2 = { id: 'a', loadedAt: 2, fileName: 'newer' };
  check('newest first, one per id', mergeSiaHistory([a, b], [a2]).map(e => [e.id, e.loadedAt]), [['b', 3], ['a', 2]]);
}

// --- Excel download ----------------------------------------------------
// Written and read back, the way the file lands on the user's disk.
{
  const out = XLSX.read(XLSX.write(buildSiaHistoryWorkbook(entry), { type: 'array', bookType: 'xlsx' }), { type: 'array', cellNF: true });
  const rows = (name) => XLSX.utils.sheet_to_json(out.Sheets[name], { header: 1, raw: true });
  check('sheets, no Alt Fees when the SIA had none', out.SheetNames, ['Summary', 'Details', 'Cost Lines']);
  check('summary header', rows('Summary').slice(0, 10), [
    ['File', 'Acme SIA.xlsx'], ['Loaded', new Date(1000).toLocaleString('en-US')],
    ['Company', 'Acme Corp'], ['SIA Date', '2025-12-09'], ['Annual Spend', 1250000.5], ['Annual kWh', 8400000], ['Annual Dth', 52000],
    ['Salesperson', 'Pat'], ['Cost lines', 4], ['Total CTS', 3000],
  ]);
  check('annual spend carries a money format', out.Sheets.Summary.B5.z, '"$"#,##0.00');
  check('one summary row per option', rows('Summary').slice(12).map(r => [r[0], r[2], r[3], r[7], r[8]]), [['Option 1', 12, 40, 2, 1500], ['Option 2', '', '', 2, 1500]]);
  check('cost lines across options, CTS as numbers', rows('Cost Lines').map(r => [r[0], r[2], r[4]]), [
    ['Option', 'Line Item', 'CTS'],
    ['Option 1', 'Bill processing', 1200], ['Option 1', 'Onboarding', 300],
    ['Option 2', 'Bill processing', 1200], ['Option 2', 'Onboarding', 300],
  ]);
  check('CTS cells carry a money format', out.Sheets['Cost Lines'].E2.z, '"$"#,##0.00');
  check('details keep the header block', rows('Details').find(r => r[1] === 'Client'), ['Option 1', 'Client', 'Acme Corp']);
  const withFees = { ...entry, options: [{ ...entry.options[0], altFees: [{ altItem: 'Bill pay', type: 'Recurring (monthly)', fee: 250, unit: 'Per Site', unitCount: 12, startMonth: 1 }] }] };
  const out2 = XLSX.read(XLSX.write(buildSiaHistoryWorkbook(withFees), { type: 'array', bookType: 'xlsx' }), { type: 'array' });
  check('Alt Fees sheet when the SIA had fees', XLSX.utils.sheet_to_json(out2.Sheets['Alt Fees'], { header: 1 })[1], ['Option 1', 'Bill pay', 'Recurring (monthly)', 250, 'Per Site', 12, 1]);
  check('file name', siaHistoryFileName({ fileName: 'Acme SIA v2.xlsx', loadedAt: Date.UTC(2026, 8, 29, 12) }), 'Acme SIA v2 (history 2026-09-29).xlsx');
  check('file name strips unsafe characters', siaHistoryFileName({ fileName: 'a/b:c.xlsm', loadedAt: Date.UTC(2026, 0, 2, 12) }), 'a b c (history 2026-01-02).xlsx');
}

console.log(`${failed ? 'FAIL' : 'PASS'} siaLoadHistory: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

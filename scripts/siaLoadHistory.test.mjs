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
import { buildSiaHistoryEntry, siaHistorySummary, mergeSiaHistory } from '../src/utils/siaHistoryEntry.js';

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
  check('summary', s, { optionCount: 2, sites: 12, accounts: 40, costLines: 4, ctsTotal: 3000, salesperson: 'Pat' });
  check('empty entry', siaHistorySummary({}), { optionCount: 0, sites: null, accounts: null, costLines: 0, ctsTotal: 0, salesperson: '' });
}

// --- merge -------------------------------------------------------------
{
  const a = { id: 'a', loadedAt: 1 };
  const b = { id: 'b', loadedAt: 3 };
  const a2 = { id: 'a', loadedAt: 2, fileName: 'newer' };
  check('newest first, one per id', mergeSiaHistory([a, b], [a2]).map(e => [e.id, e.loadedAt]), [['b', 3], ['a', 2]]);
}

console.log(`${failed ? 'FAIL' : 'PASS'} siaLoadHistory: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

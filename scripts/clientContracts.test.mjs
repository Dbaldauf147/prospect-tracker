// Assertion tests for the company card's Contracts tab. Plain Node, no test
// framework (see coaItems.test.mjs for the house style). Run:
//   node scripts/clientContracts.test.mjs
//
// What has to hold:
//   1. Which agreements are this client's: the Client Name on the deal, the
//      user's Deals-subtab remapping, and the company's former names.
//   2. The order: active first, then by End Date, undated last.
//   3. The summary strip: sums over active agreements only.
//   4. The COA requirements map: every list item is a row, an answer lands
//      under its item whatever the casing, an item dropped from the list keeps
//      its answer, and a cleared row leaves nothing stored.

import {
  companyClientNames, dealsForCompany, contractsSummary,
  normalizeCoaRequirements, coaRequirementRows, setCoaRequirement,
  coaRequirementsSummary, renameCoaRequirement,
} from '../src/utils/clientContracts.js';

let failures = 0;
function check(label, cond) {
  if (cond) { console.log(`PASS  ${label}`); return; }
  failures += 1;
  console.log(`FAIL  ${label}`);
}
function eq(label, actual, expected) {
  check(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`,
    JSON.stringify(actual) === JSON.stringify(expected));
}

// --- which agreements -------------------------------------------------------

eq('company and aliases, lowercased and de-duped',
  companyClientNames('Acme Corp', 'Acme Inc\nacme corp; Old Acme'),
  ['acme corp', 'acme inc', 'old acme']);

const deals = [
  { 'Client Name': 'Acme Corp', 'Agreement Name': 'A', 'End Date': '2027-06-01', 'Recurring Revenue': '1,000', 'Auto renewal?': 'Yes' },
  { 'Client Name': 'ACME CORP ', 'Agreement Name': 'B', 'End Date': '2026-12-01', 'Recurring Revenue': 500, 'Original Contract Start': '2020-01-15' },
  { 'Client Name': 'Acme Holdings LLC', 'Agreement Name': 'C (mapped)', 'Paperwork completed': 'Expired', 'End Date': '2025-01-01', 'Recurring Revenue': 9999 },
  { 'Client Name': 'Old Acme', 'Agreement Name': 'D (alias)' },
  { 'Client Name': 'Other Co', 'Agreement Name': 'E' },
];
const clientMap = { 'acme holdings llc': 'Acme Corp' };

const mine = dealsForCompany(deals, clientMap, 'Acme Corp', 'Old Acme');
eq('matched by name, casing, remap and alias; active by End Date, undated then inactive',
  mine.map(d => d['Agreement Name']), ['B', 'A', 'D (alias)', 'C (mapped)']);
eq('no company, no agreements', dealsForCompany(deals, clientMap, '', ''), []);

// --- summary ----------------------------------------------------------------

const NOW = Date.parse('2026-09-23T12:00:00');
const sum = contractsSummary(mine, NOW);
eq('counts', [sum.total, sum.active, sum.inactive], [4, 3, 1]);
eq('recurring sums active only', sum.recurring, 1500);
eq('setup is null when nothing carries it', sum.setup, null);
eq('soonest end is the earliest active End Date', sum.soonestEndDays, 69);
eq('auto-renew count', sum.autoRenewCount, 1);
check('first start is the earliest Original Contract Start',
  sum.firstStart && sum.firstStart.getFullYear() === 2020);

// --- COA requirements ---------------------------------------------------------

const catalog = ['3% esc', 'Net 60'];
eq('an untouched client has one blank row per list item',
  coaRequirementRows(undefined, catalog).map(r => [r.item, r.required, r.notes]),
  [['3% esc', '', ''], ['Net 60', '', '']]);

let req = setCoaRequirement({}, '3% ESC', { required: 'yes' });
eq('stored under the lowercased key', Object.keys(req), ['3% esc']);
eq('lands under its list item whatever the casing',
  coaRequirementRows(req, catalog).map(r => r.required), ['yes', '']);

req = setCoaRequirement(req, 'Net 60', { notes: 'MSA says net 45' });
req = setCoaRequirement(req, 'Net 60', { required: 'no' });
eq('notes and answer kept together', req['net 60'], { item: 'Net 60', required: 'no', notes: 'MSA says net 45' });

const dropped = coaRequirementRows(req, ['3% esc']);
eq('an item dropped from the list keeps its answer, at the end',
  dropped.map(r => [r.item, r.inCatalog]), [['3% esc', true], ['Net 60', false]]);

req = setCoaRequirement(req, '3% esc', { required: '' });
eq('a cleared row leaves nothing stored', Object.keys(req), ['net 60']);

eq('junk in the stored map is dropped',
  normalizeCoaRequirements({ a: null, b: { required: 'maybe' }, c: { item: 'X', required: 'YES' } }),
  { x: { item: 'X', required: 'yes', notes: '' } });
eq('normalize tolerates non-objects', normalizeCoaRequirements([1, 2]), {});

eq('summary counts',
  coaRequirementsSummary(coaRequirementRows({ '3% esc': { item: '3% esc', required: 'yes' } }, catalog)),
  { total: 2, required: 1, notRequired: 0, unset: 1 });

// Renaming an item from the card carries this company's answer across.
const answered = { '3% esc': { item: '3% esc', required: 'yes', notes: 'MSA 4.2' } };
eq('rename moves the answer to the new name',
  renameCoaRequirement(answered, '3% esc', '3% escalator'),
  { '3% escalator': { item: '3% escalator', required: 'yes', notes: 'MSA 4.2' } });
eq('rename that only changes casing keeps the answer under the new spelling',
  renameCoaRequirement(answered, '3% esc', '3% ESC'),
  { '3% esc': { item: '3% ESC', required: 'yes', notes: 'MSA 4.2' } });
eq('rename onto an already-answered name keeps that answer',
  renameCoaRequirement({ ...answered, 'net 60': { item: 'Net 60', required: 'no', notes: '' } }, '3% esc', 'Net 60'),
  { 'net 60': { item: 'Net 60', required: 'no', notes: '' } });
eq('rename of an unanswered item changes nothing', renameCoaRequirement(answered, 'Net 60', 'Net 90'), answered);

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nAll passed');

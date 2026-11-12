// Assertion tests for the shared contact Bulk Edit plan. Plain Node:
//   node scripts/bulkContactEdit.test.mjs
import { planBulkContactEdit } from '../src/utils/bulkContactEdit.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}

const cs = [
  { id: '1', jobtitle: 'VP', dans_tags: 'ESG;Decision Maker' },
  { id: '2', jobtitle: 'Director', dans_tags: '' },
  { vid: 3, jobtitle: 'Director' },
  { jobtitle: 'no id' },
];

check('title: writes only where it changes, skips no-id',
  planBulkContactEdit(cs, { field: 'jobtitle', value: ' Director ' }),
  { writes: [{ cid: '1', properties: { jobtitle: 'Director' } }], notes: null, skipped: 3 });
check('tags add: keeps existing, skips those that have it',
  planBulkContactEdit(cs.slice(0, 2), { field: 'dans_tags', mode: 'add', value: 'ESG; Utilities' }).writes,
  [{ cid: '1', properties: { dans_tags: 'ESG;Decision Maker;Utilities' } }, { cid: '2', properties: { dans_tags: 'ESG;Utilities' } }]);
check('tags remove: only contacts carrying it',
  planBulkContactEdit(cs.slice(0, 2), { field: 'dans_tags', mode: 'remove', value: 'esg' }).writes,
  [{ cid: '1', properties: { dans_tags: 'Decision Maker' } }]);
check('tags replace',
  planBulkContactEdit([cs[0]], { field: 'dans_tags', mode: 'replace', value: 'Hide' }).writes,
  [{ cid: '1', properties: { dans_tags: 'Hide' } }]);
const notes = planBulkContactEdit(cs.slice(0, 2), { field: 'notes', mode: 'append', value: 'call in Q1' }, { 1: 'met at expo' });
check('notes append: per-user map, no HubSpot writes', [notes.writes, notes.notes], [[], { 1: 'met at expo\ncall in Q1', 2: 'call in Q1' }]);
check('notes replace with blank clears', planBulkContactEdit([cs[0]], { field: 'notes', mode: 'replace', value: '' }, { 1: 'x', 9: 'keep' }).notes, { 9: 'keep' });

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nAll passed');

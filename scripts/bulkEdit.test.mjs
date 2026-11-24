// Assertion tests for the Table tab's bulk edit: what one company gets
// written for a column, mode and value. Plain Node. Run:
//   node scripts/bulkEdit.test.mjs
import { bulkEditPatch } from '../src/utils/bulkEdit.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`); }
}

const status = { key: 'status', type: 'enum' };
const notes = { key: 'notes', type: 'notes' };
const sites = { key: 'numberOfSites', type: 'number' };
const assets = { key: 'assetTypes', type: 'tags' };

eq(bulkEditPatch(status, 'set', 'Client', 'Prospect'), { patch: { status: 'Client' } }, 'enum: set');
eq(bulkEditPatch(status, 'set', 'Client', 'Client'), { skip: true }, 'enum: already has it');
eq(bulkEditPatch(status, 'set', '', 'Client'), { patch: { status: '' } }, 'enum: blank clears');
eq(bulkEditPatch(status, 'set', '', undefined), { skip: true }, 'enum: blank on blank');
eq(bulkEditPatch(notes, 'set', '  hello ', ''), { patch: { notes: 'hello' } }, 'text: trimmed');

eq(bulkEditPatch(sites, 'set', '1,200', 5), { patch: { numberOfSites: 1200 } }, 'number: commas read');
eq(bulkEditPatch(sites, 'set', '12', 12), { skip: true }, 'number: same value');
eq(bulkEditPatch(sites, 'set', '', 12), { patch: { numberOfSites: null } }, 'number: blank clears');
eq(bulkEditPatch(sites, 'set', '', null), { skip: true }, 'number: blank on blank');
eq(!!bulkEditPatch(sites, 'set', 'lots', 1).error, true, 'number: not a number is an error');

eq(bulkEditPatch(assets, 'add', 'Office', ['Retail']), { patch: { assetTypes: ['Retail', 'Office'] } }, 'tags: add');
eq(bulkEditPatch(assets, 'add', 'office', ['Office']), { skip: true }, 'tags: add one already there (any case)');
eq(bulkEditPatch(assets, 'add', 'Office', undefined), { patch: { assetTypes: ['Office'] } }, 'tags: add to none');
eq(bulkEditPatch(assets, 'remove', 'Office', ['Retail', 'Office']), { patch: { assetTypes: ['Retail'] } }, 'tags: remove');
eq(bulkEditPatch(assets, 'remove', 'Office', ['Retail']), { skip: true }, 'tags: remove one not there');
eq(!!bulkEditPatch(assets, 'add', '', []).error, true, 'tags: no value is an error');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

// Assertion tests for the Fee Builder settings saved per deal.
// Plain Node - no test framework. Run:
//   node scripts/feeBuilderSaved.test.mjs
import { dealFor, snapshotFeeBuilder, restoreFeeBuilder, savedFor, putSaved, removeSaved, listSaved } from '../src/utils/feeBuilderSaved.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const header = [{ label: 'Client', value: 'Acme Corp' }];
const wb1 = {
  id: 'w1',
  fileName: 'Acme SIA v1.xlsx',
  options: [
    { optionNumber: 1, sheetName: 'Option 1', headerDetails: header },
    { optionNumber: 2, sheetName: 'Option 2', headerDetails: header },
  ],
};

check('deal from the company', dealFor(wb1), { key: 'company:acme corp', label: 'Acme Corp' });
check('deal from the file name with no company',
  dealFor({ fileName: 'Big Deal.xlsx', options: [{ optionNumber: 1, sheetName: 'Option 1' }] }),
  { key: 'file:big deal', label: 'Big Deal' });
check('no deal with nothing to go on', dealFor({ options: [] }), null);
check('no deal with no workbook', dealFor(null), null);

const picks = { 1: { 'bbs reporting': 's1', 'bill payment': '' }, 2: { 'espm link': 's9' } };
const overrides = { 1: { 'BBS reporting|setup fee|0': 500 } };
const doneState = { workbookId: 'w1', done: { '1|bbs reporting': true, '2|espm link': true } };
const entry = snapshotFeeBuilder({ workbook: wb1, picks, overrides, doneState, now: 1000 });
check('snapshot', entry, {
  key: 'company:acme corp',
  label: 'Acme Corp',
  fileName: 'Acme SIA v1.xlsx',
  savedAt: 1000,
  options: {
    'Option 1': { picks: picks[1], overrides: overrides[1], done: ['bbs reporting'] },
    'Option 2': { picks: picks[2], overrides: {}, done: ['espm link'] },
  },
});
check('done ticks from another SIA are not saved',
  snapshotFeeBuilder({ workbook: wb1, picks: {}, overrides: {}, doneState: { workbookId: 'other', done: { '1|x': true } }, now: 1 }).options,
  {});

// The same deal uploaded again: fresh id, options numbered the other way
// round, and one sheet gone.
const wb2 = {
  id: 'w2',
  fileName: 'Acme SIA v2.xlsx',
  options: [
    { optionNumber: 1, sheetName: 'option 2 ', headerDetails: header },
    { optionNumber: 3, sheetName: 'Option 3', headerDetails: header },
  ],
};
let map = putSaved({}, entry);
check('found for the same deal', savedFor(map, wb2)?.savedAt, 1000);
check('not found for another deal', savedFor(map, { options: [{ sheetName: 'Option 1', headerDetails: [{ label: 'Client', value: 'Other' }] }] }), null);

const r = restoreFeeBuilder(entry, wb2);
check('picks mapped by sheet name', r.picks, { 1: { 'espm link': 's9' } });
check('no typed fees on that sheet', r.overrides, {});
check('done ticks on the new SIA', r.doneState, { workbookId: 'w2', done: { '1|espm link': true } });
check('missing sheets listed', r.missing, ['Option 1']);
check('matched count', r.matched, 1);

const r1 = restoreFeeBuilder(entry, wb1);
check('round trip picks', r1.picks, picks);
check('round trip overrides', r1.overrides, overrides);
check('round trip done', r1.doneState, doneState);

map = putSaved(map, { key: 'company:other', label: 'Other', savedAt: 2000, options: {} });
check('listed newest first', listSaved(map).map(e => e.label), ['Other', 'Acme Corp']);
const before = map;
map = removeSaved(map, 'company:acme corp');
check('removed', Object.keys(map), ['company:other']);
check('remove does not mutate', Object.keys(before).length, 2);
check('remove unknown is a no-op', removeSaved(map, 'nope'), map);
check('restore of nothing', restoreFeeBuilder(null, wb1).picks, {});

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

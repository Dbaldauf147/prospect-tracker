// Assertion tests for the Fee Builder checklist and column picker.
// Plain Node - no test framework. Run:
//   node scripts/feeBuilderChecklist.test.mjs
import { isServiceDone, setServiceDone, toggleHiddenColumn, updateForOption } from '../src/utils/feeBuilderChecklist.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

check('nothing ticked to start', isServiceDone(null, 'w1', 1, 'BBS reporting'), false);

let s = setServiceDone(null, 'w1', 1, 'BBS reporting', true);
check('ticked', isServiceDone(s, 'w1', 1, 'BBS reporting'), true);
check('service name matched loosely', isServiceDone(s, 'w1', 1, '  bbs reporting '), true);
check('other option not ticked', isServiceDone(s, 'w1', 2, 'BBS reporting'), false);
check('other SIA not ticked', isServiceDone(s, 'w2', 1, 'BBS reporting'), false);

s = setServiceDone(s, 'w1', 1, 'Bill payment', true);
s = setServiceDone(s, 'w1', 1, 'BBS reporting', false);
check('unticked', isServiceDone(s, 'w1', 1, 'BBS reporting'), false);
check('the other stays', isServiceDone(s, 'w1', 1, 'Bill payment'), true);

const s2 = setServiceDone(s, 'w2', 1, 'ESPM link', true);
check('a new SIA starts fresh', isServiceDone(s2, 'w2', 1, 'Bill payment'), false);
check('state not mutated', isServiceDone(s, 'w1', 1, 'Bill payment'), true);

check('hide a column', toggleHiddenColumn(undefined, 'cts'), ['cts']);
check('show it again', toggleHiddenColumn(['cts', 'current'], 'cts'), ['current']);

let picks = updateForOption(undefined, 1, p => ({ ...p, 'bill payment': 's2' }));
picks = updateForOption(picks, 2, p => ({ ...p, 'bill payment': '' }));
check('each option keeps its own picks', picks, { 1: { 'bill payment': 's2' }, 2: { 'bill payment': '' } });
const before = JSON.stringify(picks);
const reset = updateForOption(picks, 1, () => ({}));
check('an emptied option drops out, the other stays', reset, { 2: { 'bill payment': '' } });
check('input not mutated', JSON.stringify(picks), before);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

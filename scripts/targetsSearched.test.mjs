// Targets "Last Searched" (utils/targetsSearched). Run: node scripts/targetsSearched.test.mjs
import { targetsSearchedAt, targetsSearchedBackfill, localToday } from '../src/utils/targetsSearched.js';
import { blankTarget, noTargetRow } from '../src/utils/companyTargets.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

check('reads a stored day', targetsSearchedAt({ targetsSearchedAt: '2026-10-01' }), '2026-10-01');
check('ignores junk', targetsSearchedAt({ targetsSearchedAt: 'yesterday' }), '');
check('none', targetsSearchedAt({}), '');
check('localToday', localToday(new Date(2026, 0, 5)), '2026-01-05');

const prospects = [
  { id: 'a', company: 'A', climateTargets: [{ ...blankTarget(), type: 'Net zero' }] },
  { id: 'b', company: 'B', climateTargets: [noTargetRow()] },
  { id: 'c', company: 'C', climateTargets: [blankTarget()] },
  { id: 'd', company: 'D' },
  { id: 'e', company: 'E', climateTargets: [{ ...blankTarget(), type: 'SBTi' }], targetsSearchedAt: '2026-09-01' },
];
const out = targetsSearchedBackfill(prospects);
check('dates companies with targets and no date', out.map(o => o.id), ['a', 'b']);
check('to Nov 18', out[0].patch, { targetsSearchedAt: '2026-11-18' });

console.log(`targetsSearched: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

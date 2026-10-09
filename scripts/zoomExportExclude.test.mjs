// Assertion tests for keeping companies out of the ZoomInfo exports.
//   node scripts/zoomExportExclude.test.mjs
import { buildZoomExcludedMatcher, normZoomCompany, isZoomExcluded } from '../src/utils/zoomExportExclude.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const prospects = [
  { id: 'p1', company: 'Acme, Inc.', excludeFromZoomExports: true, zoomCompanyId: '12345' },
  { id: 'p2', company: 'Globex', excludeFromZoomExports: false },
  { id: 'p3', company: 'Initech' },
];
const isExcluded = buildZoomExcludedMatcher(prospects);

check('flag read', [isZoomExcluded(prospects[0]), isZoomExcluded(prospects[1]), isZoomExcluded(null)], [true, false, false]);
check('suffixes and punctuation set aside', normZoomCompany('Acme, Inc.'), 'acme');
check('by id', isExcluded({ id: 'p1', company: 'Something else' }), true);
check('by name, any spelling of the suffix', isExcluded({ company: 'ACME Corporation' }), true);
check('by Zoom Company ID', isExcluded({ company: 'Renamed', zoomId: '12345' }), true);
check('by an alternate name', isExcluded({ company: 'Typo Co', names: ['', 'Acme'] }), true);
check('a longer name is a different company', isExcluded({ company: 'Acme Industrial' }), false);
check('not excluded', isExcluded({ id: 'p2', company: 'Globex' }), false);
check('never flagged', isExcluded({ id: 'p3', company: 'Initech' }), false);
check('nothing excluded, nothing matches', buildZoomExcludedMatcher([{ id: 'x', company: 'Acme' }])({ company: 'Acme' }), false);
check('no prospects', buildZoomExcludedMatcher(undefined)({ company: 'Acme' }), false);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

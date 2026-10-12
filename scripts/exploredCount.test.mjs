// Which services count toward a company's % of services explored.
// Plain Node, no framework. Run:
//   node scripts/exploredCount.test.mjs
//
// Broader SE, Renewables and the graveyard are on the board but left out of
// the percentage, on both sides of it.
import { exploredCountTest, isUncountedBucket } from '../src/utils/serviceCategoriesStore.js';

let passed = 0, failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n  expected ${e}\n  actual   ${a}`); }
}

const seed = exploredCountTest({});
check('a Targets service counts', seed('SBT AV'), true);
check('a Broader SE service does not', seed('EV'), false);
check('a Renewables service does not', seed('PPA/VPPA'), false);
check('a seed-flagged retired service does not', seed('IREM'), false);

const custom = exploredCountTest({
  customServiceCategories: [
    { name: 'Targets', items: ['SBTi'] },
    { name: 'Broader SE offers', items: ['Sensor Audit'] },
    { name: 'Renewables & PPAs', items: ['REOA'] },
    { name: 'Old Graveyard', items: ['Legacy thing'] },
  ],
});
check('renamed boxes still match', [custom('Sensor Audit'), custom('REOA'), custom('Legacy thing'), custom('SBTi')], [false, false, false, true]);
check('box names', ['Broader SE', 'Renewables', 'Old Graveyard', 'Targets'].map(isUncountedBucket), [true, true, false, false]);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

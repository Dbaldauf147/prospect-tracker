// Which services count toward a company's % of services explored.
// Plain Node, no framework. Run:
//   node scripts/exploredCount.test.mjs
//
// Broader SE, Renewables and the graveyard are on the board but left out of
// the percentage, on both sides of it.
import { exploredCountTest, isUncountedBucket, setBucketCounted, renameBucketCounted, setServiceCounted } from '../src/utils/serviceCategoriesStore.js';

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

// The user's own answer per box, from the header popup on the company card.
const flipped = exploredCountTest({
  serviceBucketCounted: { 'Broader SE': true, Targets: false },
});
check('a box switched on counts', flipped('EV'), true);
check('a box switched off does not', flipped('SBT AV'), false);
check('untouched boxes keep the default', flipped('PPA/VPPA'), false);
check('override read by name', [isUncountedBucket('Targets', { serviceBucketCounted: { Targets: false } }), isUncountedBucket('Renewables', { serviceBucketCounted: { Renewables: true } })], [true, false]);
check('an answer matching the default is not stored', setBucketCounted({ serviceBucketCounted: { Targets: false } }, 'Targets', true), {});
check('an answer against the default is stored', setBucketCounted({}, 'Renewables', true), { Renewables: true });
check('rename carries the answer', renameBucketCounted({ serviceBucketCounted: { Targets: false } }, 'Targets', 'Goals'), { Goals: false });
check('rename with nothing to carry', renameBucketCounted({}, 'Targets', 'Goals'), null);

// One service's own answer, from its popup on Dropdowns, over its box's.
const perService = exploredCountTest({
  serviceExploredCounted: { ev: true, 'sbt av': false, irem: true },
});
check('a service switched on counts despite its box', perService('EV'), true);
check('a service switched off is left out of a counted box', perService('SBT AV'), false);
check('matched case-insensitively', perService(' sbt av '), false);
check('a retired service stays out whatever it says', perService('IREM'), false);
check('its box neighbours are untouched', perService('PPA/VPPA'), false);
check('beats the box answer too', exploredCountTest({ serviceBucketCounted: { Targets: false }, serviceExploredCounted: { 'sbt av': true } })('SBT AV'), true);
check('a per-service answer against the box is stored', setServiceCounted({}, 'EV', true), { ev: true });
check('a per-service answer matching the box is dropped', setServiceCounted({ serviceExploredCounted: { ev: true } }, 'EV', false), {});
check('switching off a counted service is stored', setServiceCounted({}, 'SBT AV', false), { 'sbt av': false });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

// Assertion tests for the Changed Jobs page's selector and its Schneider
// Electric split. Run: node scripts/changedJobs.test.mjs
import { isChangedJobs, isSchneiderContact } from '../src/utils/changedJobs.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  if (actual === expected) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${expected}\n  actual   ${actual}`);
}

const outsideLeft = { email: 'ann@acme.com', company: 'Acme', dans_tags: 'Left' };
const outsideCompany = { email: 'bob@beta.com', company: 'Changed Jobs' };
const coworkerLeft = { email: 'cat@se.com', company: 'Schneider Electric', dans_tags: 'Left' };
const coworkerStill = { email: 'dan@se.com', company: 'Schneider Electric' };
const coworkerChangedText = { email: 'eve@schneider-electric.com', company: 'Changed Jobs' };
const hidden = { email: 'fay@acme.com', company: 'Changed Jobs', dans_tags: 'Left; Hide' };

check('Left tag at an outside company is on the page', isChangedJobs(outsideLeft), true);
check('Company "Changed Jobs" is on the page', isChangedJobs(outsideCompany), true);
check('coworker tagged Left is on the page', isChangedJobs(coworkerLeft), true);
check('coworker still at SE is not', isChangedJobs(coworkerStill), false);
check('SE address with Changed Jobs company but no Left tag is not', isChangedJobs(coworkerChangedText), false);
check('Hide tag keeps a contact off', isChangedJobs(hidden), false);

check('outside contact is not Schneider', isSchneiderContact(outsideLeft), false);
check('se.com coworker is Schneider', isSchneiderContact(coworkerLeft), true);
check('schneider-electric.com address is Schneider', isSchneiderContact({ email: 'x@schneider-electric.com', company: '' }), true);
check('Schneider company text alone is Schneider', isSchneiderContact({ email: 'x@gmail.com', company: 'Schneider Electric USA' }), true);
check('a lookalike domain is not Schneider', isSchneiderContact({ email: 'x@notse.com', company: 'Other' }), false);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

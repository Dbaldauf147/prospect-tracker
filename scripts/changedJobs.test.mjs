// Assertion tests for the Changed Jobs page's selector and its Schneider
// Electric split. Run: node scripts/changedJobs.test.mjs
import { isChangedJobs, isSchneiderContact, snoozeUntilIso, activeSnoozeMs, changedJobsToWork } from '../src/utils/changedJobs.js';

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

const NOV_9 = Date.UTC(2026, 10, 9, 15);
check('snooze 3 months lands on the same day', snoozeUntilIso(NOV_9, 3), '2027-02-09T15:00:00.000Z');
check('snooze 12 months', snoozeUntilIso(NOV_9, 12), '2027-11-09T15:00:00.000Z');
check('Jan 31 + 1 month clamps to Feb 28', snoozeUntilIso(Date.UTC(2027, 0, 31), 1), '2027-02-28T00:00:00.000Z');
check('a future snooze is active', activeSnoozeMs({ _changedJobsSnoozeUntil: '2027-02-09T15:00:00.000Z' }, NOV_9), Date.UTC(2027, 1, 9, 15));
check('a past snooze is not', activeSnoozeMs({ _changedJobsSnoozeUntil: '2026-01-01T00:00:00.000Z' }, NOV_9), null);
check('no snooze is not', activeSnoozeMs(null, NOV_9), null);

const pool = [
  { id: '1', firstname: 'Zoe', lastname: 'Open', email: 'z@acme.com', company: 'Acme', dans_tags: 'Left' },
  { id: '2', firstname: 'Ann', lastname: 'Reached', email: 'a@acme.com', company: 'Changed Jobs' },
  { id: '3', firstname: 'Ben', lastname: 'Hidden', email: 'b@acme.com', company: 'Changed Jobs' },
  { id: '4', firstname: 'Cy', lastname: 'Snoozed', email: 'c@acme.com', company: 'Changed Jobs' },
  { id: '5', firstname: 'Di', lastname: 'Expired', email: 'd@acme.com', company: 'Changed Jobs', companyText: 'Old Co' },
  { id: '6', firstname: 'Ed', lastname: 'Coworker', email: 'e@se.com', company: 'Schneider Electric', dans_tags: 'Left' },
  { id: '7', firstname: 'Fi', lastname: 'Notonpage', email: 'f@acme.com', company: 'Acme' },
];
const lf = {
  2: { _reachedOut: true },
  3: { _changedJobsHidden: true },
  4: { _changedJobsSnoozeUntil: '2027-03-01T00:00:00.000Z' },
  5: { _changedJobsSnoozeUntil: '2026-01-01T00:00:00.000Z' },
};
const work = changedJobsToWork(pool, lf, NOV_9);
check('to-work skips reached out, hidden and snoozed; keeps expired snoozes and SE', work.map(w => w.name).join(','), 'Di Expired,Ed Coworker,Zoe Open');
check('to-work names the old company, not the marker', work[0].company, 'Old Co');
check('to-work flags SE coworkers', work[1].schneider, true);
check('nothing in, nothing out', changedJobsToWork(null, null, NOV_9).length, 0);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

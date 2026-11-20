// Assertion tests for the Issues-tab warning a week ahead of a scheduled
// opp. Plain Node, no test framework. Run:
//   node scripts/scheduledOppIssues.test.mjs
import { upcomingScheduledOppIssues } from '../src/utils/scheduledOpps.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const entry = (over) => ({ id: 'so-1', company: 'Barings', scope: 'Strategic sourcing', dueDate: '2027-01-08', dueTime: '08:00', ...over });
const at = (iso) => new Date(iso);
const prospects = [{ id: 'p1', company: 'Barings' }];
const run = (entries, now) => upcomingScheduledOppIssues(entries, { now: at(now), prospects });

eq(run([entry()], '2026-12-31T15:00:00Z'), [], 'eight days out: nothing yet');

const week = run([entry()], '2027-01-01T15:00:00Z');
eq(week.map(r => [r.id, r.type, r.company, r.prospectId, r.daysUntil]),
  [['scheduled-opp-upcoming:so-1:2027-01-08', 'Scheduled opp coming up', 'Barings', 'p1', 7]],
  'seven days out: the warning appears, tied to the company');
eq(week[0].detail,
  'A new opp for Barings (Strategic sourcing) is scheduled to be created on Fri, Jan 8, 8:00 AM ET. That is in 7 days. To move or cancel it, go to Opps > Scheduled.',
  'the detail says what, when and where to change it');

eq(run([entry()], '2027-01-07T15:00:00Z')[0].daysUntil, 1, 'the day before');
eq(/tomorrow/.test(run([entry()], '2027-01-07T15:00:00Z')[0].detail), true, 'the day before reads as tomorrow');
// 03:00 UTC on the 2nd is still the evening of the 1st in New York.
eq(run([entry()], '2027-01-02T03:00:00Z')[0].daysUntil, 7, 'days are counted on the Eastern calendar');
eq(/due now/.test(run([entry()], '2027-01-08T14:00:00Z')[0].detail), true, 'past due and not yet created still shows');

eq(run([entry({ firedAt: 1 })], '2027-01-05T15:00:00Z'), [], 'a created opp drops off');
eq(run([entry({ canceledAt: 1 })], '2027-01-05T15:00:00Z'), [], 'a cancelled one drops off');

const moved = run([entry({ dueDate: '2027-01-12' })], '2027-01-06T15:00:00Z');
eq(moved[0].id, 'scheduled-opp-upcoming:so-1:2027-01-12', 'moving the date makes a new warning, so an old snooze does not hide it');

const cb = run([entry({ kind: 'checkBack', oppId: 'o9', scope: '' })], '2027-01-05T15:00:00Z');
eq([cb[0].type, /come back into the Call In/.test(cb[0].detail)], ['Scheduled check-back coming up', true], 'a check-back is worded as one');

eq(JSON.stringify(week.concat(cb)).includes(String.fromCharCode(0x2014)), false, 'no em dash in what the app shows');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

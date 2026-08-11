// Assertion tests for the "run the agent prompts" reminder. Plain Node — no
// test framework (the project has none). Run:
//   node scripts/agentsRunReminder.test.mjs
//
// The interval is counted in business days, and the failure modes worth
// guarding are both quiet ones:
//
//   - the reminder fires over the weekend, so Monday morning starts with an
//     alert the user already cleared on Thursday;
//   - a weekend gets counted as burned-down interval, so a Friday run comes
//     due Sunday and the badge is stale by the time anyone looks.
//
// Dates below are built with local-time constructors on purpose: the reminder
// reads off the viewer's own calendar, so a UTC-anchored test would drift.
import {
  AGENTS_RUN_INTERVAL_BUSINESS_DAYS,
  AGENTS_SNOOZE_DURATIONS,
  addBusinessDays,
  agentsLastRunMs,
  agentsRunDueAt,
  isAgentsRunDue,
  agentsDaysSinceRun,
  agentsDaysUntilDue,
  agentsSnoozeEndAt,
  agentsSnoozeRemainingLabel,
  agentsSnoozedUntilMs,
  isAgentsRunSnoozed,
} from '../src/utils/agentsRunReminder.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// Local-time helper: `at(2026, 8, 6, 18, 34)` is 6 Aug 2026, 6:34pm local.
const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min, 0, 0);
const iso = (date) => date.toISOString();
const label = (date) => date.toDateString();

// ---- adding business days ---------------------------------------------------

// August 2026: 3rd is a Monday, so 6th = Thu, 7th = Fri, 8th–9th = weekend.
eq(label(new Date(addBusinessDays(at(2026, 8, 5, 18, 34).getTime(), 2))),
  label(at(2026, 8, 7)), 'Wed + 2 business days is Friday');
eq(label(new Date(addBusinessDays(at(2026, 8, 6, 18, 34).getTime(), 2))),
  label(at(2026, 8, 10)), 'Thu + 2 skips the weekend and lands Monday');
eq(label(new Date(addBusinessDays(at(2026, 8, 7, 18, 34).getTime(), 2))),
  label(at(2026, 8, 11)), 'Fri + 2 lands Tuesday');
eq(label(new Date(addBusinessDays(at(2026, 8, 8, 18, 34).getTime(), 2))),
  label(at(2026, 8, 11)), 'a Saturday run still counts Mon+Tue');
eq(label(new Date(addBusinessDays(at(2026, 8, 6, 18, 34).getTime(), 5))),
  label(at(2026, 8, 13)), 'a full business week is 7 calendar days on');

// The time of day rides along — a 6:34pm run is due again at 6:34pm, not at
// midnight, so the alert doesn't jump the gun by most of a day.
const thu = at(2026, 8, 6, 18, 34);
eq(new Date(addBusinessDays(thu.getTime(), 2)).getHours(), 18, 'time of day is preserved');
eq(new Date(addBusinessDays(thu.getTime(), 2)).getMinutes(), 34, 'minutes are preserved');

eq(addBusinessDays(thu.getTime(), 0), thu.getTime(), 'zero business days is a no-op');

// ---- when the reminder comes due --------------------------------------------

eq(AGENTS_RUN_INTERVAL_BUSINESS_DAYS, 2, 'the interval is two business days');
eq(label(new Date(agentsRunDueAt(iso(thu)))), label(at(2026, 8, 10)),
  'a Thursday run is due again Monday');
eq(agentsRunDueAt(''), null, 'no stamp means no due date');
eq(agentsRunDueAt('not a date'), null, 'an unparseable stamp means no due date');
eq(agentsLastRunMs(iso(thu)), thu.getTime(), 'a stored ISO stamp round-trips');

// The case that prompted the change: run Thursday evening, and the weekend
// stays quiet.
eq(isAgentsRunDue(iso(thu), at(2026, 8, 7, 9, 0).getTime()), false, 'quiet the next morning');
eq(isAgentsRunDue(iso(thu), at(2026, 8, 8, 12, 0).getTime()), false, 'quiet on Saturday');
eq(isAgentsRunDue(iso(thu), at(2026, 8, 9, 12, 0).getTime()), false, 'quiet on Sunday');
eq(isAgentsRunDue(iso(thu), at(2026, 8, 10, 9, 0).getTime()), false,
  'still quiet Monday morning — the stamp was an evening one');
eq(isAgentsRunDue(iso(thu), at(2026, 8, 10, 19, 0).getTime()), true, 'up Monday evening');

// A Friday run gets the same treatment, one day over.
const fri = at(2026, 8, 7, 18, 34);
eq(isAgentsRunDue(iso(fri), at(2026, 8, 9, 12, 0).getTime()), false, 'Friday run: quiet Sunday');
eq(isAgentsRunDue(iso(fri), at(2026, 8, 10, 19, 0).getTime()), false, 'Friday run: quiet Monday');
eq(isAgentsRunDue(iso(fri), at(2026, 8, 11, 19, 0).getTime()), true, 'Friday run: up Tuesday');

// Never marked → due now, so the alert shows until the first run is recorded.
eq(isAgentsRunDue('', at(2026, 8, 10).getTime()), true, 'never marked reads as due');
eq(isAgentsRunDue(undefined, at(2026, 8, 10).getTime()), true, 'a missing stamp reads as due');

// ---- the "N days" copy ------------------------------------------------------

// Elapsed and remaining stay in calendar days: they answer "how long ago" and
// "when will it fire", which the user reads off a wall calendar.
eq(agentsDaysSinceRun(iso(thu), at(2026, 8, 10, 12, 0).getTime()), 3, 'three calendar days since Thursday');
eq(agentsDaysSinceRun(iso(thu), at(2026, 8, 6, 20, 0).getTime()), 0, 'same evening is zero days');
eq(agentsDaysSinceRun('', Date.now()), null, 'no stamp, no elapsed count');

eq(agentsDaysUntilDue(iso(thu), at(2026, 8, 7, 18, 34).getTime()), 3,
  'Thursday run, asked on Friday: Monday is three days out');
eq(agentsDaysUntilDue(iso(fri), at(2026, 8, 7, 18, 34).getTime()), 4,
  'marking a run Friday means four calendar days of quiet');
eq(agentsDaysUntilDue(iso(thu), at(2026, 8, 11, 12, 0).getTime()), 0, 'past due clamps to zero');
eq(agentsDaysUntilDue('', Date.now()), null, 'no stamp, no countdown');

// ---- snoozing the alert -----------------------------------------------------

// A snooze suppresses a due reminder until it lapses, then the reminder is
// back — the run was deferred, not recorded.
const mondayEvening = at(2026, 8, 10, 19, 0).getTime();
const snoozeTwoHours = iso(new Date(mondayEvening + 2 * 3600000));
eq(isAgentsRunDue(iso(thu), mondayEvening, snoozeTwoHours), false, 'a live snooze holds the alert down');
eq(isAgentsRunDue(iso(thu), mondayEvening + 3600000, snoozeTwoHours), false, 'still quiet an hour in');
eq(isAgentsRunDue(iso(thu), mondayEvening + 3 * 3600000, snoozeTwoHours), true,
  'the alert returns once the snooze lapses');
eq(isAgentsRunDue('', mondayEvening, snoozeTwoHours), false,
  'a snooze also quiets the never-marked case');
eq(isAgentsRunDue(iso(thu), mondayEvening, ''), true, 'no snooze stamp changes nothing');
eq(isAgentsRunDue(iso(thu), mondayEvening, 'not a date'), true, 'an unparseable snooze is ignored');

// Expiry is read-time, so a stale stamp needs no cleanup to stop counting.
eq(agentsSnoozedUntilMs(snoozeTwoHours, mondayEvening), mondayEvening + 2 * 3600000,
  'a live snooze reports its end');
eq(agentsSnoozedUntilMs(snoozeTwoHours, mondayEvening + 3 * 3600000), null, 'a lapsed snooze reads as none');
eq(isAgentsRunSnoozed(snoozeTwoHours, mondayEvening), true, 'snoozed while it runs');
eq(isAgentsRunSnoozed('', mondayEvening), false, 'no stamp, not snoozed');

// Day-length snoozes count business days for the same reason the interval
// does: a Friday "1 day" lands Monday, not Saturday. Hour options are plain
// clock time.
const byKey = (key) => AGENTS_SNOOZE_DURATIONS.find(d => d.key === key);
eq(agentsSnoozeEndAt(byKey('4h'), fri.getTime()), fri.getTime() + 4 * 3600000, 'four hours is four hours');
eq(label(new Date(agentsSnoozeEndAt(byKey('1d'), fri.getTime()))), label(at(2026, 8, 10)),
  'a Friday one-day snooze ends Monday');
eq(label(new Date(agentsSnoozeEndAt(byKey('1w'), thu.getTime()))), label(at(2026, 8, 13)),
  'a week is five business days — the same weekday next week');
eq(agentsSnoozeEndAt(null, fri.getTime()), null, 'no duration, no end');
eq(agentsSnoozeEndAt({ key: 'bogus' }, fri.getTime()), null, 'an unrecognised duration has no end');

// Remaining-time copy rounds up, so it never reads as "0 left".
eq(agentsSnoozeRemainingLabel(mondayEvening + 30 * 60000, mondayEvening), 'under an hour', 'sub-hour copy');
eq(agentsSnoozeRemainingLabel(mondayEvening + 3.2 * 3600000, mondayEvening), '4 hours', 'hours round up');
eq(agentsSnoozeRemainingLabel(mondayEvening + 26 * 3600000, mondayEvening), '2 days', 'days round up');
eq(agentsSnoozeRemainingLabel(null, mondayEvening), '', 'no snooze, no copy');
eq(agentsSnoozeRemainingLabel(mondayEvening - 1000, mondayEvening), '', 'a lapsed snooze has no copy');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

// Assertion tests for the opp Availability tab's free/busy reading. Plain
// Node, no framework. Run:
//   node scripts/availability.test.mjs
//
// The data arrives from Graph's getSchedule by way of a Power Automate
// flow, so the quiet failures are in the reading: a bare UTC dateTime read
// as local time shifts every meeting by the viewer's offset, and a slot
// that one meeting makes busy and another tentative must read busy.
process.env.TZ = 'America/New_York';
const {
  parseEmailList, availabilityEmails, getScheduleBody, normalizeSchedules,
  availabilityGrid, freeRanges, availabilityDays, availabilityWindow,
} = await import('../src/utils/availability.js');

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

// ── Typing people in ──────────────────────────────────────────────────────
check('pasted list with names and junk',
  parseEmailList('A@se.com; Bob Smith <bob@se.com>, nope\nA@se.com'),
  { emails: ['a@se.com', 'bob@se.com'], invalid: ['nope'] });
check('union of every opp, deduped and sorted',
  availabilityEmails({ o1: ['b@se.com', 'a@se.com'], o2: ['A@se.com', 'bad'] }),
  ['a@se.com', 'b@se.com']);
check('capped at 20',
  availabilityEmails({ o: Array.from({ length: 25 }, (_, i) => `p${String(i).padStart(2, '0')}@se.com`) }).length, 20);

// ── What the flow is told ─────────────────────────────────────────────────
const win = availabilityWindow(new Date('2026-11-11T18:42:10.123Z'));
check('window starts on the hour, runs 14 days', win, { start: '2026-11-11T18:00:00.000Z', end: '2026-11-25T18:00:00.000Z' });
check('getSchedule body is bare UTC',
  getScheduleBody(['a@se.com'], win),
  { schedules: ['a@se.com'], startTime: { dateTime: '2026-11-11T18:00:00', timeZone: 'UTC' }, endTime: { dateTime: '2026-11-25T18:00:00', timeZone: 'UTC' }, availabilityViewInterval: 30 });

// ── What the flow posts back ──────────────────────────────────────────────
const posted = {
  value: [
    {
      scheduleId: 'A@se.com',
      scheduleItems: [
        // 9:00-10:00 New York, sent as Graph sends it: no zone on the string.
        { status: 'busy', subject: 'Pipeline review', start: { dateTime: '2026-11-12T14:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-11-12T15:00:00.0000000', timeZone: 'UTC' } },
        { status: 'tentative', start: { dateTime: '2026-11-12T14:30:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-11-12T16:00:00.0000000', timeZone: 'UTC' } },
        { status: 'free', start: { dateTime: '2026-11-12T17:00:00', timeZone: 'UTC' }, end: { dateTime: '2026-11-12T18:00:00', timeZone: 'UTC' } },
        { status: 'busy', isPrivate: true, subject: 'Doctor', start: { dateTime: '2026-11-12T20:00:00', timeZone: 'UTC' }, end: { dateTime: '2026-11-12T23:00:00', timeZone: 'UTC' } },
      ],
    },
    { scheduleId: 'b@se.com', scheduleItems: [{ status: 'oof', start: { dateTime: '2026-11-12T13:00:00', timeZone: 'UTC' }, end: { dateTime: '2026-11-12T14:00:00', timeZone: 'UTC' } }] },
    { scheduleId: 'c@other.com', error: { message: 'The user was not found', responseCode: 'ErrorInvalidRecipients' } },
  ],
};
const schedules = normalizeSchedules(posted);
check('free items dropped, bare UTC read as UTC, private subject hidden', schedules[0], {
  email: 'a@se.com',
  items: [
    { status: 'busy', start: '2026-11-12T14:00:00.000Z', end: '2026-11-12T15:00:00.000Z', subject: 'Pipeline review' },
    { status: 'tentative', start: '2026-11-12T14:30:00.000Z', end: '2026-11-12T16:00:00.000Z' },
    { status: 'busy', start: '2026-11-12T20:00:00.000Z', end: '2026-11-12T23:00:00.000Z' },
  ],
});
check('an unreadable calendar keeps its reason', schedules[2], { email: 'c@other.com', items: [], error: 'The user was not found' });
check('the bare array is accepted too', normalizeSchedules(posted.value).length, 3);

// ── The grid, in New York time ────────────────────────────────────────────
const day = new Date(2026, 10, 12);
const grid = availabilityGrid(schedules, ['a@se.com', 'b@se.com', 'c@other.com'], day, undefined, new Date(2026, 10, 11));
const at = (row, h, m = 0) => grid.rows[row].cells[(h - 8) * 2 + (m ? 1 : 0)].status;
check('20 half-hour slots, 8 to 6', grid.slots.length, 20);
check('9:00 busy for A', at(0, 9), 'busy');
check('9:30 busy beats tentative', at(0, 9, 30), 'busy');
check('10:30 tentative', at(0, 10, 30), 'tentative');
check('8:00 out of office for B', at(1, 8), 'oof');
check('C has no data', at(2, 9), 'unknown');
check('two calendars on file', grid.knownCount, 2);
check('everyone-free skips B out 8 to 9 and A busy 9 to 10 and 3 to 6, tentative counts as free',
  freeRanges(grid).map(r => [r.start.getHours() + r.start.getMinutes() / 60, r.end.getHours() + r.end.getMinutes() / 60]),
  [[10, 15]]);

// ── Days ──────────────────────────────────────────────────────────────────
const days = availabilityDays({ start: '2026-11-13T15:00:00.000Z', end: '2026-11-20T15:00:00.000Z' }, new Date('2026-11-13T15:00:00Z'));
check('weekdays only, from today', days.map(d => d.getDate()), [13, 16, 17, 18, 19, 20]);

check('after 6pm, today is skipped',
  availabilityDays({ start: '2026-11-13T23:30:00.000Z', end: '2026-11-17T23:30:00.000Z' }, new Date('2026-11-13T23:30:00Z')).map(d => d.getDate()),
  [16, 17]);
const morning = availabilityGrid(schedules, ['a@se.com'], day, undefined, new Date(2026, 10, 12, 9, 15));
check('slots already over read as past', morning.everyone.slice(0, 4), ['past', 'past', 'busy', 'busy']);

console.log(`${failed ? 'FAIL' : 'PASS'}  availability.test.mjs  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

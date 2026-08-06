// Assertion tests for the Outlook calendar → Activity meeting mapping.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/outlookCalendar.test.mjs
//
// src/utils/outlookCalendar.js is deliberately import-free so it can be
// exercised here. It decides what the Activity page shows as the user's
// calendar, and the two ways it can be wrong are both quiet: dropping a
// meeting that is really on the calendar, or counting a colleague as the
// person the meeting is with.
import {
  meetingFromOutlookEvent, outlookMeetingsFromEvents, describeOutlookCalendar,
  meetingFromGranolaEvent, granolaCalendarMeetings,
} from '../src/utils/outlookCalendar.js';
import { mergeMeetings, rangeForUpcoming, meetingsInRange, groupMeetingsByDay } from '../src/utils/granolaMeetings.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

function event(overrides = {}) {
  return {
    id: 'AAMkAD_1',
    subject: 'Simon | Schneider Electric - Weekly Check In',
    start: '2026-08-06T18:00:00.000Z',
    end: '2026-08-06T19:00:00.000Z',
    isAllDay: false,
    showAs: 'busy',
    location: 'Microsoft Teams Meeting',
    organizer: { name: 'Me', email: 'me@se.com' },
    attendees: [
      { name: 'Me', email: 'me@se.com', type: 'required', response: 'organizer' },
      { name: 'Simon Reed', email: 'simon@acme.com', type: 'required', response: 'accepted' },
    ],
    ...overrides,
  };
}

// ---- one event → one row ----------------------------------------------------

const row = meetingFromOutlookEvent(event());
eq(row._source, 'outlook', 'row is tagged as coming from the calendar');
eq(row._subject, 'Simon | Schneider Electric - Weekly Check In', 'subject carries over');
eq(row._meetingStart, '2026-08-06T18:00:00.000Z', 'start carries over as an instant');
eq(row._meetingEnd, '2026-08-06T19:00:00.000Z', 'end carries over as an instant');
eq(row._duration, 3600000, 'duration is derived from start and end');
eq(row.id, 'outlook:AAMkAD_1', 'id is namespaced so it cannot collide with a Granola note');
eq(row._location, 'Microsoft Teams Meeting', 'location carries over');

// Colleagues are not who the meeting is with.
eq(row._attendees, 'Simon Reed', 'internal attendees are left out of the attendee line');
eq(row._attendeeCount, 1, 'the attendee count is the external one');
eq(row._externalEmails, ['simon@acme.com'], 'external emails drive the company match');
eq(row._internalOnly, false, 'a meeting with an outsider is not internal-only');

const internal = meetingFromOutlookEvent(event({
  subject: 'CM + RECA Monthly Office Hours',
  attendees: [
    { name: 'Me', email: 'me@se.com' },
    { name: 'A Colleague', email: 'colleague@se.com' },
    { name: 'Subsidiary', email: 'someone@uk.se.com' },
  ],
}));
eq(internal._internalOnly, true, 'a meeting with only colleagues is flagged internal-only');
eq(internal._attendeeCount, 0, 'a subdomain of the company counts as internal too');

const solo = meetingFromOutlookEvent(event({ subject: 'Prospecting Time', attendees: [], showAs: 'free' }));
eq(solo._internalOnly, false, 'a block with no attendees is not "internal only", it is empty');
eq(solo._showAs, 'free', 'a focus block keeps its free/busy state');
eq(!!solo, true, 'a block marked free is still on the calendar and still shows');

const allDay = meetingFromOutlookEvent(event({ isAllDay: true }));
eq(allDay._allDay, true, 'an all-day event is flagged rather than dropped');

eq(meetingFromOutlookEvent(event({ start: null })), null, 'an event with no start cannot be placed');
eq(meetingFromOutlookEvent(event({ start: 'not a date' })), null, 'an unparseable start is not a start');
eq(meetingFromOutlookEvent(null), null, 'nothing in, nothing out');
eq(meetingFromOutlookEvent(event({ subject: '' }))._subject, '(No subject)', 'an untitled event still reads as something');
eq(meetingFromOutlookEvent(event({ end: null }))._duration, null, 'no end means no invented duration');

// ---- a list of events -------------------------------------------------------

const rows = outlookMeetingsFromEvents([
  event({ id: 'b', subject: 'Later', start: '2026-08-06T20:00:00.000Z', end: '2026-08-06T21:00:00.000Z' }),
  event({ id: 'a', subject: 'Earlier', start: '2026-08-06T13:00:00.000Z', end: '2026-08-06T14:00:00.000Z' }),
  event({ id: 'a', subject: 'Earlier', start: '2026-08-06T13:00:00.000Z', end: '2026-08-06T14:00:00.000Z' }),
  event({ id: 'c', start: null }),
]);
eq(rows.map(r => r._subject), ['Earlier', 'Later'], 'the day is read forwards, and the same occurrence lands once');
eq(outlookMeetingsFromEvents(null), [], 'no events is an empty day, not a crash');

// ---- the same calendar, relayed by Granola ----------------------------------
//
// Granola syncs Outlook, so an event arriving this way IS the schedule
// and has to behave like one: outranking a notetaker's account of the
// same meeting, and merging with the note rather than sitting beside it.

const viaGranola = meetingFromGranolaEvent({
  id: 'evt_9',
  title: 'Simon | Schneider Electric - Weekly Check In',
  start: '2026-08-06T18:00:00.000Z',
  end: '2026-08-06T19:00:00.000Z',
  location: 'Microsoft Teams Meeting',
  organizer: { name: 'Me', email: 'me@se.com' },
  attendees: [{ name: 'Me', email: 'me@se.com' }, { name: 'Simon Reed', email: 'simon@acme.com' }],
});
eq(viaGranola._subject, 'Simon | Schneider Electric - Weekly Check In', 'Granola names the title `title`, not `subject`');
eq(viaGranola._source, 'outlook', 'a relayed calendar event still ranks as the schedule');
eq(viaGranola._via, 'granola', 'the pipe that carried it is recorded');
eq(viaGranola.id, 'granola-cal:evt_9', 'its id cannot collide with a directly-fetched event');
eq(viaGranola._attendees, 'Simon Reed', 'colleagues drop off the same way');
eq(meetingFromGranolaEvent({ title: 'x' }), null, 'an event with no start still cannot be placed');
eq(meetingFromGranolaEvent(null), null, 'nothing in, nothing out');
eq(granolaCalendarMeetings(null), [], 'no calendar is an empty list, not a crash');

const relayedMerge = mergeMeetings([viaGranola, {
  id: 'granola:not_9',
  _type: 'meeting',
  _source: 'granola',
  _subject: 'Simon | Schneider Electric - Weekly Check In',
  _meetingStart: '2026-08-06T18:01:00.000Z',
  _granolaUrl: 'https://notes.granola.ai/d/not_9',
  _attendeeDetails: [],
}]);
eq(relayedMerge.length, 1, 'the relayed event and Granola’s own note on it are one meeting');
eq(relayedMerge[0]._granolaUrl, 'https://notes.granola.ai/d/not_9', 'the note link still survives');

// ---- against the other sources ----------------------------------------------
//
// The whole point of routing the calendar through the same row shape:
// once Granola writes a note on a meeting the calendar already knew
// about, the two must collapse into ONE row that carries the note link.

const granolaCopy = {
  id: 'granola:not_1',
  _type: 'meeting',
  _source: 'granola',
  _subject: 'Simon | Schneider Electric - Weekly Check In',
  _meetingStart: '2026-08-06T18:02:00.000Z',
  _meetingEnd: '2026-08-06T18:55:00.000Z',
  _granolaUrl: 'https://notes.granola.ai/d/not_1',
  _granolaSummary: 'Talked pricing.',
  _attendeeDetails: [],
};
const merged = mergeMeetings([meetingFromOutlookEvent(event()), granolaCopy]);
eq(merged.length, 1, 'the calendar event and its Granola note are one meeting');
eq(merged[0]._source, 'outlook', 'the calendar keeps the row: it is the authority on the schedule');
eq(merged[0]._sources, ['outlook', 'granola'], 'both sources are credited');
eq(merged[0]._granolaUrl, 'https://notes.granola.ai/d/not_1', 'the note link survives the merge');
eq(merged[0]._meetingEnd, '2026-08-06T19:00:00.000Z', 'the scheduled end wins over the recorded one');

// ---- the forward window -----------------------------------------------------

const NOW = new Date(2026, 7, 6, 9, 30); // Thu 6 Aug 2026, 09:30 local
const upcoming = rangeForUpcoming(7, NOW);
eq(new Date(upcoming.start).getDate(), 6, 'upcoming starts at the top of today, not at this minute');
eq(new Date(upcoming.end).getDate(), 14, 'upcoming runs through the end of the 7th day ahead');

const localRow = (subject, date) => ({
  _type: 'meeting', _source: 'outlook', _subject: subject,
  _meetingStart: date.toISOString(), _meetingEnd: null,
});
const week = [
  localRow('Yesterday standup', new Date(2026, 7, 5, 9, 0)),
  localRow('This morning, already started', new Date(2026, 7, 6, 9, 0)),
  localRow('This afternoon', new Date(2026, 7, 6, 14, 0)),
  localRow('Tomorrow', new Date(2026, 7, 7, 9, 0)),
  localRow('Three weeks out', new Date(2026, 7, 27, 9, 0)),
];
eq(
  meetingsInRange(week, upcoming).map(r => r._subject),
  ['This morning, already started', 'This afternoon', 'Tomorrow'],
  'upcoming keeps a meeting you are sitting in, drops yesterday and next month',
);

const ahead = groupMeetingsByDay(meetingsInRange(week, upcoming), { order: 'asc' });
eq(ahead.map(g => new Date(g.dayStart).getDate()), [6, 7], 'a look-ahead opens on today and runs forwards');
const back = groupMeetingsByDay(week);
eq(back.map(g => new Date(g.dayStart).getDate()), [27, 7, 6, 5], 'a look-back still opens on the most recent day');

// ---- explaining an empty panel ----------------------------------------------

// Stated as a fact, not an instruction. When Granola can't serve the
// calendar this line is a footnote to Granola's own answer, and a panel
// that opens with "use Connect Outlook to sign in" is arguing with a
// user who has said they don't want to.
eq(
  describeOutlookCalendar({ connected: false }),
  'Outlook isn’t connected, and cannot be on this tenant: see "Outlook: not available" for the history.',
  'never connected states the fact without prescribing the fix',
);
eq(
  describeOutlookCalendar({ connected: true, expired: true }),
  'Your Outlook sign-in has expired. Use Reconnect Outlook to sign in again — it lasts about an hour.',
  'an expired token is a sign-in, not an error',
);
eq(
  describeOutlookCalendar({ connected: true, loaded: true, events: 12, inRange: 3, rangeLabel: 'today' }),
  '',
  'a panel with meetings in it needs no explaining',
);
eq(
  describeOutlookCalendar({ connected: true, loaded: true, events: 12, inRange: 0, rangeLabel: 'today' }),
  'Outlook has 12 events in the fetched window, none today.',
  'a genuinely clear day says so, and says the calendar was read',
);
eq(
  describeOutlookCalendar({ connected: true, loaded: true, events: 0, rangeLabel: 'in the next 7 days' }),
  'Outlook returned no calendar events for this window (in the next 7 days).',
  'an empty calendar is distinguishable from an unread one',
);
eq(describeOutlookCalendar({ connected: true, loaded: false }), '', 'nothing is claimed before the first read lands');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

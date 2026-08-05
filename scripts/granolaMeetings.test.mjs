// Assertion tests for the Granola → Activity meeting mapping. Plain Node
// — no test framework (the project has none). Run:
//   node scripts/granolaMeetings.test.mjs
//
// src/utils/granolaMeetings.js is deliberately import-free so it can be
// exercised here: it holds the rules that decide what lands on the user's
// calendar view and, more importantly, which two rows are secretly the
// same meeting. Getting that wrong either doubles up their day or hides
// a meeting, so the rules are pinned rather than left to the UI.
import {
  meetingFromRecord, granolaMeetingsFromRecords, isSameMeeting, mergeMeetings, meetingsOnDay,
} from '../src/utils/granolaMeetings.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const OWNER = { name: 'Me', email: 'me@se.com' };

function record(overrides = {}) {
  return {
    id: 'granola:not_1',
    source: 'granola',
    name: 'Acme — quarterly review',
    recordedAt: '2026-08-05T14:00:00.000Z',
    durationSeconds: 1800,
    granolaUrl: 'https://notes.granola.ai/d/not_1',
    granolaSummary: 'Talked pricing.',
    owner: OWNER,
    attendees: [
      { name: 'Me', email: 'me@se.com' },
      { name: 'Dana Reid', email: 'dana@acme.com' },
    ],
    calendarEvent: {
      title: 'Acme quarterly review',
      start: '2026-08-05T14:00:00.000Z',
      end: '2026-08-05T14:45:00.000Z',
      location: 'Teams',
      organizer: { name: 'Dana Reid', email: 'dana@acme.com' },
      url: '',
      conferenceUrl: '',
    },
    ...overrides,
  };
}

// --- meetingFromRecord ---------------------------------------------------
{
  const row = meetingFromRecord(record());
  eq(row._type, 'meeting', 'a Granola record becomes a meeting row');
  eq(row._source, 'granola', 'the row names its source');
  eq(row._subject, 'Acme quarterly review', 'the calendar event title wins over the note title');
  eq(row._meetingStart, '2026-08-05T14:00:00.000Z', 'start comes from the calendar event');
  eq(row._meetingEnd, '2026-08-05T14:45:00.000Z', 'end comes from the calendar event, not the duration');
  eq(row._location, 'Teams', 'location carries through');
  eq(row._granolaUrl, 'https://notes.granola.ai/d/not_1', 'the note link is on the row');
  eq(row._duration, 1800000, 'duration is milliseconds, as the table formatter expects');
}

// Colleagues aren't who the meeting was with: the owner's own domain is
// what tells them apart, so no domain is hard-coded anywhere.
{
  const row = meetingFromRecord(record());
  eq(row._attendeeDetails, [{ name: 'Dana Reid', email: 'dana@acme.com' }], 'the owner’s own domain is filtered out');
  eq(row._attendees, 'Dana Reid', 'the attendee line lists the other side only');
  eq(row._externalEmails, ['dana@acme.com'], 'external emails drive the company guess');

  const noOwner = meetingFromRecord(record({ owner: null }));
  eq(noOwner._attendeeCount, 2, 'with no owner on the record every attendee is kept');

  // An all-colleagues meeting has no external attendees, which is not
  // the same as having none at all.
  const internal = meetingFromRecord(record({ attendees: [OWNER, { name: 'Sam', email: 'sam@se.com' }] }));
  eq(internal._attendees, '', 'an internal meeting lists nobody on the other side');
  eq(internal._internalOnly, true, 'and is flagged as internal rather than empty');
  eq(meetingFromRecord(record())._internalOnly, false, 'a meeting with an external attendee is not internal');
  eq(meetingFromRecord(record({ attendees: [] }))._internalOnly, false, 'a meeting with no attendees at all is not "internal only"');
}

// A note taken outside a calendar meeting still belongs on the feed, but
// must not be given an end time nobody knows.
{
  const adhoc = meetingFromRecord(record({ calendarEvent: null, durationSeconds: null }));
  eq(adhoc._subject, 'Acme — quarterly review', 'with no event the note title is the subject');
  eq(adhoc._meetingStart, '2026-08-05T14:00:00.000Z', 'with no event the record’s own time is used');
  eq(adhoc._meetingEnd, null, 'no event and no duration means no invented end');
  eq(adhoc._duration, null, 'no duration to report is null, not 0');

  const timed = meetingFromRecord(record({ calendarEvent: null }));
  eq(timed._meetingEnd, '2026-08-05T14:30:00.000Z', 'a duration alone still yields an end');
}

// Records with no usable time can't be placed on a calendar at all.
{
  eq(meetingFromRecord(record({ calendarEvent: null, recordedAt: null })), null, 'a record with no time is dropped');
  eq(meetingFromRecord(record({ calendarEvent: null, recordedAt: 'not a date' })), null, 'an unparseable time is dropped');
  eq(meetingFromRecord(null), null, 'a missing record is dropped');
}

// A company the user already tagged the call with is never overwritten.
{
  eq(meetingFromRecord(record({ company: 'Acme Corp' }))._company, 'Acme Corp', 'a tagged company carries through');
  eq(meetingFromRecord(record())._company, '', 'an untagged call leaves the company for the page to guess');
}

// --- granolaMeetingsFromRecords -----------------------------------------
{
  const rows = granolaMeetingsFromRecords({
    'granola:a': record({ id: 'granola:a', calendarEvent: null, recordedAt: '2026-08-01T10:00:00.000Z' }),
    'granola:b': record({ id: 'granola:b', calendarEvent: null, recordedAt: '2026-08-04T10:00:00.000Z' }),
    'onedrive:c': { id: 'onedrive:c', source: 'onedrive', recordedAt: '2026-08-05T10:00:00.000Z' },
    'granola:d': record({ id: 'granola:d', calendarEvent: null, recordedAt: null }),
  });
  eq(rows.map(r => r.id), ['granola:b', 'granola:a'], 'only Granola records, newest first, timeless ones dropped');
  eq(granolaMeetingsFromRecords(null), [], 'no records is an empty list, not a throw');
}

// --- isSameMeeting -------------------------------------------------------
{
  const outlook = { _source: 'outlook', _subject: 'Acme quarterly review', _meetingStart: '2026-08-05T14:00:00.000Z' };
  const granola = { _source: 'granola', _subject: 'Acme Quarterly Review', _meetingStart: '2026-08-05T14:03:00.000Z' };
  eq(isSameMeeting(outlook, granola), true, 'same title a few minutes apart is one meeting');

  eq(isSameMeeting(outlook, { ...granola, _subject: 'Canceled: Acme quarterly review' }), true,
    'a calendar client’s status prefix is not a different meeting');

  eq(isSameMeeting(outlook, { ...granola, _meetingStart: '2026-08-05T15:00:00.000Z' }), false,
    'an hour apart is a different meeting, however alike the titles');

  eq(isSameMeeting(outlook, { ...granola, _subject: 'Beta kickoff' }), false,
    'different titles at the same time stay two meetings');

  eq(isSameMeeting(outlook, { ...outlook }), false,
    'two rows from the SAME source are never merged — a real double-booking survives');

  eq(isSameMeeting(outlook, { ...granola, _subject: 'Sync' }), false,
    'a title too short to be distinctive does not match by containment');

  eq(isSameMeeting(outlook, { ...granola, _meetingStart: null }), false, 'a row with no start matches nothing');
}

// --- mergeMeetings -------------------------------------------------------
{
  const merged = mergeMeetings([
    {
      _source: 'granola', _subject: 'Acme quarterly review', _meetingStart: '2026-08-05T14:02:00.000Z',
      _meetingEnd: '2026-08-05T14:45:00.000Z', _granolaUrl: 'https://notes.granola.ai/d/not_1',
      _granolaSummary: 'Talked pricing.', _company: 'Acme Corp', _location: 'Teams', _attendeeDetails: [],
    },
    {
      _source: 'outlook', _subject: 'Acme quarterly review', _meetingStart: '2026-08-05T14:00:00.000Z',
      _meetingEnd: '', _granolaUrl: '', _company: '', _location: '',
      _attendeeDetails: [{ name: 'Dana Reid', email: 'dana@acme.com' }],
    },
  ]);
  eq(merged.length, 1, 'the same meeting from two sources collapses to one row');
  eq(merged[0]._source, 'outlook', 'the calendar’s own copy is the row that survives');
  eq(merged[0]._sources, ['outlook', 'granola'], 'both contributors are recorded');
  eq(merged[0]._meetingStart, '2026-08-05T14:00:00.000Z', 'the surviving row keeps the calendar’s start');
  eq(merged[0]._granolaUrl, 'https://notes.granola.ai/d/not_1', 'Granola donates the note link');
  eq(merged[0]._company, 'Acme Corp', 'Granola donates the company the calendar didn’t have');
  eq(merged[0]._meetingEnd, '2026-08-05T14:45:00.000Z', 'a blank end is filled from the other copy');
  eq(merged[0]._attendeeDetails, [{ name: 'Dana Reid', email: 'dana@acme.com' }],
    'the calendar’s attendee list is not replaced by the emptier one');
}

// A meeting only one source knows about must survive untouched, and the
// result comes back in calendar order.
{
  const merged = mergeMeetings([
    { _source: 'granola', _subject: 'Late note', _meetingStart: '2026-08-05T16:00:00.000Z' },
    { _source: 'outlook', _subject: 'Standup', _meetingStart: '2026-08-05T09:00:00.000Z' },
    { _source: 'hubspot', _subject: 'Logged call', _meetingStart: '2026-08-05T11:00:00.000Z' },
  ]);
  eq(merged.map(m => m._subject), ['Standup', 'Logged call', 'Late note'], 'unmatched meetings all survive, in start order');
  eq(merged.map(m => m._sources), [['outlook'], ['hubspot'], ['granola']], 'each carries its single source');
  eq(mergeMeetings([]), [], 'no meetings merges to none');
  eq(mergeMeetings(null), [], 'a missing list is not a throw');
}

// Precedence is by source, not by input order: whichever way the lists
// are concatenated, the calendar's copy wins.
{
  const granola = { _source: 'granola', _subject: 'Acme review', _meetingStart: '2026-08-05T14:00:00.000Z', _location: 'Teams' };
  const hubspot = { _source: 'hubspot', _subject: 'Acme review', _meetingStart: '2026-08-05T14:00:00.000Z', _location: '' };
  eq(mergeMeetings([granola, hubspot])[0]._source, 'hubspot', 'HubSpot outranks Granola whichever order they arrive in');
  eq(mergeMeetings([hubspot, granola])[0]._location, 'Teams', 'and still absorbs what Granola knew');
}

// --- meetingsOnDay -------------------------------------------------------
// Local days, not UTC ones: "today" is the user's today. The window is
// built from a local noon so the test says the same thing in any zone.
{
  const noon = new Date(2026, 7, 5, 12, 0, 0);
  const iso = (h, m = 0) => new Date(2026, 7, 5, h, m, 0).toISOString();
  const rows = [
    { _subject: 'Early', _meetingStart: iso(0, 0) },
    { _subject: 'Late', _meetingStart: iso(23, 59) },
    { _subject: 'Yesterday', _meetingStart: new Date(2026, 7, 4, 23, 59).toISOString() },
    { _subject: 'Tomorrow', _meetingStart: new Date(2026, 7, 6, 0, 1).toISOString() },
    { _subject: 'Timeless', _meetingStart: null },
  ];
  eq(meetingsOnDay(rows, noon).map(r => r._subject), ['Early', 'Late'], 'only meetings inside the local day are kept');
  eq(meetingsOnDay(null, noon), [], 'no rows is an empty list');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

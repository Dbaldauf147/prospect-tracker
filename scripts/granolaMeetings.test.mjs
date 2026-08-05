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
  rangeForDays, meetingsInRange, groupMeetingsByDay, undatedGranolaRecords,
  describeGranolaMeetings,
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

// --- rangeForDays --------------------------------------------------------
// Local calendar days, walked rather than subtracted in 24-hour blocks:
// a window that spans a daylight-saving change still starts at midnight.
{
  const noon = new Date(2026, 7, 5, 12, 0, 0);
  const local = (y, mo, d) => new Date(y, mo, d).getTime();

  eq(rangeForDays(1, noon), { start: local(2026, 7, 5), end: local(2026, 7, 6) }, 'one day is today');
  eq(rangeForDays(7, noon), { start: local(2026, 6, 30), end: local(2026, 7, 6) },
    'seven days reaches back six, crossing into the previous month');
  eq(rangeForDays(30, noon), { start: local(2026, 6, 7), end: local(2026, 7, 6) }, 'thirty days reaches back twenty-nine');

  // The window ends at the end of today: looking further back is not a
  // reason to start showing next week.
  eq(rangeForDays(30, noon).end, rangeForDays(1, noon).end, 'every window ends at the end of today');
  eq(rangeForDays(0, noon), rangeForDays(1, noon), 'a nonsense day count falls back to today');
  eq(rangeForDays(undefined, noon), rangeForDays(1, noon), 'a missing day count falls back to today');

  // Across the US spring-forward (8 Mar 2026), a naive 24-hour
  // subtraction would land the start at 23:00 on the 8th and drop that
  // morning's meetings.
  const afterDst = new Date(2026, 2, 10, 12, 0, 0);
  eq(rangeForDays(7, afterDst).start, local(2026, 2, 4), 'a window spanning a DST change still starts at local midnight');
}

// --- meetingsInRange -----------------------------------------------------
{
  const noon = new Date(2026, 7, 5, 12, 0, 0);
  const at = (dayOffset, h) => new Date(2026, 7, 5 + dayOffset, h, 0, 0).toISOString();
  const rows = [
    { _subject: 'Today', _meetingStart: at(0, 9) },
    { _subject: 'Later today', _meetingStart: at(0, 17) },
    { _subject: 'Three days back', _meetingStart: at(-3, 14) },
    { _subject: 'Ten days back', _meetingStart: at(-10, 14) },
    { _subject: 'Tomorrow', _meetingStart: at(1, 9) },
    { _subject: 'Timeless', _meetingStart: null },
  ];
  eq(meetingsInRange(rows, rangeForDays(1, noon)).map(r => r._subject), ['Today', 'Later today'],
    'a one-day window is today, including the rest of it');
  eq(meetingsInRange(rows, rangeForDays(7, noon)).map(r => r._subject), ['Today', 'Later today', 'Three days back'],
    'a seven-day window reaches back but never forward');
  eq(meetingsInRange(rows, rangeForDays(30, noon)).map(r => r._subject),
    ['Today', 'Later today', 'Three days back', 'Ten days back'], 'a thirty-day window picks up the older meeting');
  eq(meetingsInRange(rows, {}).length, 5, 'an open window keeps everything that has a time');
  eq(meetingsInRange(null, rangeForDays(7, noon)), [], 'no rows is an empty list');
}

// --- groupMeetingsByDay --------------------------------------------------
// Days newest first, each day read forwards — a look back starts from
// what just happened, but a day is still read the way a calendar shows it.
{
  const at = (day, h, m = 0) => new Date(2026, 7, day, h, m, 0).toISOString();
  const groups = groupMeetingsByDay([
    { _subject: 'Mon late', _meetingStart: at(3, 16) },
    { _subject: 'Wed first', _meetingStart: at(5, 9) },
    { _subject: 'Mon early', _meetingStart: at(3, 8) },
    { _subject: 'Wed second', _meetingStart: at(5, 14) },
    { _subject: 'Timeless', _meetingStart: null },
  ]);
  eq(groups.length, 2, 'meetings bucket into one group per calendar day');
  eq(groups.map(g => g.meetings.map(m => m._subject)),
    [['Wed first', 'Wed second'], ['Mon early', 'Mon late']],
    'newest day first, and each day in the order it happened');
  eq(groups[0].dayStart, new Date(2026, 7, 5).getTime(), 'a group is stamped with its local midnight');
  eq(groupMeetingsByDay([]), [], 'no meetings groups to nothing');
  eq(groupMeetingsByDay(null), [], 'a missing list is not a throw');
}

// A meeting near midnight belongs to the day it starts in LOCAL time,
// which is not the day its UTC timestamp falls on.
{
  const late = new Date(2026, 7, 5, 23, 30, 0);
  const groups = groupMeetingsByDay([{ _subject: 'Late call', _meetingStart: late.toISOString() }]);
  eq(groups[0].dayStart, new Date(2026, 7, 5).getTime(), 'a late-evening meeting stays on its own local day');
}

// --- undatedGranolaRecords -----------------------------------------------
// The counterpart to granolaMeetingsFromRecords: the records it dropped.
// Rendering wants them gone, explaining wants them counted — a panel
// emptied by unreadable dates is indistinguishable from an empty
// calendar until something says otherwise.
{
  const records = {
    a: { id: 'granola:a', source: 'granola', recordedAt: '2026-08-05T14:00:00.000Z' },
    b: { id: 'granola:b', source: 'granola', calendarEvent: { start: '2026-08-05T15:00:00.000Z' } },
    // What an un-normalised recordedAt produces: an epoch that never
    // became an instant, so nothing here parses as a date.
    c: { id: 'granola:c', source: 'granola', recordedAt: '1785938400' },
    d: { id: 'granola:d', source: 'granola', recordedAt: null },
    e: { id: 'granola:e', source: 'granola', recordedAt: 'not a date' },
    // Not a Granola record at all: neither list should claim it.
    f: { id: 'local:x', source: 'local', recordedAt: null },
  };

  eq(undatedGranolaRecords(records).map(r => r.id), ['granola:c', 'granola:d', 'granola:e'], 'records with no readable date are the undated ones');
  eq(granolaMeetingsFromRecords(records).map(r => r.id), ['granola:b', 'granola:a'], 'the datable records still become rows, newest first');

  // The two halves partition the Granola records exactly — nothing is
  // counted twice, and nothing goes missing from both.
  const granolaCount = Object.values(records).filter(r => r.source === 'granola').length;
  eq(
    granolaMeetingsFromRecords(records).length + undatedGranolaRecords(records).length,
    granolaCount,
    'rows plus undated accounts for every Granola record',
  );

  eq(undatedGranolaRecords({}), [], 'no records means nothing undated');
  eq(undatedGranolaRecords(null), [], 'a null record map is handled');
  eq(undatedGranolaRecords([records.c]), [records.c], 'an array of records works like a map');
  eq(undatedGranolaRecords({ f: records.f }), [], 'non-Granola records are never reported as undated');
}

// --- describeGranolaMeetings ---------------------------------------------
// The line under the panel header. Its whole job is telling apart the
// several different nothings that all render as "0 meetings", so each
// branch is pinned to the cause it names. diagnoseEmptySync covers a
// fetch that came back empty AND can only speak while an import runs;
// everything below is a state it cannot reach.
{
  const d = (o) => describeGranolaMeetings({ windowDays: 30, rangeDays: 1, ...o });

  // THE case that started this: a fresh load, nothing stored, no import
  // has reported anything. Previously silent.
  eq(d({}), 'Nothing has been imported from Granola yet: use ↻ Granola.',
    'a fresh load with nothing stored points at the button');

  // Same, but an import HAS run before (in an earlier visit) and left
  // nothing. The distinction matters: one has never been tried.
  eq(d({ syncedAt: '2026-08-05T10:00:00.000Z' }),
    'Nothing is stored from Granola. The last import brought back no meetings: use ↻ Granola to try again.',
    'a previous import that stored nothing says so rather than looking untried');

  // An import ran this session and saw notes, none of which were
  // meetings. seen === 0 belongs to diagnoseEmptySync, so this stays
  // quiet and lets that message through.
  eq(d({ imported: { seen: 4 } }), 'Granola returned 4 notes, but none of them describe a meeting.',
    'notes that yield no meetings say so');
  eq(d({ imported: { seen: 1 } }), 'Granola returned 1 note, but none of them describe a meeting.',
    'one note is singular');
  eq(d({ imported: { seen: 0 } }), '',
    'an empty fetch stays silent so diagnoseEmptySync is not duplicated');

  // Meetings exist but not in the visible range — the one the range
  // buttons fix in a click, and the likeliest benign empty panel.
  eq(d({ total: 12, inRange: 0 }), 'Granola has 12 meetings in the last 30 days, none today.',
    'a today-only range with meetings on other days says so');
  eq(d({ total: 12, inRange: 0, rangeDays: 7 }), 'Granola has 12 meetings in the last 30 days, none in the last 7 days.',
    'the range is named as the user selected it');
  eq(d({ total: 1, inRange: 0 }), 'Granola has 1 meeting in the last 30 days, none today.', 'one meeting is singular');

  // Meetings are showing: the count above says it, so add nothing.
  eq(d({ total: 12, inRange: 3 }), '', 'a range with meetings in it needs no explanation');

  // Undated notes, alone and alongside the range message.
  eq(d({ total: 0, inRange: 0, undated: 2 }), '2 notes had no readable date and could not be placed.',
    'undated notes are reported on their own');
  eq(d({ total: 5, inRange: 0, undated: 1 }),
    'Granola has 5 meetings in the last 30 days, none today; 1 note had no readable date and could not be placed.',
    'undated notes are appended to the range message');
  eq(d({ total: 5, inRange: 2, undated: 1 }), '1 note had no readable date and could not be placed.',
    'undated notes are reported even when the range has meetings');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

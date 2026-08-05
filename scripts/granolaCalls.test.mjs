// Assertion tests for the Granola ingest's normalisation layer. Plain
// Node — no test framework (the project has none). Run:
//   node scripts/granolaCalls.test.mjs
//
// This covers api/granola-calls.js rather than the client module, for two
// reasons: it is pure (no browser, no fetch at import time), and it is the
// part the route itself flags as most likely to need adjusting when
// Granola renames a field. Every read below is deliberately tolerant, so
// the tests pin the tolerance rather than one exact spelling.
import {
  normalizeNote, resolveApiBase, normalizeCalendarEvent, toIsoInstant, describeListShape,
} from '../api/granola-calls.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
function ok(value, name) { eq(!!value, true, name); }

// --- resolveApiBase: the escape hatch must not become a foot-gun --------
// GRANOLA_API_BASE sits directly under GRANOLA_API_KEY in .env.example,
// so the value landing in it is more often a pasted key than a real host.
{
  const DEFAULT = 'https://public-api.granola.ai/v1';
  eq(resolveApiBase(''), DEFAULT, 'unset base falls back to the default');
  eq(resolveApiBase('   '), DEFAULT, 'whitespace-only base falls back');
  eq(resolveApiBase(undefined), DEFAULT, 'undefined base falls back');
  eq(resolveApiBase('gsk_live_abc123'), DEFAULT, 'an API key pasted into the base is ignored');
  eq(resolveApiBase('public-api.granola.ai/v1'), DEFAULT, 'a schemeless host is ignored');
  eq(resolveApiBase('https://staging.granola.ai/v1'), 'https://staging.granola.ai/v1', 'a real https base is honoured');
  eq(resolveApiBase('https://staging.granola.ai/v1///'), 'https://staging.granola.ai/v1', 'trailing slashes are trimmed');
  eq(resolveApiBase('http://localhost:8787/v1'), 'http://localhost:8787/v1', 'a local http base is honoured');
}

// --- normalizeNote: identity and metadata -------------------------------
{
  const note = {
    id: 'not_abc',
    title: 'Acme — quarterly review',
    created_at: '2026-08-01T10:00:00.000Z',
    updated_at: '2026-08-01T11:30:00.000Z',
    calendar_event: {
      start_time: '2026-08-01T10:00:00.000Z',
      end_time: '2026-08-01T10:45:00.000Z',
      attendees: [{ name: 'Dana Reid', email: 'Dana@Acme.com' }],
    },
    owner: { name: 'Me', email: 'me@schneider.com' },
    folder_membership: [{ name: 'Prospects' }, { title: 'Q3' }],
  };
  const out = normalizeNote(note);
  eq(out.id, 'granola:not_abc', 'id carries the granola: prefix');
  eq(out.noteId, 'not_abc', 'raw note id is kept alongside');
  eq(out.name, 'Acme — quarterly review', 'title is used as the name');
  eq(out.recordedAt, '2026-08-01T10:00:00.000Z', 'recordedAt comes from the calendar event start');
  eq(out.durationSeconds, 2700, 'duration comes from the calendar event span');
  eq(out.attendees, [{ name: 'Dana Reid', email: 'dana@acme.com' }], 'attendee emails are lowercased');
  eq(out.folders, ['Prospects', 'Q3'], 'folder names read either spelling');
  eq(out.granolaUrl, 'https://notes.granola.ai/d/not_abc', 'url falls back to the notes deep link');
  eq(out.hasTranscript, false, 'a list-only note reports no transcript');
  eq(out.utterances, [], 'a list-only note carries no turns');
}

// --- recordedAt is normalised, not passed through -----------------------
// It used to be a bare str(), so an epoch stamp came out as
// "1785938400" — a string new Date() rejects. The Activity page drops a
// meeting whose start it cannot parse, so a note with no calendar event
// behind it disappeared from the page instead of showing up undated.
// Every case below has to survive `new Date(recordedAt)`.
{
  const usable = (recordedAt) => {
    const ms = new Date(recordedAt || 0).getTime();
    return Number.isFinite(ms) && ms > 0;
  };
  const ISO = '2026-08-05T14:00:00.000Z';
  const EPOCH_S = 1785938400;        // the same instant
  const EPOCH_MS = 1785938400000;

  eq(normalizeNote({ id: 'n', created_at: ISO }).recordedAt, ISO, 'an ISO created_at is kept');
  eq(normalizeNote({ id: 'n', created_at: EPOCH_S }).recordedAt, ISO, 'an epoch-seconds number becomes an instant');
  eq(normalizeNote({ id: 'n', created_at: String(EPOCH_S) }).recordedAt, ISO, 'an epoch-seconds string becomes an instant');
  eq(normalizeNote({ id: 'n', created_at: EPOCH_MS }).recordedAt, ISO, 'an epoch-millis number becomes an instant');

  for (const [label, value] of [['ISO', ISO], ['epoch seconds', EPOCH_S], ['epoch millis', EPOCH_MS]]) {
    ok(usable(normalizeNote({ id: 'n', created_at: value }).recordedAt), `a ${label} created_at parses as a date`);
  }

  // The event's start wins over created_at, and gets the same treatment —
  // this is the case that used to disagree with itself, normalising
  // calendarEvent.start correctly while leaving recordedAt as a raw epoch.
  const fromEvent = normalizeNote({ id: 'n', calendar_event: { start_time: EPOCH_S, title: 'Acme sync' }, created_at: '2020-01-01T00:00:00Z' });
  eq(fromEvent.recordedAt, ISO, 'an epoch event start becomes an instant');
  eq(fromEvent.recordedAt, fromEvent.calendarEvent.start, 'recordedAt and the calendar start agree on the same value');

  // A note with no usable stamp anywhere stays null rather than becoming
  // a string that only looks like a date.
  eq(normalizeNote({ id: 'n' }).recordedAt, null, 'a note with no timestamp has a null recordedAt');
  eq(normalizeNote({ id: 'n', created_at: 'not a date' }).recordedAt, null, 'an unparseable stamp is null, not passed through');
  eq(normalizeNote({ id: 'n', created_at: '10:45' }).recordedAt, null, 'a bare time of day is not treated as a date');
}

// A note with none of the preferred spellings still comes back usable.
{
  const out = normalizeNote({
    note_id: 'not_xyz',
    name: 'Fallback spellings',
    created: '2026-07-02T09:00:00.000Z',
    share_url: 'https://notes.granola.ai/share/xyz',
    participants: ['solo@vendor.io'],
  });
  eq(out.noteId, 'not_xyz', 'note_id is read when id is absent');
  eq(out.name, 'Fallback spellings', 'name is read when title is absent');
  eq(out.granolaUrl, 'https://notes.granola.ai/share/xyz', 'share_url wins over the deep-link fallback');
  eq(out.attendees, [{ name: '', email: 'solo@vendor.io' }], 'a bare email string becomes an attendee');
}

// A note with no id at all must not produce a record that collides with
// every other id-less note under the same key.
{
  const out = normalizeNote({ title: 'Orphan' });
  eq(out.noteId, '', 'a missing id stays empty rather than becoming "undefined"');
  eq(out.name, 'Orphan', 'an id-less note still carries its title');
  eq(out.granolaUrl, '', 'no id means no fabricated deep link');
}

// --- transcripts: speaker labelling ------------------------------------
{
  const out = normalizeNote({
    id: 'not_t1',
    transcript: [
      { source: 'microphone', text: 'Morning.', start_timestamp: 0, end_timestamp: 2 },
      { source: 'system', text: 'Morning to you.', start_timestamp: 2, end_timestamp: 5 },
      { speaker: 'Dana Reid', source: 'system', text: 'Named wins.', start_timestamp: 5, end_timestamp: 7 },
    ],
  }, { withTranscript: true });
  eq(out.utterances.map(u => u.speaker), ['You', 'Them', 'Dana Reid'], 'mic is You, other sources are Them, a name wins');
  eq(out.hasTranscript, true, 'turns mean the note has a transcript');
  eq(out.transcript, 'You: Morning.\nThem: Morning to you.\nDana Reid: Named wins.', 'flat transcript is speaker-prefixed');
}

// Empty text is dropped rather than rendered as a blank turn.
{
  const out = normalizeNote({
    id: 'not_t2',
    transcript: [
      { source: 'microphone', text: 'Kept.', start: 0 },
      { source: 'microphone', text: '   ', start: 1 },
    ],
  }, { withTranscript: true });
  eq(out.utterances.length, 1, 'a whitespace-only turn is dropped');
}

// --- transcripts: timing rebasing ---------------------------------------
// Whatever the unit, the player needs milliseconds from the start of the
// call. Starts and ends rebase against ONE origin.
{
  const msNote = normalizeNote({
    id: 'not_ms',
    transcript: [
      { source: 'microphone', text: 'a', start_timestamp: 1785000000000, end_timestamp: 1785000002000 },
      { source: 'system', text: 'b', start_timestamp: 1785000002000, end_timestamp: 1785000005000 },
    ],
  }, { withTranscript: true });
  eq(msNote.utterances.map(u => [u.start, u.end]), [[0, 2000], [2000, 5000]], 'epoch milliseconds rebase to zero');

  const secNote = normalizeNote({
    id: 'not_sec',
    transcript: [
      { source: 'microphone', text: 'a', start_timestamp: 1785000000, end_timestamp: 1785000002 },
      { source: 'system', text: 'b', start_timestamp: 1785000002, end_timestamp: 1785000005 },
    ],
  }, { withTranscript: true });
  eq(secNote.utterances.map(u => [u.start, u.end]), [[0, 2000], [2000, 5000]], 'epoch seconds rebase to zero and scale to ms');

  const offsetNote = normalizeNote({
    id: 'not_off',
    transcript: [
      { source: 'microphone', text: 'a', start: 0, end: 2 },
      { source: 'system', text: 'b', start: 2, end: 5 },
    ],
  }, { withTranscript: true });
  eq(offsetNote.utterances.map(u => [u.start, u.end]), [[0, 2000], [2000, 5000]], 'second offsets scale to ms');

  const clockNote = normalizeNote({
    id: 'not_clock',
    transcript: [
      { source: 'microphone', text: 'a', start: '00:00:00', end: '00:00:02' },
      { source: 'system', text: 'b', start: '0:02', end: '1:00:05' },
    ],
  }, { withTranscript: true });
  eq(clockNote.utterances.map(u => [u.start, u.end]), [[0, 2000], [2000, 3605000]], 'clock strings parse to ms offsets');
}

// A call that does not start at the origin keeps its offset rather than
// being slid back to zero by its own first turn.
{
  const out = normalizeNote({
    id: 'not_late',
    transcript: [
      { source: 'microphone', text: 'a', start: 120, end: 125 },
      { source: 'system', text: 'b', start: 125, end: 130 },
    ],
  }, { withTranscript: true });
  eq(out.utterances.map(u => u.start), [120000, 125000], 'a late first turn keeps its offset');
}

// --- transcripts: other shapes ------------------------------------------
{
  eq(normalizeNote({ id: 'n', transcript: 'Plain text transcript.' }, { withTranscript: true }).transcript,
    'Plain text transcript.', 'a string transcript is taken as-is');
  eq(normalizeNote({ id: 'n', transcript: { text: 'Wrapped.' } }, { withTranscript: true }).transcript,
    'Wrapped.', 'a wrapped transcript falls back to its text');
  eq(normalizeNote({ id: 'n', transcript: { segments: [{ source: 'microphone', text: 'Nested.' }] } }, { withTranscript: true }).utterances.length,
    1, 'segments nested under the transcript object are found');
  eq(normalizeNote({ id: 'n' }, { withTranscript: true }).hasTranscript,
    false, 'a note served without a transcript reports none');
}

// --- summaries -----------------------------------------------------------
{
  eq(normalizeNote({ id: 'n', summary_text: '  Bullet one.  ' }).granolaSummary, 'Bullet one.', 'a text summary is trimmed');
  eq(normalizeNote({ id: 'n', summary: { content: [{ text: 'Rich one.' }, { content: [{ text: 'Rich two.' }] }] } }).granolaSummary,
    'Rich one.\nRich two.', 'a ProseMirror-ish summary is walked for its text');
  eq(normalizeNote({ id: 'n' }).granolaSummary, '', 'no summary is an empty string, not undefined');
}

// --- duration ------------------------------------------------------------
{
  // No calendar event: fall back to where the last turn ends.
  eq(normalizeNote({
    id: 'n',
    transcript: [{ source: 'microphone', text: 'a', start: 0, end: 90 }],
  }, { withTranscript: true }).durationSeconds, 90, 'duration falls back to the last turn end');

  // A nonsense event span (end before start) must not produce a negative.
  eq(normalizeNote({
    id: 'n',
    calendar_event: { start_time: '2026-08-01T11:00:00Z', end_time: '2026-08-01T10:00:00Z' },
  }).durationSeconds, null, 'an inverted event span is rejected');

  eq(normalizeNote({ id: 'n' }).durationSeconds, null, 'nothing to measure means null, not 0');
}

// --- people --------------------------------------------------------------
{
  const out = normalizeNote({
    id: 'n',
    attendees: [
      { name: 'Dana Reid', email: 'dana@acme.com' },
      { name: 'Dana Reid (dup)', email: 'DANA@acme.com' },
      null,
      { name: '', email: '' },
    ],
    calendar_event: { organizer: { name: 'Sam', email: 'sam@acme.com' } },
  });
  eq(out.attendees, [
    { name: 'Dana Reid', email: 'dana@acme.com' },
    { name: 'Sam', email: 'sam@acme.com' },
  ], 'attendees dedupe case-insensitively and absorb the organiser');
}

// --- calendar events ------------------------------------------------------
// The Activity page's calendar view is built from these, so an event has
// to come back as an INSTANT or not at all.
{
  eq(toIsoInstant('2026-08-05T14:00:00Z'), '2026-08-05T14:00:00.000Z', 'an ISO string normalises to an ISO instant');
  eq(toIsoInstant(1785938400000), '2026-08-05T14:00:00.000Z', 'epoch milliseconds become an instant');
  eq(toIsoInstant(1785938400), '2026-08-05T14:00:00.000Z', 'epoch seconds scale up first');
  eq(toIsoInstant('1785938400000'), '2026-08-05T14:00:00.000Z', 'an epoch stamp in a string is still a stamp');
  // The one that matters: toMillis reads "14:00" as a 14-minute offset,
  // which is right for a transcript turn and nonsense for a meeting.
  eq(toIsoInstant('14:00'), null, 'a clock offset is not a date');
  eq(toIsoInstant('01:02:03'), null, 'a longer clock offset is not a date either');
  eq(toIsoInstant('sometime tuesday'), null, 'unparseable text is null');
  eq(toIsoInstant(''), null, 'blank is null');
  eq(toIsoInstant(null), null, 'null is null');
}

{
  const event = normalizeCalendarEvent({
    calendar_event: {
      title: 'Acme quarterly review',
      start_time: '2026-08-05T14:00:00Z',
      end_time: '2026-08-05T14:45:00Z',
      location: 'Microsoft Teams',
      organizer: { name: 'Dana Reid', email: 'Dana@Acme.com' },
      html_link: 'https://calendar.example/e/1',
    },
  });
  eq(event, {
    title: 'Acme quarterly review',
    start: '2026-08-05T14:00:00.000Z',
    end: '2026-08-05T14:45:00.000Z',
    location: 'Microsoft Teams',
    organizer: { name: 'Dana Reid', email: 'dana@acme.com' },
    url: 'https://calendar.example/e/1',
    conferenceUrl: '',
  }, 'a calendar event is normalised whole');
}

// Alternate spellings, including the British one Granola uses elsewhere
// in the same payload.
{
  const event = normalizeCalendarEvent({
    event: { summary: 'Fallbacks', starts_at: '2026-08-05T09:00:00Z', organiser: 'sam@acme.com' },
  });
  eq(event.title, 'Fallbacks', 'summary is read when title is absent');
  eq(event.start, '2026-08-05T09:00:00.000Z', 'starts_at is read when start_time is absent');
  eq(event.organizer, { name: '', email: 'sam@acme.com' }, 'the British spelling is read too');
  eq(event.end, null, 'an event with no end says so rather than guessing one');
}

// A note taken outside a meeting must not be given a fabricated event —
// that is what tells the Activity page it has no calendar entry.
{
  eq(normalizeCalendarEvent({ title: 'Ad-hoc call' }), null, 'no calendar event means null');
  eq(normalizeCalendarEvent({ calendar_event: {} }), null, 'an empty event object is null');
  eq(normalizeCalendarEvent({ calendar_event: { title: '', location: '' } }), null, 'an event of blanks is null');
  eq(normalizeCalendarEvent({ calendar_event: [] }), null, 'a non-object event is null');
  eq(normalizeCalendarEvent({ calendar_event: { location: 'Room 4' } }), {
    title: '', start: null, end: null, location: 'Room 4', organizer: null, url: '', conferenceUrl: '',
  }, 'one real field is enough to keep the event');
}

// The event rides on every note, from the list response as well as the
// detail one — the Activity page never fetches notes in full.
{
  const out = normalizeNote({
    id: 'not_cal',
    title: 'Acme — quarterly review',
    calendar_event: {
      title: 'Acme quarterly review',
      start_time: '2026-08-05T14:00:00Z',
      end_time: '2026-08-05T14:45:00Z',
      conference_url: 'https://teams.example/join/1',
    },
  });
  eq(out.calendarEvent.title, 'Acme quarterly review', 'the event is on a list-only note');
  eq(out.calendarEvent.conferenceUrl, 'https://teams.example/join/1', 'the join link is kept');
  eq(out.name, 'Acme — quarterly review', 'the note title still wins for the record name');
  eq(normalizeNote({ id: 'not_plain', title: 'No meeting' }).calendarEvent, null, 'a note with no meeting carries no event');
}

// --- describeListShape: why a sync imported nothing ----------------------
// A list request can come back 200 with nothing usable in it, and that
// used to be indistinguishable from "you have no calls". These are the
// two shapes that cause it, both live risks with an API this young.
{
  const rows = [{ id: 'not_a' }, { id: 'not_b' }];
  const shape = describeListShape({ data: rows, has_more: false }, rows, rows.map(n => normalizeNote(n)));
  eq(shape.rowsFrom, 'data', 'the key the notes came out of is named');
  eq(shape.rowCount, 2, 'the rows are counted');
  eq(shape.missingIds, 0, 'notes with ids report none missing');
  eq(shape.bodyKeys, ['data', 'has_more'], 'the reply\u2019s top-level keys are reported, never its contents');
}

// Notes under a key none of the spellings covers: rowsFrom is null, which
// is the case worth shouting about.
{
  const body = { documents: [{ id: 'not_a' }], total: 1 };
  const shape = describeListShape(body, [], []);
  eq(shape.rowsFrom, null, 'an unrecognised envelope reports no rows key');
  eq(shape.bodyKeys, ['documents', 'total'], 'and names what it did send, so the new key is visible');
  eq(shape.rowCount, 0, 'nothing was read out of it');
}

// The note id renamed: rows arrive, none can be keyed, all are dropped
// downstream. Counting them is what makes that audible.
{
  const rows = [{ uuid: 'x1', title: 'A' }, { uuid: 'x2', title: 'B' }];
  const shape = describeListShape({ data: rows }, rows, rows.map(n => normalizeNote(n)));
  eq(shape.rowCount, 2, 'the notes are still counted');
  eq(shape.missingIds, 2, 'and every one is flagged as unkeyable');
}

// A bare array of notes is a legitimate envelope too.
{
  const rows = [{ id: 'not_a' }];
  const shape = describeListShape(rows, rows, rows.map(n => normalizeNote(n)));
  eq(shape.rowsFrom, '(root array)', 'a root-level array names itself');
  eq(shape.bodyKeys, [], 'an array has no top-level keys to report');
}

// Never leak the payload: a wide reply is capped, and only names travel.
{
  const body = {};
  for (let i = 0; i < 20; i += 1) body[`k${i}`] = 'secret-value';
  const shape = describeListShape(body, [], []);
  eq(shape.bodyKeys.length, 12, 'the key list is capped');
  eq(shape.bodyKeys.includes('secret-value'), false, 'values never travel, only names');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

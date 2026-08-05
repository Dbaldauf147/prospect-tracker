// Assertion tests for the Call Recordings history table's mapping. Plain
// Node — no test framework (the project has none). Run:
//   node scripts/callHistory.test.mjs
//
// src/utils/callHistory.js imports only talkTime.js, which is itself
// pure, so the whole mapping runs here. What it decides — which calls
// appear, how far each one got, and who was on it — is the part that
// would quietly misreport someone's call history, so it is pinned rather
// than left to the table.
import {
  callHistoryRows, historyRowFromRecord, filterHistoryRows, historyTotals,
  callStage, externalAttendees, sourceLabel, STAGE_ORDER,
} from '../src/utils/callHistory.js';

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
    durationSeconds: 2700,
    company: 'Acme Corp',
    oppLabel: 'Acme Corp · Quoting · Lighting',
    owner: OWNER,
    attendees: [OWNER, { name: 'Dana Reid', email: 'dana@acme.com' }],
    granolaUrl: 'https://notes.granola.ai/d/not_1',
    ...overrides,
  };
}

// --- callStage: how far a call got --------------------------------------
// The states are cumulative in reality — a pushed call was summarised,
// which needed a transcript — so the check runs backwards from the end.
{
  eq(callStage({}), 'stored', 'a record with nothing on it is only stored');
  eq(callStage({ transcript: 'hello' }), 'transcribed', 'text alone is transcribed');
  eq(callStage({ utterances: [{ text: 'hi' }] }), 'transcribed', 'turns alone are transcribed too');
  eq(callStage({ transcript: 'hello', summary: 'a summary' }), 'summarized', 'a summary outranks the transcript');
  eq(callStage({ transcript: 'x', summary: 'y', pushedToOppAt: '2026-08-05T15:00:00Z' }), 'pushed',
    'a push outranks everything');
  // A push recorded without a summary still reads as pushed: the deal
  // has the text, whatever order the fields were written in.
  eq(callStage({ pushedToOppAt: '2026-08-05T15:00:00Z' }), 'pushed', 'a push with no stored summary is still pushed');
  eq(callStage({ transcript: '   ' }), 'stored', 'a whitespace-only transcript is not a transcript');
  eq(callStage({ summary: '' }), 'stored', 'an empty summary is not a summary');
}

// --- externalAttendees: who the call was WITH ---------------------------
{
  eq(externalAttendees(record()), [{ name: 'Dana Reid', email: 'dana@acme.com' }],
    'colleagues on the owner’s own domain are dropped');
  eq(externalAttendees(record({ owner: null })).length, 2,
    'with no owner every attendee is kept — the safe way round');
  eq(externalAttendees({}), [], 'a record with no attendees is an empty list');
  eq(externalAttendees(record({ attendees: [OWNER, { name: 'Sam', email: 'sam@se.com' }] })), [],
    'an all-internal call has nobody on the other side');
}

// --- historyRowFromRecord -----------------------------------------------
{
  const row = historyRowFromRecord(record({ transcript: 'You: hi', summary: 'Went well.' }));
  eq(row.name, 'Acme — quarterly review', 'the call name carries through');
  eq(row.sourceLabel, 'Granola', 'the source is labelled for the table and the export');
  eq(row.company, 'Acme Corp', 'the company tag carries through');
  eq(row.durationSeconds, 2700, 'duration stays in seconds, as the formatter expects');
  eq(row.recordedAtMs, Date.parse('2026-08-05T14:00:00.000Z'), 'the date is also given as an epoch, for sorting');
  eq(row.attendees, 'Dana Reid', 'the attendee line is the other side only');
  eq(row.stage, 'summarized', 'the pipeline stage is resolved');
  eq(row.stageRank, STAGE_ORDER.summarized, 'and ranked so the column sorts along the pipeline');
  eq(row.hasTranscript, true, 'a stored transcript is reported');
}

// A record still keeps its row when the source that made it is long gone
// — that disappearance is the whole reason this table exists.
{
  const row = historyRowFromRecord({
    id: 'onedrive:01ABC', source: 'onedrive', name: 'Dialer call', recordedAt: '2026-07-01T10:00:00Z',
    transcript: 'Some text', summary: 'Summarised', pushedToOppAt: '2026-07-01T12:00:00Z',
  });
  eq(row.sourceLabel, 'OneDrive', 'a OneDrive call is labelled as one');
  eq(row.stage, 'pushed', 'and keeps everything derived from it');
  eq(sourceLabel('local'), 'This computer', 'the local source reads as where the file is');
  eq(sourceLabel(''), 'Unknown', 'a record with no source says so rather than showing blank');
}

// A record with no id cannot be keyed to a row.
{
  eq(historyRowFromRecord({ source: 'granola', name: 'Orphan' }), null, 'a record with no id is dropped');
  eq(historyRowFromRecord(null), null, 'a missing record is dropped');
  eq(historyRowFromRecord({ id: 'x' }).name, 'Untitled call', 'a nameless call still gets a name');
}

// --- callHistoryRows: ordering ------------------------------------------
// Newest first, and an undated call sorts to the END rather than being
// dropped — hiding it would repeat the disappearance this table fixes.
{
  const rows = callHistoryRows({
    a: record({ id: 'a', recordedAt: '2026-08-01T10:00:00Z' }),
    b: record({ id: 'b', recordedAt: '2026-08-04T10:00:00Z' }),
    c: record({ id: 'c', recordedAt: null, name: 'Undated' }),
    d: record({ id: 'd', recordedAt: 'not a date', name: 'Also undated' }),
  });
  eq(rows.map(r => r.id), ['b', 'a', 'd', 'c'], 'newest first, undated calls last and named in order');
  eq(rows.length, 4, 'nothing is dropped for want of a date');

  // Every source, not just the active one: that is the point.
  const mixed = callHistoryRows([
    { id: 'g', source: 'granola', recordedAt: '2026-08-05T10:00:00Z' },
    { id: 'o', source: 'onedrive', recordedAt: '2026-08-06T10:00:00Z' },
    { id: 'l', source: 'local', recordedAt: '2026-08-07T10:00:00Z' },
  ]);
  eq(mixed.map(r => r.id), ['l', 'o', 'g'], 'all three sources share one history');
  eq(callHistoryRows(null), [], 'no records is an empty list, not a throw');
}

// --- filterHistoryRows ---------------------------------------------------
{
  const rows = callHistoryRows({
    a: record({ id: 'a', company: 'Acme Corp', name: 'Quarterly review' }),
    b: record({ id: 'b', company: 'Northwind', name: 'Intro call', attendees: [OWNER, { name: 'Lee Chan', email: 'lee@northwind.com' }] }),
    c: record({ id: 'c', company: '', name: 'Untagged chat', summary: 'Discussed solar procurement.' }),
  });
  eq(filterHistoryRows(rows, 'northwind').map(r => r.id), ['b'], 'a company matches');
  eq(filterHistoryRows(rows, 'lee chan').map(r => r.id), ['b'], 'an attendee name matches');
  eq(filterHistoryRows(rows, 'lee@northwind').map(r => r.id), ['b'], 'an attendee email matches');
  eq(filterHistoryRows(rows, 'solar').map(r => r.id), ['c'], 'the summary text matches');
  eq(filterHistoryRows(rows, 'GRANOLA').length, 3, 'the source label matches, case-insensitively');
  eq(filterHistoryRows(rows, '   ').length, 3, 'a blank search filters nothing');
  eq(filterHistoryRows(rows, 'nothing here').length, 0, 'a miss returns nothing');
  eq(filterHistoryRows(null, 'x'), [], 'no rows is not a throw');
}

// --- historyTotals -------------------------------------------------------
// Cumulative, not exclusive: a pushed call has been summarised, and a
// count saying otherwise would read as work still to do.
{
  const rows = callHistoryRows({
    a: record({ id: 'a', durationSeconds: 600 }),
    b: record({ id: 'b', durationSeconds: 300, transcript: 'text' }),
    c: record({ id: 'c', durationSeconds: 900, transcript: 'text', summary: 'sum' }),
    d: record({ id: 'd', durationSeconds: null, transcript: 'text', summary: 'sum', pushedToOppAt: '2026-08-05T15:00:00Z' }),
    e: record({ id: 'e', durationSeconds: 120, company: '' }),
  });
  const t = historyTotals(rows);
  eq(t.calls, 5, 'every row is counted');
  eq(t.transcribed, 3, 'transcribed counts anything with text');
  eq(t.summarized, 2, 'summarised includes the call that was pushed');
  eq(t.pushed, 1, 'pushed counts only what reached an opp');
  eq(t.withCompany, 4, 'the untagged call is excluded from the company count');
  eq(t.durationSeconds, 1920, 'durations add up, ignoring the one with none');
  eq(historyTotals([]).calls, 0, 'no rows totals to zero');
  eq(historyTotals(null).durationSeconds, 0, 'a missing list is not a throw');
}

// --- talk time ------------------------------------------------------------
// Derived from the stored turns, so it cannot go stale against the
// transcript. Null when the turns were dropped to fit Firestore — a flat
// transcript genuinely cannot answer who did the talking.
{
  const timed = historyRowFromRecord(record({
    transcript: 'x',
    utterances: [
      { speaker: 'You', text: 'a lot of talking here', start: 0, end: 6000 },
      { speaker: 'Dana Reid', text: 'brief', start: 6000, end: 8000 },
    ],
  }));
  eq(timed.talkBasis, 'time', 'timed turns measure time');
  eq(timed.youShare, 0.75, 'and the user’s share is the fraction of it');

  const untimed = historyRowFromRecord(record({
    transcript: 'x',
    utterances: [
      { speaker: 'You', text: 'one two three' },
      { speaker: 'Dana Reid', text: 'four' },
    ],
  }));
  eq(untimed.talkBasis, 'words', 'turns with no timings fall back to words');
  eq(untimed.youShare, 0.75, 'and report the word share');

  const flat = historyRowFromRecord(record({ transcript: 'plain text', utterances: [], utterancesDropped: true }));
  eq(flat.youShare, null, 'a transcript with no turns cannot say who talked');
  eq(flat.transcriptTrimmed, true, 'and says its turns were dropped, so the table can explain the gap');
  eq(flat.hasTranscript, true, 'while still counting as transcribed');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

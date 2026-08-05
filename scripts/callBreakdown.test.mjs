// Assertion tests for the per-call talk-time breakdown. Plain Node — no
// test framework (the project has none). Run:
//   node scripts/callBreakdown.test.mjs
//
// The rows here decide which calls a user can even ask "how much of that
// was me" about, and the average decides what they compare the answer
// with. The cases that matter most are the ones where a call must stay in
// the list while REFUSING to give a number, and the one where two
// different measurements must not be averaged together.
import {
  callBreakdownRows, breakdownRowFromRecord, filterBreakdownRows, breakdownAverages,
} from '../src/utils/callBreakdown.js';
import { talkTimeSides, talkTimeSplit, formatTalkValue } from '../src/utils/talkTime.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
function ok(value, name) { eq(!!value, true, name); }

// Turn timings are milliseconds, as api/granola-calls.js rebases them.
const turn = (speaker, startSec, endSec, text = 'some words here') => ({
  speaker, text, start: startSec * 1000, end: endSec * 1000,
});

const call = (over = {}) => ({
  id: 'c1',
  name: 'Discovery — Acme',
  source: 'granola',
  recordedAt: '2026-07-01T15:00:00.000Z',
  durationSeconds: 1800,
  company: 'Acme Corp',
  utterances: [turn('You', 0, 30), turn('Dana Reid', 30, 90)],
  ...over,
});

// --- the ordinary case ---------------------------------------------------
{
  const row = breakdownRowFromRecord(call());
  eq(row.measurable, true, 'a call with timed, labelled turns is measurable');
  eq(row.basis, 'time', 'timed turns are measured by time');
  eq(Math.round(row.youShare * 100), 33, 'the user’s share comes off the stored turns');
  eq(row.blocked, '', 'nothing blocks an ordinary call');
  eq(row.speakerCount, 2, 'both speakers are counted');
  eq(row.sourceLabel, 'Granola', 'the source reads as its label, not its key');
}

// --- calls that stay listed but cannot answer ----------------------------
// Each of these is a call the user may well be looking for. Dropping it
// would read as a call that never happened, so it stays — with the reason.
{
  const flat = breakdownRowFromRecord(call({ utterances: [], transcript: 'one block of text' }));
  eq(flat.measurable, false, 'a flat transcript is not measurable');
  eq(flat.blocked, 'no-turns', 'a transcript with no turns says so');
  ok(flat.blockedReason, 'the reason is spelled out, not left to the caller');

  const trimmed = breakdownRowFromRecord(call({
    utterances: [], transcript: 'a very long call', utterancesDropped: true,
  }));
  eq(trimmed.blocked, 'turns-dropped', 'turns dropped to fit the document are distinguished from never having any');

  const unnamed = breakdownRowFromRecord(call({
    utterances: [{ speaker: 'A', text: 'a b' }, { speaker: 'B', text: 'c' }],
  }));
  eq(unnamed.measurable, false, 'a call with no "You" turns cannot answer me-versus-them');
  eq(unnamed.blocked, 'you-unknown', 'an unattributable call says the turns were not attributed');
  eq(unnamed.youShare, null, 'and reports null rather than a misleading 0%');
  eq(unnamed.speakerCount, 2, 'its speakers are still counted — the split exists, the "You" does not');
  // Calls synced before the ingest read Granola's nested speaker object
  // all look like this, and re-reading the note is what fixes them.
  ok(unnamed.blockedReason.includes('Re-sync everything'),
    'a Granola call with no "You" turns points at the re-sync that can fix it');
  ok(!breakdownRowFromRecord(call({
    source: 'onedrive',
    utterances: [{ speaker: 'A', text: 'a b' }, { speaker: 'B', text: 'c' }],
  })).blockedReason.includes('Re-sync'),
    'a call from another source is not sent to a Granola button that cannot help it');

  const empty = breakdownRowFromRecord(call({
    utterances: [{ speaker: 'You', text: '' }], transcript: 'text',
  }));
  eq(empty.blocked, 'unmeasurable', 'turns with no text and no timings are unmeasurable, not missing');
}

// A call that was never transcribed is not in the list at all: there is
// nothing to divide, and it would be noise in a picker.
{
  eq(breakdownRowFromRecord(call({ utterances: [], transcript: '' })), null, 'an untranscribed call makes no row');
  eq(breakdownRowFromRecord({ name: 'no id' }), null, 'a record with no id makes no row');
  eq(breakdownRowFromRecord(null), null, 'a missing record makes no row');
}

// --- ordering -----------------------------------------------------------
{
  const rows = callBreakdownRows({
    a: call({ id: 'a', name: 'Older', recordedAt: '2026-06-01T10:00:00.000Z' }),
    b: call({ id: 'b', name: 'Newer', recordedAt: '2026-07-20T10:00:00.000Z' }),
    c: call({ id: 'c', name: 'Undated', recordedAt: null }),
    d: call({ id: 'd', name: 'No transcript', utterances: [], transcript: '' }),
  });
  eq(rows.map(r => r.name), ['Newer', 'Older', 'Undated'], 'newest first, undated last, untranscribed absent');
  eq(callBreakdownRows(null), [], 'no records is an empty list, not a crash');
  eq(callBreakdownRows([call()]).length, 1, 'an array of records works as well as a map');
}

// --- filtering ----------------------------------------------------------
{
  const rows = callBreakdownRows([
    call({ id: 'a', name: 'Discovery — Acme', company: 'Acme Corp' }),
    call({ id: 'b', name: 'Renewal', company: 'Globex', oppLabel: 'Globex — 2027 renewal' }),
  ]);
  eq(filterBreakdownRows(rows, 'globex').map(r => r.id), ['b'], 'the filter searches the company');
  eq(filterBreakdownRows(rows, 'renewal').map(r => r.id), ['b'], 'and the opportunity');
  eq(filterBreakdownRows(rows, '').length, 2, 'an empty query keeps everything');
  eq(filterBreakdownRows(rows, 'nothing here').length, 0, 'a query nothing matches returns nothing');
}

// --- attendees come from the other side only ----------------------------
{
  const row = breakdownRowFromRecord(call({
    owner: { email: 'me@myco.com' },
    attendees: [{ name: 'Me', email: 'me@myco.com' }, { name: 'Dana Reid', email: 'dana@acme.com' }],
  }));
  eq(row.attendees, 'Dana Reid', 'the user’s own domain is not listed as an attendee');
}

// --- the average --------------------------------------------------------
{
  const rows = callBreakdownRows([
    call({ id: 'a', utterances: [turn('You', 0, 50), turn('Dana Reid', 50, 100)] }),   // 50%
    call({ id: 'b', utterances: [turn('You', 0, 10), turn('Dana Reid', 10, 100)] }),   // 10%
    call({ id: 'c', utterances: [], transcript: 'flat' }),                             // not measurable
  ]);
  const avg = breakdownAverages(rows);
  eq(avg.calls, 3, 'every listed call is counted');
  eq(avg.measurable, 2, 'only the ones with a split are measurable');
  eq(Math.round(avg.avgYouShare * 100), 30, 'the average is the mean of the per-call shares');
  eq(avg.basis, 'time', 'the average says what it was measured in');
  eq(avg.averaged, 2, 'and how many calls went into it');
  eq(avg.otherBasis, 0, 'with nothing held out when every call agrees');
}

// Two measurements must never be averaged together: a words split
// overstates a fast talker, so mixing it into a time average would make
// the comparison a number about nothing.
{
  const rows = callBreakdownRows([
    call({ id: 'a', utterances: [turn('You', 0, 50), turn('Dana Reid', 50, 100)] }),  // 50%, time
    call({ id: 'b', utterances: [{ speaker: 'You', text: 'a b c d e f g h i' }, { speaker: 'Dana Reid', text: 'j' }] }), // 90%, words
  ]);
  const avg = breakdownAverages(rows);
  eq(avg.basis, 'time', 'time wins when any call carries it');
  eq(Math.round(avg.avgYouShare * 100), 50, 'the words-based call is not averaged into the time-based mean');
  eq(avg.otherBasis, 1, 'and the held-out call is reported, not silently dropped');

  const wordsOnly = breakdownAverages(callBreakdownRows([
    call({ id: 'b', utterances: [{ speaker: 'You', text: 'a b c' }, { speaker: 'Dana Reid', text: 'd' }] }),
  ]));
  eq(wordsOnly.basis, 'words', 'with no timed call anywhere, the average admits it is words');
  eq(Math.round(wordsOnly.avgYouShare * 100), 75, 'and is computed over the words-based calls');
}

{
  const none = breakdownAverages(callBreakdownRows([call({ utterances: [], transcript: 'flat' })]));
  eq(none.avgYouShare, null, 'with nothing measurable the average is null, not zero');
  eq(none.basis, '', 'and claims no basis');
  eq(breakdownAverages(null).calls, 0, 'no rows averages to nothing without crashing');
}

// --- talkTimeSides: the me-versus-them reduction -------------------------
{
  const sides = talkTimeSides(talkTimeSplit([
    turn('You', 0, 30), turn('Dana Reid', 30, 60), turn('Sam Okoro', 60, 90),
  ]));
  eq(Math.round(sides.you.share * 100), 33, 'the user keeps their own share');
  eq(Math.round(sides.others.share * 100), 67, 'everyone else is summed into one side');
  eq(sides.others.speakers, 2, 'the other side says how many people it is');
  ok(Math.abs(sides.you.share + sides.others.share - 1) < 1e-9, 'the two sides account for the whole call');
  eq(sides.you.turns, 1, 'turn counts travel with each side');
  eq(sides.others.turns, 2, 'and are summed across the other side');
}

// A call the user was alone on is 100/0 — that IS the honest answer, and
// "no one else spoke" is said by there being no other speakers.
{
  const sides = talkTimeSides(talkTimeSplit([turn('You', 0, 30), turn('You', 30, 60)]));
  eq(sides.you.share, 1, 'a monologue is 100% the user');
  eq(sides.others.share, 0, 'with nothing on the other side');
  eq(sides.others.speakers, 0, 'and no other speakers to name');
}

// No "You" anywhere: there is no me-versus-them to state.
{
  eq(talkTimeSides(talkTimeSplit([{ speaker: 'A', text: 'a b' }])), null, 'a split with no user side is null');
  eq(talkTimeSides(null), null, 'no split is null');
}

// --- per-speaker detail --------------------------------------------------
{
  const split = talkTimeSplit([turn('You', 0, 10), turn('Dana Reid', 10, 40), turn('You', 40, 50)]);
  const you = split.speakers.find(s => s.isYou);
  eq(you.turns, 2, 'a speaker’s turns are counted');
  eq(you.longest, 10000, 'and their longest single turn is kept');
  eq(split.speakers.find(s => !s.isYou).longest, 30000, 'the longest turn is per speaker, not per call');
}

// Only contributing turns count: a malformed turn is not evidence anyone
// spoke, so it must not inflate a turn count either.
{
  const split = talkTimeSplit([turn('You', 60, 30), turn('You', 0, 30), turn('Dana Reid', 30, 60)]);
  eq(split.speakers.find(s => s.isYou).turns, 1, 'a malformed turn is not counted as a turn');
}

// --- formatTalkValue -----------------------------------------------------
// The number must never be liftable out of its measurement: a clock is
// time, and words say so.
{
  eq(formatTalkValue(90000, 'time'), '1:30', 'time reads as a clock');
  eq(formatTalkValue(3661000, 'time'), '1:01:01', 'an hour-long share grows an hours field');
  eq(formatTalkValue(45000, 'time'), '0:45', 'under a minute keeps the leading zero');
  eq(formatTalkValue(42, 'words'), '42 words', 'words say the word');
  eq(formatTalkValue(1, 'words'), '1 word', 'one word is singular');
  eq(formatTalkValue(0, 'time'), '', 'nothing spoken formats as nothing');
  eq(formatTalkValue(null, 'time'), '', 'a missing value formats as nothing');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

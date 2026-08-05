// Assertion tests for the talk-time split. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/talkTime.test.mjs
//
// The split is a number a user will read as a fact about their own
// behaviour on a call, so the cases that matter most are the ones where
// it must REFUSE to answer: a transcript with no turns, turns with no
// timings, and turns nobody could attribute. Getting those wrong doesn't
// look like a bug, it looks like a quiet call.
import { talkTimeSplit, formatShare, describeTalkTime } from '../src/utils/talkTime.js';

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

// --- the ordinary case: timed turns split by time ----------------------
{
  const split = talkTimeSplit([
    turn('You', 0, 30),
    turn('Dana Reid', 30, 60),
    turn('You', 60, 90),
  ]);
  eq(split.basis, 'time', 'timed turns are measured by time');
  eq(split.total, 90000, 'the total is the summed turn durations in ms');
  eq(formatShare(split.youShare), '67%', 'two thirds of the talking is reported as 67%');
  eq(split.speakers.map(s => s.name), ['You', 'Dana Reid'], 'speakers are ordered by how much they talked');
  eq(split.speakers[0].isYou, true, 'the user’s own turns are flagged');
  eq(split.speakers[1].isYou, false, 'the other side is not');
  eq(describeTalkTime(split), 'You did 67%', 'the one-line description leads with the user');
}

// A call the other side ran. The number is the point of the feature, so
// it has to be right in the direction that is least flattering too.
{
  const split = talkTimeSplit([turn('You', 0, 10), turn('Dana Reid', 10, 100)]);
  eq(formatShare(split.youShare), '10%', 'a call the user barely spoke on reports 10%');
  eq(split.speakers[0].name, 'Dana Reid', 'the dominant speaker sorts first even when it is not the user');
}

// --- shares always account for the whole call --------------------------
{
  const split = talkTimeSplit([
    turn('You', 0, 20), turn('Dana Reid', 20, 50), turn('Sam Okoro', 50, 60),
  ]);
  const sum = split.speakers.reduce((t, s) => t + s.share, 0);
  ok(Math.abs(sum - 1) < 1e-9, 'shares sum to exactly the whole call');
  eq(split.speakers.length, 3, 'a three-way call keeps all three speakers');
}

// --- no timings: fall back to words, and SAY so ------------------------
// A words split is a different measurement. Reporting it as talk time
// would overstate whoever talks fast, so the basis travels with it.
{
  const split = talkTimeSplit([
    { speaker: 'You', text: 'one two three four' },
    { speaker: 'Dana Reid', text: 'five six' },
  ]);
  eq(split.basis, 'words', 'turns with no timings fall back to words');
  eq(split.total, 6, 'the total is a word count');
  eq(formatShare(split.youShare), '67%', 'the word split is computed the same way');
  eq(describeTalkTime(split), 'You did 67% of words (no timings)', 'the description admits it is not talk time');
}

// Partly-timed transcripts use words too: timing only some turns would
// silently under-count whichever speaker went untimed.
{
  const split = talkTimeSplit([
    turn('You', 0, 30),
    { speaker: 'Dana Reid', text: 'a b c' },
  ]);
  eq(split.basis, 'words', 'a transcript where only some turns are timed is measured by words');
}

// --- refusing to answer -------------------------------------------------
// Each of these is a case where a 0/0 bar would read as "nobody spoke"
// rather than "not known", which is the failure that matters.
{
  eq(talkTimeSplit([]), null, 'no turns is null, not an empty split');
  eq(talkTimeSplit(null), null, 'a missing turn list is null');
  eq(talkTimeSplit(undefined), null, 'an undefined turn list is null');
  eq(talkTimeSplit('not an array'), null, 'a non-array is null, not a crash');
  eq(talkTimeSplit([{ speaker: 'You', text: '' }]), null, 'turns with no text and no timings are null');
  eq(talkTimeSplit([{ speaker: 'You', text: '   ' }]), null, 'whitespace-only text counts as nothing said');
}

// Zero-length turns carry no time and no words: the call is unmeasurable
// rather than a 50/50 split between two silences.
{
  eq(talkTimeSplit([turn('You', 10, 10, ''), turn('Dana Reid', 10, 10, '')]), null, 'zero-length untexted turns are null');
}

// --- unattributable turns ------------------------------------------------
// "We could not tell which turns were yours" must never be rendered as
// "you said nothing" — they are different findings and only one is about
// the call.
{
  const split = talkTimeSplit([
    { speaker: '[object Object]', text: 'a b c d', },
    { speaker: 'Dana Reid', text: 'e f' },
  ]);
  eq(split.youShare, null, 'with no "You" turns the user share is null, not zero');
  eq(split.speakers[0].name, 'Speaker ?', 'a legacy stringified speaker is labelled, not printed raw');
  eq(describeTalkTime(split), 'Speaker ? did 67% of words (no timings)', 'the description falls back to the dominant speaker');

  const lettered = talkTimeSplit([{ speaker: 'A', text: 'a b' }, { speaker: 'B', text: 'c' }]);
  eq(lettered.speakers.map(s => s.name), ['Speaker A', 'Speaker B'], 'single-letter labels read as speakers, not initials');

  const unlabelled = talkTimeSplit([{ speaker: '', text: 'a b' }, { speaker: null, text: 'c' }]);
  eq(unlabelled.speakers.map(s => s.name), ['Speaker ?'], 'blank and null labels collapse into one unknown speaker');
}

// --- malformed timings ---------------------------------------------------
// A turn that ends before it starts is meaningless, not negative talk
// time — it must not pull a share below zero or above one.
{
  const split = talkTimeSplit([turn('You', 60, 30), turn('Dana Reid', 30, 60)]);
  ok(split.speakers.every(s => s.share >= 0 && s.share <= 1), 'no share escapes 0..1');
  eq(split.speakers.map(s => s.name), ['Dana Reid'], 'a speaker whose every turn is malformed drops out of the split');
  // Null, not 0%. The user demonstrably spoke — there is text on the
  // turn — so the honest answer is that their share is unmeasurable,
  // not that they said nothing.
  eq(split.youShare, null, 'an unmeasurable user share is null rather than a misleading 0%');
  eq(describeTalkTime(split), 'Dana Reid did 100%', 'the description reports the speaker it could measure');

  // A user with one broken turn and one good one still gets a share
  // from the good one, rather than being dropped for the bad.
  const partial = talkTimeSplit([turn('You', 60, 30), turn('You', 0, 30), turn('Dana Reid', 30, 60)]);
  eq(formatShare(partial.youShare), '50%', 'a good turn still counts alongside a malformed one');
}

// --- formatShare ---------------------------------------------------------
{
  eq(formatShare(0.5), '50%', 'a half is 50%');
  eq(formatShare(0), '0%', 'zero is 0%, not blank');
  eq(formatShare(1), '100%', 'all of it is 100%');
  eq(formatShare(0.666), '67%', 'shares round to whole points');
  eq(formatShare(null), '', 'no share formats as nothing');
  eq(formatShare(undefined), '', 'an undefined share formats as nothing');
  eq(describeTalkTime(null), '', 'no split describes as nothing');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

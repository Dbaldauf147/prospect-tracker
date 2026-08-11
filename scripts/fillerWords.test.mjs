// Assertion tests for the filler-word count. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/fillerWords.test.mjs
//
// The cases that matter are the ones where a word is NOT a filler: "I
// like the pricing", "so we scoped it", "the right meter". A counter that
// takes those gives a rep a number that goes up when they explain things
// clearly, which is worse than no number at all.
import {
  fillersInText, fillerUsage, fillerTotals, formatRate, describeAgainstAverage, MIN_RATE_WORDS,
} from '../src/utils/fillerWords.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
function ok(value, name) { eq(!!value, true, name); }

const labels = text => fillersInText(text).hits.map(h => h.label);
const count = text => fillersInText(text).hits.length;

// --- the unambiguous half -------------------------------------------------
{
  eq(labels('Um, so I think, uh, that works'), ['um', 'so (opener)', 'uh'],
    'hesitations and a sentence-opening "so" all count');
  eq(count('Ummm, uhh, errr, hmm'), 4, 'a drawn-out spelling is the same sound');
  eq(count('Uhm we can do that'), 1, '"uhm" is counted as the same hesitation as "um"');
  eq(count('Mhm, that tracks'), 0, '"mhm" is agreement, not hesitation — it is not counted');
}

// --- phrases beat their parts --------------------------------------------
{
  eq(labels('You know, I mean, it is kind of sort of ready'),
    ['you know', 'I mean', 'kind of', 'sort of'],
    'multi-word fillers are counted once each, not as their pieces');
  const use = fillersInText('You know you know you know');
  eq(use.hits.length, 3, 'a repeated phrase is counted every time it is said');
}

// --- the words that are only fillers in position -------------------------
// Each pair is the same word twice: once as padding, once as English.
{
  eq(count('So, tell me about the site'), 1, '"so" opening a sentence is a filler');
  eq(count('We scoped it so the meter fits'), 0, '"so" mid-sentence is a conjunction, not a filler');
  eq(count('It went fine. So where does that leave us?'), 1,
    'a new sentence inside one turn still counts as an opener');

  eq(count('Well, it depends on the load'), 1, '"well" opening a sentence is a filler');
  eq(count('The site performed well last year'), 0, '"well" as an adverb is not a filler');

  eq(count('That tracks, right?'), 1, '"right" as a tag question is a filler');
  eq(count('That is the right meter for it'), 0, '"right" as an adjective is not a filler');

  eq(count('We can, like, phase it in'), 1, '"like" as padding is a filler');
  eq(count('I like the pricing'), 0, '"like" as a verb is not a filler');
  eq(count('It sounds like the same contract'), 0, '"sounds like" is a comparison, not a filler');
  eq(count('We would like something like that'), 0, 'both ordinary uses of "like" are left alone');
  // Deliberate: "it was like a hundred sites" is padding and "it was like
  // the last deal" is a simile, and the rule cannot tell them apart. It
  // under-counts rather than handing the user a number to argue with.
  eq(count('It was like a hundred sites'), 0, '"like" after a be-verb is left alone, and under-counts');
}

// --- a turn, and a call ---------------------------------------------------
const turn = (speaker, text, startSec, endSec) => ({
  speaker, text, start: startSec * 1000, end: endSec * 1000,
});

{
  const use = fillerUsage([
    turn('You', 'Um, so, we can basically get that done, you know?', 0, 30),
    turn('Dana Reid', 'Um, uh, you know, like, sure — I mean, basically, right?', 30, 90),
    turn('You', 'Great. I will send the contract over today.', 90, 120),
  ]);
  eq(use.fillers, 4, 'only the user’s own turns are counted');
  eq(use.hesitations, 1, 'the hesitation half is separated out');
  eq(use.crutches, 3, 'the crutch half is separated out');
  eq(use.turns, 2, 'both of the user’s turns are counted, filler or not');
  eq(use.turnsHit, 1, 'only the turn that carried a filler is a hit');
  eq(use.words, 18, 'words are the user’s own words, not the whole transcript');
  eq(Math.round(use.per100Words), 22, 'the rate is fillers over the user’s own word count');
  eq(use.talkMs, 60000, 'talk time is the user’s own turns');
  eq(use.perMinute, 4, 'the per-minute rate divides by the time the user was talking');
  eq(use.byFiller[0].count, 1, 'no filler was used twice on this call');
  eq(use.moments.length, 1, 'the one turn with fillers is the one example');
  eq(use.moments[0].start, 0, 'a moment carries the turn’s start so it can be found');
  ok(use.moments[0].labels.includes('basically'), 'a moment names what was said');
}

// --- the cases that must refuse to answer --------------------------------
{
  eq(fillerUsage([]), null, 'no turns at all cannot be counted');
  eq(fillerUsage([turn('Dana Reid', 'Um, you know, sure', 0, 10)]), null,
    'a call with no turn attributed to the user returns null, not zero');
  eq(fillerUsage(null), null, 'a missing transcript is not a clean call');

  const clean = fillerUsage([turn('You', 'We can deliver that in June.', 0, 10)]);
  eq(clean.fillers, 0, 'a genuinely clean turn counts zero');
  eq(clean.per100Words, 0, 'zero fillers is a rate of zero, not null');
  eq(clean.moments.length, 0, 'a clean call has no moments to show');
}

// --- an untimed transcript still gives a rate ----------------------------
{
  const use = fillerUsage([
    { speaker: 'You', text: 'Um, you know, it depends' },
    { speaker: 'You', text: 'Basically yes', start: 0, end: 5000 },
  ]);
  eq(use.fillers, 3, 'fillers are counted whether or not the turns were timed');
  eq(use.perMinute, null, 'a partly-timed transcript gives no per-minute rate');
  eq(use.talkMs, null, 'talk time is withheld rather than under-counted');
}

// --- across calls ---------------------------------------------------------
{
  const row = (id, name, text, words) => ({
    id,
    name,
    fillers: fillerUsage([turn('You', text, 0, 60)]),
    words,
  });
  // 120 words with 12 fillers, and 120 words with 0 — the totals must be
  // 6 per 100, which averaging the two rates would also give. The third
  // call is the one that tells them apart: a short heavy call must not
  // drag the overall rate the way a per-call mean would let it.
  const heavy = `${'um '.repeat(12)}${'word '.repeat(108)}`;
  const clean = 'word '.repeat(120);
  const shortHeavy = 'um um um';

  const totals = fillerTotals([
    row('a', 'Heavy call', heavy),
    row('b', 'Clean call', clean),
    row('c', 'Quick check-in', shortHeavy),
  ]);
  eq(totals.measured, 3, 'every call with words in it is measured');
  eq(totals.fillers, 15, 'fillers sum across calls');
  eq(totals.words, 243, 'words sum across calls');
  eq(Math.round(totals.per100Words * 100) / 100, 6.17,
    'the overall rate comes off the summed counts, not a mean of per-call rates');
  eq(totals.byFiller[0].label, 'um', 'the most-used filler leads the list');
  eq(totals.byFiller[0].calls, 2, 'a filler says how many calls it turned up on');
  eq(totals.cleanest.name, 'Clean call', 'the cleanest long-enough call is named');
  eq(totals.worst.name, 'Heavy call', 'the heaviest long-enough call is named');
  eq(totals.shortCalls, 1, 'the short call is held out of the range, and counted');
  ok(row('c', 'Quick check-in', shortHeavy).fillers.words < MIN_RATE_WORDS,
    'the held-out call is held out for being short, not for being clean');
}

{
  const totals = fillerTotals([]);
  eq(totals.measured, 0, 'no calls measure nothing');
  eq(totals.per100Words, null, 'no words means no rate, rather than zero');
  eq(totals.cleanest, null, 'nothing is named cleanest out of nothing');
}

// --- how the numbers read -------------------------------------------------
{
  eq(formatRate(4.24), '4.2', 'a small rate keeps one decimal');
  eq(formatRate(12.4), '12', 'a big rate is a whole number — the decimal says nothing');
  eq(formatRate(0), '0.0', 'zero is a rate, and prints as one');
  eq(formatRate(null), '', 'no rate prints as nothing');

  eq(describeAgainstAverage(8, 4, 6), '100% above your average', 'a worse call says how much worse');
  eq(describeAgainstAverage(2, 4, 6), '50% below your average', 'a better call says how much better');
  eq(describeAgainstAverage(4.05, 4, 6), 'right on your average', 'a hair’s difference is no difference');
  eq(describeAgainstAverage(8, 4, 1), '',
    'one measured call has no average to be compared with — itself is not a comparison');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

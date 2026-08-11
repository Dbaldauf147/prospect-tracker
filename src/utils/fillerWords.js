// How often the user leans on a filler word.
//
// The talk-time split answers "did I run that meeting or did they". This
// answers the next question a rep asks about their own calls: "how much
// of what I said was um, you know, kind of, like". Nothing else on the
// page can answer it — scrolling a transcript for "um" tells you a call
// had some, not whether this call was worse than your usual.
//
// Only the user's OWN turns are counted. A filler count over the whole
// transcript would be a number about the room, and the prospect's habits
// are not something the rep can practise away.
//
// Everything here is pure: turns in, counts out. Derived on render from
// the turns already stored, so it costs nothing to keep and cannot go
// stale against the transcript it describes.
//
// A caveat the UI has to carry, because the number is only as good as the
// transcript under it: notetakers differ in how much they clean up. A
// transcript that silently drops "um" will read as a flawless call rather
// than an unmeasured one, so the counts are best used to compare YOUR
// calls with each other — all captured the same way — rather than against
// any published benchmark.

// The label the note owner's own turns carry (api/granola-calls.js
// resolves the owner to this).
const YOU = 'You';

// Words that are only fillers in the right position, and would be plain
// English in the wrong one. Each of these carries a test rather than
// living in the flat list below — counting every "so" or every "like"
// would produce a big number that says nothing about how the user talks.
//
//   "so"    — a discourse "so" opens a sentence ("So, tell me about…").
//             Mid-sentence it is a real conjunction ("so we scoped it").
//   "well"  — same shape: "Well, it depends" versus "it went well".
//   "right" — a filler as a tag question ("that tracks, right?"), a real
//             word everywhere else ("the right meter").
//   "like"  — the hardest one. A verb or a preposition after most of the
//             words below, a filler after almost nothing else.
//
// "like" errs deliberately towards under-counting. "It was like a hundred
// sites" is padding and "it was like the last deal" is a simile, and no
// word list can tell those apart — so everything after a be-verb is left
// alone. A count that stays low but is never wrong is worth more here
// than a bigger one the user can argue with.
const LIKE_NOT_AFTER = new Set([
  // verb uses: "I like", "we'd like", "they liked"
  'i', 'we', 'you', 'they', 'he', 'she', 'it', 'who', 'would', 'wouldn’t', "wouldn't",
  'd', 'do', 'don’t', "don't", 'did', 'didn’t', "didn't", 'does', 'doesn’t', "doesn't",
  'really', 'also', 'both', 'all',
  // comparison uses: "looks like", "something like that", "just like"
  'look', 'looks', 'looked', 'looking', 'sound', 'sounds', 'sounded', 'feel', 'feels',
  'felt', 'seem', 'seems', 'seemed', 'act', 'acts', 'acted', 'read', 'reads',
  'something', 'anything', 'nothing', 'somebody', 'someone', 'anyone', 'everyone',
  'stuff', 'thing', 'things', 'others', 'people', 'places', 'ones', 'exactly',
  'just', 'much', 'more', 'less', 'nowhere', 'anywhere', 'somewhere', 'is', 'was',
  'are', 'were', 'be', 'been', 'being',
]);

/**
 * The fillers this counts, in the order they are tried.
 *
 * Phrases come before single words so "kind of" is one filler and not a
 * stray "of", and so the longest reading of a run of tokens wins.
 *
 * `kind` splits the list in two because the two halves mean different
 * things to someone trying to improve:
 *
 *   hesitation — "um", "uh", "er", "hmm". Unambiguous, and the ones a
 *     speaker can hear themselves doing once they know the count.
 *   crutch — "you know", "I mean", "basically", "like". Real words used
 *     as padding. Judgement is involved in every one of them, which is
 *     why they are labelled rather than folded into a single total.
 */
export const FILLERS = [
  // --- phrases ---------------------------------------------------------
  { id: 'you-know', label: 'you know', kind: 'crutch', phrase: ['you', 'know'] },
  { id: 'i-mean', label: 'I mean', kind: 'crutch', phrase: ['i', 'mean'] },
  { id: 'kind-of', label: 'kind of', kind: 'crutch', phrase: ['kind', 'of'] },
  { id: 'sort-of', label: 'sort of', kind: 'crutch', phrase: ['sort', 'of'] },

  // --- hesitation sounds ------------------------------------------------
  // Spelling is not settled across transcription services — "um", "umm",
  // "uhm" are the same sound — so each matches its family.
  { id: 'um', label: 'um', kind: 'hesitation', match: w => /^u+h?m+$/.test(w) },
  { id: 'uh', label: 'uh', kind: 'hesitation', match: w => /^u+h+$/.test(w) },
  { id: 'er', label: 'er', kind: 'hesitation', match: w => /^e+r+m?$/.test(w) },
  // "hm/hmm" only. "mhm" is agreement, not hesitation, and belongs to the
  // listener rather than the speaker.
  { id: 'hmm', label: 'hmm', kind: 'hesitation', match: w => /^h+m+$/.test(w) },

  // --- single-word crutches --------------------------------------------
  { id: 'kinda', label: 'kinda', kind: 'crutch', match: w => w === 'kinda' },
  { id: 'sorta', label: 'sorta', kind: 'crutch', match: w => w === 'sorta' },
  { id: 'basically', label: 'basically', kind: 'crutch', match: w => w === 'basically' },
  { id: 'actually', label: 'actually', kind: 'crutch', match: w => w === 'actually' },
  { id: 'literally', label: 'literally', kind: 'crutch', match: w => w === 'literally' },
  { id: 'honestly', label: 'honestly', kind: 'crutch', match: w => w === 'honestly' },
  { id: 'obviously', label: 'obviously', kind: 'crutch', match: w => w === 'obviously' },

  // --- the position-dependent ones -------------------------------------
  {
    id: 'like', label: 'like', kind: 'crutch',
    match: (w, ctx) => w === 'like' && !LIKE_NOT_AFTER.has(ctx.prev),
  },
  {
    id: 'so-opener', label: 'so (opener)', kind: 'crutch',
    match: (w, ctx) => w === 'so' && ctx.opening,
  },
  {
    id: 'well-opener', label: 'well (opener)', kind: 'crutch',
    match: (w, ctx) => w === 'well' && ctx.opening,
  },
  {
    id: 'right-tag', label: 'right?', kind: 'crutch',
    match: (w, ctx) => w === 'right' && ctx.isQuestion,
  },
];

const SENTENCE_END = /[.!?…]["'’)\]]*$/;
const QUESTION_END = /\?["'’)\]]*$/;

/**
 * A turn's text as tokens, each carrying the punctuation context the
 * position-dependent rules need.
 *
 * Punctuation is kept as a property of the token it followed rather than
 * as tokens of its own, so "right?" can be told from "right" without the
 * word list having to know about punctuation at all.
 */
function tokenize(text) {
  const chunks = String(text || '').trim().split(/\s+/).filter(Boolean);
  const tokens = [];
  let startsSentence = true;
  for (const raw of chunks) {
    const word = raw.toLowerCase().replace(/[^a-z0-9’']+/g, '');
    if (!word) {
      // Stray punctuation ("—", "...") still closes a sentence.
      if (SENTENCE_END.test(raw)) startsSentence = true;
      continue;
    }
    tokens.push({ word, startsSentence, isQuestion: QUESTION_END.test(raw) });
    startsSentence = SENTENCE_END.test(raw);
  }
  return tokens;
}

const PHRASES = FILLERS.filter(f => f.phrase);
const SINGLES = FILLERS.filter(f => f.match);

/**
 * Every filler in one turn, left to right.
 *
 * Returns `{ words, hits: [{ id, label, kind }] }`. Tokens consumed by a
 * phrase are not offered to the single-word rules, so "kind of" is one
 * filler rather than two.
 */
export function fillersInText(text) {
  const tokens = tokenize(text);
  const hits = [];
  // Still at the head of a sentence: true at the start, and STAYS true
  // through anything that was itself a filler. "Um, so tell me…" opens
  // with a discourse "so" as much as "So tell me…" does — a hesitation in
  // front of it doesn't turn it into a conjunction. The first word of
  // real content ends it.
  let opening = true;
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i].startsSentence) opening = true;

    const phrase = PHRASES.find(f => f.phrase.every((w, n) => tokens[i + n]?.word === w));
    if (phrase) {
      hits.push({ id: phrase.id, label: phrase.label, kind: phrase.kind });
      i += phrase.phrase.length;
      continue;
    }
    const ctx = {
      prev: tokens[i - 1]?.word || '',
      next: tokens[i + 1]?.word || '',
      opening,
      isQuestion: tokens[i].isQuestion,
    };
    const single = SINGLES.find(f => f.match(tokens[i].word, ctx));
    if (single) hits.push({ id: single.id, label: single.label, kind: single.kind });
    else opening = false;
    i += 1;
  }
  return { words: tokens.length, hits };
}

// Turns carry start/end in MILLISECONDS (api/granola-calls.js rebases
// them through toMillis), same as talkTime.js reads them.
function durationMsOf(utterance) {
  const start = Number(utterance?.start);
  const end = Number(utterance?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const ms = end - start;
  return ms > 0 ? ms : 0;
}

function speakerName(label) {
  return (label && typeof label === 'object') ? '' : String(label ?? '').trim();
}

// A turn quoted back as an example is evidence, not the transcript: long
// enough to hear yourself in, short enough to scan a handful of them.
const MOMENT_CHARS = 180;
const MAX_MOMENTS = 5;

function excerpt(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > MOMENT_CHARS ? `${s.slice(0, MOMENT_CHARS - 1).trimEnd()}…` : s;
}

/**
 * How much of what the user said was filler.
 *
 * Returns null when the question cannot be asked of this transcript — no
 * turns at all, or no turn attributed to the user. Null rather than a
 * zero: "you never said um" and "we could not tell which words were
 * yours" are different findings, and only one of them is about the call.
 *
 *   {
 *     fillers,            // how many, in the user's own turns
 *     words,              // words the user spoke
 *     turns, turnsHit,    // turns they took, and how many carried a filler
 *     per100Words,        // the comparable rate
 *     talkMs, perMinute,  // null unless every one of their turns was timed
 *     hesitations, crutches,
 *     byFiller: [{ id, label, kind, count, share }],   // most-used first
 *     moments:  [{ start, count, labels, text }],      // worst turns first
 *   }
 */
export function fillerUsage(utterances, options = {}) {
  const you = options.speaker || YOU;
  const list = Array.isArray(utterances) ? utterances : [];
  const mine = list.filter(u => u && speakerName(u.speaker) === you);
  if (mine.length === 0) return null;

  const byId = new Map();
  const moments = [];
  let fillers = 0, words = 0, turnsHit = 0, hesitations = 0, crutches = 0;
  let talkMs = 0, timed = true;

  mine.forEach(u => {
    const { words: turnWords, hits } = fillersInText(u.text);
    words += turnWords;

    const ms = durationMsOf(u);
    if (ms === null) timed = false;
    else talkMs += ms;

    if (hits.length === 0) return;
    turnsHit += 1;
    fillers += hits.length;
    hits.forEach(hit => {
      if (hit.kind === 'hesitation') hesitations += 1; else crutches += 1;
      const prev = byId.get(hit.id) || { ...hit, count: 0 };
      byId.set(hit.id, { ...prev, count: prev.count + 1 });
    });
    moments.push({
      start: Number.isFinite(Number(u.start)) ? Number(u.start) : null,
      count: hits.length,
      // Deduped: a turn with four "you know"s is one habit worth naming
      // once, not a label repeated four times.
      labels: [...new Set(hits.map(h => h.label))],
      text: excerpt(u.text),
    });
  });

  return {
    fillers,
    words,
    turns: mine.length,
    turnsHit,
    // Per 100 words is the rate that survives a comparison: calls differ
    // in length, and a raw count mostly measures how long the rep talked.
    per100Words: words > 0 ? (fillers / words) * 100 : null,
    talkMs: timed && talkMs > 0 ? talkMs : null,
    perMinute: timed && talkMs > 0 ? fillers / (talkMs / 60000) : null,
    hesitations,
    crutches,
    byFiller: [...byId.values()]
      .map(f => ({ ...f, share: fillers > 0 ? f.count / fillers : 0 }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    moments: moments
      .sort((a, b) => b.count - a.count || (a.start ?? 0) - (b.start ?? 0))
      .slice(0, MAX_MOMENTS),
  };
}

// A call too short to have a rate worth ranking. Ten words of "sounds
// good, talk Tuesday" with one "so" in them is a 10-per-100 call, which
// would top any list it was allowed into.
export const MIN_RATE_WORDS = 100;

/**
 * The same question asked of every call at once.
 *
 * Rates are computed from the summed counts, NOT averaged across calls —
 * a mean of per-call rates would let a two-minute call weigh as much as
 * an hour, and the user's habit is a property of how they talk, not of
 * how many calls each length they had.
 *
 *   {
 *     calls, measured,      // calls in the list, and calls with a usable count
 *     fillers, words, turns,
 *     per100Words, perMinute,
 *     hesitations, crutches,
 *     byFiller: [{ id, label, kind, count, share, calls }],
 *     cleanest, worst,      // { id, name, per100Words } over long-enough calls
 *     shortCalls,           // calls held out of cleanest/worst as too short
 *   }
 */
export function fillerTotals(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const measured = list.filter(r => r?.fillers && r.fillers.words > 0);

  const byId = new Map();
  let fillers = 0, words = 0, turns = 0, hesitations = 0, crutches = 0;
  let talkMs = 0, timed = measured.length > 0;

  measured.forEach(row => {
    const use = row.fillers;
    fillers += use.fillers;
    words += use.words;
    turns += use.turns;
    hesitations += use.hesitations;
    crutches += use.crutches;
    if (use.talkMs == null) timed = false;
    else talkMs += use.talkMs;
    use.byFiller.forEach(f => {
      const prev = byId.get(f.id) || { id: f.id, label: f.label, kind: f.kind, count: 0, calls: 0 };
      byId.set(f.id, { ...prev, count: prev.count + f.count, calls: prev.calls + 1 });
    });
  });

  const rankable = measured.filter(r => r.fillers.words >= MIN_RATE_WORDS);
  const ranked = rankable
    .map(r => ({ id: r.id, name: r.name, per100Words: r.fillers.per100Words }))
    .sort((a, b) => a.per100Words - b.per100Words);

  return {
    calls: list.length,
    measured: measured.length,
    fillers,
    words,
    turns,
    per100Words: words > 0 ? (fillers / words) * 100 : null,
    talkMs: timed && talkMs > 0 ? talkMs : null,
    perMinute: timed && talkMs > 0 ? fillers / (talkMs / 60000) : null,
    hesitations,
    crutches,
    byFiller: [...byId.values()]
      .map(f => ({ ...f, share: fillers > 0 ? f.count / fillers : 0 }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    cleanest: ranked[0] || null,
    worst: ranked.length > 1 ? ranked[ranked.length - 1] : null,
    shortCalls: measured.length - rankable.length,
  };
}

/** "4.2", "12", "0.4" — a rate, at the precision it is worth reading. */
export function formatRate(rate) {
  if (rate == null || !Number.isFinite(rate)) return '';
  if (rate >= 10) return String(Math.round(rate));
  return (Math.round(rate * 10) / 10).toFixed(1);
}

/**
 * This call against the user's own average, as a phrase.
 *
 * Silent when there is nothing honest to compare with: one measured call
 * is its own average, and "in line with your average" would be a finding
 * about a comparison that never happened.
 */
export function describeAgainstAverage(callRate, averageRate, measuredCalls) {
  if (callRate == null || averageRate == null || measuredCalls < 2) return '';
  if (averageRate <= 0) return '';
  const diff = callRate - averageRate;
  // Within a tenth of a filler per 100 words is the same call twice over.
  if (Math.abs(diff) < 0.1) return 'right on your average';
  const pct = Math.round(Math.abs(diff / averageRate) * 100);
  const much = pct >= 10 ? `${pct}% ` : '';
  return diff > 0 ? `${much}above your average` : `${much}below your average`;
}

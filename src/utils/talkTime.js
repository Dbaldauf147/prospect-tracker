// Who did the talking on a call.
//
// The transcript already labels every turn — Granola names its speakers,
// and api/granola-calls.js resolves the note's owner to "You" so the
// user's own turns are identifiable without hard-coding a name. What
// nothing did until now is add them up. Turn labels answer "who said
// this line"; a rep reviewing their own call wants "did I run that
// meeting or did they", which is a different question and one you cannot
// answer by scrolling.
//
// Everything here is pure: utterances in, a split out. No React, no
// fetch, no storage — the split is derived on render from the turns
// already stored, so it costs nothing to keep and cannot go stale
// against the transcript it describes.

// Turns carry start/end in MILLISECONDS (api/granola-calls.js rebases
// them through toMillis). A turn missing either end contributes no time.
function durationMsOf(utterance) {
  const start = Number(utterance?.start);
  const end = Number(utterance?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const ms = end - start;
  // Rebased timings can land out of order on a malformed transcript.
  // A negative turn is meaningless, not negative talk time.
  return ms > 0 ? ms : 0;
}

function wordsOf(utterance) {
  const text = String(utterance?.text || '').trim();
  return text ? text.split(/\s+/).length : 0;
}

// The label api/granola-calls.js gives the note owner's own turns.
const YOU = 'You';

// What a turn from a speaker we cannot name looks like once it has been
// stored. Kept out of the "you" bucket — an unattributed turn is not
// evidence the user was talking.
function displaySpeaker(label) {
  const s = (label && typeof label === 'object') ? '' : String(label ?? '').trim();
  if (!s || s === '[object Object]') return 'Speaker ?';
  return /^[A-Za-z0-9]$/.test(s) ? `Speaker ${s}` : s;
}

/**
 * How the call's talking divided up.
 *
 * Returns null when there is nothing to divide — no turns at all, or
 * turns with no text and no timings. Null rather than an empty split on
 * purpose: a transcript stored as flat text (or one whose turns were
 * dropped to fit Firestore) genuinely cannot answer this, and showing a
 * 0/0 bar would read as "nobody spoke" rather than "not known".
 *
 * `basis` is 'time' when the turns carried timings and 'words' when they
 * did not. Callers MUST surface which — a words-based split is a
 * different measurement, and presenting it as talk time would overstate
 * a speaker who talks fast and says little.
 *
 *   {
 *     basis: 'time' | 'words',
 *     total: number,                 // ms, or words
 *     youShare: number | null,       // 0..1, null when nobody is labelled "You"
 *     speakers: [{ name, value, share, isYou }],   // largest first
 *   }
 */
export function talkTimeSplit(utterances) {
  const turns = Array.isArray(utterances) ? utterances.filter(u => u && (u.text || u.start != null)) : [];
  if (turns.length === 0) return null;

  // Time is the honest measure and is preferred whenever the transcript
  // carries it. A transcript where SOME turns are timed and others are
  // not would silently under-count the untimed speaker, so time is only
  // used when every turn that has text also has a duration.
  const durations = turns.map(durationMsOf);
  const timed = durations.every(d => d !== null) && durations.some(d => d > 0);
  const basis = timed ? 'time' : 'words';
  const valueOf = (u, i) => (timed ? durations[i] : wordsOf(u));

  const byName = new Map();
  let total = 0;
  turns.forEach((u, i) => {
    const value = valueOf(u, i);
    if (!Number.isFinite(value) || value <= 0) return;
    const name = displaySpeaker(u.speaker);
    byName.set(name, (byName.get(name) || 0) + value);
    total += value;
  });

  if (total <= 0) return null;

  const speakers = [...byName.entries()]
    .map(([name, value]) => ({
      name,
      value,
      share: value / total,
      isYou: name === YOU,
    }))
    .sort((a, b) => b.value - a.value);

  const you = speakers.find(s => s.isYou);
  return {
    basis,
    total,
    // Null, not 0, when no turn is attributed to the user: "you said
    // nothing" and "we could not tell which turns were yours" are
    // different findings and only one of them is about the call.
    youShare: you ? you.share : null,
    speakers,
  };
}

/** "62%" — shares are only ever shown to whole percentage points. */
export function formatShare(share) {
  if (share == null || !Number.isFinite(share)) return '';
  return `${Math.round(share * 100)}%`;
}

/**
 * The split as one line, for the card header.
 *
 * Says the basis when it is words, and stays silent about it when it is
 * time — "talked" already means time to a reader, so only the departure
 * from that needs calling out.
 */
export function describeTalkTime(split) {
  if (!split) return '';
  const suffix = split.basis === 'words' ? ' of words (no timings)' : '';
  if (split.youShare == null) {
    const top = split.speakers[0];
    return top ? `${top.name} did ${formatShare(top.share)}${suffix}` : '';
  }
  return `You did ${formatShare(split.youShare)}${suffix}`;
}

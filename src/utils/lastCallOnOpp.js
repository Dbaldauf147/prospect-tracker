// The most recent call mapped to an opportunity, stamped onto the opp
// itself.
//
// The Notes popup on Opps 2 is where a rep reads what to do next, and
// since a tagged call's follow-ups land there, the obvious next question
// is "which call put these here, and when did we last speak?".
//
// It is stamped rather than looked up. The alternative — Opps 2 reading
// the call collection and indexing it by opp — means pulling every
// stored call, transcripts and all, into a page that wants four short
// fields; the records run to hundreds of kilobytes each. The tag and the
// push already write to the opp, so the reference rides along on a write
// that was happening anyway, costs nothing to read, and is there on any
// device that syncs the opp.
//
// Everything here is pure: records in, a patch out.

// Enough of the call's own summary to recognise the conversation,
// without turning an opp row into a second copy of it. The full summary
// is in the opp's Memo field for anyone who wants it.
const GIST_CHARS = 300;

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function msOf(value) {
  const t = new Date(value || 0).getTime();
  return Number.isFinite(t) && t > 0 ? t : null;
}

function gistOf(record) {
  const summary = textOf(record?.summary) || textOf(record?.granolaSummary);
  if (!summary) return '';
  // First paragraph only: the summariser's opening line is the gist, and
  // the rest is detail that belongs where the whole summary is.
  const first = summary.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim();
  return first.length > GIST_CHARS ? `${first.slice(0, GIST_CHARS - 1).trimEnd()}…` : first;
}

/** The fields an opp carries about the last call mapped to it. */
export const LAST_CALL_FIELDS = [
  '_lastCallId', '_lastCallAt', '_lastCallName', '_lastCallUrl', '_lastCallGist',
];

/**
 * A stored call record → the stamp an opp should carry for it.
 *
 * Null when the call can't identify itself — a record with no id is
 * nothing the popup could link back to, and a stamp that can't be
 * matched later is a stamp that can never be corrected or cleared.
 */
export function lastCallStamp(record) {
  const id = textOf(record?.id);
  if (!id) return null;
  return {
    _lastCallId: id,
    _lastCallAt: record?.recordedAt || null,
    _lastCallName: textOf(record?.name) || 'Untitled call',
    _lastCallUrl: textOf(record?.granolaUrl),
    _lastCallGist: gistOf(record),
  };
}

/**
 * Whether this stamp should replace what the opp already carries.
 *
 * The newest CALL wins, not the newest write. Tagging a January call
 * today doesn't make it the last conversation — calls are transcribed
 * and tagged long after they happened, and a batch of old ones tagged in
 * one sitting would otherwise leave the opp claiming the oldest of them
 * as the most recent.
 *
 * The same call always wins against itself, so re-pushing after a
 * re-summarise refreshes the gist rather than being ignored. And an
 * undated call only wins onto an opp that has no stamp at all: it can't
 * be shown to be newer, so it doesn't get to displace something that can.
 */
export function shouldReplaceLastCall(opp, stamp) {
  if (!stamp?._lastCallId) return false;
  const currentId = textOf(opp?._lastCallId);
  if (!currentId) return true;
  if (currentId === stamp._lastCallId) return true;
  const currentAt = msOf(opp?._lastCallAt);
  const nextAt = msOf(stamp._lastCallAt);
  if (nextAt == null) return false;
  if (currentAt == null) return true;
  return nextAt >= currentAt;
}

/**
 * The stamp merged into a patch, or the patch untouched.
 *
 * Callers hand in whatever else they were already writing, so the
 * reference lands in the same write as the notes it explains.
 */
export function withLastCallStamp(patch, opp, record) {
  const stamp = lastCallStamp(record);
  if (!stamp || !shouldReplaceLastCall(opp, stamp)) return patch;
  return { ...patch, ...stamp };
}

/**
 * The patch that takes the stamp back off, when the call it names is the
 * one being untagged.
 *
 * Empty when the opp's stamp is some other call — untagging one call
 * says nothing about a different one. Blanking rather than restoring the
 * call before it: nothing here knows what that was, and an opp quietly
 * showing an older call as its latest is a worse answer than showing
 * none. The next tag or push fills it back in.
 */
export function clearLastCallPatch(opp, recordingId) {
  const id = textOf(recordingId);
  if (!id || textOf(opp?._lastCallId) !== id) return null;
  return {
    _lastCallId: '',
    _lastCallAt: null,
    _lastCallName: '',
    _lastCallUrl: '',
    _lastCallGist: '',
  };
}

/**
 * The stamp as the popup reads it: null when the opp has never had a
 * call mapped to it, so the caller renders nothing rather than an empty
 * frame.
 */
export function lastCallOn(opp) {
  const id = textOf(opp?._lastCallId);
  const name = textOf(opp?._lastCallName);
  if (!id && !name) return null;
  return {
    id,
    name: name || 'Untitled call',
    at: opp?._lastCallAt || null,
    atMs: msOf(opp?._lastCallAt),
    url: textOf(opp?._lastCallUrl),
    gist: textOf(opp?._lastCallGist),
  };
}

/**
 * The stamps every already-mapped opp is missing, as one patch per opp.
 *
 * The live path stamps an opp when a call is mapped to it, which does
 * nothing for the calls mapped before it existed — the mapping is
 * already on the call record, so the opp is simply not carrying what it
 * could. This works out what those opps should say, from the records
 * that are already loaded, without asking Firestore for anything.
 *
 * The winner per opp is decided by the same `shouldReplaceLastCall`
 * rule the live path uses, so a backfill can only ever produce what
 * tagging those same calls in date order would have. Opps already
 * carrying the right (or a newer) stamp come back with no patch at all,
 * which is what makes running it twice a no-op.
 *
 *   records — stored call records (array, or the id-keyed map)
 *   opps    — the Opps 2 records
 *
 *   { patches: { [oppId]: patch }, opps, calls }
 *
 * `opps` counts the opps that would change; `calls` counts the mapped
 * calls those stamps came from, so a caller can say what it is about to
 * do before doing it.
 */
export function backfillLastCallPatches(records, opps) {
  const list = Array.isArray(records) ? records : Object.values(records || {});
  const byOpp = new Map();
  let calls = 0;

  for (const record of list) {
    const oppId = textOf(record?.oppId);
    const stamp = lastCallStamp(record);
    if (!oppId || !stamp) continue;
    calls += 1;
    const held = byOpp.get(oppId);
    // Reusing the replace rule with the running winner cast as an opp:
    // one definition of "which of these two calls is the later one",
    // used by the live path and by this.
    if (!held || shouldReplaceLastCall(held, stamp)) byOpp.set(oppId, stamp);
  }

  const patches = {};
  let changed = 0;
  for (const opp of (Array.isArray(opps) ? opps : [])) {
    const id = textOf(opp?._id);
    const stamp = id ? byOpp.get(id) : null;
    if (!stamp || !shouldReplaceLastCall(opp, stamp)) continue;
    // An opp already naming this exact call is not a change, even though
    // the rule says the same call wins against itself — that clause is
    // there so a re-summarise can refresh the gist, and a backfill that
    // rewrote every opp to what it already said would report work it
    // didn't do.
    if (textOf(opp._lastCallId) === stamp._lastCallId
      && textOf(opp._lastCallGist) === stamp._lastCallGist
      && textOf(opp._lastCallName) === stamp._lastCallName) continue;
    patches[id] = stamp;
    changed += 1;
  }

  return { patches, opps: changed, calls };
}

/**
 * "3 days ago", "today", "in 2 days" — how long before now the call was.
 *
 * Takes `now` so it can be tested without a clock, and so a list of opps
 * all measure against the same instant.
 */
export function describeCallAge(atMs, now) {
  if (!Number.isFinite(atMs) || !Number.isFinite(now)) return '';
  const days = Math.round((now - atMs) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days > 1) return `${days} days ago`;
  // A call dated ahead of now is a calendar entry that hasn't happened
  // or a clock that disagrees — said plainly rather than as "-3 days ago".
  return days === -1 ? 'tomorrow' : `in ${Math.abs(days)} days`;
}

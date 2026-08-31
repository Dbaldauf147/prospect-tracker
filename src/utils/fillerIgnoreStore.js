// The filler words the user has chosen to ignore, per account.
//
// The filler list in utils/fillerWords.js is one opinion about what counts
// as padding, and a rep is allowed to disagree with part of it — "I say
// actually because I mean actually". Without this they would have to
// mentally discount every filler KPI on the page, which is the same as
// having none.
//
// Stored as a plain array of filler ids in its own localStorage key,
// scoped per user like every other preference here. Ids are validated on
// read AND write against the current rule list, so a preference saved
// against a rule that has since been renamed stops hiding anything rather
// than hiding the wrong thing.
//
// This is a display preference, not a correction to the data: nothing
// here changes what was counted, only which counts are shown.

import { userLsGet, userLsSet } from './userLs';
import { registerMirroredKey, queueMirrorPush } from './localMirrorSync.js';
import { FILLER_IDS } from './fillerWords';

const KEY = 'filler-words-ignored';

// Fired when the ignored set changes — and the event the Firestore mirror
// dispatches when hydration pulls a newer copy down.
export const FILLER_IGNORED_EVENT = 'filler-words-ignored-changed';

// Mirrored: the words you have decided not to be told about again are a
// choice, and re-making it on a second machine is the same tedium as
// making it the first time.
registerMirroredKey(KEY, FILLER_IGNORED_EVENT);

const KNOWN = new Set(FILLER_IDS);

// Ordered by the filler list rather than by when the user clicked, so the
// ignored chips sit in the same order as the words they were ignored from.
function clean(ids) {
  const set = new Set((Array.isArray(ids) ? ids : []).filter(id => KNOWN.has(id)));
  return FILLER_IDS.filter(id => set.has(id));
}

export function loadIgnoredFillers() {
  try {
    const raw = userLsGet(KEY);
    return raw ? clean(JSON.parse(raw)) : [];
  } catch { return []; }
}

/** Persist the list. Returns what was actually stored. */
export function saveIgnoredFillers(ids) {
  const list = clean(ids);
  try {
    userLsSet(KEY, JSON.stringify(list));
    queueMirrorPush(KEY);
  } catch (err) {
    // A preference is not worth failing a render over — the toggle still
    // applies for this session, it just won't survive a reload.
    console.warn('Failed to save ignored filler words', err);
  }
  return list;
}

/** The list with one word ignored, or brought back if it already was. */
export function toggleIgnoredFiller(ids, id) {
  if (!KNOWN.has(id)) return clean(ids);
  const list = clean(ids);
  return list.includes(id) ? list.filter(x => x !== id) : clean([...list, id]);
}

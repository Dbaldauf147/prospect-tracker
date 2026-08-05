// A browser-local copy of the Call Recordings history.
//
// The history itself lives in Firestore — one document per call — and
// that is the record of truth. This is not a second one: it is the same
// rows, kept in IndexedDB so the History tab can draw itself the instant
// the page opens, before Firestore answers and whether or not it answers
// at all.
//
// That matters because the failure it covers is invisible otherwise. A
// read that fails comes back as no records, which renders identically to
// genuinely having no calls — so a network blip, an expired session or a
// slow cold start all read as "your call history is gone", and the only
// way back was to sync from Granola again. With a cache the page shows
// what it showed last time and says the read failed.
//
// Rows are trimmed of transcripts before they arrive here (see
// trimRowForCache), so a few years of calls costs a few hundred KB.

import { dbGet, dbPut, dbDelete } from './db';

const STORE = 'call-history';
const KEY = 'rows';

// A ceiling, not a target. Rows are ~1KB trimmed, so this is generous
// for any real call history while keeping a runaway write bounded.
const MAX_ROWS = 5000;

/** The last cached history, or null when there isn't one. */
export async function loadCallHistoryCache() {
  try {
    const cached = await dbGet(STORE, KEY);
    if (!cached || !Array.isArray(cached.rows)) return null;
    return { rows: cached.rows, savedAt: cached.savedAt || null };
  } catch (err) {
    console.warn('call history cache: read failed', err);
    return null;
  }
}

/** Replace the cached history. Returns false when the write didn't land. */
export async function saveCallHistoryCache(rows) {
  try {
    await dbPut(STORE, {
      rows: (rows || []).slice(0, MAX_ROWS),
      savedAt: new Date().toISOString(),
    }, KEY);
    return true;
  } catch (err) {
    // A cache that can't be written is a slower page, not a broken one:
    // Firestore is still the record of truth.
    console.warn('call history cache: write failed', err);
    return false;
  }
}

/** Forget the cached history — used when signing out of an account. */
export async function clearCallHistoryCache() {
  try {
    await dbDelete(STORE, KEY);
    return true;
  } catch {
    return false;
  }
}

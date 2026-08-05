// Persistence for the Call Recordings page.
//
// Everything the page derives from a recording — the transcript, the AI
// summary, and which company / opportunity it's tagged to — lives in
// Firestore at `callRecordings/{uid}/items/{docId}`, one document per
// recording. Same per-user scoping as opps2Data.
//
// The MEDIA never comes here. A recording is a file in the user's
// OneDrive or a folder on their PC; this store only ever holds text
// derived from it plus the tag. That's deliberate — the page's promise
// is "nothing is uploaded", and transcribing already streams the audio
// straight from Graph to the transcription service without touching our
// servers or our database.
//
// One document per recording rather than one blob for all of them: a
// two-hour call transcribes to ~100 KB of text and utterances, so a
// combined document would hit Firestore's 1 MB cap after a handful of
// calls. Per-recording documents also mean a save can't clobber a
// concurrent edit to a different recording.
//
// The record SHAPE — what fields a document has, how its id is derived,
// and how a summary is formatted for an opp's Notes — lives next door in
// callRecordShape.js, which imports no Firebase. That split is what lets
// scripts/pushGranolaRecap.mjs write a record from plain Node against the
// same definitions this page reads, instead of keeping a second copy that
// can drift. Those functions are re-exported here so callers keep
// importing them from the store.

import { collection, doc, getDoc, getDocs, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { docIdFor, emptyRecord, withinDocBudget } from './callRecordShape';

export {
  docIdFor, emptyRecord, oppLabel, summaryForOpp, mergeIntoNotes,
} from './callRecordShape';

const COLLECTION = 'callRecordings';
const ITEMS = 'items';

function itemsRef(userId) {
  return collection(db, COLLECTION, userId, ITEMS);
}

/**
 * Load every stored recording record for a user, keyed by recording id.
 * Returns {} rather than throwing when the read fails — the page must
 * still list and play recordings when Firestore is unreachable.
 */
export async function loadCallRecords(userId) {
  return (await loadCallRecordsResult(userId)).records;
}

/**
 * The same read, but saying whether it worked.
 *
 * `loadCallRecords` returns {} on failure, which renders identically to
 * genuinely having no calls — so an unreachable Firestore looked like an
 * empty call history, with nothing to act on. Callers that draw the
 * history need to tell those apart: one keeps the last known copy and
 * says the read failed, the other really is empty.
 *
 * Returns { records, ok, error, code }.
 *
 * `code` is Firestore's own error code ('permission-denied',
 * 'unavailable', …), carried separately from the message because it is
 * what decides whether a retry can work — see utils/callStoreError.js. The
 * message is prose and can be reworded; the code is a contract.
 */
export async function loadCallRecordsResult(userId) {
  if (!userId) return { records: {}, ok: false, error: 'Not signed in.', code: 'unauthenticated' };
  try {
    const snap = await getDocs(itemsRef(userId));
    const records = {};
    snap.forEach((d) => {
      const data = d.data();
      if (data?.id) records[data.id] = data;
    });
    return { records, ok: true, error: '', code: '' };
  } catch (err) {
    console.warn('callRecordings: load failed', err);
    return { records: {}, ok: false, error: err?.message || String(err), code: err?.code || '' };
  }
}

/**
 * Merge `patch` into the stored record for one recording and save it.
 * Returns the record as written (so callers can put it straight into
 * state), or null when the save failed.
 *
 * Callers that have to TELL the user a save failed want
 * `saveCallRecordResult` — a null here says only that something went
 * wrong, and a page that can't say what went wrong ends up saying
 * nothing at all, which is how a denied write came to look like a
 * successful one.
 */
export async function saveCallRecord(userId, recordingId, patch, base = null) {
  return (await saveCallRecordResult(userId, recordingId, patch, base)).record;
}

/**
 * The same write, but saying whether it worked and why it didn't.
 *
 * Returns { record, ok, error, code } — `record` is what was written, or
 * null on failure. `code` is Firestore's own error code, carried
 * separately from the message because it is what decides whether a retry
 * can work; see utils/callStoreError.js.
 *
 * `base` is the record already in page state. Passing it avoids a read
 * before every write; when it's absent the current document is fetched
 * so a partial patch can't blank out fields it doesn't mention.
 */
export async function saveCallRecordResult(userId, recordingId, patch, base = null) {
  if (!userId || !recordingId) {
    return { record: null, ok: false, error: 'Not signed in.', code: 'unauthenticated' };
  }
  const id = String(recordingId);
  const ref = doc(db, COLLECTION, userId, ITEMS, docIdFor(id));

  let current = base;
  if (!current) {
    try {
      const snap = await getDoc(ref);
      current = snap.exists() ? snap.data() : null;
    } catch {
      current = null;
    }
  }

  const now = new Date().toISOString();
  let next = {
    ...emptyRecord(id),
    ...(current || {}),
    ...patch,
    id,
    createdAt: current?.createdAt || now,
    updatedAt: now,
  };

  next = withinDocBudget(next);

  try {
    await setDoc(ref, next);
    return { record: next, ok: true, error: '', code: '' };
  } catch (err) {
    console.warn('callRecordings: save failed', err);
    return { record: null, ok: false, error: err?.message || String(err), code: err?.code || '' };
  }
}

/** Forget everything stored for one recording. */
export async function deleteCallRecord(userId, recordingId) {
  return (await deleteCallRecordResult(userId, recordingId)).ok;
}

/**
 * The same delete, saying whether it worked and why it didn't.
 *
 * Returns { ok, error, code }. A caller that drops the record from its
 * own state on a failed delete makes the call vanish from the page and
 * come back on the next refresh, so the ok matters as much as the delete.
 */
export async function deleteCallRecordResult(userId, recordingId) {
  if (!userId || !recordingId) {
    return { ok: false, error: 'Not signed in.', code: 'unauthenticated' };
  }
  try {
    await deleteDoc(doc(db, COLLECTION, userId, ITEMS, docIdFor(String(recordingId))));
    return { ok: true, error: '', code: '' };
  } catch (err) {
    console.warn('callRecordings: delete failed', err);
    return { ok: false, error: err?.message || String(err), code: err?.code || '' };
  }
}

/**
 * Migrate the company links that used to live in user settings
 * (`settings.callRecordingLinks`) into per-recording documents.
 *
 * Runs once per browser: the settings entry is the only record of those
 * links, so it is left in place rather than deleted — an older tab or a
 * second device still reading it keeps working, and re-running the
 * migration is a no-op because existing documents already carry the tag.
 * Returns the number of links migrated.
 */
export async function migrateSettingsLinks(userId, links, stored) {
  if (!userId || !links || typeof links !== 'object') return 0;
  let migrated = 0;
  for (const [recordingId, link] of Object.entries(links)) {
    if (!link?.prospectId) continue;
    // Already has a record with a tag on it — the migration has run, or
    // the user has since tagged it here.
    if (stored?.[recordingId]?.prospectId) continue;
    const saved = await saveCallRecord(
      userId,
      recordingId,
      {
        prospectId: link.prospectId,
        company: link.company || '',
        createdAt: link.linkedAt || null,
      },
      stored?.[recordingId] || null,
    );
    if (saved) migrated += 1;
  }
  return migrated;
}

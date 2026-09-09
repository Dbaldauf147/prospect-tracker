// Backfill for data that was already here when its backup started working.
//
// A store only writes its cloud copy when the user next SAVES. That is
// fine for a store that never had one — nothing was lost, and the next
// edit fixes it. It is not fine for the two that had a backup path all
// along that silently failed: listBackupSync and oppRfpTemplate split
// their payload across fields on one document, which Firestore rejects
// past 1 MB (see utils/chunkedDoc). Anything over that size was reported
// as saved and stored nowhere.
//
// Those files are sitting in IndexedDB right now. Nothing about fixing
// the writer goes back and uploads them: a CDP list loads from IndexedDB,
// hits, and returns without ever asking Firestore whether a copy exists.
// It would stay that way until the day the user happened to re-upload —
// which is the day they would not need the backup.
//
// So this walks what is stored locally, asks which of it the cloud is
// missing, and pushes only those. Reads are cheap and writes only happen
// where there is a hole; a browser with nothing to fix costs a handful of
// document reads once a day.

import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { db as firestore } from '../firebase';
import { ADMIN_EMAIL } from '../config/accessControl';
import { saveListBackup } from './listBackupSync';
import { userLsGet, userLsSet } from './userLs';

// One pass a day per browser. The holes this fills do not appear on their
// own — only an app version that could not write them creates one — so
// checking on every page load would be all cost.
//
// A pass that could NOT fill the holes it found is the exception, and it
// used to cost a whole day: the stamp was written before the work, so a
// pass that failed on every list looked exactly like one that had nothing
// to do. That is the wrong way round — a browser still holding the only
// copy of a list is precisely where a retry matters, and "come back
// tomorrow" is a long time to hold the only copy. So a pass that leaves
// holes behind is stamped for a short retry instead.
//
// The stamp is WHEN TO RUN NEXT rather than when the last pass ran, so the
// two intervals live in the same value. A leftover stamp from the old key
// is simply ignored, which makes the first load after this change run a
// pass — which is the point.
const NEXT_RUN_KEY = 'cloud-backup-repair:next-at';
const REPAIR_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RETRY_INTERVAL_MS = 30 * 60 * 1000;

const FILES_DB = 'prospect-tracker-files';
const LISTS_STORE = 'uploaded-lists';

// The two Utility Lookup tables share the uploaded-lists object store but
// are not lists, and they own their own Firestore copies. Their keys carry
// this marker.
const NOT_A_LIST = /__(utility-rates|zip-fallback)__$/;

function openExisting(dbName) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error(`IndexedDB "${dbName}" is blocked by another tab.`));
  });
}

function readAll(db, storeName) {
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(storeName)) { resolve([]); return; }
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const keysReq = store.getAllKeys();
    const valsReq = store.getAll();
    let keys, vals;
    const finish = () => resolve(keys.map((k, i) => ({ key: k, value: vals[i] })));
    keysReq.onsuccess = () => { keys = keysReq.result; if (vals !== undefined) finish(); };
    valsReq.onsuccess = () => { vals = valsReq.result; if (keys !== undefined) finish(); };
    keysReq.onerror = () => reject(keysReq.error);
    valsReq.onerror = () => reject(valsReq.error);
  });
}

// True when there is nothing usable at `ref`: no document, or one whose
// payload is empty. A document written by the old code and rejected for
// size left nothing behind at all, but a partial write is worth catching
// too — a parent that claims chunks with no chunks under it is a hole.
async function cloudCopyMissing(ref) {
  const snap = await getDoc(ref);
  if (!snap.exists()) return true;
  const data = snap.data() || {};
  const n = Number(data.chunkCount) || 0;
  if (n === 0) {
    // Either the current single-document layout, or the legacy inline
    // fields. Both are fine as long as something is actually there.
    return !(typeof data.json === 'string' && data.json) && typeof data.chunk0 !== 'string';
  }
  if (typeof data.chunk0 === 'string') return false;   // legacy inline layout
  const chunks = await getDocs(collection(ref, 'chunks'));
  return chunks.empty;
}

// The uploaded lists (CDP, GRESB, RECA, …). Shared collection, so only the
// admin may write it — everyone else would collect a permission error per
// list for no benefit.
async function repairUploadedLists(userId, email) {
  if (email !== ADMIN_EMAIL) return { fixed: 0, failed: 0 };
  let db;
  // Not being able to open the local database is a hole left unchecked,
  // not a clean pass: another tab mid-upgrade blocks it, and that clears.
  try { db = await openExisting(FILES_DB); }
  catch { return { fixed: 0, failed: 1 }; }
  let fixed = 0;
  let failed = 0;
  try {
    const rows = await readAll(db, LISTS_STORE);
    for (const { key, value } of rows) {
      const storageKey = typeof key === 'string' ? key : value?.key;
      if (!storageKey || NOT_A_LIST.test(storageKey)) continue;
      const data = value?.data;
      if (!Array.isArray(data) || data.length === 0) continue;
      try {
        if (!(await cloudCopyMissing(doc(firestore, 'listBackups', storageKey)))) continue;
        await saveListBackup(userId, storageKey, data);
        console.info(`Backed up "${storageKey}" (${data.length} rows) — it had no cloud copy.`);
        fixed++;
      } catch (err) {
        console.warn('List backup repair failed', storageKey, err);
        failed++;
      }
    }
  } finally {
    try { db.close(); } catch { /* already closed */ }
  }
  return { fixed, failed };
}

// The RFP workbooks attached to opps. Per-user, so this runs for everyone.
async function repairRfpTemplates(userId) {
  const [{ dbGetAllEntries }, { saveOppRfpTemplate }] = await Promise.all([
    import('./db.js'),
    import('./oppRfpTemplate.js'),
  ]);
  let rows;
  try { rows = await dbGetAllEntries('rfp-templates'); }
  catch { return { fixed: 0, failed: 1 }; }
  let fixed = 0;
  let failed = 0;
  for (const { key, value } of rows) {
    if (!value?.blob || !key) continue;
    try {
      if (!(await cloudCopyMissing(doc(firestore, 'oppRfpTemplates', String(userId), 'items', String(key))))) continue;
      await saveOppRfpTemplate(key, value.blob, value.fileName);
      console.info(`Backed up the RFP workbook on opp ${key} — it had no cloud copy.`);
      fixed++;
    } catch (err) {
      console.warn('RFP template backup repair failed', key, err);
      failed++;
    }
  }
  return { fixed, failed };
}

function scheduleNextRun(delayMs) {
  try { userLsSet(NEXT_RUN_KEY, String(Date.now() + delayMs)); } catch { /* quota */ }
}

/**
 * Push anything held locally that the cloud is missing. Safe to call on
 * every signin: it reads first and writes only where there is a hole, and
 * it does nothing at all if a clean pass already ran today.
 */
export async function repairCloudBackups(userId, email) {
  if (!userId) return 0;
  const nextAt = Number(userLsGet(NEXT_RUN_KEY)) || 0;
  if (nextAt && Date.now() < nextAt) return 0;
  // Claim the slot before any work, so two tabs opening together don't both
  // run the pass. Claiming it for the SHORT interval means a tab closed
  // mid-pass costs half an hour rather than a day.
  scheduleNextRun(RETRY_INTERVAL_MS);

  const results = await Promise.allSettled([
    repairUploadedLists(userId, email),
    repairRfpTemplates(userId),
  ]);
  let fixed = 0;
  let failed = 0;
  for (const r of results) {
    if (r.status === 'fulfilled') {
      fixed += r.value?.fixed || 0;
      failed += r.value?.failed || 0;
    } else {
      console.warn('cloud backup repair failed', r.reason);
      failed++;
    }
  }
  if (failed === 0) scheduleNextRun(REPAIR_INTERVAL_MS);
  else console.warn(`${failed} backup(s) could not be repaired; retrying in ${RETRY_INTERVAL_MS / 60000} minutes.`);
  return fixed;
}

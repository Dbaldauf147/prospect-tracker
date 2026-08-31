// Per-opp RFP template storage. The RFP button in the Follow Up Notes
// popup attaches the client's RFP workbook to a deal; its bytes land
// here keyed by oppId so the popup can hand it back later — download it,
// replace it with the next revision, or drop it.
//
// Two copies, for the same reason uploadedListStore keeps two:
//
//   * IndexedDB (`rfp-templates`) is the fast local copy every read hits
//     first. It holds a Blob natively, so the download path is a plain
//     createObjectURL with no re-encoding.
//   * Firestore (`oppRfpTemplates/<uid>/items/<oppId>`) is the backup
//     that makes the file cross-device. Bytes go through utils/chunkedDoc,
//     a chunk per document under the parent.
//
//     They used to go as base64 split across ~600 KB string FIELDS on one
//     document, copying listBackupSync — which does not work, because the
//     1 MB cap is on the document. Any workbook over about a megabyte
//     failed the write, and the failure was a console warning on a
//     best-effort path, so the file looked attached and had no backup.
//     Reads still understand that layout: whatever it holds is under a
//     megabyte, or it would never have been stored.
//
// A load that misses IDB but finds Firestore writes the blob back into
// IDB, so the restore happens once per device rather than per open.

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { dbGet, dbPut, dbDelete, getDbUserId } from './db';
import { deleteChunkedDoc, readChunkedDoc, writeChunkedDoc } from './chunkedDoc.js';

const STORE = 'rfp-templates';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// The standard template — the one RFP workbook that loads on every opp,
// as opposed to a file attached to a single deal. It's stored through the
// same path under a reserved key; opp ids are numbers, so nothing can
// collide with it.
export const STANDARD_RFP_KEY = '__standard__';

// Where the standard's summary line lives: the parent document of the
// items collection, which otherwise holds nothing. Reading it is what
// tells a second device that the standard has been replaced without
// downloading the workbook to find out — the bytes are only fetched when
// this says the local copy is behind.
function standardPointerDoc(userId) {
  return doc(db, 'oppRfpTemplates', String(userId));
}

// Ceiling on what gets mirrored to Firestore. An RFP workbook is a form to
// fill in, not a data dump — anything past this is almost certainly the
// wrong file, and writing it would cost a document per open. The local IDB
// copy is still saved, so an oversized file works on this device.
export const RFP_MAX_SYNC_BYTES = 15 * 1024 * 1024;

function itemDoc(userId, oppId) {
  return doc(db, 'oppRfpTemplates', String(userId), 'items', String(oppId));
}

function base64ToBlob(b64, type) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: type || XLSX_MIME });
}

// The legacy inline-chunk layout.
function unpackChunks(data) {
  const n = Number(data?.chunkCount) || 0;
  if (n === 0) return null;
  let b64 = '';
  for (let i = 0; i < n; i++) {
    const c = data[`chunk${i}`];
    if (typeof c !== 'string') return null;
    b64 += c;
  }
  try {
    return base64ToBlob(b64, data?.contentType);
  } catch {
    return null;
  }
}

// Light metadata for the record on the opp. The bytes live in the stores
// above; this is what tells the button there's something attached without
// waiting on an async read.
export function rfpTemplateMeta(rec) {
  if (!rec) return null;
  return {
    fileName: String(rec.fileName || 'rfp.xlsx'),
    sizeBytes: Number(rec.sizeBytes) || 0,
    savedAt: rec.savedAt || new Date().toISOString(),
  };
}

// Save the workbook against this opp. Returns the stored record. The
// Firestore mirror is best-effort: a rules failure or an offline browser
// must not lose the file the user just picked.
export async function saveOppRfpTemplate(oppId, blob, fileName) {
  if (oppId == null || !blob) return null;
  const rec = {
    blob: blob instanceof Blob ? blob : new Blob([blob], { type: XLSX_MIME }),
    fileName: String(fileName || 'rfp.xlsx'),
    sizeBytes: blob.size ?? blob.byteLength ?? 0,
    savedAt: new Date().toISOString(),
  };
  await dbPut(STORE, rec, String(oppId));

  const userId = getDbUserId();
  if (userId && rec.sizeBytes <= RFP_MAX_SYNC_BYTES) {
    try {
      await writeChunkedDoc(itemDoc(userId, oppId), rec, {
        meta: {
          fileName: rec.fileName,
          sizeBytes: rec.sizeBytes,
          contentType: rec.blob.type || XLSX_MIME,
          savedAt: rec.savedAt,
        },
      });
    } catch (err) {
      console.warn('RFP template Firestore backup failed', err);
    }
  }
  return rec;
}

// The record for this opp, or null. IDB first; Firestore on a miss, with
// the restored blob written back locally.
//
// `expectedSavedAt` is the stamp the caller believes is current — the one
// on the opp record, written wherever the file was last attached. A local
// copy that doesn't match it is a revision behind (attached on another
// machine since this one cached it), so it's re-fetched rather than served.
export async function loadOppRfpTemplate(oppId, expectedSavedAt) {
  if (oppId == null) return null;
  try {
    const rec = await dbGet(STORE, String(oppId));
    if (rec?.blob && (!expectedSavedAt || rec.savedAt === expectedSavedAt)) return rec;
  } catch { /* fall through to the backup */ }

  const userId = getDbUserId();
  if (!userId) return null;
  try {
    const ref = itemDoc(userId, oppId);
    const stored = await readChunkedDoc(ref);
    let rec = stored?.value?.blob ? stored.value : null;
    if (!rec) {
      // Nothing in the current layout — try the one the old code wrote.
      const snap = await getDoc(ref);
      if (!snap.exists()) return null;
      const data = snap.data();
      const blob = unpackChunks(data);
      if (!blob) return null;
      rec = {
        blob,
        fileName: String(data.fileName || 'rfp.xlsx'),
        sizeBytes: Number(data.sizeBytes) || blob.size,
        savedAt: data.savedAt || new Date().toISOString(),
      };
    }
    try { await dbPut(STORE, rec, String(oppId)); } catch { /* cache only */ }
    return rec;
  } catch (err) {
    console.warn('RFP template restore failed', err);
    return null;
  }
}

export async function deleteOppRfpTemplate(oppId) {
  if (oppId == null) return;
  try { await dbDelete(STORE, String(oppId)); } catch { /* best-effort */ }
  const userId = getDbUserId();
  if (!userId) return;
  try { await deleteChunkedDoc(itemDoc(userId, oppId)); } catch { /* best-effort */ }
}

// ---- The standard template -------------------------------------------
//
// One workbook for the whole pipeline: the RFP question sheet you send
// every client, offered for download on every opp. A deal that answers a
// client's own RFP still attaches that one to itself; the standard is what
// every other deal opens with.

// The summary line for the standard, or null. Cheap — it reads the pointer
// document, not the workbook.
export async function loadStandardRfpMeta() {
  const userId = getDbUserId();
  if (!userId) return null;
  try {
    const snap = await getDoc(standardPointerDoc(userId));
    const std = snap.exists() ? snap.data()?.standard : null;
    return std?.fileName ? std : null;
  } catch (err) {
    console.warn('Standard RFP template pointer read failed', err);
    return null;
  }
}

// The standard workbook, or null. The pointer read above decides whether
// the local copy is still current; when Firestore can't be reached at all,
// whatever IDB holds is better than nothing.
export async function loadStandardRfpTemplate() {
  const meta = await loadStandardRfpMeta();
  let local = null;
  try { local = await dbGet(STORE, STANDARD_RFP_KEY); } catch { /* no local copy */ }
  if (!meta) return local?.blob ? local : null;
  if (local?.blob && local.savedAt === meta.savedAt) return local;
  const fetched = await loadOppRfpTemplate(STANDARD_RFP_KEY, meta.savedAt);
  return fetched || (local?.blob ? local : null);
}

// Make this workbook the standard. Returns its record.
export async function saveStandardRfpTemplate(blob, fileName) {
  const rec = await saveOppRfpTemplate(STANDARD_RFP_KEY, blob, fileName);
  const userId = getDbUserId();
  if (userId && rec) {
    try {
      await setDoc(standardPointerDoc(userId), { standard: rfpTemplateMeta(rec) }, { merge: true });
    } catch (err) {
      console.warn('Standard RFP template pointer write failed', err);
    }
  }
  return rec;
}

export async function deleteStandardRfpTemplate() {
  await deleteOppRfpTemplate(STANDARD_RFP_KEY);
  const userId = getDbUserId();
  if (!userId) return;
  try {
    await setDoc(standardPointerDoc(userId), { standard: null }, { merge: true });
  } catch (err) {
    console.warn('Standard RFP template pointer clear failed', err);
  }
}

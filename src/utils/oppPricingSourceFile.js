// Per-opp source-file storage. When the user clicks "Save to Opp" on
// the Pricing tab, the uploaded SIA workbook's bytes are copied here
// keyed by oppId so the Opps 2 detail popup can offer a download
// later — even after the Pricing tab has been cleared or a different
// workbook loaded.
//
// IndexedDB for the local copy, plus a chunked Firestore copy so the
// workbook survives a cleared browser and follows you to the other
// machine. "Cross-device sync would require Firebase Storage" was the
// note here for a while; utils/chunkedDoc does it with the database
// already in the app, the same way oppRfpTemplate carries an RFP.

import { collection, doc } from 'firebase/firestore';
import { db as firestore } from '../firebase';
import { dbGet, dbPut, dbDelete, getDbUserId } from './db';
import { deleteChunkedDoc, readChunkedDoc, writeChunkedDoc } from './chunkedDoc.js';

const STORE = 'pricing-source-files';

// Past this a workbook stays local (and in the downloaded backup). A SIA
// is a pricing model, not a data dump; anything larger is almost certainly
// the wrong file.
export const SOURCE_FILE_MAX_SYNC_BYTES = 20 * 1024 * 1024;

function itemDoc(userId, oppId) {
  return doc(firestore, 'oppSourceFiles', String(userId), 'items', String(oppId));
}

export function oppSourceFilesCol(userId) {
  return collection(firestore, 'oppSourceFiles', String(userId), 'items');
}

// Persist a copy of the workbook's raw bytes under this opp's key.
// `bytes` may be ArrayBuffer, Uint8Array, or Blob — IndexedDB stores
// each natively, but Blob is the friendliest shape for the
// download-as-file flow on the reading side.
export async function saveOppSourceFile(oppId, bytes, fileName) {
  if (oppId == null || !bytes) return;
  const blob = bytes instanceof Blob
    ? bytes
    : new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
  const rec = {
    blob,
    fileName: String(fileName || 'workbook.xlsx'),
    savedAt: new Date().toISOString(),
  };
  await dbPut(STORE, rec, String(oppId));

  const userId = getDbUserId();
  if (!userId) return;
  if (blob.size > SOURCE_FILE_MAX_SYNC_BYTES) {
    console.warn(`Opp ${oppId} source file is ${blob.size} bytes — too big to back up to Firestore; it stays on this device.`);
    return;
  }
  // Best-effort: a rules failure or an offline browser must not lose the
  // workbook the user just saved.
  try {
    await writeChunkedDoc(itemDoc(userId, oppId), rec, {
      meta: { fileName: rec.fileName, sizeBytes: blob.size, savedAt: rec.savedAt },
    });
  } catch (err) {
    console.warn('Opp source file Firestore backup failed', oppId, err);
  }
}

export async function loadOppSourceFile(oppId) {
  if (oppId == null) return null;
  try {
    const rec = await dbGet(STORE, String(oppId));
    if (rec?.blob) return rec;
  } catch { /* fall through to the backup */ }

  // Nothing here — a cleared browser, or the workbook was saved on the
  // other machine. Fetch it and cache it so the next open is local.
  const userId = getDbUserId();
  if (!userId) return null;
  try {
    const remote = await readChunkedDoc(itemDoc(userId, oppId));
    const rec = remote?.value;
    if (!rec?.blob) return null;
    try { await dbPut(STORE, rec, String(oppId)); } catch { /* cache only */ }
    return rec;
  } catch (err) {
    console.warn('Opp source file restore failed', oppId, err);
    return null;
  }
}

export async function deleteOppSourceFile(oppId) {
  if (oppId == null) return;
  try { await dbDelete(STORE, String(oppId)); }
  catch { /* best-effort */ }
  const userId = getDbUserId();
  if (!userId) return;
  try { await deleteChunkedDoc(itemDoc(userId, oppId)); }
  catch (err) { console.warn('Opp source file Firestore delete failed', oppId, err); }
}

// Light metadata to embed in the Pricing-Option snapshot on the opp.
// The actual bytes live in IDB under the per-opp key above; this
// summary just tells the popup whether to render a Download button.
export function sourceFileMeta(fileName, bytes) {
  if (!bytes) return null;
  const size = typeof bytes.size === 'number'
    ? bytes.size
    : (bytes.byteLength ?? 0);
  return {
    fileName: String(fileName || 'workbook.xlsx'),
    sizeBytes: size,
    savedAt: new Date().toISOString(),
  };
}

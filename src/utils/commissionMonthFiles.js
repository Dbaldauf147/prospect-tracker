// The commissions Excel files dropped on the month cards of Clients >
// Commissions > Monthly, kept so a card can hand its file back
// (Download on the month popup).
//
// Same two halves as the SIA workbooks in oppPricingSourceFile.js: an
// IndexedDB copy for speed and a chunked Firestore copy so the file
// survives a cleared browser and follows Dan to his other machine. Which
// files a month has is recorded in settings (commissionMonthUploads, see
// commissionMonthUploads.js) under each file's `fileId`; this store only
// holds the bytes.

import { doc } from 'firebase/firestore';
import { db as firestore } from '../firebase';
import { dbGet, dbPut, getDbUserId } from './db';
import { readChunkedDoc, writeChunkedDoc } from './chunkedDoc.js';
import { clearLocalOnly, errorText, markLocalOnly } from './localOnlyFiles.js';

export const COMMISSION_FILES_STORE = 'commission-month-files';
export const COMMISSION_FILES_COLLECTION = 'commissionMonthFiles';

// A month's commissions export is a few hundred rows; past this it stays
// on this device (and the Issues tab says so).
export const COMMISSION_FILE_MAX_SYNC_BYTES = 20 * 1024 * 1024;

export function commissionFileDoc(userId, fileId) {
  return doc(firestore, COMMISSION_FILES_COLLECTION, String(userId), 'items', String(fileId));
}

// A new id for a file uploaded against month key 'YYYY-MM'.
export function newCommissionFileId(monthKey, now = new Date()) {
  return `${monthKey}_${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export async function saveCommissionMonthFile(fileId, file, fileName) {
  if (!fileId || !file) return;
  const blob = file instanceof Blob ? file : new Blob([file]);
  const rec = {
    blob,
    fileName: String(fileName || file.name || 'commissions.xlsx'),
    savedAt: new Date().toISOString(),
  };
  await dbPut(COMMISSION_FILES_STORE, rec, String(fileId));

  const userId = getDbUserId();
  if (!userId) return;
  const riskId = `commissionFile:${fileId}`;
  const atRisk = { kind: 'commissionFile', name: rec.fileName, sizeBytes: blob.size };
  if (blob.size > COMMISSION_FILE_MAX_SYNC_BYTES) {
    markLocalOnly(riskId, { ...atRisk, reason: 'too-big', limitBytes: COMMISSION_FILE_MAX_SYNC_BYTES });
    return;
  }
  // Best-effort: an offline browser must not lose the file it just saved.
  try {
    await writeChunkedDoc(commissionFileDoc(userId, fileId), rec, {
      meta: { fileName: rec.fileName, sizeBytes: blob.size, savedAt: rec.savedAt },
    });
    clearLocalOnly(riskId);
  } catch (err) {
    console.warn('Commission month file Firestore backup failed', fileId, err);
    markLocalOnly(riskId, { ...atRisk, reason: 'backup-failed', error: errorText(err) });
  }
}

export async function loadCommissionMonthFile(fileId) {
  if (!fileId) return null;
  try {
    const rec = await dbGet(COMMISSION_FILES_STORE, String(fileId));
    if (rec?.blob) return rec;
  } catch { /* fall through to the cloud copy */ }
  const userId = getDbUserId();
  if (!userId) return null;
  try {
    const remote = await readChunkedDoc(commissionFileDoc(userId, fileId));
    const rec = remote?.value;
    if (!rec?.blob) return null;
    try { await dbPut(COMMISSION_FILES_STORE, rec, String(fileId)); } catch { /* cache only */ }
    return rec;
  } catch (err) {
    console.warn('Commission month file restore failed', fileId, err);
    return null;
  }
}

// Save the stored file to the user's Downloads. Resolves false when there
// is no copy (a file uploaded before copies were kept).
export async function downloadCommissionMonthFile(fileId, fallbackName) {
  const rec = await loadCommissionMonthFile(fileId);
  if (!rec?.blob) return false;
  const url = URL.createObjectURL(rec.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = rec.fileName || fallbackName || 'commissions.xlsx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

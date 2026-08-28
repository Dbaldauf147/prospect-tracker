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
//     that makes the file cross-device — the thing the pricing-source-file
//     store never got, which is why a workbook saved on the laptop is
//     invisible on the desktop. Bytes go over as base64 split across
//     ~600 KB string fields, the same chunking listBackupSync uses to get
//     past Firestore's 1 MB per-document cap.
//
// A load that misses IDB but finds Firestore writes the blob back into
// IDB, so the restore happens once per device rather than per open.

import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { dbGet, dbPut, dbDelete, getDbUserId } from './db';

const STORE = 'rfp-templates';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Chunk size in base64 characters. 600 KB per field leaves plenty of
// head-room under the 1 MB document cap once the other fields are counted.
const CHUNK_CHARS = 600_000;

// Ceiling on what gets mirrored to Firestore. An RFP workbook is a form to
// fill in, not a data dump — anything past this is almost certainly the
// wrong file, and writing it would cost a document per open. The local IDB
// copy is still saved, so an oversized file works on this device.
export const RFP_MAX_SYNC_BYTES = 15 * 1024 * 1024;

function itemDoc(userId, oppId) {
  return doc(db, 'oppRfpTemplates', String(userId), 'items', String(oppId));
}

async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  // Convert in slices: String.fromCharCode(...bytes) on a multi-MB array
  // overflows the argument limit and throws.
  let binary = '';
  const STEP = 0x8000;
  for (let i = 0; i < buf.length; i += STEP) {
    binary += String.fromCharCode.apply(null, buf.subarray(i, i + STEP));
  }
  return btoa(binary);
}

function base64ToBlob(b64, type) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: type || XLSX_MIME });
}

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
      const b64 = await blobToBase64(rec.blob);
      const payload = {
        chunkCount: Math.ceil(b64.length / CHUNK_CHARS),
        fileName: rec.fileName,
        sizeBytes: rec.sizeBytes,
        contentType: rec.blob.type || XLSX_MIME,
        savedAt: rec.savedAt,
      };
      for (let i = 0, n = 0; i < b64.length; i += CHUNK_CHARS, n++) {
        payload[`chunk${n}`] = b64.slice(i, i + CHUNK_CHARS);
      }
      await setDoc(itemDoc(userId, oppId), payload);
    } catch (err) {
      console.warn('RFP template Firestore backup failed', err);
    }
  }
  return rec;
}

// The record for this opp, or null. IDB first; Firestore on a miss, with
// the restored blob written back locally.
export async function loadOppRfpTemplate(oppId) {
  if (oppId == null) return null;
  try {
    const rec = await dbGet(STORE, String(oppId));
    if (rec?.blob) return rec;
  } catch { /* fall through to the backup */ }

  const userId = getDbUserId();
  if (!userId) return null;
  try {
    const snap = await getDoc(itemDoc(userId, oppId));
    if (!snap.exists()) return null;
    const data = snap.data();
    const blob = unpackChunks(data);
    if (!blob) return null;
    const rec = {
      blob,
      fileName: String(data.fileName || 'rfp.xlsx'),
      sizeBytes: Number(data.sizeBytes) || blob.size,
      savedAt: data.savedAt || new Date().toISOString(),
    };
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
  try { await deleteDoc(itemDoc(userId, oppId)); } catch { /* best-effort */ }
}

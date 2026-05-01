// Firestore-backed backup of uploaded list source data (the rows
// uploaded from CSRD / CDP / GRESB / RECA / EcoAct / etc. exports).
// Mirrors what's in IndexedDB so a browser "Clear site data" can't
// wipe a list — the next page load auto-restores from Firestore.
//
// Storage layout:
//   users/<uid>/listBackups/<storageKey>
//     {
//       chunkCount: number,
//       count: number (row count),
//       savedAt: number (Date.now()),
//       chunk0: string (JSON of rows[0..N]),
//       chunk1: string,
//       ...
//     }
//
// Each chunk targets ~600KB to stay comfortably under the 1MB
// per-doc Firestore limit. Larger lists span multiple chunks; chunk
// count is bounded only by the per-doc field count (1500), so up to
// ~900MB of raw JSON per list is supported in theory.

import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';

const CHUNK_BYTES = 600_000;

function chunkString(str, size) {
  const chunks = [];
  for (let i = 0; i < str.length; i += size) {
    chunks.push(str.slice(i, i + size));
  }
  return chunks;
}

export async function saveListBackup(userId, storageKey, rows) {
  if (!userId || !storageKey) return;
  if (!Array.isArray(rows) || rows.length === 0) {
    // Empty list = clear backup so the auto-restore path doesn't
    // surface stale data after the user explicitly cleared.
    try { await deleteDoc(doc(db, 'users', userId, 'listBackups', storageKey)); } catch {}
    return;
  }
  const json = JSON.stringify(rows);
  const chunks = chunkString(json, CHUNK_BYTES);
  const payload = {
    chunkCount: chunks.length,
    count: rows.length,
    savedAt: Date.now(),
  };
  chunks.forEach((c, i) => { payload[`chunk${i}`] = c; });
  await setDoc(doc(db, 'users', userId, 'listBackups', storageKey), payload);
}

export async function loadListBackup(userId, storageKey) {
  if (!userId || !storageKey) return null;
  try {
    const snap = await getDoc(doc(db, 'users', userId, 'listBackups', storageKey));
    if (!snap.exists()) return null;
    const data = snap.data();
    const n = Number(data.chunkCount) || 0;
    if (n === 0) return null;
    let json = '';
    for (let i = 0; i < n; i++) {
      const c = data[`chunk${i}`];
      if (typeof c !== 'string') return null;
      json += c;
    }
    const rows = JSON.parse(json);
    return Array.isArray(rows) ? rows : null;
  } catch (err) {
    console.warn('loadListBackup failed', storageKey, err);
    return null;
  }
}

export async function clearListBackup(userId, storageKey) {
  if (!userId || !storageKey) return;
  try { await deleteDoc(doc(db, 'users', userId, 'listBackups', storageKey)); } catch {}
}

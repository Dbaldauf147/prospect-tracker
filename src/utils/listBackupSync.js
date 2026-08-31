// Firestore-backed backup of uploaded list source data (the rows
// uploaded from CSRD / CDP / GRESB / RECA / EcoAct / etc. exports).
// Mirrors what's in IndexedDB so a browser "Clear site data" can't
// wipe a list — the next page load auto-restores from Firestore.
//
// Storage layout:
//   listBackups/<storageKey>                  ← shared across users
//     {
//       chunkCount: number,
//       count: number (row count),
//       savedAt: number (Date.now()),
//       chunk0: string (JSON of rows[0..N]),
//       chunk1: string,
//       ...
//     }
//
// The Lists tab is intentionally shared across all signed-in users
// (see CLAUDE.md). Before this commit each user had their own copy at
// users/<uid>/listBackups/<storageKey>, which meant a non-admin user
// signing in on a fresh device saw an empty Lists tab. The shared
// path makes the lists cross-device for everyone.
//
// Legacy fallback: existing admin data at users/<uid>/listBackups/...
// is read on cache miss and copied into the shared path on the fly,
// so the admin's lists move to the shared collection without manual
// migration. On clear, both paths are deleted.
//
// The chunk fields above are the LEGACY layout, and they were wrong:
// Firestore's 1 MB cap is on the document, not on each field, so any list
// that needed a second chunk failed the write outright — and saveList
// fire-and-forgets the promise, so the big lists (CDP, GRESB — the ones it
// would actually hurt to lose) quietly had no backup at all. Writes now go
// through utils/chunkedDoc, which puts each chunk in its own document
// under the parent. Reads still understand the old layout, since anything
// stored that way is by definition small enough to have succeeded.

import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { deleteChunkedDoc, readChunkedDoc, writeChunkedDoc } from './chunkedDoc.js';

function sharedDoc(storageKey) {
  return doc(db, 'listBackups', storageKey);
}

function legacyDoc(userId, storageKey) {
  return doc(db, 'users', userId, 'listBackups', storageKey);
}

// The legacy inline-chunk layout.
function unpackChunks(data) {
  const n = Number(data?.chunkCount) || 0;
  if (n === 0) return null;
  let json = '';
  for (let i = 0; i < n; i++) {
    const c = data[`chunk${i}`];
    if (typeof c !== 'string') return null;
    json += c;
  }
  try {
    const rows = JSON.parse(json);
    return Array.isArray(rows) ? rows : null;
  } catch { return null; }
}

export async function saveListBackup(userId, storageKey, rows) {
  if (!storageKey) return;
  if (!Array.isArray(rows) || rows.length === 0) {
    // Empty list = clear backup so the auto-restore path doesn't
    // surface stale data after the user explicitly cleared.
    await clearListBackup(userId, storageKey);
    return;
  }
  await writeChunkedDoc(sharedDoc(storageKey), rows, {
    meta: { count: rows.length, savedAt: Date.now() },
  });
}

// A list from a document, whichever layout it was written in.
async function readList(ref) {
  const entry = await readChunkedDoc(ref);
  if (Array.isArray(entry?.value)) return entry.value;
  const snap = await getDoc(ref);
  return snap.exists() ? unpackChunks(snap.data()) : null;
}

export async function loadListBackup(userId, storageKey) {
  if (!storageKey) return null;
  try {
    // Shared path is the canonical store.
    const rows = await readList(sharedDoc(storageKey));
    if (rows) return rows;
    // Legacy per-user fallback. If found, opportunistically promote
    // into the shared collection so future reads (including for other
    // signed-in users) hit the fast path. Best-effort: if the write
    // fails (e.g. permission rules), still return the legacy data.
    if (userId) {
      const legacyRows = await readList(legacyDoc(userId, storageKey));
      if (legacyRows) {
        try { await saveListBackup(userId, storageKey, legacyRows); } catch { /* still return the data */ }
        return legacyRows;
      }
    }
    return null;
  } catch (err) {
    console.warn('loadListBackup failed', storageKey, err);
    return null;
  }
}

export async function clearListBackup(userId, storageKey) {
  if (!storageKey) return;
  try { await deleteChunkedDoc(sharedDoc(storageKey)); } catch { /* best-effort */ }
  if (userId) { try { await deleteChunkedDoc(legacyDoc(userId, storageKey)); } catch { /* best-effort */ } }
}

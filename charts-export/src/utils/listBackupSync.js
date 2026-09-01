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

function sharedDoc(storageKey) {
  return doc(db, 'listBackups', storageKey);
}

function legacyDoc(userId, storageKey) {
  return doc(db, 'users', userId, 'listBackups', storageKey);
}

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

function buildPayload(rows) {
  const json = JSON.stringify(rows);
  const chunks = chunkString(json, CHUNK_BYTES);
  const payload = {
    chunkCount: chunks.length,
    count: rows.length,
    savedAt: Date.now(),
  };
  chunks.forEach((c, i) => { payload[`chunk${i}`] = c; });
  return payload;
}

export async function saveListBackup(userId, storageKey, rows) {
  if (!storageKey) return;
  if (!Array.isArray(rows) || rows.length === 0) {
    // Empty list = clear backup so the auto-restore path doesn't
    // surface stale data after the user explicitly cleared.
    try { await deleteDoc(sharedDoc(storageKey)); } catch {}
    if (userId) { try { await deleteDoc(legacyDoc(userId, storageKey)); } catch {} }
    return;
  }
  const payload = buildPayload(rows);
  await setDoc(sharedDoc(storageKey), payload);
}

export async function loadListBackup(userId, storageKey) {
  if (!storageKey) return null;
  try {
    // Shared path is the canonical store.
    const shared = await getDoc(sharedDoc(storageKey));
    if (shared.exists()) {
      const rows = unpackChunks(shared.data());
      if (rows) return rows;
    }
    // Legacy per-user fallback. If found, opportunistically promote
    // into the shared collection so future reads (including for other
    // signed-in users) hit the fast path. Best-effort: if the write
    // fails (e.g. permission rules), still return the legacy data.
    if (userId) {
      const legacy = await getDoc(legacyDoc(userId, storageKey));
      if (legacy.exists()) {
        const rows = unpackChunks(legacy.data());
        if (rows) {
          try { await setDoc(sharedDoc(storageKey), buildPayload(rows)); } catch {}
          return rows;
        }
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
  try { await deleteDoc(sharedDoc(storageKey)); } catch {}
  if (userId) { try { await deleteDoc(legacyDoc(userId, storageKey)); } catch {} }
}

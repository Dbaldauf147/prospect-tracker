// IndexedDB-backed store for portfolio source-file attachments.
// Replaces the previous localStorage approach which capped out at ~5 MB
// (and was even worse in practice because files were base64-encoded for
// dataURL storage, adding ~33% overhead). IDB typically allows hundreds
// of MB per origin without prompting the user.

import { doc, getDoc } from 'firebase/firestore';
import { db as firestore } from '../firebase';
import { getDbUserId } from './db';
import { deleteChunkedDoc, readChunkedDoc, writeChunkedDoc } from './chunkedDoc.js';

const DB_NAME = 'prospect-tracker-files';
const STORE = 'portfolio-source-files';
// Version 2 added the uploaded-lists object store. Kept in sync with
// uploadedListStore.js so the two files never fight over DB versioning.
const DB_VERSION = 2;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('uploaded-lists')) {
        db.createObjectStore('uploaded-lists', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Legacy (un-scoped) record key — kept for one-time migration.
function legacySlugKey(companyName) {
  const slug = String(companyName || '').toLowerCase().replace(/[^a-z0-9]/g, '-');
  return slug ? `portfolioUploadFile:${slug}` : '';
}

// Per-user record key so uploaded portfolio files don't leak between
// accounts sharing a browser. Pre-auth callers fall back to the legacy
// un-scoped key.
function slugKey(companyName) {
  const base = legacySlugKey(companyName);
  if (!base) return '';
  const uid = getDbUserId();
  return uid ? `${uid}:${base}` : base;
}

// The Firestore copy of one company's attachment. Keyed by the UNSCOPED
// slug — the uid is already in the path, and repeating it would bury the
// company name under it.
//
// These were IndexedDB and nothing else. An uploaded portfolio workbook is
// a file somebody sent once; "clear cookies and site data" was enough to
// need it sent again.
function itemDoc(userId, legacyKey) {
  return doc(firestore, 'portfolioSourceFiles', String(userId), 'items', legacyKey);
}

// Every file is backed up, whatever its size. There used to be a 20 MB
// ceiling, to spare a big upload its dozens of document writes, and a file
// past it lived in this browser and nowhere else: clearing site data lost
// it. A portfolio workbook is worth more than the writes (chunkedDoc
// splits it into as many documents and commits as it needs).

function backupMeta(rec) {
  return { name: rec.name, type: rec.type, size: rec.size, uploadedAt: rec.uploadedAt };
}

// Files found on this machine that have been checked against the backup
// this session, so opening a company card twice doesn't read it twice.
const verified = new Set();

// Make sure the cloud holds this browser's copy. Files uploaded while the
// ceiling stood, or while a backup write failed, are on this machine only;
// the first time one is opened it is backed up. Best-effort and quiet: the
// local copy is untouched either way.
async function ensureBackedUp(companyName, rec) {
  const userId = getDbUserId();
  const legacyKey = legacySlugKey(companyName);
  if (!userId || !legacyKey || !rec?.blob) return;
  const tag = `${userId}:${legacyKey}`;
  if (verified.has(tag)) return;
  verified.add(tag);
  try {
    const ref = itemDoc(userId, legacyKey);
    const snap = await getDoc(ref);
    const meta = snap.exists() ? snap.data() : null;
    if (meta && meta.uploadedAt === rec.uploadedAt && Number(meta.size) === Number(rec.size)) return;
    await writeChunkedDoc(ref, rec, { meta: backupMeta(rec) });
  } catch (err) {
    verified.delete(tag);
    console.warn('Portfolio source file backup check failed', companyName, err);
  }
}

function idbGet(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveSourceFile(companyName, file) {
  const key = slugKey(companyName);
  if (!key || !file) return;
  const rec = {
    key,
    name: file.name,
    type: file.type || 'application/octet-stream',
    size: file.size,
    uploadedAt: new Date().toISOString(),
    blob: file,
  };
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(rec);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });

  const userId = getDbUserId();
  if (!userId) return;
  // Best-effort: an offline browser must not lose the file just uploaded.
  // A failed write is retried the next time the file is opened
  // (ensureBackedUp).
  try {
    await writeChunkedDoc(itemDoc(userId, legacySlugKey(companyName)), rec, { meta: backupMeta(rec) });
    verified.add(`${userId}:${legacySlugKey(companyName)}`);
  } catch (err) {
    console.warn('Portfolio source file Firestore backup failed', companyName, err);
  }
}

export async function loadSourceFile(companyName) {
  const key = slugKey(companyName);
  const legacyKey = legacySlugKey(companyName);
  if (!key) return null;
  try {
    const db = await openDB();
    const rec = await idbGet(db, key);
    if (rec) { ensureBackedUp(companyName, rec); return rec; }
    // Claim a legacy un-scoped IDB record for the current user (covers
    // the admin's files uploaded before per-user scoping). Skip when the
    // scoped key already equals the legacy key (pre-auth).
    if (legacyKey !== key) {
      const legacyRec = await idbGet(db, legacyKey);
      if (legacyRec) {
        const claimed = { ...legacyRec, key };
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(claimed);
          tx.objectStore(STORE).delete(legacyKey);
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
        ensureBackedUp(companyName, claimed);
        return claimed;
      }
    }
    // One-time migration from the legacy localStorage entry.
    try {
      const raw = localStorage.getItem(legacyKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.dataUrl) {
          const res = await fetch(parsed.dataUrl);
          const blob = await res.blob();
          const migrated = {
            key,
            name: parsed.name || 'file',
            type: parsed.type || blob.type || 'application/octet-stream',
            size: parsed.size || blob.size,
            uploadedAt: parsed.uploadedAt || new Date().toISOString(),
            blob,
          };
          await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put(migrated);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
          });
          try { localStorage.removeItem(legacyKey); } catch { /* storage blocked */ }
          ensureBackedUp(companyName, migrated);
          return migrated;
        }
      }
    } catch { /* no legacy localStorage entry */ }
  } catch { /* fall through to the backup */ }

  // Nothing on this machine — fetch the backup and cache it locally.
  const userId = getDbUserId();
  if (!userId) return null;
  try {
    const remote = await readChunkedDoc(itemDoc(userId, legacyKey));
    const rec = remote?.value;
    if (!rec?.blob) return null;
    const restored = { ...rec, key };
    verified.add(`${userId}:${legacyKey}`);
    try {
      const db = await openDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(restored);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch { /* cache only */ }
    return restored;
  } catch (err) {
    console.warn('Portfolio source file restore failed', companyName, err);
    return null;
  }
}

// Move a stored source file from one company slug to another. Used by
// the prospect-rename flow so an uploaded portfolio file follows the
// company when its display name changes. Best-effort: silently no-ops
// if there's nothing under the old slug or the slugs are identical.
export async function renameSourceFile(oldCompanyName, newCompanyName) {
  const oldKey = slugKey(oldCompanyName);
  const newKey = slugKey(newCompanyName);
  if (!oldKey || !newKey || oldKey === newKey) return false;
  try {
    const db = await openDB();
    const rec = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(oldKey);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    if (!rec) return false;
    // Don't clobber a file already saved under the new name.
    const existingNew = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(newKey);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    if (existingNew) return false;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ ...rec, key: newKey });
      tx.objectStore(STORE).delete(oldKey);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    // The backup follows the rename, or the next machine to open the
    // renamed company restores nothing and the file looks lost.
    const userId = getDbUserId();
    if (userId) {
      try {
        await writeChunkedDoc(itemDoc(userId, legacySlugKey(newCompanyName)), { ...rec, key: newKey }, { meta: backupMeta(rec) });
        await deleteChunkedDoc(itemDoc(userId, legacySlugKey(oldCompanyName)));
      } catch (err) {
        console.warn('Portfolio source file Firestore rename failed', oldCompanyName, err);
      }
    }
    return true;
  } catch {
    return false;
  }
}

export async function clearSourceFile(companyName) {
  const key = slugKey(companyName);
  if (!key) return;
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* nothing stored, or the DB is closed */ }
  try { localStorage.removeItem(key); } catch { /* storage blocked */ }
  try { localStorage.removeItem(legacySlugKey(companyName)); } catch { /* storage blocked */ }
  const userId = getDbUserId();
  if (!userId) return;
  try { await deleteChunkedDoc(itemDoc(userId, legacySlugKey(companyName))); }
  catch (err) { console.warn('Portfolio source file Firestore clear failed', companyName, err); }
}

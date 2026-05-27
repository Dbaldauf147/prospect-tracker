// IndexedDB-backed store for portfolio source-file attachments.
// Replaces the previous localStorage approach which capped out at ~5 MB
// (and was even worse in practice because files were base64-encoded for
// dataURL storage, adding ~33% overhead). IDB typically allows hundreds
// of MB per origin without prompting the user.

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

function slugKey(companyName) {
  const slug = String(companyName || '').toLowerCase().replace(/[^a-z0-9]/g, '-');
  return slug ? `portfolioUploadFile:${slug}` : '';
}

export async function saveSourceFile(companyName, file) {
  const key = slugKey(companyName);
  if (!key || !file) return;
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({
      key,
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      uploadedAt: new Date().toISOString(),
      blob: file,
    });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadSourceFile(companyName) {
  const key = slugKey(companyName);
  if (!key) return null;
  try {
    const db = await openDB();
    const rec = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    if (rec) return rec;
    // One-time migration from the legacy localStorage entry.
    try {
      const raw = localStorage.getItem(key);
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
          try { localStorage.removeItem(key); } catch {}
          return migrated;
        }
      }
    } catch {}
    return null;
  } catch {
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
  } catch {}
  try { localStorage.removeItem(key); } catch {}
}

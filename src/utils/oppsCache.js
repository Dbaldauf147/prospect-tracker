// Read-only helper that reads the Opps cache populated by OppsView (IndexedDB).
// Falling back gracefully if the store doesn't exist yet.

const DB_NAME = 'prospect-tracker-db';
const DB_STORE = 'opps-cache';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadOppsFromCache() {
  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains(DB_STORE)) return null;
    return await new Promise((resolve) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const store = tx.objectStore(DB_STORE);
      const req = store.get('data');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export function findOppByBfoLink(cache, bfoLink) {
  if (!cache?.records || !bfoLink) return null;
  const target = String(bfoLink).trim().toLowerCase();
  return cache.records.find(r => String(r['BFO Link'] || '').trim().toLowerCase() === target) || null;
}

export function searchOpps(cache, term) {
  if (!cache?.records) return [];
  const t = (term || '').trim().toLowerCase();
  if (!t) return cache.records.slice(0, 25);
  return cache.records.filter(r => {
    return ['Account', 'Contact', 'BFO Link', 'Scope', 'Stage']
      .some(k => String(r[k] || '').toLowerCase().includes(t));
  }).slice(0, 25);
}

// SHIM for the Lovable export.
//
// The real module is an IndexedDB wrapper with per-user object stores
// (cached opportunities, the Opps backup history, HubSpot contacts,
// pricing-option links, …). Rather than ship a full IndexedDB layer,
// this shim backs the same async API with `localStorage`, namespaced by
// store + key. That's plenty for the demo and has one nice property the
// in-memory version wouldn't: your edits to the Opps table survive a
// page reload, because `saveOpps2Cache` lands here.
//
// Values are JSON-serialized. The Opps dataset can grow large; if it
// ever exceeds the ~5 MB localStorage quota a write will throw, which we
// swallow (the caller treats persistence as best-effort).

let userId = null;
const PREFIX = 'odx'; // opps-dropdowns-export

export function setDbUserId(uid) { userId = uid || null; }
export function getDbUserId() { return userId; }
export function openDB() { return Promise.resolve(null); }

function fullKey(storeName, key) {
  return `${PREFIX}::${userId || 'anon'}::${storeName}::${key}`;
}

export async function dbGet(storeName, key) {
  try {
    const raw = localStorage.getItem(fullKey(storeName, key));
    return raw == null ? undefined : JSON.parse(raw);
  } catch { return undefined; }
}

export async function dbGetAll(storeName) {
  const out = [];
  const scan = `${PREFIX}::${userId || 'anon'}::${storeName}::`;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(scan)) {
        try { out.push(JSON.parse(localStorage.getItem(k))); } catch { /* skip */ }
      }
    }
  } catch { /* localStorage unavailable */ }
  return out;
}

export async function dbPut(storeName, value, key) {
  try {
    localStorage.setItem(fullKey(storeName, key ?? 'data'), JSON.stringify(value));
  } catch (err) {
    console.warn('db shim: localStorage write failed (quota?)', err);
  }
}

export async function dbDelete(storeName, key) {
  try { localStorage.removeItem(fullKey(storeName, key)); } catch { /* ignore */ }
}

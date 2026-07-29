// SHIM for the Lovable export.
//
// In the original app this module wrapped IndexedDB (per-user object
// stores for cached opportunities, HubSpot data, etc.). The Clients page
// only ever READS one of those caches (the Opps-2 snapshot, via
// oppsCache.js) to cross-reference BFO links on the Deals tab — and it
// already tolerates that cache being empty.
//
// Rather than ship a real IndexedDB layer the export doesn't need, we
// back the same API with an in-memory Map. Nothing persists across a
// page reload, which is fine: the sample Deals/Commissions data lives in
// localStorage (see ../data/sampleData.js), not here.

const mem = new Map();
const composite = (storeName, key) => `${storeName}::${key}`;

export function setDbUserId() {}
export function getDbUserId() { return null; }
export async function openDB() { return null; }

export async function dbGet(storeName, key) {
  return mem.get(composite(storeName, key));
}

export async function dbGetAll() {
  return [];
}

export async function dbPut(storeName, value, key) {
  mem.set(composite(storeName, key ?? 'data'), value);
}

export async function dbDelete(storeName, key) {
  mem.delete(composite(storeName, key));
}

// Async cache for HubSpot contacts, backed by IndexedDB.
//
// Replaces the previous localStorage cache, which silently failed once the
// payload exceeded the ~5–10 MB localStorage quota — leaving callers reading
// a stale snapshot. IndexedDB has effectively no quota concern at this scale.
//
// On first read, any cache still in localStorage is migrated into IDB and the
// localStorage entry is removed.

import { dbGet, dbPut } from './db';

const STORE = 'hubspot-contacts';
const KEY = 'cache';
const LS_KEY = 'hubspot-sync-cache';

let migrationPromise = null;

async function migrateFromLocalStorage() {
  if (migrationPromise) return migrationPromise;
  migrationPromise = (async () => {
    try {
      const existing = await dbGet(STORE, KEY);
      if (existing) return;
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEY) : null;
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.contacts) {
        await dbPut(STORE, parsed, KEY);
      }
      try { localStorage.removeItem(LS_KEY); } catch { /* noop */ }
    } catch (err) {
      console.warn('hubspotContactsCache migration failed', err);
    }
  })();
  return migrationPromise;
}

export async function getHubspotCache() {
  await migrateFromLocalStorage();
  try {
    return (await dbGet(STORE, KEY)) || null;
  } catch {
    return null;
  }
}

export async function getHubspotContacts() {
  const c = await getHubspotCache();
  return c?.contacts || [];
}

export async function setHubspotCache(cache) {
  await migrateFromLocalStorage();
  await dbPut(STORE, cache, KEY);
  notifyCacheUpdated();
}

// Read-modify-write helper for callers that mutate contacts then save.
// `mutate` receives a shallow clone and may return a new cache, or mutate
// and return undefined (in which case the clone is saved).
export async function updateHubspotCache(mutate) {
  const current = (await getHubspotCache()) || { contacts: [] };
  const draft = { ...current, contacts: [...(current.contacts || [])] };
  const result = mutate(draft);
  await setHubspotCache(result || draft);
}

export function notifyCacheUpdated() {
  try { window.dispatchEvent(new Event('hubspot-cache-updated')); } catch { /* noop */ }
}

// Console escape hatch for inspection (replacement for the old
// `JSON.parse(localStorage.getItem('hubspot-sync-cache'))` one-liner).
if (typeof window !== 'undefined') {
  window.__hubspotCache = { getHubspotCache, getHubspotContacts, setHubspotCache };
}

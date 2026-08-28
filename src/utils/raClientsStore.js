// Loads the effective RA Clients list — user-uploaded override (localStorage,
// scoped per user) takes precedence over the bundled default in
// src/data/raClients.json.
import defaultRaClients from '../data/raClients.json';
import { userLsGet, userLsSet, userLsRemove, userLsHas } from './userLs';
import { registerMirroredKey, queueMirrorPush, dispatchStoreEvent } from './localMirrorSync';

const KEY = 'ra-clients-override';

// Fired whenever the override is saved or cleared, so same-window listeners
// refresh — the native 'storage' event only fires in OTHER tabs.
export const RA_CLIENTS_EVENT = 'ra-clients-changed';

// Mirrored to Firestore. Losing this one degrades to the bundled default
// rather than to nothing, but the uploaded list is still the user's work.
registerMirroredKey(KEY, RA_CLIENTS_EVENT);

export function loadEffectiveRaClients() {
  try {
    const raw = userLsGet(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return { data: parsed, source: 'override', count: parsed.length };
      }
    }
  } catch (err) {
    console.error('Failed to read RA clients override:', err);
  }
  return { data: defaultRaClients, source: 'default', count: defaultRaClients.length };
}

export function saveRaClientsOverride(arr) {
  if (!Array.isArray(arr) || arr.length === 0) throw new Error('Override must be a non-empty array');
  userLsSet(KEY, JSON.stringify(arr));
  queueMirrorPush(KEY);
  dispatchStoreEvent(RA_CLIENTS_EVENT);
}

export function clearRaClientsOverride() {
  userLsRemove(KEY);
  // allowEmpty: reverting to the bundled default on purpose, so the
  // emptiness is the thing to sync. A browser that merely LOST its copy
  // never reaches here, and so can't wipe the cloud one.
  queueMirrorPush(KEY, { allowEmpty: true });
  dispatchStoreEvent(RA_CLIENTS_EVENT);
}

export function hasRaClientsOverride() {
  try {
    return userLsHas(KEY);
  } catch {
    return false;
  }
}

// Canonical accessors — accept either the legacy "MDM Name" or the new "Client Name" header.
export function raClientName(row) {
  if (!row) return '';
  return String(row['Client Name'] || row['MDM Name'] || '').trim();
}

// CM (Client Manager) accessor — accepts a few common header variants.
export function raClientCm(row) {
  if (!row) return '';
  return String(row['CM'] || row['Client Manager'] || row['Client Management Team'] || row['Client Mgmt Team'] || '').trim();
}

// Loads the effective RA Clients list — user-uploaded override (localStorage,
// scoped per user) takes precedence over the bundled default in
// src/data/raClients.json.
import defaultRaClients from '../data/raClients.json';
import { userLsGet, userLsSet, userLsRemove, userLsHas } from './userLs';

const KEY = 'ra-clients-override';

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
}

export function clearRaClientsOverride() {
  userLsRemove(KEY);
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

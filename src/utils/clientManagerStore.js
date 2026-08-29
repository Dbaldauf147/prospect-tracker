// Per-client fields typed directly on the Clients tab — Client Manager
// name, In Person Meeting flag, and the user's custom Status. Each
// lives in its own localStorage key so a missing field doesn't blow
// away the others, and each is keyed by the normalized company name so
// casing / whitespace drift doesn't fragment the data across imports.
// All keys are scoped per user so accounts sharing a browser don't
// share client-tab notes / statuses.

import { userLsGet, userLsSet } from './userLs.js';
import { registerMirroredKey, queueMirrorPush } from './localMirrorSync.js';

const MANAGER_KEY = 'clients-manager-map';
const IN_PERSON_KEY = 'clients-inperson-map';
const STATUS_KEY = 'clients-status-map';
const STATUS_SET_AT_KEY = 'clients-status-set-at';
const NOTES_KEY = 'clients-notes-map';
const UNTRACKED_KEY = 'clients-untracked-map';
const LOUISVILLE_KEY = 'clients-louisville-map';
export const CLIENT_MANAGER_EVENT = 'client-manager-changed';
export const CLIENT_IN_PERSON_EVENT = 'client-inperson-changed';
export const CLIENT_STATUS_EVENT = 'client-status-changed';
export const CLIENT_STATUS_SET_AT_EVENT = 'client-status-set-at-changed';
export const CLIENT_NOTES_EVENT = 'client-notes-changed';
export const CLIENT_UNTRACKED_EVENT = 'client-untracked-changed';
export const CLIENT_LOUISVILLE_EVENT = 'client-louisville-changed';

function normKey(s) { return String(s || '').trim().toLowerCase(); }

// Local calendar date (YYYY-MM-DD) — used to stamp when a Status was set so
// time-boxed statuses (e.g. "Reached out to CM") can auto-expire.
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function loadMap(key) {
  try {
    const raw = userLsGet(key);
    return raw ? (JSON.parse(raw) || {}) : {};
  } catch { return {}; }
}

function persistMap(key, map, eventName) {
  try {
    userLsSet(key, JSON.stringify(map || {}));
    queueMirrorPush(key);
    window.dispatchEvent(new Event(eventName));
  } catch (err) {
    console.warn(`Failed to persist ${key}`, err);
  }
}

export function loadClientManagerMap() { return loadMap(MANAGER_KEY); }
export function loadClientInPersonMap() { return loadMap(IN_PERSON_KEY); }
export function loadClientStatusMap() { return loadMap(STATUS_KEY); }
export function loadClientStatusSetAtMap() { return loadMap(STATUS_SET_AT_KEY); }
export function loadClientNotesMap() { return loadMap(NOTES_KEY); }
export function loadClientUntrackedMap() { return loadMap(UNTRACKED_KEY); }
export function loadClientLouisvilleMap() { return loadMap(LOUISVILLE_KEY); }

export function setClientManager(company, name) {
  const key = normKey(company);
  if (!key) return;
  const map = loadClientManagerMap();
  const trimmed = String(name || '').trim();
  if (!trimmed) delete map[key];
  else map[key] = trimmed;
  persistMap(MANAGER_KEY, map, CLIENT_MANAGER_EVENT);
}

export function setClientInPerson(company, checked) {
  const key = normKey(company);
  if (!key) return;
  const map = loadClientInPersonMap();
  if (checked) map[key] = true;
  else delete map[key];
  persistMap(IN_PERSON_KEY, map, CLIENT_IN_PERSON_EVENT);
}

export function setClientLouisville(company, checked) {
  const key = normKey(company);
  if (!key) return;
  const map = loadClientLouisvilleMap();
  if (checked) map[key] = true;
  else delete map[key];
  persistMap(LOUISVILLE_KEY, map, CLIENT_LOUISVILLE_EVENT);
}

export function setClientStatus(company, value) {
  const key = normKey(company);
  if (!key) return;
  const map = loadClientStatusMap();
  const trimmed = String(value || '').trim();
  const prev = map[key] || '';
  if (!trimmed) delete map[key];
  else map[key] = trimmed;
  persistMap(STATUS_KEY, map, CLIENT_STATUS_EVENT);
  // Stamp the moment a status BECOMES a new value so time-boxed statuses
  // (e.g. "Reached out to CM") can auto-expire. Only re-stamp on an actual
  // change — re-saving the same value must not reset the clock — and drop
  // the stamp when the status is cleared.
  if (trimmed !== prev) {
    const stamps = loadMap(STATUS_SET_AT_KEY);
    if (!trimmed) delete stamps[key];
    else stamps[key] = todayISO();
    persistMap(STATUS_SET_AT_KEY, stamps, CLIENT_STATUS_SET_AT_EVENT);
  }
}

// Set (or clear, with a falsy iso) the "status set at" stamp directly —
// used to start the clock on a status that predates the stamp store.
export function setClientStatusSetAt(company, iso) {
  const key = normKey(company);
  if (!key) return;
  const stamps = loadMap(STATUS_SET_AT_KEY);
  if (!iso) delete stamps[key];
  else stamps[key] = iso;
  persistMap(STATUS_SET_AT_KEY, stamps, CLIENT_STATUS_SET_AT_EVENT);
}

export function setClientUntracked(company, checked) {
  const key = normKey(company);
  if (!key) return;
  const map = loadClientUntrackedMap();
  if (checked) map[key] = true;
  else delete map[key];
  persistMap(UNTRACKED_KEY, map, CLIENT_UNTRACKED_EVENT);
}

export function setClientNotes(company, value) {
  const key = normKey(company);
  if (!key) return;
  const map = loadClientNotesMap();
  // Notes preserve leading/trailing newlines the user typed; only drop
  // the entry when it's purely whitespace.
  const next = String(value ?? '');
  if (!next.trim()) delete map[key];
  else map[key] = next;
  persistMap(NOTES_KEY, map, CLIENT_NOTES_EVENT);
}

// Every per-client typed field, paired with its change event, so a rename
// can sweep all of them in one place.
const ALL_CLIENT_MAPS = [
  [MANAGER_KEY, CLIENT_MANAGER_EVENT],
  [IN_PERSON_KEY, CLIENT_IN_PERSON_EVENT],
  [STATUS_KEY, CLIENT_STATUS_EVENT],
  [STATUS_SET_AT_KEY, CLIENT_STATUS_SET_AT_EVENT],
  [NOTES_KEY, CLIENT_NOTES_EVENT],
  [UNTRACKED_KEY, CLIENT_UNTRACKED_EVENT],
  [LOUISVILLE_KEY, CLIENT_LOUISVILLE_EVENT],
];

// Every one of those is mirrored to Firestore. They are the fields typed
// straight onto the Clients tab — "Don't Track" among them, which decides
// whether a client is chased on the Issues tab — and until now they existed
// in one browser and nowhere else. Registered off ALL_CLIENT_MAPS so a
// field added there is mirrored without a second edit here.
for (const [mirroredKey, mirroredEvent] of ALL_CLIENT_MAPS) {
  registerMirroredKey(mirroredKey, mirroredEvent);
}

// How many per-client field values would move if `oldName` were renamed to
// `newName` — for the rename-confirmation summary. A field only moves when
// the new name doesn't already carry its own value (we never clobber data
// the user entered under the new name).
export function countClientFieldRenames(oldName, newName) {
  const o = normKey(oldName);
  const n = normKey(newName);
  if (!o || !n || o === n) return 0;
  let count = 0;
  for (const [key] of ALL_CLIENT_MAPS) {
    const map = loadMap(key);
    if (map[o] !== undefined && map[n] === undefined) count++;
  }
  return count;
}

// Move the Client Manager / In Person / Status / Notes / Untracked /
// Louisville values from `oldName` to `newName` so the typed Clients-tab
// data follows a company rename instead of stranding under the old name.
// Returns the number of field values moved.
export function renameClientFields(oldName, newName) {
  const o = normKey(oldName);
  const n = normKey(newName);
  if (!o || !n || o === n) return 0;
  let count = 0;
  for (const [key, evt] of ALL_CLIENT_MAPS) {
    const map = loadMap(key);
    if (map[o] !== undefined && map[n] === undefined) {
      map[n] = map[o];
      delete map[o];
      persistMap(key, map, evt);
      count++;
    }
  }
  return count;
}

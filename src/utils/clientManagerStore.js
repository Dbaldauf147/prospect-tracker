// Per-client fields typed directly on the Clients tab — Client Manager
// name, In Person Meeting flag, and the user's custom Status. Each
// lives in its own localStorage key so a missing field doesn't blow
// away the others, and each is keyed by the normalized company name so
// casing / whitespace drift doesn't fragment the data across imports.

const MANAGER_KEY = 'clients-manager-map';
const IN_PERSON_KEY = 'clients-inperson-map';
const STATUS_KEY = 'clients-status-map';
const NOTES_KEY = 'clients-notes-map';
export const CLIENT_MANAGER_EVENT = 'client-manager-changed';
export const CLIENT_IN_PERSON_EVENT = 'client-inperson-changed';
export const CLIENT_STATUS_EVENT = 'client-status-changed';
export const CLIENT_NOTES_EVENT = 'client-notes-changed';

function normKey(s) { return String(s || '').trim().toLowerCase(); }

function loadMap(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) || {}) : {};
  } catch { return {}; }
}

function persistMap(key, map, eventName) {
  try {
    localStorage.setItem(key, JSON.stringify(map || {}));
    window.dispatchEvent(new Event(eventName));
  } catch (err) {
    console.warn(`Failed to persist ${key}`, err);
  }
}

export function loadClientManagerMap() { return loadMap(MANAGER_KEY); }
export function loadClientInPersonMap() { return loadMap(IN_PERSON_KEY); }
export function loadClientStatusMap() { return loadMap(STATUS_KEY); }
export function loadClientNotesMap() { return loadMap(NOTES_KEY); }

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

export function setClientStatus(company, value) {
  const key = normKey(company);
  if (!key) return;
  const map = loadClientStatusMap();
  const trimmed = String(value || '').trim();
  if (!trimmed) delete map[key];
  else map[key] = trimmed;
  persistMap(STATUS_KEY, map, CLIENT_STATUS_EVENT);
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

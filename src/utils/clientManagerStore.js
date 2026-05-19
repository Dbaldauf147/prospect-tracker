// Per-client "Client Manager" name typed on the Clients tab. Keyed by
// the normalized company name so casing / whitespace drift between the
// Clients table and any future import doesn't fragment the map.

const KEY = 'clients-manager-map';
export const CLIENT_MANAGER_EVENT = 'client-manager-changed';

function normKey(s) { return String(s || '').trim().toLowerCase(); }

export function loadClientManagerMap() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) || {}) : {};
  } catch { return {}; }
}

export function setClientManager(company, name) {
  const key = normKey(company);
  if (!key) return;
  const map = loadClientManagerMap();
  const trimmed = String(name || '').trim();
  if (!trimmed) delete map[key];
  else map[key] = trimmed;
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
    window.dispatchEvent(new Event(CLIENT_MANAGER_EVENT));
  } catch (err) {
    console.warn('Failed to persist client manager map', err);
  }
}

export function getClientManager(company, map) {
  const key = normKey(company);
  if (!key) return '';
  return (map || loadClientManagerMap())[key] || '';
}

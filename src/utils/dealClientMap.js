// Persists user-confirmed mappings from a deal-row Client Name to a
// canonical client (prospect company name). Keyed by the lowercased
// trimmed source name so casing / whitespace drift in the pasted data
// doesn't fragment the map across imports of the same tracker.

const KEY = 'deals-client-map';
export const DEALS_CLIENT_MAP_EVENT = 'deals-client-map-changed';

export function loadDealClientMap() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) || {}) : {};
  } catch { return {}; }
}

function persist(map) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map || {}));
    window.dispatchEvent(new Event(DEALS_CLIENT_MAP_EVENT));
  } catch (err) {
    console.warn('Failed to persist deal client map', err);
  }
}

export function setDealClientMapping(sourceName, target) {
  const key = String(sourceName || '').toLowerCase().trim();
  if (!key) return;
  const map = loadDealClientMap();
  if (target == null || target === '') delete map[key];
  else map[key] = String(target);
  persist(map);
}

// Resolves a deal row's Client Name to its canonical client name. When
// the user has set an explicit mapping for this source name, returns
// the mapped target; otherwise returns the source name unchanged so
// auto-matching (case-insensitive equality against the prospect pool)
// can still kick in downstream.
export function resolveClientName(sourceName, map) {
  const key = String(sourceName || '').toLowerCase().trim();
  if (!key) return '';
  const explicit = (map || loadDealClientMap())[key];
  return explicit || sourceName || '';
}

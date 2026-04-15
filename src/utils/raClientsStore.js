// Loads the effective RA Clients list — user-uploaded override (localStorage)
// takes precedence over the bundled default in src/data/raClients.json.
import defaultRaClients from '../data/raClients.json';

const KEY = 'ra-clients-override';

export function loadEffectiveRaClients() {
  try {
    const raw = localStorage.getItem(KEY);
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
  localStorage.setItem(KEY, JSON.stringify(arr));
}

export function clearRaClientsOverride() {
  localStorage.removeItem(KEY);
}

export function hasRaClientsOverride() {
  try {
    return !!localStorage.getItem(KEY);
  } catch {
    return false;
  }
}

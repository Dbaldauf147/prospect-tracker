// Persists the user's pasted Commissions table in localStorage. Empty
// until the first paste-import — the Commissions subtab on the
// Clients view greets a blank slate with a Paste-from-Sheets prompt.

const KEY = 'commissions-list-override';

export function loadCommissions() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return { data: parsed, source: 'override', count: parsed.length };
    }
  } catch (err) {
    console.error('Failed to read commissions override:', err);
  }
  return { data: [], source: 'empty', count: 0 };
}

export function saveCommissionsOverride(arr) {
  if (!Array.isArray(arr)) throw new Error('Commissions override must be an array');
  localStorage.setItem(KEY, JSON.stringify(arr));
}

export function clearCommissionsOverride() {
  localStorage.removeItem(KEY);
}

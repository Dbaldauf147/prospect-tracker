// Persists a user-uploaded Deals roster in localStorage. No bundled
// default — the Deals sub-tab starts empty until the user uploads
// their tracker workbook.

const KEY = 'deals-list-override';

export function loadDealsList() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return { data: parsed, source: 'override', count: parsed.length };
    }
  } catch (err) {
    console.error('Failed to read deals override:', err);
  }
  return { data: [], source: 'empty', count: 0 };
}

export function saveDealsOverride(arr) {
  if (!Array.isArray(arr)) throw new Error('Deals override must be an array');
  localStorage.setItem(KEY, JSON.stringify(arr));
}

export function clearDealsOverride() {
  localStorage.removeItem(KEY);
}

export function hasDealsOverride() {
  try { return !!localStorage.getItem(KEY); } catch { return false; }
}

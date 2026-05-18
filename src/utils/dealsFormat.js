// Cell formatters shared between the Deals subtab and the Clients-tab
// contract drill-down. Both views show the same Excel-derived data,
// so currency / percent / date / yes-no rendering lives here once.

export function asNumber(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const cleaned = String(v).replace(/[\s,$]/g, '').replace(/%$/, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function fmtCurrency(v) {
  const n = asNumber(v);
  if (n == null) return v ?? '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

export function fmtPercent(v) {
  const n = asNumber(v);
  if (n == null) return v ?? '';
  // Excel often gives 0.10 for 10%; treat anything ≤1 as already a fraction.
  const pct = Math.abs(n) <= 1 ? n * 100 : n;
  return `${pct.toFixed(2)}%`;
}

export function fmtDate(v) {
  if (v == null || v === '') return '';
  // Excel serial date numbers (days since 1899-12-30).
  if (typeof v === 'number' && Number.isFinite(v)) {
    const ms = (v - 25569) * 86400 * 1000;
    const d = new Date(ms);
    if (!isNaN(d)) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  const d = new Date(v);
  if (!isNaN(d) && String(v).length >= 6) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return String(v);
}

export function isTruthy(v) {
  if (v == null || v === '') return false;
  const s = String(v).trim().toLowerCase();
  return s === 'yes' || s === 'y' || s === 'true' || s === 'x' || s === '✓' || s === 'done' || s === '1';
}

export const DEAL_CURRENCY_KEYS = new Set([
  'Setup', 'Recurring Revenue', 'Commission', 'Revenue Recorded',
  'Paid to Date', 'Delta', 'GM', 'Current Value',
]);
export const DEAL_DATE_KEYS = new Set([
  'Current Term Start Date', 'Original Contract Start', 'Due Date',
  'End Date', 'Follow Up On Sale',
]);
export const DEAL_PERCENT_KEYS = new Set(['Commission Rate', 'Esc']);
export const DEAL_CHECK_KEYS = new Set([
  'Paperwork completed', 'Billing information collected', 'Closed Won',
  'On Client Tracker?', 'BFO - Close after contract execution email has been sent',
  'Currently being paid', 'Auto renewal?', 'SUCON?', 'Combined',
  'Comm Tracker?', 'Comm Tracker?2', 'Comm Tracker?3',
  'Comm Tracker?4', 'Comm Tracker?5', 'Comm Tracker?6',
  'Commission Sheet Sent to Kathy',
]);

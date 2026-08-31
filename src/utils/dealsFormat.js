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
  // Round to the nearest dollar — the trailing .00 on every cell was
  // noisy in the Deals tab where amounts are reviewed at a glance.
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  });
}

export function fmtPercent(v) {
  const n = asNumber(v);
  if (n == null) return v ?? '';
  // Excel often gives 0.10 for 10%; treat anything ≤1 as already a fraction.
  const pct = Math.abs(n) <= 1 ? n * 100 : n;
  // Drop trailing zeros so 20.00% reads as 20%; keep up to 2 decimals
  // for values that actually need them.
  return `${pct.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 0 })}%`;
}

// Parse a deal cell into a JS Date, or null if it isn't one. Used by
// both the formatter below and the sort comparator so the column
// sorts the same way it displays. Handles ISO strings, locale date
// strings (M/D/YYYY), JS Date instances, and the Excel serial format
// XLSX emits when cellDates is off.
export function asDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date((v - 25569) * 86400 * 1000);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const s = String(v).trim();
  if (s.length < 6) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

// The Paperwork column doubles as a status field — "Cancelled" / "Expired"
// mark agreements that no longer count regardless of their End Date.
const INACTIVE_STATUSES = new Set(['cancelled', 'canceled', 'expired']);
export function isInactiveAgreement(deal) {
  const status = String(deal?.['Paperwork completed'] || '').trim().toLowerCase();
  return INACTIVE_STATUSES.has(status);
}

// Expired, as the Deals page greys and sinks it: the user has marked the
// Paperwork column "Expired". Nothing else — a hand-set flag, not a
// derived one.
//
// A past End Date deliberately does NOT count. Agreements outlive the
// date on them all the time: they auto-renew, get amended, or are simply
// still being paid on while the sheet's date goes stale. Deriving expiry
// from the date greyed out live contracts, which is worse than missing
// one that was never marked — the user can mark it.
//
// Narrower than isInactiveAgreement above, which also counts Cancelled.
// Cancelled and expired are different events and the Deals page is only
// asked to show the second, so the two predicates stay separate rather
// than one calling the other.
export function isExpiredDeal(deal) {
  return String(deal?.['Paperwork completed'] || '').trim().toLowerCase() === 'expired';
}

// The calendar year a deal belongs to, derived from its Original Contract
// Start date. This is what the Deals tab renders in its read-only Year
// column, so anything that buckets deals by year (e.g. the YOY Commissions
// chart) must use this rather than the raw, often-blank stored 'Year' cell
// — otherwise a deal that shows 2026 from its contract date gets skipped.
// Returns '' when the date is missing or unparseable.
export function dealYear(row) {
  const d = asDate(row?.['Original Contract Start']);
  return d ? String(d.getFullYear()) : '';
}

export function fmtDate(v) {
  const d = asDate(v);
  if (!d) return v == null ? '' : String(v);
  // Short numeric format (M/D/YYYY) — easier to scan and sorts cleanly
  // when the underlying value is sent through asDate(...).getTime().
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
}

export function isTruthy(v) {
  if (v == null || v === '') return false;
  const s = String(v).trim().toLowerCase();
  return s === 'yes' || s === 'y' || s === 'true' || s === 'x' || s === '✓' || s === 'done' || s === '1';
}

export const DEAL_CURRENCY_KEYS = new Set([
  'Setup', 'Recurring Revenue', 'Commission', 'Revenue Recorded',
  'Paid to Date', 'Delta', 'Current Value',
]);
export const DEAL_DATE_KEYS = new Set([
  'Current Term Start Date', 'Original Contract Start', 'Due Date',
  'End Date', 'Follow Up On Sale',
]);
export const DEAL_PERCENT_KEYS = new Set(['Commission Rate', 'Esc', 'GM']);
export const DEAL_CHECK_KEYS = new Set([
  'Paperwork completed', 'Billing information collected', 'Closed Won',
  'On Client Tracker?', 'BFO - Close after contract execution email has been sent',
  'Currently being paid', 'Auto renewal?', 'SUCON?', 'Combined',
  'Comm Tracker?', 'Comm Tracker?2', 'Comm Tracker?3',
  'Comm Tracker?4', 'Comm Tracker?5', 'Comm Tracker?6',
  'Commission Sheet Sent to Kathy',
]);

// Shared Deals ↔ Commissions matching helpers. Lives in its own module
// so both the Deals grid and the YOY Commissions chart can roll the
// Commissions roster up by BFO opp name without importing one component
// into another (which would also break Fast Refresh).

import { asNumber, asDate, fmtDate } from './dealsFormat.js';
import { COMMISSION_MONTH_NAMES } from './commissionsStore.js';

// The deal column holding the BFO opp name. It's the verbose label the
// user originally pasted from their tracker; the deal is matched against
// the Commissions tab's BFO Name column so the Revenue Recorded / Paid
// to Date cells can auto-populate from the matching roster rows.
export const DEAL_BFO_KEY = 'BFO - Close after contract execution email has been sent';

// Commissions tab stores monthly cells under year-agnostic month names:
// "January" for the commission $ and "January Revenue" for the
// underlying project revenue. Lookups here run against those keys.
const COMMISSION_MONTH_NAME_SET = new Set(COMMISSION_MONTH_NAMES);
function isCommissionMonthlyRevenueKey(k) {
  const s = String(k || '').trim();
  if (!s.endsWith(' Revenue')) return false;
  return COMMISSION_MONTH_NAME_SET.has(s.slice(0, s.length - ' Revenue'.length));
}
function isCommissionMonthlyKey(k) { return COMMISSION_MONTH_NAME_SET.has(String(k || '').trim()); }

// Normalize a BFO opp name for matching across Deals ↔ Commissions —
// the user copies and pastes the same identifier on both tabs so a
// loose compare (trimmed, lowercased, internal whitespace collapsed)
// shouldn't drop matches over trivial typing differences.
export function normBfo(v) {
  return String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Where a deal stands on getting its commissions in, as the user calls
// it. Lives in the sheet's own Comm Status column rather than off to the
// side: that column already answered this question by hand, and two
// places to say the same thing is one place to disagree. Setting the
// status in the modal writes the label there, and typing the label into
// the grid cell sets the status — same field, two ways in.
export const DEAL_COMM_STATUS_KEY = 'Comm Status';
// Where the status used to live. Still read, so a deal flagged before the
// move keeps its status, but never written.
export const DEAL_TRACK_STATUS_KEY = '__commTrackStatus';
export const DEAL_TRACK_STATUSES = [
  { key: 'missing', label: 'Missing', bg: '#FEE2E2', fg: '#991B1B', border: '#FECACA' },
  { key: 'on-track', label: 'On track', bg: '#DBEAFE', fg: '#1E40AF', border: '#BFDBFE' },
  { key: 'complete', label: 'Completed', bg: '#DCFCE7', fg: '#166534', border: '#BBF7D0' },
];
export const DEAL_TRACK_STATUS_UNSET = { key: '', label: 'Not set', bg: '#F1F5F9', fg: '#64748B', border: '#E2E8F0' };

// Letters and digits only, so "On track", "on-track" and "ontrack" are
// one value — the cell is hand-typed and pasted from a sheet, and a
// hyphen shouldn't decide whether a deal counts as tracked.
function trackStatusKey(v) {
  return String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
const TRACK_STATUS_BY_KEY = new Map();
for (const s of DEAL_TRACK_STATUSES) {
  TRACK_STATUS_BY_KEY.set(trackStatusKey(s.key), s);
  TRACK_STATUS_BY_KEY.set(trackStatusKey(s.label), s);
}

// Anything else in Comm Status — "Payment in progress", "Fully paid", a
// note someone typed — is left as it is and reads as unset. The column
// carries whatever the sheet carried; only the three status labels mean
// something to the grid.
export function dealTrackStatus(row) {
  return TRACK_STATUS_BY_KEY.get(trackStatusKey(row?.[DEAL_COMM_STATUS_KEY]))
    || TRACK_STATUS_BY_KEY.get(trackStatusKey(row?.[DEAL_TRACK_STATUS_KEY]))
    || DEAL_TRACK_STATUS_UNSET;
}

// The cell patch that sets (or clears) a deal's status. Clearing empties
// Comm Status rather than leaving the old label behind, and every write
// drops the legacy key so the two can't drift apart.
export function dealTrackStatusPatch(statusKey) {
  const hit = DEAL_TRACK_STATUSES.find((s) => s.key === statusKey);
  return { [DEAL_COMM_STATUS_KEY]: hit ? hit.label : '', [DEAL_TRACK_STATUS_KEY]: '' };
}

// A deal the user has marked On track or Completed: the two states that
// say this one needs no chasing. Drives the grid's green row tint.
export function isDealTrackHealthy(row) {
  const key = dealTrackStatus(row).key;
  return key === 'on-track' || key === 'complete';
}

// A saved payout projection: the month range it covers and the monthly
// amounts it assumes. Kept as calendar months (YYYY-MM) rather than a
// rolling count so the horizon stays put as real months get recorded —
// each month that lands simply consumes one projected column.
export const DEAL_PROJ_START_KEY = '__projStart';
export const DEAL_PROJ_END_KEY = '__projEnd';
export const DEAL_PROJ_REVENUE_KEY = '__projRevenue';
export const DEAL_PROJ_COMMISSION_KEY = '__projCommission';

// "2027-07" ↔ { year: 2027, idx: 6 }. idx is the 0-based month index the
// Commissions month columns are keyed by.
export function parseProjMonth(v) {
  const m = /^(\d{4})-(\d{1,2})$/.exec(String(v ?? '').trim());
  if (!m) return null;
  const idx = Number(m[2]) - 1;
  if (idx < 0 || idx > 11) return null;
  return { year: Number(m[1]), idx };
}
export function formatProjMonth(col) {
  if (!col || col.year == null) return '';
  return `${col.year}-${String(col.idx + 1).padStart(2, '0')}`;
}

// The deal's saved projection, or null when none is stored / it's
// unreadable. Amounts default to 0 so a partially written record still
// renders instead of throwing the modal off.
export function readSavedProjection(deal) {
  const start = parseProjMonth(deal?.[DEAL_PROJ_START_KEY]);
  const end = parseProjMonth(deal?.[DEAL_PROJ_END_KEY]);
  if (!start || !end) return null;
  const num = (v) => { const n = Number(String(v ?? '').replace(/[\s,$]/g, '')); return Number.isFinite(n) ? n : 0; };
  return {
    start, end,
    revenue: num(deal?.[DEAL_PROJ_REVENUE_KEY]),
    commission: num(deal?.[DEAL_PROJ_COMMISSION_KEY]),
  };
}

// Every Commissions-tab row mapped to a deal, matched on the deal's BFO
// opp name. Shared by the per-metric breakdown popup and the row-level
// deal history modal so both drill-downs agree on what "this deal's
// commission rows" means. Returns [] when the deal has no BFO name.
export function matchCommissionRowsForDeal(deal, rows) {
  const bfo = normBfo(deal?.[DEAL_BFO_KEY]);
  if (!bfo) return [];
  return (rows || []).filter((r) => normBfo(r?.['BFO Name']) === bfo);
}

// Mirror of the Commissions tab's Payment Status logic, run against the
// per-BFO aggregate so a deal that maps to multiple commission rows
// gets a single Active / Stopped read-out. Prefers the latest Comm End
// Date across matching rows; falls back to the latest non-zero
// commission month versus today when no end date is on file.
function computePaymentStatus(info) {
  if (info.endDate) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const e = new Date(info.endDate); e.setHours(0, 0, 0, 0);
    if (e.getTime() < today.getTime()) {
      return { state: 'stopped', label: 'Stopped', title: `Comm End Date ${fmtDate(info.endDate)} is in the past` };
    }
    return { state: 'active', label: 'Active', title: `Comm End Date ${fmtDate(info.endDate)}` };
  }
  let lastIdx = -1;
  for (let m = 0; m < 12; m++) if (info.monthlyComm[m] !== 0) lastIdx = m;
  if (lastIdx === -1) return { state: 'unknown', label: '-', title: 'No Comm End Date and no commission entries on file' };
  const todayMonthIdx = new Date().getMonth();
  if (lastIdx >= todayMonthIdx - 1) {
    return { state: 'active', label: 'Active', title: `Most recent commission: ${COMMISSION_MONTH_NAMES[lastIdx]}` };
  }
  return { state: 'stopped', label: 'Stopped', title: `Most recent commission: ${COMMISSION_MONTH_NAMES[lastIdx]}: no payments since` };
}

// Roll the Commissions roster into a map keyed by normalized BFO Name,
// summing each project's monthly revenue / commission cells. Multiple
// commission rows that share a BFO Name (different project lines of
// the same opp) accumulate into a single total, and the latest Comm
// End Date across them feeds the Payment Status read-out. Returns an
// empty Map when nothing is on file so callers can treat the lookup
// uniformly.
export function indexCommissionsByBfo(rows) {
  const map = new Map();
  for (const row of (rows || [])) {
    const key = normBfo(row?.['BFO Name']);
    if (!key) continue;
    let revenue = 0;
    let commission = 0;
    const monthlyComm = new Array(12).fill(0);
    const endDate = asDate(row?.['Comm End Date']);
    for (const [k, v] of Object.entries(row)) {
      const n = asNumber(v);
      if (n == null) continue;
      if (isCommissionMonthlyRevenueKey(k)) {
        revenue += n;
        continue;
      }
      if (isCommissionMonthlyKey(k)) {
        commission += n;
        const idx = COMMISSION_MONTH_NAMES.indexOf(String(k).trim());
        if (idx >= 0) monthlyComm[idx] += n;
      }
    }
    const prev = map.get(key);
    if (prev) {
      prev.revenue += revenue;
      prev.commission += commission;
      prev.rows += 1;
      for (let i = 0; i < 12; i++) prev.monthlyComm[i] += monthlyComm[i];
      if (endDate && (!prev.endDate || endDate.getTime() > prev.endDate.getTime())) {
        prev.endDate = endDate;
      }
    } else {
      map.set(key, { revenue, commission, rows: 1, monthlyComm, endDate: endDate || null });
    }
  }
  for (const info of map.values()) info.paymentStatus = computePaymentStatus(info);
  return map;
}

// Shared Deals ↔ Commissions matching helpers. Lives in its own module
// so both the Deals grid and the YOY Commissions chart can roll the
// Commissions roster up by BFO opp name without importing one component
// into another (which would also break Fast Refresh).

import { asNumber, asDate, fmtDate } from './dealsFormat';
import { COMMISSION_MONTH_NAMES } from './commissionsStore';

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
  if (lastIdx === -1) return { state: 'unknown', label: '—', title: 'No Comm End Date and no commission entries on file' };
  const todayMonthIdx = new Date().getMonth();
  if (lastIdx >= todayMonthIdx - 1) {
    return { state: 'active', label: 'Active', title: `Most recent commission: ${COMMISSION_MONTH_NAMES[lastIdx]}` };
  }
  return { state: 'stopped', label: 'Stopped', title: `Most recent commission: ${COMMISSION_MONTH_NAMES[lastIdx]} — no payments since` };
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

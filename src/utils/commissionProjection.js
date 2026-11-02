// Commissions > Projected: what each commission should pay over a full
// 12-month commission year, from the roster on file.
//
// Only two kinds of row are projected:
//  - "Being paid": Payment Status is Active and at least one month has paid.
//    Expected monthly = the latest month's commission (the current amount).
//  - "Not yet paid": no month has paid yet, the row has a Comm Start Date,
//    and its Comm End Date (if any) hasn't passed. Expected monthly comes
//    from the row's own revenue cells x %, else the linked opp's Quoted
//    Amount x % / 12.
// Everything else (stopped, undated, ignored) is left out.
//
// Projected 12-mo = expected monthly x 12. Still to come = that, less what
// has already been paid on the row.
//
// The upcoming-months helpers at the bottom spread that expected monthly
// amount over this month and the next three, inside each commission's
// start-to-end window.

import { asNumber, asDate } from './dealsFormat.js';

export const PROJECTION_MONTHS = 12;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// '%' arrives either as 9 / "9%" or as 0.09; return the fraction.
export function commissionRate(v) {
  const n = asNumber(v);
  if (n == null || n <= 0) return null;
  return n <= 1 ? n : n / 100;
}

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

// Month cells with a non-zero value, in commission-year order: from the Comm
// Start Date's month onward (wrapping), or January onward without one. So
// for a July-June year, May reads as later than October.
function paidMonths(row) {
  const start = asDate(row?.['Comm Start Date']);
  const first = start ? start.getMonth() : 0;
  const out = [];
  for (let k = 0; k < 12; k++) {
    const idx = (first + k) % 12;
    const n = asNumber(row?.[MONTHS[idx]]);
    if (n != null && n !== 0) out.push({ idx, amount: n });
  }
  return out;
}

function averageRevenue(row) {
  let total = 0, count = 0;
  for (const m of MONTHS) {
    const n = asNumber(row?.[`${m} Revenue`]);
    if (n != null && n !== 0) { total += n; count++; }
  }
  return count ? total / count : null;
}

// One row's projection, or null when the row isn't being paid or upcoming.
// `status` is the row's Payment Status state ('active' / 'stopped' /
// 'unknown'); `opp` is its linked Opps record, if any.
export function projectCommissionRow(row, { status, opp = null, today = new Date() } = {}) {
  if (!row || row.__ignored) return null;
  const paid = paidMonths(row);
  const paidSoFar = paid.reduce((s, m) => s + m.amount, 0);
  const rate = commissionRate(row['%']);

  if (paid.length > 0) {
    if (status !== 'active') return null;
    const latest = paid[paid.length - 1];
    const expectedMonthly = latest.amount;
    const projected = expectedMonthly * PROJECTION_MONTHS;
    return {
      category: 'paying',
      monthsPaid: paid.length,
      paidSoFar,
      currentMonthly: latest.amount,
      currentMonth: MONTHS[latest.idx],
      expectedMonthly,
      expectedSource: `Latest commission paid (${MONTHS[latest.idx]})`,
      projected,
      remaining: Math.max(0, projected - paidSoFar),
    };
  }

  const start = asDate(row['Comm Start Date']);
  if (!start) return null;
  const end = asDate(row['Comm End Date']);
  if (end && startOfDay(end).getTime() < startOfDay(today).getTime()) return null;

  let expectedMonthly = null;
  let expectedSource = '';
  const revenue = averageRevenue(row);
  if (revenue != null && rate != null) {
    expectedMonthly = revenue * rate;
    expectedSource = 'Monthly revenue on file x %';
  } else {
    const quoted = asNumber(opp?.['Quoted Amount']);
    if (quoted != null && quoted > 0 && rate != null) {
      expectedMonthly = (quoted * rate) / PROJECTION_MONTHS;
      expectedSource = "Opp's Quoted Amount x % / 12";
    } else {
      expectedSource = rate == null
        ? 'No % on file, so no expected amount yet'
        : 'No revenue on file and no Quoted Amount on the linked opp';
    }
  }
  const projected = expectedMonthly == null ? null : expectedMonthly * PROJECTION_MONTHS;
  return {
    category: 'notYet',
    monthsPaid: 0,
    paidSoFar: 0,
    currentMonthly: null,
    currentMonth: '',
    expectedMonthly,
    expectedSource,
    projected,
    remaining: projected,
  };
}

// Totals per category for the summary strip.
export function projectionTotals(items) {
  const blank = () => ({ count: 0, currentMonthly: 0, expectedMonthly: 0, projected: 0, paidSoFar: 0, remaining: 0 });
  const out = { paying: blank(), notYet: blank(), all: blank() };
  for (const it of items || []) {
    const p = it?.projection;
    if (!p) continue;
    for (const t of [out[p.category], out.all]) {
      t.count++;
      t.currentMonthly += p.currentMonthly || 0;
      t.expectedMonthly += p.expectedMonthly || 0;
      t.projected += p.projected || 0;
      t.paidSoFar += p.paidSoFar || 0;
      t.remaining += p.remaining || 0;
    }
  }
  return out;
}

// ---- Upcoming months -------------------------------------------------------
// This month plus the next `ahead` months, each as { year, monthIdx, key,
// label }: in November 2026 with ahead = 3, that is Nov 2026 - Feb 2027.
export const UPCOMING_MONTHS_AHEAD = 3;

export function upcomingMonths(today = new Date(), ahead = UPCOMING_MONTHS_AHEAD) {
  const out = [];
  for (let k = 0; k <= ahead; k++) {
    const d = new Date(today.getFullYear(), today.getMonth() + k, 1);
    const monthIdx = d.getMonth();
    out.push({
      year: d.getFullYear(),
      monthIdx,
      key: `${d.getFullYear()}-${String(monthIdx + 1).padStart(2, '0')}`,
      label: `${MONTHS[monthIdx].slice(0, 3)} ${d.getFullYear()}`,
    });
  }
  return out;
}

function monthNumber(d) { return d.getFullYear() * 12 + d.getMonth(); }

// The commission's window as month numbers: Comm Start Date's month through
// Comm End Date's month, or 12 months from the start when no end is on file.
// Null when there's no start date to anchor it.
function windowMonths(row) {
  const start = asDate(row?.['Comm Start Date']);
  if (!start) return null;
  const end = asDate(row?.['Comm End Date']);
  const first = monthNumber(start);
  const last = end ? monthNumber(end) : first + PROJECTION_MONTHS - 1;
  return { first, last };
}

// Expected commission for one row in one upcoming month: 0 outside the
// commission's window; inside it, the amount already recorded for the
// current month if that month has paid, otherwise the expected monthly
// amount (null when there's nothing to price it from). A row with no Comm
// Start Date can't be placed in time, so it is projected for every month.
export function expectedForMonth(row, projection, month, today = new Date()) {
  if (!projection) return null;
  const n = month.year * 12 + month.monthIdx;
  const w = windowMonths(row);
  if (w && (n < w.first || n > w.last)) return 0;
  if (n === monthNumber(today)) {
    const actual = asNumber(row?.[MONTHS[month.monthIdx]]);
    if (actual != null && actual !== 0 && projection.category === 'paying') return actual;
  }
  return projection.expectedMonthly;
}

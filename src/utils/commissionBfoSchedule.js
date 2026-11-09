// Commissions > BFO opp popup: one BFO opp's revenue and commission, month
// by month, as two tables.
//
// Actual: what the Commissions roster has recorded, summed over every row
// tied to the opp. The roster's month cells are year-agnostic ("March",
// "March Revenue"), so each row's Comm Start - End window pins them to real
// months: a recorded cell lands on that month inside the window, and when a
// window runs past 12 months (so a month name occurs twice) on the latest
// occurrence that isn't in the future. A row with no Comm Start Date can't
// be placed in time, so its cells are read as this calendar year.
//
// Expected: what the Deals page expects, summed over every deal whose BFO
// opp name matches, spread over each deal's term:
//  - Revenue: Setup in the term's first month, Recurring Revenue evenly
//    over every month of the term.
//  - Commission: the share that comes from Setup (Commission x Setup /
//    (Setup + Recurring Revenue)) in the first month, the rest evenly.
// The term is the commission rows' Comm Start - End window (as the Deals
// page's own history popup reads it), else the deal's Current Term Start
// Date (or Original Contract Start) to its End Date, 12 months when no end
// is on file. A deal with no dates at all can't be placed and is counted
// as undated.

import { asNumber, asDate } from './dealsFormat.js';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DEFAULT_TERM_MONTHS = 12;

// Never draw more than this many month columns, however long a window runs.
export const MAX_SCHEDULE_MONTHS = 36;

export function normBfoKey(v) {
  return String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function monthNumber(d) { return d.getFullYear() * 12 + d.getMonth(); }

function rowWindow(row, today) {
  const start = asDate(row?.['Comm Start Date']);
  if (!start) {
    const y = today.getFullYear() * 12;
    return { first: y, last: y + 11 };
  }
  const end = asDate(row?.['Comm End Date']);
  const first = monthNumber(start);
  let last = end ? monthNumber(end) : first + DEFAULT_TERM_MONTHS - 1;
  if (last < first) last = first;
  return { first, last };
}

// Month number each calendar month's cell belongs to inside the window.
function placeMonths(win, todayN) {
  const out = new Array(12).fill(null);
  for (let n = win.first; n <= win.last; n++) {
    const idx = ((n % 12) + 12) % 12;
    if (out[idx] == null || n <= todayN) out[idx] = n;
  }
  return out;
}

function dealWindow(deal, rows) {
  let first = null, last = null;
  for (const r of rows || []) {
    const s = asDate(r?.['Comm Start Date']);
    const e = asDate(r?.['Comm End Date']);
    if (s && (first == null || monthNumber(s) < first)) first = monthNumber(s);
    if (e && (last == null || monthNumber(e) > last)) last = monthNumber(e);
  }
  if (first == null) {
    const s = asDate(deal?.['Current Term Start Date']) || asDate(deal?.['Original Contract Start']);
    if (s) first = monthNumber(s);
  }
  if (last == null) {
    const e = asDate(deal?.['End Date']);
    if (e) last = monthNumber(e);
  }
  if (first == null) return null;
  if (last == null || last < first) last = first + DEFAULT_TERM_MONTHS - 1;
  return { first, last };
}

// One deal's revenue and commission, each as month number -> amount.
function dealPlan(deal, rows) {
  const win = dealWindow(deal, rows);
  const revenue = new Map();
  const commission = new Map();
  if (!win) return { win, revenue, commission };
  const total = asNumber(deal?.['Commission']) ?? 0;
  const setup = asNumber(deal?.['Setup']) ?? 0;
  const recurring = asNumber(deal?.['Recurring Revenue']) ?? 0;
  const span = win.last - win.first + 1;
  const base = setup + recurring;
  const setupShare = base > 0 && setup > 0 ? total * (setup / base) : 0;
  for (let n = win.first; n <= win.last; n++) {
    const lead = n === win.first;
    if (setup || recurring) revenue.set(n, recurring / span + (lead ? setup : 0));
    if (total) commission.set(n, (total - setupShare) / span + (lead ? setupShare : 0));
  }
  return { win, revenue, commission };
}

function monthLabel(n) {
  const year = Math.floor(n / 12);
  const idx = n - year * 12;
  return { key: `${year}-${String(idx + 1).padStart(2, '0')}`, label: `${MONTHS[idx].slice(0, 3)} ${year}`, year, monthIdx: idx, n };
}

// `rows`: the commission rows for one BFO opp (ignored ones already left
// out). `deals`: the Deals-page rows tied to the same opp.
// Returns { months, actual, expected }. actual and expected each hold
// { revenue, commission } lines of { cells, total }, cells aligned to
// months (null where nothing lands); expected also carries { deals, undated }.
export function buildBfoSchedule(rows, { deals = [], today = new Date() } = {}) {
  const todayN = monthNumber(today);
  const items = (rows || []).map((row) => {
    const win = rowWindow(row, today);
    return { row, win, placed: placeMonths(win, todayN) };
  });
  const plans = (deals || []).map((deal) => dealPlan(deal, rows));

  let first = null, last = null;
  for (const w of [...items.map((it) => it.win), ...plans.map((p) => p.win).filter(Boolean)]) {
    if (first == null || w.first < first) first = w.first;
    if (last == null || w.last > last) last = w.last;
  }
  if (first == null) { first = today.getFullYear() * 12; last = first + 11; }
  if (last - first + 1 > MAX_SCHEDULE_MONTHS) last = first + MAX_SCHEDULE_MONTHS - 1;
  const months = [];
  for (let n = first; n <= last; n++) months.push({ ...monthLabel(n), isCurrent: n === todayN });

  const line = (valueAt) => {
    const cells = months.map((m) => {
      let value = 0, any = false;
      for (const v of valueAt(m)) { if (v) { value += v; any = true; } }
      return any ? value : null;
    });
    return { cells, total: cells.reduce((s, v) => s + (v || 0), 0) };
  };
  const recorded = (cellKey) => line((m) => items.map((it) => {
    if (m.n < it.win.first || m.n > it.win.last || it.placed[m.monthIdx] !== m.n) return null;
    return asNumber(it.row?.[cellKey(MONTHS[m.monthIdx])]);
  }));
  const fromDeals = (pick) => line((m) => plans.map((p) => p[pick].get(m.n)));

  return {
    months,
    actual: {
      revenue: recorded((m) => `${m} Revenue`),
      commission: recorded((m) => m),
    },
    expected: {
      revenue: fromDeals('revenue'),
      commission: fromDeals('commission'),
      deals: plans.length,
      undated: plans.filter((p) => !p.win).length,
    },
  };
}

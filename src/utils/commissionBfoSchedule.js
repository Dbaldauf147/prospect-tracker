// Commissions > BFO opp popup: every commission row tied to one BFO opp,
// laid out month by month as two schedules, revenue and commission.
//
// The roster's month cells are year-agnostic ("March", "March Revenue"), so
// each row's Comm Start - End window pins them to real months:
//  - A recorded cell lands on that month inside the window. When a window
//    runs past 12 months and the month name occurs twice, it lands on the
//    latest occurrence that isn't in the future (the one most likely paid).
//  - A month from this one onward with nothing recorded yet is expected:
//    the row's projected monthly commission (utils/commissionProjection) and
//    the revenue behind it (average revenue on file, else commission / %,
//    else the linked opp's Quoted Amount / 12).
//  - A past month with nothing recorded is blank, and so is any month
//    outside the row's window.
// A row with no Comm Start Date can't be placed in time, so its cells are
// read as this calendar year.

import { asNumber, asDate } from './dealsFormat.js';
import { commissionRate, PROJECTION_MONTHS } from './commissionProjection.js';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Never draw more than this many month columns, however long a window runs.
export const MAX_SCHEDULE_MONTHS = 36;

export function normBfoKey(v) {
  return String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function monthNumber(d) { return d.getFullYear() * 12 + d.getMonth(); }

function windowFor(row, today) {
  const start = asDate(row?.['Comm Start Date']);
  if (!start) {
    const y = today.getFullYear() * 12;
    return { first: y, last: y + 11, dated: false };
  }
  const end = asDate(row?.['Comm End Date']);
  const first = monthNumber(start);
  let last = end ? monthNumber(end) : first + PROJECTION_MONTHS - 1;
  if (last < first) last = first;
  return { first, last, dated: true };
}

// Month number each calendar month's cell belongs to inside [first, last].
function placeMonths(win, todayN) {
  const out = new Array(12).fill(null);
  for (let n = win.first; n <= win.last; n++) {
    const idx = ((n % 12) + 12) % 12;
    if (out[idx] == null || n <= todayN) out[idx] = n;
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

function expectedRevenueMonthly(row, projection, opp) {
  if (!projection) return null;
  const avg = averageRevenue(row);
  if (avg != null) return avg;
  const rate = commissionRate(row?.['%']);
  if (projection.expectedMonthly != null && rate != null) return projection.expectedMonthly / rate;
  const quoted = asNumber(opp?.['Quoted Amount']);
  return quoted != null && quoted > 0 ? quoted / PROJECTION_MONTHS : null;
}

function monthLabel(n) {
  const year = Math.floor(n / 12);
  const idx = n - year * 12;
  return { key: `${year}-${String(idx + 1).padStart(2, '0')}`, label: `${MONTHS[idx].slice(0, 3)} ${year}`, year, monthIdx: idx, n };
}

function rowLabel(row) {
  const project = String(row?.['Project Name'] ?? '').trim();
  const name = String(row?.['Name'] ?? '').trim();
  const label = project || name || '(unnamed project)';
  return { name: label, sub: name && name !== label ? name : '' };
}

// `rows`: the commission rows for one BFO opp (ignored ones already left
// out). `projectionOf(row)` returns the row's projection or null.
// Returns { months, revenue, commission }; each schedule is
// { lines: [{ name, sub, cells, total, recorded, expected }], totals, recorded, expected }
// with cells aligned to months as { value, kind: 'recorded' | 'expected' } or null.
export function buildBfoSchedule(rows, { projectionOf = () => null, opp = null, today = new Date() } = {}) {
  const todayN = monthNumber(today);
  const items = (rows || []).map((row) => {
    const win = windowFor(row, today);
    const projection = projectionOf(row);
    return {
      row,
      win,
      placed: placeMonths(win, todayN),
      projection,
      expRevenue: expectedRevenueMonthly(row, projection, opp),
      expCommission: projection?.expectedMonthly ?? null,
    };
  });

  let first = null, last = null;
  for (const it of items) {
    if (first == null || it.win.first < first) first = it.win.first;
    if (last == null || it.win.last > last) last = it.win.last;
  }
  if (first == null) { first = today.getFullYear() * 12; last = first + 11; }
  if (last - first + 1 > MAX_SCHEDULE_MONTHS) last = first + MAX_SCHEDULE_MONTHS - 1;
  const months = [];
  for (let n = first; n <= last; n++) months.push({ ...monthLabel(n), isCurrent: n === todayN, isFuture: n > todayN });

  const schedule = (cellKey, expectedKey) => {
    const lines = items.map((it) => {
      let recorded = 0, expected = 0;
      const cells = months.map((m) => {
        if (m.n < it.win.first || m.n > it.win.last) return null;
        const v = asNumber(it.row?.[cellKey(MONTHS[m.monthIdx])]);
        if (v != null && v !== 0 && it.placed[m.monthIdx] === m.n) {
          recorded += v;
          return { value: v, kind: 'recorded' };
        }
        const exp = it[expectedKey];
        if (m.n >= todayN && exp != null && exp !== 0) {
          expected += exp;
          return { value: exp, kind: 'expected' };
        }
        return null;
      });
      return { ...rowLabel(it.row), cells, recorded, expected, total: recorded + expected };
    });
    const totals = months.map((_, i) => {
      let value = 0, any = false, anyExpected = false;
      for (const l of lines) {
        const c = l.cells[i];
        if (!c) continue;
        value += c.value; any = true;
        if (c.kind === 'expected') anyExpected = true;
      }
      return any ? { value, kind: anyExpected ? 'expected' : 'recorded' } : null;
    });
    return {
      lines,
      totals,
      recorded: lines.reduce((s, l) => s + l.recorded, 0),
      expected: lines.reduce((s, l) => s + l.expected, 0),
    };
  };

  return {
    months,
    revenue: schedule((m) => `${m} Revenue`, 'expRevenue'),
    commission: schedule((m) => m, 'expCommission'),
  };
}

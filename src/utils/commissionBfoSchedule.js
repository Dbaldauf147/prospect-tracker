// Commissions > BFO opp popup: one BFO opp's revenue and commission, month
// by month, as two tables (Revenue, Commission). Each splits into Actual and
// Expected, and each of those into Setup and Recurring.
//
// Actual: what the Commissions roster has recorded, summed over every row
// tied to the opp. The roster has no setup / recurring column, so a row
// counts as Setup when its Project Name or Name reads as a one-time line
// ("NonRecurring", "Setup", "One-time", "Implementation"), else Recurring. The roster's month cells are year-agnostic ("March",
// "March Revenue"), so each row's Comm Start - End window pins them to real
// months: a recorded cell lands on that month inside the window, and when a
// window runs past 12 months (so a month name occurs twice) on the latest
// occurrence that isn't in the future. A row with no Comm Start Date can't
// be placed in time, so its cells are read as this calendar year.
//
// Projected: the Actual months a roster row hasn't recorded yet. A Recurring
// row's latest recorded month is carried forward, month by month, to the end
// of its Comm Start - End window (the Projected tab's "being paid" rule).
// Only months after that latest one are projected, never a gap before it,
// and Setup rows never are: a one-time line doesn't repeat.
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

const SETUP_RE = /non[\s_-]?recurring|set[\s_-]?up|one[\s_-]?time|implementation/i;
export function isSetupRow(row) {
  return SETUP_RE.test(`${row?.['Project Name'] ?? ''} ${row?.['Name'] ?? ''}`);
}

// One deal's revenue and commission, each split into setup and recurring,
// as month number -> amount.
function dealPlan(deal, rows) {
  const win = dealWindow(deal, rows);
  const plan = { win, revenueSetup: new Map(), revenueRecurring: new Map(), commissionSetup: new Map(), commissionRecurring: new Map() };
  if (!win) return plan;
  const total = asNumber(deal?.['Commission']) ?? 0;
  const setup = asNumber(deal?.['Setup']) ?? 0;
  const recurring = asNumber(deal?.['Recurring Revenue']) ?? 0;
  const span = win.last - win.first + 1;
  const base = setup + recurring;
  const setupShare = base > 0 && setup > 0 ? total * (setup / base) : 0;
  if (setup) plan.revenueSetup.set(win.first, setup);
  if (setupShare) plan.commissionSetup.set(win.first, setupShare);
  for (let n = win.first; n <= win.last; n++) {
    if (recurring) plan.revenueRecurring.set(n, recurring / span);
    if (total - setupShare) plan.commissionRecurring.set(n, (total - setupShare) / span);
  }
  return plan;
}

function monthLabel(n) {
  const year = Math.floor(n / 12);
  const idx = n - year * 12;
  return { key: `${year}-${String(idx + 1).padStart(2, '0')}`, label: `${MONTHS[idx].slice(0, 3)} ${year}`, year, monthIdx: idx, n };
}

// `rows`: the commission rows for one BFO opp (ignored ones already left
// out). `deals`: the Deals-page rows tied to the same opp.
// Returns { months, revenue, commission, deals, undated }. revenue and
// commission each hold { actual, expected, projected }: projected is one
// { cells, total } line (Recurring rows only); actual and expected are each
// { setup, recurring, total } lines of { cells, total }, cells aligned to
// months (null where nothing lands).
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
  const sum = (lines) => {
    const cells = months.map((_, i) => {
      const vs = lines.map((l) => l.cells[i]).filter((v) => v != null);
      return vs.length ? vs.reduce((x, y) => x + y, 0) : null;
    });
    return { cells, total: cells.reduce((x, v) => x + (v || 0), 0) };
  };
  const recorded = (cellKey, setup) => line((m) => items.map((it) => {
    if (isSetupRow(it.row) !== setup) return null;
    if (m.n < it.win.first || m.n > it.win.last || it.placed[m.monthIdx] !== m.n) return null;
    return asNumber(it.row?.[cellKey(MONTHS[m.monthIdx])]);
  }));
  // Recorded value of one row in one month number, or null.
  const valueAt = (it, cellKey, n) => {
    if (n < it.win.first || n > it.win.last) return null;
    const idx = ((n % 12) + 12) % 12;
    if (it.placed[idx] !== n) return null;
    const v = asNumber(it.row?.[cellKey(MONTHS[idx])]);
    return v ? v : null;
  };
  const projectedLine = (cellKey) => {
    const per = items.filter((it) => !isSetupRow(it.row)).map((it) => {
      const out = new Map();
      let latest = null;
      for (let n = it.win.first; n <= it.win.last; n++) {
        const v = valueAt(it, cellKey, n);
        if (v != null) latest = { n, v };
      }
      if (!latest) return out;
      for (let n = latest.n + 1; n <= it.win.last; n++) out.set(n, latest.v);
      return out;
    });
    return line((m) => per.map((p) => p.get(m.n)));
  };
  const fromDeals = (pick) => line((m) => plans.map((p) => p[pick].get(m.n)));
  const section = (setup, recurring) => ({ setup, recurring, total: sum([setup, recurring]) });
  const revKey = (m) => `${m} Revenue`;
  const commKey = (m) => m;

  return {
    months,
    revenue: {
      actual: section(recorded(revKey, true), recorded(revKey, false)),
      expected: section(fromDeals('revenueSetup'), fromDeals('revenueRecurring')),
      projected: projectedLine(revKey),
    },
    commission: {
      actual: section(recorded(commKey, true), recorded(commKey, false)),
      expected: section(fromDeals('commissionSetup'), fromDeals('commissionRecurring')),
      projected: projectedLine(commKey),
    },
    deals: plans.length,
    undated: plans.filter((p) => !p.win).length,
  };
}

// ---- Actual vs Expected ----------------------------------------------------
// Each Actual cell is compared with the Expected cell for the same line
// (setup / recurring / total) and month. Within a dollar is a match. A
// mismatch can be marked OK; the mark stores both amounts as they were, so
// it only holds while those amounts stay the same and a later change flags
// the cell again.
export const BFO_OK_SETTINGS_KEY = 'commissionBfoOk';

export function bfoOkSignature(actual, expected) {
  return `${Math.round(actual || 0)}|${Math.round(expected || 0)}`;
}

// 'none' (nothing either side), 'match', 'ok' (marked OK) or 'mismatch'.
export function bfoMatchState(actual, expected, okSignature) {
  const a = actual || 0, e = expected || 0;
  if (!a && !e) return 'none';
  if (Math.abs(a - e) < 1) return 'match';
  if (okSignature && okSignature === bfoOkSignature(a, e)) return 'ok';
  return 'mismatch';
}

// Every comparison in one measure's data ({ actual, expected }), as
// { key, actual, expected } with key `<measure>:<line>:<monthKey|total>`.
export function bfoComparisons(measure, data, months) {
  const out = [];
  for (const line of ['setup', 'recurring', 'total']) {
    const a = data.actual[line], e = data.expected[line];
    months.forEach((m, i) => out.push({ key: `${measure}:${line}:${m.key}`, actual: a.cells[i], expected: e.cells[i] }));
    out.push({ key: `${measure}:${line}:total`, actual: a.total, expected: e.total });
  }
  return out;
}

// Actual cells nothing has been recorded for but the projection fills:
// shown as projected and never compared, so never red. Keys as
// bfoComparisons builds them.
export function bfoProjectedKeys(model) {
  const out = new Set();
  for (const measure of ['revenue', 'commission']) {
    const d = model[measure];
    model.months.forEach((m, i) => {
      if (!d.projected.cells[i]) return;
      for (const line of ['recurring', 'total']) {
        if (d.actual[line].cells[i] == null) out.add(`${measure}:${line}:${m.key}`);
      }
    });
  }
  return out;
}

// Every comparison of one opp's schedule with its state, as the popup
// colors it: Map key -> { actual, expected, state }.
export function bfoComparisonStates(model, okMarks = {}) {
  const projected = bfoProjectedKeys(model);
  const out = new Map();
  for (const c of [...bfoComparisons('revenue', model.revenue, model.months), ...bfoComparisons('commission', model.commission, model.months)]) {
    out.set(c.key, { ...c, state: projected.has(c.key) ? 'projected' : bfoMatchState(c.actual, c.expected, okMarks[c.key]) });
  }
  return out;
}

// True when the popup for this opp shows no red at all and at least one
// cell is green (matched or marked OK): revenue and commission check out.
// `rows`: the opp's roster rows, ignored ones already left out.
export function bfoAllGreen(rows, { deals = [], okMarks = {}, today = new Date() } = {}) {
  if (!rows?.length) return false;
  const states = bfoComparisonStates(buildBfoSchedule(rows, { deals, today }), okMarks);
  let any = false;
  for (const { state } of states.values()) {
    if (state === 'mismatch') return false;
    if (state === 'match' || state === 'ok') any = true;
  }
  return any;
}

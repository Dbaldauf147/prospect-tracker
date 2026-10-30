// Pipeline page > KPI Trends: six KPIs month by month for the last six
// calendar months, then over the trailing 6 and 12 months, read off the Opps
// tab, each with the opps behind it so its hover panel can export them. Laid
// out like the Weekly Report's Close Rate Trend, with a target per KPI. The rules are the page's own, so a number here agrees with the
// sections around it:
//
//   opened   oppOpenTs (Start Date, else Age), on opps with a BFO
//            opportunity, as New Opps by Month counts them
//   closed   closedOppEntry (Sold / Not Sold with a Close Date), as Close
//            Rate Actual counts them
//   quoted   a Quoted On date (the Stage 5 close-rate signal) or time
//            logged in Quoted / Agreement Sent (the "% of deals not
//            Quoted" signal), so a deal either table calls quoted is
//            quoted here
//
// Pull-through opps are left out of every KPI, as they are of the close
// rates: they ride along with another deal.
//
// Pure: runs under plain Node in scripts/kpiTrends.test.mjs.

import { bfoOppNameOf, closedOppEntry, oppOpenTs } from './pipelineFunnelData.js';
import { isPullThroughOpp } from './pullThrough.js';
import { parseMoney } from './oppsMetrics.js';

const DAY = 86400000;
const QUOTE_STAGES = new Set(['Quoted', 'Agreement Sent']);

/**
 * Total days a deal spent in Quoted / Agreement Sent, from its
 * `_stageHistory`; 0 when it never logged time in either.
 */
export function quotedStageDays(r) {
  let total = 0;
  for (const h of (Array.isArray(r?._stageHistory) ? r._stageHistory : [])) {
    if (!QUOTE_STAGES.has(String(h?.stage || '').trim())) continue;
    const d = Number(h?.days);
    if (Number.isFinite(d) && d > 0) total += d;
  }
  return total;
}

const quotedOnTs = (r) => {
  const ts = Date.parse(r?.['Quoted On'] || r?.['Quoted Date'] || '');
  return Number.isNaN(ts) ? NaN : ts;
};

/** Whether an opp was quoted, by either of the page's two signals. */
export function wasQuoted(r) {
  return !Number.isNaN(quotedOnTs(r)) || quotedStageDays(r) > 0;
}

export const KPI_DEFS = [
  { key: 'generation', label: 'Opportunity Generation', short: 'Opps / month', better: 'higher', format: 'count',
    about: 'Average opps opened per month (Start Date, else Age), with a BFO opportunity. A single month is that month\'s count; the current month is the count so far.' },
  { key: 'avgSize', label: 'Average Opportunity Size', short: 'Avg size', better: 'higher', format: 'money',
    about: 'Average Quoted Amount of the opps opened in the window that have one.' },
  { key: 'pctQuoted', label: 'Percentage of Opportunities Quoted', short: '% quoted', better: 'higher', format: 'pct',
    about: 'Of the opps closed (Sold or Not Sold) in the window, the share that were quoted (a Quoted On date, or time in Quoted / Agreement Sent).' },
  { key: 'closeQuoted', label: 'Close Rate Quoted', short: 'Close rate quoted', better: 'higher', format: 'pct',
    about: 'Of the quoted opps closed in the window, the share Sold.' },
  { key: 'closeOverall', label: 'Close Rate Overall', short: 'Close rate overall', better: 'higher', format: 'pct',
    about: 'Of every opp closed in the window, the share Sold.' },
  { key: 'avgLife', label: 'Average Opportunity Life', short: 'Avg life', better: 'lower', format: 'days',
    about: 'Average days from opened to Close Date, over the opps closed in the window.' },
];

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The trailing window ending `nowMs`, `months` calendar months long. */
export function trailingWindow(months, nowMs = Date.now()) {
  const end = new Date(nowMs);
  const start = new Date(end);
  start.setMonth(start.getMonth() - months);
  return { key: `${months}mo`, months, label: `Last ${months} Months`, short: `${months} mo`, from: start.getTime(), to: end.getTime() };
}

/**
 * The last `count` calendar months, oldest first, the current one included
 * (up to `nowMs`). Labelled like the Close Rate Trend's columns: "Oct", with
 * the year added only when the span crosses one.
 */
export function calendarMonths(count = 6, nowMs = Date.now()) {
  const now = new Date(nowMs);
  const out = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    out.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: MONTH_SHORT[d.getMonth()],
      year: d.getFullYear(),
      months: 1,
      from: d.getTime(),
      to: Math.min(next.getTime() - 1, nowMs),
    });
  }
  if (out.length > 1 && out[0].year !== out[out.length - 1].year) {
    for (const m of out) m.label = `${m.label} ’${String(m.year).slice(2)}`;
  }
  return out;
}

const iso = (ts) => (Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 10) : '');
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const share = (hit, of) => (of ? hit / of : null);

// One opp as an export row: what the KPI read off it, then every column it
// has on the Opps tab. Fields starting with "_" are the app's own
// bookkeeping (stage history and the like), not the tab's.
function exportRow(r, extra, ageRef) {
  const openTs = oppOpenTs(r, ageRef);
  const closeTs = Date.parse(r?.['Close Date'] || '');
  const base = {
    Account: String(r?.Account || '').trim(),
    'BFO Opportunity': bfoOppNameOf(r),
    Stage: String(r?.Stage || '').trim(),
    'Opened (as counted)': iso(openTs),
    'Close Date (as counted)': Number.isNaN(closeTs) ? '' : iso(closeTs),
    Quoted: wasQuoted(r) ? 'Yes' : 'No',
    'Quoted Amount (as counted)': parseMoney(r?.['Quoted Amount']) ?? '',
    ...extra,
  };
  const raw = {};
  for (const [k, v] of Object.entries(r || {})) {
    if (k.startsWith('_') || k in base) continue;
    raw[k] = Array.isArray(v) ? v.join(', ') : (v && typeof v === 'object' ? JSON.stringify(v) : v ?? '');
  }
  return { ...base, ...raw };
}

// Every KPI over one window. `sub` is the count the figure rests on, printed
// under it the way the Close Rate Trend prints "3/7" under a rate.
function measure(records, w, ageRef) {
  const inWin = (ts) => Number.isFinite(ts) && ts >= w.from && ts <= w.to;
  const opened = records.filter(r => bfoOppNameOf(r) && inWin(oppOpenTs(r, ageRef)));
  const sized = opened.map(r => ({ r, amt: parseMoney(r['Quoted Amount']) })).filter(x => typeof x.amt === 'number' && x.amt > 0);
  const closed = records.map(r => ({ r, e: closedOppEntry(r) })).filter(x => x.e && inWin(x.e.ts));
  const quoted = closed.filter(x => wasQuoted(x.r));
  const sold = (list) => list.filter(x => x.e.stage === 'Sold').length;
  const lived = closed.map(x => ({ ...x, open: oppOpenTs(x.r, ageRef) }))
    .filter(x => Number.isFinite(x.open) && x.open <= x.e.ts)
    .map(x => ({ ...x, days: Math.round((x.e.ts - x.open) / DAY) }));
  const perMonth = opened.length / w.months;

  return {
    generation: {
      value: perMonth,
      sub: w.months === 1 ? 'opened' : `${opened.length} opened`,
      detail: w.months === 1
        ? `${opened.length} opp${opened.length === 1 ? '' : 's'} opened`
        : `${opened.length} opps opened over ${w.months} months = ${perMonth.toFixed(1)} per month`,
      rows: opened.map(r => exportRow(r, {}, ageRef)),
    },
    avgSize: {
      value: mean(sized.map(x => x.amt)),
      sub: `${sized.length} sized`,
      detail: `${sized.length} of ${opened.length} opened opps have a Quoted Amount`,
      rows: sized.map(x => exportRow(x.r, {}, ageRef)),
    },
    pctQuoted: {
      value: share(quoted.length, closed.length),
      sub: `${quoted.length}/${closed.length}`,
      detail: `${quoted.length} of ${closed.length} closed opps quoted`,
      rows: closed.map(x => exportRow(x.r, {}, ageRef)),
    },
    closeQuoted: {
      value: share(sold(quoted), quoted.length),
      sub: `${sold(quoted)}/${quoted.length}`,
      detail: `${sold(quoted)} Sold of ${quoted.length} quoted`,
      rows: quoted.map(x => exportRow(x.r, {}, ageRef)),
    },
    closeOverall: {
      value: share(sold(closed), closed.length),
      sub: `${sold(closed)}/${closed.length}`,
      detail: `${sold(closed)} Sold of ${closed.length} closed`,
      rows: closed.map(x => exportRow(x.r, {}, ageRef)),
    },
    avgLife: {
      value: mean(lived.map(x => x.days)),
      sub: `${lived.length} closed`,
      detail: `${lived.length} of ${closed.length} closed opps have an open date`,
      rows: lived.map(x => exportRow(x.r, { 'Life (days)': x.days }, ageRef)),
    },
  };
}

/**
 * Every KPI, month by month and over the trailing windows:
 *   { months: [{ key, label, from, to }],       the calendar-month columns
 *     windows: [{ key, months, label, short, from, to }],   6 mo and 12 mo
 *     rows: [{ ...KPI_DEFS entry, cells: [cell per month], totals: [cell per window] }] }
 * A cell is { value, sub, detail, rows }: `value` is null when the window has
 * nothing to measure, `rows` are the opps behind it, ready to export.
 * Opportunity Generation is per month in every column, so the months and the
 * two windows read on the same scale.
 */
export function computeKpiTrends(oppsRecords = [], { nowMs = Date.now(), ageRef = nowMs, monthCount = 6, windows: spans = [6, 12] } = {}) {
  const records = (Array.isArray(oppsRecords) ? oppsRecords : []).filter(r => r && !isPullThroughOpp(r));
  const months = calendarMonths(monthCount, nowMs);
  const windows = spans.map(m => trailingWindow(m, nowMs));
  const perMonth = months.map(m => measure(records, m, ageRef));
  const perWindow = windows.map(w => measure(records, w, ageRef));
  const rows = KPI_DEFS.map(def => ({
    ...def,
    cells: perMonth.map(p => p[def.key]),
    totals: perWindow.map(p => p[def.key]),
  }));
  return { months, windows, rows };
}

/** A cell's value as the table shows it. */
export function formatKpi(value, format) {
  if (value == null || Number.isNaN(value)) return '-';
  if (format === 'pct') return `${Math.round(value * 100)}%`;
  if (format === 'money') return `$${Math.round(value).toLocaleString('en-US')}`;
  if (format === 'days') return `${Math.round(value).toLocaleString('en-US')} days`;
  if (format === 'count') return (Math.round(value * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 });
  return Math.round(value).toLocaleString('en-US');
}

// ---- Targets ---------------------------------------------------------------
//
// Stored on the Pipeline dashboard record as { [kpiKey]: number } in the
// units the box is typed in: a percentage as 0-100, money in dollars, life
// in days, generation in opps per month.

/** The saved targets, keeping only finite non-negative numbers for known KPIs. */
export function sanitizeKpiTargets(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const def of KPI_DEFS) {
    const n = Number(raw[def.key]);
    if (raw[def.key] !== '' && raw[def.key] != null && Number.isFinite(n) && n >= 0) out[def.key] = n;
  }
  return out;
}

/** Typed text -> stored target, or null to clear it. "$1,500", "30%" and "12" all read. */
export function parseKpiTarget(text) {
  const t = String(text ?? '').replace(/[$,%\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** A stored target in the KPI's own value units (a percentage as 0-1). */
export function targetValue(def, target) {
  if (target == null || !Number.isFinite(Number(target))) return null;
  return def.format === 'pct' ? Number(target) / 100 : Number(target);
}

/** A stored target as the table shows it. */
export function formatKpiTarget(def, target) {
  const v = targetValue(def, target);
  return v == null ? '' : formatKpi(v, def.format);
}

/**
 * How a value sits against its target: 'met' | 'missed' | null (no value or
 * no target). Average Opportunity Life is met at or under the target, the
 * rest at or over. Compared at the precision shown, so a cell reading "30%"
 * never misses a 30% target.
 */
export function targetStatus(def, value, target) {
  const t = targetValue(def, target);
  if (value == null || Number.isNaN(value) || t == null) return null;
  const round = (x) => (def.format === 'pct' ? Math.round(x * 100) : def.format === 'count' ? Math.round(x * 10) / 10 : Math.round(x));
  const v = round(value), g = round(t);
  return (def.better === 'lower' ? v <= g : v >= g) ? 'met' : 'missed';
}

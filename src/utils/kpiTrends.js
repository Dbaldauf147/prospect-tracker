// Pipeline page > KPI Trends: six KPIs over the trailing 6 and 12 months,
// read off the Opps tab, each with the opps behind it so a click can export
// them. The rules are the page's own, so a number here agrees with the
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
  { key: 'generation', label: 'Opportunity Generation', better: 'higher', format: 'count',
    about: 'Opps opened in the window (Start Date, else Age), with a BFO opportunity.' },
  { key: 'avgSize', label: 'Average Opportunity Size', better: 'higher', format: 'money',
    about: 'Average Quoted Amount of the opps opened in the window that have one.' },
  { key: 'pctQuoted', label: 'Percentage of Opportunities Quoted', better: 'higher', format: 'pct',
    about: 'Of the opps closed (Sold or Not Sold) in the window, the share that were quoted (a Quoted On date, or time in Quoted / Agreement Sent).' },
  { key: 'closeQuoted', label: 'Close Rate Quoted', better: 'higher', format: 'pct',
    about: 'Of the quoted opps closed in the window, the share Sold.' },
  { key: 'closeOverall', label: 'Close Rate Overall', better: 'higher', format: 'pct',
    about: 'Of every opp closed in the window, the share Sold.' },
  { key: 'avgLife', label: 'Average Opportunity Life', better: 'lower', format: 'days',
    about: 'Average days from opened to Close Date, over the opps closed in the window.' },
];

/** The trailing window ending `nowMs`, `months` calendar months long. */
export function trailingWindow(months, nowMs = Date.now()) {
  const end = new Date(nowMs);
  const start = new Date(end);
  start.setMonth(start.getMonth() - months);
  return { months, label: `Last ${months} Months`, from: start.getTime(), to: end.getTime() };
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

/**
 * Every KPI over every window:
 *   { windows: [{ months, label, from, to }],
 *     rows: [{ ...KPI_DEFS entry, cells: [{ value, detail, rows }], trend }] }
 * `value` is null when the window has nothing to measure. `rows` are the
 * opps behind the cell, ready to export. `trend` compares the first window
 * with the second (per month, for a count): 'better' | 'worse' | 'flat' | null,
 * and `direction` says which way the number moved: 'up' | 'down' | 'flat' | null.
 */
export function computeKpiTrends(oppsRecords = [], { nowMs = Date.now(), ageRef = nowMs, months = [6, 12] } = {}) {
  const records = (Array.isArray(oppsRecords) ? oppsRecords : []).filter(r => r && !isPullThroughOpp(r));
  const windows = months.map(m => trailingWindow(m, nowMs));

  const perWindow = windows.map(w => {
    const inWin = (ts) => Number.isFinite(ts) && ts >= w.from && ts <= w.to;
    const opened = records.filter(r => bfoOppNameOf(r) && inWin(oppOpenTs(r, ageRef)));
    const sized = opened.map(r => ({ r, amt: parseMoney(r['Quoted Amount']) })).filter(x => typeof x.amt === 'number' && x.amt > 0);
    const closed = records.map(r => ({ r, e: closedOppEntry(r) })).filter(x => x.e && inWin(x.e.ts));
    const quoted = closed.filter(x => wasQuoted(x.r));
    const sold = (list) => list.filter(x => x.e.stage === 'Sold').length;
    const lived = closed.map(x => ({ ...x, open: oppOpenTs(x.r, ageRef) }))
      .filter(x => Number.isFinite(x.open) && x.open <= x.e.ts)
      .map(x => ({ ...x, days: Math.round((x.e.ts - x.open) / DAY) }));

    return {
      generation: {
        value: opened.length,
        detail: `${(opened.length / w.months).toFixed(1)} per month`,
        rows: opened.map(r => exportRow(r, {}, ageRef)),
      },
      avgSize: {
        value: mean(sized.map(x => x.amt)),
        detail: `${sized.length} of ${opened.length} opened opps have a Quoted Amount`,
        rows: sized.map(x => exportRow(x.r, {}, ageRef)),
      },
      pctQuoted: {
        value: share(quoted.length, closed.length),
        detail: `${quoted.length} of ${closed.length} closed opps quoted`,
        rows: closed.map(x => exportRow(x.r, {}, ageRef)),
      },
      closeQuoted: {
        value: share(sold(quoted), quoted.length),
        detail: `${sold(quoted)} Sold of ${quoted.length} quoted`,
        rows: quoted.map(x => exportRow(x.r, {}, ageRef)),
      },
      closeOverall: {
        value: share(sold(closed), closed.length),
        detail: `${sold(closed)} Sold of ${closed.length} closed`,
        rows: closed.map(x => exportRow(x.r, {}, ageRef)),
      },
      avgLife: {
        value: mean(lived.map(x => x.days)),
        detail: `${lived.length} of ${closed.length} closed opps have an open date`,
        rows: lived.map(x => exportRow(x.r, { 'Life (days)': x.days }, ageRef)),
      },
    };
  });

  const rows = KPI_DEFS.map(def => {
    const cells = perWindow.map(p => p[def.key]);
    const t = trendOf(def, cells, windows);
    return { ...def, cells, trend: t?.trend ?? null, direction: t?.direction ?? null };
  });
  return { windows, rows };
}

// The first window against the second. A count is compared per month, or a
// 12-month window would always "beat" a 6-month one.
function trendOf(def, cells, windows) {
  if (cells.length < 2) return null;
  let [a, b] = [cells[0].value, cells[1].value];
  if (a == null || b == null) return null;
  if (def.format === 'count') { a /= windows[0].months; b /= windows[1].months; }
  const eps = def.format === 'pct' ? 0.005 : Math.abs(b) * 0.005;
  if (Math.abs(a - b) <= eps) return { trend: 'flat', direction: 'flat' };
  const up = a > b;
  return { trend: (def.better === 'higher') === up ? 'better' : 'worse', direction: up ? 'up' : 'down' };
}

/** A cell's value as the table shows it. */
export function formatKpi(value, format) {
  if (value == null || Number.isNaN(value)) return '-';
  if (format === 'pct') return `${Math.round(value * 100)}%`;
  if (format === 'money') return `$${Math.round(value).toLocaleString('en-US')}`;
  if (format === 'days') return `${Math.round(value).toLocaleString('en-US')} days`;
  return Math.round(value).toLocaleString('en-US');
}

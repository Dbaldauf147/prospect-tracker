// Close Rate deep dive (Opps > Close Rates). The trend math lives where it
// always has - by source in notSoldAnalysis.closeRateTrend, by service in
// serviceTrends.serviceCloseRateTrend, the Weekly email's month grid in
// pipelineFunnelData.closeRateTrendByStage - and this file adds the one that
// was missing (by stage, over any period and window) plus the shaping that
// turns any of them into table rows and Excel sheets.
//
// One rule across the whole page: pull-through opps are left out, the same
// as the Weekly email's table and the funnel (closedOppEntry). The By Source
// and By Service tabs count them; here they'd make the four sections
// disagree about the same deals.

import { CLOSE_RATE_STAGES, bfoOppNameOf, closedOppEntry } from './pipelineFunnelData.js';
import { closePeriodOf, periodLabel, periodRange, sourceOf } from './notSoldAnalysis.js';
import { isPullThroughOpp } from './pullThrough.js';

const pct = (w, d) => (d > 0 ? (w / d) * 100 : null);

/** The records every section counts: everything but pull-throughs. */
export function withoutPullThroughs(records) {
  return (records || []).filter(r => r && !isPullThroughOpp(r));
}

// ISO day of a Close Date for the window test, local reading so a bare
// '2026-04-01' stays April 1st.
function closeIso(raw) {
  const s = String(raw ?? '').trim();
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const ts = Date.parse(s);
  if (Number.isNaN(ts)) return null;
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const inRange = (iso, from, to) => (!from || iso >= from) && (!to || iso <= to);

/** The stage rows, in the order the Weekly email lists them. */
export const STAGE_SERIES = [
  ...CLOSE_RATE_STAGES.map(st => ({ key: `Stage ${st.num}`, label: st.label, signal: st.signal, test: st.test })),
  { key: 'All closed opps', label: 'All closed opps', signal: null, test: () => true },
];

/**
 * Close rate by the stage each closed opp reached, per period. Same shape
 * as closeRateTrend / serviceCloseRateTrend so one table draws all three:
 *
 *   { periods, series: [{ key, label, wins, decided, rate, byPeriod }],
 *     overall, wins, decided, rate, undated }
 *
 * An opp counts toward every stage it reached (the Weekly email's rule), so
 * the stage rows don't add up; `overall` is the All closed row.
 */
export function stageCloseRateTrend(records, { period = 'quarter', from = '', to = '' } = {}) {
  const cells = STAGE_SERIES.map(() => new Map());
  const seen = new Set();
  let undated = 0;
  for (const r of records || []) {
    const stage = String(r?.Stage || '').trim();
    if (stage !== 'Sold' && stage !== 'Not Sold') continue;
    const entry = closedOppEntry(r);
    if (!entry) {
      if (!isPullThroughOpp(r)) undated += 1;
      continue;
    }
    const iso = closeIso(entry.closeDate);
    if (!iso) { undated += 1; continue; }
    if (!inRange(iso, from, to)) continue;
    const p = closePeriodOf(r, period);
    if (!p) { undated += 1; continue; }
    seen.add(p);
    const won = entry.stage === 'Sold';
    STAGE_SERIES.forEach((def, i) => {
      if (!def.test(r)) return;
      const c = cells[i].get(p) || { wins: 0, decided: 0 };
      c.decided += 1;
      if (won) c.wins += 1;
      cells[i].set(p, c);
    });
  }
  const sorted = [...seen].sort();
  const periods = periodRange(sorted[0], sorted[sorted.length - 1], period);
  const out = (map) => Object.fromEntries(periods.map(p => {
    const c = map.get(p) || { wins: 0, decided: 0 };
    return [p, { wins: c.wins, decided: c.decided, rate: pct(c.wins, c.decided) }];
  }));
  const series = STAGE_SERIES.map((def, i) => {
    let wins = 0; let decided = 0;
    for (const c of cells[i].values()) { wins += c.wins; decided += c.decided; }
    return { key: def.key, label: def.label, signal: def.signal, wins, decided, rate: pct(wins, decided), byPeriod: out(cells[i]) };
  });
  const all = series[series.length - 1];
  return {
    periods,
    series: series.slice(0, -1),
    overall: all.byPeriod,
    wins: all.wins,
    decided: all.decided,
    rate: all.rate,
    undated,
  };
}

/** A rate as the app prints close rates: whole points. */
export const fmtRate = (r) => (r == null ? '-' : `${Math.round(r)}%`);

const ratio = (c) => (c && c.decided ? `${c.wins}/${c.decided}` : '');

/**
 * Any of the three trends as table rows: one per series plus an Overall row
 * (flagged `isOverall`) at the end.
 */
export function trendTableRows(trend) {
  const rows = trend.series.map(s => ({
    id: s.key, key: s.key, label: s.label || s.key, wins: s.wins, decided: s.decided, rate: s.rate, byPeriod: s.byPeriod,
    ...(s.folded ? { folded: s.folded } : {}),
  }));
  rows.push({
    id: '__overall', key: 'Overall', label: 'Overall', isOverall: true,
    wins: trend.wins, decided: trend.decided, rate: trend.rate, byPeriod: trend.overall,
  });
  return rows;
}

/**
 * A trend as Excel rows: the name, the window's totals, then for every
 * period its close rate (a number, whole points) and the Sold / Closed it
 * rests on.
 */
export function trendSheetRows(trend, { period = 'quarter', nameHeader = 'Name' } = {}) {
  return trendTableRows(trend).map(r => {
    const row = {
      [nameHeader]: r.label,
      'Close rate (window)': r.rate == null ? '' : Math.round(r.rate),
      Sold: r.wins,
      Closed: r.decided,
    };
    for (const p of trend.periods) {
      const c = r.byPeriod?.[p];
      const lbl = periodLabel(p, period);
      row[`${lbl} %`] = c?.rate == null ? '' : Math.round(c.rate);
      row[`${lbl} Sold/Closed`] = ratio(c);
    }
    return row;
  });
}

/** The Weekly email's grid (closeRateTrendByStage) as Excel rows. */
export function weeklyTrendSheetRows(trend) {
  const months = trend?.months || [];
  const n = months.length;
  return (trend?.rows || []).map(row => {
    const out = { Stage: row.label };
    months.forEach((m, i) => {
      const c = row.cells[i];
      out[`${m.label} %`] = c ? Math.round(c.rate * 100) : '';
      out[`${m.label} Sold/Closed`] = c ? `${c.sold}/${c.sold + c.notSold}` : '';
    });
    const t = row.overall;
    out[`${n} mo %`] = t ? Math.round(t.rate * 100) : '';
    out[`${n} mo Sold/Closed`] = t ? `${t.sold}/${t.sold + t.notSold}` : '';
    const y = row.rolling12;
    out['12 mo %'] = y ? Math.round(y.rate * 100) : '';
    out['12 mo Sold/Closed'] = y ? `${y.sold}/${y.sold + y.notSold}` : '';
    return out;
  });
}

/**
 * Every closed opp the page counts in the window, one row each, so any
 * figure can be rebuilt in Excel: its source, scope, the stages it reached
 * and the period it lands in.
 */
export function closedOppSheetRows(records, { period = 'quarter', from = '', to = '' } = {}) {
  const out = [];
  for (const r of records || []) {
    const entry = closedOppEntry(r);
    if (!entry) continue;
    const iso = closeIso(entry.closeDate);
    if (!iso || !inRange(iso, from, to)) continue;
    const p = closePeriodOf(r, period);
    const row = {
      Account: entry.account,
      'BFO Opp Name': bfoOppNameOf(r) || '',
      Scope: entry.scope,
      Source: sourceOf(r),
      Stage: entry.stage,
      'Close Date': iso,
      Period: p ? periodLabel(p, period) : '',
      'Quoted Amount': entry.amount || '',
    };
    for (const def of STAGE_SERIES.slice(0, -1)) row[`Reached ${def.key}`] = def.test(r) ? 'Yes' : '';
    out.push(row);
  }
  return out.sort((a, b) => (a['Close Date'] < b['Close Date'] ? 1 : a['Close Date'] > b['Close Date'] ? -1 : 0));
}

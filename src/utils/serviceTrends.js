// By Service over time, for Opps > By Service's two trend subtabs.
//
// The By Service table is a snapshot of the live pipeline. These read the
// same split (an opp's Scope, comma-separated, each service counted once)
// across every opp, open or closed, so you can see how the mix and the win
// rate move:
//
//   serviceShareTrend      of the opps that STARTED in a period (Start
//                          Date), the share that include each service.
//                          An opp can carry several services, so a period's
//                          shares can add up to more than 100%.
//   serviceCloseRateTrend  of the opps DECIDED in a period (Sold or Not
//                          Sold, by Close Date), the share of each service's
//                          that were won. The table's Win Rate, over time.
//
// Percentages are null where the period had nothing to measure, so a chart
// leaves a gap rather than drawing a 0% that never happened.
//
// Pure, so scripts/serviceTrends.test.mjs can assert it without a browser.

import { toISODate } from './oppsCallIn.js';
import { periodLabel, periodRange, closePeriodOf } from './notSoldAnalysis.js';
import { startPeriodOf } from './stageReach.js';

export const UNSPECIFIED_SERVICE = '(Unspecified)';

/** An opp's services, as the By Service table splits them. */
export function servicesOf(r) {
  const raw = String(r?.['Scope'] ?? '').trim();
  const cleaned = raw && raw !== '-' && raw !== '#N/A' ? raw : '';
  return cleaned
    ? [...new Set(cleaned.split(',').map(s => s.trim()).filter(Boolean))]
    : [UNSPECIFIED_SERVICE];
}

const pct = (n, d) => (d > 0 ? (n / d) * 100 : null);

function inRange(iso, from, to) {
  if (from && iso < from) return false;
  if (to && iso > to) return false;
  return true;
}

// Fill every period between the first and last seen, oldest first.
function periodsOf(seen, period) {
  const sorted = [...seen].sort();
  return periodRange(sorted[0], sorted[sorted.length - 1], period);
}

/**
 *   {
 *     periods: [...],                                   // oldest first, gaps filled
 *     totals:  { [p]: n },                              // opps started in the period
 *     series:  [{ key, count, share,
 *                 byPeriod: { [p]: { count, share } } }],   // most opps first
 *     total, undated,
 *   }
 *
 *   period    'month' | 'quarter' | 'year'
 *   from/to   ISO Start Date bounds, inclusive; blank = open
 *   hidden    services to leave out of the series (still in the totals,
 *             so the other shares don't change when one is hidden)
 */
export function serviceShareTrend(records, { period = 'quarter', from = '', to = '', hidden = [] } = {}) {
  const hide = new Set(hidden || []);
  const totals = new Map();
  const bySvc = new Map();
  let total = 0;
  let undated = 0;
  for (const r of records || []) {
    const iso = toISODate(r?.['Start Date']);
    if (!iso) { undated += 1; continue; }
    if (!inRange(iso, from, to)) continue;
    const p = startPeriodOf(r, period);
    total += 1;
    totals.set(p, (totals.get(p) || 0) + 1);
    for (const s of servicesOf(r)) {
      if (hide.has(s)) continue;
      const e = bySvc.get(s) || { key: s, count: 0, cells: new Map() };
      e.count += 1;
      e.cells.set(p, (e.cells.get(p) || 0) + 1);
      bySvc.set(s, e);
    }
  }
  const periods = periodsOf(totals.keys(), period);
  const totalsOut = Object.fromEntries(periods.map(p => [p, totals.get(p) || 0]));
  const series = [...bySvc.values()]
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .map(e => ({
      key: e.key,
      count: e.count,
      share: pct(e.count, total),
      byPeriod: Object.fromEntries(periods.map(p => {
        const n = e.cells.get(p) || 0;
        return [p, { count: n, share: pct(n, totalsOut[p]) }];
      })),
    }));
  return { periods, totals: totalsOut, series, total, undated };
}

/**
 *   {
 *     periods: [...],
 *     series:  [{ key, wins, decided, rate,
 *                 byPeriod: { [p]: { wins, decided, rate } } }],  // most decided first
 *     overall: { [p]: { wins, decided, rate } },     // each opp once, whatever its services
 *     wins, decided, rate, undated,
 *   }
 *
 *   period    'month' | 'quarter' | 'year'
 *   from/to   ISO Close Date bounds, inclusive; blank = open
 *   hidden    services left out of the series AND the overall, as if those
 *             opps were not there (an opp is dropped only when every one of
 *             its services is hidden)
 */
export function serviceCloseRateTrend(records, { period = 'year', from = '', to = '', hidden = [] } = {}) {
  const hide = new Set(hidden || []);
  const overall = new Map();
  const bySvc = new Map();
  let undated = 0;
  const bump = (map, p, won) => {
    const c = map.get(p) || { wins: 0, decided: 0 };
    c.decided += 1;
    if (won) c.wins += 1;
    map.set(p, c);
  };
  for (const r of records || []) {
    const stage = String(r?.['Stage'] ?? '').trim();
    if (stage !== 'Sold' && stage !== 'Not Sold') continue;
    const services = servicesOf(r).filter(s => !hide.has(s));
    if (services.length === 0) continue;
    const iso = toISODate(r?.['Close Date']);
    if (!iso) { undated += 1; continue; }
    if (!inRange(iso, from, to)) continue;
    const p = closePeriodOf(r, period);
    if (!p) { undated += 1; continue; }
    const won = stage === 'Sold';
    bump(overall, p, won);
    for (const s of services) {
      const e = bySvc.get(s) || { key: s, wins: 0, decided: 0, cells: new Map() };
      e.decided += 1;
      if (won) e.wins += 1;
      bump(e.cells, p, won);
      bySvc.set(s, e);
    }
  }
  const periods = periodsOf(overall.keys(), period);
  const cellsOut = (cells) => Object.fromEntries(periods.map(p => {
    const c = cells.get(p) || { wins: 0, decided: 0 };
    return [p, { wins: c.wins, decided: c.decided, rate: pct(c.wins, c.decided) }];
  }));
  const series = [...bySvc.values()]
    .sort((a, b) => b.decided - a.decided || a.key.localeCompare(b.key))
    .map(e => ({ key: e.key, wins: e.wins, decided: e.decided, rate: pct(e.wins, e.decided), byPeriod: cellsOut(e.cells) }));
  let wins = 0; let decided = 0;
  for (const c of overall.values()) { wins += c.wins; decided += c.decided; }
  return { periods, series, overall: cellsOut(overall), wins, decided, rate: pct(wins, decided), undated };
}

export { periodLabel };

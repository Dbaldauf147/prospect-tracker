// By Source over time, for Opps > By Source > "Over time".
//
// The By Source table counts opps per Source over one window. This splits
// the same count by the period each opp STARTED in (Start Date), so you
// can see how the lead mix moves. Every opp has exactly one Source, so a
// period's shares add up to 100%.
//
// Percentages are null where the period had no opps, so a chart leaves a
// gap rather than drawing a 0% that never happened.
//
// Pure, so scripts/sourceTrends.test.mjs can assert it without a browser.

import { toISODate } from './oppsCallIn.js';
import { periodLabel, periodRange } from './notSoldAnalysis.js';
import { startPeriodOf } from './stageReach.js';

export const UNSPECIFIED_SOURCE = '(Unspecified)';
const CLOSED = new Set(['Sold', 'Not Sold']);

/** An opp's Source, as the By Source table reads it. */
export function sourceOf(r) {
  const raw = String(r?.['Source'] ?? '').trim();
  return raw && raw !== '-' && raw !== '#N/A' ? raw : UNSPECIFIED_SOURCE;
}

const pct = (n, d) => (d > 0 ? (n / d) * 100 : null);

/**
 *   {
 *     periods: [...],                       // oldest first, gaps filled
 *     totals:  { [p]: n },                  // opps started in the period
 *     series:  [{ key, count, share,
 *                 byPeriod: { [p]: { count, share } } }],   // most opps first
 *     total, undated,
 *   }
 *
 *   period    'month' | 'quarter' | 'year'
 *   from/to   ISO Start Date bounds, inclusive; blank = open
 *   activity  'all' | 'active' (not Sold / Not Sold) | 'closed'
 */
export function sourceShareTrend(records, { period = 'quarter', from = '', to = '', activity = 'all' } = {}) {
  const totals = new Map();
  const bySrc = new Map();
  let total = 0;
  let undated = 0;
  for (const r of records || []) {
    const stage = String(r?.['Stage'] ?? '').trim();
    if (activity === 'active' && CLOSED.has(stage)) continue;
    if (activity === 'closed' && !CLOSED.has(stage)) continue;
    const iso = toISODate(r?.['Start Date']);
    if (!iso) { undated += 1; continue; }
    if (from && iso < from) continue;
    if (to && iso > to) continue;
    const p = startPeriodOf(r, period);
    total += 1;
    totals.set(p, (totals.get(p) || 0) + 1);
    const s = sourceOf(r);
    const e = bySrc.get(s) || { key: s, count: 0, cells: new Map() };
    e.count += 1;
    e.cells.set(p, (e.cells.get(p) || 0) + 1);
    bySrc.set(s, e);
  }
  const sorted = [...totals.keys()].sort();
  const periods = sorted.length ? periodRange(sorted[0], sorted[sorted.length - 1], period) : [];
  const totalsOut = Object.fromEntries(periods.map(p => [p, totals.get(p) || 0]));
  const series = [...bySrc.values()]
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

export { periodLabel };

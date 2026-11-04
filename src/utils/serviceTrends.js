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
//                          shares can add up to more than 100%. `mix` is
//                          the same count over every service tag in the
//                          period instead, so a period's mix sums to 100%.
//   serviceCloseRateTrend  of the opps DECIDED in a period (Sold or Not
//                          Sold, by Close Date), the share of each service's
//                          that were won. The table's Win Rate, over time.
//   serviceDealSizeTrend   of the opps that STARTED in a period (Start
//                          Date) with a Quoted Amount above 0, the average
//                          Quoted Amount for each service. An opp with
//                          several services counts its whole amount toward
//                          each, or with `split` an even share per service
//                          (a $30k opp scoped "A, B, C" puts $10k on each);
//                          the overall average counts each opp once, at its
//                          full amount. Each cell keeps the opps behind it
//                          (`opps`) for the click-through breakdown.
//
// Percentages are null where the period had nothing to measure, so a chart
// leaves a gap rather than drawing a 0% that never happened.
//
// Pure, so scripts/serviceTrends.test.mjs can assert it without a browser.

import { toISODate } from './oppsCallIn.js';
import { periodLabel, periodRange, closePeriodOf } from './notSoldAnalysis.js';
import { startPeriodOf } from './stageReach.js';
import { parseMoney } from './oppsMetrics.js';

export const UNSPECIFIED_SERVICE = '(Unspecified)';

/** An opp's services, as the By Service table splits them. */
export function servicesOf(r) {
  const raw = String(r?.['Scope'] ?? '').trim();
  const cleaned = raw && raw !== '-' && raw !== '#N/A' ? raw : '';
  return cleaned
    ? [...new Set(cleaned.split(',').map(s => s.trim()).filter(Boolean))]
    : [UNSPECIFIED_SERVICE];
}

/**
 * A lookup from service to the group it's filed under, for the trend
 * subtabs' "Group services" option. `groups` is [{ name, services }]; a
 * service named in two groups goes to the first. Blank names and empty
 * groups are skipped.
 */
export function groupLookup(groups) {
  const m = new Map();
  for (const g of groups || []) {
    const name = String(g?.name || '').trim();
    if (!name || !Array.isArray(g?.services)) continue;
    for (const s of g.services) if (!m.has(s)) m.set(s, name);
  }
  return m;
}

// An opp's series keys: its services after the hidden ones are dropped,
// each swapped for its group, so an opp with two services from one group
// counts once toward that group. A hidden group name drops the group too.
function keysOf(r, hide, lookup) {
  const out = new Set();
  for (const s of servicesOf(r)) {
    if (hide.has(s)) continue;
    const k = lookup.get(s) || s;
    if (!hide.has(k)) out.add(k);
  }
  return [...out];
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
 *     tagTotals: { [p]: n },                            // service tags on those opps (shown services only)
 *     series:  [{ key, count, share, mix,
 *                 byPeriod: { [p]: { count, share, mix } } }],   // most opps first
 *     total, tagTotal, undated,
 *   }
 *
 *   period    'month' | 'quarter' | 'year'
 *   from/to   ISO Start Date bounds, inclusive; blank = open
 *   hidden    services to leave out of the series (still in the totals,
 *             so the other shares don't change when one is hidden; left
 *             out of the tag totals, so the mix still sums to 100%)
 *   groups    [{ name, services }]: each group's services count as one
 *             series under its name (an opp once toward the group, however
 *             many of its services it carries); see groupLookup
 */
export function serviceShareTrend(records, { period = 'quarter', from = '', to = '', hidden = [], groups = [] } = {}) {
  const hide = new Set(hidden || []);
  const lookup = groupLookup(groups);
  const totals = new Map();
  const tags = new Map();
  const bySvc = new Map();
  let total = 0;
  let tagTotal = 0;
  let undated = 0;
  for (const r of records || []) {
    const iso = toISODate(r?.['Start Date']);
    if (!iso) { undated += 1; continue; }
    if (!inRange(iso, from, to)) continue;
    const p = startPeriodOf(r, period);
    total += 1;
    totals.set(p, (totals.get(p) || 0) + 1);
    for (const s of keysOf(r, hide, lookup)) {
      tagTotal += 1;
      tags.set(p, (tags.get(p) || 0) + 1);
      const e = bySvc.get(s) || { key: s, count: 0, cells: new Map() };
      e.count += 1;
      e.cells.set(p, (e.cells.get(p) || 0) + 1);
      bySvc.set(s, e);
    }
  }
  const periods = periodsOf(totals.keys(), period);
  const totalsOut = Object.fromEntries(periods.map(p => [p, totals.get(p) || 0]));
  const tagTotals = Object.fromEntries(periods.map(p => [p, tags.get(p) || 0]));
  const series = [...bySvc.values()]
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .map(e => ({
      key: e.key,
      count: e.count,
      share: pct(e.count, total),
      mix: pct(e.count, tagTotal),
      byPeriod: Object.fromEntries(periods.map(p => {
        const n = e.cells.get(p) || 0;
        return [p, { count: n, share: pct(n, totalsOut[p]), mix: pct(n, tagTotals[p]) }];
      })),
    }));
  return { periods, totals: totalsOut, tagTotals, series, total, tagTotal, undated };
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
 *   groups    as serviceShareTrend
 */
export function serviceCloseRateTrend(records, { period = 'year', from = '', to = '', hidden = [], groups = [] } = {}) {
  const hide = new Set(hidden || []);
  const lookup = groupLookup(groups);
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
    const services = keysOf(r, hide, lookup);
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

/**
 *   {
 *     periods: [...],
 *     series:  [{ key, sized, sum, avg,
 *                 byPeriod: { [p]: { sized, sum, avg } } }],   // most sized first
 *     overall: { [p]: { sized, sum, avg } },          // each opp once, whatever its services
 *     sized, sum, avg, undated, unsized,
 *   }
 *
 *   period    'month' | 'quarter' | 'year'
 *   from/to   ISO Start Date bounds, inclusive; blank = open
 *   sold      true = only Sold opps (the average won deal)
 *   split     true = an opp's amount is shared evenly over the services
 *             on its Scope, and each service is credited its share (a
 *             group, the shares of its services on the opp); false = the
 *             whole amount to each
 *
 *   Every cell (and series / overall) carries `opps`: [{ r, amount,
 *   counted, of }], the opps averaged, with the amount credited to that
 *   cell (`counted`) and how many services the amount was shared over
 *   (`of`, 1 when not split).
 *   hidden    services left out of the series AND the overall (an opp is
 *             dropped only when every one of its services is hidden)
 *   groups    as serviceShareTrend (an opp's amount once toward a group)
 *
 *   `unsized` counts the dated opps in the window left out for having no
 *   Quoted Amount above 0. avg is null where nothing was sized.
 */
export function serviceDealSizeTrend(records, { period = 'quarter', from = '', to = '', sold = false, split = false, hidden = [], groups = [] } = {}) {
  const hide = new Set(hidden || []);
  const lookup = groupLookup(groups);
  const overall = new Map();
  const bySvc = new Map();
  let undated = 0;
  let unsized = 0;
  const bump = (map, p, item) => {
    const c = map.get(p) || { sized: 0, sum: 0, opps: [] };
    c.sized += 1;
    c.sum += item.counted;
    c.opps.push(item);
    map.set(p, c);
  };
  for (const r of records || []) {
    if (sold && String(r?.['Stage'] ?? '').trim() !== 'Sold') continue;
    const services = keysOf(r, hide, lookup);
    if (services.length === 0) continue;
    const iso = toISODate(r?.['Start Date']);
    if (!iso) { undated += 1; continue; }
    if (!inRange(iso, from, to)) continue;
    const amt = parseMoney(r?.['Quoted Amount']);
    if (amt == null || !(amt > 0)) { unsized += 1; continue; }
    const p = startPeriodOf(r, period);
    bump(overall, p, { r, amount: amt, counted: amt, of: 1 });
    // Each series key's credit: the whole amount, or (split) one even
    // share per raw service on the Scope that files under the key. Hidden
    // services keep their share, so hiding one doesn't inflate the rest.
    const raw = servicesOf(r);
    const shares = new Map();
    for (const sv of raw) {
      if (hide.has(sv)) continue;
      const k = lookup.get(sv) || sv;
      if (hide.has(k)) continue;
      shares.set(k, (shares.get(k) || 0) + 1);
    }
    for (const s of services) {
      const counted = split ? (amt * (shares.get(s) || 0)) / raw.length : amt;
      const item = { r, amount: amt, counted, of: split ? raw.length : 1 };
      const e = bySvc.get(s) || { key: s, sized: 0, sum: 0, opps: [], cells: new Map() };
      e.sized += 1;
      e.sum += counted;
      e.opps.push(item);
      bump(e.cells, p, item);
      bySvc.set(s, e);
    }
  }
  const periods = overall.size ? periodsOf(overall.keys(), period) : [];
  const avg = (sum, n) => (n > 0 ? sum / n : null);
  const cellsOut = (cells) => Object.fromEntries(periods.map(p => {
    const c = cells.get(p) || { sized: 0, sum: 0, opps: [] };
    return [p, { sized: c.sized, sum: c.sum, avg: avg(c.sum, c.sized), opps: c.opps }];
  }));
  const series = [...bySvc.values()]
    .sort((a, b) => b.sized - a.sized || a.key.localeCompare(b.key))
    .map(e => ({ key: e.key, sized: e.sized, sum: e.sum, avg: avg(e.sum, e.sized), opps: e.opps, byPeriod: cellsOut(e.cells) }));
  let sized = 0; let sum = 0; const opps = [];
  for (const c of overall.values()) { sized += c.sized; sum += c.sum; opps.push(...c.opps); }
  return { periods, series, overall: cellsOut(overall), opps, sized, sum, avg: avg(sum, sized), undated, unsized };
}

export { periodLabel };

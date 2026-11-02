// Stage reach over time, for Opps > Days in Stage > Stage Reach.
//
// The board answers "where are the live opps stuck right now". This answers
// the funnel question over time: of the opps that started in a given month,
// quarter or year, what share ever got to Lead, to Quoting, to Agreement
// Sent, to Sold? Each period is a cohort by Start Date, so a period's
// percentages describe the same set of opps from left to right and the
// line for a stage can be read as "is our conversion to here improving".
//
// How far an opp got is the furthest stage it is known to have been in:
// its current Stage, or any stage logged in `_stageHistory`. Reaching a
// later stage counts as reaching every stage before it, so an opp entered
// straight at Quoted still counts toward Lead and Qualifying. A Sold opp
// reached everything.
//
// A Not Sold opp is the awkward one: its Stage says it lost, not where. The
// furthest stage comes from its history, and a loss that closed before
// stage history was recorded has none. It is left out of its cohort (and
// counted as such) rather than guessed at: counting it as reaching nothing
// would drag every older cohort down for a reason that is about record
// keeping, not selling.
//
// Pull-throughs are left out, as they are on the board and in the close
// rates: they are not opps somebody worked through the pipeline.
//
// By default only CLOSED opps count (Sold or Not Sold): the question is
// "of the deals that finished, how far did they get before they closed".
// An open opp is still moving, so counting it would make every recent
// cohort look worse than it is. `closedOnly: false` gives the old view
// (every opp that started, wherever it is now).
//
// Each period also carries how many of its closed losses had no history
// (`unknown`), so the page can say when a period's percentages rest on
// only a small share of its closed deals: older periods are mostly losses
// recorded before stage history existed, and what is left is nearly all
// Sold, which reads as 100% at every stage.
//
// Pure, so scripts/stageReach.test.mjs can assert it without a browser.

import { toISODate } from './oppsCallIn.js';
import { isPullThroughOpp } from './pullThrough.js';

// The stages a cohort is measured against, in pipeline order. Not Started
// is where every opp begins, so it is always 100% and not worth a line.
export const REACH_STAGES = ['Lead', 'Qualifying', 'Quoting', 'Quoted', 'Contracting', 'Agreement Sent', 'Sold'];

// Pipeline position of each stage. Repricing is a re-quote, so it sits
// with Quoted (as in utils/oppStages.js ACTIVE_STAGE_RANK).
const RANK = {
  'Not Started': 0,
  'Lead': 1,
  'Qualifying': 2,
  'Quoting': 3,
  'Quoted': 4,
  'Repricing': 4,
  'Contracting': 5,
  'Agreement Sent': 6,
  'Sold': 7,
};
const REACH_RANK = REACH_STAGES.map(s => RANK[s]);

const NOT_SOLD = new Set(['Not Sold', 'Closed', 'Lost']);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The furthest pipeline rank an opp is known to have reached, or null when
 * it can't be told (a loss with no stage history, or a stage we don't
 * recognise and no history to fall back on).
 */
export function furthestStageRank(row) {
  const stage = String(row?.['Stage'] ?? '').trim();
  if (stage === 'Sold') return RANK.Sold;
  let best = NOT_SOLD.has(stage) ? null : (RANK[stage] ?? null);
  for (const h of (Array.isArray(row?._stageHistory) ? row._stageHistory : [])) {
    const r = RANK[String(h?.stage ?? '').trim()];
    if (r != null && (best == null || r > best)) best = r;
  }
  return best;
}

// A sortable key per period: "2026", "2026-Q1", "2026-03".
export function startPeriodOf(row, period) {
  const iso = toISODate(row?.['Start Date']);
  if (!iso) return null;
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1;
  if (period === 'year') return String(y);
  if (period === 'month') return `${y}-${String(m + 1).padStart(2, '0')}`;
  return `${y}-Q${Math.floor(m / 3) + 1}`;
}

/** What a period key reads as on screen: "2026", "Q1 2026", "Mar 2026". */
export function reachPeriodLabel(key, period) {
  if (period === 'year') return key;
  const [y, rest] = String(key).split('-');
  if (period === 'month') return `${MONTHS[Number(rest) - 1]} ${y}`;
  return `${rest} ${y}`;
}

// Every period from the first key to the last, so an empty period shows as
// a gap with n = 0 rather than the line silently skipping it.
function periodRange(first, last, period) {
  if (!first) return [];
  if (period === 'year') {
    const out = [];
    for (let y = Number(first); y <= Number(last); y += 1) out.push(String(y));
    return out;
  }
  const step = period === 'month' ? 1 : 3;
  const toIdx = (k) => {
    const [y, rest] = k.split('-');
    const n = period === 'month' ? Number(rest) - 1 : (Number(rest.slice(1)) - 1) * 3;
    return Number(y) * 12 + n;
  };
  const out = [];
  for (let i = toIdx(first); i <= toIdx(last); i += step) {
    const y = Math.floor(i / 12);
    const m = i % 12;
    out.push(period === 'month' ? `${y}-${String(m + 1).padStart(2, '0')}` : `${y}-Q${Math.floor(m / 3) + 1}`);
  }
  return out;
}

/**
 * Stage reach by Start Date cohort.
 *
 *   {
 *     rows: [{ key, label, total, unknown, coverage, reached: { [stage]: n }, pct: { [stage]: 0-100 | null } }],
 *     overall: { total, unknown, coverage, reached, pct },
 *     counted, undated, unknown, pullThrough, open, closedOnly,
 *   }
 *
 * `rows` runs oldest first with gaps filled. `pct` is null for an empty
 * period so the chart breaks the line instead of drawing a fake 0%.
 *
 *   period   'month' | 'quarter' | 'year'
 *   from/to  ISO dates bounding the Start Date (inclusive); blank = open
 *   closedOnly  true (default) counts only Sold / Not Sold opps
 */
export function stageReachByPeriod(records, { period = 'quarter', from = '', to = '', closedOnly = true } = {}) {
  const buckets = new Map();
  const bucketFor = (key) => {
    let b = buckets.get(key);
    if (!b) {
      b = { total: 0, unknown: 0, reached: Object.fromEntries(REACH_STAGES.map(s => [s, 0])) };
      buckets.set(key, b);
    }
    return b;
  };
  const overallReached = Object.fromEntries(REACH_STAGES.map(s => [s, 0]));
  let counted = 0;
  let undated = 0;
  let unknown = 0;
  let pullThrough = 0;
  let open = 0;

  for (const r of (Array.isArray(records) ? records : [])) {
    if (isPullThroughOpp(r)) { pullThrough += 1; continue; }
    const iso = toISODate(r?.['Start Date']);
    if (!iso) { undated += 1; continue; }
    if ((from && iso < from) || (to && iso > to)) continue;
    const stage = String(r?.['Stage'] ?? '').trim();
    if (closedOnly && stage !== 'Sold' && !NOT_SOLD.has(stage)) { open += 1; continue; }
    const key = startPeriodOf(r, period);
    const rank = furthestStageRank(r);
    if (rank == null) { unknown += 1; bucketFor(key).unknown += 1; continue; }
    const b = bucketFor(key);
    b.total += 1;
    counted += 1;
    REACH_STAGES.forEach((s, i) => {
      if (rank >= REACH_RANK[i]) { b.reached[s] += 1; overallReached[s] += 1; }
    });
  }

  const pctOf = (reached, total) => Object.fromEntries(REACH_STAGES.map(s => [
    s, total > 0 ? Math.round((reached[s] / total) * 1000) / 10 : null,
  ]));

  const keys = [...buckets.keys()].sort();
  const rows = periodRange(keys[0], keys[keys.length - 1], period).map(key => {
    const b = buckets.get(key) || { total: 0, unknown: 0, reached: Object.fromEntries(REACH_STAGES.map(s => [s, 0])) };
    // Share of the period's closed deals the percentages are taken over;
    // null when the period has none at all.
    const seen = b.total + b.unknown;
    const coverage = seen > 0 ? Math.round((b.total / seen) * 1000) / 10 : null;
    return { key, label: reachPeriodLabel(key, period), total: b.total, unknown: b.unknown, coverage, reached: b.reached, pct: pctOf(b.reached, b.total) };
  });

  return {
    rows,
    overall: {
      total: counted, unknown, reached: overallReached, pct: pctOf(overallReached, counted),
      coverage: counted + unknown > 0 ? Math.round((counted / (counted + unknown)) * 1000) / 10 : null,
    },
    counted, undated, unknown, pullThrough, open, closedOnly,
  };
}

// The opps that closed in the last week — the table under New Opps.
//
// The New Opps subtab answers "what has just started"; this is the other
// half of the same week. A deal that landed or died three days ago is
// exactly as much news as one that opened three days ago, and until now the
// only way to see it was to sort the whole Opps table by Close Date.
//
// Closed means the two stages that end an opp — Sold and Not Sold. The
// other late stages (Contracting, Agreement Sent) are paperwork on a deal
// still in flight, which is what every other reader of this data treats
// them as.
//
// The window is a Close Date one, read at local midnight, so "7 days" is
// seven calendar days rather than a rolling 168 hours that moves with the
// time of day the page is opened. A close dated in the future isn't in the
// past week however it got there, and an opp with no usable Close Date
// can't be placed at all — those are counted and reported rather than
// silently dropped, since a Sold deal missing its Close Date is a gap in
// the record worth seeing.
//
// Pure — records in, plain rows out — so scripts/recentlyClosedOpps.test.mjs
// can exercise it without React.

import { parseDateMs } from './oppsMetrics.js';

export const RECENTLY_CLOSED_DAYS = 7;

// The stages that mean the opp is over, either way.
export const CLOSED_STAGES = ['Sold', 'Not Sold'];
const CLOSED_STAGES_SET = new Set(CLOSED_STAGES);

export function isClosedStage(stage) {
  return CLOSED_STAGES_SET.has(String(stage ?? '').trim());
}

const DAY_MS = 86400000;

/** Local midnight for a timestamp — the day boundary the window counts in. */
function startOfDay(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Whole days between an opp's close and today. 0 is today, 3 is three days
 * ago, negative is a close dated in the future. Null when the record has no
 * usable Close Date.
 */
export function daysSinceClose(record, nowMs = Date.now()) {
  const closed = parseDateMs(record?.['Close Date']);
  if (closed === null) return null;
  return Math.round((startOfDay(nowMs) - closed) / DAY_MS);
}

/**
 * Opps closed within the window, newest close first.
 *
 * Returns { rows, undated }:
 *   rows     the closed opps inside the window, each carrying `_daysAgo`
 *   undated  closed opps left out because they carry no usable Close Date
 *
 * Ties on the same day fall back to account name, so the order is stable
 * rather than however the records happened to arrive.
 */
export function recentlyClosedOpps(records, { days = RECENTLY_CLOSED_DAYS, nowMs = Date.now() } = {}) {
  const rows = [];
  let undated = 0;
  for (const r of (records || [])) {
    if (!isClosedStage(r?.['Stage'])) continue;
    const ago = daysSinceClose(r, nowMs);
    if (ago === null) { undated += 1; continue; }
    if (ago < 0 || ago > days) continue;
    rows.push({ ...r, _daysAgo: ago });
  }
  rows.sort((a, b) => a._daysAgo - b._daysAgo
    || String(a['Account'] || '').localeCompare(String(b['Account'] || '')));
  return { rows, undated };
}

/** "today", "yesterday", "3 days ago" — how a row's age reads in the table. */
export function closedAgoLabel(daysAgo) {
  if (daysAgo === 0) return 'today';
  if (daysAgo === 1) return 'yesterday';
  return `${daysAgo} days ago`;
}

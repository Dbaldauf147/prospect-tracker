// What a deal was estimated at, against what it was actually quoted.
//
// Two numbers land on an opp at two different moments, and until now the
// second one erased the first:
//
//   the estimate  the Deal Size the user lands on in the popup that fires
//                 when an opp moves to Lead (priced off the rate card, or
//                 typed), or the Deal Pricing estimator's saved figure —
//                 either way it is the "Estimated Fee" column
//   the quote     the Year-1 total off an SIA option saved to the opp,
//                 which writes the "Quoted Amount" cell
//
// Both used to write Quoted Amount, so attaching the SIA overwrote the
// estimate and there was nothing left to compare. The estimate now has a
// column of its own, and this reads the gap between them.
//
// "Latest" on both sides falls out of where the numbers live rather than
// from any history kept here: re-running the Lead popup or re-saving an
// estimate rewrites Estimated Fee, and saving another SIA option rewrites
// Quoted Amount. Each side is whatever was last written to it.
//
// Pure: an opp record in, a comparison out (scripts/quotedVariance.test.mjs).

import { parseMoney, formatMoney } from './servicePricing.js';

export const QUOTED_VARIANCE_COLUMN = 'Estimated vs. Actual Quoted';

// The snapshot an SIA option leaves on the opp (utils/oppsPricingSnapshot).
// Its presence is what says a real quote exists: before it, Quoted Amount
// still holds the estimate the Lead popup put there, and comparing that
// with itself would print a confident 0% against a deal nobody has quoted.
const SNAPSHOT_FIELD = '_pricingOption';

/**
 * The gap between an opp's estimate and its actual quote.
 *
 * Null whenever there is nothing honest to show: no SIA attached yet, no
 * estimate to measure against, or either side unreadable as money.
 *
 *   { estimated, quoted, delta, pct }
 *
 * `delta` is quoted − estimated, so a quote that came in ABOVE the
 * estimate is positive. `pct` is that as a share of the estimate, and is
 * null when the estimate is zero — a number that can't be a percentage of
 * anything, where printing one would be inventing it.
 */
export function quotedVariance(opp) {
  if (!opp || !opp[SNAPSHOT_FIELD]) return null;
  const estimated = parseMoney(opp['Estimated Fee']);
  // The live cell rather than the snapshot's own total: an SIA save writes
  // it, and a correction typed over it afterwards is the more current
  // answer to "what did we actually quote".
  const quoted = parseMoney(opp['Quoted Amount']);
  if (estimated === null || quoted === null) return null;
  const delta = quoted - estimated;
  return {
    estimated,
    quoted,
    delta,
    pct: estimated === 0 ? null : (delta / estimated) * 100,
  };
}

/**
 * The comparison as one cell: "+$8,400 (+12.7%)".
 *
 * Signed on purpose, both halves. "12.7%" alone doesn't say which way the
 * quote went, and which way is the entire question being asked.
 */
export function formatQuotedVariance(v) {
  if (!v) return '';
  const sign = v.delta > 0 ? '+' : v.delta < 0 ? '-' : '';
  const money = `${sign}${formatMoney(Math.abs(v.delta))}`;
  if (v.pct === null) return money;
  const pct = `${sign}${Math.abs(v.pct).toFixed(1)}%`;
  return `${money} (${pct})`;
}

/** Over, under, or bang on — what the cell colours itself by. */
export function quotedVarianceTone(v) {
  if (!v || v.delta === 0) return 'even';
  return v.delta > 0 ? 'over' : 'under';
}

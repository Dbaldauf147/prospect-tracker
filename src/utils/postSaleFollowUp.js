// Post-sale follow-up tracking: which uploaded deals still need a follow-up,
// and how they stand against the 60-day goal.
//
// Three surfaces read this — the Pipeline dashboard's Post-Sale Follow-Up
// table, that table's Excel export, and the Issues tab's overdue detector — so
// the definition lives here rather than being restated per consumer. A deal
// that reads "4d overdue" on the Pipeline table is the same row the Issues tab
// raises, by construction.
// Extension-explicit so plain `node scripts/*.test.mjs` can load this
// module the way the repo's other util tests load theirs.
import { asDate } from './dealsFormat.js';

const MS_PER_DAY = 86400000;

// The Deals subtab's per-deal "Ignore this deal" flag, written onto the row
// alongside its cell values (see DealsView). Ignoring a deal greys out its
// handoff progress and drops it from that tab's tallies — and it means the
// same thing here: a deal you've decided not to chase shouldn't come back as
// a missing follow-up on the Issues page or the Pipeline table.
//
// Defined here rather than in DealsView because three surfaces outside that
// tab now read it; DealsView imports it back.
export const DEAL_IGNORED_KEY = '__progressIgnored';

// Dashes are how the uploaded workbooks spell "blank", so they don't count
// as the flag being set. Mirrors the isFilled() DealsView writes it with.
const DASH_PLACEHOLDERS = new Set(['-', '\u2013', '\u2014']);

export function isIgnoredDeal(row) {
  const v = row?.[DEAL_IGNORED_KEY];
  if (v == null) return false;
  const s = String(v).trim();
  return s !== '' && !DASH_PLACEHOLDERS.has(s);
}

// A post-sale follow-up should land within 60 days of the sale.
export const POST_SALE_GOAL_DAYS = 60;

// A deal needs a post-sale follow-up when its "Follow Up On Sale" cell is
// blank (or a placeholder dash / Excel #N/A error). Mirrors how the Deals
// subtab stores that date column so the surfaces agree on what counts as "no
// value". A deliberate "N/A" (marked from the follow-up editor to say a deal
// never needs a follow-up) counts as resolved and drops the row off the list;
// only Excel's #N/A error placeholder still reads as missing.
export function isBlankFollowUp(row) {
  const v = String(row?.['Follow Up On Sale'] ?? '').trim();
  if (!v) return true;
  return ['-', '\u2014', '#n/a'].includes(v.toLowerCase());
}

// The date a deal closed/sold. Deals don't carry an explicit close date, so we
// use Original Contract Start — the same field the Deals tab treats as the
// deal's canonical date (its Year column derives from it). Date or null.
export function dealSoldDate(row) {
  return asDate(row?.['Original Contract Start']);
}

// Timestamp form of the above, for sorting. NaN when the deal has no date.
export function dealSoldTs(row) {
  const d = dealSoldDate(row);
  return d ? d.getTime() : NaN;
}

// Days remaining until the 60-day post-sale follow-up deadline. Positive
// means days left, 0 means it's due today, negative means it's overdue.
// Returns null when the deal has no sold date to count from.
export function daysToFollowUpGoal(soldRaw) {
  const d = asDate(soldRaw);
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  const daysSince = Math.round((today.getTime() - start.getTime()) / MS_PER_DAY);
  return POST_SALE_GOAL_DAYS - daysSince;
}

// The date the 60-day goal falls due, or null for an undated deal.
export function followUpGoalDate(soldRaw) {
  const d = asDate(soldRaw);
  if (!d) return null;
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  return new Date(start.getTime() + POST_SALE_GOAL_DAYS * MS_PER_DAY);
}

// Plain-text label for the countdown — shared by the on-screen cell, the Excel
// export and the Issues row so all three read the same. '' for an undated deal.
export function followUpGoalLabel(left) {
  if (left == null) return '';
  if (left === 0) return 'Today';
  return left > 0 ? `${left}d left` : `${Math.abs(left)}d overdue`;
}

// Every uploaded deal still missing a "Follow Up On Sale" value, sorted oldest
// sold first — the most overdue for a follow-up. Undated rows sink to the
// bottom. Blank spacer rows (no client and no agreement) are skipped, and so
// are deals marked "Ignore this deal" on the Deals subtab.
export function postSaleFollowUpRows(dealsList) {
  const out = [];
  for (const d of (dealsList || [])) {
    const client = String(d['Client Name'] ?? d['Client Name '] ?? '').trim();
    const agreement = String(d['Agreement Name'] ?? '').trim();
    if (!client && !agreement) continue;
    // Ignoring a deal is the user saying they're done with it. Filtered here,
    // in the one definition all these surfaces share, so the Issues page and
    // the Pipeline table can't disagree about whether it's still owed.
    if (isIgnoredDeal(d)) continue;
    if (!isBlankFollowUp(d)) continue;
    out.push(d);
  }
  out.sort((a, b) => {
    const ta = dealSoldTs(a);
    const tb = dealSoldTs(b);
    const aNan = Number.isNaN(ta);
    const bNan = Number.isNaN(tb);
    if (aNan && bNan) return 0;
    if (aNan) return 1;
    if (bNan) return -1;
    return ta - tb;
  });
  return out;
}

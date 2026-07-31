// The opp rows behind each captured Quoted Projections month end.
//
// The monthly figures themselves live in quotedProjectionsStore — five
// numbers a month, small enough for localStorage. The rows that PRODUCED
// those numbers run to hundreds of opps a month, so they go to IndexedDB
// rather than competing for the localStorage quota.
//
// Why keep them at all: a past month's export used to rebuild the pipeline
// out of today's Opps data, since the rows were never stored. That rebuild
// carries today's Chance? and Stage, so a re-graded or since-closed opp lands
// in the wrong bucket and the export's Totals check shows a gap against the
// plotted figure. Capturing the rows with the snapshot closes that gap for
// every month captured from here on.
//
// Each entry keeps the values that were captured alongside the rows, so an
// export can check the plotted figures still belong to these rows — a hand
// edit through "Edit values" moves a number away from its rows, and the
// export has to fall back to the rebuild when that happens.

import { dbGet, dbGetAll, dbPut } from './db';

const STORE = 'quoted-month-rows';

// The four series the opp rows explain. bfoPipe is checked separately: it
// comes from the BFO Activity paste, not from Opps, so editing it doesn't
// invalidate the opp rows (or vice versa).
export const QUOTED_ROW_FIELDS = ['weak', 'ok', 'expected', 'agreements'];

export async function saveQuotedMonthRows(monthKey, values, rows, bfoRows) {
  if (!monthKey || !Array.isArray(rows)) return;
  try {
    await dbPut(STORE, {
      monthKey,
      capturedAt: new Date().toISOString(),
      values: { ...(values || {}) },
      rows,
      bfoRows: Array.isArray(bfoRows) ? bfoRows : [],
    }, monthKey);
  } catch (err) {
    console.warn('Failed to store the quoted month rows:', err);
  }
}

export async function loadQuotedMonthRows(monthKey) {
  if (!monthKey) return null;
  try {
    const entry = await dbGet(STORE, monthKey);
    return entry && Array.isArray(entry.rows) ? entry : null;
  } catch (err) {
    console.warn('Failed to read the quoted month rows:', err);
    return null;
  }
}

// Month key → entry, for the months this user has captured. dbGetAll drops
// the keys, which is why each entry carries its own monthKey.
export async function loadAllQuotedMonthRows() {
  try {
    const all = await dbGetAll(STORE);
    const out = {};
    for (const entry of all) {
      if (entry && entry.monthKey && Array.isArray(entry.rows)) out[entry.monthKey] = entry;
    }
    return out;
  } catch (err) {
    console.warn('Failed to list the quoted month rows:', err);
    return {};
  }
}

// Do the plotted figures still match what was captured with these rows?
// Captured values are rounded to whole $K (same as "Edit values" stores), so
// compare with a half-$K tolerance; a figure missing on both sides matches.
export function capturedValuesMatch(entry, plotted, fields = QUOTED_ROW_FIELDS) {
  if (!entry || !entry.values || !plotted) return false;
  return fields.every((f) => {
    const captured = entry.values[f];
    const shown = plotted[f];
    if (captured == null && shown == null) return true;
    if (captured == null || shown == null) return false;
    return Math.abs(Number(captured) - Number(shown)) <= 0.5;
  });
}

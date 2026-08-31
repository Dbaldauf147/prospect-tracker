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

import { collection, doc } from 'firebase/firestore';
import { db as firestore } from '../firebase';
import { dbGet, dbGetAll, dbPut, getDbUserId } from './db';
import { readChunkedCollection, readChunkedDoc, writeChunkedDoc } from './chunkedDoc.js';

const STORE = 'quoted-month-rows';

// The Firestore copy. A month's rows are hundreds of opps — past the 1 MB
// document cap on a busy month — so they go through the chunked store.
//
// These used to be IndexedDB and nothing else, which made the figures and
// the rows behind them survive a wipe differently: quotedProjectionsStore
// is mirrored, so the five numbers a month came back, and the rows that
// explain them did not. A past-month export then silently fell back to
// rebuilding the pipeline out of TODAY'S opps — the lossy rebuild this
// store was added to replace.
function monthDoc(userId, monthKey) {
  return doc(firestore, 'quotedMonthRows', String(userId), 'months', String(monthKey));
}

function monthsCol(userId) {
  return collection(firestore, 'quotedMonthRows', String(userId), 'months');
}

// The four series the opp rows explain. bfoPipe is checked separately: it
// comes from the BFO Activity paste, not from Opps, so editing it doesn't
// invalidate the opp rows (or vice versa).
export const QUOTED_ROW_FIELDS = ['weak', 'ok', 'expected', 'agreements'];

export async function saveQuotedMonthRows(monthKey, values, rows, bfoRows) {
  if (!monthKey || !Array.isArray(rows)) return;
  const entry = {
    monthKey,
    capturedAt: new Date().toISOString(),
    values: { ...(values || {}) },
    rows,
    bfoRows: Array.isArray(bfoRows) ? bfoRows : [],
  };
  try {
    await dbPut(STORE, entry, monthKey);
  } catch (err) {
    console.warn('Failed to store the quoted month rows:', err);
  }
  // Best-effort, and never in the way of the local save: a capture that
  // reached IndexedDB has done its job for this device even if the network
  // is out.
  const userId = getDbUserId();
  if (!userId) return;
  try {
    await writeChunkedDoc(monthDoc(userId, monthKey), entry, {
      meta: { monthKey, capturedAt: entry.capturedAt, rowCount: rows.length },
    });
  } catch (err) {
    console.warn('Quoted month rows Firestore backup failed:', monthKey, err);
  }
}

export async function loadQuotedMonthRows(monthKey) {
  if (!monthKey) return null;
  try {
    const entry = await dbGet(STORE, monthKey);
    if (entry && Array.isArray(entry.rows)) return entry;
  } catch (err) {
    console.warn('Failed to read the quoted month rows:', err);
  }
  // Nothing locally — a cleared browser, or a month captured on the other
  // machine. Fetch it and cache it so the next read is local again.
  const userId = getDbUserId();
  if (!userId) return null;
  try {
    const remote = await readChunkedDoc(monthDoc(userId, monthKey));
    const entry = remote?.value;
    if (!entry || !Array.isArray(entry.rows)) return null;
    try { await dbPut(STORE, entry, monthKey); } catch { /* cache only */ }
    return entry;
  } catch (err) {
    console.warn('Quoted month rows restore failed:', monthKey, err);
    return null;
  }
}

// Pull down every captured month this browser is missing. Called once at
// signin: loadAllQuotedMonthRows feeds the export, and an export cannot
// go and fetch a month it does not know it is missing.
export async function hydrateQuotedMonthRows(userId) {
  if (!userId) return 0;
  const local = await loadAllQuotedMonthRows();
  const remote = await readChunkedCollection(monthsCol(userId));
  let restored = 0;
  for (const { value } of remote) {
    const key = value?.monthKey;
    if (!key || local[key] || !Array.isArray(value.rows)) continue;
    try { await dbPut(STORE, value, key); restored++; } catch { /* best-effort */ }
  }
  return restored;
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

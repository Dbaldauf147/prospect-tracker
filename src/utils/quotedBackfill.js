// Recovering a Quoted Projections month end that was never captured.
//
// A finished month keeps the reading taken on its last day. When nobody (and
// no server job) took one, the YOY chart rebuilds the month from today's Opps
// rows, and where nothing dates the opps to either side of the month end that
// rebuild is just today's pipeline: the month then moves every time today's
// figures do. That is what happened to October 2026, whose last day fell
// before the server capture (api/quoted-projections-month-end.js) existed.
//
// The nightly backup holds the Opps rows and the BFO Activity paste as they
// stood each morning, so the first backup after a month end is a real
// reading of that month's close. This picks that backup and works out the
// figures from it; the page stores them as the month's month-end capture, so
// the rebuild leaves the month alone from then on. Backups are a 30-deep
// ring, so this only reaches about a month back.

import { liveQuotedFigures, roundQuotedFigures } from './quotedLiveSnapshot.js';
import { monthEndMs } from './quotedMonthRebuild.js';

// utils/localMirrorSync's id for the BFO Activity paste (api/_lib/firestoreChunks MIRROR.bfo).
const BFO_MIRROR_ID = 'idb__bfo-activity__current';

// A backup taken longer after the month end than this is too far into the
// next month to stand for the close.
export const BACKFILL_MAX_LAG_MS = 3 * 86400000;

/**
 * The backup to read a month end from: the earliest one made after the
 * month's last instant (UTC), provided it is within BACKFILL_MAX_LAG_MS.
 * `files` is /api/backups-list's [{ name, createdTime }]. null when none fits.
 */
export function backupForMonthEnd(files, monthKey) {
  const end = monthEndMs(monthKey);
  if (end == null) return null;
  let best = null;
  for (const f of Array.isArray(files) ? files : []) {
    const at = Date.parse(String(f?.createdTime || ''));
    if (!f?.name || Number.isNaN(at) || at <= end || at - end > BACKFILL_MAX_LAG_MS) continue;
    if (!best || at < best.at) best = { name: f.name, createdTime: f.createdTime, at };
  }
  return best ? { name: best.name, createdTime: best.createdTime } : null;
}

/** The five figures, whole $K, as a backup's data stood. null when it holds no opps. */
export function quotedFiguresFromBackup(backup) {
  const c = backup?.collections || {};
  const records = Array.isArray(c.opps2Data?.records) ? c.opps2Data.records : [];
  const bfo = c.localMirrors && typeof c.localMirrors === 'object' ? c.localMirrors[BFO_MIRROR_ID] : null;
  return roundQuotedFigures(liveQuotedFigures(records, bfo || null));
}

/**
 * The stored entry for a month recovered this way: an auto capture stamped
 * with the backup's own time (which is what makes it a month-end reading to
 * capturedAtMonthEnd), plus where it came from.
 */
export function backfilledMonth(values, file) {
  if (!values || !file?.createdTime) return null;
  return { ...values, _auto: true, _capturedAt: new Date(file.createdTime).toISOString(), _fromBackup: file.name };
}

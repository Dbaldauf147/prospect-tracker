// A day-by-day record of how many of your firms had activity in the last
// 120 days, per tier plus the untiered ones, for the Prospecting History
// subtab's bar chart.
//
// Like the Tiered Activity record next to it (tieredCoverageHistory.js),
// this can't be worked out after the fact: the activity feed keeps only the
// newest email or call per address, so it is written once a day while
// Tiered Activity or History is open and the chart fills in from there.
//
// What a row holds (keyed by the local day, YYYY-MM-DD):
//
//   buckets      { 'Tier 1': { active, total }, ..., 'Not tiered': {...} }
//   windowDays   the window used (120 today), kept so a later change to it
//                can't be mistaken for a jump in activity
//   at           wall-clock ms of the reading
//
// The latest reading of a day wins. Stored in localStorage under the
// user's key and mirrored to Firestore.

import { ACTIVE_FIRM_BUCKETS } from './tieredAccountActivity.js';
import { userLsGet, userLsSet } from './userLs.js';
import { registerMirroredKey, queueMirrorPush } from './localMirrorSync.js';

export const ACTIVE_FIRMS_HISTORY_KEY = 'active-firms-history';
export const ACTIVE_FIRMS_HISTORY_EVENT = 'active-firms-history-changed';

registerMirroredKey(ACTIVE_FIRMS_HISTORY_KEY, ACTIVE_FIRMS_HISTORY_EVENT);

export const ACTIVE_FIRMS_MAX_DAYS = 1000;

export function parseActiveFirmsHistory(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch { return {}; }
}

const count = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);

// The reading off an activeFirmsByBucket result, or null when a bucket is
// missing: a hole would chart that bucket dropping to nothing for the day.
export function readingFromBuckets(buckets, windowDays) {
  if (!buckets || typeof buckets !== 'object') return null;
  const out = {};
  for (const b of ACTIVE_FIRM_BUCKETS) {
    const active = count(buckets[b]?.active);
    const total = count(buckets[b]?.total);
    if (active == null || total == null) return null;
    out[b] = { active, total };
  }
  return { buckets: out, windowDays: count(windowDays) };
}

function sameReading(a, b) {
  if (!a || !b || a.windowDays !== b.windowDays) return false;
  return ACTIVE_FIRM_BUCKETS.every(k =>
    a.buckets?.[k]?.active === b.buckets?.[k]?.active && a.buckets?.[k]?.total === b.buckets?.[k]?.total);
}

// The history with `reading` under `day`, oldest days past the cap dropped.
// The same object back when nothing changes, so the caller can skip a write.
export function withActiveFirmsReading(history, day, reading, now = Date.now()) {
  const prev = (history && typeof history === 'object') ? history : {};
  if (!day || !reading) return prev;
  if (sameReading(prev[day], reading)) return prev;
  const next = { ...prev, [day]: { ...reading, at: now } };
  const keys = Object.keys(next).sort();
  if (keys.length <= ACTIVE_FIRMS_MAX_DAYS) return next;
  const out = {};
  for (const k of keys.slice(keys.length - ACTIVE_FIRMS_MAX_DAYS)) out[k] = next[k];
  return out;
}

export function recordActiveFirms(day, buckets, windowDays, now = Date.now()) {
  const reading = readingFromBuckets(buckets, windowDays);
  if (!day || !reading) return false;
  const history = parseActiveFirmsHistory(userLsGet(ACTIVE_FIRMS_HISTORY_KEY));
  const next = withActiveFirmsReading(history, day, reading, now);
  if (next === history) return false;
  try {
    userLsSet(ACTIVE_FIRMS_HISTORY_KEY, JSON.stringify(next));
    queueMirrorPush(ACTIVE_FIRMS_HISTORY_KEY);
    window.dispatchEvent(new CustomEvent(ACTIVE_FIRMS_HISTORY_EVENT));
    return true;
  } catch { return false; }
}

// --- reading it back as an external store ------------------------------------

const EVENTS = [ACTIVE_FIRMS_HISTORY_EVENT, 'storage'];

export function subscribeActiveFirmsHistory(onChange) {
  EVENTS.forEach(e => window.addEventListener(e, onChange));
  return () => EVENTS.forEach(e => window.removeEventListener(e, onChange));
}

export function activeFirmsHistorySnapshot() {
  return userLsGet(ACTIVE_FIRMS_HISTORY_KEY) || '';
}

// The chart's points, one per day on the axis: each bucket's active count
// under its name (null where the day wasn't recorded, so no bar is drawn),
// its total under `${bucket} total`, and the day's sum as `active`.
export function activeFirmsChartRows(history, days) {
  const h = history || {};
  return days.map((iso) => {
    const r = h[iso] || null;
    const row = { iso, recorded: !!r, windowDays: r?.windowDays ?? null, active: null };
    for (const b of ACTIVE_FIRM_BUCKETS) {
      const c = r?.buckets?.[b];
      row[b] = c ? c.active : null;
      row[`${b} total`] = c ? c.total : null;
      if (c) row.active = (row.active || 0) + c.active;
    }
    return row;
  });
}

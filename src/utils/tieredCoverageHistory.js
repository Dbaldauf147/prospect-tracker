// A day-by-day record of the Tiered Activity tiles - per tier, the share of
// your Tier 1, 2 and 3 accounts reached in the chosen window - for the
// Prospecting History subtab's line chart.
//
// The tiles only ever say "now": the activity feed keeps just the newest
// email or call per address, so last Tuesday's percentage can't be worked
// out after the fact. This keeps one small row per day, written while the
// Tiered Activity or History subtab is open (see useTieredActivity), so the
// chart fills in from the first day either is visited.
//
// What a row holds (keyed by the local day, YYYY-MM-DD):
//
//   tiers        { 'Tier 1': { active, total }, ... } exactly as the tiles
//                count them (Hide statuses applied, the search box not)
//   windowDays   the "Active within" window the reading used, so a day
//                read at 30 days isn't mistaken for one read at 60
//   at           wall-clock ms of the reading
//
// The latest reading of a day wins: coverage is a level, and where it
// stood when the day was left is what the day is remembered by.
//
// Stored in localStorage under the user's key and mirrored to Firestore,
// like the ladder history, so it follows the user to another machine.

import { TIERS } from '../data/enums.js';
import { userLsGet, userLsSet } from './userLs.js';
import { registerMirroredKey, queueMirrorPush } from './localMirrorSync.js';

export const TIERED_COVERAGE_HISTORY_KEY = 'tiered-coverage-history';
export const TIERED_COVERAGE_HISTORY_EVENT = 'tiered-coverage-history-changed';

registerMirroredKey(TIERED_COVERAGE_HISTORY_KEY, TIERED_COVERAGE_HISTORY_EVENT);

export const COVERAGE_MAX_DAYS = 1000;

export function parseCoverageHistory(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch { return {}; }
}

const count = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);

// The reading off a tierActivityCoverage result, or null when there is
// nothing to record. Every tier has to be there: a hole would chart a tier
// dropping out for the day.
export function readingFromCoverage(coverage, windowDays) {
  if (!Array.isArray(coverage)) return null;
  const tiers = {};
  for (const tier of TIERS) {
    const c = coverage.find(x => x?.tier === tier);
    const active = count(c?.active);
    const total = count(c?.total);
    if (active == null || total == null) return null;
    tiers[tier] = { active, total };
  }
  return { tiers, windowDays: count(windowDays) };
}

function sameReading(a, b) {
  if (!a || !b || a.windowDays !== b.windowDays) return false;
  return TIERS.every(t => a.tiers?.[t]?.active === b.tiers?.[t]?.active && a.tiers?.[t]?.total === b.tiers?.[t]?.total);
}

// The history with `reading` recorded under `day`, oldest days past the
// cap dropped. Returns the same object when nothing changes, so the caller
// can skip a write.
export function withDayReading(history, day, reading, now = Date.now()) {
  const prev = (history && typeof history === 'object') ? history : {};
  if (!day || !reading) return prev;
  if (sameReading(prev[day], reading)) return prev;
  const next = { ...prev, [day]: { ...reading, at: now } };
  const keys = Object.keys(next).sort();
  if (keys.length <= COVERAGE_MAX_DAYS) return next;
  const out = {};
  for (const k of keys.slice(keys.length - COVERAGE_MAX_DAYS)) out[k] = next[k];
  return out;
}

export function recordTieredCoverage(day, coverage, windowDays, now = Date.now()) {
  const reading = readingFromCoverage(coverage, windowDays);
  if (!day || !reading) return false;
  const history = parseCoverageHistory(userLsGet(TIERED_COVERAGE_HISTORY_KEY));
  const next = withDayReading(history, day, reading, now);
  if (next === history) return false;
  try {
    userLsSet(TIERED_COVERAGE_HISTORY_KEY, JSON.stringify(next));
    queueMirrorPush(TIERED_COVERAGE_HISTORY_KEY);
    window.dispatchEvent(new CustomEvent(TIERED_COVERAGE_HISTORY_EVENT));
    return true;
  } catch { return false; }
}

// --- reading it back as an external store ------------------------------------

const EVENTS = [TIERED_COVERAGE_HISTORY_EVENT, 'storage'];

export function subscribeCoverageHistory(onChange) {
  EVENTS.forEach(e => window.addEventListener(e, onChange));
  return () => EVENTS.forEach(e => window.removeEventListener(e, onChange));
}

export function coverageHistorySnapshot() {
  return userLsGet(TIERED_COVERAGE_HISTORY_KEY) || '';
}

// The chart's points, one per day on the axis (the History page's working
// days), each tier's whole percentage under its name, null where the day
// wasn't recorded or the tier had no accounts.
export function coverageChartRows(history, days) {
  const h = history || {};
  return days.map((iso) => {
    const r = h[iso] || null;
    const row = { iso, recorded: !!r, windowDays: r?.windowDays ?? null };
    for (const tier of TIERS) {
      const t = r?.tiers?.[tier];
      row[tier] = t && t.total > 0 ? Math.round((t.active / t.total) * 100) : null;
      row[`${tier} counts`] = t ? { active: t.active, total: t.total } : null;
    }
    return row;
  });
}

// A day-by-day record of how far down the Prospecting ladder the user got,
// for the page's History subtab.
//
// The ladder itself only ever says "today": a manual mark expires
// overnight and the counted steps are live numbers, so nothing on the page
// remembered whether Tuesday ended at step 1 or step 4. This keeps one
// small row per day, written by App while it is open (see
// useProspectingHistoryRecorder), so the History subtab can chart it.
//
// What a row holds:
//
//   reached        how many steps, from the top, were clear at once - the
//                  ladder's own notion of progress (ladderStates): a step
//                  only counts once everything above it is clear too, so a
//                  tick on step 5 while step 1 is still red is not progress
//                  to step 5. The BEST reading of the day, not the last:
//                  Call In counts move as the day goes on, and the question
//                  is how far the user got, not what the ladder said at the
//                  moment the tab was closed.
//   total          how many steps the ladder had at that best reading.
//   reachedTitle   the title of the last clear step at that reading, and
//   nextTitle      the one the ladder stopped on (absent when all clear),
//                  stored as text so renaming or reordering steps later
//                  doesn't rewrite what an old day said.
//   overdueStart   step 1's count (opps due to be called) the first time it
//                  was read that day, and
//   overdueEnd     the most recent reading - so the chart shows both where
//                  the day started and where it was left.
//   updatedAt      wall-clock ms of the last write.
//
// Stored in localStorage under the user's key and mirrored to Firestore,
// the same way the caught-up marks are, so the history survives a cleared
// browser and follows the user to another machine.

import { userLsGet, userLsSet } from './userLs.js';
import { registerMirroredKey, queueMirrorPush } from './localMirrorSync.js';

export const PROSPECTING_HISTORY_KEY = 'prospecting-history';
export const PROSPECTING_HISTORY_EVENT = 'prospecting-history-changed';

registerMirroredKey(PROSPECTING_HISTORY_KEY, PROSPECTING_HISTORY_EVENT);

// Kept bounded so the mirrored value stays small: a few years of working
// days is far more than the chart will ever be asked to show.
export const HISTORY_MAX_DAYS = 1000;

export function parseHistory(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch { return {}; }
}

export function loadHistory() {
  return parseHistory(userLsGet(PROSPECTING_HISTORY_KEY));
}

// Where the ladder stands right now, from ladderStates' rows and the steps
// they belong to. Null while the top of the ladder is still loading: a day
// recorded as "0 steps" because the opps hadn't landed yet would be a
// worse day than the user actually had - and since the best reading wins,
// it would do no harm, but there is nothing to say yet either.
export function ladderProgress(states, steps) {
  const rows = Array.isArray(states) ? states : [];
  if (rows.length === 0) return null;
  if (rows[0]?.state === 'unknown') return null;
  let reached = 0;
  for (const r of rows) {
    if (r?.state !== 'caught-up') break;
    reached += 1;
  }
  const titleOf = (key) => {
    const s = (Array.isArray(steps) ? steps : []).find(x => x?.key === key);
    return String(s?.title || key || '');
  };
  const out = { reached, total: rows.length };
  if (reached > 0) out.reachedTitle = titleOf(rows[reached - 1].key);
  if (reached < rows.length) out.nextTitle = titleOf(rows[reached].key);
  return out;
}

// Fold one reading into a day's row. Pure, so the rule can be tested
// without a browser: progress keeps the best of the day, the overdue count
// keeps its first reading and moves its last. Returns the same object when
// nothing changed, so the caller can skip a write.
export function mergeDay(prev, { progress = null, overdue = null } = {}, now = Date.now()) {
  const base = prev && typeof prev === 'object' ? prev : {};
  const next = { ...base };
  let changed = false;
  if (progress && (typeof base.reached !== 'number' || progress.reached > base.reached)) {
    next.reached = progress.reached;
    next.total = progress.total;
    if (progress.reachedTitle) next.reachedTitle = progress.reachedTitle; else delete next.reachedTitle;
    if (progress.nextTitle) next.nextTitle = progress.nextTitle; else delete next.nextTitle;
    changed = true;
  } else if (progress && progress.reached === base.reached && progress.total !== base.total) {
    // Same progress on a ladder that has since grown or shrunk: keep the
    // denominator current so "3 of 7" doesn't read "3 of 6" all day.
    next.total = progress.total;
    if (progress.nextTitle) next.nextTitle = progress.nextTitle; else delete next.nextTitle;
    changed = true;
  }
  if (typeof overdue === 'number' && Number.isFinite(overdue)) {
    if (typeof base.overdueStart !== 'number') { next.overdueStart = overdue; changed = true; }
    if (base.overdueEnd !== overdue) { next.overdueEnd = overdue; changed = true; }
  }
  if (!changed) return base;
  next.updatedAt = now;
  return next;
}

// Drop the oldest days past the cap. ISO dates sort as strings.
export function trimHistory(history, max = HISTORY_MAX_DAYS) {
  const keys = Object.keys(history || {}).sort();
  if (keys.length <= max) return history;
  const out = {};
  for (const k of keys.slice(keys.length - max)) out[k] = history[k];
  return out;
}

// Record one reading for `day` (YYYY-MM-DD). Writes only when the row
// actually changed, so App re-rendering all day costs nothing.
export function recordProspectingDay(day, reading, now = Date.now()) {
  if (!day) return false;
  const history = loadHistory();
  const prev = history[day];
  const next = mergeDay(prev, reading, now);
  if (next === prev || (prev == null && next && Object.keys(next).length === 0)) return false;
  const out = trimHistory({ ...history, [day]: next });
  try {
    userLsSet(PROSPECTING_HISTORY_KEY, JSON.stringify(out));
    queueMirrorPush(PROSPECTING_HISTORY_KEY);
    window.dispatchEvent(new CustomEvent(PROSPECTING_HISTORY_EVENT));
    return true;
  } catch { return false; }
}

// --- reading it back as an external store ------------------------------------

const HISTORY_EVENTS = [PROSPECTING_HISTORY_EVENT, 'storage'];

export function subscribeHistory(onChange) {
  HISTORY_EVENTS.forEach(e => window.addEventListener(e, onChange));
  return () => HISTORY_EVENTS.forEach(e => window.removeEventListener(e, onChange));
}

export function historySnapshot() {
  return userLsGet(PROSPECTING_HISTORY_KEY) || '';
}

// --- the chart's x-axis --------------------------------------------------------

function parseISO(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function toISO(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// The working days (Mon-Fri) ending at `today`, oldest first, `count` of
// them - plus any weekend day inside that span that has a record, since a
// Saturday the user did work belongs on the chart. A weekday with no row
// stays in as a gap: a day the app wasn't opened is itself worth seeing.
export function workingDaysBack(today, count, history = {}) {
  const out = [];
  const dt = parseISO(today);
  let weekdays = 0;
  for (let guard = 0; weekdays < count && guard < count * 3 + 7; guard += 1) {
    const dow = dt.getDay();
    const iso = toISO(dt);
    if (dow !== 0 && dow !== 6) { out.push(iso); weekdays += 1; }
    else if (history[iso]) out.push(iso);
    dt.setDate(dt.getDate() - 1);
  }
  return out.reverse();
}

// The rows the History charts plot, one per day on the axis.
export function historyChartRows(history, days) {
  const h = history || {};
  return days.map(iso => {
    const r = h[iso] || null;
    const dt = parseISO(iso);
    return {
      iso,
      label: dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      weekday: dt.toLocaleDateString('en-US', { weekday: 'short' }),
      recorded: !!r,
      reached: typeof r?.reached === 'number' ? r.reached : null,
      total: typeof r?.total === 'number' ? r.total : null,
      reachedTitle: r?.reachedTitle || '',
      nextTitle: r?.nextTitle || '',
      overdueStart: typeof r?.overdueStart === 'number' ? r.overdueStart : null,
      overdueEnd: typeof r?.overdueEnd === 'number' ? r.overdueEnd : null,
    };
  });
}

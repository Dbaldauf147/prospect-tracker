// Snoozed-issue overrides for the Issues tab. Snoozing an issue keeps it
// visible on the tab (so it can be un-snoozed) but takes it out of the
// open-issue count shown on the sidebar badge. Stored in its own
// localStorage key, scoped per user, keyed by the stable issue id that
// each detector in utils/clientIssues.js assigns (e.g. `neg-days:<id>`),
// so a snooze survives reloads and follows the issue as data refreshes.
//
// A snooze carries how long it lasts: `{ until: <epoch ms> }` for a timed
// snooze, or `{ until: null }` for one that only ends when the user
// un-snoozes it. Entries written before durations existed are a bare
// `true` and normalize to the no-end-date form, so nothing that was
// snoozed before comes back on its own.

import { userLsGet, userLsSet } from './userLs';
import { registerMirroredKey, queueMirrorPush } from './localMirrorSync';

const SNOOZED_KEY = 'issues-snoozed-map';
export const ISSUE_SNOOZED_EVENT = 'issue-snoozed-changed';

// Mirrored to Firestore: a snooze is a decision the user made about an
// issue ("not this quarter"), and losing the map puts every snoozed row
// back on the tab and back in the sidebar count.
registerMirroredKey(SNOOZED_KEY, ISSUE_SNOOZED_EVENT);

const DAY_MS = 24 * 60 * 60 * 1000;

// The durations offered on the Snooze button, in the order shown.
// `days: null` is the open-ended option.
export const SNOOZE_DURATIONS = [
  { key: '1d', label: '1 day', days: 1 },
  { key: '3d', label: '3 days', days: 3 },
  { key: '1w', label: '1 week', days: 7 },
  { key: '2w', label: '2 weeks', days: 14 },
  { key: '1m', label: '1 month', days: 30 },
  { key: 'forever', label: 'Until I un-snooze', days: null },
];

// A stored value → { until } | null. Accepts the legacy `true`.
function normalizeEntry(value) {
  if (value === true) return { until: null };
  if (!value || typeof value !== 'object') return null;
  const until = Number(value.until);
  return { until: Number.isFinite(until) && until > 0 ? until : null };
}

export function loadIssueSnoozedMap() {
  try {
    const raw = userLsGet(SNOOZED_KEY);
    const parsed = raw ? (JSON.parse(raw) || {}) : {};
    const out = {};
    for (const [id, value] of Object.entries(parsed)) {
      const entry = normalizeEntry(value);
      if (entry) out[id] = entry;
    }
    return out;
  } catch { return {}; }
}

function persist(map) {
  try {
    userLsSet(SNOOZED_KEY, JSON.stringify(map || {}));
    queueMirrorPush(SNOOZED_KEY);
    window.dispatchEvent(new Event(ISSUE_SNOOZED_EVENT));
  } catch (err) {
    console.warn('Failed to persist issue snooze map', err);
  }
}

// Whether an issue counts as snoozed right now, and until when. Expiry is
// evaluated on read so a timed snooze lapses on its own even if nothing
// has pruned the map yet.
export function issueSnoozeState(map, id, now = Date.now()) {
  const entry = map ? map[String(id || '').trim()] : null;
  if (!entry) return { snoozed: false, until: null };
  if (entry.until != null && entry.until <= now) return { snoozed: false, until: null };
  return { snoozed: true, until: entry.until ?? null };
}

// Snooze an issue for `days` (null / 0 = until the user un-snoozes it).
export function snoozeIssue(id, days) {
  const key = String(id || '').trim();
  if (!key) return;
  const n = Number(days);
  const map = loadIssueSnoozedMap();
  map[key] = { until: Number.isFinite(n) && n > 0 ? Date.now() + n * DAY_MS : null };
  persist(map);
}

export function unsnoozeIssue(id) {
  const key = String(id || '').trim();
  if (!key) return;
  const map = loadIssueSnoozedMap();
  if (!(key in map)) return;
  delete map[key];
  persist(map);
}

// Drop entries whose snooze has run out. Persists (and notifies) only when
// something actually expired, so callers can poll this cheaply to let the
// sidebar badge pick a lapsed snooze back up.
export function pruneExpiredSnoozes(now = Date.now()) {
  const map = loadIssueSnoozedMap();
  let changed = false;
  for (const [id, entry] of Object.entries(map)) {
    if (entry.until != null && entry.until <= now) { delete map[id]; changed = true; }
  }
  if (changed) persist(map);
  return changed;
}

// "3 days left" / "in 4 hours" style summary of a snooze's remaining time.
export function formatSnoozeRemaining(until, now = Date.now()) {
  if (until == null) return 'No end date';
  const diff = until - now;
  if (diff <= 0) return 'Expired';
  if (diff < 60 * 60 * 1000) return 'Under an hour left';
  // Rounding is done in hours first so a snooze that's a hair under a full
  // day reads as "1 day left", never "24 hours left".
  const hours = Math.round(diff / (60 * 60 * 1000));
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} left`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} left`;
}

// The same thing, short enough for the button label ("3d", "5h").
export function formatSnoozeRemainingShort(until, now = Date.now()) {
  if (until == null) return 'Snoozed';
  const diff = until - now;
  if (diff <= 0) return 'Expired';
  const hours = Math.max(1, Math.round(diff / (60 * 60 * 1000)));
  return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

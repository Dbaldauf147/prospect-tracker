// A durable, tiny record of what each week's outbound activity added up
// to — written by the Activity tab, read by the Weekly Report tiles.
//
// Why it exists: the Activity tab pulls the whole HubSpot history (5k+
// emails) and tries to park it in localStorage, where it routinely blows
// the ~5MB quota and is silently dropped (see saveCache in ActivityView).
// When that happens the Weekly Report has nothing to count and shows
// "Emails sent 0" for a week that had plenty. Counting the weeks once,
// while the full feed is in hand, and keeping only the totals costs a few
// KB — so this week's number is still there next week, whatever happened
// to the feed it came from.
//
// The counted thing is deliberately the same thing the Weekly Report
// counts: emails the user sent with at least one recipient outside
// @se.com. Calls and meetings ride along because they're free once the
// feed is being walked.
import { userLsGet, userLsSet } from './userLs.js';
import { registerMirroredKey, queueMirrorPush, dispatchStoreEvent } from './localMirrorSync.js';
import {
  isSentExternalEmail, isCountedCall, emailTs, callTs, meetingTs,
} from './weeklyReport.js';

const LOG_KEY = 'weekly-activity-log';

// Fired on the window after a write, so the Weekly Report picks up a
// fresh recording without a reload (the `storage` event is cross-tab
// only).
export const WEEKLY_ACTIVITY_EVENT = 'weekly-activity-log-updated';

// Mirrored to Firestore: this log is a record, not a cache. Once a week
// has rolled past what the feed still carries — or the browser is cleared,
// or the user moves machines — nothing can recompute it, which is the
// whole reason the number is written down in the first place.
registerMirroredKey(LOG_KEY, WEEKLY_ACTIVITY_EVENT);

// Three years of weeks. Each entry is ~60 bytes, so the whole log stays
// a rounding error against the quota that motivated it.
const MAX_WEEKS = 156;

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// The Monday (local) of the week containing `ms`, as YYYY-MM-DD. Matches
// weekBounds() in weeklyReport.js — weeks start Monday, the way a sales
// week reads — so a log key and a report window line up exactly.
export function weekKeyFor(ms) {
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  const backToMonday = (d.getDay() + 6) % 7;
  return isoDate(new Date(d.getTime() - backToMonday * DAY_MS));
}

function emptyWeek() {
  return { emails: 0, calls: 0, meetings: 0 };
}

// Walk a HubSpot activity feed once and total it up per week. Pure — no
// storage, no clock beyond the `now` handed in (which only decides that
// the current week gets an entry even when it's empty, so a genuinely
// quiet week records as 0 rather than as "never recorded").
export function bucketWeeklyActivity(cache, senderEmail, now = Date.now()) {
  const weeks = {};
  const bump = (ms, field) => {
    const key = weekKeyFor(ms);
    if (!key) return;
    if (!weeks[key]) weeks[key] = emptyWeek();
    weeks[key][field] += 1;
  };

  for (const e of (Array.isArray(cache?.emails) ? cache.emails : [])) {
    if (isSentExternalEmail(e, senderEmail)) bump(emailTs(e), 'emails');
  }
  for (const c of (Array.isArray(cache?.calls) ? cache.calls : [])) {
    if (isCountedCall(c)) bump(callTs(c), 'calls');
  }
  for (const m of (Array.isArray(cache?.meetings) ? cache.meetings : [])) {
    bump(meetingTs(m), 'meetings');
  }

  const thisWeek = weekKeyFor(now);
  if (thisWeek && !weeks[thisWeek]) weeks[thisWeek] = emptyWeek();
  return weeks;
}

// Merge a fresh set of per-week totals over what's already stored. Fresh
// wins for every week it covers — it was counted off the full feed, so
// it is the better number, including when it counts down (a deleted or
// re-dated HubSpot record). Weeks the feed didn't reach are left alone.
export function mergeWeeklyLog(existing, fresh, recordedAt = Date.now()) {
  const out = {};
  const prev = (existing && typeof existing === 'object') ? existing : {};
  for (const [k, v] of Object.entries(prev)) {
    if (v && typeof v === 'object') out[k] = v;
  }
  for (const [k, v] of Object.entries(fresh || {})) {
    out[k] = {
      emails: Number(v?.emails) || 0,
      calls: Number(v?.calls) || 0,
      meetings: Number(v?.meetings) || 0,
      at: recordedAt,
    };
  }
  // Newest weeks win if we ever have to drop some: the keys sort
  // lexicographically because they're ISO dates.
  const keys = Object.keys(out).sort();
  const kept = keys.slice(Math.max(0, keys.length - MAX_WEEKS));
  const trimmed = {};
  for (const k of kept) trimmed[k] = out[k];
  return trimmed;
}

export function loadWeeklyActivityLog() {
  try {
    const parsed = JSON.parse(userLsGet(LOG_KEY));
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch { return {}; }
}

export function saveWeeklyActivityLog(log) {
  try {
    userLsSet(LOG_KEY, JSON.stringify(log || {}));
  } catch (err) {
    console.warn('Weekly activity log write skipped:', err?.message || err);
    return false;
  }
  queueMirrorPush(LOG_KEY);
  dispatchStoreEvent(WEEKLY_ACTIVITY_EVENT);
  return true;
}

// Count the feed into weeks and persist the result. Returns the merged
// log so a caller can render this week's number straight away.
export function recordWeeklyActivity(cache, senderEmail, now = Date.now()) {
  const fresh = bucketWeeklyActivity(cache, senderEmail, now);
  const merged = mergeWeeklyLog(loadWeeklyActivityLog(), fresh, now);
  saveWeeklyActivityLog(merged);
  return merged;
}

// The recorded totals for the week containing `ms`, or null when that
// week was never recorded.
export function weeklyActivityEntry(log, ms) {
  const key = weekKeyFor(ms);
  if (!key) return null;
  const v = log && log[key];
  return (v && typeof v === 'object') ? v : null;
}

// Whether the live feed can be trusted to answer for a window, which is
// what decides between counting it and reading the recording:
//
//  - no feed at all (the usual case — the quota dropped it, see saveCache
//    in ActivityView) → recording;
//  - a feed fetched before the window even started can't know what
//    happened inside it → recording.
//
// Anything else is counted live. Both writers of this cache (the Activity
// tab and the Agents refresh) page the whole HubSpot history, so a feed
// that exists and was fetched after the fact is complete for the window
// by construction — including when it is legitimately empty.
export function liveCacheCovers(cache, start) {
  if (!cache || typeof cache !== 'object') return false;
  if (!Array.isArray(cache.emails)) return false;
  const fetched = new Date(cache.fetchedAt).getTime();
  return Number.isFinite(fetched) && fetched >= start;
}

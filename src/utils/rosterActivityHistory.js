// A day-by-day record of how many people on each contacts roster (Dan Key
// Target, Dan Key Prospect, Decision Makers) had activity in the last 30,
// 60, 90 and 120 days, for the Prospecting History subtab's "Contacts with
// activity" line charts.
//
// Like the firms-active record beside it (activeFirmsHistory.js) this can't
// be worked out after the fact: the activity feed keeps only the newest
// email or call per address. It is written while the app is open, once the
// contacts and the email/call index have loaded (useRecordRosterActivity),
// and the charts fill in from there.
//
// What a row holds (keyed by the local day, YYYY-MM-DD):
//
//   rosters   { [rosterKey]: { label, total, active: { [days]: count } } }
//   at        wall-clock ms of the reading
//   seeded    true on the one day backfilled from the first reading
//
// The latest reading of a day wins. Stored in localStorage under the
// user's key and mirrored to Firestore, merged day by day.

import { ROSTER_ACTIVITY_WINDOWS } from './tieredAccountActivity.js';
import { userLsGet, userLsSet } from './userLs.js';
import { mergeDayHistories, registerMirroredKey, queueMirrorPush } from './localMirrorSync.js';

export const ROSTER_ACTIVITY_HISTORY_KEY = 'roster-activity-history';
export const ROSTER_ACTIVITY_HISTORY_EVENT = 'roster-activity-history-changed';

// Merged row by row on sync (mergeDayHistories), so a tab left open since
// an earlier day can't push its copy over days it never saw.
registerMirroredKey(ROSTER_ACTIVITY_HISTORY_KEY, ROSTER_ACTIVITY_HISTORY_EVENT, { merge: mergeDayHistories });

export const ROSTER_ACTIVITY_MAX_DAYS = 1000;

export function parseRosterActivityHistory(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch { return {}; }
}

const count = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);

// The reading off a rosterActivityCounts result, or null when anything is
// missing (a hole would chart a roster dropping to nothing for the day) or
// every roster is empty (the gates or contacts haven't really loaded).
export function readingFromRosterCounts(counts, windows = ROSTER_ACTIVITY_WINDOWS) {
  if (!Array.isArray(counts) || counts.length === 0) return null;
  const rosters = {};
  let anyone = false;
  for (const r of counts) {
    const total = count(r?.total);
    if (!r?.key || total == null) return null;
    const active = {};
    for (const days of windows) {
      const n = count(r.windows?.find(w => w.days === days)?.active);
      if (n == null) return null;
      active[days] = n;
    }
    rosters[r.key] = { label: String(r.label || r.key), total, active };
    if (total > 0) anyone = true;
  }
  return anyone ? { rosters } : null;
}

function sameReading(a, b) {
  return !!a && !!b && JSON.stringify(a.rosters) === JSON.stringify(b.rosters);
}

// The working day before `day` (Friday for a Monday), the day the History
// axis puts just before it.
export function previousWorkingDay(day) {
  const [y, m, d] = String(day).split('-').map(Number);
  const dt = new Date(y, m - 1, d - 1);
  while (dt.getDay() === 0 || dt.getDay() === 6) dt.setDate(dt.getDate() - 1);
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

// The history with `reading` under `day`, oldest days past the cap dropped.
// The same object back when nothing changes, so the caller can skip a write.
// While no real (not seeded) earlier day is on record, the reading is also
// written as the working day before, so the charts start with a line rather
// than a lone dot, and that seed keeps following the day's reading until a
// real earlier day exists.
export function withRosterActivityReading(history, day, reading, now = Date.now()) {
  const prev = (history && typeof history === 'object') ? history : {};
  if (!day || !reading) return prev;
  const seedYesterday = !Object.keys(prev).some(k => k < day && !prev[k]?.seeded);
  const yesterday = previousWorkingDay(day);
  if (sameReading(prev[day], reading) && (!seedYesterday || sameReading(prev[yesterday], reading))) return prev;
  const next = { ...prev, [day]: { ...reading, at: now } };
  if (seedYesterday) next[yesterday] = { ...reading, seeded: true, at: now };
  const keys = Object.keys(next).sort();
  if (keys.length <= ROSTER_ACTIVITY_MAX_DAYS) return next;
  const out = {};
  for (const k of keys.slice(keys.length - ROSTER_ACTIVITY_MAX_DAYS)) out[k] = next[k];
  return out;
}

export function recordRosterActivity(day, counts, now = Date.now()) {
  const reading = readingFromRosterCounts(counts);
  if (!day || !reading) return false;
  const history = parseRosterActivityHistory(userLsGet(ROSTER_ACTIVITY_HISTORY_KEY));
  const next = withRosterActivityReading(history, day, reading, now);
  if (next === history) return false;
  try {
    userLsSet(ROSTER_ACTIVITY_HISTORY_KEY, JSON.stringify(next));
    queueMirrorPush(ROSTER_ACTIVITY_HISTORY_KEY);
    window.dispatchEvent(new CustomEvent(ROSTER_ACTIVITY_HISTORY_EVENT));
    return true;
  } catch { return false; }
}

// --- reading it back as an external store ------------------------------------

const EVENTS = [ROSTER_ACTIVITY_HISTORY_EVENT, 'storage'];

export function subscribeRosterActivityHistory(onChange) {
  EVENTS.forEach(e => window.addEventListener(e, onChange));
  return () => EVENTS.forEach(e => window.removeEventListener(e, onChange));
}

export function rosterActivityHistorySnapshot() {
  return userLsGet(ROSTER_ACTIVITY_HISTORY_KEY) || '';
}

// A share to one decimal, so a one-person move still shows on the line.
const share = (n, total) => (n == null || !total ? null : Math.round((n / total) * 1000) / 10);

// One roster's chart points, one per day on the axis: the counts `w30`,
// `w60`, `w90`, `w120` and `total`, and the shares the charts draw, `p30`,
// `p90`, `p120` (% of the list with activity in that window) and `pNone`
// (% with none in 120 days). All null where the day wasn't recorded, so the
// line breaks there rather than drawing through a day nobody saw; a day
// recorded before a window was tracked has null for that window alone.
export function rosterActivityChartRows(history, days, rosterKey, windows = ROSTER_ACTIVITY_WINDOWS) {
  const h = history || {};
  return days.map((iso) => {
    const r = h[iso]?.rosters?.[rosterKey] || null;
    const row = { iso, recorded: !!r, total: r ? r.total : null };
    for (const d of windows) row[`w${d}`] = r ? (r.active?.[d] ?? null) : null;
    row.p30 = share(row.w30, row.total);
    row.p90 = share(row.w90, row.total);
    row.p120 = share(row.w120, row.total);
    row.pNone = row.w120 == null ? null : share(row.total - row.w120, row.total);
    // The same list split into bands that don't overlap, for the stacked
    // 100% area: last touched 0-30 days ago, 31-90, 91-120, or not in 120.
    // The last band is what's left of 100, so rounding can't leave the
    // stack a hair short or over. A day missing any window (recorded
    // before 90 days was tracked) has no bands, so it isn't drawn as if
    // everyone in 31-120 sat in one band.
    const ok = row.total > 0 && [row.w30, row.w90, row.w120].every(v => v != null);
    row.b30 = ok ? share(row.w30, row.total) : null;
    row.b90 = ok ? share(row.w90 - row.w30, row.total) : null;
    row.b120 = ok ? share(row.w120 - row.w90, row.total) : null;
    row.bNone = ok ? Math.round((100 - row.b30 - row.b90 - row.b120) * 10) / 10 : null;
    return row;
  });
}

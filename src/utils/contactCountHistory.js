// A week-by-week record of how many contacts sit on the Key, Client and Key
// Prospect rosters, for the Contacts page's History subtab.
//
// The rosters only ever say "now": they are worked out live from the
// HubSpot contacts, their tags and the Table View accounts, so nothing
// remembered whether the Key roster held 40 people last month or 60. This
// keeps one small row per week, written by App while it is open (see
// useContactCountRecorder), so the History subtab can chart it.
//
// What a row holds (keyed by the week's Monday, YYYY-MM-DD, in local time,
// the same key the weekly report's series use):
//
//   key, client, keyProspect   the roster counts, exactly as the All
//                              Contacts Totals pills count them (visible
//                              contacts, cancelling / Don't Track accounts
//                              left out; see rosterTagCoverage)
//   at                         wall-clock ms of the reading
//
// The latest reading in a week wins: a roster is a level, and where it
// stood when the week closed is what the week is remembered by.
//
// Stored in localStorage under the user's key and mirrored to Firestore,
// like the Prospecting history, so it survives a cleared browser and
// follows the user to another machine.

import { userLsGet, userLsSet } from './userLs.js';
import { mergeDayHistories, registerMirroredKey, queueMirrorPush } from './localMirrorSync.js';

export const CONTACT_COUNT_HISTORY_KEY = 'contact-count-history';
export const CONTACT_COUNT_HISTORY_EVENT = 'contact-count-history-changed';

// Merged row by row on sync (mergeDayHistories), so a tab left open since
// an earlier day can't push its copy over days it never saw.
registerMirroredKey(CONTACT_COUNT_HISTORY_KEY, CONTACT_COUNT_HISTORY_EVENT, { merge: mergeDayHistories });

// The rosters charted, in the order the Totals pills read them. Active is
// left out: it is a rolling window of whoever has been in touch lately, so
// its count moves on its own rather than with the work.
export const COUNTED_ROSTERS = ['key', 'client', 'keyProspect'];

// Three years of weeks: far more than the chart is asked for, and each row
// is a few dozen bytes.
export const MAX_WEEKS = 156;

export function parseCountHistory(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch { return {}; }
}

export function loadCountHistory() {
  return parseCountHistory(userLsGet(CONTACT_COUNT_HISTORY_KEY));
}

const count = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);

// The reading off a rosterTagCoverage result, or null when there is nothing
// to record. Every roster has to be there: a reading with a hole in it
// would chart a roster dropping to nothing for a week.
export function countsFromCoverage(coverage) {
  if (!coverage) return null;
  const out = {};
  for (const key of COUNTED_ROSTERS) {
    const n = count(coverage[key]?.contacts);
    if (n == null) return null;
    out[key] = n;
  }
  return out;
}

export function sameCounts(a, b) {
  if (!a || !b) return false;
  return COUNTED_ROSTERS.every(k => a[k] === b[k]);
}

// The history with `counts` recorded under `week`. Returns the same object
// when nothing changes, so the caller can skip a write.
export function withWeekCounts(history, week, counts, now = Date.now()) {
  const prev = (history && typeof history === 'object') ? history : {};
  if (!week || !counts) return prev;
  if (sameCounts(prev[week], counts)) return prev;
  const out = { ...prev, [week]: { ...counts, at: now } };
  const keys = Object.keys(out).sort();
  if (keys.length <= MAX_WEEKS) return out;
  const trimmed = {};
  for (const k of keys.slice(keys.length - MAX_WEEKS)) trimmed[k] = out[k];
  return trimmed;
}

// Record this week's counts. Writes only when the row changed, so App
// re-rendering all day costs nothing.
export function recordContactCounts(week, counts, now = Date.now()) {
  const history = loadCountHistory();
  const next = withWeekCounts(history, week, counts, now);
  if (next === history) return false;
  try {
    userLsSet(CONTACT_COUNT_HISTORY_KEY, JSON.stringify(next));
    queueMirrorPush(CONTACT_COUNT_HISTORY_KEY);
    window.dispatchEvent(new CustomEvent(CONTACT_COUNT_HISTORY_EVENT));
    return true;
  } catch { return false; }
}

// --- reading it back as an external store ------------------------------------

const EVENTS = [CONTACT_COUNT_HISTORY_EVENT, 'storage'];

export function subscribeCountHistory(onChange) {
  EVENTS.forEach(e => window.addEventListener(e, onChange));
  return () => EVENTS.forEach(e => window.removeEventListener(e, onChange));
}

export function countHistorySnapshot() {
  return userLsGet(CONTACT_COUNT_HISTORY_KEY) || '';
}

// --- the chart's rows ------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

function parseISO(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function toISO(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// One row per week, oldest first, the last `weeks` of them ending with the
// week whose Monday is `thisWeek`. A week with no reading is a gap (null
// counts), not zeros: nobody opened the app that week, and a 0 would chart
// the rosters emptying out.
export function countHistoryRows(history, thisWeek, weeks) {
  const h = history || {};
  const end = parseISO(thisWeek);
  const rows = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const dt = new Date(end.getTime() - i * 7 * DAY_MS);
    // Rebuilt from the date rather than by adding milliseconds, so a
    // daylight-saving change can't land a Monday on Sunday 11pm.
    const monday = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    const iso = toISO(monday);
    const r = h[iso] || null;
    const row = {
      week: iso,
      label: monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      recorded: !!r,
    };
    for (const k of COUNTED_ROSTERS) row[k] = r ? count(r[k]) : null;
    rows.push(row);
  }
  return rows;
}

// The change in each roster between the first and last recorded weeks of
// the rows, for the cards above the chart. Null for a roster with fewer
// than two readings.
export function countChanges(rows) {
  const out = {};
  for (const k of COUNTED_ROSTERS) {
    const known = (rows || []).filter(r => r[k] != null);
    out[k] = known.length >= 2
      ? { from: known[0][k], to: known[known.length - 1][k], since: known[0].label, delta: known[known.length - 1][k] - known[0][k] }
      : null;
  }
  return out;
}

// A day-by-day record of how much company data is missing, for the My
// Accounts "All Missing History" subtab.
//
// The Company Data subtab only says "today": its cards count, per field,
// the companies with no value. This keeps one small row per day with those
// counts and their sum, so the backlog can be charted as it burns down.
//
// Measured on a FIXED basis, the one the Company Data tab opens on: every
// My Accounts account that has a company record, inactive ones (Old Client
// / Hold Off / Lost - Not Sold) left out, no search. A day read through a
// search box would not be comparable with the next.
//
// A row:
//
//   total      the sum of every field's missing count (the headline)
//   fields     { [fieldKey]: missing count }
//   companies  how many companies the counts are out of
//   seeded     true on the one day backfilled from the first reading
//   updatedAt  wall-clock ms of the last write
//
// The LAST reading of the day wins, and a row is only rewritten when its
// numbers changed. Stored in localStorage under the user's key and mirrored
// to Firestore, the same way the DM tag history is.

import { userLsGet, userLsSet } from './userLs.js';
import { registerMirroredKey, queueMirrorPush } from './localMirrorSync.js';
import { COMPANY_DATA_FIELDS, fieldHasValue } from './companyDataFields.js';

export const MISSING_HISTORY_KEY = 'company-data-missing-history';
export const MISSING_HISTORY_EVENT = 'company-data-missing-history-changed';

registerMirroredKey(MISSING_HISTORY_KEY, MISSING_HISTORY_EVENT);

export const MISSING_HISTORY_MAX_DAYS = 730;

export function parseMissingHistory(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch { return {}; }
}

export function loadMissingHistory() {
  return parseMissingHistory(userLsGet(MISSING_HISTORY_KEY));
}

/**
 * Today's reading from the company records behind the (already filtered)
 * accounts. Null when there is nothing to count, so an empty load never
 * records a day of zeroes.
 */
export function missingReading(records, fields = COMPANY_DATA_FIELDS) {
  const list = (records || []).filter(Boolean);
  if (list.length === 0) return null;
  const counts = {};
  let total = 0;
  for (const f of fields) {
    const n = list.filter(r => !fieldHasValue(f, r[f.key])).length;
    counts[f.key] = n;
    total += n;
  }
  return { total, fields: counts, companies: list.length };
}

// YYYY-MM-DD in local time.
export function dayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function previousDay(day) {
  const [y, m, d] = String(day).split('-').map(Number);
  return dayKey(new Date(y, m - 1, d - 1));
}

function sameReading(a, b) {
  if (!a || !b) return false;
  return a.total === b.total && a.companies === b.companies
    && JSON.stringify(a.fields) === JSON.stringify(b.fields);
}

function trim(history, max = MISSING_HISTORY_MAX_DAYS) {
  const keys = Object.keys(history || {}).sort();
  if (keys.length <= max) return history;
  const out = {};
  for (const k of keys.slice(keys.length - max)) out[k] = history[k];
  return out;
}

/**
 * Pure: the history with `reading` as `day`'s row, or the same object when
 * nothing changed. The very first reading on record is also written as the
 * day before, so the chart starts with a line rather than a lone point.
 */
export function withMissingDay(history, day, reading, now = Date.now()) {
  const h = history || {};
  if (!day || !reading) return h;
  const hasEarlier = Object.keys(h).some(k => k < day);
  const seedYesterday = !hasEarlier;
  if (!seedYesterday && sameReading(h[day], reading)) return h;
  const next = { ...h, [day]: { ...reading, updatedAt: now } };
  if (seedYesterday) next[previousDay(day)] = { ...reading, seeded: true, updatedAt: now };
  return trim(next);
}

/** Record `day` (YYYY-MM-DD). Writes only when something changed. */
export function recordMissingDay(day, reading, now = Date.now()) {
  const history = loadMissingHistory();
  const next = withMissingDay(history, day, reading, now);
  if (next === history) return false;
  try {
    userLsSet(MISSING_HISTORY_KEY, JSON.stringify(next));
    queueMirrorPush(MISSING_HISTORY_KEY);
    window.dispatchEvent(new CustomEvent(MISSING_HISTORY_EVENT));
    return true;
  } catch { return false; }
}

const EVENTS = [MISSING_HISTORY_EVENT, 'storage'];

export function subscribeMissingHistory(onChange) {
  EVENTS.forEach(e => window.addEventListener(e, onChange));
  return () => EVENTS.forEach(e => window.removeEventListener(e, onChange));
}

export function missingHistorySnapshot() {
  return userLsGet(MISSING_HISTORY_KEY) || '';
}

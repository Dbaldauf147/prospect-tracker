// A day-by-day record of the All Missing Steps total, for the My Accounts
// "All Missing History" subtab.
//
// The Company Data subtab only says "today": its All Missing Steps column
// counts, per company, the decision-maker steps left plus the blank Sites,
// Utility Accounts and Equipment (utils/allMissingSteps). This keeps one
// small row per day with that column summed, and the per-field missing
// counts beside it, so the backlog can be charted as it burns down.
//
// Measured on a FIXED basis, the one the Company Data tab opens on: every
// My Accounts account that has a company record, inactive ones (Old Client
// / Hold Off / Lost - Not Sold) left out, no search. A day read through a
// search box would not be comparable with the next.
//
// A row:
//
//   total           All Missing Steps summed across the companies (the headline)
//   stepsRemaining  its decision-maker steps part
//   missingData     its blank Sites / Utility Accounts / Equipment part
//   fields          { [fieldKey]: missing count }, every Company Data field
//   basis           'steps'. Days recorded before the total was All Missing
//                   Steps carry none: their total was the field counts
//                   summed, so they are not charted beside these.
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
import { allMissingStepsFor } from './allMissingSteps.js';

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

export const MISSING_HISTORY_BASIS = 'steps';

/** Whether a stored day was counted the way the chart counts now. */
export const isStepsDay = (row) => row?.basis === MISSING_HISTORY_BASIS;

/**
 * Today's All Missing Steps reading. `entries` is one { record, dms,
 * titleSearches } per company, read the way the Company Data subtab reads
 * them; `tagReview` is settings.contactTagReview. Null when there is
 * nothing to count.
 */
export function missingStepsReading(entries, { tagReview = null, fields = COMPANY_DATA_FIELDS } = {}) {
  const list = (entries || []).filter(e => e?.record);
  if (list.length === 0) return null;
  let stepsRemaining = 0;
  let missingData = 0;
  for (const e of list) {
    const s = allMissingStepsFor({ record: e.record, dms: e.dms || [], tagReview, titleSearches: e.titleSearches || [] });
    stepsRemaining += s.stepsRemaining;
    missingData += s.missingData;
  }
  const counts = {};
  for (const f of fields) counts[f.key] = list.filter(e => !fieldHasValue(f, e.record[f.key])).length;
  return {
    total: stepsRemaining + missingData,
    stepsRemaining,
    missingData,
    fields: counts,
    companies: list.length,
    basis: MISSING_HISTORY_BASIS,
  };
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
  return a.total === b.total && a.companies === b.companies && a.basis === b.basis
    && a.stepsRemaining === b.stepsRemaining && a.missingData === b.missingData
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
  // Only a day counted the same way counts as earlier, so the first
  // All Missing Steps reading still gets its seeded yesterday.
  const hasEarlier = Object.keys(h).some(k => k < day && h[k]?.basis === reading.basis);
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

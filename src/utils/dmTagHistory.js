// A day-by-day record of how much of My Accounts is mapped on each DM tag,
// for the My Accounts "DM Tags History" subtab.
//
// The DM Tags subtab only ever says "today": the T1/T2/T3 share under each
// tag is worked out live from the contacts. This keeps one small row per
// day so the history can be charted.
//
// Measured on a FIXED basis, not on whatever the DM Tags table is showing:
// every My Accounts account with inactive ones (Old Client / Hold Off /
// Lost - Not Sold) left out, no search, every tag. A day read through a
// search box would not be comparable with the next, and recording every tag
// (not just the starred ones) means a tag starred later already has its
// past.
//
// A row:
//
//   tags      { [tagColumnKey]: { label, t: [[mapped, total] x 3] } }, one
//             pair per tier in TIERS order
//   dm        the same pairs for "has any decision maker at all", the
//             baseline every tag sits under
//   updatedAt wall-clock ms of the last write
//
// The LAST reading of the day wins: the counts move as tags are added during
// the day, and the day should end on where it was left. A row is only
// rewritten when its numbers changed, so My Accounts re-rendering costs
// nothing.
//
// Stored in localStorage under the user's key and mirrored to Firestore,
// the same way the Prospecting history is, so it survives a cleared browser
// and follows the user to another machine.

import { userLsGet, userLsSet } from './userLs.js';
import { registerMirroredKey, queueMirrorPush } from './localMirrorSync.js';
import { TIERS } from '../data/enums.js';
import { tagColumnKey, tagMatrixRows, tagMatrixCoverage } from './decisionMakerTagMatrix.js';

export const DM_TAG_HISTORY_KEY = 'dm-tag-history';
export const DM_TAG_HISTORY_EVENT = 'dm-tag-history-changed';

registerMirroredKey(DM_TAG_HISTORY_KEY, DM_TAG_HISTORY_EVENT);

// Two years of days. A row is a few hundred bytes, so this stays well inside
// what the mirror carries.
export const DM_TAG_HISTORY_MAX_DAYS = 730;

export function parseDmTagHistory(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch { return {}; }
}

export function loadDmTagHistory() {
  return parseDmTagHistory(userLsGet(DM_TAG_HISTORY_KEY));
}

const INACTIVE = new Set(['Old Client', 'Hold Off', 'Lost - Not Sold']);

/**
 * Today's reading, from the My Accounts rows, the decision-maker lookup and
 * the tag columns. Null when there is nothing to say yet (no accounts, or
 * contacts not loaded), so an empty load never records a day of zeroes.
 */
export function dmTagReading(accounts, dmLookup, tags, tierOf = r => r.myTier) {
  if (!dmLookup || !Array.isArray(accounts)) return null;
  const active = accounts.filter(a => a && !a._oppsOnly && !INACTIVE.has(a.status));
  if (active.length === 0) return null;
  const rows = tagMatrixRows(active, dmLookup, tags);
  const coverage = tagMatrixCoverage(rows, tags, tierOf);
  const pairs = (byTier) => TIERS.map(tier => [byTier?.[tier]?.mapped || 0, byTier?.[tier]?.total || 0]);
  const out = { tags: {}, dm: [] };
  for (const tag of (tags || [])) {
    const key = tagColumnKey(tag);
    out.tags[key] = { label: tag, t: pairs(coverage[key]) };
  }
  out.dm = TIERS.map(tier => {
    let total = 0;
    let mapped = 0;
    for (const r of rows) {
      if (tierOf(r) !== tier) continue;
      total += 1;
      if (r.dmCount > 0) mapped += 1;
    }
    return [mapped, total];
  });
  return out;
}

// Same numbers, ignoring when they were written.
function sameReading(a, b) {
  if (!a || !b) return false;
  return JSON.stringify({ tags: a.tags, dm: a.dm }) === JSON.stringify({ tags: b.tags, dm: b.dm });
}

export function trimDmTagHistory(history, max = DM_TAG_HISTORY_MAX_DAYS) {
  const keys = Object.keys(history || {}).sort();
  if (keys.length <= max) return history;
  const out = {};
  for (const k of keys.slice(keys.length - max)) out[k] = history[k];
  return out;
}

/** Pure: the history with `reading` as `day`'s row, or the same object when nothing changed. */
export function withDmTagDay(history, day, reading, now = Date.now()) {
  const h = history || {};
  if (!day || !reading) return h;
  if (sameReading(h[day], reading)) return h;
  return trimDmTagHistory({ ...h, [day]: { ...reading, updatedAt: now } });
}

/** Record `day` (YYYY-MM-DD). Writes only when the numbers changed. */
export function recordDmTagDay(day, reading, now = Date.now()) {
  const history = loadDmTagHistory();
  const next = withDmTagDay(history, day, reading, now);
  if (next === history) return false;
  try {
    userLsSet(DM_TAG_HISTORY_KEY, JSON.stringify(next));
    queueMirrorPush(DM_TAG_HISTORY_KEY);
    window.dispatchEvent(new CustomEvent(DM_TAG_HISTORY_EVENT));
    return true;
  } catch { return false; }
}

// --- reading it back as an external store ------------------------------------

const EVENTS = [DM_TAG_HISTORY_EVENT, 'storage'];

export function subscribeDmTagHistory(onChange) {
  EVENTS.forEach(e => window.addEventListener(e, onChange));
  return () => EVENTS.forEach(e => window.removeEventListener(e, onChange));
}

export function dmTagHistorySnapshot() {
  return userLsGet(DM_TAG_HISTORY_KEY) || '';
}

// --- what the subtab plots -----------------------------------------------------

// Same rounding as the DM Tags header: 100 only when every account is mapped.
export function pctOf(pair) {
  const [mapped, total] = Array.isArray(pair) ? pair : [0, 0];
  if (!total) return null;
  if (mapped >= total) return 100;
  return Math.min(99, Math.round((mapped / total) * 100));
}

/**
 * The recorded days, oldest first, each with the per-tier percentages of
 * `key` (a tagColumnKey, or 'dm' for any decision maker). A day recorded
 * before a tag existed reads null for it rather than 0.
 */
export function dmTagSeries(history, key) {
  return Object.keys(history || {}).sort().map(day => {
    const row = history[day] || {};
    const pairs = key === 'dm' ? row.dm : row.tags?.[key]?.t;
    return {
      day,
      byTier: TIERS.map((tier, i) => {
        const pair = Array.isArray(pairs) ? pairs[i] : null;
        return { tier, pct: pair ? pctOf(pair) : null, mapped: pair?.[0] ?? null, total: pair?.[1] ?? null };
      }),
    };
  });
}

/**
 * Which tags the subtab charts: the tag columns starred on the DM Tags
 * table, in the order given. `starred` is that table's starred column keys;
 * only the tag ones (tag:...) count.
 */
export function starredTagKeys(starred) {
  return [...(starred || [])].filter(k => typeof k === 'string' && k.startsWith('tag:'));
}

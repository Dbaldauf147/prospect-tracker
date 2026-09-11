// Where a table's column layout is kept, and how it gets to the user's
// other machine.
//
// A layout is six things: column WIDTHS, which columns are HIDDEN, which are
// STARRED as the user's own default view, any renamed column NAMES, the
// column ORDER, and — for tables that allow it — columns REMOVED from the
// layout entirely. (`visible` is the pre-hidden-list model, still read so an
// old layout is honoured once and converted.)
//
// Two copies, deliberately:
//
//   localStorage — synchronous, so a table draws its saved layout on the
//                  first paint rather than flickering from the default.
//   Firestore    — settings.tablePrefs[tableId], so the layout follows the
//                  user to another browser or machine, and survives a
//                  "clear site data".
//
// Firestore is the one that wins when they disagree: it's the only copy that
// knows about the other device. The local copy is a cache of it.
//
// This module is the single implementation of that. It used to live inside
// DataTable, which meant every table NOT built on DataTable — the main Table
// view among them — had a hand-rolled localStorage-only copy, and column
// layouts silently stopped following the user at exactly the tables they use
// most.

// Default localStorage key names: one set per table id. A table with its own
// established names (the main Table view predates the shared component)
// passes them in instead, so retrofitting it doesn't strand the layout the
// user already has.
export function tablePrefsKeys(tableId) {
  return {
    widths: `prospect-col-widths-${tableId}`,
    visible: `prospect-col-visible-${tableId}`,
    names: `prospect-col-names-${tableId}`,
    order: `prospect-col-order-${tableId}`,
    removed: `prospect-col-removed-${tableId}`,
    hidden: `prospect-col-hidden-${tableId}`,
    starred: `prospect-col-starred-${tableId}`,
  };
}

// ── localStorage ─────────────────────────────────────────────────────────
//
// Every read is defensive: storage can be unreadable (private mode, blocked
// site data) and the value can be anything a past version wrote. A bad read
// is "no preference", never a crash — the cost of getting this wrong is a
// table that won't render at all.

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked */ }
}

export function loadColWidths(keys) {
  const v = readJson(keys.widths);
  return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
}

export function loadColNames(keys) {
  const v = readJson(keys.names);
  return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
}

export function loadColOrder(keys) {
  const v = readJson(keys.order);
  return Array.isArray(v) ? v : [];
}

export function loadColRemoved(keys) {
  const v = readJson(keys.removed);
  return new Set(Array.isArray(v) ? v : []);
}

export function loadColStarred(keys) {
  const v = readJson(keys.starred);
  return new Set(Array.isArray(v) ? v : []);
}

// Null, not [], when there's no entry: "nothing hidden yet" and "this user
// has never chosen" are different, and only the second may be overridden by
// an older `visible` list.
export function loadColHidden(keys) {
  const v = readJson(keys.hidden);
  return Array.isArray(v) ? v : null;
}

// The pre-hidden-list visible set, as stored. An empty array reads as no
// preference rather than "show no columns", which would render a blank table.
export function loadColVisibleRaw(keys) {
  const v = readJson(keys.visible);
  return Array.isArray(v) && v.length > 0 ? v : null;
}

// ── Firestore ────────────────────────────────────────────────────────────

// Firestore rejects map field names that both start AND end with "__" (e.g.
// the helper columns __select__ and __myAccountsList__). Those keys get a
// sentinel prefix on the way out and lose it on the way back, so the rest of
// the app only ever sees the original key.
const REMOTE_KEY_PREFIX = '_x_';

export function encodeRemoteKey(k) {
  return /^__.*__$/.test(k) ? REMOTE_KEY_PREFIX + k : k;
}

export function decodeRemoteKey(k) {
  return k.startsWith(REMOTE_KEY_PREFIX) ? k.slice(REMOTE_KEY_PREFIX.length) : k;
}

export function encodeRemoteMap(m) {
  if (!m || typeof m !== 'object') return m;
  const out = {};
  for (const [k, v] of Object.entries(m)) out[encodeRemoteKey(k)] = v;
  return out;
}

export function decodeRemoteMap(m) {
  if (!m || typeof m !== 'object') return m;
  const out = {};
  for (const [k, v] of Object.entries(m)) out[decodeRemoteKey(k)] = v;
  return out;
}

/** This table's saved layout as Firestore holds it, with its keys decoded. */
export function readRemoteTablePrefs(settings, tableId) {
  const raw = settings?.tablePrefs?.[tableId];
  if (!raw) return raw;
  return { ...raw, widths: decodeRemoteMap(raw.widths), names: decodeRemoteMap(raw.names) };
}

// settings._lastWriteAt is stamped by every settings save, so it doubles as
// "the Firestore subscription has produced data". It's what separates "this
// table has no saved layout" (use the local one) from "settings haven't
// arrived yet" (wait — adopting now would overwrite the saved layout with a
// default).
export function settingsHaveLoaded(settings) {
  return !!(settings && settings._lastWriteAt);
}

const REMOTE_WRITE_DELAY_MS = 400;
const pending = new Map();
let flushTimer = null;

/**
 * Write a layout change to both copies.
 *
 * `patch` carries only the kinds that changed; a Set or an array is fine for
 * the list-shaped ones. Without `settings`/`updateSettings` this still writes
 * the local copy, so a table that isn't wired for sync keeps working exactly
 * as it did.
 *
 * The local write lands immediately — it's synchronous and free, and it's
 * what the table re-reads on the next load. The Firestore write is COALESCED,
 * because a column drag calls this on every mousemove: one write per pixel
 * was a network round trip per pixel, and each one bumps the settings
 * document's _lastWriteAt, which is the stamp every other save on the page
 * compares itself against. Dragging a column is one intention, so it's one
 * write, a beat after the mouse stops.
 */
export function persistTablePrefs(keys, tableId, settings, updateSettings, patch) {
  if (patch.widths !== undefined) writeJson(keys.widths, patch.widths);
  if (patch.names !== undefined) writeJson(keys.names, patch.names);
  if (patch.order !== undefined) writeJson(keys.order, [...patch.order]);
  if (patch.removed !== undefined) writeJson(keys.removed, [...patch.removed]);
  if (patch.hidden !== undefined) writeJson(keys.hidden, [...patch.hidden]);
  if (patch.starred !== undefined) writeJson(keys.starred, [...patch.starred]);
  if (!settings || !updateSettings || !tableId) return;
  const prior = pending.get(tableId);
  pending.set(tableId, {
    settings,
    updateSettings,
    patch: { ...(prior?.patch || {}), ...patch },
  });
  if (flushTimer === null) flushTimer = setTimeout(flushTablePrefs, REMOTE_WRITE_DELAY_MS);
}

function encodeEntry(current, patch) {
  const next = { ...current };
  if (patch.widths !== undefined) next.widths = encodeRemoteMap(patch.widths);
  if (patch.names !== undefined) next.names = encodeRemoteMap(patch.names);
  // Order, removed, hidden and starred are plain key arrays — no map-key
  // encoding needed, since a key like `__select__` is fine as an array value.
  if (patch.order !== undefined) next.order = [...patch.order];
  if (patch.removed !== undefined) next.removed = [...patch.removed];
  if (patch.hidden !== undefined) next.hidden = [...patch.hidden];
  if (patch.starred !== undefined) next.starred = [...patch.starred];
  return next;
}

/**
 * Send every layout change waiting on the coalescing timer, as ONE settings
 * write.
 *
 * One write rather than one per table on purpose: a settings update replaces
 * the whole `tablePrefs` key, and each caller built its copy from the
 * snapshot it captured. Two tables writing separately in the same tick would
 * each overwrite the other's entry with a version that predates it. Layering
 * every pending entry onto the freshest snapshot any of them holds keeps them
 * all.
 *
 * Exported so a caller can force the write out — and so tests don't have to
 * wait on a timer.
 */
export function flushTablePrefs() {
  if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null; }
  if (pending.size === 0) return;
  const entries = [...pending.entries()];
  pending.clear();
  let newest = entries[0][1].settings;
  for (const [, e] of entries) {
    if ((Number(e.settings?._lastWriteAt) || 0) > (Number(newest?._lastWriteAt) || 0)) newest = e.settings;
  }
  const tablePrefs = { ...(newest?.tablePrefs || {}) };
  for (const [tableId, e] of entries) {
    tablePrefs[tableId] = encodeEntry(tablePrefs[tableId] || {}, e.patch);
  }
  entries[entries.length - 1][1].updateSettings({ tablePrefs });
}

// A layout changed and the tab is going away before the timer fired — the
// local copy is already written, but the other machine would never hear about
// it. pagehide covers a close and a navigation; visibilitychange covers a tab
// simply being switched away from, which is not a page hide.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushTablePrefs);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushTablePrefs();
  });
}

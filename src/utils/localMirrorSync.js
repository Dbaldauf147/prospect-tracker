// Firestore mirror for the localStorage-backed stores.
//
// The deals roster and the Clients-tab typed fields used to live in
// localStorage and nowhere else. That made them single-copy: clearing site
// data, switching browsers, or moving to a new machine lost them outright,
// and the Issues tab then reported every active client as "No expiration
// date" because the deals behind them were gone. This module gives those
// keys a per-user Firestore copy so localStorage becomes a fast cache
// rather than the only copy.
//
// localStorage stays the synchronous source every caller already reads —
// nothing here changes a `load*` signature. Writes push up on a debounce,
// and one hydration pass at login pulls anything newer back down, firing
// each store's existing change event so the views refresh the same way they
// do for a local edit.
//
// Conflict resolution is whole-key last-write-wins on a wall-clock stamp,
// not a per-entry merge: these values are small maps typed by one person,
// or a roster replaced wholesale by an upload. Two devices editing
// DIFFERENT clients between hydrations will keep only the later save.
//
// Whole-key last-write-wins is guarded, though: a browser may only replace
// the cloud copy it last synced with. Each key remembers the cloud stamp
// its local value is based on (BASE_SUFFIX). If the cloud has moved on
// since (another tab or machine saved), this browser's copy is stale, and
// pushing it would erase that other save; that is how the Commissions
// roster was lost on Oct 16 2026. So the push is refused, the newer cloud
// copy is taken instead, and this browser's unsaved copy is kept as an
// earlier version (below) rather than thrown away. A stale browser can no
// longer overwrite anything.
//
// Every replacement of a cloud copy also keeps what it replaced first: the
// last VERSIONS_KEEP versions of each key, as sibling documents
// `<key>__v<slot>` with an index `<key>__versions` (listMirrorVersions /
// readMirrorVersion). A save that removes data (fewer rows, a much smaller
// value, a clear) always keeps one; routine edits keep one at most every
// VERSION_THROTTLE_MS, so typing in a cell doesn't fill the history.
//
// The exception is a key registered with a `merge` (the day-by-day chart
// histories, see mergeDayHistories). Those are written automatically by
// every open tab, so whole-key replacement let a tab left open since
// yesterday push its copy over today's and erase a day it never saw (it
// happened to Oct 15 2026 on the Prospecting History charts). For them,
// every push reads the cloud copy first and sends up the merge of both,
// and hydration merges instead of replacing, so a stale copy can only add
// rows, never remove them.
//
// The chunked document layout mirrors utils/opps2Store — deliberately a
// second implementation rather than a shared one, so this can't destabilize
// the Opps 2 sync path. Both exist for the same reason: past ~1 MB a
// single-document write fails and cross-device sync stalls silently.

import { doc, getDoc, setDoc, collection, getDocs, writeBatch } from 'firebase/firestore';
import { userLsGet, userLsSet, userLsRemove } from './userLs.js';
import { dbGet, dbPut, dbDelete } from './db.js';

// src/firebase.js reads import.meta.env and THROWS while it is still
// evaluating when the config is absent — which is every plain-Node context,
// including the scripts/*.test.mjs suite. Registering a mirrored key has to
// work without a configured Firebase, so the app module is pulled in only
// when a read or write actually needs the database.
//
// This is not hypothetical tidiness: dealCommissions.js imports
// commissionsStore.js for one constant (COMMISSION_MONTH_NAMES), so once
// that store began mirroring, a static import here took the whole Firebase
// SDK down that chain and broke scripts/dealOppYear1.test.mjs.
let dbPromise = null;
function getDb() {
  if (!dbPromise) dbPromise = import('../firebase.js').then((m) => m.db);
  return dbPromise;
}

const COL = 'userSettings';
const SUB = 'localMirrors';

// Chunking thresholds, in UTF-8 bytes, under Firestore's ~1 MB per-document
// cap with headroom for field names and metadata.
const CHUNK_BYTES = 700 * 1024;
const SINGLE_DOC_MAX_BYTES = 900 * 1024;

// How long a burst of local writes coalesces before it reaches Firestore.
// Typing in a Clients-tab cell persists on every keystroke; without this
// each one would be its own document write.
const PUSH_DEBOUNCE_MS = 1500;

// The local wall-clock stamp for a mirrored key, kept beside the value in
// its own localStorage entry. Hydration compares this against the cloud
// copy's stamp to decide which side is newer. Absent (a cleared browser)
// reads as 0, so the cloud copy always wins there — which is the whole
// point of this module.
const AT_SUFFIX = ':__mirroredAt';

// The cloud stamp this browser's local value is based on: the updatedAt of
// the cloud copy it last pulled or pushed. A push is only allowed while the
// cloud still carries that stamp (see the header).
const BASE_SUFFIX = ':__mirroredBase';

// Earlier versions kept per key, and how often a routine edit keeps one.
export const VERSIONS_KEEP = 20;
const VERSION_THROTTLE_MS = 10 * 60 * 1000;

// Fired on the window (detail: { key, versionSlot }) when this browser's
// copy of a key was out of date and its unsaved change was set aside as an
// earlier version instead of being pushed.
export const MIRROR_CONFLICT_EVENT = 'local-mirror-conflict';

const readStamp = (key, suffix) => Number(userLsGet(key + suffix)) || 0;
// After a pull or a push: the local value IS the cloud copy stamped `at`.
function markSynced(key, at) {
  try {
    userLsSet(key + AT_SUFFIX, String(at));
    userLsSet(key + BASE_SUFFIX, String(at));
  } catch { /* quota */ }
}

// key → change event to dispatch after hydration writes a newer cloud value
// into localStorage. Stores register themselves at import time so the key
// and its event stay declared in one place (and so this module never has to
// import from them, which would be a cycle).
const registry = new Map();

// `merge(local, remote)` (optional) makes the key merge on every push and
// hydration instead of last-write-wins (see the header). It must be
// order-tolerant and keep every row either side has.
export function registerMirroredKey(key, eventName, { merge = null } = {}) {
  if (!key || key.includes('/')) throw new Error(`Unmirrorable key: ${key}`);
  registry.set(key, { kind: 'ls', eventName, merge, mergeAlways: !!merge });
}

// The id a mirrored IndexedDB record is stored under. IDB records are
// addressed by (store, key) rather than one string, so flatten the pair —
// it becomes a Firestore document id, which cannot contain a slash.
export function dbMirrorId(store, dbKey) {
  return `idb__${store}__${dbKey}`;
}

// Mirror an IndexedDB record. Same newest-wins rules as a localStorage key;
// the value is JSON on the way to Firestore and back.
//
// `merge(local, remote)` (optional) is used once, the first time a browser
// holding data from before the key was mirrored meets a cloud copy. Without
// it that unstamped local value is adopted whole and pushed, which is right
// for a roster but wrong for a map built up a row at a time on more than
// one machine: whichever machine signs in last would erase the rows the
// other had added. With it, both sides' rows survive.
export function registerMirroredDbKey(store, dbKey, eventName, { merge = null } = {}) {
  registry.set(dbMirrorId(store, dbKey), { kind: 'idb', eventName, store, dbKey, merge });
}

// A merge for registerMirroredDbKey: two lists are unioned; two maps keep
// every key either side has, the cloud's value winning where both have one
// unless the cloud's is empty. Anything else takes the cloud copy.
const isEmptyValue = (v) => v == null || v === ''
  || (Array.isArray(v) && v.length === 0)
  || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);
export function mergeMirroredMaps(local, remote) {
  if (Array.isArray(local) && Array.isArray(remote)) {
    const seen = new Set();
    const out = [];
    for (const v of [...remote, ...local]) {
      const k = JSON.stringify(v);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(v);
    }
    return out;
  }
  const isMap = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (isMap(local) && isMap(remote)) {
    const out = { ...local };
    for (const [k, v] of Object.entries(remote)) {
      if (!isEmptyValue(v) || !(k in out)) out[k] = v;
    }
    return out;
  }
  return remote;
}

// A merge for registerMirroredKey's day-by-day histories: maps keyed by day
// (or week) whose rows carry a wall-clock stamp (`at`, `updatedAt`, or for
// All Missing History's baseline `frozenAt`). Every day either side has is
// kept; where both have one, the row stamped later wins (this browser's on
// a tie). If that leaves more than one row marked `baseline`, only the most
// recently frozen keeps the mark, so moving the baseline on one machine
// isn't undone by the other's older copy.
const rowStamp = (row) => Math.max(0, ...['at', 'updatedAt', 'frozenAt'].map(k => Number(row?.[k]) || 0));
export function mergeDayHistories(local, remote) {
  const isMap = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (!isMap(remote)) return isMap(local) ? local : remote;
  if (!isMap(local)) return remote;
  const out = { ...remote };
  for (const [k, row] of Object.entries(local)) {
    if (!(k in out) || rowStamp(row) >= rowStamp(out[k])) out[k] = row;
  }
  const baselines = Object.keys(out).filter(k => out[k]?.baseline);
  if (baselines.length > 1) {
    const keep = baselines.reduce((a, b) => ((Number(out[b]?.frozenAt) || 0) > (Number(out[a]?.frozenAt) || 0) ? b : a));
    for (const k of baselines) {
      if (k === keep) continue;
      const { baseline: _b, frozenAt: _f, ...rest } = out[k];
      out[k] = rest;
    }
  }
  const sorted = {};
  for (const k of Object.keys(out).sort()) sorted[k] = out[k];
  return sorted;
}

// `merge` applied to two JSON strings, or null when either won't parse or
// the merge throws (the caller then keeps what it has).
function mergeJson(entry, localRaw, remoteRaw, key) {
  try { return JSON.stringify(entry.merge(JSON.parse(localRaw), JSON.parse(remoteRaw))); }
  catch (err) { console.warn(`localMirror: merge failed for "${key}"`, err); return null; }
}

// dbPut + "remember to sync it". Call sites that write a mirrored record go
// through this so the push can't be forgotten at one of them.
export async function mirrorDbPut(store, dbKey, value) {
  await dbPut(store, value, dbKey);
  queueMirrorPush(dbMirrorId(store, dbKey));
}

// The local copy of a mirrored entry, as the JSON string the cloud holds,
// or null when this browser has nothing for it.
async function readLocal(id, entry) {
  if (entry.kind === 'idb') {
    try {
      const v = await dbGet(entry.store, entry.dbKey);
      return (v === undefined || v === null) ? null : JSON.stringify(v);
    } catch { return null; }
  }
  return userLsGet(id);
}

async function writeLocal(id, entry, json) {
  if (entry.kind === 'idb') {
    await dbPut(entry.store, JSON.parse(json), entry.dbKey);
    return;
  }
  userLsSet(id, json);
}

async function removeLocal(id, entry) {
  if (entry.kind === 'idb') {
    try { await dbDelete(entry.store, entry.dbKey); } catch { /* already gone */ }
    return;
  }
  userLsRemove(id);
}

let _userId = null;

export function setMirrorUserId(uid) {
  _userId = uid || null;
}

function utf8ByteLength(str) {
  try { return new TextEncoder().encode(str).length; }
  catch { return str.length; }
}

// Split a string into pieces that are each at most `maxBytes` UTF-8 bytes.
// Slicing on a character count would not do: the cap Firestore enforces is
// on bytes, and a payload of mostly multi-byte characters can be three
// times its character length, which is how a "safely under 1 MB" chunk
// becomes a rejected write. Start from a byte-count guess and walk it down
// until the piece actually fits, so ASCII still gets full-size chunks.
function splitByUtf8Bytes(str, maxBytes) {
  const parts = [];
  let i = 0;
  while (i < str.length) {
    let end = Math.min(str.length, i + maxBytes);
    // Never cut between the halves of a surrogate pair — each half alone is
    // not a valid character, and what survives the round-trip through UTF-8
    // would not rejoin into the original.
    if (end < str.length) {
      const code = str.charCodeAt(end - 1);
      if (code >= 0xd800 && code <= 0xdbff) end -= 1;
    }
    while (end > i + 1 && utf8ByteLength(str.slice(i, end)) > maxBytes) {
      // Overshoot is proportional to how multi-byte the text is, so scale
      // down by the measured ratio rather than stepping one char at a time.
      const over = utf8ByteLength(str.slice(i, end)) / maxBytes;
      let next = i + Math.max(1, Math.floor((end - i) / Math.max(over, 1.05)));
      if (next >= end) next = end - 1;
      const code = str.charCodeAt(next - 1);
      end = (code >= 0xd800 && code <= 0xdbff) ? next - 1 : next;
    }
    parts.push(str.slice(i, end));
    i = end;
  }
  return parts;
}

async function mirrorDoc(userId, key) {
  return doc(await getDb(), COL, userId, SUB, key);
}

// Announce a store's change to same-window listeners, one microtask later.
//
// Several stores persist from INSIDE a React state updater — see
// CommissionsView.updateCell, which calls saveCommissionsOverride within
// setStore(prev => …). A listener that reacts by calling setState would then
// run while that updater is still executing, which React treats as an update
// during render (and, under StrictMode, does twice). Hopping a microtask puts
// every listener safely after the updater has returned; nothing here needs to
// observe the change synchronously.
export function dispatchStoreEvent(eventName) {
  if (!eventName) return;
  Promise.resolve().then(() => {
    try { window.dispatchEvent(new Event(eventName)); } catch { /* no window */ }
  });
}

function fire(eventName) {
  dispatchStoreEvent(eventName);
}

// ---------------------------------------------------------------------
// Firestore document I/O

async function readMirror(userId, key) {
  const ref = await mirrorDoc(userId, key);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const raw = snap.data() || {};
  const updatedAt = Number(raw.updatedAt) || 0;
  const chunkCount = Number(raw.chunkCount) || 0;
  if (chunkCount > 0) {
    const parts = new Array(chunkCount).fill('');
    const chunks = await getDocs(collection(ref, 'chunks'));
    chunks.forEach((d) => {
      const i = Number(d.id);
      if (Number.isInteger(i) && i >= 0 && i < parts.length) parts[i] = String(d.data()?.s || '');
    });
    return { json: parts.join(''), updatedAt };
  }
  return { json: typeof raw.json === 'string' ? raw.json : '', updatedAt };
}

// Remove chunks left by an earlier, larger save. Best-effort: the loader
// keys off chunkCount, so a leftover chunk this fails to delete is dead
// data rather than a value that can come back.
async function dropChunks(ref, count) {
  if (!(count > 0)) return;
  try {
    const batch = writeBatch(await getDb());
    for (let i = 0; i < count; i++) batch.delete(doc(ref, 'chunks', String(i)));
    await batch.commit();
  } catch (err) {
    console.warn('localMirror: stale chunk cleanup failed (harmless)', err);
  }
}

async function writeMirror(userId, key, json, updatedAt) {
  const ref = await mirrorDoc(userId, key);
  let priorChunkCount = 0;
  try { priorChunkCount = Number((await getDoc(ref)).data()?.chunkCount) || 0; } catch { /* first write */ }

  if (utf8ByteLength(json) <= SINGLE_DOC_MAX_BYTES) {
    await setDoc(ref, { chunkCount: 0, updatedAt, json }, { merge: true });
    await dropChunks(ref, priorChunkCount);
    return;
  }

  const parts = splitByUtf8Bytes(json, CHUNK_BYTES);
  const batch = writeBatch(await getDb());
  parts.forEach((s, i) => batch.set(doc(ref, 'chunks', String(i)), { s }));
  // The parent lands last so a reader never sees a chunkCount whose chunks
  // aren't all written yet.
  batch.set(ref, { chunkCount: parts.length, updatedAt, json: '' }, { merge: true });
  await batch.commit();
  if (priorChunkCount > parts.length) {
    try {
      const cleanup = writeBatch(await getDb());
      for (let i = parts.length; i < priorChunkCount; i++) cleanup.delete(doc(ref, 'chunks', String(i)));
      await cleanup.commit();
    } catch (err) {
      console.warn('localMirror: stale chunk cleanup failed (harmless)', err);
    }
  }
}

// ---------------------------------------------------------------------
// Push

const timers = new Map();

// Record that `key` changed locally and schedule the push. `allowEmpty`
// marks a deliberate clear (the Deals tab's Clear button): without it a key
// with no local value is never pushed, so a browser that has lost its
// localStorage can't wipe the cloud copy on its way to hydrating from it.
// `keepVersion` always keeps the copy this save replaces as an earlier
// version, even inside the routine-edit throttle (a restore uses it, so
// the restore itself can be undone).
export function queueMirrorPush(key, { allowEmpty = false, keepVersion = false } = {}) {
  const at = Date.now();
  try {
    // A browser from before the base was tracked: the stamp it holds is the
    // cloud copy it last synced with (hydration and pushes both set it to
    // the cloud's), so that is what this edit is based on.
    if (userLsGet(key + BASE_SUFFIX) == null) userLsSet(key + BASE_SUFFIX, String(readStamp(key, AT_SUFFIX)));
    userLsSet(key + AT_SUFFIX, String(at));
  } catch { /* quota — the push still carries `at` */ }
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => {
    timers.delete(key);
    void pushNow(key, { allowEmpty, keepVersion });
  }, PUSH_DEBOUNCE_MS));
}

// One push per key at a time. Two overlapping pushes from this browser
// would otherwise race: the second could read the cloud copy the first had
// just written, before the first recorded it as this browser's base, and
// take this browser's own save for someone else's.
const pushChains = new Map();
function pushNow(key, opts) {
  const prev = pushChains.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(() => pushNowSerial(key, opts));
  pushChains.set(key, next);
  next.finally(() => { if (pushChains.get(key) === next) pushChains.delete(key); }).catch(() => {});
  return next;
}

// `force` skips the stale check, for a deliberate overwrite: restoring a
// backup or an earlier version. What it replaces is still kept as an
// earlier version.
async function pushNowSerial(key, { allowEmpty = false, force = false, keepVersion = false } = {}) {
  if (!_userId) return; // signed out: nothing to push to
  const entry = registry.get(key);
  if (!entry) return;
  let raw = await readLocal(key, entry);
  if (raw == null && !allowEmpty) return;
  // A merged key never overwrites the cloud blind: fold in what the cloud
  // holds first, so rows another tab or machine wrote survive this push.
  // If the cloud can't be read, don't push at all (the next write retries)
  // rather than risk replacing rows this browser has never seen.
  if (entry.mergeAlways && raw != null) {
    let remote;
    try { remote = await readMirror(_userId, key); }
    catch (err) { console.warn(`localMirror: couldn't read "${key}" before pushing; will retry on the next change`, err); return; }
    if (remote?.json) {
      const merged = mergeJson(entry, raw, remote.json, key);
      if (merged == null) return;
      if (merged !== raw) {
        await writeLocal(key, entry, merged);
        fire(entry.eventName);
        raw = merged;
      }
      if (merged === remote.json) return; // the cloud already has all of it
    }
  }
  const userId = _userId;
  const json = raw == null ? '' : raw;
  // A whole-key push replaces the cloud copy, so first check this browser
  // is replacing the copy it last synced with (see the header). If the
  // cloud can't be read, don't push (the next change retries) rather than
  // overwrite something unseen.
  if (!entry.mergeAlways) {
    let remote;
    try { remote = await readMirror(userId, key); }
    catch (err) { console.warn(`localMirror: couldn't read "${key}" before saving; will retry on the next change`, err); return; }
    if (remote && !force && remote.updatedAt > readStamp(key, BASE_SUFFIX)) {
      await setAsideStale(userId, key, entry, json, remote);
      return;
    }
    if (remote && remote.json !== json) {
      await archiveVersion(userId, key, remote.json, {
        updatedAt: remote.updatedAt,
        reason: force || keepVersion ? 'before-restore' : (removesData(remote.json, json) ? 'before-delete' : 'auto'),
      });
    }
  }
  // A push with no stamp yet is data this browser held from before mirroring
  // existed. Stamp it as it goes up, so the next hydration compares it like
  // any other value instead of re-adopting (and re-pushing) it every signin.
  let at = readStamp(key, AT_SUFFIX);
  if (!at) at = Date.now();
  try {
    await writeMirror(userId, key, json, at);
    markSynced(key, at);
  } catch (err) {
    console.warn(`localMirror: failed to save "${key}" to Firestore`, err);
  }
}

// This browser's copy of `key` is out of date: another tab or machine has
// saved since this one last synced. Keep this browser's unsaved copy as an
// earlier version, take the cloud's, and tell the page.
async function setAsideStale(userId, key, entry, localJson, remote) {
  let versionSlot = null;
  if (localJson !== remote.json && localJson !== '') {
    versionSlot = await archiveVersion(userId, key, localJson, { updatedAt: readStamp(key, AT_SUFFIX), reason: 'not-saved' });
  }
  if (remote.json === '') await removeLocal(key, entry);
  else await writeLocal(key, entry, remote.json);
  markSynced(key, remote.updatedAt);
  fire(entry.eventName);
  console.warn(`localMirror: "${key}" was out of date on this device; took the newer copy${versionSlot != null ? ' and kept this device\'s as an earlier version' : ''}`);
  try { window.dispatchEvent(new CustomEvent(MIRROR_CONFLICT_EVENT, { detail: { key, versionSlot } })); } catch { /* no window */ }
}

// ---------------------------------------------------------------------
// Earlier versions

const versionsIndexId = (key) => `${key}__versions`;
const versionSlotId = (key, slot) => `${key}__v${slot}`;

function rowCount(json) {
  try { const v = JSON.parse(json); return Array.isArray(v) ? v.length : (v && typeof v === 'object' ? Object.keys(v).length : null); }
  catch { return null; }
}

// Whether replacing `before` with `after` loses data: a clear, fewer rows
// or entries, or a value at least a tenth smaller.
export function removesData(before, after) {
  if (!before) return false;
  if (!after) return true;
  const a = rowCount(before);
  const b = rowCount(after);
  if (a != null && b != null && b < a) return true;
  return after.length < before.length * 0.9;
}

async function readVersionIndex(userId, key) {
  const doc = await readMirror(userId, versionsIndexId(key));
  try {
    const v = doc?.json ? JSON.parse(doc.json) : null;
    return { next: Number(v?.next) || 0, list: Array.isArray(v?.list) ? v.list : [] };
  } catch { return { next: 0, list: [] }; }
}

// Keep `json` (a copy of `key` stamped `updatedAt`) as an earlier version.
// Returns the slot it went into, or null when it wasn't kept: empty, the
// same copy already kept, or a routine edit inside the throttle window.
// Never throws: failing to keep a version must not block the save.
async function archiveVersion(userId, key, json, { updatedAt = 0, reason = 'auto', now = Date.now() } = {}) {
  if (!json) return null;
  try {
    const index = await readVersionIndex(userId, key);
    if (index.list.some(v => v.updatedAt === updatedAt && v.bytes === json.length)) return null;
    if (reason === 'auto' && index.list[0] && now - (Number(index.list[0].archivedAt) || 0) < VERSION_THROTTLE_MS) return null;
    const slot = index.next % VERSIONS_KEEP;
    await writeMirror(userId, versionSlotId(key, slot), json, now);
    const entry = { slot, archivedAt: now, updatedAt, reason, bytes: json.length, rows: rowCount(json) };
    const list = [entry, ...index.list.filter(v => v.slot !== slot)].slice(0, VERSIONS_KEEP);
    await writeMirror(userId, versionsIndexId(key), JSON.stringify({ next: slot + 1, list }), now);
    return slot;
  } catch (err) {
    console.warn(`localMirror: couldn't keep an earlier version of "${key}"`, err);
    return null;
  }
}

/**
 * The kept earlier versions of a mirrored key, newest first:
 * [{ slot, archivedAt, updatedAt, reason, bytes, rows }]. `reason` is
 * 'auto' (a routine save), 'before-delete' (a save that removed data),
 * 'before-restore', or 'not-saved' (this device's change, set aside
 * because its copy was out of date).
 */
export async function listMirrorVersions(key) {
  if (!_userId) return [];
  const { list } = await readVersionIndex(_userId, key);
  return [...list].sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));
}

/** One kept version's value, as the JSON string the key holds, or null. */
export async function readMirrorVersion(key, slot) {
  if (!_userId) return null;
  const doc = await readMirror(_userId, versionSlotId(key, slot));
  return doc?.json || null;
}

// ---------------------------------------------------------------------
// Hydrate

async function hydrateKey(userId, key, entry) {
  const eventName = entry.eventName;
  const localRaw = await readLocal(key, entry);
  const localAt = Number(userLsGet(key + AT_SUFFIX)) || 0;
  const remote = await readMirror(userId, key);

  // Nothing in the cloud yet — seed it from whatever this browser holds so
  // the first signin after this ships starts the backup.
  if (!remote) {
    if (localRaw != null) await pushNow(key);
    return false;
  }

  // A merged key: keep both sides' rows whichever is newer. Write the merge
  // here if it adds anything, and send it up if the cloud is missing some.
  if (entry.mergeAlways && localRaw != null && remote.json) {
    const merged = mergeJson(entry, localRaw, remote.json, key);
    if (merged == null) return false;
    let changed = false;
    if (merged !== localRaw) {
      await writeLocal(key, entry, merged);
      fire(eventName);
      changed = true;
    }
    userLsSet(key + AT_SUFFIX, String(Math.max(localAt, remote.updatedAt, 1)));
    if (merged !== remote.json) await pushNow(key);
    return changed;
  }

  // A value with no stamp: data this browser had before mirroring existed,
  // or written without going through queueMirrorPush. Its age is unknown,
  // so it must not replace the cloud copy (it used to be adopted and pushed
  // over it, which only made sense the first time mirroring shipped). With
  // a merge, both sides are combined; otherwise the cloud copy is taken and
  // this browser's is kept as an earlier version.
  if (localAt === 0 && localRaw != null) {
    if (remote.json === localRaw) { markSynced(key, remote.updatedAt); return false; }
    if (entry.merge && remote.json) {
      let merged = null;
      try { merged = JSON.stringify(entry.merge(JSON.parse(localRaw), JSON.parse(remote.json))); }
      catch (err) { console.warn(`localMirror: merge failed for "${key}", keeping the cloud copy`, err); }
      if (merged != null) {
        await writeLocal(key, entry, merged);
        markSynced(key, remote.updatedAt);
        if (merged !== remote.json) {
          try { userLsSet(key + AT_SUFFIX, String(Date.now())); } catch { /* quota */ }
          await pushNow(key);
        }
        fire(eventName);
        return merged !== localRaw;
      }
    }
    await setAsideStale(userId, key, entry, localRaw, remote);
    return true;
  }

  if (remote.updatedAt > localAt) {
    // This browser had a change it never got to save (made after its last
    // sync, so stamped past its base): the cloud copy wins, but this
    // browser's is kept as an earlier version rather than overwritten.
    const base = userLsGet(key + BASE_SUFFIX) == null ? localAt : readStamp(key, BASE_SUFFIX);
    if (localRaw != null && localRaw !== remote.json && localAt > base) {
      await setAsideStale(userId, key, entry, localRaw, remote);
      return true;
    }
    // An empty payload is a clear that happened on another device.
    if (remote.json === '') {
      if (localRaw == null) return false;
      await removeLocal(key, entry);
      markSynced(key, remote.updatedAt);
      fire(eventName);
      return true;
    }
    if (remote.json === localRaw) { markSynced(key, remote.updatedAt); return false; }
    await writeLocal(key, entry, remote.json);
    markSynced(key, remote.updatedAt);
    fire(eventName);
    return true;
  }

  // This browser is ahead (an edit made here that hasn't reached the
  // cloud) — send it up. pushNow refuses if the cloud has moved on since
  // this browser's base, so a stale copy can't go up this way either.
  if (localAt > remote.updatedAt && localRaw != null) await pushNow(key);
  return false;
}

// Force the stores to register their keys. They register at import time,
// and a store whose view hasn't mounted yet wouldn't otherwise be loaded —
// so anything that walks the whole registry (hydration at signin, a full
// backup restore) has to pull them in first.
async function loadMirroredStores() {
  await Promise.all([
    import('./dealsStore.js'),
    import('./dealClientMap.js'),
    import('./clientManagerStore.js'),
    import('./issueSnoozeStore.js'),
    import('./myAccountsFlagsStore.js'),
    import('./myAccountsSince.js'),
    import('./pipelineDashboardStore.js'),
    import('./bfoActivityStore.js'),
    import('./quotedProjectionsStore.js'),
    import('./commissionsStore.js'),
    import('./yoyOverridesStore.js'),
    import('./raClientsStore.js'),
    import('./dealTimelineHiddenStore.js'),
    import('./stageTableColumns.js'),
    import('./timelineTypeOptions.js'),
    import('./coaItemOptions.js'),
    import('./prospectingStatus.js'),
    import('./prospectingHistory.js'),
    import('./tieredCoverageHistory.js'),
    import('./activeFirmsHistory.js'),
    import('./rosterActivityHistory.js'),
    import('./servicePricingHistory.js'),
    import('./contactCountHistory.js'),
    import('./dmTagHistory.js'),
    import('./missingHistory.js'),
    import('./soldWarningIgnore.js'),
    import('./fillerIgnoreStore.js'),
    import('./pricingOptionLinks.js'),
    import('./pricingMirroredKeys.js'),
    import('./weeklyActivityLog.js'),
    import('./mirroredWorkKeys.js'),
    import('../components/DailySuccess/goalsStore.js'),
    import('../components/DailySuccess/dailySuccessStore.js'),
  ]).catch(err => console.warn('localMirror: store registration import failed', err));
}

// Every key that has a cloud copy, with the stores loaded so the answer is
// the whole list rather than whatever happened to be imported. utils/fullBackup
// asks so a restore knows which of the keys it just wrote have to be
// republished.
export async function mirroredKeyList() {
  await loadMirroredStores();
  return [...registry.keys()];
}

// Push one key NOW, skipping the debounce. queueMirrorPush is right for
// typing; a restore is about to reload the page, and a pending timer would
// be thrown away with it.
export async function pushMirrorNow(key) {
  clearTimeout(timers.get(key));
  timers.delete(key);
  const at = Date.now();
  try { userLsSet(key + AT_SUFFIX, String(at)); } catch { /* quota */ }
  // allowEmpty stays off: a key with nothing behind it locally must not
  // travel up as a deliberate clear and take the cloud copy with it.
  // Forced: a restore is a deliberate overwrite (what it replaces is kept
  // as an earlier version).
  await pushNow(key, { force: true });
}

// Pull every mirrored key for this user, newest-wins, firing each store's
// change event for the ones that actually changed. Called once per signin,
// after the localStorage user scope is set — the keys are per-user
// prefixed, so running this earlier would read the wrong browser slot.
export async function hydrateLocalMirrors(userId) {
  if (!userId) return;
  setMirrorUserId(userId);
  await loadMirroredStores();

  const entries = [...registry.entries()];
  const results = await Promise.allSettled(
    entries.map(([key, entry]) => hydrateKey(userId, key, entry)),
  );
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.warn(`localMirror: hydrate failed for "${entries[i][0]}"`, r.reason);
    }
  });
  _hydratedFor = userId;
  try { window.dispatchEvent(new CustomEvent(MIRRORS_HYDRATED_EVENT)); } catch { /* no window under Node */ }
}

// Whether this signin's hydration pass has finished. A store that WRITES on
// its own, without the user doing anything (the Prospecting history, which
// App records into all day), has to wait for it: whole-key last-write-wins
// means a fresh local write on a new machine would carry a newer stamp than
// the cloud copy and replace the whole history with today's one row.
export const MIRRORS_HYDRATED_EVENT = 'local-mirrors-hydrated';
let _hydratedFor = null;
export function mirrorsHydratedFor(userId) {
  return !!userId && _hydratedFor === userId;
}

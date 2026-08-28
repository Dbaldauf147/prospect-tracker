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
// The chunked document layout mirrors utils/opps2Store — deliberately a
// second implementation rather than a shared one, so this can't destabilize
// the Opps 2 sync path. Both exist for the same reason: past ~1 MB a
// single-document write fails and cross-device sync stalls silently.

import { doc, getDoc, setDoc, collection, getDocs, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { userLsGet, userLsSet, userLsRemove } from './userLs';
import { dbGet, dbPut, dbDelete } from './db';

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

// key → change event to dispatch after hydration writes a newer cloud value
// into localStorage. Stores register themselves at import time so the key
// and its event stay declared in one place (and so this module never has to
// import from them, which would be a cycle).
const registry = new Map();

export function registerMirroredKey(key, eventName) {
  if (!key || key.includes('/')) throw new Error(`Unmirrorable key: ${key}`);
  registry.set(key, { kind: 'ls', eventName });
}

// The id a mirrored IndexedDB record is stored under. IDB records are
// addressed by (store, key) rather than one string, so flatten the pair —
// it becomes a Firestore document id, which cannot contain a slash.
export function dbMirrorId(store, dbKey) {
  return `idb__${store}__${dbKey}`;
}

// Mirror an IndexedDB record. Same newest-wins rules as a localStorage key;
// the value is JSON on the way to Firestore and back.
export function registerMirroredDbKey(store, dbKey, eventName) {
  registry.set(dbMirrorId(store, dbKey), { kind: 'idb', eventName, store, dbKey });
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

function mirrorDoc(userId, key) {
  return doc(db, COL, userId, SUB, key);
}

function fire(eventName) {
  if (!eventName) return;
  try { window.dispatchEvent(new Event(eventName)); } catch { /* no window */ }
}

// ---------------------------------------------------------------------
// Firestore document I/O

async function readMirror(userId, key) {
  const ref = mirrorDoc(userId, key);
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
    const batch = writeBatch(db);
    for (let i = 0; i < count; i++) batch.delete(doc(ref, 'chunks', String(i)));
    await batch.commit();
  } catch (err) {
    console.warn('localMirror: stale chunk cleanup failed (harmless)', err);
  }
}

async function writeMirror(userId, key, json, updatedAt) {
  const ref = mirrorDoc(userId, key);
  let priorChunkCount = 0;
  try { priorChunkCount = Number((await getDoc(ref)).data()?.chunkCount) || 0; } catch { /* first write */ }

  if (utf8ByteLength(json) <= SINGLE_DOC_MAX_BYTES) {
    await setDoc(ref, { chunkCount: 0, updatedAt, json }, { merge: true });
    await dropChunks(ref, priorChunkCount);
    return;
  }

  const parts = splitByUtf8Bytes(json, CHUNK_BYTES);
  const batch = writeBatch(db);
  parts.forEach((s, i) => batch.set(doc(ref, 'chunks', String(i)), { s }));
  // The parent lands last so a reader never sees a chunkCount whose chunks
  // aren't all written yet.
  batch.set(ref, { chunkCount: parts.length, updatedAt, json: '' }, { merge: true });
  await batch.commit();
  if (priorChunkCount > parts.length) {
    try {
      const cleanup = writeBatch(db);
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
export function queueMirrorPush(key, { allowEmpty = false } = {}) {
  const at = Date.now();
  try { userLsSet(key + AT_SUFFIX, String(at)); } catch { /* quota — the push still carries `at` */ }
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => {
    timers.delete(key);
    void pushNow(key, { allowEmpty });
  }, PUSH_DEBOUNCE_MS));
}

async function pushNow(key, { allowEmpty = false } = {}) {
  if (!_userId) return; // signed out: nothing to push to
  const entry = registry.get(key);
  if (!entry) return;
  const raw = await readLocal(key, entry);
  if (raw == null && !allowEmpty) return;
  // A push with no stamp yet is data this browser held from before mirroring
  // existed. Stamp it as it goes up, so the next hydration compares it like
  // any other value instead of re-adopting (and re-pushing) it every signin.
  let at = Number(userLsGet(key + AT_SUFFIX)) || 0;
  if (!at) {
    at = Date.now();
    try { userLsSet(key + AT_SUFFIX, String(at)); } catch { /* quota */ }
  }
  try {
    await writeMirror(_userId, key, raw == null ? '' : raw, at);
  } catch (err) {
    console.warn(`localMirror: failed to save "${key}" to Firestore`, err);
  }
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

  // Data this browser had before mirroring existed carries no stamp, so its
  // age is unknown. Adopt it and stamp it now rather than letting the cloud
  // copy win: on the first signin after this ships, every device is in that
  // state, and the alternative would let whichever device happened to sign
  // in first overwrite a more current roster on the machine actually in use.
  // The restore case is untouched — a cleared browser has no local value at
  // all, so it falls through to the cloud copy below.
  if (localAt === 0 && localRaw != null) {
    await pushNow(key);   // stamps as it goes, so this happens once
    return false;
  }

  if (remote.updatedAt > localAt) {
    // An empty payload is a clear that happened on another device.
    if (remote.json === '') {
      if (localRaw == null) return false;
      await removeLocal(key, entry);
      userLsSet(key + AT_SUFFIX, String(remote.updatedAt));
      fire(eventName);
      return true;
    }
    if (remote.json === localRaw) return false;
    await writeLocal(key, entry, remote.json);
    userLsSet(key + AT_SUFFIX, String(remote.updatedAt));
    fire(eventName);
    return true;
  }

  // This browser is ahead (an edit made while the cloud copy was stale, or
  // an older cloud stamp) — send it up.
  if (localAt > remote.updatedAt && localRaw != null) await pushNow(key);
  return false;
}

// Pull every mirrored key for this user, newest-wins, firing each store's
// change event for the ones that actually changed. Called once per signin,
// after the localStorage user scope is set — the keys are per-user
// prefixed, so running this earlier would read the wrong browser slot.
export async function hydrateLocalMirrors(userId) {
  if (!userId) return;
  setMirrorUserId(userId);
  // Force the stores to register their keys. They register at import time,
  // and a store whose view hasn't mounted yet wouldn't otherwise be loaded.
  await Promise.all([
    import('./dealsStore'),
    import('./dealClientMap'),
    import('./clientManagerStore'),
    import('./issueSnoozeStore'),
    import('./myAccountsFlagsStore'),
    import('./pipelineDashboardStore'),
    import('./bfoActivityStore'),
  ]).catch(err => console.warn('localMirror: store registration import failed', err));

  const entries = [...registry.entries()];
  const results = await Promise.allSettled(
    entries.map(([key, entry]) => hydrateKey(userId, key, entry)),
  );
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.warn(`localMirror: hydrate failed for "${entries[i][0]}"`, r.reason);
    }
  });
}

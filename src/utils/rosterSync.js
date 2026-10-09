// Loading the company roster without reading every company every time.
//
// The roster is a few thousand Firestore documents, and a plain listener on
// the whole collection is billed one read per document whenever it starts
// cold: a new tab, another device, or the same tab after half an hour away.
// That is what ran the project through the Spark plan's 50K reads/day.
//
// So this keeps a copy of the roster on the device (rosterLocalStore.js) and,
// when that copy is recent, listens only to documents whose `updatedAt` is
// newer than the newest one it already holds. A typical day costs the
// handful of companies that actually changed. Every write to the roster
// stamps `updatedAt` with a server Timestamp (utils/firestoreSync.js, and
// api/_lib/companyNews.js on the server), which is what makes that query
// complete.
//
// What a "changed since" query cannot see is a deletion, so:
//   - deletes made from this tab are applied to the copy directly;
//   - a document dropping out of the change listener is checked with a
//     one-document read before it is removed;
//   - and the server's count of documents (an aggregate query: about one
//     read per thousand documents) is compared with the copy's, at start
//     and every so often. Any disagreement means the copy has drifted, and
//     the whole roster is read once to replace it.
// On top of that the copy is replaced from a full read at least weekly, and
// any failure in this path falls back to the plain full listener, which is
// exactly how the roster loaded before.
//
// Edits made here show at once, as they did with the full listener's
// latency compensation: a pending write stamps `updatedAt` with a server
// timestamp the SDK cannot match against the query until it is
// acknowledged, so local writes are layered over the copy until the server
// version comes back.
//
// Pure: Firestore and IndexedDB come in as adapters, so the whole protocol
// is asserted in Node: scripts/rosterSync.test.mjs.

export const ROSTER_STORE_VERSION = 1;
export const FULL_REFRESH_EVERY_MS = 7 * 24 * 60 * 60 * 1000;
// Changes are asked for from a little before the newest one held, so two
// devices writing in the same moment can't slip a document between them.
export const DELTA_MARGIN_MS = 10 * 60 * 1000;
export const COUNT_CHECK_EVERY_MS = 15 * 60 * 1000;
// A count taken while a just-written document is still on its way through
// the listener can disagree for a moment; look again before reading it all.
export const COUNT_RECHECK_DELAY_MS = 5000;
// A local edit stays layered over the copy until the server's version of
// the document arrives, or this long after the write was acknowledged.
export const OVERLAY_TTL_MS = 30 * 1000;

/** Milliseconds of a Firestore Timestamp, {seconds}, Date, ISO string or number; null when absent. */
export function timeMillis(v) {
  if (v == null) return null;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && typeof v.seconds === 'number') return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
  return null;
}

export function updatedMillis(doc) {
  return timeMillis(doc?.updatedAt);
}

// ── Storage codec ────────────────────────────────────────────────────────
// IndexedDB keeps Dates but turns a Firestore Timestamp into a plain object
// with no methods, and code reading the roster calls .toMillis() on them. So
// Timestamps are written as a tagged pair and rebuilt on the way out. Any
// other Firestore type (a reference, a GeoPoint, bytes) has no business in
// a company record; meeting one throws, and the caller simply doesn't keep
// a copy, which costs reads and nothing else.

const isTimestamp = (v) => v && typeof v === 'object' && typeof v.toMillis === 'function'
  && typeof v.seconds === 'number' && typeof v.nanoseconds === 'number';

function isPlain(v) {
  if (!v || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

export function encodeValue(v) {
  if (v == null || typeof v !== 'object') return v;
  if (isTimestamp(v)) return { __fsTs: [v.seconds, v.nanoseconds] };
  if (v instanceof Date) return v;
  if (Array.isArray(v)) return v.map(encodeValue);
  if (isPlain(v)) {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = encodeValue(x);
    return out;
  }
  throw new Error(`roster copy: cannot store a ${v.constructor?.name || 'non-plain'} value`);
}

export function decodeValue(v, makeTimestamp) {
  if (v == null || typeof v !== 'object') return v;
  if (v instanceof Date) return v;
  if (Array.isArray(v)) return v.map(x => decodeValue(x, makeTimestamp));
  const keys = Object.keys(v);
  if (keys.length === 1 && keys[0] === '__fsTs' && Array.isArray(v.__fsTs)) {
    return makeTimestamp(v.__fsTs[0], v.__fsTs[1]);
  }
  const out = {};
  for (const k of keys) out[k] = decodeValue(v[k], makeTimestamp);
  return out;
}

// What updateDoc does with a patch, on a plain copy: a dotted key is a path
// into nested maps, everything else replaces the field.
export function applyPatch(doc, patch) {
  const out = { ...doc };
  for (const [key, value] of Object.entries(patch || {})) {
    if (!key.includes('.')) { out[key] = value; continue; }
    const parts = key.split('.');
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const next = cur[parts[i]];
      cur[parts[i]] = isPlain(next) ? { ...next } : {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }
  return out;
}

/** 'delta' when the device's copy is usable, else 'full'. */
export function planStart(local, now, fullEveryMs = FULL_REFRESH_EVERY_MS) {
  const meta = local?.meta;
  if (!meta || meta.v !== ROSTER_STORE_VERSION) return 'full';
  if (!Array.isArray(local.docs) || local.docs.length === 0) return 'full';
  if (!Number.isFinite(meta.syncedThroughMs) || !Number.isFinite(meta.fullAt)) return 'full';
  if (now - meta.fullAt >= fullEveryMs) return 'full';
  if (meta.fullAt > now + DELTA_MARGIN_MS) return 'full'; // a clock that went backwards
  return 'delta';
}

function maxUpdated(docs, start = -Infinity) {
  let m = start;
  for (const d of docs) {
    const t = updatedMillis(d);
    if (t != null && t > m) m = t;
  }
  return m;
}

/**
 * The controller.
 *
 *   api.listenAll(onSnap, onErr)          -> unsubscribe
 *   api.listenSince(ms, onSnap, onErr)    -> unsubscribe
 *      onSnap({ fromCache, changes: [{ type, doc, pending }], docs })
 *      `docs` is the query's whole result; `pending` marks a document
 *      carrying a write that has not reached the server yet.
 *   api.count()                           -> Promise<number>
 *   api.getAll()                          -> Promise<doc[]>
 *   api.getOne(id)                        -> Promise<doc | null>
 *   store.load()                          -> Promise<{ meta, docs } | null>
 *   store.saveAll(docs, meta)             -> Promise
 *   store.apply(upserts, deleteIds, meta) -> Promise
 * A doc is { id, ...fields }, the shape the app has always been handed.
 */
export function createRosterSync({
  api,
  store,
  onChange,
  onError = () => {},
  onMode = () => {},
  log = () => {},
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (t) => clearTimeout(t),
  isVisible = () => (typeof document === 'undefined' ? true : document.visibilityState !== 'hidden'),
  fullEveryMs = FULL_REFRESH_EVERY_MS,
  countEveryMs = COUNT_CHECK_EVERY_MS,
} = {}) {
  const base = new Map();
  const overlays = new Map(); // id -> [{ seq, patch, settledAt, ok }]
  let seq = 0;
  let mode = 'idle';
  let stopped = false;
  let unsub = null;
  let syncedThroughMs = null;
  let fullAt = null;
  let countTimer = null;
  let countCheckScheduled = false;
  let refreshing = false;
  const timers = new Set();

  const after = (ms, fn) => {
    const t = setTimer(() => { timers.delete(t); if (!stopped) fn(); }, ms);
    timers.add(t);
    return t;
  };

  function setMode(m) { mode = m; onMode(m); }

  function list() {
    const ids = new Set(base.keys());
    for (const id of overlays.keys()) ids.add(id);
    const out = [];
    for (const id of [...ids].sort()) {
      let doc = base.get(id);
      const layers = overlays.get(id);
      if (layers?.length) {
        doc = doc || { id };
        for (const l of layers) doc = applyPatch(doc, l.patch);
        doc = { ...doc, id };
      }
      if (doc) out.push(doc);
    }
    return out;
  }

  function emit() { if (!stopped) onChange(list()); }

  function meta() {
    return { v: ROSTER_STORE_VERSION, syncedThroughMs, fullAt, count: base.size };
  }

  function persist(fn) {
    Promise.resolve().then(fn).catch(err => log('roster copy could not be saved', err));
  }

  // A server version of the document has landed: drop overlays whose write
  // was already acknowledged (it is in this version, or a later one is on
  // its way, and the copy reflects the server either way).
  function serverSaw(id) {
    const layers = overlays.get(id);
    if (!layers) return;
    const keep = layers.filter(l => !l.settledAt);
    if (keep.length) overlays.set(id, keep); else overlays.delete(id);
  }

  // Never let an older copy of a document replace a newer one: the SDK's
  // own cache can answer first with what it last saw.
  function upsert(doc) {
    const prev = base.get(doc.id);
    const a = updatedMillis(prev);
    const b = updatedMillis(doc);
    if (prev && a != null && b != null && b < a) return false;
    base.set(doc.id, doc);
    return true;
  }

  function stopListening() {
    if (unsub) { try { unsub(); } catch { /* already gone */ } unsub = null; }
  }

  // ── full ──────────────────────────────────────────────────────────────
  function startFull(reason) {
    stopListening();
    setMode('full');
    log(`roster: reading every company (${reason})`);
    let saved = false;
    unsub = api.listenAll((snap) => {
      if (stopped) return;
      base.clear();
      for (const d of snap.docs) base.set(d.id, d);
      for (const c of snap.changes) if (!c.pending && c.type !== 'removed') serverSaw(c.doc.id);
      emit();
      if (snap.fromCache) return;
      // A document with a write still in flight is shown, but not kept:
      // its server version will follow.
      const pendingIds = new Set(snap.changes.filter(c => c.pending).map(c => c.doc.id));
      const settled = snap.docs.filter(d => !pendingIds.has(d.id));
      if (!saved) {
        saved = true;
        fullAt = now();
        syncedThroughMs = maxUpdated(settled, syncedThroughMs ?? -Infinity);
        if (!Number.isFinite(syncedThroughMs)) syncedThroughMs = 0;
        const m = meta();
        persist(() => store.saveAll(settled, m));
      } else {
        const up = snap.changes.filter(c => !c.pending && c.type !== 'removed').map(c => c.doc);
        const gone = snap.changes.filter(c => c.type === 'removed' && !c.pending).map(c => c.doc.id);
        if (!up.length && !gone.length) return;
        syncedThroughMs = maxUpdated(up, syncedThroughMs);
        const m = meta();
        persist(() => store.apply(up, gone, m));
      }
    }, (err) => {
      if (stopped) return;
      onError(err);
    });
  }

  // ── delta ─────────────────────────────────────────────────────────────
  function startDelta() {
    stopListening();
    setMode('delta');
    const since = syncedThroughMs - DELTA_MARGIN_MS;
    log(`roster: ${base.size} companies from this device, listening for changes since ${new Date(since).toISOString()}`);
    let first = true;
    unsub = api.listenSince(since, (snap) => {
      if (stopped) return;
      const up = [];
      for (const c of snap.changes) {
        if (c.type === 'removed') {
          // A write of ours still waiting on its server timestamp drops the
          // document out of the query for a moment; it comes back on ack.
          if (c.pending) continue;
          verifyRemoved(c.doc.id);
          continue;
        }
        if (c.pending) continue; // the overlay already shows it
        if (upsert(c.doc)) up.push(c.doc);
        serverSaw(c.doc.id);
      }
      emit();
      if (snap.fromCache) return;
      if (up.length) {
        syncedThroughMs = maxUpdated(up, syncedThroughMs);
        const m = meta();
        persist(() => store.apply(up, [], m));
      }
      if (first) {
        first = false;
        scheduleCountChecks();
      }
    }, (err) => {
      if (stopped) return;
      log('roster: change listener failed, reading every company instead', err);
      startFull('change listener failed');
    });
  }

  async function verifyRemoved(id) {
    try {
      const doc = await api.getOne(id);
      if (stopped) return;
      if (doc) { if (upsert(doc)) emit(); return; }
      if (base.delete(id)) {
        emit();
        const m = meta();
        persist(() => store.apply([], [id], m));
      }
    } catch (err) {
      log('roster: could not confirm a removal', err);
    }
  }

  // ── drift check ───────────────────────────────────────────────────────
  function scheduleCountChecks() {
    if (countCheckScheduled) return;
    countCheckScheduled = true;
    after(1000, () => countCheck());
    const loop = () => {
      countTimer = after(countEveryMs, () => {
        if (isVisible()) countCheck();
        loop();
      });
    };
    loop();
  }

  async function countCheck(recheck = false) {
    if (mode !== 'delta' || refreshing) return;
    let n;
    try { n = await api.count(); } catch (err) { log('roster: count check failed', err); return; }
    if (stopped || mode !== 'delta') return;
    if (n === base.size) return;
    if (!recheck) { after(COUNT_RECHECK_DELAY_MS, () => countCheck(true)); return; }
    log(`roster: this device has ${base.size} companies, the server ${n}; reading every company once`);
    await refreshAll();
  }

  async function refreshAll() {
    if (refreshing) return;
    refreshing = true;
    try {
      const docs = await api.getAll();
      if (stopped) return;
      base.clear();
      for (const d of docs) base.set(d.id, d);
      for (const id of [...overlays.keys()]) serverSaw(id);
      fullAt = now();
      syncedThroughMs = maxUpdated(docs, syncedThroughMs ?? -Infinity);
      emit();
      const m = meta();
      persist(() => store.saveAll(docs, m));
    } catch (err) {
      log('roster: full refresh failed, falling back to the full listener', err);
      if (!stopped) startFull('refresh failed');
    } finally {
      refreshing = false;
    }
  }

  return {
    async start() {
      let local = null;
      try { local = await store.load(); } catch (err) { log('roster copy could not be read', err); }
      if (stopped) return;
      if (planStart(local, now(), fullEveryMs) === 'delta') {
        for (const d of local.docs) base.set(d.id, d);
        syncedThroughMs = local.meta.syncedThroughMs;
        fullAt = local.meta.fullAt;
        emit();
        try { startDelta(); } catch (err) { log('roster: change listener could not start', err); startFull('change listener could not start'); }
      } else {
        startFull(local ? 'device copy is stale' : 'no copy on this device');
      }
    },

    stop() {
      stopped = true;
      stopListening();
      for (const t of timers) clearTimer(t);
      timers.clear();
      if (countTimer) clearTimer(countTimer);
    },

    /** A write this tab is about to make. Returns done(ok) to call when it settles. */
    localWrite(id, patch) {
      if (stopped || !id) return () => {};
      const entry = { seq: ++seq, patch: { ...patch }, settledAt: null };
      overlays.set(id, [...(overlays.get(id) || []), entry]);
      emit();
      return (ok) => {
        const layers = overlays.get(id) || [];
        if (!ok) {
          const keep = layers.filter(l => l !== entry);
          if (keep.length) overlays.set(id, keep); else overlays.delete(id);
          emit();
          return;
        }
        entry.settledAt = now();
        after(OVERLAY_TTL_MS, () => {
          const cur = overlays.get(id) || [];
          if (!cur.includes(entry)) return;
          const keep = cur.filter(l => l !== entry);
          // Fold the acknowledged edit into the copy so it doesn't flicker
          // back if the server's version never comes through the listener.
          base.set(id, applyPatch(base.get(id) || { id }, entry.patch));
          if (keep.length) overlays.set(id, keep); else overlays.delete(id);
          emit();
        });
      };
    },

    /** Documents this tab just deleted. */
    localDeleted(ids) {
      const gone = (ids || []).filter((id) => {
        const had = base.delete(id);
        return overlays.delete(id) || had;
      });
      if (!gone.length || stopped) return;
      emit();
      const m = meta();
      persist(() => store.apply([], gone, m));
    },

    mode: () => mode,
    // For tests.
    _countCheck: () => countCheck(true),
  };
}

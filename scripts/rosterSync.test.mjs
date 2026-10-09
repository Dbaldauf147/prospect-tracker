// Assertion tests for loading the roster from a device copy plus changes.
//   node scripts/rosterSync.test.mjs
//
// A fake Firestore below holds the documents, answers the two listeners the
// way the SDK does (initial result, then added / modified / removed), and
// bills reads the way Firestore does, so these assert the savings as well as
// the correctness.
import {
  createRosterSync, planStart, encodeValue, decodeValue, applyPatch, updatedMillis,
  ROSTER_STORE_VERSION, FULL_REFRESH_EVERY_MS, DELTA_MARGIN_MS, OVERLAY_TTL_MS,
} from '../src/utils/rosterSync.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}
const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 10; i++) await tick(); };

class Ts {
  constructor(ms) { this.seconds = Math.floor(ms / 1000); this.nanoseconds = (ms % 1000) * 1e6; }
  toMillis() { return this.seconds * 1000 + this.nanoseconds / 1e6; }
}
const mkTs = (s, ns) => { const t = new Ts(0); t.seconds = s; t.nanoseconds = ns; return t; };

function fakeServer() {
  let clock = 1_700_000_000_000;
  const docs = new Map();
  const listeners = new Set();
  const billing = { reads: 0 };
  const matches = (l, d) => l.kind === 'all' || (updatedMillis(d) != null && updatedMillis(d) > l.since);
  const result = (l) => [...docs.values()].filter(d => matches(l, d)).sort((a, b) => (a.id < b.id ? -1 : 1));
  function notify(id, pending = false) {
    const d = docs.get(id);
    for (const l of listeners) {
      const was = l.visible.has(id);
      const is = d ? matches(l, d) : false;
      let type = null;
      if (!was && is) type = 'added';
      else if (was && is) type = 'modified';
      else if (was && !is) type = 'removed';
      if (!type) continue;
      if (is) l.visible.add(id); else l.visible.delete(id);
      if (!pending && type !== 'removed') billing.reads += 1;
      l.onSnap({ fromCache: false, docs: result(l), changes: [{ type, doc: d || { id }, pending }] });
    }
  }
  const server = {
    billing,
    now: () => clock,
    advance(ms) { clock += ms; },
    put(id, fields) { clock += 1; docs.set(id, { ...docs.get(id), ...fields, id, updatedAt: new Ts(clock) }); notify(id); },
    putNoStamp(id, fields) { docs.set(id, { ...docs.get(id), ...fields, id }); notify(id); },
    remove(id) { docs.delete(id); notify(id); },
    // A write from the app itself: the SDK shows it with a server timestamp
    // it can't compare, so it leaves a ranged query until acknowledged.
    pendingWrite(id) {
      for (const l of listeners) {
        if (l.kind === 'since' && l.visible.has(id)) {
          l.visible.delete(id);
          l.onSnap({ fromCache: true, docs: result(l), changes: [{ type: 'removed', doc: { id }, pending: true }] });
        }
      }
    },
    size: () => docs.size,
    // Spread an hour apart, as real records are: edited over months, not in one second.
    seed(n) { for (let i = 0; i < n; i++) { const id = `c${String(i).padStart(4, '0')}`; clock += 3600 * 1000; docs.set(id, { id, company: `Co ${i}`, updatedAt: new Ts(clock) }); } },
    api: {
      listenAll(onSnap) {
        const l = { kind: 'all', onSnap, visible: new Set() };
        listeners.add(l);
        const r = result(l);
        r.forEach(d => l.visible.add(d.id));
        billing.reads += Math.max(1, r.length);
        onSnap({ fromCache: false, docs: r, changes: r.map(d => ({ type: 'added', doc: d, pending: false })) });
        return () => listeners.delete(l);
      },
      listenSince(ms, onSnap, onErr) {
        if (server.failSince) { setTimeout(() => onErr(new Error('index missing')), 0); return () => {}; }
        const l = { kind: 'since', since: ms, onSnap, visible: new Set() };
        listeners.add(l);
        const r = result(l);
        r.forEach(d => l.visible.add(d.id));
        billing.reads += Math.max(1, r.length);
        onSnap({ fromCache: false, docs: r, changes: r.map(d => ({ type: 'added', doc: d, pending: false })) });
        return () => listeners.delete(l);
      },
      async count() { billing.reads += Math.max(1, Math.ceil(docs.size / 1000)); return docs.size; },
      async getAll() { billing.reads += Math.max(1, docs.size); return [...docs.values()]; },
      async getOne(id) { billing.reads += 1; return docs.get(id) || null; },
    },
  };
  return server;
}

function memoryStore() {
  let saved = null;
  return {
    get saved() { return saved; },
    async load() { return saved && { meta: { ...saved.meta }, docs: [...saved.docs.values()] }; },
    async saveAll(docs, meta) { saved = { meta: { ...meta }, docs: new Map(docs.map(d => [d.id, d])) }; },
    async apply(up, gone, meta) {
      if (!saved) return;
      for (const d of up) saved.docs.set(d.id, d);
      for (const id of gone) saved.docs.delete(id);
      saved.meta = { ...saved.meta, ...meta, syncedThroughMs: Math.max(saved.meta.syncedThroughMs, meta.syncedThroughMs) };
    },
  };
}

function manualTimers() {
  let q = [];
  return {
    setTimer: (fn, ms) => { const t = { fn, ms }; q.push(t); return t; },
    clearTimer: (t) => { q = q.filter(x => x !== t); },
    async run(filter = () => true) {
      const due = q.filter(filter);
      q = q.filter(t => !due.includes(t));
      for (const t of due) t.fn();
      await settle();
    },
    pending: () => q.map(t => t.ms),
  };
}

function boot(server, store, timers, extra = {}) {
  const seen = { lists: [], modes: [], errors: [] };
  const sync = createRosterSync({
    api: server.api, store,
    onChange: (l) => seen.lists.push(l),
    onError: (e) => seen.errors.push(e.message),
    onMode: (m) => seen.modes.push(m),
    now: () => server.now(),
    setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    isVisible: () => true,
    ...extra,
  });
  return { sync, seen, last: () => seen.lists.at(-1) || [] };
}

// ── pure helpers ─────────────────────────────────────────────────────────
{
  const ts = new Ts(1_700_000_123_456);
  const enc = encodeValue({ a: ts, list: [{ when: ts }], d: new Date(5), n: null, s: 'x' });
  check('timestamps tagged for storage', enc.a, { __fsTs: [ts.seconds, ts.nanoseconds] });
  const dec = decodeValue(structuredClone(enc), mkTs);
  check('and rebuilt with their methods', [dec.a.toMillis(), dec.list[0].when.toMillis(), dec.d instanceof Date], [ts.toMillis(), ts.toMillis(), true]);
  let threw = false;
  try { encodeValue({ ref: new (class DocumentReference {})() }); } catch { threw = true; }
  check('an unexpected Firestore type is refused', threw, true);
  check('dotted patch keys are paths', applyPatch({ a: { b: 1, c: 2 } }, { 'a.b': 9, d: 1 }), { a: { b: 9, c: 2 }, d: 1 });
  check('updatedMillis reads a string too', updatedMillis({ updatedAt: '2026-01-01T00:00:00.000Z' }), Date.parse('2026-01-01T00:00:00.000Z'));

  const fresh = { meta: { v: ROSTER_STORE_VERSION, syncedThroughMs: 1000, fullAt: 1000 }, docs: [{ id: 'a' }] };
  check('a recent copy loads by changes', planStart(fresh, 2000), 'delta');
  check('no copy reads everything', planStart(null, 2000), 'full');
  check('an empty copy reads everything', planStart({ ...fresh, docs: [] }, 2000), 'full');
  check('a week-old copy is replaced', planStart(fresh, 1000 + FULL_REFRESH_EVERY_MS), 'full');
  check('another version is replaced', planStart({ ...fresh, meta: { ...fresh.meta, v: 0 } }, 2000), 'full');
}

// ── first visit, then a return visit ─────────────────────────────────────
const N = 3000;
{
  const server = fakeServer();
  server.seed(N);
  const store = memoryStore();
  const t1 = manualTimers();
  const a = boot(server, store, t1);
  await a.sync.start();
  await settle();
  check('no copy: the whole roster is read', [a.seen.modes, server.billing.reads], [['full'], N]);
  check('and every company is shown', a.last().length, N);
  check('and kept on the device', [store.saved?.docs.size, store.saved?.meta.v], [N, ROSTER_STORE_VERSION]);
  a.sync.stop();

  // Overnight, another device edits two companies and adds one.
  server.advance(12 * 3600 * 1000);
  server.put('c0005', { company: 'Renamed' });
  server.put('c0010', { tier: 'Tier 1' });
  server.put('new1', { company: 'Brand New' });
  server.billing.reads = 0;

  const t2 = manualTimers();
  const b = boot(server, store, t2);
  await b.sync.start();
  await settle();
  check('return visit loads by changes', b.seen.modes, ['delta']);
  check('the device copy is shown before the server answers', b.seen.lists[0].length, N);
  check('the changes arrive', [b.last().length, b.last().find(d => d.id === 'c0005').company, b.last().find(d => d.id === 'new1')?.company], [N + 1, 'Renamed', 'Brand New']);
  // The three changes, plus the one company edited inside the safety margin.
  check('reading only what changed', server.billing.reads, 4);
  check('in id order, as the full listener gave them', b.last().slice(0, 2).map(d => d.id), ['c0000', 'c0001']);
  await t2.run(x => x.ms === 1000); // the check shortly after start
  // An aggregate count bills a read per started thousand: 3,001 is 4.
  check('the count agrees, so the check costs a few reads', server.billing.reads, 4 + 4);

  // Live edits from elsewhere while open.
  server.put('c0100', { status: 'Client' });
  check('a live edit shows', b.last().find(d => d.id === 'c0100').status, 'Client');

  // A delete elsewhere of a company this listener isn't watching.
  server.remove('c0200');
  check('not visible to a changes-only listener', b.last().some(d => d.id === 'c0200'), true);
  await t2.run(); // the next periodic count
  await t2.run(); // its recheck a few seconds later
  check('the count catches it and the roster is refreshed', b.last().some(d => d.id === 'c0200'), false);
  check('and the copy is replaced', store.saved.docs.has('c0200'), false);

  // A delete elsewhere of a company it IS watching.
  server.remove('c0100');
  await settle();
  check('a watched delete is confirmed and applied', b.last().some(d => d.id === 'c0100'), false);
  b.sync.stop();
}

// ── this tab's own writes ────────────────────────────────────────────────
{
  const server = fakeServer();
  server.seed(50);
  const store = memoryStore();
  const t = manualTimers();
  await boot(server, store, t).sync.start();
  server.advance(60_000);
  const t2 = manualTimers();
  const b = boot(server, store, t2);
  await b.sync.start();
  await settle();

  server.put('c0003', { status: 'Prospect' }); // now watched by the listener
  const done = b.sync.localWrite('c0003', { status: 'Client' });
  server.pendingWrite('c0003');
  check('an edit shows at once', b.last().find(d => d.id === 'c0003').status, 'Client');
  check('and the pending removal from the query is ignored', b.last().some(d => d.id === 'c0003'), true);
  done(true);
  server.put('c0003', { status: 'Client' });
  check('the server version takes over', b.last().find(d => d.id === 'c0003').status, 'Client');

  const fail = b.sync.localWrite('c0004', { status: 'Lost' });
  fail(false);
  check('a failed write is undone on screen', b.last().find(d => d.id === 'c0004').status, undefined);

  const add = b.sync.localWrite('newId', { company: 'Added Here' });
  check('an add shows at once', b.last().find(d => d.id === 'newId')?.company, 'Added Here');
  add(true);
  await t2.run(x => x.ms === OVERLAY_TTL_MS);
  check('an acknowledged edit never seen by the listener is kept', b.last().find(d => d.id === 'newId')?.company, 'Added Here');

  b.sync.localDeleted(['c0006']);
  server.remove('c0006');
  await settle();
  check('a delete here disappears at once', b.last().some(d => d.id === 'c0006'), false);
  check('and leaves the copy', store.saved.docs.has('c0006'), false);
  b.sync.stop();
}

// ── an older copy never overwrites a newer one ──────────────────────────
{
  const server = fakeServer();
  server.seed(5);
  const store = memoryStore();
  const t = manualTimers();
  const a = boot(server, store, t);
  await a.sync.start();
  const newest = server.api;
  const real = newest.listenSince;
  a.sync.stop();
  server.put('c0001', { company: 'Newest' });
  const stale = { id: 'c0001', company: 'Older', updatedAt: new Ts(server.now() - 5000) };
  const b = boot(server, store, manualTimers(), {
    api: { ...server.api, listenSince(ms, onSnap, onErr) {
      const u = real(ms, onSnap, onErr);
      onSnap({ fromCache: true, docs: [stale], changes: [{ type: 'modified', doc: stale, pending: false }] });
      return u;
    } },
  });
  await b.sync.start();
  check('an older version does not replace a newer one', b.last().find(d => d.id === 'c0001').company, 'Newest');
  b.sync.stop();
}

// ── a copy past its week, and a failing change listener ──────────────────
{
  const server = fakeServer();
  server.seed(20);
  const store = memoryStore();
  await boot(server, store, manualTimers()).sync.start();
  server.advance(FULL_REFRESH_EVERY_MS + 1);
  server.billing.reads = 0;
  const b = boot(server, store, manualTimers());
  await b.sync.start();
  check('a week-old copy is read again in full', [b.seen.modes, server.billing.reads], [['full'], 20]);
  b.sync.stop();

  server.advance(1000);
  server.failSince = true;
  const c = boot(server, store, manualTimers());
  await c.sync.start();
  await settle();
  check('a change listener that fails falls back to the full listener', c.seen.modes, ['delta', 'full']);
  check('with every company still shown', c.last().length, 20);
  check('and no error surfaced', c.seen.errors, []);
  c.sync.stop();
}

// ── an unreadable copy, and the margin ──────────────────────────────────
{
  const server = fakeServer();
  server.seed(10);
  const broken = { async load() { throw new Error('IDB gone'); }, async saveAll() { throw new Error('IDB gone'); }, async apply() {} };
  const b = boot(server, broken, manualTimers());
  await b.sync.start();
  await settle();
  check('no usable copy still loads every company', [b.seen.modes, b.last().length], [['full'], 10]);
  b.sync.stop();

  const store = memoryStore();
  await boot(server, store, manualTimers()).sync.start();
  const asked = [];
  const c = boot(server, store, manualTimers(), { api: { ...server.api, listenSince(ms, s, e) { asked.push(ms); return server.api.listenSince(ms, s, e); } } });
  await c.sync.start();
  check('changes are asked for from a margin before the newest held', asked[0], store.saved.meta.syncedThroughMs - DELTA_MARGIN_MS);
  c.sync.stop();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

// A stand-in for `firebase/firestore`, for tests that need to watch what a
// save DOES rather than talk to a database.
//
// It exists because the thing worth testing about
// firestoreSync.saveIndicativeAnalysis is what happens when Firestore never
// answers: setDoc resolves on server acknowledgement, so a write that can't
// reach firestore.googleapis.com leaves a promise pending forever rather
// than rejecting. That is not reproducible against the real SDK, and it is
// exactly the failure that left the Utility Lookup page on "Saving 0.6 MB
// to <company>…" with nothing to click.
//
// Wired in by scripts/stubs/loader.mjs, which points both `firebase/firestore`
// and the app's `../firebase` module at these stubs.

// Every call the code under test makes, in order, as
// { op, path, data }. Tests read it to check what was written and when.
export const calls = [];

// Documents the fake database holds, keyed by path.
export const store = new Map();

// Operations that never settle — the hang under test. Each rule is
// { match, op }: `match` is a path string (exact) or a RegExp, `op` an
// optional operation name to narrow it to reads or writes. A chunk document
// carries a random generation in its id, so matching by pattern is the only
// way to hang "every chunk write".
export const hang = [];

export const hangOn = (match, op) => { hang.push({ match, op }); };

// Operations that REJECT. Same rule shape as `hang`, plus the error to
// throw. The Firestore SDK can crash its own async queue — after that every
// call rejects with an internal assertion for the life of the tab — and a
// fallback that only runs on that error can't be tested without a way to
// raise it.
export const failures = [];

export const failOn = (match, error, op) => { failures.push({ match, error, op }); };

// Hang on whatever a predicate says: the rule that matters for a save is
// not a path but a SIZE — a gateway that drops a 700 KB request and passes
// a 64 KB one. Called with { op, path, data }.
export const hangIf = (predicate) => { hang.push({ predicate }); };

// The connection lever the save pulls before a retry. Recorded, not real.
export const network = { calls: [] };
export const disableNetwork = () => { network.calls.push('disable'); return Promise.resolve(); };
export const enableNetwork = () => { network.calls.push('enable'); return Promise.resolve(); };

// Milliseconds every operation takes to answer, and the high-water mark of
// how many were in flight at once. Together they show whether writes went
// up in parallel or one at a time — which is the difference between four
// 200 KB documents and one 800 KB request, once the SDK batches them.
// `track` narrows the concurrency count to the calls a test cares about —
// the chunk writes, say, rather than the bookkeeping write racing beside
// them.
export const timing = { delayMs: 0, inFlight: 0, maxInFlight: 0, track: null };

export function reset() {
  calls.length = 0;
  failures.length = 0;
  store.clear();
  hang.length = 0;
  network.calls.length = 0;
  timing.delayMs = 0;
  timing.inFlight = 0;
  timing.maxInFlight = 0;
  timing.track = null;
}

// Answer after the configured delay, tracking concurrency while it waits.
function answer(call, value) {
  if (!timing.delayMs) return Promise.resolve(value);
  const counted = !timing.track || timing.track(call);
  if (counted) {
    timing.inFlight += 1;
    timing.maxInFlight = Math.max(timing.maxInFlight, timing.inFlight);
  }
  return new Promise((resolve) => setTimeout(() => {
    if (counted) timing.inFlight -= 1;
    resolve(value);
  }, timing.delayMs));
}

const hangs = (call) => hang.some((rule) => {
  if (rule.predicate) return !!rule.predicate(call);
  if (rule.op && rule.op !== call.op) return false;
  return rule.match instanceof RegExp ? rule.match.test(call.path) : rule.match === call.path;
});

const NEVER = () => new Promise(() => {});

const failureFor = (call) => failures.find((rule) => {
  if (rule.op && rule.op !== call.op) return false;
  return rule.match instanceof RegExp ? rule.match.test(call.path) : rule.match === call.path;
})?.error;

// Both take a parent — the db handle (which has no path of its own) or a
// document ref. collection(doc(db, 'a', 'b'), 'chunks') has to come out as
// 'a/b/chunks', not 'chunks': a stub that drops the parent makes a
// subcollection look like a top-level one, and every rule a test sets on
// the real path then quietly misses it.
export const collection = (parent, ...segments) => ({
  path: [parent?.path, ...segments].filter(Boolean).join('/'),
});
export const doc = (parent, ...segments) => ({
  path: [parent?.path, ...segments].filter(Boolean).join('/'),
});

export function getDoc(ref) {
  calls.push({ op: 'getDoc', path: ref.path });
  if (hangs(calls[calls.length - 1])) return NEVER();
  const failure = failureFor(calls[calls.length - 1]);
  if (failure) return Promise.reject(failure);
  const data = store.get(ref.path);
  return Promise.resolve({
    id: ref.path.split('/').pop(),
    exists: () => data !== undefined,
    data: () => data,
  });
}

// How Firestore folds a set(merge: true) into what is already there: field
// by field, and for a MAP field key by key, all the way down. A key absent
// from the new data survives — which is the whole reason a settings write
// that dropped an entry from a map never removed anything. A stub that
// replaced the document instead made that bug untestable, so it models the
// real rule.
function mergeInto(existing, incoming) {
  const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!isMap(existing) || !isMap(incoming)) return incoming;
  const out = { ...existing };
  for (const [k, v] of Object.entries(incoming)) {
    out[k] = k in existing ? mergeInto(existing[k], v) : v;
  }
  return out;
}

export function setDoc(ref, data, options) {
  calls.push({ op: 'setDoc', path: ref.path, data, options });
  if (hangs(calls[calls.length - 1])) return NEVER();
  const failure = failureFor(calls[calls.length - 1]);
  if (failure) return Promise.reject(failure);
  const prior = store.get(ref.path);
  store.set(ref.path, options?.merge && prior !== undefined ? mergeInto(prior, data) : data);
  return answer(calls[calls.length - 1]);
}

export function deleteDoc(ref) {
  calls.push({ op: 'deleteDoc', path: ref.path });
  if (hangs(calls[calls.length - 1])) return NEVER();
  const failure = failureFor(calls[calls.length - 1]);
  if (failure) return Promise.reject(failure);
  store.delete(ref.path);
  return Promise.resolve();
}

export function getDocs(ref) {
  calls.push({ op: 'getDocs', path: ref.path });
  if (hangs(calls[calls.length - 1])) return NEVER();
  const failure = failureFor(calls[calls.length - 1]);
  if (failure) return Promise.reject(failure);
  const prefix = `${ref.path}/`;
  const docs = [...store.entries()]
    .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
    .map(([path, data]) => ({ id: path.slice(prefix.length), ref: { path }, data: () => data }));
  // forEach as well as docs: a QuerySnapshot has both, and app code picks
  // whichever reads better at the call site.
  return Promise.resolve({ docs, forEach: (fn) => docs.forEach(fn), size: docs.length, empty: !docs.length });
}

// A field path, spelled the way the SDK does: FieldPath keeps a key that
// contains a dot literal, where the string form would read it as a path
// into a nested map.
export class FieldPath {
  constructor(...segments) { this.segments = segments; }
}

const NOT_FOUND = () => Object.assign(
  new Error('No document to update'),
  { code: 'not-found' },
);

// updateDoc in both shapes the SDK takes: one object of dotted paths, or
// alternating field/value arguments. Unlike a merged set, each field named
// here REPLACES what the document holds at that path, and deleteField()
// removes it — which is what the settings writer needs and what the REST
// fallback's update mask already did.
export function updateDoc(ref, ...rest) {
  const entries = [];
  if (rest.length === 1 && rest[0] && typeof rest[0] === 'object' && !(rest[0] instanceof FieldPath)) {
    for (const [path, value] of Object.entries(rest[0])) entries.push([path.split('.'), value]);
  } else {
    for (let i = 0; i < rest.length; i += 2) {
      const field = rest[i];
      entries.push([field instanceof FieldPath ? field.segments : String(field).split('.'), rest[i + 1]]);
    }
  }
  const data = Object.fromEntries(entries.map(([segs, v]) => [segs.join('.'), v]));
  calls.push({ op: 'updateDoc', path: ref.path, data, entries });
  if (hangs(calls[calls.length - 1])) return NEVER();
  const failure = failureFor(calls[calls.length - 1]);
  if (failure) return Promise.reject(failure);
  const current = store.get(ref.path);
  if (current === undefined) return Promise.reject(NOT_FOUND());
  const next = { ...current };
  for (const [segments, value] of entries) {
    let cur = next;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const seg = segments[i];
      cur[seg] = (cur[seg] !== null && typeof cur[seg] === 'object' && !Array.isArray(cur[seg]))
        ? { ...cur[seg] }
        : {};
      cur = cur[seg];
    }
    const last = segments[segments.length - 1];
    if (value && value.__deleteField) delete cur[last];
    else cur[last] = value;
  }
  store.set(ref.path, next);
  return answer(calls[calls.length - 1]);
}
// A batch that actually applies on commit, and records the commit as one
// call. The no-op version was enough while nothing under test committed
// one; the analysis remove does, and a stub that swallowed its deletes
// would let a remove that deleted nothing pass.
export function writeBatch() {
  const ops = [];
  const batch = {
    set(ref, data) { ops.push({ op: 'set', path: ref.path, data }); return batch; },
    update(ref, data) { ops.push({ op: 'update', path: ref.path, data }); return batch; },
    delete(ref) { ops.push({ op: 'delete', path: ref.path }); return batch; },
    commit() {
      calls.push({ op: 'commit', size: ops.length, paths: ops.map(o => o.path) });
      const call = calls[calls.length - 1];
      if (hangs(call)) return NEVER();
      const failure = failureFor(call);
      if (failure) return Promise.reject(failure);
      for (const o of ops) {
        if (o.op === 'delete') store.delete(o.path);
        else if (o.op === 'set') store.set(o.path, o.data);
        else store.set(o.path, { ...(store.get(o.path) || {}), ...o.data });
      }
      ops.length = 0;
      return Promise.resolve();
    },
  };
  return batch;
}
export const onSnapshot = () => () => {};
// The sentinel updateDoc() takes to mean "remove this field".
export const deleteField = () => ({ __deleteField: true });
export const runTransaction = (_db, fn) => fn({
  get: (ref) => getDoc(ref),
  set: (ref, data) => { setDoc(ref, data); },
  update: (ref, data) => { updateDoc(ref, data); },
  delete: (ref) => { deleteDoc(ref); },
});
export const serverTimestamp = () => ({ __serverTimestamp: true });

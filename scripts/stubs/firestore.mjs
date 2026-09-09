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

export const collection = (_db, ...segments) => ({ path: segments.join('/') });
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

export function setDoc(ref, data) {
  calls.push({ op: 'setDoc', path: ref.path, data });
  if (hangs(calls[calls.length - 1])) return NEVER();
  const failure = failureFor(calls[calls.length - 1]);
  if (failure) return Promise.reject(failure);
  store.set(ref.path, data);
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
  return Promise.resolve({ docs });
}

// Unused by the analysis save, but imported by the modules under test.
export function updateDoc(ref, data) {
  calls.push({ op: 'updateDoc', path: ref.path, data });
  if (hangs(calls[calls.length - 1])) return NEVER();
  const failure = failureFor(calls[calls.length - 1]);
  if (failure) return Promise.reject(failure);
  store.set(ref.path, { ...(store.get(ref.path) || {}), ...data });
  return answer(calls[calls.length - 1]);
}
export const writeBatch = () => ({ set() {}, update() {}, delete() {}, commit: () => Promise.resolve() });
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

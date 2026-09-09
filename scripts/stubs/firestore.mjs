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

export function reset() {
  calls.length = 0;
  store.clear();
  hang.length = 0;
}

const hangs = (op, path) => hang.some((rule) => (
  (!rule.op || rule.op === op)
  && (rule.match instanceof RegExp ? rule.match.test(path) : rule.match === path)
));

const NEVER = () => new Promise(() => {});

export const collection = (_db, ...segments) => ({ path: segments.join('/') });
export const doc = (parent, ...segments) => ({
  path: [parent?.path, ...segments].filter(Boolean).join('/'),
});

export function getDoc(ref) {
  calls.push({ op: 'getDoc', path: ref.path });
  if (hangs(calls[calls.length - 1].op, ref.path)) return NEVER();
  const data = store.get(ref.path);
  return Promise.resolve({
    id: ref.path.split('/').pop(),
    exists: () => data !== undefined,
    data: () => data,
  });
}

export function setDoc(ref, data) {
  calls.push({ op: 'setDoc', path: ref.path, data });
  if (hangs(calls[calls.length - 1].op, ref.path)) return NEVER();
  store.set(ref.path, data);
  return Promise.resolve();
}

export function deleteDoc(ref) {
  calls.push({ op: 'deleteDoc', path: ref.path });
  if (hangs(calls[calls.length - 1].op, ref.path)) return NEVER();
  store.delete(ref.path);
  return Promise.resolve();
}

export function getDocs(ref) {
  calls.push({ op: 'getDocs', path: ref.path });
  if (hangs(calls[calls.length - 1].op, ref.path)) return NEVER();
  const prefix = `${ref.path}/`;
  const docs = [...store.entries()]
    .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
    .map(([path, data]) => ({ id: path.slice(prefix.length), ref: { path }, data: () => data }));
  return Promise.resolve({ docs });
}

// Unused by the analysis save, but imported by the module under test.
export const updateDoc = (ref, data) => setDoc(ref, data);
export const writeBatch = () => ({ set() {}, update() {}, delete() {}, commit: () => Promise.resolve() });
export const onSnapshot = () => () => {};
export const serverTimestamp = () => ({ __serverTimestamp: true });

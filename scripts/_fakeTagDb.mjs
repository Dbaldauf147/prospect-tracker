// An in-memory stand-in for the few firebase-admin calls the tag store
// (api/_lib/contactTagStore.js) makes, for the tests. Not a test itself.
// Just enough of firebase-admin: docs keyed by path, set with merge (deep
// for maps), auto-id docs in a subcollection, and batches.
export function fakeDb() {
  const docs = new Map();
  let auto = 0;
  const deepMerge = (a, b) => {
    const out = { ...(a || {}) };
    for (const [k, v] of Object.entries(b)) {
      out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(out[k], v) : v;
    }
    return out;
  };
  const docRef = (path) => ({
    path,
    get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
    collection: (name) => collRef(`${path}/${name}`),
  });
  const collRef = (path) => ({
    doc: (id) => docRef(`${path}/${id ?? `auto${++auto}`}`),
  });
  const write = (ref, data, opts) => {
    docs.set(ref.path, opts?.merge ? deepMerge(docs.get(ref.path), data) : data);
  };
  return {
    docs,
    collection: collRef,
    batch: () => {
      const ops = [];
      return { set: (ref, data, opts) => ops.push([ref, data, opts]), commit: async () => { for (const op of ops) write(...op); } };
    },
  };
}


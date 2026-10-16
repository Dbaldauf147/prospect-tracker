// In-memory stand-in for src/utils/db.js, for tests of modules that keep
// their data in IndexedDB. Swapped in by idbLoader.mjs. Counts reads, and
// can hold every read open until the test releases it, so a test can ask
// what happens to callers that arrive while a read is still running.
const data = new Map();
let uid = null;
export const stats = { gets: 0, puts: 0 };
let gate = null;
export function holdReads() {
  let release;
  gate = new Promise(r => { release = r; });
  return () => { gate = null; release(); };
}
export function setDbUserId(u) { uid = u || null; }
export function getDbUserId() { return uid; }
export async function dbGet(store, key) {
  stats.gets += 1;
  const g = gate;
  if (g) await g;
  const v = data.get(`${uid}:${store}:${key}`);
  return v === undefined ? undefined : structuredClone(v);
}
export async function dbPut(store, value, key) {
  stats.puts += 1;
  data.set(`${uid}:${store}:${key}`, structuredClone(value));
}

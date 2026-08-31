// One file that holds everything this browser knows.
//
// The app already keeps most of its data in two places: localStorage /
// IndexedDB for the fast local copy, Firestore for the cross-device one
// (see localMirrorSync, opps2Store, listBackupSync). That covers the
// failure this module exists for — a "Clear cookies and site data" wiping
// the deals roster and the Clients-tab typed fields — but only for the
// stores that were wired up to mirror, and only for as long as the account
// behind them is reachable. Anything local-only (the Daily Success journal,
// captured Quoted Projections rows, Market Update attachments, the utility
// vendor decisions typed on Sites) still has exactly one copy, and nothing
// at all survives losing the Google account itself.
//
// So: an export that is a genuine off-app copy. One JSON file carrying
// every localStorage key, every IndexedDB record in both databases, and
// the cloud-side collections (prospects, the settings document and its
// subcollections, Opps 2), and a restore that puts them back.
//
// Two things the restore has to get right, both learned from the stores
// it writes into:
//
//   * A restored mirrored key has to WIN. Its `:__mirroredAt` stamp came
//     out of the backup file, so it is older than whatever the cloud holds
//     — hydration at the next signin would quietly undo the restore. Every
//     mirrored key is therefore re-stamped to now and pushed before the
//     page reloads (the same trick OppsBackupPanel plays with _rowUpdatedAt).
//   * Prospects restore by document id, additively. A restore is a
//     recovery, not a reconciliation: it must never delete a record that
//     exists today and isn't in the file.
//
// The encode / decode / plan halves are pure and take no browser API, so
// scripts/fullBackup.test.mjs can exercise them under plain Node.

export const FULL_BACKUP_FORMAT = 'prospect-tracker-full-backup';
export const FULL_BACKUP_VERSION = 1;

// The two IndexedDB databases the app writes. `prospect-tracker-db` is
// db.js (uid-prefixed out-of-line keys); `prospect-tracker-files` is
// uploadedListStore's own database, whose stores key on a field inside the
// record. Named here rather than imported so this module stays loadable
// under Node.
export const APP_DB = 'prospect-tracker-db';
export const FILES_DB = 'prospect-tracker-files';

// A single record past this is left out with a note rather than blowing up
// the export. Nothing the app stores should reach it; a corrupt or runaway
// record shouldn't cost the user the other 200 MB of their backup.
export const MAX_RECORD_BYTES = 64 * 1024 * 1024;

// ---------------------------------------------------------------------
// Value encoding
//
// IndexedDB stores structured clones — Blobs (RFP workbooks, Market Update
// attachments), typed arrays, Dates, and at least one thing that cannot be
// serialized at all: the FileSystemDirectoryHandle the Call Recordings page
// stashes for its local folder. JSON handles none of those, so values go
// through a tagged encoding on the way out and come back through its
// inverse. Anything unrecognised is recorded as skipped, with its type, so
// the manifest can say what didn't make it instead of the file silently
// holding `{}` where a handle used to be.

const TAG = '__ptBackup';

export function utf8Bytes(str) {
  try { return new TextEncoder().encode(String(str)).length; }
  catch { return String(str).length; }
}

// btoa over a big buffer one argument-list at a time. Spreading a 30 MB
// Uint8Array into String.fromCharCode overflows the call stack, which is
// how a perfectly good attachment turns into a failed export.
function bytesToBase64(bytes) {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(String(b64 || ''));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

const TYPED_ARRAYS = {
  Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array,
  Int32Array, Uint32Array, Float32Array, Float64Array,
};

function isPlainObject(v) {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * `value` in a JSON-safe shape. `ctx.skipped` collects `{ path, reason }`
 * for everything left behind. Async because reading a Blob's bytes is.
 */
export async function encodeValue(value, ctx = { skipped: [] }, path = '') {
  const note = (reason) => {
    ctx.skipped.push({ path, reason });
    return { [TAG]: 'skipped', reason };
  };

  if (value === null || value === undefined) return value ?? null;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') {
    return Number.isFinite(value) || t !== 'number' ? value : note(`non-finite number (${String(value)})`);
  }
  if (t === 'bigint') return { [TAG]: 'bigint', v: value.toString() };
  if (t === 'function' || t === 'symbol') return note(`${t} cannot be stored`);

  if (value instanceof Date) {
    return { [TAG]: 'date', iso: Number.isNaN(value.getTime()) ? null : value.toISOString() };
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    if (value.size > MAX_RECORD_BYTES) return note(`file of ${value.size} bytes is over the ${MAX_RECORD_BYTES}-byte limit`);
    const bytes = new Uint8Array(await value.arrayBuffer());
    return {
      [TAG]: 'blob',
      mime: value.type || '',
      name: typeof value.name === 'string' ? value.name : undefined,
      lastModified: typeof value.lastModified === 'number' ? value.lastModified : undefined,
      b64: bytesToBase64(bytes),
    };
  }
  if (value instanceof ArrayBuffer) {
    if (value.byteLength > MAX_RECORD_BYTES) return note(`buffer of ${value.byteLength} bytes is over the limit`);
    return { [TAG]: 'arraybuffer', b64: bytesToBase64(new Uint8Array(value)) };
  }
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const kind = value.constructor?.name;
    if (!TYPED_ARRAYS[kind]) return note(`unsupported typed array (${kind})`);
    return { [TAG]: 'typedarray', kind, b64: bytesToBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
  }
  if (value instanceof Map) {
    const entries = [];
    for (const [k, v] of value) entries.push([await encodeValue(k, ctx, `${path}.<key>`), await encodeValue(v, ctx, `${path}.${String(k)}`)]);
    return { [TAG]: 'map', entries };
  }
  if (value instanceof Set) {
    const items = [];
    for (const v of value) items.push(await encodeValue(v, ctx, `${path}[]`));
    return { [TAG]: 'set', items };
  }
  if (Array.isArray(value)) {
    const out = new Array(value.length);
    for (let i = 0; i < value.length; i++) out[i] = await encodeValue(value[i], ctx, `${path}[${i}]`);
    return out;
  }
  if (isPlainObject(value)) {
    const out = {};
    for (const k of Object.keys(value)) out[k] = await encodeValue(value[k], ctx, path ? `${path}.${k}` : k);
    return out;
  }
  // A FileSystemDirectoryHandle, a class instance, anything else that
  // structured-clone accepts but JSON has no shape for.
  return note(`${value?.constructor?.name || 'object'} cannot be written to JSON`);
}

/** The inverse of encodeValue. Unknown tags come back as null. */
export function decodeValue(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(decodeValue);
  const tag = value[TAG];
  if (!tag) {
    const out = {};
    for (const k of Object.keys(value)) out[k] = decodeValue(value[k]);
    return out;
  }
  switch (tag) {
    case 'date': return value.iso ? new Date(value.iso) : new Date(NaN);
    case 'bigint': return BigInt(value.v);
    case 'blob': {
      const bytes = base64ToBytes(value.b64);
      // Restored as a Blob even when it started as a File: the app reads
      // these for their bytes and their recorded name, never through
      // File-only API, and File's constructor isn't available everywhere
      // IndexedDB is.
      const blob = new Blob([bytes], { type: value.mime || '' });
      if (value.name) { try { Object.defineProperty(blob, 'name', { value: value.name, enumerable: false }); } catch { /* frozen impl */ } }
      return blob;
    }
    case 'arraybuffer': return base64ToBytes(value.b64).buffer;
    case 'typedarray': {
      const Ctor = TYPED_ARRAYS[value.kind];
      const bytes = base64ToBytes(value.b64);
      return Ctor ? new Ctor(bytes.buffer, 0, bytes.byteLength / Ctor.BYTES_PER_ELEMENT) : null;
    }
    case 'map': return new Map((value.entries || []).map(([k, v]) => [decodeValue(k), decodeValue(v)]));
    case 'set': return new Set((value.items || []).map(decodeValue));
    case 'skipped': return null;
    default: return null;
  }
}

// ---------------------------------------------------------------------
// Envelope shape

export function isFullBackupEnvelope(obj) {
  return !!obj && typeof obj === 'object' && obj.format === FULL_BACKUP_FORMAT && Number(obj.version) >= 1;
}

function sectionCount(section) {
  if (!section || typeof section !== 'object') return 0;
  return Object.keys(section).length;
}

/**
 * What a backup file holds, for the confirmation the restore shows before
 * it overwrites anything. Pure — the panel and the tests read the same
 * numbers.
 */
export function summarizeBackup(env) {
  if (!isFullBackupEnvelope(env)) return null;
  const local = env.localStorage || {};
  const idb = env.indexedDb || {};
  const cloud = env.firestore || {};
  const stores = [];
  let idbRecords = 0;
  for (const dbName of Object.keys(idb)) {
    for (const storeName of Object.keys(idb[dbName] || {})) {
      const rows = idb[dbName][storeName]?.records || [];
      if (rows.length) stores.push({ db: dbName, store: storeName, records: rows.length });
      idbRecords += rows.length;
    }
  }
  return {
    createdAt: env.createdAt || 0,
    uid: env.uid || '',
    email: env.email || '',
    localKeys: sectionCount(local.scoped) + sectionCount(local.shared),
    idbRecords,
    stores: stores.sort((a, b) => b.records - a.records),
    prospects: Array.isArray(cloud.prospects) ? cloud.prospects.length : 0,
    hasSettings: !!cloud.userSettings,
    opps2Records: Array.isArray(cloud.opps2?.records) ? cloud.opps2.records.length : 0,
    contractLanguage: Array.isArray(cloud.contractLanguage) ? cloud.contractLanguage.length : 0,
    skipped: Array.isArray(env.manifest?.skipped) ? env.manifest.skipped.length : 0,
    bytes: Number(env.manifest?.bytes) || 0,
  };
}

/**
 * The local writes a restore would make, as data. Keys stored under the
 * backup's uid are re-addressed to whoever is signed in NOW — recovering
 * into a second account, or after the app changes how it scopes keys,
 * should still land the data where the app will look for it.
 */
export function planLocalRestore(env, uid) {
  const plan = { localStorage: [], idb: [], skipped: [] };
  if (!isFullBackupEnvelope(env)) return plan;
  const local = env.localStorage || {};
  for (const [key, value] of Object.entries(local.scoped || {})) {
    plan.localStorage.push({ key: uid ? `u:${uid}:${key}` : `u:_anon:${key}`, value, mirrorKey: key });
  }
  for (const [key, value] of Object.entries(local.shared || {})) {
    // Never let a file restore one account's per-user keys onto another's.
    if (key.startsWith('u:')) { plan.skipped.push({ path: `localStorage.${key}`, reason: 'user-scoped key in the shared section' }); continue; }
    plan.localStorage.push({ key, value, mirrorKey: null });
  }
  for (const [dbName, storesObj] of Object.entries(env.indexedDb || {})) {
    for (const [storeName, store] of Object.entries(storesObj || {})) {
      for (const rec of store?.records || []) {
        // db.js partitions by uid prefix; the files database keys inside
        // the record and needs no remapping.
        const key = (dbName === APP_DB && rec.key != null && uid) ? `${uid}:${rec.key}` : rec.key;
        // `rawKey` is the key as the store names it, with no uid partition
        // in front — what a mirror id is built from.
        plan.idb.push({ db: dbName, store: storeName, keyPath: store.keyPath ?? null, key, rawKey: rec.key, value: rec.value });
      }
    }
  }
  return plan;
}

/** A filename that sorts by date and says whose data it is. */
export function backupFileName(env) {
  const d = new Date(Number(env?.createdAt) || Date.now());
  const stamp = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-') + '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
  const who = String(env?.email || '').split('@')[0].replace(/[^A-Za-z0-9._-]/g, '') || 'user';
  return `prospect-tracker-backup-${who}-${stamp}.json`;
}

// ---------------------------------------------------------------------
// Collecting — browser only
//
// Everything below touches localStorage / IndexedDB / Firestore, and is
// only ever called from the Backups page. The pure half above stays
// importable under Node because none of these run at module load.

// Open a database WITHOUT naming a version, so this never triggers an
// upgrade. db.js owns that database's schema; an export that bumped its
// version would be a data-loss bug wearing a backup's clothes.
function openExisting(dbName) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error(`IndexedDB "${dbName}" is blocked by another tab.`));
  });
}

function readStore(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const keyPath = store.keyPath ?? null;
    const keysReq = store.getAllKeys();
    const valsReq = store.getAll();
    let keys, vals;
    const finish = () => resolve({ keyPath, keys, vals });
    keysReq.onsuccess = () => { keys = keysReq.result; if (vals !== undefined) finish(); };
    valsReq.onsuccess = () => { vals = valsReq.result; if (keys !== undefined) finish(); };
    keysReq.onerror = () => reject(keysReq.error);
    valsReq.onerror = () => reject(valsReq.error);
  });
}

// Every record this user owns in `dbName`. `uidPrefix` is db.js's
// partitioning: only keys under it belong to the signed-in user, and the
// prefix comes off on the way out so a restore can re-apply it (a uid is
// stable per account, but the file shouldn't depend on that).
async function collectDatabase(dbName, uidPrefix, ctx) {
  let db;
  try { db = await openExisting(dbName); }
  catch (err) {
    ctx.skipped.push({ path: `indexedDb.${dbName}`, reason: String(err?.message || err) });
    return {};
  }
  const out = {};
  try {
    for (const storeName of Array.from(db.objectStoreNames)) {
      let raw;
      try { raw = await readStore(db, storeName); }
      catch (err) {
        ctx.skipped.push({ path: `indexedDb.${dbName}.${storeName}`, reason: String(err?.message || err) });
        continue;
      }
      const records = [];
      for (let i = 0; i < raw.keys.length; i++) {
        const rawKey = raw.keys[i];
        let key = rawKey;
        if (uidPrefix) {
          if (typeof rawKey !== 'string' || !rawKey.startsWith(uidPrefix)) continue; // another account's row
          key = rawKey.slice(uidPrefix.length);
        }
        const value = await encodeValue(raw.vals[i], ctx, `indexedDb.${dbName}.${storeName}.${key}`);
        records.push({ key, value });
      }
      out[storeName] = { keyPath: raw.keyPath, records };
    }
  } finally {
    try { db.close(); } catch { /* already closed */ }
  }
  return out;
}

function collectLocalStorage(uid, ctx) {
  const scoped = {};
  const shared = {};
  const mine = uid ? `u:${uid}:` : null;
  let n = 0;
  try { n = localStorage.length; } catch { return { scoped, shared }; }
  for (let i = 0; i < n; i++) {
    let key;
    try { key = localStorage.key(i); } catch { continue; }
    if (key == null) continue;
    let value;
    try { value = localStorage.getItem(key); } catch { continue; }
    if (value == null) continue;
    if (mine && key.startsWith(mine)) { scoped[key.slice(mine.length)] = value; continue; }
    // Another account signed in on this browser. Not ours to copy, and
    // certainly not ours to hand somebody in a downloaded file.
    if (key.startsWith('u:')) { ctx.skipped.push({ path: `localStorage.${key}`, reason: 'belongs to another signed-in account' }); continue; }
    shared[key] = value;
  }
  return { scoped, shared };
}

// The Firestore-side data. Local mirrors are deliberately NOT read back:
// they are a copy of the localStorage keys already in this file, and
// doubling a multi-megabyte deals roster helps nobody.
async function collectFirestore(uid, ctx, onProgress) {
  const out = {};
  const step = async (label, fn) => {
    onProgress?.(label);
    try { return await fn(); }
    catch (err) {
      ctx.skipped.push({ path: `firestore.${label}`, reason: String(err?.message || err) });
      return undefined;
    }
  };

  out.prospects = await step('prospects', async () => {
    const { readAllProspects } = await import('./firestoreSync.js');
    return readAllProspects();
  });

  out.userSettings = await step('userSettings', async () => {
    const [{ db }, { doc, getDoc }] = await Promise.all([import('../firebase.js'), import('firebase/firestore')]);
    const snap = await getDoc(doc(db, 'userSettings', uid));
    return snap.exists() ? snap.data() : null;
  });

  out.companySiteLists = await step('companySiteLists', async () => {
    const { readCompanySiteLists } = await import('./companySiteListsStore.js');
    return readCompanySiteLists(uid);
  });

  out.contractLanguage = await step('contractLanguage', async () => {
    const [{ db }, { collection, getDocs }] = await Promise.all([import('../firebase.js'), import('firebase/firestore')]);
    const snap = await getDocs(collection(db, 'userSettings', uid, 'contractLanguage'));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  });

  out.opps2 = await step('opps2', async () => {
    const { loadOpps2Newest } = await import('./opps2Store.js');
    return loadOpps2Newest(uid);
  });

  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

/**
 * The whole backup, as one object ready to be stringified.
 *
 * `includeFiles` covers the uploaded-lists database — CDP and friends run
 * to tens of thousands of rows, and those already have their own Firestore
 * backup (listBackupSync), so a user who only wants their typed-in data
 * can leave them out and keep the file small.
 */
export async function collectFullBackup({ uid, email, includeFiles = true, includeCloud = true, onProgress } = {}) {
  const ctx = { skipped: [] };
  const say = (s) => { try { onProgress?.(s); } catch { /* caller's problem */ } };

  say('Reading this browser…');
  const local = collectLocalStorage(uid, ctx);

  say('Reading local databases…');
  const indexedDb = {};
  indexedDb[APP_DB] = await collectDatabase(APP_DB, uid ? `${uid}:` : null, ctx);
  if (includeFiles) indexedDb[FILES_DB] = await collectDatabase(FILES_DB, null, ctx);

  let firestore;
  if (includeCloud && uid) {
    say('Reading your cloud data…');
    firestore = await collectFirestore(uid, ctx, (label) => say(`Reading ${label}…`));
  }

  const env = {
    format: FULL_BACKUP_FORMAT,
    version: FULL_BACKUP_VERSION,
    createdAt: Date.now(),
    createdAtISO: new Date().toISOString(),
    uid: uid || '',
    email: email || '',
    app: {
      origin: (typeof location !== 'undefined' && location.origin) || '',
      userAgent: (typeof navigator !== 'undefined' && navigator.userAgent) || '',
    },
    localStorage: local,
    indexedDb,
    ...(firestore ? { firestore } : {}),
    manifest: { skipped: ctx.skipped, bytes: 0 },
  };
  const json = JSON.stringify(env);
  env.manifest.bytes = utf8Bytes(json);
  return { env, json };
}

/** Hand the file to the browser's downloader. */
export function downloadBackupFile(env, json) {
  const blob = new Blob([json ?? JSON.stringify(env)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFileName(env);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------------------------------------------------------------------
// Restoring

function putRecords(db, storeName, rows) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    for (const row of rows) {
      // An out-of-line store takes the key as a second argument; an
      // in-line one (uploadedListStore's `keyPath: 'key'`) rejects it.
      if (row.keyPath == null) store.put(row.value, row.key);
      else store.put(row.value);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// Everything the app mirrors, re-stamped to now and pushed straight up
// (no debounce — the page is about to reload). Without this the cloud copy
// of a key is newer than the one just restored, and the next signin
// hydrates the restore away.
async function republishMirrors(plan) {
  const mirror = await import('./localMirrorSync.js');
  let keys;
  try { keys = await mirror.mirroredKeyList(); }
  catch { return 0; }
  const wanted = new Set(plan.localStorage.map(i => i.mirrorKey).filter(Boolean));
  // The mirrored IndexedDB records (the BFO Activity paste, the Pipeline
  // dashboard) are addressed by a flattened store+key id, not by their
  // localStorage name.
  for (const row of plan.idb) {
    if (row.db === APP_DB && row.rawKey != null) wanted.add(mirror.dbMirrorId(row.store, row.rawKey));
  }
  const touched = keys.filter(k => wanted.has(k));
  for (const key of touched) {
    try { await mirror.pushMirrorNow(key); }
    catch (err) { console.warn(`fullBackup: could not republish "${key}"`, err); }
  }
  return touched.length;
}

async function restoreCloud(env, uid, say) {
  const cloud = env.firestore || {};
  const done = [];

  if (cloud.opps2 && Array.isArray(cloud.opps2.records)) {
    say('Restoring Opps 2…');
    const { saveOpps2Cache, flushOpps2ToFirestore } = await import('./opps2Store.js');
    const now = Date.now();
    // Same re-stamp OppsBackupPanel does: every row has to look newer than
    // whatever the per-row merge finds in the cloud, or half the restore
    // loses to the copy it was meant to replace.
    const data = {
      ...cloud.opps2,
      records: cloud.opps2.records.map(r => ({ ...r, _rowUpdatedAt: now })),
      _updatedAt: now,
    };
    await saveOpps2Cache(data);
    await flushOpps2ToFirestore(uid, data);
    done.push(`${data.records.length} Opps 2 rows`);
  }

  if (Array.isArray(cloud.prospects) && cloud.prospects.length) {
    say('Restoring companies…');
    const { restoreProspectDocs } = await import('./firestoreSync.js');
    const n = await restoreProspectDocs(cloud.prospects);
    done.push(`${n} companies`);
  }

  if (cloud.userSettings && typeof cloud.userSettings === 'object') {
    say('Restoring settings…');
    const { pushBackup } = await import('./settingsBackup.js');
    const { saveUserSettings } = await import('./userSettingsSync.js');
    const [{ db }, { doc, getDoc }] = await Promise.all([import('../firebase.js'), import('firebase/firestore')]);
    // Snapshot what's there first, so a restore is itself reversible from
    // the Settings backups list right below this panel.
    try {
      const snap = await getDoc(doc(db, 'userSettings', uid));
      if (snap.exists()) await pushBackup(snap.data(), 'pre-full-restore', { force: true });
    } catch (err) { console.warn('fullBackup: pre-restore settings snapshot failed', err); }
    const { _lastWriteAt, ...rest } = cloud.userSettings;
    await saveUserSettings(uid, rest, { force: true });
    done.push('settings');
  }

  if (Array.isArray(cloud.contractLanguage) && cloud.contractLanguage.length) {
    say('Restoring contract language…');
    const [{ db }, { doc, setDoc }] = await Promise.all([import('../firebase.js'), import('firebase/firestore')]);
    for (const entry of cloud.contractLanguage) {
      const { id, ...data } = entry || {};
      if (!id) continue;
      await setDoc(doc(db, 'userSettings', uid, 'contractLanguage', id), data, { merge: true });
    }
    done.push(`${cloud.contractLanguage.length} contract-language services`);
  }

  return done;
}

/**
 * Put a backup back. Local data is written first and always; the cloud
 * half is opt-in because it reaches beyond this browser.
 *
 * Returns a summary the caller shows before reloading — the page has to
 * reload afterwards, or the views still holding their pre-restore state
 * will autosave it back over what was just written.
 */
export async function restoreFullBackup(env, { uid, includeCloud = false, onProgress } = {}) {
  if (!isFullBackupEnvelope(env)) throw new Error('That file is not a Prospect Tracker backup.');
  const say = (s) => { try { onProgress?.(s); } catch { /* caller's problem */ } };
  const plan = planLocalRestore(env, uid);
  const result = { localKeys: 0, idbRecords: 0, mirrors: 0, cloud: [], failures: [] };

  say('Restoring this browser…');
  for (const item of plan.localStorage) {
    try { localStorage.setItem(item.key, item.value); result.localKeys++; }
    catch (err) { result.failures.push(`localStorage ${item.key}: ${err?.message || err}`); }
  }

  say('Restoring local databases…');
  const byDb = new Map();
  for (const row of plan.idb) {
    if (!byDb.has(row.db)) byDb.set(row.db, new Map());
    const stores = byDb.get(row.db);
    if (!stores.has(row.store)) stores.set(row.store, []);
    stores.get(row.store).push({ key: row.key, keyPath: row.keyPath, value: decodeValue(row.value) });
  }
  for (const [dbName, stores] of byDb) {
    let db;
    try { db = await openExisting(dbName); }
    catch (err) { result.failures.push(`${dbName}: ${err?.message || err}`); continue; }
    try {
      for (const [storeName, rows] of stores) {
        if (!db.objectStoreNames.contains(storeName)) {
          result.failures.push(`${dbName}/${storeName}: this build has no such store`);
          continue;
        }
        try { await putRecords(db, storeName, rows); result.idbRecords += rows.length; }
        catch (err) { result.failures.push(`${dbName}/${storeName}: ${err?.message || err}`); }
      }
    } finally {
      try { db.close(); } catch { /* already closed */ }
    }
  }

  say('Publishing to the cloud…');
  result.mirrors = await republishMirrors(plan);

  if (includeCloud && uid && env.firestore) {
    try { result.cloud = await restoreCloud(env, uid, say); }
    catch (err) { result.failures.push(`cloud restore: ${err?.message || err}`); }
  }

  return result;
}

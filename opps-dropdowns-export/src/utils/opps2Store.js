// SHIM for the Lovable export.
//
// The original module synced the Opps dataset to a chunked Firestore
// document AND an IndexedDB cache, keeping the two in lock-step with a
// field-level merge. The export is offline, so:
//
//   • The pure conflict-resolution core (`stampUpdatedAt`,
//     `mergeOpps2Datasets` and its helpers) is kept VERBATIM — it's the
//     interesting part to recreate and it needs no backend.
//   • The IndexedDB cache reads/writes go through the localStorage-backed
//     `db` shim, so edits persist across reloads.
//   • All Firestore functions are no-ops. `loadOpps2FromFirestore`
//     returns null; the save variants resolve without doing anything.
//   • `loadOpps2Cache` lazily SEEDS the demo dataset (see
//     ../data/sampleData) the first time, so the Opps table renders with
//     realistic rows out of the box. Once you edit, your version in
//     localStorage takes over.

import { dbGet, dbPut } from './db';
import { SAMPLE_OPPS2 } from '../data/sampleData';

export const OPPS2_STORE = 'opps2-cache';
export const OPPS2_CACHE_KEY = 'data';
export const OPPS2_FIRESTORE_COLLECTION = 'opps2Data';

export function stampUpdatedAt(data) {
  return { ...(data || {}), _updatedAt: Date.now() };
}

// ----- pure conflict-resolution core (verbatim from the app) -----------
const TOMBSTONE_TTL_MS = 180 * 24 * 60 * 60 * 1000; // prune deletes older than ~6 months

function fieldTime(row, fieldStamps, key) {
  const t = fieldStamps && Number(fieldStamps[key]);
  return Number.isFinite(t) ? t : (Number(row._rowUpdatedAt) || 0);
}

function mergeOpps2Row(a, b) {
  const aFs = a._fieldUpdatedAt || null;
  const bFs = b._fieldUpdatedAt || null;
  if (!aFs && !bFs) {
    return (Number(b._rowUpdatedAt) || 0) > (Number(a._rowUpdatedAt) || 0) ? b : a;
  }
  const out = { ...a };
  const stamps = { ...(aFs || {}) };
  for (const k of Object.keys(b)) {
    if (k === '_fieldUpdatedAt' || k === '_rowUpdatedAt') continue;
    if (!(k in a)) {
      out[k] = b[k];
      if (bFs && bFs[k] != null) stamps[k] = Number(bFs[k]);
    } else if (fieldTime(b, bFs, k) > fieldTime(a, aFs, k)) {
      out[k] = b[k];
      if (bFs && bFs[k] != null) stamps[k] = Number(bFs[k]);
    }
  }
  out._id = a._id;
  out.id = a.id ?? b.id;
  out._rowUpdatedAt = Math.max(Number(a._rowUpdatedAt) || 0, Number(b._rowUpdatedAt) || 0);
  if (Object.keys(stamps).length) out._fieldUpdatedAt = stamps;
  return out;
}

export function mergeOpps2Datasets(base, incoming) {
  const byId = (arr) => {
    const m = new Map();
    for (const r of (arr?.records || [])) {
      if (r && r._id != null) m.set(String(r._id), r);
    }
    return m;
  };
  const baseById = byId(base);
  const incomingById = byId(incoming);

  const merged = [];
  const seen = new Set();
  for (const [id, baseRow] of baseById) {
    seen.add(id);
    const incomingRow = incomingById.get(id);
    merged.push(incomingRow ? mergeOpps2Row(baseRow, incomingRow) : baseRow);
  }
  for (const [id, incomingRow] of incomingById) {
    if (!seen.has(id)) merged.push(incomingRow);
  }

  const cutoff = Date.now() - TOMBSTONE_TTL_MS;
  const deletedIds = {};
  for (const src of [base?._deletedIds, incoming?._deletedIds]) {
    if (!src) continue;
    for (const [id, t] of Object.entries(src)) {
      const ts = Number(t) || 0;
      if (ts >= cutoff && ts > (deletedIds[id] || 0)) deletedIds[id] = ts;
    }
  }
  const records = merged.filter(r => {
    const t = deletedIds[String(r._id)];
    return t == null || (Number(r._rowUpdatedAt) || 0) > t;
  });

  const baseHeaders = base?.headers || incoming?.headers || [];
  const headerSet = new Set(baseHeaders);
  const extraHeaders = (incoming?.headers || []).filter(h => h && !headerSet.has(h));
  const headers = extraHeaders.length ? [...baseHeaders, ...extraHeaders] : baseHeaders;

  const out = {
    ...(incoming || {}),
    ...(base || {}),
    headers,
    records,
    columnLinks: base?.columnLinks ?? incoming?.columnLinks,
    dropdownLists: base?.dropdownLists ?? incoming?.dropdownLists,
  };
  if (Object.keys(deletedIds).length) out._deletedIds = deletedIds;
  else delete out._deletedIds;
  return out;
}

// ----- cache (localStorage-backed) + seeded demo data ------------------
let seeded = false;

export async function loadOpps2Cache() {
  try {
    const existing = await dbGet(OPPS2_STORE, OPPS2_CACHE_KEY);
    if (existing) return existing;
    // First run: seed the demo dataset so the table isn't empty.
    if (!seeded) {
      seeded = true;
      const seed = stampUpdatedAt(SAMPLE_OPPS2);
      await dbPut(OPPS2_STORE, seed, OPPS2_CACHE_KEY);
      return seed;
    }
    return null;
  } catch (err) {
    console.error('opps2: cache load failed', err);
    return stampUpdatedAt(SAMPLE_OPPS2);
  }
}

export async function saveOpps2Cache(data) {
  try { await dbPut(OPPS2_STORE, stampUpdatedAt(data), OPPS2_CACHE_KEY); }
  catch (err) { console.error('opps2: cache save failed', err); }
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('opps2-cache-updated'));
    }
  } catch { /* CustomEvent unavailable */ }
}

// ----- Firestore functions → offline no-ops ----------------------------
export async function loadOpps2FromFirestore() {
  return null;
}

export async function saveOpps2ToFirestore(_userId, data) {
  return stampUpdatedAt(data)._updatedAt;
}

export async function trySaveOpps2ToFirestore(_userId, data) {
  return stampUpdatedAt(data)._updatedAt;
}

export async function flushOpps2ToFirestore(userId, data) {
  if (!userId || !data) return null;
  // No cloud to flush to; just keep the local cache current.
  try { await saveOpps2Cache(data); } catch { /* best-effort */ }
  return null;
}

export async function loadOpps2Newest() {
  return loadOpps2Cache();
}

// Set a single field on one opp (used by external views in the full app).
// Kept so the API surface matches; operates on the local cache only.
export async function setOppField(userId, oppId, field, value) {
  const data = await loadOpps2Newest(userId);
  if (!data || !Array.isArray(data.records)) {
    throw new Error('Opps data has not loaded yet.');
  }
  let found = false;
  const records = data.records.map((r) => {
    if (String(r?._id) === String(oppId)) {
      found = true;
      const now = Date.now();
      const prevStamps = (r._fieldUpdatedAt && typeof r._fieldUpdatedAt === 'object') ? r._fieldUpdatedAt : null;
      return { ...r, [field]: value, _rowUpdatedAt: now, _fieldUpdatedAt: { ...(prevStamps || {}), [field]: now } };
    }
    return r;
  });
  if (!found) throw new Error(`Opp #${oppId} not found on Opps.`);
  const next = { ...data, records };
  await saveOpps2Cache(next);
  return next;
}

export async function setOppBfoLink(userId, oppId, bfoLink) {
  return setOppField(userId, oppId, 'BFO Link', bfoLink);
}

export async function bulkSetOppField(userId, oppIds, field, value) {
  const ids = new Set((oppIds || []).map(id => String(id)));
  if (ids.size === 0) return 0;
  const data = await loadOpps2Newest(userId);
  if (!data || !Array.isArray(data.records)) {
    throw new Error('Opps data has not loaded yet.');
  }
  let changed = 0;
  const now = Date.now();
  const records = data.records.map((r) => {
    if (!ids.has(String(r?._id))) return r;
    changed += 1;
    const prevStamps = (r._fieldUpdatedAt && typeof r._fieldUpdatedAt === 'object') ? r._fieldUpdatedAt : null;
    return { ...r, [field]: value, _rowUpdatedAt: now, _fieldUpdatedAt: { ...(prevStamps || {}), [field]: now } };
  });
  if (changed === 0) return 0;
  await saveOpps2Cache({ ...data, records });
  return changed;
}

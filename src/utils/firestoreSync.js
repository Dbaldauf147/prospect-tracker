// `getDoc` is aliased: this module already has a local getDoc(id) helper
// that builds a prospect doc ref, and the two names would collide.
import { collection, doc, getDoc as fsGetDoc, setDoc, updateDoc, deleteDoc, getDocs, writeBatch, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

// Subcollection path for analyses saved against a prospect. Kept
// separate from the prospect doc so the bulk subscribeToProspects
// query stays lean — a 500 KB base64 XLSX would otherwise multiply
// initial-load size across the whole list.
const ANALYSIS_DOC_ID = 'main';

const SHARED_COL = 'prospects';

// How two names are compared to decide they are the same company lives in
// utils/companyKey — pure, so the Google Sheets diff can share it without
// pulling the firebase SDK into that module. Re-exported here because this
// is where every caller already imports it from.
export { normalizeCompanyName, companyQualifier, identifyingQualifier, companyDedupeKey } from './companyKey.js';
import { companyDedupeKey } from './companyKey.js';

// Admin uses the shared collection; everyone else gets their own
let _userId = null;
let _useShared = false;

export function setProspectsUser(uid, email) {
  _userId = uid;
  _useShared = (email === 'baldaufdan@gmail.com');
}

// True when this session's prospects live in the shared collection (the
// admin account) rather than a per-user one. Callers that write into
// `prospects` directly need to know which roster they are comparing
// against — see useSheetSync.
export function usesSharedProspects() {
  return _useShared;
}

function getCol() {
  if (_useShared) return collection(db, SHARED_COL);
  if (_userId) return collection(db, 'users', _userId, 'prospects');
  return collection(db, SHARED_COL);
}

function getDoc(id) {
  if (_useShared) return doc(db, SHARED_COL, id);
  if (_userId) return doc(db, 'users', _userId, 'prospects', id);
  return doc(db, SHARED_COL, id);
}

export function subscribeToProspects(onChange) {
  return onSnapshot(getCol(), (snap) => {
    const prospects = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    onChange(prospects);
  }, (err) => {
    console.error('Firestore prospects subscription error:', err);
  });
}

export async function addProspect(prospect) {
  const ref = doc(getCol());
  await setDoc(ref, {
    ...sanitizeFirestoreData(prospect),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

// Firestore rejects writes that contain a field with an empty name
// ("Document fields must not be empty") or an `undefined` value (the
// whole write fails). Stray "" / whitespace-only keys can ride in from
// imported docs — and merging two prospects folds the source's fields
// in wholesale — so scrub them recursively (nested maps and array
// elements included) before every write rather than trusting callers.
function isPlainObject(v) {
  if (!v || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}
function sanitizeFirestoreData(value) {
  if (Array.isArray(value)) return value.map(sanitizeFirestoreData);
  // Only descend into plain object maps. Special Firestore types
  // (Timestamp, GeoPoint, DocumentReference, FieldValue) and Dates must
  // pass through untouched — recursing would strip their prototype and
  // corrupt the stored value.
  if (isPlainObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      if (typeof k !== 'string' || k.trim() === '') continue;
      out[k] = sanitizeFirestoreData(v);
    }
    return out;
  }
  return value;
}

export async function updateProspect(id, updates) {
  await updateDoc(getDoc(id), {
    ...sanitizeFirestoreData(updates || {}),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteProspect(id) {
  await deleteDoc(getDoc(id));
}

function waitFrame() {
  return new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

export async function replaceAllProspects(existingIds, newProspects, onProgress) {
  // Delete the *actual* current documents, not just the caller-supplied
  // IDs. A stale in-memory list — e.g. a re-import that ran before the
  // collection finished loading — previously left old docs behind and
  // wrote a fresh full copy alongside them, doubling the whole
  // collection. Reading the live IDs makes the clear complete and the
  // import idempotent no matter what the caller passes.
  const snap = await getDocs(getCol());
  const idsToDelete = Array.from(new Set([...(existingIds || []), ...snap.docs.map(d => d.id)]));
  const totalSteps = idsToDelete.length + newProspects.length;
  let completed = 0;

  async function report(phase) {
    const pct = Math.round((completed / totalSteps) * 100);
    if (onProgress) onProgress(`${phase} · ${pct}%`);
    // Yield to browser so UI can repaint
    await waitFrame();
  }

  // Delete existing in batches
  for (let i = 0; i < idsToDelete.length; i += 400) {
    const batch = writeBatch(db);
    idsToDelete.slice(i, i + 400).forEach(id => batch.delete(getDoc(id)));
    await batch.commit();
    completed += Math.min(400, idsToDelete.length - i);
    await report('Clearing old data');
  }
  // Add new in batches
  for (let i = 0; i < newProspects.length; i += 400) {
    const batch = writeBatch(db);
    newProspects.slice(i, i + 400).forEach(p => {
      const ref = doc(getCol());
      batch.set(ref, { ...p, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    });
    await batch.commit();
    completed += Math.min(400, newProspects.length - i);
    await report('Writing new data');
  }
  return { deleted: idsToDelete.length, added: newProspects.length };
}

// Fields worth preserving when collapsing duplicate prospects. If the
// keeper is missing one, we backfill it from a duplicate so no data is
// lost when the extra copies are deleted.
const MERGE_FIELDS = [
  'tier', 'status', 'notes', 'website', 'emailDomain', 'zoomCompanyName',
  'hqRegion', 'type', 'cdm', 'geography', 'publicPrivate', 'rank',
  'peAum', 'reAum', 'numberOfSites', 'numberOfAccounts', 'assetTypes', 'frameworks',
];

function isEmptyValue(v) {
  return v === undefined || v === null || v === '' || v === '-'
    || (Array.isArray(v) && v.length === 0);
}

// Rank a prospect by how much useful data it carries so the richest
// record survives a de-dupe. Tier and notes weigh heaviest.
function prospectScore(p) {
  let score = 0;
  if (p.tier && p.tier !== '-') score += 5;
  if (p.notes) score += 3;
  if (p.status) score += 2;
  for (const f of ['website', 'emailDomain', 'zoomCompanyName', 'hqRegion', 'type', 'cdm']) {
    if (!isEmptyValue(p[f])) score += 1;
  }
  if (Array.isArray(p.assetTypes) && p.assetTypes.length) score += 1;
  if (Array.isArray(p.frameworks) && p.frameworks.length) score += 1;
  return score;
}

function createdMillis(p) {
  const c = p.createdAt;
  if (!c) return 0;
  if (typeof c.toMillis === 'function') return c.toMillis();
  if (typeof c.seconds === 'number') return c.seconds * 1000;
  const t = new Date(c).getTime();
  return Number.isFinite(t) ? t : 0;
}

// Group an in-memory prospect array by normalized company name and
// return only the groups with more than one record — i.e. duplicates.
// Pure (no Firestore I/O), so callers that already hold the live list
// from the subscription can detect duplicates for free. Each group is
// sorted richest-first so the first element is the keeper.
export function groupDuplicateProspects(list) {
  const byKey = new Map();
  for (const p of (list || [])) {
    const key = companyDedupeKey(p?.company);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(p);
  }
  const groups = [];
  for (const [key, docs] of byKey) {
    if (docs.length < 2) continue;
    docs.sort((a, b) => {
      const ds = prospectScore(b) - prospectScore(a);
      if (ds !== 0) return ds;
      return createdMillis(a) - createdMillis(b); // tie-break: oldest first
    });
    groups.push({ key, docs });
  }
  return groups;
}

// Collapse the given duplicate groups: keep the richest record, backfill
// any fields it lacks from the copies, then delete the extras. Only
// touches Firestore when there is something to merge or remove.
export async function collapseDuplicateGroups(groups) {
  let removed = 0;
  const merged = [];
  // loser-id → keeper-id for every removed duplicate. Prospect record
  // fields are backfilled onto the keeper below, but ID-keyed maps that
  // live in the *settings* doc (Target Account mappings, divisions, HQ
  // regions) aren't reachable from here — callers use these remaps to move
  // those entries onto the keeper so a mapping stored on a removed copy
  // isn't silently orphaned.
  const remaps = [];
  for (const { docs } of (groups || [])) {
    const keeper = docs[0];
    const losers = docs.slice(1);
    // Backfill empty keeper fields from the duplicates being removed.
    const patch = {};
    for (const field of MERGE_FIELDS) {
      if (!isEmptyValue(keeper[field])) continue;
      for (const l of losers) {
        if (!isEmptyValue(l[field])) { patch[field] = l[field]; break; }
      }
    }
    if (Object.keys(patch).length > 0) await updateProspect(keeper.id, patch);
    for (const l of losers) remaps.push({ from: l.id, to: keeper.id });
    for (let i = 0; i < losers.length; i += 400) {
      const batch = writeBatch(db);
      losers.slice(i, i + 400).forEach(l => batch.delete(getDoc(l.id)));
      await batch.commit();
      removed += Math.min(400, losers.length - i);
    }
    merged.push({ company: keeper.company, removed: losers.length });
  }
  return { groups: groups?.length || 0, removed, merged, remaps };
}

// Read the live collection and return its duplicate groups. Used by the
// on-demand "Remove duplicates" button, which wants fresh server state
// rather than whatever the client currently holds.
export async function findDuplicateProspects() {
  const snap = await getDocs(getCol());
  const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return groupDuplicateProspects(list);
}

// Collapse duplicates by reading fresh from Firestore first. For the
// per-load auto-cleanup, prefer collapseDuplicateGroups() with the
// already-subscribed list so no extra read is incurred.
export async function dedupeProspects() {
  const groups = await findDuplicateProspects();
  return collapseDuplicateGroups(groups);
}

function getAnalysisCol(prospectId) {
  if (_useShared) return collection(db, SHARED_COL, prospectId, 'analyses');
  if (_userId) return collection(db, 'users', _userId, 'prospects', prospectId, 'analyses');
  return collection(db, SHARED_COL, prospectId, 'analyses');
}

// Base64 chars per chunk doc. Base64 is ASCII (1 byte/char) so this stays
// comfortably under Firestore's ~1 MiB per-document cap with room for the
// small field/metadata overhead.
const ANALYSIS_CHUNK_SIZE = 900_000;

// Chunk doc ids carry the generation that wrote them: `chunk-<gen>-<i>`.
//
// They used to be plain `chunk-<i>`, which meant a save that died partway
// left the collection holding a mix of two workbooks — the chunks it managed
// to overwrite, and the older ones it didn't reach. The `main` doc still
// pointed at the previous chunkCount, so the next read reassembled across
// that seam and produced base64 that decoded to a broken zip. The symptom
// was a error from deep inside the xlsx reader ("Bad compressed size:
// 5714 != 6246") with nothing to connect it back to a half-finished upload.
//
// Generation-stamped ids make a partial save inert instead: its chunks are
// under an id no `main` references, so readers keep seeing the last complete
// workbook until a save finishes and swings `main` over to the new
// generation. The stale ones are pruned on the next successful save.
const newAnalysisGen = () => {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID().slice(0, 8);
  } catch { /* fall through to the timestamp form */ }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
};

const analysisChunkId = (gen, i) => (gen ? `chunk-${gen}-${i}` : `chunk-${i}`);

// True for any doc id that is a payload chunk, of any generation — what
// pruning needs in order to recognise the docs it may delete. `main` and
// anything else in the collection are left alone.
const isAnalysisChunkId = (id) => /^chunk-(?:[a-z0-9-]+-)?\d+$/i.test(String(id || ''));

// Base64 length for a payload of `sizeBytes`: 4 characters per 3 bytes,
// padded up. Lets a read check the reassembled string against the size the
// writer recorded without decoding it first.
const base64LenForBytes = (sizeBytes) => Math.ceil(Number(sizeBytes || 0) / 3) * 4;

// Persist an Indicative Savings XLSX (base64) against a prospect. The
// payload is split across sibling `chunk-<i>` docs in the analyses
// subcollection so it can exceed Firestore's ~1 MiB single-document cap;
// the `main` doc holds only metadata + the chunk count. Chunk docs sit
// alongside `main` (not nested under it) so they're covered by the same
// /analyses/{analysisId} security rule — no rules change required.
export async function saveIndicativeAnalysis(prospectId, { fileName, dataBase64, sizeBytes }) {
  const col = getAnalysisCol(prospectId);
  const data = String(dataBase64 || '');
  const gen = newAnalysisGen();
  const chunks = [];
  for (let i = 0; i < data.length; i += ANALYSIS_CHUNK_SIZE) {
    chunks.push(data.slice(i, i + ANALYSIS_CHUNK_SIZE));
  }
  // Learn what's already stored so the previous generation's chunks can be
  // pruned once this one is live.
  const existing = await getDocs(col);
  // Write every chunk first, then the `main` metadata doc LAST, so a live
  // subscriber only reassembles once all referenced chunks exist. Under a
  // fresh generation, so nothing here touches the docs the current `main`
  // points at — if any of these writes fails, the previous analysis is
  // still whole and still what readers get.
  await Promise.all(chunks.map((c, i) => setDoc(doc(col, analysisChunkId(gen, i)), { i, gen, data: c })));
  // setDoc without merge so any legacy inline `dataBase64` on the main doc
  // is dropped when re-saving over an older single-doc analysis.
  await setDoc(doc(col, ANALYSIS_DOC_ID), {
    fileName,
    sizeBytes,
    chunkCount: chunks.length,
    gen,
    capturedAt: serverTimestamp(),
  });
  // Only now that `main` names the new generation is the old one
  // unreferenced. Best-effort: a failure here wastes storage but leaves the
  // analysis readable, so it must not fail the save.
  const stale = existing.docs.filter((d) => isAnalysisChunkId(d.id));
  if (stale.length) {
    await Promise.all(stale.map((d) => deleteDoc(d.ref))).catch((err) => {
      console.warn('Analysis chunk cleanup failed (old chunks left behind):', err);
    });
  }
}

// Metadata-only read of a saved analysis: fetches just the `main` doc and
// never touches the chunk docs, so callers that only need "does an analysis
// exist, and when was it saved" stay at a single document read. Returns
// { fileName, sizeBytes, savedAt } or null when nothing is saved.
export async function getIndicativeAnalysisMeta(prospectId) {
  if (!prospectId) return null;
  const snap = await fsGetDoc(doc(getAnalysisCol(prospectId), ANALYSIS_DOC_ID));
  if (!snap.exists()) return null;
  const meta = snap.data() || {};
  return {
    fileName: meta.fileName || '',
    sizeBytes: Number(meta.sizeBytes) || 0,
    savedAt: meta.capturedAt?.toDate?.()?.toISOString() || null,
  };
}

// One-shot read of a saved analysis, chunks and all. Same reassembly as
// subscribeIndicativeAnalysis, but for callers that want the workbook
// once (e.g. the Utility Lookup page importing a company's saved Master
// Analysis) rather than a live subscription. Returns
// { fileName, sizeBytes, savedAt, dataBase64 } or null when nothing is
// saved against the prospect.
export async function loadIndicativeAnalysis(prospectId) {
  if (!prospectId) return null;
  const col = getAnalysisCol(prospectId);
  const snap = await fsGetDoc(doc(col, ANALYSIS_DOC_ID));
  if (!snap.exists()) return null;
  const meta = snap.data() || {};
  const base = {
    fileName: meta.fileName || '',
    sizeBytes: Number(meta.sizeBytes) || 0,
    savedAt: meta.capturedAt?.toDate?.()?.toISOString() || null,
  };
  // Legacy single-doc format: the whole base64 lived on the main doc.
  if (typeof meta.dataBase64 === 'string') return { ...base, dataBase64: meta.dataBase64 };
  const chunkCount = Number(meta.chunkCount) || 0;
  if (chunkCount === 0) return { ...base, dataBase64: '' };
  // Analyses written before generations are stored under plain `chunk-<i>`.
  const gen = typeof meta.gen === 'string' ? meta.gen : '';
  const all = await getDocs(col);
  const byId = new Map();
  all.forEach((d) => { byId.set(d.id, d.data()?.data || ''); });
  const parts = new Array(chunkCount);
  const missing = [];
  for (let i = 0; i < chunkCount; i++) {
    const part = byId.get(analysisChunkId(gen, i));
    if (!part) missing.push(i + 1);
    parts[i] = part || '';
  }
  // A gap used to join into a shorter string and reach the xlsx reader as a
  // truncated zip, which failed with a byte-count mismatch that said nothing
  // about the real problem. Name it here instead.
  if (missing.length) {
    throw new Error(
      `This company's saved analysis is incomplete — ${missing.length} of its ${chunkCount} parts `
      + `${missing.length === 1 ? 'is' : 'are'} missing (${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}). `
      + 'Re-save it from the Utility Lookup page to replace it.',
    );
  }
  const dataBase64 = parts.join('');
  // Every part present but the total is the wrong length: the stored parts
  // don't add up to the workbook the writer recorded, so decoding would
  // again fail somewhere unhelpful.
  const expected = base64LenForBytes(base.sizeBytes);
  if (base.sizeBytes > 0 && dataBase64.length !== expected) {
    throw new Error(
      `This company's saved analysis is corrupt — it reassembled to ${dataBase64.length} characters `
      + `where ${expected} were expected for a ${base.sizeBytes}-byte workbook. `
      + 'Re-save it from the Utility Lookup page to replace it.',
    );
  }
  return { ...base, dataBase64 };
}

// Live metadata for a prospect's saved analysis — { fileName, sizeBytes,
// capturedAt } — watching only the `main` doc. The chunk docs are never
// touched, so opening a company popup costs one document read no matter how
// large the workbook is; callers fetch the payload with
// loadIndicativeAnalysis() when the user actually asks to download it.
export function subscribeIndicativeAnalysisMeta(prospectId, onChange) {
  const col = getAnalysisCol(prospectId);
  return onSnapshot(doc(col, ANALYSIS_DOC_ID), (snap) => {
    if (!snap.exists()) { onChange(null); return; }
    const meta = snap.data() || {};
    // Legacy single-doc analyses carry the base64 inline; drop it here so a
    // metadata subscription never drags the payload into memory.
    onChange({
      fileName: meta.fileName || '',
      sizeBytes: Number(meta.sizeBytes) || 0,
      capturedAt: meta.capturedAt || null,
    });
  }, (err) => {
    console.error('Firestore analysis subscription error:', err);
  });
}

export async function deleteIndicativeAnalysis(prospectId) {
  const col = getAnalysisCol(prospectId);
  const existing = await getDocs(col);
  if (existing.empty) return;
  const batch = writeBatch(db);
  existing.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

export async function seedProspects(prospects) {
  // Check if collection already has data
  const snap = await getDocs(getCol());
  if (snap.size > 0) return false; // already seeded

  const batch = writeBatch(db);
  for (const prospect of prospects) {
    const ref = doc(getCol());
    batch.set(ref, {
      ...prospect,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  await batch.commit();
  return true;
}

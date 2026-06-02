import { collection, doc, setDoc, updateDoc, deleteDoc, getDocs, writeBatch, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

// Subcollection path for analyses saved against a prospect. Kept
// separate from the prospect doc so the bulk subscribeToProspects
// query stays lean — a 500 KB base64 XLSX would otherwise multiply
// initial-load size across the whole list.
const ANALYSIS_DOC_ID = 'main';

const SHARED_COL = 'prospects';

// Corporate suffixes / structural tokens stripped before comparing two
// company names. Mirrors the normalization used by the My Accounts
// "similar names" detector so the de-dupe collapses exactly the
// records the UI already flags as the same company.
const CORP_SUFFIXES = /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|lp|llp|sa|ag|gmbh|nv|bv|oy|ab|spa|kk|pty|holdings|group|grp)\b\.?/g;

// Normalize a company name to a comparison key: lowercase, drop
// diacritics, strip parentheticals/brackets and corporate suffixes,
// then collapse punctuation to single spaces. "Affinius Capital" and
// "Affinius Capital, a USAA Co." both reduce to "affinius capital".
export function normalizeCompanyName(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/\[.*?\]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(CORP_SUFFIXES, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Pull out and normalize any parenthetical / bracketed qualifier so it can
// be kept as part of a record's identity. normalizeCompanyName() throws
// these away — which is right for stripping noise like "(a USAA Co.)" but
// wrong when the qualifier is the ONLY thing distinguishing two records,
// e.g. "Brookfield (Dubai)" vs "Brookfield (NAM Multifamily)". Corporate
// suffixes inside the qualifier are still removed so an ownership note like
// "(a Brookfield Co.)" collapses to "brookfield" rather than surviving as
// junk. Returns '' when there is no meaningful qualifier.
export function companyQualifier(s) {
  const parts = [];
  const re = /[([]([^)\]]*)[)\]]/g;
  let m;
  while ((m = re.exec(String(s || ''))) !== null) {
    const tag = String(m[1] || '')
      .toLowerCase()
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/&/g, ' and ')
      .replace(CORP_SUFFIXES, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (tag) parts.push(tag);
  }
  return parts.sort().join(' ');
}

// The key two records must share to be treated as the SAME company. It is
// the normalized base name plus any parenthetical qualifier, so records
// that differ only by a corporate suffix still merge ("Brookfield Inc." ==
// "Brookfield"), but records distinguished solely by a region/segment tag
// stay separate ("Brookfield (Dubai)" != "Brookfield (NAM Multifamily)").
export function companyDedupeKey(s) {
  const base = normalizeCompanyName(s);
  if (!base) return '';
  const qual = companyQualifier(s);
  return qual ? `${base}|${qual}` : base;
}

// Admin uses the shared collection; everyone else gets their own
let _userId = null;
let _useShared = false;

export function setProspectsUser(uid, email) {
  _userId = uid;
  _useShared = (email === 'baldaufdan@gmail.com');
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
    ...prospect,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateProspect(id, updates) {
  // Firestore rejects undefined values outright (the whole write fails).
  // Strip them so a stray undefined on one field can't block the rest of the save.
  const clean = {};
  for (const [k, v] of Object.entries(updates || {})) {
    if (v !== undefined) clean[k] = v;
  }
  await updateDoc(getDoc(id), {
    ...clean,
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
    if (onProgress) onProgress(`${phase} — ${pct}%`);
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
  'peAum', 'reAum', 'numberOfSites', 'assetTypes', 'frameworks',
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
    for (let i = 0; i < losers.length; i += 400) {
      const batch = writeBatch(db);
      losers.slice(i, i + 400).forEach(l => batch.delete(getDoc(l.id)));
      await batch.commit();
      removed += Math.min(400, losers.length - i);
    }
    merged.push({ company: keeper.company, removed: losers.length });
  }
  return { groups: groups?.length || 0, removed, merged };
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

function getAnalysisDoc(prospectId) {
  if (_useShared) return doc(db, SHARED_COL, prospectId, 'analyses', ANALYSIS_DOC_ID);
  if (_userId) return doc(db, 'users', _userId, 'prospects', prospectId, 'analyses', ANALYSIS_DOC_ID);
  return doc(db, SHARED_COL, prospectId, 'analyses', ANALYSIS_DOC_ID);
}

export async function saveIndicativeAnalysis(prospectId, { fileName, dataBase64, sizeBytes }) {
  await setDoc(getAnalysisDoc(prospectId), {
    fileName,
    dataBase64,
    sizeBytes,
    capturedAt: serverTimestamp(),
  });
}

export function subscribeIndicativeAnalysis(prospectId, onChange) {
  return onSnapshot(getAnalysisDoc(prospectId), (snap) => {
    onChange(snap.exists() ? snap.data() : null);
  }, (err) => {
    console.error('Firestore analysis subscription error:', err);
  });
}

export async function deleteIndicativeAnalysis(prospectId) {
  await deleteDoc(getAnalysisDoc(prospectId));
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

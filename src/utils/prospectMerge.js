// Which of two records for the same company wins, and what a bulk import
// should do to the roster. Pure — no Firestore, no React — so
// scripts/prospectMerge.test.mjs can exercise the rules directly.
//
// Split out of firestoreSync because the CSV import needs the same
// "richest record survives" ranking the duplicate collapse uses, and a
// second copy of that rule is how the importers drifted apart before.

import { companyDedupeKey } from './companyKey.js';

// Fields worth preserving when collapsing duplicate prospects. If the
// keeper is missing one, we backfill it from a duplicate so no data is
// lost when the extra copies are deleted.
export const MERGE_FIELDS = [
  'tier', 'status', 'notes', 'website', 'emailDomain', 'zoomCompanyName',
  'hqRegion', 'type', 'cdm', 'geography', 'publicPrivate', 'rank',
  'peAum', 'reAum', 'numberOfSites', 'numberOfAccounts', 'assetTypes', 'frameworks',
];

export function isEmptyValue(v) {
  return v === undefined || v === null || v === '' || v === '-'
    || (Array.isArray(v) && v.length === 0);
}

// Rank a prospect by how much useful data it carries so the richest
// record survives a de-dupe. Tier and notes weigh heaviest.
export function prospectScore(p) {
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

export function createdMillis(p) {
  const c = p?.createdAt;
  if (!c) return 0;
  if (typeof c.toMillis === 'function') return c.toMillis();
  if (typeof c.seconds === 'number') return c.seconds * 1000;
  const t = new Date(c).getTime();
  return Number.isFinite(t) ? t : 0;
}

// What a full CSV import should do to the roster.
//
// This used to be a straight replace: delete every document, then write
// the uploaded rows as new ones. Two things made that quietly expensive.
//
// Every record got a NEW document id — and settings.targetMap,
// divisionsMap and hqRegionMap are all keyed by document id, so one
// upload orphaned every Target Account mapping, division and HQ region on
// the roster at once. Nothing could repair it afterwards either: orphaned
// mappings are not duplicates, so the duplicate collapse has nothing to
// merge. That is the "No Target Mapped" cliff, from one click.
//
// And the uploaded rows were never compared with each other, so two
// spellings of one company in the same file became two accounts.
//
// So: match incoming rows to the records already there by the same key
// everything else uses, and keep those records' ids. A company in both is
// UPDATED in place; a company only in the file is created; a company only
// on the roster is removed, because that is what "import this file as the
// roster" means.
//
// Returns { updates, creates, deletes, remaps, counts }. `updates` carries
// the existing id so the caller can write onto it; `remaps` is
// loser-id → keeper-id for records that were already duplicates of each
// other, so their id-keyed settings can move rather than orphan.
export function planProspectReconcile(incoming, existing) {
  const rows = (incoming || []).filter(r => companyDedupeKey(r?.company));

  // Collapse the file against itself first: two spellings of one company
  // in one upload are one company. First occurrence wins the slot.
  const byKey = new Map();
  let collapsed = 0;
  for (const row of rows) {
    const key = companyDedupeKey(row.company);
    if (byKey.has(key)) { collapsed++; continue; }
    byKey.set(key, row);
  }

  // Existing records grouped by the same key. More than one means the
  // roster already held duplicates of that company.
  const existingByKey = new Map();
  for (const doc of (existing || [])) {
    const key = companyDedupeKey(doc?.company);
    if (!key) continue;
    if (!existingByKey.has(key)) existingByKey.set(key, []);
    existingByKey.get(key).push(doc);
  }

  const updates = [];
  const creates = [];
  const deletes = [];
  const remaps = [];

  for (const [key, row] of byKey) {
    const matches = existingByKey.get(key);
    if (!matches || !matches.length) { creates.push(row); continue; }
    // Same rule as the duplicate collapse: richest record survives,
    // oldest wins a tie.
    const ranked = [...matches].sort((a, b) => {
      const ds = prospectScore(b) - prospectScore(a);
      return ds !== 0 ? ds : createdMillis(a) - createdMillis(b);
    });
    const keeper = ranked[0];
    updates.push({ id: keeper.id, record: row });
    for (const loser of ranked.slice(1)) {
      deletes.push(loser.id);
      remaps.push({ from: loser.id, to: keeper.id });
    }
  }

  // On the roster but not in the file.
  for (const [key, docs] of existingByKey) {
    if (byKey.has(key)) continue;
    for (const doc of docs) deletes.push(doc.id);
  }

  // Records with no usable company name at all: not addressable by key,
  // so an import can neither match nor keep them.
  for (const doc of (existing || [])) {
    if (!companyDedupeKey(doc?.company)) deletes.push(doc.id);
  }

  return {
    updates,
    creates,
    deletes,
    remaps,
    counts: {
      updated: updates.length,
      created: creates.length,
      deleted: deletes.length,
      collapsed,
      mappingsMoved: remaps.length,
      skipped: (incoming || []).length - rows.length,
    },
  };
}

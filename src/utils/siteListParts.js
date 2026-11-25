// A company's site list across more than one Firestore document.
//
// A list is one document per company (companySiteListsStore), and Firestore
// refuses a document over 1 MiB. A big portfolio is far past that: 11,000
// sites with the analysis columns "Save to <company>" adds come to about
// 20 MB, so its list could never be saved at all. A list that does not fit
// now keeps its company, file name and headers on the company's own
// document and its rows in part documents beside it:
//
//   companySiteLists/acme-inc           { ...entry, rows: [], partCount: 3, partsVersion }
//   companySiteLists/acme-inc__part-0   { partOf: 'acme-inc', partIndex: 0, partsVersion, rows }
//   companySiteLists/acme-inc__part-1   ...
//
// A list that fits is stored exactly as before, as one document with no
// part fields, so nothing changes for the lists that already worked.
// companySlug() yields [a-z0-9-] only, so "__part-" can never be part of a
// company's own slug.
//
// The parts sit in the same collection as the lists (rather than under
// each list's document) so the one collection listener that already
// delivers every list sees them change too. Readers get the list folded
// back together and never see the part fields.
//
// Pure, for scripts/siteListParts.test.mjs.

import { valueBytes } from './settingsDocSize.js';

const PART_MARK = '__part-';

// Rows per part document are packed up to this many bytes: well under the
// 1 MiB cap, so the part's own fields and Firestore's overhead never tip
// it over.
export const SITE_LIST_PART_BYTES = 700_000;

/** The document id of a company's `index`th part. */
export function partDocId(slug, index) {
  return `${slug}${PART_MARK}${index}`;
}

/** The company slug a part document belongs to, or null for a list's own document. */
export function partOwner(id) {
  const s = String(id || '');
  const at = s.lastIndexOf(PART_MARK);
  if (at <= 0) return null;
  return /^\d+$/.test(s.slice(at + PART_MARK.length)) ? s.slice(0, at) : null;
}

/** How many part documents a stored list document says it has. */
export function partCountOf(data) {
  const n = Number(data?.partCount);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/**
 * The documents one company's list is stored as: `main` for the company's
 * own document and `parts` (the part documents' data, in order). A list
 * that fits in `maxBytes` is its own document with no parts.
 *
 * `version` tags the main document and its parts alike, so a reader that
 * catches a save halfway (new parts, old main, or the other way round)
 * can tell the pieces do not belong together.
 */
export function splitSiteListEntry(slug, entry, { maxBytes = SITE_LIST_PART_BYTES, version = String(Date.now()) } = {}) {
  const clean = { ...(entry || {}) };
  delete clean.partCount;
  delete clean.partsVersion;
  const rows = Array.isArray(clean.rows) ? clean.rows : [];
  if (valueBytes(clean) <= maxBytes) return { main: clean, parts: [] };

  const parts = [];
  let current = [];
  let bytes = 0;
  for (const row of rows) {
    const size = valueBytes(row) + 2;
    if (current.length && bytes + size > maxBytes) {
      parts.push(current);
      current = [];
      bytes = 0;
    }
    current.push(row);
    bytes += size;
  }
  if (current.length) parts.push(current);
  return {
    main: { ...clean, rows: [], partCount: parts.length, partsVersion: version },
    parts: parts.map((partRows, partIndex) => ({ partOf: slug, partIndex, partsVersion: version, rows: partRows })),
  };
}

/**
 * Every company's list from the documents in the collection (id → data),
 * with each split list's rows put back together in order and the part
 * fields dropped. A part from another save than its list's main document
 * (a save still landing) is left out rather than mixed in.
 */
export function foldSiteListDocs(docs) {
  const mains = {};
  const partsBy = {};
  for (const [id, data] of Object.entries(docs || {})) {
    if (!data || typeof data !== 'object') continue;
    const owner = partOwner(id);
    if (owner) (partsBy[owner] ||= []).push(data);
    else mains[id] = data;
  }
  const out = {};
  for (const [slug, data] of Object.entries(mains)) {
    const count = partCountOf(data);
    if (!count) { out[slug] = data; continue; }
    const entry = { ...data };
    delete entry.partCount;
    delete entry.partsVersion;
    const parts = (partsBy[slug] || [])
      .filter(p => p.partsVersion === data.partsVersion && Number(p.partIndex) < count)
      .sort((a, b) => Number(a.partIndex) - Number(b.partIndex));
    entry.rows = parts.flatMap(p => (Array.isArray(p.rows) ? p.rows : []));
    out[slug] = entry;
  }
  return out;
}

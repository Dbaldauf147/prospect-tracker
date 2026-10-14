// Which rows of an uploaded list (Lists → SBT, CA SB, ...) or RA Clients
// are a given company: mapped to it, or a fuzzy name match nobody has
// mapped elsewhere or dismissed. Shared by the "Search lists..." panel and
// the list-match warning strips on the company modal, so the two always
// agree on what counts as a match.
import { normalizeCompany, pickNameKey } from './companyNorm.js';
import { readListField } from './listAccountMapping.js';

// Extract a company name per row using the same header-detection the
// uploaded-list scan uses. Kept separate so non-IDB sources (RA Clients)
// can reuse the mapping/scoring pipeline below with names they already hold.
export function namesFromRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const headers = [];
  const seen = new Set();
  for (const r of rows) for (const k of Object.keys(r)) {
    if (!seen.has(k)) { seen.add(k); headers.push(k); }
  }
  const nameKey = pickNameKey(headers);
  return rows.map(r => (nameKey ? String(r[nameKey] || '') : ''));
}

function fuzzyScore(rowNorm, prospectNorm) {
  if (!rowNorm || !prospectNorm) return 0;
  if (rowNorm === prospectNorm) return 1;
  if (rowNorm.length < 3 || prospectNorm.length < 3) return 0;
  if (!rowNorm.includes(prospectNorm) && !prospectNorm.includes(rowNorm)) return 0;
  const shorter = Math.min(rowNorm.length, prospectNorm.length);
  const longer = Math.max(rowNorm.length, prospectNorm.length);
  return longer > 0 ? shorter / longer : 0;
}

// For one source: given its flat list of company names, read
// mapping/dismissed state and return the entries that either already map to
// this prospect or fuzzy match its company name. We dedupe by matchKey so a
// re-upload with row reordering doesn't double-count.
export function buildItems(storageKey, names, prospectCompany, settings) {
  const prospectNorm = normalizeCompany(prospectCompany || '');
  if (!prospectNorm || !Array.isArray(names) || names.length === 0) return [];

  const mapping = readListField(settings, storageKey, 'mapping');
  const dismissed = readListField(settings, storageKey, 'dismissed');

  const seenKeys = new Set();
  const items = [];
  names.forEach((rawName, i) => {
    const norm = normalizeCompany(rawName);
    const matchKey = norm ? `name::${norm}` : `row::${i}`;
    if (seenKeys.has(matchKey)) return;
    seenKeys.add(matchKey);

    const mappedTo = mapping[matchKey] || '';
    const mappedNorm = normalizeCompany(mappedTo);
    const alreadyMapped = mappedNorm && mappedNorm === prospectNorm;
    const score = fuzzyScore(norm, prospectNorm);

    if (alreadyMapped) {
      items.push({ matchKey, rawName, mappedTo, score: 1, state: 'mapped' });
      return;
    }
    if (dismissed[matchKey]) return;
    if (mappedTo) return; // mapped to a different prospect — leave alone
    if (score >= 0.5) {
      items.push({ matchKey, rawName, mappedTo: '', score, state: 'suggested' });
    }
  });
  items.sort((a, b) => b.score - a.score || (a.rawName || '').localeCompare(b.rawName || ''));
  return items;
}


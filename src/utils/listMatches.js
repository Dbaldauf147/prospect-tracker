// Which rows of an uploaded list (Lists → SBT, CA SB, ...) or RA Clients
// are a given company: mapped to it, or a fuzzy name match nobody has
// mapped elsewhere or dismissed. Shared by the "Search lists..." panel and
// the list-match warning strips on the company modal, so the two always
// agree on what counts as a match.
import { normalizeCompany, pickNameKey } from './companyNorm.js';
import { readListField } from './listAccountMapping.js';
import { similarityTokens, tokenSimilarity } from './targetAccountMatch.js';

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

// How alike a list row's name is to the company, 0..1. Two measures, the
// better one wins:
//   - one name inside the other ("Prologis" / "Prologis Logistics"),
//     scored by how much of the longer one it covers
//   - word by word, a typo per word allowed ("Marriot International" /
//     "Marriott International"), plus singular/plural, the same matcher
//     the Target Accounts suggestions use (utils/targetAccountMatch.js)
//   - the first, with the spaces taken out, for punctuation that splits a
//     word ("Kohl's" / "Kohls", "Wal-Mart" / "Walmart"); only for names of
//     five letters or more, so a short one doesn't turn up inside an
//     unrelated longer word
// Only names that normalise to the same string score 1, so the warning's
// "exact" means exact; anything else tops out at 0.95, a strong suggestion
// rather than a certainty.
function matchScore(row, prospect) {
  if (!row.norm || !prospect.norm) return 0;
  if (row.norm === prospect.norm) return 1;
  const flat = Math.min(row.flat.length, prospect.flat.length) >= 5 ? fuzzyScore(row.flat, prospect.flat) : 0;
  // The word-by-word match needs the first words to agree, typo aside, and
  // a typo almost never changes a first letter: checking that first skips
  // the edit-distance work on nearly every row of a long list.
  const sameStart = row.tokens.length > 0 && prospect.tokens.length > 0 && row.tokens[0][0] === prospect.tokens[0][0];
  const words = sameStart ? tokenSimilarity(row.tokens, prospect.tokens) : 0;
  const best = Math.max(fuzzyScore(row.norm, prospect.norm), flat, words);
  return Math.min(best, 0.95);
}

// The comparable forms of a name, worked out once.
function prepare(rawName) {
  const norm = normalizeCompany(rawName);
  return { norm, key: norm ? `name::${norm}` : '', flat: norm.replace(/ /g, ''), tokens: similarityTokens(rawName) };
}

// A list's names prepared once per list array rather than on every call:
// the warning strips rerun the match whenever settings change, and the
// SBT list alone is thousands of rows.
const preparedLists = new WeakMap();
function preparedNames(names) {
  let out = preparedLists.get(names);
  if (!out) {
    out = names.map(prepare);
    preparedLists.set(names, out);
  }
  return out;
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
// this prospect or fuzzy match its company name (matchScore >= 0.5). We dedupe by matchKey so a
// re-upload with row reordering doesn't double-count.
export function buildItems(storageKey, names, prospectCompany, settings) {
  const prospectNorm = normalizeCompany(prospectCompany || '');
  if (!prospectNorm || !Array.isArray(names) || names.length === 0) return [];

  const mapping = readListField(settings, storageKey, 'mapping');
  const dismissed = readListField(settings, storageKey, 'dismissed');

  const prospect = prepare(prospectCompany);
  const prepared = preparedNames(names);
  const seenKeys = new Set();
  const items = [];
  names.forEach((rawName, i) => {
    const row = prepared[i];
    const matchKey = row.key || `row::${i}`;
    if (seenKeys.has(matchKey)) return;
    seenKeys.add(matchKey);

    const mappedTo = mapping[matchKey] || '';
    const alreadyMapped = !!mappedTo && normalizeCompany(mappedTo) === prospectNorm;

    if (alreadyMapped) {
      items.push({ matchKey, rawName, mappedTo, score: 1, state: 'mapped' });
      return;
    }
    if (dismissed[matchKey]) return;
    if (mappedTo) return; // mapped to a different prospect — leave alone
    const score = matchScore(row, prospect);
    if (score >= 0.5) {
      items.push({ matchKey, rawName, mappedTo: '', score, state: 'suggested' });
    }
  });
  items.sort((a, b) => b.score - a.score || (a.rawName || '').localeCompare(b.rawName || ''));
  return items;
}


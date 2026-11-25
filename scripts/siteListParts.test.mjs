// A site list too big for one Firestore document, stored in parts and
// read back whole. Run:
//   node scripts/siteListParts.test.mjs
import {
  splitSiteListEntry, foldSiteListDocs, partDocId, partOwner, partCountOf, SITE_LIST_PART_BYTES,
} from '../src/utils/siteListParts.js';
import { valueBytes, FIRESTORE_DOC_LIMIT } from '../src/utils/settingsDocSize.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e.slice(0, 300)}\n        got      ${a.slice(0, 300)}`); }
}

// About the shape of a big portfolio saved from the Utility Lookup: 64
// columns a row.
const headers = Array.from({ length: 64 }, (_, i) => `Column number ${i}`);
const listOf = (n) => ({
  company: 'Brookfield Asset Management',
  fileName: 'Saved from Utility Look Up',
  headers,
  rows: Array.from({ length: n }, (_, r) => Object.fromEntries(headers.map((h, c) => [h, c === 0 ? `Site ${r}` : `value ${r}-${c}`]))),
  uploadedAt: '2026-11-25T18:00:00.000Z',
});
const docsOf = (slug, { main, parts }) => {
  const docs = { [slug]: main };
  parts.forEach((p, i) => { docs[partDocId(slug, i)] = p; });
  return docs;
};

// Ids
eq(partDocId('acme-inc', 3), 'acme-inc__part-3', 'part id');
eq(partOwner('acme-inc__part-3'), 'acme-inc', 'part owner');
eq([partOwner('acme-inc'), partOwner('__part-1'), partOwner('acme__part-x')], [null, null, null], 'a list id is not a part');
eq([partCountOf({ partCount: 4 }), partCountOf({}), partCountOf({ partCount: -1 })], [4, 0, 0], 'part count');

// A list that fits is stored exactly as it was.
const small = listOf(20);
const smallSplit = splitSiteListEntry('small-co', small);
eq(smallSplit.parts.length, 0, 'a small list has no parts');
eq(smallSplit.main, small, 'a small list is stored unchanged');
eq(foldSiteListDocs({ 'small-co': small }), { 'small-co': small }, 'and read back unchanged');

// A big one is split, every document under the cap, and read back whole.
const big = listOf(11264);
const bigSplit = splitSiteListEntry('brookfield-asset-management', big, { version: 'v1' });
console.log(`      ${big.rows.length} rows, ${(valueBytes(big) / 1048576).toFixed(1)} MB -> ${bigSplit.parts.length} parts`);
eq(bigSplit.parts.length > 1, true, 'a big list is split');
eq(bigSplit.main.rows, [], 'the main document holds no rows');
eq([bigSplit.main.partCount, bigSplit.main.partsVersion, bigSplit.main.company], [bigSplit.parts.length, 'v1', big.company], 'the main document says how many parts and which save');
eq(bigSplit.parts.every(p => valueBytes(p) < SITE_LIST_PART_BYTES + 10_000), true, 'every part is near the part budget');
eq(valueBytes(bigSplit.main) < FIRESTORE_DOC_LIMIT && bigSplit.parts.every(p => valueBytes(p) < FIRESTORE_DOC_LIMIT), true, 'every document is under the Firestore cap');
const folded = foldSiteListDocs(docsOf('brookfield-asset-management', bigSplit));
eq(folded['brookfield-asset-management'], big, 'read back whole, in order, with no part fields');

// Splitting what was read back gives the same documents again.
eq(splitSiteListEntry('brookfield-asset-management', folded['brookfield-asset-management'], { version: 'v1' }), bigSplit, 'round trip is stable');

// Parts are read in index order whatever order the documents arrive in.
const shuffled = Object.fromEntries(Object.entries(docsOf('b', splitSiteListEntry('b', big, { version: 'v1' }))).reverse());
eq(foldSiteListDocs(shuffled).b.rows.length, big.rows.length, 'parts out of order still fold');
eq(foldSiteListDocs(shuffled).b.rows[0], big.rows[0], 'first row first');

// A save caught halfway: parts from a different save are left out, and a
// stale part beyond the count is ignored.
const v2 = splitSiteListEntry('b', listOf(6000), { version: 'v2' });
const mixed = { ...docsOf('b', splitSiteListEntry('b', big, { version: 'v1' })), b: v2.main };
eq(foldSiteListDocs(mixed).b.rows.length, 0, 'parts from another save are not mixed in');
const leftover = { ...docsOf('b', splitSiteListEntry('b', big, { version: 'v2' })), ...docsOf('b', v2) };
eq(foldSiteListDocs(leftover).b.rows.length, 6000, 'a part past the count is ignored');

// Other companies in the same collection are untouched, and an orphan
// part with no list is not a company.
const all = { ...docsOf('b', bigSplit), 'small-co': small, [partDocId('gone-co', 0)]: { partOf: 'gone-co', partIndex: 0, rows: [{ a: 1 }] } };
eq(Object.keys(foldSiteListDocs(all)).sort(), ['b', 'small-co'], 'only lists come back, parts are folded or dropped');

// Splitting an entry that already carries part fields does not keep them.
eq(splitSiteListEntry('x', { ...small, partCount: 3, partsVersion: 'old' }).main, small, 'stale part fields are dropped');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

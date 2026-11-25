// A big company site list written, read, shrunk, replaced and removed
// through the store, against the Firestore stub. The split itself is
// scripts/siteListParts.test.mjs; this is the documents that land.
// Run: node scripts/companySiteListParts.test.mjs
import { register } from 'node:module';
register('./stubs/loader.mjs', import.meta.url);

const fs = await import('./stubs/firestore.mjs');
const { applySiteListOps, readCompanySiteLists } = await import('../src/utils/companySiteListsStore.js');
const { valueBytes, FIRESTORE_DOC_LIMIT } = await import('../src/utils/settingsDocSize.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}

const COL = 'userSettings/u1/companySiteLists';
const ids = () => [...fs.store.keys()].filter(k => k.startsWith(`${COL}/`)).map(k => k.slice(COL.length + 1)).sort();
const headers = Array.from({ length: 64 }, (_, i) => `Column number ${i}`);
const listOf = (n, tag = 'a') => ({
  company: 'Brookfield Asset Management',
  fileName: 'Saved from Utility Look Up',
  headers,
  rows: Array.from({ length: n }, (_, r) => Object.fromEntries(headers.map((h, c) => [h, `${tag} ${r}-${c}`]))),
  uploadedAt: '2026-11-25T18:00:00.000Z',
});

fs.reset();
await applySiteListOps('u1', [{ slug: 'small-co', value: listOf(10) }]);
ok(JSON.stringify(ids()) === '["small-co"]', 'a small list is one document, as before');
ok(!('partCount' in fs.store.get(`${COL}/small-co`)), 'with no part fields');

const big = listOf(11264);
await applySiteListOps('u1', [{ slug: 'brookfield', value: big }]);
const parts = ids().filter(id => id.startsWith('brookfield__part-'));
ok(parts.length > 20, `an 11,264-site list is stored in parts (${parts.length})`);
ok([...fs.store.entries()].filter(([k]) => k.startsWith(COL)).every(([, v]) => valueBytes(v) < FIRESTORE_DOC_LIMIT), 'every document is under the Firestore cap');
ok(fs.store.get(`${COL}/brookfield`).partCount === parts.length, 'the company document counts them');

let read = await readCompanySiteLists('u1');
ok(JSON.stringify(read.brookfield) === JSON.stringify(big), 'read back whole (all companies)');
ok(JSON.stringify(read['small-co']) === JSON.stringify(listOf(10)), 'the small list alongside it is untouched');
read = await readCompanySiteLists('u1', ['brookfield']);
ok(JSON.stringify(read.brookfield) === JSON.stringify(big), 'read back whole (one company)');

// A smaller re-save drops the parts it no longer needs.
const smaller = listOf(3000, 'b');
await applySiteListOps('u1', [{ slug: 'brookfield', value: smaller }]);
const after = ids().filter(id => id.startsWith('brookfield__part-'));
ok(after.length === fs.store.get(`${COL}/brookfield`).partCount && after.length < parts.length, 'a smaller save removes the leftover parts');
read = await readCompanySiteLists('u1', ['brookfield']);
ok(JSON.stringify(read.brookfield) === JSON.stringify(smaller), 'and reads back as the new list');

// Shrinking to one document drops every part.
await applySiteListOps('u1', [{ slug: 'brookfield', value: listOf(5, 'c') }]);
ok(JSON.stringify(ids()) === '["brookfield","small-co"]', 'a list that fits again leaves no parts behind');

// Removing a split list removes its parts.
await applySiteListOps('u1', [{ slug: 'brookfield', value: big }]);
await applySiteListOps('u1', [{ slug: 'brookfield', value: null }]);
ok(JSON.stringify(ids()) === '["small-co"]', 'deleting a split list deletes its parts');

// Replace-all (a settings restore) keeps a split list whole and drops the
// companies, and their parts, that are not in it.
await applySiteListOps('u1', [{ slug: 'brookfield', value: big }]);
await applySiteListOps('u1', [{ replaceAll: { 'other-co': listOf(4000, 'd') } }]);
ok(ids().every(id => id === 'other-co' || id.startsWith('other-co__part-')), 'replace-all drops other companies and their parts');
read = await readCompanySiteLists('u1');
ok(Object.keys(read).join() === 'other-co' && read['other-co'].rows.length === 4000, 'and stores the new set whole');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

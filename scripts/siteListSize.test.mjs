// Issues-tab warnings for site lists near or over the size one can be
// saved at, and for a site-list save that failed. Run:
//   node scripts/siteListSize.test.mjs
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};
const { oversizedSiteLists, siteListSizeIssues, siteListBytes, SITE_LIST_WARN_BYTES, SITE_LIST_LIMIT_BYTES } = await import('../src/utils/siteListSize.js');
const { setUserLsUserId } = await import('../src/utils/userLs.js');
const { markLocalOnly, loadLocalOnlyFiles, localOnlyFileIssues } = await import('../src/utils/localOnlyFiles.js');
setUserLsUserId('u1');

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// A list of `n` rows, each about 200 bytes.
const listOf = (company, n) => ({
  company, fileName: `${company}.xlsx`, headers: ['Address', 'City'],
  rows: Array.from({ length: n }, (_, i) => ({ Address: `${i} ${'x'.repeat(170)}`, City: 'Springfield' })),
});
const per = siteListBytes(listOf('A', 1000)) / 1000;
const rowsFor = (bytes) => Math.ceil(bytes / per);

const lists = {
  small: listOf('Small Co', 50),
  near: listOf('Near Co', rowsFor(SITE_LIST_WARN_BYTES) + 20),
  over: listOf('Over Co', rowsFor(SITE_LIST_LIMIT_BYTES) + 20),
};
const big = oversizedSiteLists(lists);
eq(big.map(l => l.slug), ['over', 'near'], 'only the big lists, biggest first');
eq(big.every(l => l.rows > 0 && l.bytes > 0), true, 'carries rows and bytes');

const rows = siteListSizeIssues(big, { prospects: [{ id: 'p1', company: 'Near Co' }] });
eq(rows.map(r => [r.id, r.type, r.company, r.prospectId]), [
  ['site-list-size:over:over', 'Site list too big to save', 'Over Co', null],
  ['site-list-size:near:near', 'Site list near size limit', 'Near Co', null],
], 'over / near rows');
const rows2 = siteListSizeIssues(oversizedSiteLists({ 'near-co': lists.near }), { prospects: [{ id: 'p1', company: 'Near Co' }] });
eq(rows2[0].prospectId, 'p1', 'links the company card by slug');
eq(/Saves to it will fail/.test(rows[0].detail) && /Once it is full/.test(rows[1].detail), true, 'detail says what happens');
eq(oversizedSiteLists(null), [], 'no lists, no rows');

markLocalOnly('siteList:acme', { kind: 'siteList', reason: 'too-big', name: 'Acme sites.xlsx', sizeBytes: 1.2e6, limitBytes: SITE_LIST_LIMIT_BYTES, owner: 'Acme', error: 'invalid-argument' });
markLocalOnly('siteList:globex', { kind: 'siteList', reason: 'backup-failed', owner: 'globex', error: 'unavailable' });
const failedRows = localOnlyFileIssues(loadLocalOnlyFiles(), { prospects: [{ id: 'g1', company: 'Globex' }] });
eq(failedRows.map(r => [r.source, r.type, r.company, r.prospectId]), [
  ['Site lists', 'Site list not saved', 'Acme', null],
  ['Site lists', 'Site list not saved', 'Globex', 'g1'],
], 'failed saves are listed under Site lists');
eq(failedRows[0].detail, 'The last save of the site list "Acme sites.xlsx" (1.1 MB) failed: it is over the 1.0 MB one site list can hold. The change was only in the tab you made it in, so a refresh loses it. Make the list smaller, then save it again from Company card > Site list.', 'too-big detail');
eq(failedRows[1].detail, 'The last save of this site list failed: the save was refused (unavailable). The change was only in the tab you made it in, so a refresh loses it. Save it again from Company card > Site list.', 'failed detail');
eq([...rows, ...failedRows].every(r => !/—/.test(r.detail)), true, 'no em dashes in the copy');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

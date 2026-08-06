// Assertion tests for the site-list write routing and the settings
// document sizer. Plain Node — no test framework (the project has none).
// Run:
//   node scripts/companySiteListRouting.test.mjs
//
// These rules decide where a company's uploaded spreadsheet is stored. A
// path that fails to route lands back on the settings document, which is
// the 1 MB overflow this whole change exists to stop; a path that routes
// when it shouldn't sends an unrelated setting into the site-list
// subcollection, where nothing will ever read it again.
import {
  SITE_LISTS_KEY, isStorableSlug, slugsForOps, splitSiteListPaths, splitSiteListUpdates,
} from '../src/utils/companySiteListRouting.js';
import {
  SETTINGS_SIZE_BUDGET, settingsDocReport, valueBytes,
} from '../src/utils/settingsDocSize.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
function ok(cond, name) { eq(!!cond, true, name); }

// --- path splitting ------------------------------------------------------
{
  const { ops, rest } = splitSiteListPaths({
    'companySiteLists.acme-inc': { rows: [1] },
    'companyRevenueResearch.acme-inc': { revenue: 5 },
    workEmail: 'a@b.com',
  });
  eq(ops, [{ slug: 'acme-inc', value: { rows: [1] } }], 'a site-list path routes to its company');
  eq(rest, { 'companyRevenueResearch.acme-inc': { revenue: 5 }, workEmail: 'a@b.com' },
    'everything else stays on the settings document');
}

{
  const { ops } = splitSiteListPaths({ 'companySiteLists.acme-inc': null });
  eq(ops, [{ slug: 'acme-inc', value: null }], 'a null value is a delete, not a write');
}

{
  const { ops } = splitSiteListPaths({ 'companySiteLists.acme-inc.fileName': 'q1.xlsx' });
  eq(ops, [{ slug: 'acme-inc', paths: { fileName: 'q1.xlsx' } }],
    'a path inside one company patches that company only');
}

{
  const { ops } = splitSiteListPaths({ 'companySiteLists.acme-inc.meta.source': 'paste' });
  eq(ops, [{ slug: 'acme-inc', paths: { 'meta.source': 'paste' } }],
    'a deeper path keeps its remaining dots');
}

{
  // A rename moves the list to the new slug and drops the old one, both
  // in a single write (ProspectModal's migrateCompanyData).
  const { ops, rest } = splitSiteListPaths({
    'companySiteLists.acme-corp': { rows: ['x'] },
    'companySiteLists.acme-inc': null,
    'companyOpportunities.acme-corp': [],
  });
  eq(ops, [
    { slug: 'acme-corp', value: { rows: ['x'] } },
    { slug: 'acme-inc', value: null },
  ], 'a rename routes both halves');
  eq(Object.keys(rest), ['companyOpportunities.acme-corp'], 'the rename leaves other keys alone');
}

{
  // A key that merely starts with the same letters is not a site list.
  const { ops, rest } = splitSiteListPaths({ companySiteListsBackup: { a: 1 } });
  eq(ops, [], 'a key that only shares a prefix is not routed');
  eq(rest, { companySiteListsBackup: { a: 1 } }, 'it stays on the settings document');
}

// --- whole-key writes (a settings restore) -------------------------------
{
  const { ops, rest } = splitSiteListUpdates({
    [SITE_LISTS_KEY]: { 'acme-inc': { rows: [] } },
    orgCharts: {},
  });
  eq(ops, [{ replaceAll: { 'acme-inc': { rows: [] } } }],
    'writing the whole key replaces the whole set');
  eq(rest, { orgCharts: {} }, 'the rest of the restore still goes to the document');
  eq(slugsForOps(ops), null, 'a replaceAll means every company has to be read');
}

{
  const { ops } = splitSiteListUpdates({ [SITE_LISTS_KEY]: null });
  eq(ops, [{ replaceAll: {} }], 'clearing the key clears every company');
}

eq(slugsForOps([{ slug: 'a' }, { slug: 'b' }, { slug: 'c', paths: {} }]), ['a', 'b', 'c'],
  'otherwise only the named companies are read');

// --- slugs usable as document ids ---------------------------------------
ok(isStorableSlug('acme-inc'), 'a normal slug is storable');
ok(!isStorableSlug(''), 'an empty slug is not');
ok(!isStorableSlug('a/b'), 'a slug with a slash is not');
ok(!isStorableSlug('.'), 'a lone dot is not');
ok(!isStorableSlug('..'), 'a double dot is not');
ok(!isStorableSlug('__name__'), 'a reserved id is not');
ok(isStorableSlug('a'.repeat(1500)), '1500 bytes is the limit, inclusive');
ok(!isStorableSlug('a'.repeat(1501)), 'past it is not');

// --- document sizing -----------------------------------------------------
eq(valueBytes('abc'), 4, 'a string is its bytes plus one');
eq(valueBytes(42), 8, 'a number is eight bytes whatever its value');
eq(valueBytes(true), 1, 'a boolean is one');
eq(valueBytes(null), 1, 'null is one');
eq(valueBytes({ ab: 1 }), 3 + 8, 'a map is its field names plus its values');
eq(valueBytes([1, 2]), 16, 'an array is its elements, unnamed');
eq(valueBytes('é'), 3, 'a multi-byte character counts its bytes, not its length');

{
  const report = settingsDocReport({ workEmail: 'a@b.com', big: 'x'.repeat(5000) });
  eq(report.keys[0].key, 'big', 'the report names the biggest key first');
  ok(report.bytes > 5000 && report.bytes < 5200, 'the total is the sum plus overhead');
}

{
  // The whole point: site lists no longer count against the document.
  const lists = { 'acme-inc': { rows: Array.from({ length: 20000 }, () => 'row') } };
  const report = settingsDocReport({ workEmail: 'a@b.com', companySiteLists: lists });
  ok(report.bytes < 1000, 'site lists are not counted against the document budget');
  ok(report.offloadedBytes > 50000, 'they are reported separately instead');
  eq(report.keys.map(k => k.key), ['workEmail'], 'and they are not listed as a key to prune');
}

{
  const over = { blob: 'x'.repeat(SETTINGS_SIZE_BUDGET) };
  ok(settingsDocReport(over).bytes > SETTINGS_SIZE_BUDGET, 'an over-budget document is caught');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

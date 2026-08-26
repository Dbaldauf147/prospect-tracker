// Assertion tests for carrying a company rename into the site lists.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/siteListRename.test.mjs
//
// These rules rewrite site rows in place, so both mistakes cost the user
// work: match too little and the renamed company's sites stay under the
// old name (the Master Site List parks them in its "unmapped companies"
// bucket, to be re-matched by hand); match too much and sites belonging
// to a company nobody renamed are quietly filed under the new one.
import {
  renameMasterSiteRows,
  renameSitesFileRows,
  renameCompanySiteListEntry,
  summarizeSiteListRename,
} from '../src/components/MasterSiteListView/siteListRenameRules.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// ── Master Site List rows ──────────────────────────────────────────────
{
  const rows = [
    { company: 'Acme Corp', propertyName: 'HQ', zip: '10001' },
    { company: ' acme corp ', propertyName: 'Plant 2', zip: '10002' },
    { company: 'Acme Holdings', propertyName: 'Renamed earlier', zip: '10003' },
    { company: 'Beta Inc', propertyName: 'Another company', zip: '10004' },
  ];
  const res = renameMasterSiteRows(rows, 'Acme Corp', 'Acme Holdings');
  eq(res.count, 2, 'only the rows still spelled the old way count');
  eq(res.rows.map(r => r.company),
    ['Acme Holdings', 'Acme Holdings', 'Acme Holdings', 'Beta Inc'],
    'case and surrounding space are ignored; another company is left alone');
  eq(res.rows[1].propertyName, 'Plant 2', 'the rest of the row is untouched');
  eq(rows[0].company, 'Acme Corp', 'the source rows are not mutated');

  const miss = renameMasterSiteRows(rows, 'Nobody Ltd', 'Someone Ltd');
  eq(miss.count, 0, 'a company with no sites changes nothing');
  eq(miss.rows === rows, true, 'and hands back the same array, so the caller can skip the write');

  const caseOnly = renameMasterSiteRows([{ company: 'iberconsa' }], 'iberconsa', 'Iberconsa');
  eq([caseOnly.count, caseOnly.rows[0].company], [1, 'Iberconsa'],
    'a capitalisation-only rename is still written — the cell stores what is displayed');
}

// ── Utility Lookup sites file (raw uploaded headers) ───────────────────
{
  const rows = [
    { 'Company': 'Acme Corp', 'Site Name': 'HQ', 'Zip': '10001' },
    { 'Company': 'Beta Inc', 'Site Name': 'Mill', 'Zip': '10004' },
  ];
  const res = renameSitesFileRows(rows, 'Acme Corp', 'Acme Holdings');
  eq([res.header, res.count], ['Company', 1], 'the company column is found the way the import finds it');
  eq(res.rows.map(r => r['Company']), ['Acme Holdings', 'Beta Inc'], 'only the renamed company moves');

  eq(renameSitesFileRows([{ 'Parent Company': 'Acme Corp', 'Location': 'HQ' }], 'Acme Corp', 'Acme Holdings')
    .rows[0]['Parent Company'], 'Acme Holdings', 'a differently-worded company header still matches');

  eq(renameSitesFileRows(
    [{ 'Location': 'HQ' }, { 'Location': 'Plant', 'Company': 'Acme Corp' }], 'Acme Corp', 'Acme Holdings').count,
    1, 'headers are unioned over the first rows, so a sparse first row does not hide the column');

  eq(renameSitesFileRows([{ 'Zip': '10001', 'Kwh': '5' }], 'Acme Corp', 'Acme Holdings').count, 0,
    'a file with no company column is left alone rather than guessed at');
}

// ── The company's own uploaded site list ───────────────────────────────
{
  const entry = {
    company: 'Acme Corp',
    fileName: 'acme-sites.xlsx',
    headers: ['Company', 'Site', 'Zip'],
    rows: [
      { Company: 'Acme Corp', Site: 'HQ', Zip: '10001' },
      { Company: 'acme corp', Site: 'Plant', Zip: '10002' },
      { Company: 'Sublease Tenant', Site: 'Shared', Zip: '10003' },
    ],
  };
  const res = renameCompanySiteListEntry(entry, 'Acme Corp', 'Acme Holdings');
  eq(res.entry.company, 'Acme Holdings',
    'the label moves — it is what the Site List Overview and the Utility Lookup picker render');
  eq([res.cells, res.entry.rows.map(r => r.Company)],
    [2, ['Acme Holdings', 'Acme Holdings', 'Sublease Tenant']],
    'the rows move with it; a row naming someone else does not');
  eq(res.entry.fileName, 'acme-sites.xlsx', 'the rest of the entry survives the copy');
  eq(entry.company, 'Acme Corp', 'the stored entry is not mutated');

  const labelOnly = renameCompanySiteListEntry(
    { company: 'iberconsa', headers: ['Site'], rows: [{ Site: 'HQ' }] }, 'iberconsa', 'Iberconsa');
  eq([labelOnly.entry.company, labelOnly.cells], ['Iberconsa', 0],
    'a case-only rename keeps the same slug, so the label is the only thing left to fix');

  eq(renameCompanySiteListEntry({ company: 'Acme Corp' }, 'Acme Corp', 'Acme Holdings').entry.company,
    'Acme Holdings', 'an entry with no rows is still relabelled');

  eq(renameCompanySiteListEntry(
    { company: 'Acme Holdings', headers: ['Site'], rows: [{ Site: 'HQ' }] }, 'Acme Corp', 'Acme Holdings'),
    null, 'nothing to change returns null, so no settings write is queued');
  eq(renameCompanySiteListEntry(null, 'Acme Corp', 'Acme Holdings'), null, 'a company with no site list is fine');
  eq(renameCompanySiteListEntry({ company: 'Acme Corp' }, 'Acme Corp', '   '), null,
    'a blank new name never overwrites anything');
}

// ── Prompt lines ───────────────────────────────────────────────────────
{
  eq(summarizeSiteListRename({ masterCount: 2, sitesCount: 1 }),
    ['• 2 Master Site List rows', '• 1 Utility Lookup site row'],
    'the confirmation prompt names both lists and counts them');
  eq(summarizeSiteListRename({ masterCount: 0, sitesCount: 0 }), [],
    'and says nothing when neither list changes');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

// Assertion tests for writing a company rename through to its Google
// Sheet row. Plain Node — no test framework (the project has none). Run:
//   node scripts/sheetCompanyRename.test.mjs
//
// This decides which row of the source-of-truth sheet gets overwritten,
// so both mistakes are expensive: match nothing and the old name stays in
// the sheet and the additive import brings the renamed company back as a
// second account (this is how "April Housing (a Blackstone co.)"
// reappeared); match the wrong row and a company the user never touched
// silently becomes a different company.
import { planSheetCompanyRename, spreadsheetIdFromUrl } from '../src/utils/sheetCompanyRename.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
const sheet = (...companies) => companies.map((company, i) => ({ row: i + 2, company }));

// ── The case that started this ─────────────────────────────────────────
{
  const names = sheet('Blackstone', 'April Housing (a Blackstone co.)', 'Prologis');
  eq(planSheetCompanyRename(names, 'April Housing (a Blackstone co.)', 'April Housing'),
    { row: 3, reason: 'exact', from: 'April Housing (a Blackstone co.)' }, 'the row the rename came from is the row that gets rewritten');
}

// ── Ordinary matching ──────────────────────────────────────────────────
{
  const names = sheet('Prologis', 'Ventas');
  eq(planSheetCompanyRename(names, 'prologis', 'Prologis Inc.'), { row: 2, reason: 'exact', from: 'Prologis' },
    'matching the old name ignores case');
  eq(planSheetCompanyRename(names, '  Ventas  ', 'Ventas REIT'), { row: 3, reason: 'exact', from: 'Ventas' },
    'and surrounding space');
  eq(planSheetCompanyRename(names, 'Prologis', 'PROLOGIS'), { row: 2, reason: 'exact', from: 'Prologis' },
    'a capitalisation-only rename is still written — the cell stores what is displayed');
}

{
  // The sheet spells it differently from the app record, so the exact
  // match misses. The key is the same one every other comparison uses.
  const names = sheet('HIG Capital, LLC', 'Ventas');
  eq(planSheetCompanyRename(names, 'H.I.G. Capital', 'HIG Capital'),
    { row: 2, reason: 'key', from: 'HIG Capital, LLC' },
    'a spelling variant is found by the shared dedupe key, and reports the SHEET\u2019s spelling');
  // That `from` is the sheet's text, not the app's, is load-bearing: the
  // server re-reads the cell and refuses to write unless it still holds
  // `from`. Sending the app's old name would make every key match fail
  // that check and silently never rename anything.
  eq(planSheetCompanyRename(names, 'H.I.G. Capital', 'HIG Capital').from, 'HIG Capital, LLC',
    'the cell text is what the server will be asked to verify');
}

// ── Refusing to guess ──────────────────────────────────────────────────
{
  eq(planSheetCompanyRename(sheet('Ventas'), 'Prologis', 'Prologis Inc.'), { row: null, reason: 'not-found', from: null },
    'a company the sheet does not have is left alone');
  eq(planSheetCompanyRename([], 'Prologis', 'Prologis Inc.'), { row: null, reason: 'not-found', from: null },
    'and so is an empty sheet');
  eq(planSheetCompanyRename(null, 'Prologis', 'Prologis Inc.'), { row: null, reason: 'not-found', from: null },
    'and no sheet at all');
}

{
  // Two rows could be the old name. Renaming a guess is worse than
  // renaming none — the user can see and fix an unrenamed row, but not a
  // company that quietly turned into another one.
  eq(planSheetCompanyRename(sheet('Prologis', 'prologis'), 'Prologis', 'Prologis Inc.'),
    { row: null, reason: 'ambiguous', from: null }, 'two rows under the old name means no rename');
  eq(planSheetCompanyRename(sheet('HIG Capital', 'H.I.G. Capital'), 'HIG Capital, LLC', 'HIG'),
    { row: null, reason: 'ambiguous', from: null }, 'and so do two rows the key both matches');
}

{
  // The new name is already in the sheet. Renaming another row onto it
  // would put the same company there twice — the thing this exists to
  // prevent.
  const names = sheet('April Housing', 'April Housing (a Blackstone co.)');
  eq(planSheetCompanyRename(names, 'April Housing (a Blackstone co.)', 'April Housing'),
    { row: null, reason: 'already-set', from: null }, 'never create a second row for the same company');
}

{
  eq(planSheetCompanyRename(sheet('Prologis'), 'Prologis', 'Prologis'), { row: null, reason: 'no-change', from: null },
    'an identical name is nothing to write');
  eq(planSheetCompanyRename(sheet('Prologis'), '', 'Prologis'), { row: null, reason: 'no-change', from: null },
    'and neither is a blank side');
  eq(planSheetCompanyRename(sheet('Prologis'), 'Prologis', '   '), { row: null, reason: 'no-change', from: null },
    'in either direction');
}

{
  // Blank rows in the middle of the sheet are why the row number is
  // carried alongside the name rather than inferred from position.
  const names = [{ row: 2, company: 'Prologis' }, { row: 9, company: 'Ventas' }];
  eq(planSheetCompanyRename(names, 'Ventas', 'Ventas REIT'), { row: 9, reason: 'exact', from: 'Ventas' },
    'the sheet row number is used, not the position in the list');
  eq(planSheetCompanyRename([{ row: 2, company: '  ' }, { row: 3, company: 'Ventas' }], 'Ventas', 'V'),
    { row: 3, reason: 'exact', from: 'Ventas' }, 'rows with no company are ignored');
}

// ── The spreadsheet id ─────────────────────────────────────────────────
{
  eq(spreadsheetIdFromUrl('https://docs.google.com/spreadsheets/d/1AbC_dEf-123/edit#gid=0'), '1AbC_dEf-123',
    'the id comes out of an edit URL');
  eq(spreadsheetIdFromUrl('https://docs.google.com/spreadsheets/d/1AbC/export?format=csv&gid=0'), '1AbC',
    'and an export URL');
  eq(spreadsheetIdFromUrl('https://example.com/nope'), null, 'a URL that is not a sheet has no id');
  eq(spreadsheetIdFromUrl(''), null, 'nor does an empty one');
  eq(spreadsheetIdFromUrl(null), null, 'nor no URL at all');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

// Assertion tests for the Google Sheets auto-sync diff (useSheetSync).
// Plain Node — no test framework (the project has none). Run:
//   node scripts/sheetSyncAdditive.test.mjs
//
// This runs on a timer, so both directions are expensive to get wrong:
// miss a match and every tick re-adds the whole sheet as duplicates;
// match too eagerly and a genuinely new account never arrives.
//
// It used to answer "do we already have this company?" by reading the
// entire `prospects` collection from Firestore on every tick — a full
// collection read every few minutes, per open tab, changed sheet or not.
// That is what exhausted the project's Firestore quota, after which every
// read in the app came back RESOURCE_EXHAUSTED. The roster is now the
// live subscription the app already holds, so these are pure comparisons
// with no I/O behind them.
import { newSheetRows } from '../src/utils/sheetSyncDiff.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
const names = (rows) => rows.map((r) => r.company);

{
  const sheet = [{ company: 'Apollo Global Management' }, { company: 'Blackstone' }, { company: 'Ara Partners' }];
  const roster = [{ company: 'Apollo Global Management' }, { company: 'Blackstone' }];
  eq(names(newSheetRows(sheet, roster)), ['Ara Partners'], 'only the company the site is missing comes back');
}

{
  // The steady state, and the one that matters most: an unchanged sheet
  // against a roster that already has everything writes nothing.
  const sheet = [{ company: 'Apollo Global Management' }, { company: 'Blackstone' }];
  eq(newSheetRows(sheet, sheet).length, 0, 'a sheet the site already has produces no writes');
}

{
  const sheet = [{ company: 'BlackRock' }];
  eq(newSheetRows(sheet, [{ company: 'blackrock' }]).length, 0, 'matching ignores case, as it always has');
}

{
  // An empty roster is a real first run, not a signal to skip: the hook
  // gates on the subscription having loaded before it ever gets here.
  const sheet = [{ company: 'Bain Capital' }];
  eq(names(newSheetRows(sheet, [])), ['Bain Capital'], 'an empty roster imports the sheet');
  eq(names(newSheetRows(sheet, null)), ['Bain Capital'], 'and so does a roster that is not there at all');
}

{
  eq(newSheetRows([], [{ company: 'Bain Capital' }]).length, 0, 'an empty sheet adds nothing');
  eq(newSheetRows(null, [{ company: 'Bain Capital' }]).length, 0, 'and neither does no sheet at all');
}

{
  // Rows with no company name: one blank in the roster must not swallow
  // every unnamed sheet row silently — but it does match them, which is
  // the same thing the old Firestore-backed map did. Pinned so a change
  // here is deliberate.
  eq(newSheetRows([{ company: '' }], []).length, 1, 'an unnamed sheet row is new when the roster is empty');
  eq(newSheetRows([{ company: '' }], [{ company: '' }]).length, 0, 'and matches an unnamed roster row');
  eq(newSheetRows([{}], [{ company: '' }]).length, 0, 'a row with no company field at all keys the same as blank');
}

{
  // Two sheet rows for the same missing company now yield ONE row. This
  // used to return both and leave the app's duplicate collapse to clean
  // up, which only worked when the collapse agreed the two names were the
  // same company — the case that was failing.
  const sheet = [{ company: 'Ara Partners' }, { company: 'Ara Partners' }];
  eq(newSheetRows(sheet, []).length, 1, 'duplicate sheet rows collapse within the pass');
  eq(newSheetRows([{ company: 'HIG Capital' }, { company: 'H.I.G. Capital' }], []).length, 1,
    'and so do two spellings of one company');
}

{
  // The whole point of the change: a sheet row whose name is a spelling
  // variant of a roster company is NOT a company the site is missing.
  // Each of these minted a second account, with a fresh document id and
  // so none of the Target Account / divisions / HQ mappings keyed to the
  // first one.
  const same = [
    ['H.I.G Capital', 'HIG Capital, LLC'],
    ['Lend Lease', 'LendLease'],
    ['Citi Bank', 'Citibank'],
    ['Clayton, Dubilier & Rice (CD&R)', 'Clayton, Dubilier & Rice'],
    ['Edens (a Blackstone co.)', 'Edens'],
    ['Chamberlain (BX-PC)', 'Chamberlain'],
    ['Extended Stay America Inc', 'Extended Stay America (a Blackstone co.)'],
  ];
  for (const [sheetName, rosterName] of same) {
    eq(newSheetRows([{ company: sheetName }], [{ company: rosterName }]).length, 0,
      `"${sheetName}" is already on the site as "${rosterName}"`);
  }
}

{
  // ...and the other direction, which is just as expensive to get wrong.
  // A regional or segment qualifier is what makes these separate
  // accounts, so they must still import.
  const distinct = [
    ['Brookfield (Dubai)', 'Brookfield (Self Storage)'],
    ['Prologis (Data Centers)', 'Prologis'],
    ['Brookfield Logistics (France)', 'Brookfield Logistics (US)'],
    ['Edmond de Rothschild REIM (UK) Limited', 'Edmond de Rothschild REIM (Suisse) SA'],
    ['CH Guenther', 'C.H. Guenther & Son (a Pritzker Private Capital co.)'],
    ['Fund A', 'Fund B'],
  ];
  for (const [sheetName, rosterName] of distinct) {
    eq(newSheetRows([{ company: sheetName }], [{ company: rosterName }]).length, 1,
      `"${sheetName}" is a different account from "${rosterName}"`);
  }
}

{
  // The rows come back whole — they are what gets written to Firestore.
  const row = { company: 'Ara Partners', website: 'ara.com', tierList: 'Tier 1' };
  eq(newSheetRows([row], [])[0], row, 'the full sheet row is returned, not just its name');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

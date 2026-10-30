// Assertion tests for flagging duplicate rows on the Target Accounts list.
// Plain Node, no test framework (the project has none). Run:
//   node scripts/targetDuplicates.test.mjs
import {
  DUPLICATE_FLAG, isDuplicateRow, withoutDuplicateRows, countDuplicateRows,
  carryDuplicateFlags, possibleDuplicateNames,
} from '../src/utils/targetDuplicates.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const headers = ['Account', 'CDM', 'Tier'];
const book = (records, extra = {}) => ({ sheetNames: ['Targets'], sheets: { Targets: { headers, records } }, ...extra });

// withoutDuplicateRows
{
  const clean = book([{ _id: 1, Account: 'CBRE' }]);
  eq(withoutDuplicateRows(clean) === clean, true, 'no flagged rows: the same object comes back');
  eq(withoutDuplicateRows(null), null, 'no data: passes through');
  const flagged = book([
    { _id: 1, Account: 'CBRE' },
    { _id: 2, Account: 'CBRE Inc', [DUPLICATE_FLAG]: true },
    { _id: 3, Account: 'Prologis' },
  ], { fileName: 'list.xlsx' });
  const out = withoutDuplicateRows(flagged);
  eq(out.sheets.Targets.records.map(r => r.Account), ['CBRE', 'Prologis'], 'flagged rows are dropped');
  eq(out.fileName, 'list.xlsx', 'the rest of the workbook is kept');
  eq(flagged.sheets.Targets.records.length, 3, 'the input is not mutated');
  eq(countDuplicateRows(flagged), 1, 'counts flagged rows');
  eq(isDuplicateRow({ [DUPLICATE_FLAG]: false }), false, 'a false flag is not a duplicate');
}

// carryDuplicateFlags
{
  const prev = book([
    { _id: 1, Account: 'CBRE', CDM: 'Dan', Tier: 'Tier 1' },
    { _id: 2, Account: 'CBRE', CDM: 'Dan', Tier: 'Tier 1', [DUPLICATE_FLAG]: true },
    { _id: 3, Account: 'Acme Inc', CDM: 'Dan', Tier: 'Tier 3', [DUPLICATE_FLAG]: true },
  ]);
  const next = book([
    { _id: 1, Account: 'CBRE', CDM: 'Dan', Tier: 'Tier 1' },
    { _id: 2, Account: 'CBRE', CDM: 'Dan', Tier: 'Tier 1' },
    { _id: 3, Account: 'Acme Inc', CDM: 'Sam', Tier: 'Tier 3' },
  ]);
  const { data, count } = carryDuplicateFlags(prev, next);
  eq(count, 1, 'only an identical row is re-flagged');
  eq(data.sheets.Targets.records.map(isDuplicateRow), [true, false, false], 'one flagged copy re-flags one copy, not both');
  const none = carryDuplicateFlags(null, next);
  eq(none.data === next && none.count === 0, true, 'no previous list: nothing carried');
}

// possibleDuplicateNames
{
  const rows = [
    { Account: 'CBRE' },
    { Account: 'CBRE, Inc.' },
    { Account: 'Prologis' },
    { Account: 'Prologis', [DUPLICATE_FLAG]: true },
  ];
  eq([...possibleDuplicateNames(rows, 'Account')], ['cbre'], 'names shared by unflagged rows, ignoring suffixes');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

// Commissions > Monthly: which month cards read as uploaded, and the Issues
// row for last month's missing file. Run:
//   node scripts/commissionMonthUploads.test.mjs
const { commissionUploadKey, commissionUploadFor, recordCommissionUpload, missingCommissionFileIssues } = await import('../src/utils/commissionMonthUploads.js');

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const nov2 = new Date(2026, 10, 2, 9, 0);
eq(commissionUploadKey(10, nov2), '2026-11', 'current month is this year');
eq(commissionUploadKey(0, nov2), '2026-01', 'earlier month is this year');
eq(commissionUploadKey(11, nov2), '2025-12', 'later month is last year');

eq(missingCommissionFileIssues(null, nov2).map(i => [i.id, i.type, i.source]),
  [['commission-file-missing:2026-10', 'Commission file not uploaded', 'Commissions']],
  'no October file in November: one issue');

const up = recordCommissionUpload(null, 9, 'Oct.xlsx', nov2);
eq(Object.keys(up), ['2026-10'], 'upload keyed by year-month');
eq(commissionUploadFor(up, 9, nov2)?.fileName, 'Oct.xlsx', 'October reads as uploaded');
eq(commissionUploadFor(up, 8, nov2), null, 'September does not');
eq(missingCommissionFileIssues(up, nov2), [], 'October uploaded: no issue');

// Last year's October file doesn't count for this year's.
eq(missingCommissionFileIssues({ '2025-10': { fileName: 'x', at: '' } }, nov2).length, 1, 'last year\'s upload does not count');

// January looks back to December of the previous year.
const jan5 = new Date(2027, 0, 5);
eq(missingCommissionFileIssues(null, jan5)[0].id, 'commission-file-missing:2026-12', 'January checks last December');
eq(missingCommissionFileIssues({ '2026-12': { fileName: 'Dec.xlsx', at: '' } }, jan5), [], 'December uploaded: clear in January');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

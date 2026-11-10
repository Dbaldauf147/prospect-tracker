// Commissions > Monthly: which month cards read as uploaded, and the Issues
// row for last month's missing file. Run:
//   node scripts/commissionMonthUploads.test.mjs
const { commissionUploadKey, commissionUploadFor, recordCommissionUpload, commissionUploadFiles, missingCommissionFileIssues } = await import('../src/utils/commissionMonthUploads.js');

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

// Each drop on a month is kept, so every file can be downloaded later.
const nov3 = new Date(2026, 10, 3, 9, 0);
const two = recordCommissionUpload(recordCommissionUpload(null, 9, 'Oct.xlsx', nov2, { fileId: 'a' }), 9, 'Oct fix.xlsx', nov3, { fileId: 'b' });
eq(commissionUploadFor(two, 9, nov3).fileName, 'Oct fix.xlsx', 'latest file on top');
eq(commissionUploadFiles(commissionUploadFor(two, 9, nov3)).map(f => [f.fileName, f.fileId]), [['Oct.xlsx', 'a'], ['Oct fix.xlsx', 'b']], 'both files listed, oldest first');
// An entry from before copies were kept reads as one file with no copy.
eq(commissionUploadFiles({ fileName: 'Old.xlsx', at: 'x' }), [{ fileName: 'Old.xlsx', at: 'x' }], 'legacy entry is one file');
eq(commissionUploadFiles(recordCommissionUpload({ '2026-10': { fileName: 'Old.xlsx', at: 'x' } }, 9, 'New.xlsx', nov2, { fileId: 'c' })['2026-10']).map(f => f.fileName), ['Old.xlsx', 'New.xlsx'], 'legacy entry kept when a new file lands');
eq(commissionUploadFiles(null), [], 'no entry, no files');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

// The "File not backed up" list: files only this browser holds, and the
// Issues-tab rows built from it. Run:
//   node scripts/localOnlyFiles.test.mjs
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};
const { setUserLsUserId } = await import('../src/utils/userLs.js');
const { markLocalOnly, clearLocalOnly, loadLocalOnlyFiles, localOnlyFileIssues } = await import('../src/utils/localOnlyFiles.js');
setUserLsUserId('u1');

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

markLocalOnly('sia:7', { kind: 'sia', reason: 'too-big', name: 'Big SIA.xlsx', sizeBytes: 31457280, limitBytes: 20971520, oppId: 7 });
markLocalOnly('portfolio:portfolioUploadFile:blackstone', { kind: 'portfolio', reason: 'backup-failed', name: 'bx.xlsx', sizeBytes: 2048, owner: 'blackstone', error: 'permission-denied' });
markLocalOnly('rfp:__standard__', { kind: 'rfp', reason: 'too-big', name: 'std.xlsx', sizeBytes: 16e6, limitBytes: 15728640, owner: 'Standard RFP template' });
eq(loadLocalOnlyFiles().map(e => e.id), ['sia:7', 'portfolio:portfolioUploadFile:blackstone', 'rfp:__standard__'], 'marks are stored');

const since = loadLocalOnlyFiles().find(e => e.id === 'sia:7').since;
markLocalOnly('sia:7', { kind: 'sia', reason: 'backup-failed', name: 'Big SIA.xlsx', sizeBytes: 100, oppId: 7 });
eq(loadLocalOnlyFiles().find(e => e.id === 'sia:7').since, since, 'a second mark keeps the first "since"');
eq(loadLocalOnlyFiles().find(e => e.id === 'sia:7').reason, 'backup-failed', 'a second mark updates the reason');

clearLocalOnly('rfp:__standard__');
eq(loadLocalOnlyFiles().map(e => e.id), ['sia:7', 'portfolio:portfolioUploadFile:blackstone'], 'clear removes the file');

setUserLsUserId('u2');
eq(loadLocalOnlyFiles(), [], 'another account on the same browser sees none of it');
setUserLsUserId('u1');

markLocalOnly('sia:7', { kind: 'sia', reason: 'too-big', name: 'Big SIA.xlsx', sizeBytes: 31457280, limitBytes: 20971520, oppId: 7 });
const rows = localOnlyFileIssues(loadLocalOnlyFiles(), {
  oppsRecords: [{ _id: 3, Account: 'Acme' }, { _id: 7, Account: 'Globex' }],
  oppNumbers: new Map([[3, 1], [7, 2]]),
  prospects: [{ id: 'p9', company: 'Blackstone' }],
});
eq(rows.map(r => [r.id, r.source, r.type, r.company, r.oppNumber, r.prospectId]), [
  ['local-only:sia:7', 'Backups', 'File not backed up', 'Globex', 2, null],
  ['local-only:portfolio:portfolioUploadFile:blackstone', 'Backups', 'File not backed up', 'Blackstone', null, 'p9'],
], 'rows name the opp and its company, and the portfolio company card');
eq(rows[0].detail, 'SIA / pricing workbook "Big SIA.xlsx" (30.0 MB) is only in this browser: over the 20.0 MB backup limit. Clearing browsing data would delete it. Find it under Opps > the opp > Pricing.', 'too-big detail');
eq(rows[1].detail, 'PE portfolio workbook "bx.xlsx" (2 KB) is only in this browser: its cloud backup failed (permission-denied). Clearing browsing data would delete it. Find it under Company card > Portfolio.', 'failed-backup detail');
eq(localOnlyFileIssues([{ id: 'x', kind: 'nope' }]), [], 'an unknown kind makes no row');
eq(rows.every(r => !/—/.test(r.detail)), true, 'no em dashes in the copy');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

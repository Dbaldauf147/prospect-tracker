// Tests for the All Missing History "who joined that day" comparison
// (src/utils/backupMembership.js). Plain Node. Run:
//   node scripts/backupMembership.test.mjs
import { slimBackup, diffMembership, countedOnMyAccounts, backupsForDay } from '../src/utils/backupMembership.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const CDM = 'Dan Baldauf';
const backup = (records, targetMap = {}) => ({
  generatedAt: '2026-10-30T11:00:00Z',
  collections: { prospects: { records }, userSettings: { targetMap, other: 'x'.repeat(10) } },
});

// slimBackup keeps only the membership fields and the mapped ids.
const slim = slimBackup(backup([
  { id: 'a', company: 'Acme', cdm: 'Dan Baldauf', notes: 'long text', createdAt: { _seconds: 1761800000 } },
], { a: ['Acme Corp'], b: [], c: 'Cobalt' }));
eq(Object.keys(slim.prospects[0]).sort(), ['cdm', 'company', 'createdAt', 'id'], 'slim drops other fields');
eq(slim.prospects[0].createdAt, new Date(1761800000 * 1000).toISOString(), 'Timestamp createdAt becomes ISO');
eq(slim.mapped, ['a', 'c'], 'mapped ids skip a cleared (empty) mapping');
eq(slimBackup(null).prospects, [], 'empty backup slims to nothing');

// Who counts.
eq(countedOnMyAccounts({ cdm: 'Baldauf' }, CDM), true, 'own CDM counts');
eq(countedOnMyAccounts({ cdm: 'Jane Smith' }, CDM), false, 'other CDM does not');
eq(countedOnMyAccounts({ cdm: 'Jane Smith', tierOwnTarget: true }, CDM), true, 'Dan target counts whoever the CDM');
eq(countedOnMyAccounts({ cdm: 'Dan Baldauf', status: 'Old Client' }, CDM), false, 'inactive left out');
eq(countedOnMyAccounts({ cdm: 'Dan Baldauf', status: 'Client', substatus: 'Paused' }, CDM), false, 'substatus reads as Hold Off');
eq(countedOnMyAccounts({ cdm: 'Dan Baldauf', status: 'Qualifying' }, CDM), false, 'Qualifying left out');

// The day's diff.
const before = slimBackup(backup([
  { id: '1', company: 'Stays', cdm: 'Dan Baldauf' },
  { id: '2', company: 'Bravo', cdm: 'Jane Smith' },
  { id: '3', company: 'Leaves', cdm: 'Dan Baldauf' },
  { id: '5', company: 'Waking', cdm: 'Dan Baldauf', status: 'Hold Off' },
]));
const after = slimBackup(backup([
  { id: '1', company: 'Stays', cdm: 'Dan Baldauf' },
  { id: '2', company: 'Bravo', cdm: 'Dan Baldauf', tier: 'Tier 2' },
  { id: '3', company: 'Leaves', cdm: 'Jane Smith' },
  { id: '4', company: 'Alpha', cdm: 'Dan Baldauf' },
  { id: '5', company: 'Waking', cdm: 'Dan Baldauf', status: 'Prospect' },
], { 2: ['Bravo Inc'] }));
const d = diffMembership(before, after, CDM);
eq(d.joined.map(r => r.company), ['Alpha', 'Bravo', 'Waking'], 'joined, sorted by name');
eq(d.left.map(r => r.company), ['Leaves'], 'left');
const bravo = d.joined.find(r => r.id === '2');
eq([bravo.reason, bravo.cdmBefore, bravo.cdmAfter, bravo.mappedThatDay, bravo.tier], ['CDM Jane Smith to Dan Baldauf', 'Jane Smith', 'Dan Baldauf', true, 'Tier 2'], 'Bravo: CDM change and the new mapping');
eq([d.joined[0].reason, d.joined[0].newRecord], ['New in the tracker', true], 'a brand-new card');
eq(d.joined.find(r => r.id === '5').reason, 'Status Hold Off to Prospect', 'came back from inactive');

// Picking the backups: cron runs 11:00 UTC (morning, local), so the end of
// Oct 30 is the Oct 31 backup and the end of Oct 29 the Oct 30 one.
const files = ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'].map(dd => ({ name: `b-${dd}`, createdTime: `${dd}T11:00:00Z` }));
const pick = backupsForDay(files, '2026-10-30', '2026-10-29');
eq([pick.before?.name, pick.after?.name], ['b-2026-10-30', 'b-2026-10-31'], 'one-day step');
const gap = backupsForDay(files, '2026-10-31', '2026-10-29');
eq([gap.before?.name, gap.after?.name], ['b-2026-10-30', 'b-2026-11-01'], 'a gap compares from the previous recorded day');
eq(backupsForDay(files, '2026-11-01', '2026-10-31').after, null, 'no backup after the day yet');
eq(backupsForDay(files.slice(2), '2026-10-30', '2026-10-29').before, null, 'before no longer kept');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

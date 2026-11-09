// Tests for the All Missing History "who was added / who left that day"
// comparison: the shared My Accounts rule (src/utils/myAccountsMembership.js)
// and the backup side (src/utils/backupMembership.js). Plain Node. Run:
//   node scripts/backupMembership.test.mjs
import { myAccountsMembers, countedMyAccounts, parseTargetAccounts, oppCountsByAccount } from '../src/utils/myAccountsMembership.js';
import { membershipFromBackup, diffMembership, backupsForDay, workbookFromBackup } from '../src/utils/backupMembership.js';
import { encodeValue } from '../src/utils/fullBackup.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const CDM = 'Dan Baldauf';
const ids = (list) => list.map(m => m.prospect.id);
const why = (list) => Object.fromEntries(list.map(m => [m.prospect.id, m.why]));

// The rule.
const prospects = [
  { id: 't1', company: 'Zeta Tier One', cdm: 'Dan Baldauf', tier: 'Tier 1' },
  { id: 't3', company: 'Unmapped Tier Three', cdm: 'Dan Baldauf', tier: 'Tier 3' },
  { id: 'map', company: 'Mapped Co', cdm: 'Dan Baldauf', tier: 'Tier 3' },
  { id: 'cli', company: 'Client Co', cdm: 'Dan Baldauf', tier: 'Tier 3', status: 'Client' },
  { id: 'opp', company: 'Opp Co', cdm: 'Dan Baldauf', tier: 'Tier 3' },
  { id: 'other', company: 'Other Rep Co', cdm: 'Jane Smith', tier: 'Tier 1' },
  { id: 'otheropp', company: 'Other Opp Co', cdm: 'Jane Smith', tier: 'Tier 1' },
  { id: 'own', company: 'Own Target Co', cdm: 'Jane Smith', tierOwnTarget: true },
  { id: 'notier', company: 'No Tier Co', cdm: 'Dan Baldauf' },
  { id: 'dis', company: 'Dismissed Co', cdm: 'Dan Baldauf', tier: 'Tier 1' },
  { id: 'sheet', company: 'Sheet Target Inc', cdm: 'Dan Baldauf', tier: 'Tier 3' },
];
const oppsRecords = [
  { Account: 'Opp Co', Stage: 'Proposal' },
  { Account: 'Other Opp Co', Stage: 'Proposal' },
  { Account: 'Client Co', Stage: 'Sold' },
];
const targetAccounts = [{ company: 'Sheet Target Inc', tier: 'Tier 3' }];
const inputs = { prospects, cdmName: CDM, targetMap: { map: ['Mapped Co'] }, dismissedCompanies: ['dismissed co'], targetAccounts, oppsRecords };
const members = myAccountsMembers(inputs);
eq(ids(members).sort(), ['cli', 'map', 'opp', 'otheropp', 'own', 'sheet', 't1'].sort(), 'membership: tiers, mapping, sheet, client, opps, Dan target');
eq(why(members), { t1: 'Tier 1', map: 'On Targets list', cli: 'Client', opp: 'Open opp', otheropp: 'Open opp (other CDM)', own: 'Dan target', sheet: 'On Targets list' }, 'why each is on');
eq(ids(myAccountsMembers({ ...inputs, targetMap: { map: ['Mapped Co'], sheet: [] } })).includes('sheet'), false, 'a cleared mapping stops the name match');
eq([...countedMyAccounts({ ...inputs, prospects: [...prospects, { id: 'old', company: 'Old Co', cdm: 'Dan Baldauf', tier: 'Tier 1', status: 'Old Client' }, { id: 'q', company: 'Q Co', cdm: 'Dan Baldauf', tier: 'Tier 1', status: 'Qualifying' }, { id: 'sub', company: 'Sub Co', cdm: 'Dan Baldauf', tier: 'Tier 1', status: 'Client', substatus: 'Paused' }] }).keys()].filter(k => ['old', 'q', 'sub'].includes(k)), [], 'counted leaves out inactive, Qualifying and substatus');
eq(oppCountsByAccount(oppsRecords), { total: { 'opp co': 1, 'other opp co': 1, 'client co': 1 }, open: { 'opp co': 1, 'other opp co': 1 } }, 'opp counts');

// Targets workbook parse, as the page does it.
const workbook = { sheetNames: ['S'], sheets: { S: { records: [
  { Account: 'Alpha', CDM: 'Dan Baldauf', Tier: 'Tier 1' },
  { Account: 'Beta', CDM: 'Jane Smith', Tier: 'Tier 1' },
  { Account: 'Gamma', CDM: 'Dan Baldauf', Tier: 'Tier 5' },
] } } };
eq(parseTargetAccounts(workbook, CDM).accounts.map(a => [a.company, a.tier]), [['Alpha', 'Tier 1']], 'workbook: own Tier 1-3 rows only');

// The backup side: the same rule over a backup, and the diff adds up.
const json = JSON.stringify(await encodeValue(workbook));
eq(workbookFromBackup({ json, chunkCount: 0 })?.sheetNames, ['S'], 'workbook out of the chunked-json backup field');
eq(workbookFromBackup(workbook)?.sheetNames, ['S'], 'workbook from the oldest layout');

const backup = (records, targetMap = {}) => ({
  generatedAt: '2026-10-30T11:00:00Z',
  collections: {
    prospects: { records },
    userSettings: { targetMap, dismissedCompanies: [] },
    targetAccounts: { json },
    opps2Data: { records: [{ Account: 'Opp Co', Stage: 'Proposal' }] },
  },
});
const before = membershipFromBackup(backup([
  { id: '1', company: 'Stays', cdm: 'Dan Baldauf', tier: 'Tier 1' },
  { id: '2', company: 'Bravo', cdm: 'Dan Baldauf', tier: 'Tier 3' },
  { id: '3', company: 'Leaves', cdm: 'Dan Baldauf', tier: 'Tier 2' },
  { id: '5', company: 'Alpha', cdm: 'Dan Baldauf', tier: 'Tier 3', createdAt: { _seconds: 1761800000 } },
]), CDM);
eq(before.members, { 1: 'Tier 1', 3: 'Tier 2', 5: 'On Targets list' }, 'backup members (Alpha via the workbook)');
eq(before.cards['5'].createdAt, new Date(1761800000 * 1000).toISOString(), 'Timestamp createdAt to ISO');
const after = membershipFromBackup(backup([
  { id: '1', company: 'Stays', cdm: 'Dan Baldauf', tier: 'Tier 1' },
  { id: '2', company: 'Bravo', cdm: 'Dan Baldauf', tier: 'Tier 3' },
  { id: '3', company: 'Leaves', cdm: 'Jane Smith', tier: 'Tier 2' },
  { id: '4', company: 'Opp Co', cdm: 'Dan Baldauf' },
  { id: '5', company: 'Alpha', cdm: 'Dan Baldauf', tier: 'Tier 3' },
], { 2: ['Bravo Inc'] }), CDM);
const d = diffMembership(before, after);
eq(d.rows.map(r => [r.company, r.change]), [['Bravo', 'Added'], ['Opp Co', 'Added'], ['Leaves', 'Left'], ['Alpha', 'Stayed'], ['Stays', 'Stayed']], 'every company, Added then Left then Stayed');
eq(d.counts, { before: 3, after: 4, added: 2, left: 1, stayed: 2 }, 'counts');
eq(d.counts.before + d.counts.added - d.counts.left, d.counts.after, 'before + added - left = after');
const bravo = d.rows.find(r => r.id === '2');
eq([bravo.whatChanged, bravo.whyAfter, bravo.mappedThatDay], ['Mapped to the Targets list', 'On Targets list', true], 'Bravo joined through the mapping');
eq(d.rows.find(r => r.id === '3').whatChanged, 'CDM Dan Baldauf to Jane Smith', 'Leaves: CDM change');
eq(d.rows.find(r => r.id === '4').whatChanged, 'New in the tracker', 'a new card');

// Settings maps briefly stored as JSON strings still read.
const strBackup = backup([{ id: '2', company: 'Bravo', cdm: 'Dan Baldauf', tier: 'Tier 3' }]);
strBackup.collections.userSettings.targetMap = JSON.stringify({ 2: ['Bravo Inc'] });
eq(membershipFromBackup(strBackup, CDM).members, { 2: 'On Targets list' }, 'targetMap stored as a JSON string');

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

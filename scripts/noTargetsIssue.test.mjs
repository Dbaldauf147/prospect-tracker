// Issues tab "No targets": a tracked client of yours whose company popup
// Targets tab has nothing filled in. Run: node scripts/noTargetsIssue.test.mjs
import { detectNoTargets, myAccountsNoTargetIssues, strategicNoTargetIssues } from '../src/utils/clientNoTargets.js';
import { hasTargetValues, blankTarget, noTargetRow } from '../src/utils/companyTargets.js';
import { strategicLookup, withoutNamStrategicRows } from '../src/utils/strategicAccounts.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

check('no list', hasTargetValues(undefined), false);
check('empty list', hasTargetValues([]), false);
check('an untouched new row is not a value', hasTargetValues([blankTarget()]), false);
check('a hidden blank row is not a value', hasTargetValues([{ ...blankTarget(), hidden: true }]), false);
check('a type is a value', hasTargetValues([{ ...blankTarget(), type: 'Net zero' }]), true);
check('a year is a value', hasTargetValues([{ ...blankTarget(), targetYear1: '2030' }]), true);
check('a scope tick is a value', hasTargetValues([{ ...blankTarget(), scope2: true }]), true);
check('"No target set" answers it', hasTargetValues([noTargetRow()]), true);

const cdm = 'Dan Baldauf';
const prospects = [
  { id: 'a', company: 'Acme', status: 'Client', cdm },
  { id: 'b', company: 'Beta', status: 'Client', cdm, climateTargets: [{ ...blankTarget(), type: 'SBTi' }] },
  { id: 'c', company: 'Cyan', status: 'Client', cdm, climateTargets: [blankTarget()] },
  { id: 'd', company: 'Delta', status: 'Prospect', cdm },
  { id: 'e', company: 'Echo', status: 'Client', cdm: 'Someone Else' },
  { id: 'f', company: 'Fox', status: 'Client', cdm },
];
const rows = detectNoTargets({ prospects, cdmName: cdm, untrackedMap: { fox: true } });
check('only tracked clients of yours with nothing filled in', rows.map(r => r.company), ['Acme', 'Cyan']);
check('row shape', [rows[0].id, rows[0].type, rows[0].source, rows[0].prospectId, rows[0].resolve], ['no-targets:a', 'No targets', 'Clients', 'a', { kind: 'noTargets' }]);
check('no em dash in the detail', /—/.test(rows[0].detail), false);

// My Accounts: the companies that page published as having no targets,
// checked against the live companies.
const mine = [
  { id: 'p1', company: 'Zeta', status: 'Prospect' },
  { id: 'p2', company: 'Alpha', status: '' },
  { id: 'p3', company: 'Since Logged', status: 'Prospect', climateTargets: [noTargetRow()] },
  { id: 'p4', company: 'A Client', status: 'Client' },
  { id: 'p5', company: 'Parked', status: 'Hold Off' },
  { id: 'p6', company: 'Not On My Accounts', status: 'Prospect', cdm },
  { id: 'p7', company: 'Renamed Since', status: 'Prospect', climateTargets: [blankTarget()] },
];
const flag = (id, company, kind = 'noTargets') => ({ id, company, kind });
const flags = [
  flag('p1', 'Zeta'), flag('p2', 'Alpha'), flag('p3', 'Since Logged'), flag('p4', 'A Client'),
  flag('p5', 'Parked'), flag('p7', 'Old Name'), flag('gone', 'Deleted Co'), flag('p1', 'Zeta'),
  flag('p6', 'Not On My Accounts', 'hqRegion'),
];
const pRows = myAccountsNoTargetIssues({ myAccountsFlags: flags, prospects: mine, skipIds: new Set(['p4']) });
check('published, still empty, still active, not already listed, A to Z', pRows.map(r => r.company), ['Alpha', 'Renamed Since', 'Zeta']);
check('my accounts row shape', [pRows[0].id, pRows[0].type, pRows[0].source, pRows[0].prospectId, pRows[0].resolve], ['my-accounts-no-targets:p2', 'No targets', 'My Accounts', 'p2', { kind: 'noTargets' }]);
check('before the companies load, the published list stands', myAccountsNoTargetIssues({ myAccountsFlags: [flag('p1', 'Zeta')], prospects: [] }).map(r => r.company), ['Zeta']);
check('no em dash in the detail', /—/.test(pRows[0].detail), false);
check('nothing published, no rows', myAccountsNoTargetIssues({ myAccountsFlags: null, prospects: mine }), []);

// Strategic accounts: your companies the Strategic Accounts list names,
// treated like every other account for targets.
const list = [
  { Account: 'Strat One', Type: 'Global Strategic Account', Owner: 'Pat' },
  { Account: 'Strat Two', Type: 'Global Strategic Account' },
  { Account: 'Strat Parked', Type: 'Global Strategic Account' },
  { Account: 'Strat Logged', Type: 'Global Strategic Account' },
  { Account: 'Strat Theirs', Type: 'Global Strategic Account' },
  { Account: 'Nam Only', Type: 'NAM Strategic Account' },
  { Account: 'Already Listed', Type: 'Global Strategic Account' },
];
const strat = [
  { id: 's1', company: 'Strat One', status: 'Prospect', cdm },
  { id: 's2', company: 'Strat Two', status: 'Client', cdm, climateTargets: [blankTarget()] },
  { id: 's3', company: 'Strat Parked', status: 'Hold Off', cdm },
  { id: 's4', company: 'Strat Logged', status: 'Prospect', cdm, climateTargets: [noTargetRow()] },
  { id: 's5', company: 'Strat Theirs', status: 'Prospect', cdm: 'Someone Else' },
  { id: 's6', company: 'Nam Only', status: 'Prospect', cdm },
  { id: 's7', company: 'Already Listed', status: 'Prospect', cdm },
  { id: 's8', company: 'Not Strategic', status: 'Prospect', cdm },
];
const lookup = strategicLookup(withoutNamStrategicRows(list));
const sRows = strategicNoTargetIssues({ prospects: strat, lookup, isCdm: c => c === cdm, skipIds: new Set(['s7']) });
check('listed, yours, active, empty, not NAM-only, not already listed, A to Z', sRows.map(r => r.company), ['Strat One', 'Strat Two']);
check('strategic row shape', [sRows[0].id, sRows[0].type, sRows[0].source, sRows[0].prospectId, sRows[0].resolve], ['strategic-no-targets:s1', 'No targets', 'Strategic Accounts', 's1', { kind: 'noTargets' }]);
check('no em dash in the strategic detail', /—/.test(sRows[0].detail), false);
check('no list loaded, no strategic rows', strategicNoTargetIssues({ prospects: strat, lookup: null, isCdm: () => true }), []);

console.log(`noTargetsIssue: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

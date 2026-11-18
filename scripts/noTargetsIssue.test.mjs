// Issues tab "No targets": a tracked client of yours whose company popup
// Targets tab has nothing filled in. Run: node scripts/noTargetsIssue.test.mjs
import { detectNoTargets, detectProspectNoTargets } from '../src/utils/clientNoTargets.js';
import { hasTargetValues, blankTarget, noTargetRow } from '../src/utils/companyTargets.js';

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

// Your prospects: CDM is you, not a client, not a closed status.
const mine = [
  { id: 'p1', company: 'Zeta', status: 'Prospect', cdm },
  { id: 'p2', company: 'Alpha', status: '', cdm: 'D. Baldauf' },
  { id: 'p3', company: 'Has Targets', status: 'Prospect', cdm, climateTargets: [noTargetRow()] },
  { id: 'p4', company: 'A Client', status: 'Client', cdm },
  { id: 'p5', company: 'Gone', status: 'Old Client', cdm },
  { id: 'p6', company: 'Lost', status: 'Lost - Not Sold', cdm },
  { id: 'p7', company: 'Parked', status: 'hold off', cdm },
  { id: 'p8', company: 'Not Mine', status: 'Prospect', cdm: 'Someone Else' },
  { id: 'p9', company: 'No CDM', status: 'Prospect' },
  { id: 'p10', company: 'Blank Row', status: 'Prospect', cdm, climateTargets: [blankTarget()] },
];
const pRows = detectProspectNoTargets({ prospects: mine, cdmName: cdm });
check('your open, non-client prospects with nothing filled in, A to Z', pRows.map(r => r.company), ['Alpha', 'Blank Row', 'Zeta']);
check('prospect row shape', [pRows[0].id, pRows[0].type, pRows[0].source, pRows[0].prospectId, pRows[0].resolve], ['prospect-no-targets:p2', 'No targets', 'Prospects', 'p2', { kind: 'noTargets' }]);
check('never the same company as the client rows', detectNoTargets({ prospects: mine, cdmName: cdm, untrackedMap: {} }).map(r => r.company), ['A Client']);
check('no em dash in the prospect detail', /—/.test(pRows[0].detail), false);
check('no prospects, no rows', detectProspectNoTargets({ prospects: null, cdmName: cdm }), []);

console.log(`noTargetsIssue: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

// Issues tab "No targets": a tracked client of yours whose company popup
// Targets tab has nothing filled in. Run: node scripts/noTargetsIssue.test.mjs
import { detectNoTargets } from '../src/utils/clientNoTargets.js';
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

console.log(`noTargetsIssue: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

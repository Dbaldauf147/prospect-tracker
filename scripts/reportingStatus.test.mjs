// A substatus makes an account read as On Hold without touching its Status.
//
// Run: node scripts/reportingStatus.test.mjs
import { reportingStatus, ON_HOLD_STATUS } from '../src/utils/reportingStatus.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n  expected ${e}\n  actual   ${a}`); }
}

eq(reportingStatus({ status: 'Client', substatus: 'Paused budget' }), ON_HOLD_STATUS, 'client with a substatus reads On Hold');
eq(reportingStatus({ status: 'Qualifying', substatus: 'x' }), 'On Hold', 'any status with a substatus reads On Hold');
eq(reportingStatus({ status: 'Client', substatus: '  ' }), 'Client', 'blank substatus: saved status');
eq(reportingStatus({ status: 'Client' }), 'Client', 'no substatus: saved status');
eq(reportingStatus(null), '', 'nothing: blank');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

// A substatus makes an account read as Hold Off without touching its
// Status, and only a substatus puts it in the left-out map.
//
// Run: node scripts/reportingStatus.test.mjs
import { reportingStatus, hasSubstatus, substatusNameMap, withSubstatusLeftOut, SUBSTATUS_HOLD_STATUS } from '../src/utils/reportingStatus.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n  expected ${e}\n  actual   ${a}`); }
}

eq(SUBSTATUS_HOLD_STATUS, 'Hold Off', 'a substatus reads as the existing Hold Off status');
eq(reportingStatus({ status: 'Client', substatus: 'Paused budget' }), 'Hold Off', 'client with a substatus reads Hold Off');
eq(reportingStatus({ status: 'Qualifying', substatus: 'x' }), 'Hold Off', 'any status with a substatus reads Hold Off');
eq(reportingStatus({ status: 'Client', substatus: '  ' }), 'Client', 'blank substatus: saved status');
eq(reportingStatus({ status: 'Client' }), 'Client', 'no substatus: saved status');
eq(reportingStatus(null), '', 'nothing: blank');
eq([hasSubstatus({ substatus: 'x' }), hasSubstatus({ status: 'Hold Off' })], [true, false], 'Hold Off by Status alone has no substatus');
eq(substatusNameMap([
  { company: 'Acme', status: 'Client', substatus: 'Budget freeze' },
  { company: 'Beta', status: 'Hold Off' },
  { company: 'Gamma', status: 'Client' },
]), { acme: true }, 'only a substatus is left out, not a saved Hold Off');
eq(withSubstatusLeftOut({ zed: true }, [{ company: 'Acme', substatus: 'x' }]), { zed: true, acme: true }, 'merged into the Don\'t Track map');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

// A substatus makes an account read as Hold Off without touching its
// Status, and only a substatus puts it in the left-out map.
//
// Run: node scripts/reportingStatus.test.mjs
import { reportingStatus, hasSubstatus, substatusNameMap, withSubstatusLeftOut, withCoverageLeftOut, holdOffMissingSubstatus, SUBSTATUS_HOLD_STATUS } from '../src/utils/reportingStatus.js';
import { excludeUntrackedFromWeek } from '../src/utils/progressUntracked.js';

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

// The coverage charts leave out Hold Off (by status or substatus) and Old
// Client, and nothing else.
const coverageMap = withCoverageLeftOut({ zed: true }, [
  { company: 'Acme', status: 'Client', substatus: 'Budget freeze' },
  { company: 'Beta', status: 'Hold Off' },
  { company: 'Old Co', status: 'Old Client' },
  { company: 'Gamma', status: 'Client' },
  { company: 'Lost Co', status: 'Lost - Not Sold' },
]);
eq(coverageMap, { zed: true, acme: true, beta: true, 'old co': true }, 'coverage leaves out Hold Off and Old Client, keeps Don\'t Track');

// And a saved week is re-answered without them: 3 of 4 Tier 1 accounts
// had contacts; dropping the Old Client one (which had contacts) and the
// Hold Off one (which didn't) leaves 2 of 2.
const week = {
  t1Total: 4, t1WithContacts: 3, t1ContactPct: 75,
  details: { t1WithContacts: ['Old Co', 'Gamma', 'Delta'], t1NoContacts: ['Beta'] },
};
const adjusted = excludeUntrackedFromWeek(week, new Set(Object.keys(coverageMap)));
eq([adjusted.t1Total, adjusted.t1WithContacts, adjusted.t1ContactPct], [2, 2, 100], 'a saved week re-answered without them');

eq(holdOffMissingSubstatus({ status: 'Hold Off' }), true, 'Hold Off with no substatus is warned about');
eq(holdOffMissingSubstatus({ status: 'Hold Off', substatus: '  ' }), true, 'a blank substatus counts as none');
eq(holdOffMissingSubstatus({ status: 'Hold Off', substatus: 'Budget freeze' }), false, 'Hold Off with a substatus is fine');
eq(holdOffMissingSubstatus({ status: 'Client' }), false, 'other statuses are not warned about');
eq(holdOffMissingSubstatus({ status: 'Client', substatus: 'Budget freeze' }), false, 'nor is a Client parked by a substatus');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

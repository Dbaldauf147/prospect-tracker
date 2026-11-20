// Assertion tests for the failed-address lookup Draft Emails marks red.
// Plain Node, no test framework. Run:
//   node scripts/failedEmailLookup.test.mjs
import { failedEmailMap, failedEmailTitle } from '../src/utils/failedEmailLookup.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const campaigns = [
  { title: 'Q3 Outreach', contacts: [
    { name: 'A', email: 'Bounced@x.com', sentDate: '2026-11-20', bounced: true, bounceDate: '2026-11-20T10:00:00Z' },
    { name: 'B', email: 'fine@x.com', sentDate: '2026-11-20' },
    { name: 'C', email: 'noticed@x.com', sentDate: '2026-11-19' },
    { name: 'D', email: 'fixed@x.com', sentDate: '2026-11-19' },
  ] },
];
const bad = {
  'noticed@x.com': { at: '2026-11-19T12:00:00Z', reason: 'Mailbox not found' },
  'fixed@x.com': { at: '2026-11-19T12:00:00Z', clearedAt: '2026-11-20T09:00:00Z' },
};
const map = failedEmailMap(campaigns, bad);

check('a campaign bounce and an open notice are failed', [...map.keys()].sort(), ['bounced@x.com', 'noticed@x.com']);
check('a delivered address is not', map.has('fine@x.com'), false);
check('a notice marked fixed is not', map.has('fixed@x.com'), false);
check('the notice reason comes along', map.get('noticed@x.com').reason, 'Mailbox not found');
check('nothing to read', failedEmailMap(null, null).size, 0);
check('hover text names the reason', /failed.*Q3 Outreach.*Reason: Mailbox not found/.test(failedEmailTitle(map.get('noticed@x.com'))), true);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

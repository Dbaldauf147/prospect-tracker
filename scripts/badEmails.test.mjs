// Bad email addresses from bounce notices (utils/badEmails).
// Run: node scripts/badEmails.test.mjs
import { badEmailInfo, withBounces, badEmailsUpdate, clearBadEmailUpdate, badEmailTitle } from '../src/utils/badEmails.js';

let passed = 0, failed = 0;
function ok(c, n) { if (c) { passed++; console.log(`PASS  ${n}`); } else { failed++; console.log(`FAIL  ${n}`); } }

const b1 = { address: 'HarveyW@Nationwide.com', at: '2026-11-16T16:26:08Z', subject: 'Delivery Status Notification (Failure)', reason: '5.1.0 Unknown address' };
const m1 = withBounces({}, [b1]);
ok(!!badEmailInfo(m1, 'harveyw@nationwide.com'), 'flagged, any case');
ok(withBounces(m1, [b1]) === null, 'the same notice again changes nothing');
const cleared = clearBadEmailUpdate('harveyw@nationwide.com', '2026-11-17T00:00:00Z')({ badEmails: m1 }).badEmails;
ok(!badEmailInfo(cleared, 'harveyw@nationwide.com'), 'Mark fixed clears it');
ok(withBounces(cleared, [b1]) === null, 'and the old notice found again does not bring it back');
const later = withBounces(cleared, [{ ...b1, at: '2026-11-20T10:00:00Z' }]);
ok(!!badEmailInfo(later, 'harveyw@nationwide.com'), 'a newer bounce flags it again');
ok(badEmailsUpdate([])({}) === null, 'no bounces, no save');
ok(badEmailInfo(m1, 'someone@else.com') === null, 'other addresses are fine');
ok(badEmailTitle(badEmailInfo(m1, 'harveyw@nationwide.com')).startsWith('Bounced on '), 'tooltip');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

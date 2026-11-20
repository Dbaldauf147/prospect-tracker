// Bad email addresses from bounce notices (utils/badEmails).
// Run: node scripts/badEmails.test.mjs
import { badEmailInfo, withBounces, badEmailsUpdate, clearBadEmailUpdate, badEmailTitle, contactFailedEmails, recordFailedEmailUpdate, removeFailedEmailUpdate, failedEmailChipTitle } from '../src/utils/badEmails.js';

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

// Failed addresses a contact has moved off.
const info = badEmailInfo(m1, 'harveyw@nationwide.com');
const f1 = recordFailedEmailUpdate('101', 'HarveyW@Nationwide.com', info, '2026-11-20T12:00:00Z')({});
ok(contactFailedEmails(f1.contactFailedEmails, 101)[0].email === 'harveyw@nationwide.com', 'replaced bounced address is filed on the contact');
ok(contactFailedEmails(f1.contactFailedEmails, '101')[0].reason === '5.1.0 Unknown address', 'with the bounce reason');
ok(recordFailedEmailUpdate('101', 'harveyw@nationwide.com', info)(f1) === null, 'filing it again changes nothing');
const f2 = recordFailedEmailUpdate('101', 'h.w@nationwide.com', { at: '2026-11-21T00:00:00Z' }, '2026-11-22T00:00:00Z')(f1);
ok(contactFailedEmails(f2.contactFailedEmails, '101').map(x => x.email).join() === 'h.w@nationwide.com,harveyw@nationwide.com', 'a second one goes first, the first is kept');
ok(contactFailedEmails(f2.contactFailedEmails, '999').length === 0, 'other contacts have none');
const f3 = removeFailedEmailUpdate('101', 'H.W@nationwide.com')(f2);
ok(contactFailedEmails(f3.contactFailedEmails, '101').length === 1, 'one can be removed');
ok(!('101' in removeFailedEmailUpdate('101', 'harveyw@nationwide.com')(f3).contactFailedEmails), 'removing the last drops the contact key');
ok(removeFailedEmailUpdate('101', 'nobody@x.com')(f3) === null, 'removing one not there changes nothing');
ok(recordFailedEmailUpdate('', 'a@b.com', info)({}) === null, 'no contact id, no save');
ok(failedEmailChipTitle(contactFailedEmails(f1.contactFailedEmails, '101')[0]).startsWith('Bounced on '), 'chip tooltip');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

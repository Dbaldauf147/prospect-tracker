// Bad email addresses from bounce notices (utils/badEmails).
// Run: node scripts/badEmails.test.mjs
import { badEmailInfo, withBounces, badEmailsUpdate, clearBadEmailUpdate, badEmailTitle, contactFailedEmails, recordFailedEmailUpdate, removeFailedEmailUpdate, failedEmailChipTitle, contactMovedOffEmail, contactBouncedEmails } from '../src/utils/badEmails.js';

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

// Every bounced address of a contact, for the popup's Failed emails line.
{
  const map = {
    'now@x.com': { at: '2026-11-22T00:00:00Z', reason: 'No such user' },
    'old1@x.com': { at: '2026-11-10T00:00:00Z', reason: 'Gone' },
    'fixed@x.com': { at: '2026-11-01T00:00:00Z', clearedAt: '2026-11-02T00:00:00Z' },
  };
  const stored = [
    { email: 'moved@x.com', at: '2026-11-05T00:00:00Z', reason: 'r', replacedAt: '2026-11-06T00:00:00Z' },
    { email: 'old1@x.com', at: '2026-11-10T00:00:00Z', reason: 'Gone', replacedAt: '2026-11-11T00:00:00Z' },
  ];
  const all = contactBouncedEmails(stored, map, { current: 'Now@X.com', oldEmails: 'old1@x.com; fixed@x.com, never@x.com' });
  ok(all.map(x => x.email).join() === 'now@x.com,old1@x.com,moved@x.com', `current first, then newest bounce, one per address (${all.map(x => x.email).join()})`);
  ok(all[0].current && !all[0].recorded && all[1].recorded, 'the current one is marked, stored ones can be removed');
  ok(contactBouncedEmails([], map, { current: 'ok@x.com', oldEmails: 'old1@x.com' }).map(x => x.email).join() === 'old1@x.com', 'a bounced Old Emails address is listed without being stored');
  ok(contactBouncedEmails(stored, map, { current: 'fixed@x.com' }).length === 2, 'a current address marked fixed is not listed');
  ok(contactBouncedEmails(null, null).length === 0, 'nothing known, nothing listed');
  ok(/address on the contact now/.test(failedEmailChipTitle(all[0])), 'tooltip says which is the current address');
}

// Opening a contact by an address they have moved off.
const people = [{ id: 55, email: 'x@y.com' }, { id: '101', email: 'harvey.w@nationwide.com' }];
ok(contactMovedOffEmail('HarveyW@Nationwide.com', people, f1.contactFailedEmails)?.id === '101', 'a replaced failed address finds its contact');
ok(contactMovedOffEmail('x@y.com', people, f1.contactFailedEmails) === null, 'an address nobody moved off finds nobody');
ok(contactMovedOffEmail('harveyw@nationwide.com', [{ id: 55 }], f1.contactFailedEmails) === null, 'nor when the contact is not in the list');
ok(contactMovedOffEmail('harveyw@nationwide.com', people) === null, 'nothing published, nobody found');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

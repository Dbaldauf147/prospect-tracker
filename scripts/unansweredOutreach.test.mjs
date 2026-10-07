// Assertion tests for the All Contacts "No Reply" count. Run:
//   node scripts/unansweredOutreach.test.mjs
//
// The rules worth pinning: only emails sent after the contact's last reply
// count, a reply resets the run to 0, cc'd addresses aren't counted, and a
// blank sender falls back to HubSpot's hs_email_direction.
import { buildUnansweredIndex, emailDirection } from '../src/utils/unansweredOutreach.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const out = (to, ts, extra = {}) => ({ hs_email_from_email: 'dan@se.com', hs_email_to_email: to, hs_timestamp: ts, ...extra });
const inn = (from, ts) => ({ hs_email_from_email: from, hs_email_to_email: 'dan@se.com', hs_timestamp: ts });

check('direction: se.com sender is outbound', emailDirection(out('a@x.com', '2026-01-01')), 'out');
check('direction: other sender is inbound', emailDirection(inn('a@x.com', '2026-01-01')), 'in');
check('direction: own work email is outbound', emailDirection({ hs_email_from_email: 'Me@Gmail.com' }, 'me@gmail.com'), 'out');
check('direction: blank sender uses INCOMING_EMAIL', emailDirection({ hs_email_direction: 'INCOMING_EMAIL' }), 'in');
check('direction: blank sender uses EMAIL', emailDirection({ hs_email_direction: 'EMAIL' }), 'out');

const idx = buildUnansweredIndex([
  out('a@x.com', '2026-01-01'),
  inn('A@x.com', '2026-01-02'),
  out('a@x.com', '2026-01-03'),
  out('a@x.com; b@x.com', '2026-01-04'),
  out('b@x.com', '2026-01-05', { hs_email_cc_email: 'c@x.com' }),
  out('d@x.com', '2026-01-01'),
  inn('d@x.com', '2026-01-02'),
  out('e@x.com', '2026-01-01', { hs_email_subject: 'Hi (Sample Email)' }),
]);
check('emails after the last reply count', idx['a@x.com']?.count, 2);
check('last reply recorded', idx['a@x.com']?.lastReplyMs, new Date('2026-01-02').getTime());
check('never replied counts every send', idx['b@x.com']?.count, 2);
check('no reply on record is null', idx['b@x.com']?.lastReplyMs, null);
check('cc is not counted', idx['c@x.com'], undefined);
check('a reply resets to nothing unanswered', idx['d@x.com'], undefined);
check('sample emails ignored', idx['e@x.com'], undefined);
check('empty feed', buildUnansweredIndex(null), {});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

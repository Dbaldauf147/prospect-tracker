// Assertion tests for the All Contacts "No Reply" count. Run:
//   node scripts/unansweredOutreach.test.mjs
//
// The rules worth pinning: only emails sent after the contact's last reply
// count, a reply resets the run to 0, cc'd addresses aren't counted, a blank
// sender falls back to HubSpot's hs_email_direction, and a bulk / sequence
// send logged with a blank To line still counts through its associated
// contact IDs.
import { buildUnansweredIndex, emailDirection, unansweredFor, campaignSendsByAddress } from '../src/utils/unansweredOutreach.js';
import { latestCampaignReplies } from '../src/utils/campaignReplies.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const ms = (d) => new Date(d).getTime();
const out = (to, ts, extra = {}) => ({ hs_email_from_email: 'dan@se.com', hs_email_to_email: to, hs_timestamp: ts, ...extra });
const inn = (from, ts) => ({ hs_email_from_email: from, hs_email_to_email: 'dan@se.com', hs_timestamp: ts });

check('direction: se.com sender is outbound', emailDirection(out('a@x.com', '2026-01-01')), 'out');
check('direction: other sender is inbound', emailDirection(inn('a@x.com', '2026-01-01')), 'in');
check('direction: Name <addr> sender parsed', emailDirection({ hs_email_from_email: 'Dan B <dan@se.com>' }), 'out');
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
  // Sequence sends: blank To, recipient only through the association.
  { hs_email_direction: 'EMAIL', hs_timestamp: '2026-02-01', _contactIds: ['7'] },
  { hs_email_direction: 'EMAIL', hs_timestamp: '2026-02-08', _contactIds: ['7', '8'] },
  inn('g@x.com', '2026-02-10'),
  // A send logged both ways is one email, not two.
  { ...out('h@x.com', '2026-03-01'), _contactIds: ['9'] },
]);
const f = (id, email) => unansweredFor({ index: idx }, { id, email });
check('emails after the last reply count', f('1', 'a@x.com').count, 2);
check('last reply recorded', f('1', 'a@x.com').lastReplyMs, ms('2026-01-02'));
check('never replied counts every send', f('2', 'b@x.com').count, 2);
check('no reply on record is null', f('2', 'b@x.com').lastReplyMs, null);
check('cc is not counted', f('3', 'c@x.com').count, 0);
check('a reply resets to 0', f('4', 'd@x.com').count, 0);
check('sample emails ignored', f('5', 'e@x.com').count, 0);
check('association-only sends count', f('7', 'f@x.com').count, 2);
check('address reply answers association sends', f('8', 'g@x.com'), { count: 0, lastSentMs: null, lastReplyMs: ms('2026-02-10'), emails: [] });
check('same send by address and id counts once', f('9', 'h@x.com').count, 1);
check('nobody on record', f('99', 'zz@x.com'), { count: 0, lastSentMs: null, lastReplyMs: null, emails: [] });
check('no sources', unansweredFor({}, { id: '1' }), null);
check('emails listed newest first with subject', f('1', 'a@x.com').emails.map(e => [e.ms, e.source]), [[ms('2026-01-04'), 'HubSpot'], [ms('2026-01-03'), 'HubSpot']]);

// Saved campaigns: counted on their own, merged with the feed without
// double counting, and reset by a campaign reply.
const camps = [
  { title: 'Q3 push', subject: 'Energy update', contacts: [
    // Never replied: two itemized sends plus one the capped history dropped.
    { email: 'k@x.com', sentDate: '2026-05-10', sendCount: 3, sendHistory: [
      { date: '2026-05-01T00:00:00Z', subject: 'Energy update' },
      { date: '2026-05-10T00:00:00Z', subject: 'RE: Energy update' },
    ] },
    // Replied after the first send, chased once more since.
    { email: 'm@x.com', sentDate: '2026-05-20', sendCount: 2, replied: true, replyDate: '2026-05-05T00:00:00Z', sendHistory: [
      { date: '2026-05-01T00:00:00Z', subject: 'Energy update' },
      { date: '2026-05-20T00:00:00Z', subject: 'RE: Energy update' },
    ] },
    // Saved before send counts existed: one send, from sentDate.
    { email: 'n@x.com', sentDate: '2026-06-01T00:00:00Z' },
    { email: 'h@x.com', sentDate: '2026-03-01', sendCount: 1, sendHistory: [{ date: '2026-03-01', subject: 'Energy update' }] },
  ] },
];
const src = { index: idx, campaignSends: campaignSendsByAddress(camps), campaignReplies: latestCampaignReplies(camps) };
const g = (id, email) => unansweredFor(src, { id, email });
check('campaign sends count, hidden ones included', g('k', 'k@x.com').count, 3);
check('campaign rows name the campaign', g('k', 'k@x.com').emails[0], { ms: ms('2026-05-10T00:00:00Z'), subject: 'RE: Energy update', source: 'Q3 push' });
check('hidden sends summarized last', g('k', 'k@x.com').emails[2], { ms: null, subject: '', source: 'Campaign', hidden: 1 });
check('campaign reply resets the run', g('m', 'm@x.com').count, 1);
check('pre-count campaign row worth one send', g('n', 'n@x.com').count, 1);
check('feed and campaign copy of one send count once', g('9', 'h@x.com').count, 1);
check('campaigns alone, feed not loaded yet', unansweredFor({ campaignSends: src.campaignSends }, { email: 'k@x.com' }).count, 3);

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

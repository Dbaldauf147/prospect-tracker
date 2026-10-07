// Assertion tests for the All Contacts "Campaign Reply" column. Run:
//   node scripts/campaignReplies.test.mjs
//
// Pinned: the newest reply across campaigns wins, a one-person row needs no
// name match, a group row only credits whoever actually replied, and rows
// without a reply (or a usable date) are ignored.
import { latestCampaignReplies, campaignReplyForContact } from '../src/utils/campaignReplies.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const camps = [
  { subject: 'Q1 intro', contacts: [
    { email: 'ann@x.com', replied: true, replyDate: '2026-01-10T12:00:00Z', repliedBy: 'Ann Lee' },
    { email: 'bob@x.com; cat@x.com', replied: true, replyDate: '2026-01-11T12:00:00Z', repliedBy: 'Cat Fox' },
    { email: 'dee@x.com', replied: false, replyDate: null },
    { email: 'eve@x.com; fay@x.com', replied: true, replyDate: '2026-01-12T12:00:00Z', repliedBy: 'fay@x.com' },
  ] },
  { subject: 'Q2 follow up', contacts: [
    { email: 'Ann@x.com', replied: true, replyDate: '2026-04-02T12:00:00Z', repliedBy: '' },
    { email: 'gus@x.com', replied: true, replyDate: 'not a date' },
  ] },
];
const r = latestCampaignReplies(camps);
const get = (email, name) => campaignReplyForContact(r, { email, name });

check('newest reply wins', get('ann@x.com', 'Ann Lee')?.subject, 'Q2 follow up');
check('count of campaign replies', get('ann@x.com', 'Ann Lee')?.count, 2);
check('label is the date', get('ann@x.com', 'Ann Lee')?.label, 'Apr 2, 2026');
check('group row credits the replier by name', get('cat@x.com', 'Cat Fox')?.subject, 'Q1 intro');
check('group row skips the others', get('bob@x.com', 'Bob Ray'), null);
check('group row credits the replier by address', get('fay@x.com', 'Fay')?.subject, 'Q1 intro');
check('group row: other member by address', get('eve@x.com', 'Eve'), null);
check('no reply', get('dee@x.com', 'Dee'), null);
check('bad date ignored', get('gus@x.com', 'Gus'), null);
check('no email', campaignReplyForContact(r, { name: 'Ann Lee' }), null);
check('no campaigns', campaignReplyForContact(latestCampaignReplies(null), { email: 'ann@x.com' }), null);

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

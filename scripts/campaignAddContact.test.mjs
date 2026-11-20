// Assertion tests for adding one contact to a saved campaign from the
// contact popup. Run: node scripts/campaignAddContact.test.mjs
import { addContactToCampaign, addContactsToCampaign, campaignHasContact, removeContactFromCampaign } from '../src/utils/campaignAddContact.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const camp = {
  subject: 'Q3 update',
  contacts: [
    { email: 'ann@x.com', sentDate: '2026-09-01', replied: true },
    { email: 'bob@x.com; cat@x.com', sentDate: '2026-09-02', replied: false },
  ],
  removedEmails: ['Dee@x.com', 'eve@x.com'],
  totalContacts: 2,
};

const r = addContactToCampaign(camp, { email: 'Dee@X.com ', name: 'Dee Kim', company: 'Delta' });
check('added', r.status, 'added');
check('row appended as Not Sent', r.campaign.contacts[2], {
  email: 'Dee@X.com', name: 'Dee Kim', company: 'Delta', sentDate: '', replied: false, eventStatus: '',
  recipientCount: 1, outreach: '', holdUntil: '', notes: '',
});
check('un-tombstoned, others kept', r.campaign.removedEmails, ['eve@x.com']);
check('counts re-derived', [r.campaign.totalContacts, r.campaign.sent, r.campaign.replies], [3, 2, 1]);
check('input untouched', camp.contacts.length, 2);
check('other fields kept', r.campaign.subject, 'Q3 update');

check('already there, case-insensitive', addContactToCampaign(camp, { email: 'ANN@x.com' }).status, 'already');
check('already there inside a group row', addContactToCampaign(camp, { email: 'cat@x.com' }).status, 'already');
check('no email', addContactToCampaign(camp, { email: '' }).status, 'no-email');
check('not an email', addContactToCampaign(camp, { email: 'nope' }).status, 'no-email');
check('colleagues left out', addContactToCampaign(camp, { email: 'dan@se.com' }).status, 'internal');
check('empty campaign', addContactToCampaign({ subject: 'x' }, { email: 'a@b.co' }).campaign.contacts.length, 1);
check('has contact', [campaignHasContact(camp, 'Bob@x.com'), campaignHasContact(camp, 'zed@x.com')], [true, false]);

// Several at once.
const many = addContactsToCampaign(camp, [
  { email: 'fay@x.com', name: 'Fay' },
  { email: 'ann@x.com', name: 'Ann' },
  { email: 'FAY@x.com', name: 'Fay again' },
  { email: '', name: 'No Email' },
  { email: 'dan@se.com', name: 'Dan' },
  { email: 'gus@x.com', name: 'Gus' },
]);
check('bulk added', many.added.map(c => c.name), ['Fay', 'Gus']);
check('bulk already, incl. a duplicate in the same batch', many.already.map(c => c.name), ['Ann', 'Fay again']);
check('bulk skipped', many.skipped.map(c => c.name), ['No Email', 'Dan']);
check('bulk roster and counts', [many.campaign.contacts.length, many.campaign.totalContacts], [4, 4]);
check('bulk input untouched', camp.contacts.length, 2);
check('bulk nothing to add keeps the campaign', addContactsToCampaign(camp, [{ email: 'ann@x.com' }]).campaign, camp);

// Taking one contact off from the contact popup.
{
  const r1 = removeContactFromCampaign(camp, 'ANN@x.com');
  check('remove: status', r1.status, 'removed');
  check('remove: own row gone', r1.campaign.contacts.map(c => c.email), ['bob@x.com; cat@x.com']);
  check('remove: tombstoned', r1.campaign.removedEmails, ['Dee@x.com', 'eve@x.com', 'ann@x.com']);
  check('remove: counts', [r1.campaign.totalContacts, r1.campaign.sent, r1.campaign.replies], [1, 1, 0]);
  check('remove: input untouched', camp.contacts.length, 2);
  const r2 = removeContactFromCampaign(camp, 'cat@x.com');
  check('remove from group: others kept', r2.campaign.contacts[1].email, 'bob@x.com');
  check('remove from group: activity kept', r2.campaign.contacts[1].sentDate, '2026-09-02');
  check('remove from group: count', r2.campaign.contacts[1].recipientCount, 1);
  check('remove from group: still has others', campaignHasContact(r2.campaign, 'bob@x.com'), true);
  check('remove from group: gone', campaignHasContact(r2.campaign, 'cat@x.com'), false);
  check('remove: not on', removeContactFromCampaign(camp, 'zed@x.com').status, 'not-on');
  check('remove: no email', removeContactFromCampaign(camp, '').status, 'no-email');
  const back = addContactToCampaign(r1.campaign, { email: 'ann@x.com' });
  check('re-add after remove un-tombstones', back.campaign.removedEmails.includes('ann@x.com'), false);
}

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

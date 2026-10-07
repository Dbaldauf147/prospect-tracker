// Assertion tests for adding one contact to a saved campaign from the
// contact popup. Run: node scripts/campaignAddContact.test.mjs
import { addContactToCampaign, campaignHasContact } from '../src/utils/campaignAddContact.js';

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

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

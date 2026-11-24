// Delivered / failed counts per email format (src/utils/emailFormatDelivery.js).
// Run: node scripts/emailFormatDelivery.test.mjs
import { emailFormatDelivery, emailFormatDeliveryTitle } from '../src/utils/emailFormatDelivery.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const contacts = [
  { id: 1, email: 'dcrimmin@winnco.com', firstname: 'Darien', lastname: 'Crimmin' },
  { id: 2, email: 'rshapiro@winnco.com', firstname: 'Robert', lastname: 'Shapiro' },
  { id: 3, email: 'justin.forster@winnco.com', firstname: 'Justin', lastname: 'Forster' },
  // Moved off a guessed address after it bounced.
  { id: 4, email: 'george.beyer@winnco.com', firstname: 'George', lastname: 'Beyer' },
];
const failedByContact = { 4: [{ email: 'gbeyer@winnco.com', at: '2026-11-20T00:00:00Z' }] };
const campaigns = [
  { title: 'Webinar', contacts: [
    { email: 'dcrimmin@winnco.com', name: 'Darien Crimmin', sentDate: '2026-11-01' },
    { email: 'rshapiro@winnco.com', name: 'Robert Shapiro', sentDate: '2026-11-01', bounced: true },
    { email: 'justin.forster@winnco.com', name: 'Justin Forster', sentDate: '2026-11-01' },
    { email: 'gbeyer@winnco.com', name: 'George Beyer', sentDate: '2026-11-01' },
    // Not a contact on the card: the row's own name gives the format.
    { email: 'bbreton@winnco.com', name: 'Barbara Breton', sentDate: '2026-11-02' },
    // Drafted, never sent.
    { email: 'rlelauti@winnco.com', name: 'Rodney Lelauti' },
    { email: 'someone@other.com', name: 'Some One', sentDate: '2026-11-02' },
  ] },
  { title: 'Follow-up', contacts: [{ email: 'dcrimmin@winnco.com', name: 'Darien Crimmin', sentDate: '2026-11-10' }] },
];
const badEmails = {
  'gbeyer@winnco.com': { at: '2026-11-03T00:00:00Z', reason: 'Recipient address rejected' },
  // Marked fixed: no longer counts as failed.
  'justin.forster@winnco.com': { at: '2026-11-03T00:00:00Z', clearedAt: '2026-11-04T00:00:00Z' },
};
const entries = ['firstinitiallastname@winnco.com', 'firstname.lastname@winnco.com', 'winnco.com', 'firstname@nobody.com'];
const got = emailFormatDelivery(entries, { campaigns, badEmails, contacts, failedByContact });

const initial = got.get('firstinitiallastname@winnco.com');
check('initial format: delivered and failed addresses', [initial.delivered, initial.failed], [2, 2]);
check('a campaign bounce and a forwarded notice both fail', initial.failedEmails, ['gbeyer@winnco.com', 'rshapiro@winnco.com']);
check('two sends to one address are one address', [initial.deliveredEmails, initial.sends], [['bbreton@winnco.com', 'dcrimmin@winnco.com'], 5]);
const dotted = got.get('firstname.lastname@winnco.com');
check('dotted format: a marked-fixed flag is not a failure', [dotted.delivered, dotted.failed], [1, 0]);
const bare = got.get('winnco.com');
check('a bare domain counts every address on it', [bare.delivered, bare.failed], [3, 2]);
check('nothing sent: no entry', got.has('firstname@nobody.com'), false);
check('an unsent draft row is not counted', initial.deliveredEmails.includes('rlelauti@winnco.com'), false);

// A flagged address no campaign sent to still failed.
const onlyNotice = emailFormatDelivery(['firstinitiallastname@acme.com'], {
  badEmails: { 'jdoe@acme.com': { at: '2026-11-03T00:00:00Z' } },
  contacts: [{ id: 9, email: 'jdoe@acme.com', firstname: 'Jane', lastname: 'Doe' }],
}).get('firstinitiallastname@acme.com');
check('a failure notice without a campaign send', [onlyNotice.delivered, onlyNotice.failed, onlyNotice.sends], [0, 1, 0]);
check('empty input', emailFormatDelivery([], { campaigns }).size, 0);
check('title names the failed addresses', emailFormatDeliveryTitle(initial).includes('Failed: gbeyer@winnco.com, rshapiro@winnco.com'), true);
check('no em dash in the title', emailFormatDeliveryTitle(initial).includes('—'), false);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

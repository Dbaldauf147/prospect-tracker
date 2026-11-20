// Draft Emails To line: failed recipients move to the contact's new address.
// Run: node scripts/replacedFailedRecipients.test.mjs
import { withReplacedFailedEmails } from '../src/utils/replacedFailedRecipients.js';

let passed = 0, failed = 0;
function ok(c, n) { if (c) { passed++; console.log(`PASS  ${n}`); } else { failed++; console.log(`FAIL  ${n}`); } }

const bad = new Set(['dkatz@fiera.com', 'jim@lennar.com', 'old@x.com', 'a@dup.com']);
const isFailed = e => bad.has(e);
const contacts = [
  { id: '1', email: 'David.Katz@fiera.com' }, // new address chosen
  { id: '2', email: 'jim@lennar.com' },       // still the failed one
  { id: '9', email: 'new@x.com' },            // recipient below has no matching id
  { id: '4', email: 'b@dup.com' },
];
const to = [
  { id: 'self', email: 'me@se.com' },
  { id: '1', name: 'David Katz', email: 'dkatz@fiera.com' },
  { id: '2', email: 'jim@lennar.com' },
  { id: 'lead-7', email: 'old@x.com' },
  { id: '3', email: 'fine@x.com' },
];
const out = withReplacedFailedEmails(to, contacts, isFailed, { 9: [{ email: 'old@x.com' }] });
ok(out[1].email === 'David.Katz@fiera.com' && out[1].name === 'David Katz', 'a failed recipient takes the contact\'s new address');
ok(out[2] === to[2], 'no new address chosen: left as it is');
ok(out[3].email === 'new@x.com', 'found through the failed-email record when the id does not match');
ok(out[0] === to[0] && out[4] === to[4], 'recipients that did not fail are untouched');
ok(withReplacedFailedEmails(out, contacts, isFailed, {}) === out, 'nothing left to change returns the same array');
const dup = [{ id: '4', email: 'a@dup.com' }, { id: 'x', email: 'b@dup.com' }];
ok(withReplacedFailedEmails(dup, contacts, isFailed, {}) === dup, 'not swapped onto an address already on the To line');
ok(withReplacedFailedEmails(to, [{ id: '1', email: 'jim@lennar.com' }], isFailed, {}) === to, 'not swapped onto another failed address');
ok(withReplacedFailedEmails([], contacts, isFailed, {}).length === 0, 'empty To line');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

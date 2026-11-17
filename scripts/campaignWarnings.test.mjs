// Assertion tests for the incomplete-campaign warnings on the Prospecting
// ladder's market-updates step (src/utils/campaignWarnings.js).
// Plain Node, no framework. Run:
//   node scripts/campaignWarnings.test.mjs
import { campaignWarnings } from '../src/utils/campaignWarnings.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
const texts = (c) => campaignWarnings(c).map(w => w.text);

const done = { subject: 'Michigan Electric Market Risk', category: 'Energy Market Update', sentTo: { clients: true }, totalContacts: 10, uniqueRecipients: 10 };
eq(texts(done), [], 'a finished, fully set-up campaign has no warnings');

eq(texts({ title: 'SBT Email Outreach', totalContacts: 2, uniqueRecipients: 0, category: 'Sustainability' }),
  ['No subject line', 'Sent To not ticked', 'Nothing sent yet'], 'the SBT case: no subject, no audience, nothing sent');
eq(texts({ ...done, subject: 'TBD' }), ['No subject line'], 'a TBD subject is no subject');
eq(texts({ ...done, category: '  ' }), ['No category'], 'a blank category is flagged');
eq(texts({ ...done, uniqueRecipients: 7 }), ['3 still to send'], 'a part-sent campaign says how many are left');
eq(texts({ ...done, totalContacts: 0, uniqueRecipients: 0, contacts: [] }), ['No contacts yet'], 'an empty list is a set-up gap, not a send');
eq(campaignWarnings({ ...done, sentTo: {} }).map(w => w.kind), ['setup'], 'set-up gaps are marked as such');
eq(campaignWarnings({ ...done, uniqueRecipients: 1 }).map(w => w.kind), ['sending'], 'unfinished sending is marked as such');
eq(campaignWarnings(null), [], 'no campaign, no warnings');

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed ? 1 : 0);

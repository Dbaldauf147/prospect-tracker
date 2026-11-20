// Assertion tests for campaignsByAddress (HubSpot contacts Email Campaign
// column). Run: node scripts/contactCampaigns.test.mjs
import { campaignsByAddress } from '../src/utils/contactCampaigns.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const campaigns = [
  { title: 'Q3 Update', savedAt: '2026-07-01', contacts: [
    { email: 'Sam@Acme.com', sentDate: '2026-07-05' },
    { email: 'a@x.com; b@y.com', sentDate: '2026-07-06', replied: true },
  ] },
  { subjects: ['Q4 news'], savedAt: '2026-11-01', contacts: [
    { email: 'sam@acme.com' },
    { email: 'sam@acme.com', sentDate: '2026-10-01', replied: true },
  ] },
  { contacts: [{ email: 'z@z.com' }] },
];
const m = campaignsByAddress(campaigns);

check('newest campaign first, unsent row dated by savedAt', m.get('sam@acme.com').map(e => e.name), ['Q4 news', 'Q3 Update']);
check('duplicate rows in one campaign collapse', m.get('sam@acme.com').length, 2);
check('a reply on any duplicate row is kept', m.get('sam@acme.com')[0].replied, true);
check('unsent row beats an older send in the same campaign', m.get('sam@acme.com')[0].sent, false);
check('group row: both addresses', [m.get('a@x.com')[0].name, m.get('b@y.com')[0].replied], ['Q3 Update', true]);
check('untitled campaign', m.get('z@z.com')[0].name, '(untitled campaign)');
check('empty input', campaignsByAddress(null).size, 0);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

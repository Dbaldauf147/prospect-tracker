// Prospecting badge / ladder: DMs Without Activity people already on an
// email campaign are not counted as work left (utils/dmsCampaigns).
//
// Run: node scripts/dmsCampaigns.test.mjs
const { dmsNotOnCampaign, campaignAddressSet } = await import('../src/utils/dmsCampaigns.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}

const list = [
  { contact: { email: 'Kevin@Tricon.com' } },
  { contact: { email: 'helen@cbre.com' } },
  { contact: { email: 'old@x.com; ellie@harrison.com' } },
  { contact: { email: '' } },
];
const campaigns = [
  { title: 'TCT Email', contacts: [{ email: 'kevin@tricon.com' }] },
  { title: 'Other', contacts: [{ email: 'ELLIE@harrison.com' }, { email: '' }] },
];
const left = dmsNotOnCampaign(list, campaigns);
ok(left.length === 2, 'two of the four are on a campaign and drop out of the count');
ok(!left.some(e => /tricon/i.test(e.contact.email)), 'matched regardless of letter case');
ok(!left.some(e => /harrison/.test(e.contact.email)), 'any of a contact\'s addresses counts');
ok(left.some(e => e.contact.email === ''), 'a contact with no email is still counted');
ok(dmsNotOnCampaign(list, []).length === 4, 'no campaigns: everyone counts');
ok(dmsNotOnCampaign(null, campaigns).length === 0, 'no list: nothing');
ok(campaignAddressSet(campaigns).size === 2, 'blank addresses on a campaign are ignored');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

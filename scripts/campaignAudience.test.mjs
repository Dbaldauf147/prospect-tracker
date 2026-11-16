// "Sent To" on a saved campaign (utils/campaignAudience).
// Run: node scripts/campaignAudience.test.mjs
import { register } from 'node:module';
register('./stubs/loader.mjs', import.meta.url);
const { campaignAudience, withAudience, campaignIdentity, listWithAudience, CAMPAIGN_AUDIENCES } = await import('../src/utils/campaignAudience.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}

ok(CAMPAIGN_AUDIENCES.map(a => a.label).join(',') === 'Clients,Key Contacts,Prospects', 'the three audiences');
ok(JSON.stringify(campaignAudience({})) === '{"clients":false,"keyContacts":false,"prospects":false}', 'nothing ticked by default');
const a = withAudience({ title: 'CAP Webinar', pausedUntil: 'x' }, 'clients', true);
ok(a.sentTo.clients === true && a.pausedUntil === 'x', 'ticking keeps the rest of the campaign');
const b = withAudience(withAudience(a, 'prospects', true), 'clients', false);
ok(JSON.stringify(b.sentTo) === '{"prospects":true}', 'unticking removes the key');
ok(!('sentTo' in withAudience(b, 'prospects', false)), 'all unticked: no sentTo stored');

const list = [
  { title: 'Perspectives', subjects: ['Perspectives 2027 Invitation'] },
  { title: 'CAP Webinar', subjects: ['Capital Planning Webinar Invite'] },
];
ok(campaignIdentity(list[1]) === campaignIdentity({ title: 'cap webinar ', subjects: ['Capital Planning Webinar Invite'] }), 'identity ignores case and spaces');
const out = listWithAudience(list, { title: 'CAP Webinar', subjects: ['Capital Planning Webinar Invite'] }, 'keyContacts', true);
ok(out[1].sentTo?.keyContacts === true && !out[0].sentTo, 'only that campaign changes in the stored list');
let threw = false;
try { listWithAudience(list, { title: 'Gone' }, 'clients', true); } catch { threw = true; }
ok(threw, 'a campaign no longer stored is refused');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

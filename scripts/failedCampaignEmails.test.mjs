// The Failed Emails sub-tab's rows (src/utils/failedCampaignEmails.js).
// Run: node scripts/failedCampaignEmails.test.mjs
import { register } from 'node:module';
register('./stubs/loader.mjs', import.meta.url);
const { failedCampaignEmailRows, failedEmailCount, FAILED_SOURCE, FAILED_STATE } = await import('../src/utils/failedCampaignEmails.js');

let passed = 0, failed = 0;
function ok(c, n) { if (c) { passed++; console.log(`PASS  ${n}`); } else { failed++; console.log(`FAIL  ${n}`); } }

const bad = {
  'harveyw@nationwide.com': { at: '2026-11-16T16:26:08Z', subject: 'Undeliverable: Q4 update', reason: '5.1.0 Unknown address' },
  'old@acme.com': { at: '2026-10-01T10:00:00Z', subject: 'Delivery failure', reason: 'mailbox full', clearedAt: '2026-10-05T00:00:00Z' },
  'notoncampaign@x.com': { at: '2026-11-10T10:00:00Z', subject: 's', reason: 'r' },
};
const campaigns = [
  { title: 'Q4 Update', subjects: ['Q4 update'], contacts: [
    { email: 'HarveyW@Nationwide.com', name: 'Harvey W', company: 'Nationwide', sentDate: '2026-11-15' },
    { email: 'fine@ok.com', sentDate: '2026-11-15' },
    { email: 'caught@foo.com', bounced: true, bounceDate: '2026-11-12T00:00:00Z', sentDate: '2026-11-11' },
    { email: 'a@grp.com; old@acme.com', sentDate: '2026-09-30' },
  ] },
  { subjects: ['Webinar invite'], contacts: [
    { email: 'harveyw@nationwide.com', bounced: true, bounceDate: '2026-11-01' },
  ] },
];
const rows = failedCampaignEmailRows(campaigns, bad);
ok(rows.length === 4, `four failed rows (got ${rows.length})`);
ok(!rows.some(r => r.email === 'fine@ok.com'), 'a delivered contact is left out');
ok(!rows.some(r => r.email === 'notoncampaign@x.com'), 'a bad email on no campaign is left out');
const h1 = rows.find(r => r.email === 'harveyw@nationwide.com' && r.campaignIndex === 0);
ok(h1?.source === FAILED_SOURCE.NOTICE && h1.reason === '5.1.0 Unknown address' && h1.name === 'Harvey W', 'forwarded notice row');
const h2 = rows.find(r => r.email === 'harveyw@nationwide.com' && r.campaignIndex === 1);
ok(h2?.source === FAILED_SOURCE.BOTH && h2.campaign === 'Webinar invite', 'notice + campaign bounce, campaign named by its subject');
const caught = rows.find(r => r.email === 'caught@foo.com');
ok(caught?.source === FAILED_SOURCE.CAMPAIGN && caught.failedAt.startsWith('2026-11-12'), 'campaign-caught bounce');
const grp = rows.find(r => r.email === 'old@acme.com');
ok(grp?.state === FAILED_STATE.FIXED && grp.name === '', 'group send: the noticed address, marked fixed');
ok(rows[0].failedAt >= rows[1].failedAt, 'newest first');
ok(failedEmailCount(rows) === 2, 'badge counts distinct still-bad addresses');
ok(failedCampaignEmailRows(null, null).length === 0, 'nothing in, nothing out');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

// The services on an email campaign (src/utils/campaignServices.js).
// Run: node scripts/campaignServices.test.mjs
import { register } from 'node:module';
register('./stubs/loader.mjs', import.meta.url);
const { campaignServices, withServices, sameServices, campaignServiceOptions } = await import('../src/utils/campaignServices.js');
const { campaignSummaryRow, CAMPAIGN_SUMMARY_HEADERS } = await import('../src/utils/campaignExport.js');

let passed = 0, failed = 0;
function ok(c, n) { if (c) { passed++; console.log(`PASS  ${n}`); } else { failed++; console.log(`FAIL  ${n}`); } }

ok(campaignServices({}).length === 0, 'none by default');
ok(JSON.stringify(campaignServices({ services: [' Advisory ', 'advisory', '', 'Utility Bill  Mgmt'] })) === '["Advisory","Utility Bill Mgmt"]', 'tidied, once each');
const c = withServices({ title: 'Q4' }, ['Advisory']);
ok(c.services[0] === 'Advisory' && c.title === 'Q4', 'set');
ok(!('services' in withServices(c, [])), 'cleared removes the field (no undefined for Firestore)');
ok(sameServices({ services: ['A', 'b'] }, { services: ['B', 'a'] }), 'same, order and case aside');
ok(!sameServices({ services: ['A'] }, {}), 'different');
const opts = campaignServiceOptions({});
ok(opts.length > 5, `the default Services board offers services (${opts.length})`);
ok(opts.every((o, i) => i === 0 || opts[i - 1].localeCompare(o) <= 0), 'A to Z');
ok(new Set(opts.map(o => o.toLowerCase())).size === opts.length, 'no duplicates');
const row = campaignSummaryRow({ subjects: ['x'], services: ['Advisory', 'Audits'] });
ok(CAMPAIGN_SUMMARY_HEADERS.at(-1) === 'Services' && row.at(-1) === 'Advisory, Audits', 'summary CSV carries Services last');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

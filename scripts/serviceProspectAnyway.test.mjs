// "Prospect anyway" on a Not Sold service (src/utils/serviceProspectAnyway.js),
// and what it does to the open / decided split and the Prospecting lists.
// Run: node scripts/serviceProspectAnyway.test.mjs
import { register } from 'node:module';
register('./stubs/loader.mjs', import.meta.url);
const { isProspectAnyway, prospectsAnyway, withProspectAnyway, PROSPECT_ANYWAY_FIELD } = await import('../src/utils/serviceProspectAnyway.js');
const { serviceDecision } = await import('../src/utils/accountPotential.js');
const { dealHasStatus } = await import('../src/utils/prospectingDeals.js');
const { SERVICE_KEYED_PROSPECT_FIELDS } = await import('../src/utils/serviceNameMerges.js');

let passed = 0, failed = 0;
function ok(c, n) { if (c) { passed++; console.log(`PASS  ${n}`); } else { failed++; console.log(`FAIL  ${n}`); } }

const m = withProspectAnyway({}, 'Audits', true);
ok(m.Audits === true, 'switched on');
ok(!('Audits' in withProspectAnyway(m, 'Audits', false)), 'switched off removes the key');
const client = { servicesExplored: { Audits: 'Not Sold', Advisory: 'Not Sold', Billing: 'Sold' }, [PROSPECT_ANYWAY_FIELD]: { Audits: true, Billing: true } };
ok(isProspectAnyway(client, 'Audits') && !isProspectAnyway(client, 'Advisory'), 'reads the flag');
ok(prospectsAnyway(client, 'Audits', 'Not Sold') && !prospectsAnyway(client, 'Billing', 'Sold'), 'only in force on Not Sold');

const audits = serviceDecision(client, 'Audits');
ok(audits.status === 'Not Sold' && audits.decided === false && audits.prospectAnyway === true, 'flagged Not Sold: still open, status kept');
const advisory = serviceDecision(client, 'Advisory');
ok(advisory.decided === true && advisory.prospectAnyway === false, 'unflagged Not Sold: decided');
ok(serviceDecision(client, 'Billing').decided === true, 'a flag on a Sold service does nothing');

ok(dealHasStatus({ status: 'Not Sold', prospectAnyway: true }) === false, 'Prospecting lists keep a Prospect-anyway deal');
ok(dealHasStatus({ status: 'Not Sold' }) === true, 'and still drop a plain Not Sold');
ok(SERVICE_KEYED_PROSPECT_FIELDS.includes(PROSPECT_ANYWAY_FIELD), 'follows a service rename');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

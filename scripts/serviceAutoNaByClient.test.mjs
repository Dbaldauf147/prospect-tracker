// Service Exploration Coverage reads a service N/A wherever the company
// popup's Services board would: a sold service retiring it, or its contact
// category N/A at the company (a contact's tag or the By Category heading).
//
// Run: node scripts/serviceAutoNaByClient.test.mjs
import { register } from 'node:module';
register('./stubs/loader.mjs', import.meta.url);
const { buildAutoNaByClient } = await import('../src/utils/serviceAutoNaByClient.js');
const { computeServiceCoverage } = await import('../src/utils/serviceCoverage.js');
const { serviceBucketContext } = await import('../src/utils/bucketServices.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}

const CAP = 'Capital asset planning';
const settings = {
  serviceOverrides: {
    [CAP]: { contactTags: 'Capital Planning' },
    'ESG module': { autoNa: 'SSO' },
  },
  contactTagReview: { 1: { 'Capital Planning': { answer: 'no', status: 'na' } } },
};
const names = serviceBucketContext(settings).names;
ok(names.includes(CAP) && names.includes('SSO') && names.includes('ESG module'), 'the default board has the services this test uses');

const bre = { id: 'bre', company: 'BRE Hotels & Resorts', status: 'Client' };
const park = { id: 'park', company: 'Park Hotels & Resorts', status: 'Client', servicesExplored: { [CAP]: 'Not Sold' } };
const heading = { id: 'h', company: 'Heading Co', status: 'Client', dmSearchSteps: { capitalplanning: { na: '2026-11-16' } } };
const soldEsg = { id: 's', company: 'Sold Co', status: 'Client', servicesExplored: { 'ESG module': 'Sold' } };
const plain = { id: 'p', company: 'Plain Co', status: 'Client' };
const clients = [bre, park, heading, soldEsg, plain];
const contacts = [
  { id: '1', firstname: 'Trista', lastname: 'Huang', company: 'BRE Hotels & Resorts', dans_tags: 'Decision Maker' },
  { id: '2', firstname: 'Pat', lastname: 'Park', company: 'Park Hotels & Resorts' },
];

const auto = buildAutoNaByClient(clients, { settings, contacts });
ok(auto.get(bre)?.has(CAP), 'a contact N/A on the category makes its service N/A at that client');
ok(auto.get(heading)?.has(CAP), 'the By Category heading N/A does too');
ok(auto.get(soldEsg)?.has('SSO'), 'a sold service retires its Auto-N/A list');
ok(!auto.has(plain), 'a client with neither has nothing N/A');

const cov = computeServiceCoverage(clients, CAP, null, auto);
const na = cov.na.map(x => x.p.company).sort();
ok(JSON.stringify(na) === JSON.stringify(['BRE Hotels & Resorts', 'Heading Co']), `BRE and Heading Co are N/A (${na.join(', ')})`);
ok(cov.explored.some(x => x.p === park && x.status === 'Not Sold'), 'a manual status still wins');
ok(cov.notExplored.map(x => x.p.company).sort().join(',') === 'Plain Co,Sold Co', 'the rest stay not yet explored');
ok(computeServiceCoverage(clients, CAP, null).notExplored.length === 4, 'without the map it reads as before');

// A contact pinned to the company counts there.
const pinned = buildAutoNaByClient([bre], {
  settings: { ...settings, contactLocalFields: { 3: { _companyOverride: 'BRE Hotels & Resorts' } }, contactTagReview: { 3: { 'Capital Planning': { status: 'na' } } } },
  contacts: [{ id: '3', firstname: 'Pin', lastname: 'Ned', company: 'Somewhere Else' }],
});
ok(pinned.get(bre)?.has(CAP), 'a Company pin puts the contact at the company');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

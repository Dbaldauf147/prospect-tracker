// A contact's N/A on a category's tag closes that category for the company,
// naming who: the company card's By Category heading, My Accounts > Company
// Data and the Prospecting tag table all read it through these two.
//
// Run: node scripts/contactNaBucket.test.mjs
import { register } from 'node:module';
register('./stubs/loader.mjs', import.meta.url);
const { contactNaByBucket } = await import('../src/utils/dmSteps.js');
const { companyClosedBuckets, categoryNaServices } = await import('../src/utils/bucketServices.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}

const cap = { key: 'capitalplanning', label: 'Capital Planning', tag: 'capital planning' };
const esg = { key: 'esg', label: 'ESG', tag: 'esg' };
const buckets = [cap, esg];
const trista = { id: '1', firstname: 'Trista', lastname: 'Huang', dans_tags: 'Decision Maker;ESG' };
const bob = { id: '2', firstname: 'Bob', lastname: 'Lee', dans_tags: '' };
const tagReview = {
  1: { 'Capital Planning': { answer: 'no', status: 'na' }, ESG: { answer: 'yes', status: '' } },
  2: { 'capital planning': { status: 'na' } },
};

const na = contactNaByBucket([trista, bob], tagReview, buckets);
ok(na.get('capitalplanning')?.map(x => x.name).join(',') === 'Trista Huang,Bob Lee', 'both N/A contacts are named, any spelling of the tag');
ok(!na.has('esg'), 'a Yes is not N/A');
ok(contactNaByBucket([trista], {}, buckets).size === 0, 'no tag records, nothing N/A');
ok(contactNaByBucket([{ firstname: 'No', lastname: 'Id' }], tagReview, buckets).size === 0, 'a contact with no id is skipped');

const rec = { company: 'BRE Hotels' };
ok(companyClosedBuckets(rec, null, buckets).size === 0, 'without contacts nothing is closed');
ok(companyClosedBuckets(rec, null, buckets, { contacts: [trista], tagReview }).has('capitalplanning'), 'a contact N/A closes the category (no service context)');
const ctx = { names: [], overrides: {}, byLower: new Map() };
const closed = companyClosedBuckets(rec, ctx, buckets, { contacts: [trista], tagReview });
ok(closed.has('capitalplanning') && !closed.has('esg'), 'a contact N/A closes only its own category (with service context)');
ok(companyClosedBuckets({ dmSearchSteps: { esg: { na: 'x' } } }, ctx, buckets, { contacts: [trista], tagReview }).size === 2, 'the heading N/A and a contact N/A both count');

// The services of an N/A category read N/A too (the Services tab).
const svcNames = ['Capital asset planning', 'ESG module', 'Goals & Projects'];
const overrides = { 'Capital asset planning': { contactTags: 'Capital Planning' }, 'ESG module': { contactTags: 'ESG' }, 'Goals & Projects': { contactTags: '' } };
const byContact = categoryNaServices({ buckets, serviceNames: svcNames, overrides, contacts: [trista], tagReview });
ok(byContact.get('Capital asset planning')?.why === 'Capital Planning is marked N/A by Trista Huang', `a contact N/A names them (${byContact.get('Capital asset planning')?.why})`);
ok(!byContact.has('ESG module') && !byContact.has('Goals & Projects'), 'services of other categories are untouched');
const byHeading = categoryNaServices({ buckets, serviceNames: svcNames, overrides, dmSearchSteps: { esg: { na: '2026-11-16' } } });
ok(byHeading.get('ESG module')?.why === 'ESG is marked N/A for this company' && byHeading.size === 1, 'the heading N/A does the same');
ok(categoryNaServices({ buckets, serviceNames: svcNames, overrides }).size === 0, 'nothing N/A, nothing changes');
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

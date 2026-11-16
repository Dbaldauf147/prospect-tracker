// The DM buttons keep a Not sold decision maker whose company is still being
// prospected on that topic (src/utils/procurementDmFilter.js, with
// src/utils/serviceProspectAnyway.js).
// Run: node scripts/dmTopicProspectAnyway.test.mjs
import { register } from 'node:module';
register('./stubs/loader.mjs', import.meta.url);
const { matchesDmTopic, companyProspectsTopic, DM_TOPICS } = await import('../src/utils/procurementDmFilter.js');

let passed = 0, failed = 0;
function ok(c, n) { if (c) { passed++; console.log(`PASS  ${n}`); } else { failed++; console.log(`FAIL  ${n}`); } }

const procurement = DM_TOPICS.find(t => t.key === 'procurement');
const esg = DM_TOPICS.find(t => t.key === 'esg');
const overrides = {
  'Supplier Engagement X': { contactTags: 'Procurement' },
  'ESG Reporting X': { contactTags: 'ESG' },
};
const dm = { id: 7, dans_tags: 'Decision Maker;Procurement;ESG' };
const notSold = { 7: { Procurement: { answer: 'yes', status: 'notsold' }, ESG: { answer: 'yes', status: 'notsold' } } };
const sold = { 7: { Procurement: { answer: 'yes', status: 'sold' } } };

const flagged = { company: 'Acme', servicesExplored: { 'Supplier Engagement X': 'Not Sold' }, serviceProspectAnyway: { 'Supplier Engagement X': true } };
const plain = { company: 'Acme', servicesExplored: { 'Supplier Engagement X': 'Not Sold' } };

ok(matchesDmTopic(dm, plain, notSold, procurement, overrides) === false, 'Not sold DM at a company not prospecting: still left out');
ok(matchesDmTopic(dm, flagged, notSold, procurement, overrides) === true, 'Not sold DM kept when the company marks a Procurement service Prospect');
ok(matchesDmTopic(dm, flagged, notSold, esg, overrides) === false, 'only the topic the flagged service is tagged with');
ok(matchesDmTopic(dm, flagged, sold, procurement, overrides) === false, 'a contact marked Sold stays out');
ok(matchesDmTopic(dm, flagged, {}, procurement, overrides) === true, 'an open DM is in, as before');
ok(matchesDmTopic({ id: 7, dans_tags: 'Procurement' }, flagged, notSold, procurement, overrides) === false, 'still has to be a Decision Maker');
ok(matchesDmTopic(dm, flagged, notSold, procurement, null) === false, 'no Contact Tags on the service: no match');

ok(companyProspectsTopic({ servicesExplored: { 'Supplier Engagement X': 'Sold' }, serviceProspectAnyway: { 'Supplier Engagement X': true } }, 'Procurement', overrides) === false, 'a stale mark on a service now Sold does not count');
ok(companyProspectsTopic({ servicesExplored: {}, serviceProspectAnyway: { 'Supplier Engagement X': true } }, 'Procurement', overrides) === true, 'Not Sold through an opp (no typed status) counts');
ok(companyProspectsTopic({ serviceProspectAnyway: { 'Supplier Engagement X': false } }, 'procurement', overrides) === false, 'a mark switched off does not count');
ok(companyProspectsTopic(null, 'Procurement', overrides) === false, 'no company');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

// Assertion tests for the Prospecting page's bulk Service Status. Run:
//   node scripts/prospectingBulkStatus.test.mjs
//
// Pinned: each company gets the status on its own listed service, a
// company already carrying it isn't written, rows with no record or no
// service are skipped, "-" clears, and the services named are reported.
import { planProspectingBulkStatus } from '../src/utils/prospectingBulkStatus.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const acme = { id: 'a', company: 'Acme', servicesExplored: { 'CDP climate': 'Sold' } };
const beta = { id: 'b', company: 'Beta', servicesExplored: {} };
const gamma = { id: 'g', company: 'Gamma', servicesExplored: { 'Bill Pay': 'Exploring' } };
const rows = [
  { prospect: acme, deal: { name: 'Bill Pay' } },
  { prospect: beta, deal: { name: 'GRESB quant' } },
  { prospect: gamma, deal: { name: 'Bill Pay' } },
  { prospect: null, deal: { name: 'Bill Pay' } },
  { prospect: { id: 'd', servicesExplored: {} }, deal: null },
];

const plan = planProspectingBulkStatus(rows, 'Exploring');
check('companies with a record and a service', plan.companies, 3);
check('services named, distinct and sorted', plan.services, ['Bill Pay', 'GRESB quant']);
check('already Exploring is not written', plan.same.map(c => c.id), ['g']);
check('the rest change', plan.change.map(e => e.client.id), ['a', 'b']);
check('each on its own service, others kept', plan.change[0].servicesExplored, { 'CDP climate': 'Sold', 'Bill Pay': 'Exploring' });
check('second company on its service', plan.change[1].servicesExplored, { 'GRESB quant': 'Exploring' });

const cleared = planProspectingBulkStatus(rows, '-');
check('"-" clears only where there is something to clear', cleared.change.map(e => e.client.id), ['g']);
check('cleared map drops the key', cleared.change[0].servicesExplored, {});

check('no status picked plans nothing', planProspectingBulkStatus(rows, '').change.length, 0);

const twice = planProspectingBulkStatus([
  { prospect: beta, deal: { name: 'GRESB quant' } },
  { prospect: beta, deal: { name: 'CDP climate' } },
], 'Quoted');
check('a company on two rows is written once', twice.change.length, 1);
check('with both services', twice.change[0].servicesExplored, { 'GRESB quant': 'Quoted', 'CDP climate': 'Quoted' });

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

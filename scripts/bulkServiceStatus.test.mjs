// Assertion tests for the Deal Sizing page's bulk service-status write —
// what "set this status on every client listed" would actually do.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/bulkServiceStatus.test.mjs
//
// This is the one action on that page that reaches the COMPANY RECORD, and it
// reaches thirty-odd of them at once. What has to hold is that it reports
// itself honestly before it runs: the count it offers is the count it will
// change, and a client it would leave exactly as it found them is never
// written to. A bulk write that says "33" and means "14" is one nobody can
// check afterwards, and the side effect is not small — a status makes a scope
// "on card", which takes that client's money out of the page's totals.
import {
  planBulkStatus,
  withServiceStatus,
  MIXED_STATUS,
} from '../src/utils/clientDealSizing.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

const clients = [
  { company: 'Alpha', servicesExplored: {} },
  { company: 'Beta', servicesExplored: { 'GRESB quant': 'Sold' } },
  { company: 'Gamma', servicesExplored: { 'CDP climate': 'Not Sold' } },
  { company: 'Delta', servicesExplored: {} },
];

const onGresb = () => ['GRESB quant'];
const plan = (status, servicesOf = onGresb, list = clients) =>
  planBulkStatus({ clients: list, status, servicesOf });

// ---- Only the clients the write would actually alter ---------------------
let p = plan('Sold');
check('the clients it would change are counted', p.change.length, 3);
check('a client already reading that way is left alone', p.same.length, 1);
check('and it is the right one', p.same[0].company, 'Beta');
check('nobody is skipped when every client has a service', p.skipped.length, 0);

// The map handed back is the one to write, not a patch.
const alpha = p.change.find(e => e.client.company === 'Alpha');
check('the new map carries the status', alpha.servicesExplored['GRESB quant'], 'Sold');
const gamma = p.change.find(e => e.client.company === 'Gamma');
check('and keeps what the client already had', gamma.servicesExplored['CDP climate'], 'Not Sold');

// ---- Clearing is a change, and an empty one is not -----------------------
// '-' is how the card writes "no status": the entry is removed so the service
// falls back to whatever a matching opp says, rather than being pinned blank.
p = plan('-');
check('clearing changes only the client that had one', p.change.length, 1);
check('and it is the one with the status', p.change[0].client.company, 'Beta');
check('the entry is removed, not set to a dash',
  Object.prototype.hasOwnProperty.call(p.change[0].servicesExplored, 'GRESB quant'), false);
check('a client with nothing to clear is not written to', p.same.length, 3);

// ---- Mixed is a reading, never a value ----------------------------------
p = plan(MIXED_STATUS);
check('Mixed writes to nobody', p.change.length, 0);
check('and is not quietly reported as a no-op either', p.same.length, 0);

// ---- Whole-scope mode ---------------------------------------------------
// The caller names the services per client, so the same planner answers
// "one service across the book" and "every service in each scope".
const scopes = {
  Alpha: ['GRESB quant', 'CDP climate'],
  Beta: ['GRESB quant'],
  Gamma: [],
  Delta: ['Audits'],
};
p = plan('Not Sold', (c) => scopes[c.company] || []);
check('a client with no services in scope is skipped', p.skipped.length, 1);
check('and named as skipped, not as unchanged', p.skipped[0].company, 'Gamma');
check('the rest are changed', p.change.length, 3);
const alphaScope = p.change.find(e => e.client.company === 'Alpha').servicesExplored;
check('every service in the scope gets the status', alphaScope['GRESB quant'], 'Not Sold');
check('including the second one', alphaScope['CDP climate'], 'Not Sold');

// ---- A pin over an opp-derived status still counts as a change ----------
// The stored map is what is compared, not the effective reading: a client
// showing Sold because an opportunity's Scope names the service is not the
// same as one whose card says Sold outright — the second survives the opp
// changing, and setting it is a real edit.
p = plan('Sold', onGresb, [{ company: 'Epsilon', servicesExplored: {} }]);
check('setting a status a client only reads from an opp is a change', p.change.length, 1);

// ---- Consistency with the single-row write ------------------------------
// The bulk path must produce exactly what the per-row picker produces, or the
// two would drift and the same action would mean two things.
const one = withServiceStatus(clients[0].servicesExplored, ['GRESB quant'], 'Verbal');
const bulk = plan('Verbal').change.find(e => e.client.company === 'Alpha').servicesExplored;
check('bulk and per-row write the same map', JSON.stringify(bulk), JSON.stringify(one));

// ---- Degenerate input ---------------------------------------------------
check('no clients is an empty plan', planBulkStatus({ clients: [], status: 'Sold', servicesOf: onGresb }).change.length, 0);
check('a blank service name is not a service',
  plan('Sold', () => ['  ']).skipped.length, 4);

console.log(failures === 0 ? '\nAll bulkServiceStatus tests passed.' : `\n${failures} bulkServiceStatus test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

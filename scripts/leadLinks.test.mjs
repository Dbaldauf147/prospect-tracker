// Assertion tests for the Marketing Leads Salesforce Link guard. Plain
// Node, no test framework. Run:
//   node scripts/leadLinks.test.mjs
//
// A run of the Salesforce Link agent lost every link it pasted: some
// writer rewrote settings.marketingLeads from a copy taken before the
// links were set. These cover the three layers that stop that happening
// again (the save guard, the ledger, recovery) and the import backfill.
import {
  guardLeadLinks, recordLeadLinks, ledgerRows, findRecoverableLinks, applyRecoveredLinks,
} from '../src/utils/leadLinks.js';
import { planLeadImport } from '../src/utils/marketingLeadsImport.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const URL_A = 'https://se.lightning.force.com/lightning/r/Lead/00QA/view';
const URL_B = 'https://se.lightning.force.com/lightning/r/Lead/00QB/view';
const lead = (over = {}) => ({ id: 'x', name: '', email: '', company: '', sfUrl: '', ...over });

// ---- the save guard --------------------------------------------------

const prev = [
  lead({ id: '1', name: 'Gracie Batchelor', sfUrl: URL_A }),
  lead({ id: '2', name: 'Victor Blancarte', sfUrl: URL_B }),
];
const stale = [
  lead({ id: '1', name: 'Gracie Batchelor', status: 'Working' }),
  lead({ id: '2', name: 'Victor Blancarte' }),
];
let g = guardLeadLinks(stale, prev);
eq(g.rows.map(r => r.sfUrl), [URL_A, URL_B], 'a stale rewrite cannot blank links the leads already carry');
eq(g.rows[0].status, 'Working', 'the rest of the stale write still lands');
eq(g.restored.length, 2, 'every restored link is reported');

g = guardLeadLinks(stale, prev, ['1']);
eq(g.rows.map(r => r.sfUrl), ['', URL_B], 'a deliberate clear of one lead goes through; the other is kept');

const untouched = prev.map(r => ({ ...r }));
g = guardLeadLinks(untouched, prev);
eq(g.rows === untouched, true, 'a write that blanks nothing comes back as the same array');

g = guardLeadLinks([lead({ id: '1', sfUrl: URL_B })], prev);
eq(g.rows[0].sfUrl, URL_B, 'changing a link to a different one is allowed');

g = guardLeadLinks(stale, stale, [], { 1: { url: URL_A, name: 'Gracie Batchelor' } });
eq(g.rows.map(r => r.sfUrl), [URL_A, ''], 'the ledger restores a link even when this tab already lost it');

// ---- the ledger ------------------------------------------------------

const ledger = recordLeadLinks({}, prev, [], 100);
eq(Object.keys(ledger), ['1', '2'], 'every link in a write is recorded');
eq(ledger['1'], { url: URL_A, name: 'Gracie Batchelor', email: '', at: 100 }, 'an entry carries url, name, email and time');
eq(recordLeadLinks(ledger, prev, [], 200) === ledger, true, 'recording the same links again changes nothing');
eq(Object.keys(recordLeadLinks(ledger, stale, [], 200)), ['1', '2'], 'a write without the links leaves the ledger alone');
eq(Object.keys(recordLeadLinks(ledger, stale, ['2'], 200)), ['1'], 'a deliberate clear drops that lead from the ledger');

// ---- recovery --------------------------------------------------------

const current = [
  lead({ id: '1', name: 'Gracie Batchelor' }),
  lead({ id: 'new9', name: 'Victor Blancarte', email: 'victor@cbre.com' }), // re-imported under a new id
  lead({ id: '3', name: 'Chris Kirk' }),
  lead({ id: '4', name: 'Daniel Burns', sfUrl: URL_B }),
];
const backup = [
  lead({ id: '2', name: 'Blancarte, Victor', email: 'Victor@CBRE.com', sfUrl: URL_B }),
  lead({ id: '8', name: 'Chris Kirk', sfUrl: URL_A }),
  lead({ id: '9', name: 'Chris Kirk', sfUrl: URL_B }),
];
const found = findRecoverableLinks(current, [
  { label: 'link history', rows: ledgerRows({ 1: { url: URL_A, name: 'Gracie Batchelor' } }) },
  { label: 'backup', rows: backup },
]);
eq(found.map(f => [f.id, f.url, f.source]), [
  ['1', URL_A, 'link history'],
  ['new9', URL_B, 'backup'],
], 'found by id from the ledger, and by email for a lead re-imported under a new id');
eq(found.some(f => f.id === '3'), false, 'a name shared by two different links is not guessed');

const applied = applyRecoveredLinks(current, [...found, { id: '4', url: URL_A }]);
eq(applied.map(r => r.sfUrl), [URL_A, URL_B, '', URL_B], 'recovery fills blanks only, never replaces a link');

// ---- the import backfill ---------------------------------------------

const saved = [lead({ id: 's1', name: 'Chris Kirk', email: 'chris@cbre.com' })];
const plan = planLeadImport({
  incoming: [lead({ name: 'Kirk, Chris', email: 'chris@cbre.com', sfUrl: URL_A })],
  saved,
});
eq(plan.additions.length, 0, 're-importing a saved lead does not add it again');
eq(plan.savedAfter[0].sfUrl, URL_A, '...but fills its missing link from the paste');
eq(plan.linksFilled, 1, '...and says how many links it filled');

const plan2 = planLeadImport({
  incoming: [lead({ name: 'Chris Kirk', email: 'chris@cbre.com', sfUrl: URL_B })],
  saved: [lead({ id: 's1', name: 'Chris Kirk', email: 'chris@cbre.com', sfUrl: URL_A })],
});
eq(plan2.savedAfter[0].sfUrl, URL_A, 'an import never replaces a link the lead already has');
eq(plan2.linksFilled, 0, '...and reports nothing filled');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

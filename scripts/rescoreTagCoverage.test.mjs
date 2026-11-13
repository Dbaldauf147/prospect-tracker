// Tests for rescoreTagCoverage: the Prospecting Tagged row narrowed to a
// chosen set of tag questions. Plain Node. Run:
//   node scripts/rescoreTagCoverage.test.mjs
import { rescoreTagCoverage } from '../src/utils/contactRosters.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// A tagged ESG, B answered "no" on Utilities locally, neither touched Procurement.
const a = { id: '1', name: 'A', company: '', email: '', answered: 1, total: 12, done: false, contact: { id: 1, dans_tags: 'ESG' } };
const b = { id: '2', name: 'B', company: '', email: '', answered: 1, total: 12, done: false, contact: { id: 2, dans_tags: '' } };
const review = { 2: { Utilities: { answer: 'no' } } };
const coverage = {
  cancelling: 1, untracked: 0,
  all: { contacts: 2, answered: 2, slots: 24, done: 0, people: [a, b], pct: 8 },
  key: { contacts: 1, answered: 1, slots: 12, done: 0, people: [a], pct: 8 },
  client: { contacts: 0, answered: 0, slots: 0, done: 0, people: [], pct: null },
};

eq(rescoreTagCoverage(coverage, [], review), coverage, 'no tags chosen returns the coverage untouched');
eq(rescoreTagCoverage(coverage, null, review), coverage, 'null tags returns the coverage untouched');

const esg = rescoreTagCoverage(coverage, ['ESG'], review);
eq([esg.all.pct, esg.all.answered, esg.all.slots, esg.all.done], [50, 1, 2, 1], 'ESG only: one of two answered');
eq([esg.key.pct, esg.key.done], [100, 1], 'ESG only: Key roster fully answered');
eq(esg.client.pct, null, 'empty roster stays empty');
eq(esg.cancelling, 1, 'exclusion counts carried over');
eq(esg.all.people.map(p => `${p.name}:${p.answered}/${p.total}`), ['B:0/1', 'A:1/1'], 'rows rescored, least-tagged first');

const two = rescoreTagCoverage(coverage, ['ESG', 'Utilities'], review);
eq([two.all.answered, two.all.slots, two.all.pct], [2, 4, 50], 'two tags: local answer counts');

const three = rescoreTagCoverage(coverage, ['ESG', 'Utilities', 'Procurement'], review);
eq([three.all.answered, three.all.slots, three.all.pct], [2, 6, 33], 'three tags');
eq(three.all.people.find(p => p.id === '1') === three.key.people[0], true, 'one row object shared across rosters');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

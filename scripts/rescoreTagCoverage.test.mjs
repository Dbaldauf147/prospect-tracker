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

// The Tagged table's lens: decision makers only, and only a Yes counts.
// D is a DM tagged ESG; E is a DM marked Not sure on ESG and No on Utilities;
// F is tagged ESG but isn't a decision maker, so is left out.
const d = { id: '4', name: 'D', company: '', email: '', answered: 0, total: 0, done: false, contact: { id: 4, dans_tags: 'Decision Maker; ESG' } };
const e = { id: '5', name: 'E', company: '', email: '', answered: 0, total: 0, done: false, contact: { id: 5, dans_tags: 'Decision Maker' } };
const f = { id: '6', name: 'F', company: '', email: '', answered: 0, total: 0, done: false, contact: { id: 6, dans_tags: 'ESG' } };
const dmReview = { 5: { ESG: { answer: 'unsure' }, Utilities: { answer: 'no' } } };
const dmCov = { all: { contacts: 3, answered: 0, slots: 0, done: 0, people: [d, e, f], pct: 0 } };
const lens = { decisionMakersOnly: true, yesOnly: true };
const dmEsg = rescoreTagCoverage(dmCov, ['ESG'], dmReview, lens);
eq([dmEsg.all.contacts, dmEsg.all.answered, dmEsg.all.pct], [2, 1, 50], 'lens: non-DM dropped, Not sure is not a Yes');
const dmUtil = rescoreTagCoverage(dmCov, ['Utilities'], dmReview, lens);
eq([dmUtil.all.answered, dmUtil.all.pct], [0, 0], 'lens: No is not a Yes');
const dmAll = rescoreTagCoverage(dmCov, [], dmReview, lens);
eq(dmAll.all.contacts, 2, 'lens with no tags picked still narrows to DMs');
eq(rescoreTagCoverage(dmCov, ['ESG'], dmReview).all.pct, 100, 'without the lens Not sure still counts as answered');

// By company: one DM tagged Yes covers the company, and its other contacts
// drop off the list. G and H are DMs at Acme, only G is tagged ESG; I is a
// DM at Beta with nothing.
const g = { id: '7', name: 'G', company: 'Acme', email: '', answered: 0, total: 0, done: false, contact: { id: 7, dans_tags: 'Decision Maker; ESG' } };
const h = { id: '8', name: 'H', company: 'acme ', email: '', answered: 0, total: 0, done: false, contact: { id: 8, dans_tags: 'Decision Maker' } };
const i9 = { id: '9', name: 'I', company: 'Beta', email: '', answered: 0, total: 0, done: false, contact: { id: 9, dans_tags: 'Decision Maker' } };
const coCov = { all: { contacts: 3, answered: 0, slots: 0, done: 0, people: [g, h, i9], pct: 0 } };
const coLens = { decisionMakersOnly: true, yesOnly: true, byCompany: true };
const coEsg = rescoreTagCoverage(coCov, ['ESG'], {}, coLens);
eq([coEsg.all.contacts, coEsg.all.done, coEsg.all.pct, coEsg.all.unit], [2, 1, 50, 'company'], 'by company: Acme covered by G alone');
eq(coEsg.all.people.map(p => p.name), ['I'], 'by company: covered company drops off the list');
const coTwo = rescoreTagCoverage(coCov, ['ESG', 'Utilities'], { 8: { Utilities: { answer: 'yes' } } }, coLens);
eq([coTwo.all.done, coTwo.all.answered, coTwo.all.slots], [0, 1, 4], 'by company: a stored Yes without the tag is not a Yes');
const coTwoTagged = rescoreTagCoverage({ all: { ...coCov.all, people: [g, { ...h, contact: { id: 8, dans_tags: 'Decision Maker; Utilities' } }, i9] } }, ['ESG', 'Utilities'], {}, coLens);
eq([coTwoTagged.all.done, coTwoTagged.all.pct], [1, 50], 'by company: two DMs can cover two tags between them');

// A tag closed at a company (its services all Not Sold or N/A) counts as
// covered there, so Beta drops off the ESG list.
const coClosed = rescoreTagCoverage(coCov, ['ESG'], {}, { ...coLens, closedFor: (p, tag) => p.company === 'Beta' && tag === 'ESG' });
eq([coClosed.all.done, coClosed.all.pct, coClosed.all.people.length], [2, 100, 0], 'by company: closed-by-services counts as covered');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

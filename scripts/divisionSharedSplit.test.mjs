// Assertion tests for typed divisions that share a name across companies.
// Plain Node, no test framework (the project has none). Run:
//   node scripts/divisionSharedSplit.test.mjs
//
// A typed division's id used to be its name alone, so "Real Estate" under
// Blackstone and under Nuveen were one box and the Blackstone team showed
// on Nuveen's chart. What's worth holding: a new typed division is its
// owner's own, and a box that is already shared is split with each
// company's people going to the right side whichever popup is opened first.
import {
  textDivisionId, addNamedDivisionPatch, renameDivisionPatch, splitSharedTextDivisionsPatch,
  divisionContactsFor, divisionsFor, isTextDivision,
} from '../src/utils/divisions.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// --- new typed divisions are scoped to their owner ----------------------------

eq(textDivisionId('Real Estate'), 'txt:real estate', 'a typed parent keeps the unscoped id');
eq(textDivisionId(' Real  Estate ', 'nuveen'), 'txt:nuveen::real estate', 'a typed division carries its owner');
{
  let s = {};
  s = { ...s, ...addNamedDivisionPatch(s, 'blackstone', 'Real Estate', []) };
  s = { ...s, ...addNamedDivisionPatch(s, 'nuveen', 'Real Estate', []) };
  const [b] = divisionsFor(s, 'blackstone');
  const [n] = divisionsFor(s, 'nuveen');
  eq([isTextDivision(b.id), isTextDivision(n.id), b.id !== n.id], [true, true, true], 'the same name under two companies is two boxes');
  eq(addNamedDivisionPatch(s, 'nuveen', 'real estate', []), null, 'the same name twice under one company is still refused');
  eq(splitSharedTextDivisionsPatch(s, 'nuveen', ['c9']), null, 'nothing shared, nothing to repair');
}
eq(renameDivisionPatch({ divisionsMap: { nuveen: [{ id: 'p7', company: 'Nuveen RE LLC' }] } }, 'nuveen', 'p7', 'Real Estate').divisionsMap.nuveen[0].id,
  'txt:nuveen::real estate', 'renaming a linked division into a typed one scopes it too');

// --- repairing a box that is already shared ------------------------------------

const SHARED = 'txt:real estate';
const legacy = {
  divisionsMap: {
    blackstone: [{ id: SHARED, company: 'Real Estate' }, { id: 'p5', company: 'BREIT' }],
    nuveen: [{ id: SHARED, company: 'Real Estate' }],
  },
  divisionContacts: {
    [SHARED]: [
      { id: 'b1', name: 'Dan Egan' }, { id: 'b2', name: 'Shea Drake' },
      { id: 'n1', name: 'Jay Gattani' }, { id: '', name: 'Typed By Hand' },
    ],
  },
  divisionLayout: { [SHARED]: 'row' },
};
const names = (s, id) => divisionContactsFor(s, id).map(c => c.name);

// Nuveen's popup opened first.
{
  const s = { ...legacy, ...splitSharedTextDivisionsPatch(legacy, 'nuveen', ['n1', 'n2']) };
  const mine = divisionsFor(s, 'nuveen')[0].id;
  eq(mine, 'txt:nuveen::real estate', 'Nuveen first: its copy gets an id of its own');
  eq(names(s, mine), ['Jay Gattani'], 'Nuveen first: only its own contact comes across');
  eq(names(s, SHARED), ['Dan Egan', 'Shea Drake', 'Typed By Hand'], 'Nuveen first: the Blackstone team stays on the other box');
  eq(divisionsFor(s, 'blackstone')[0].id, SHARED, 'Nuveen first: Blackstone\'s chart is untouched');
  eq(s.divisionLayout[mine], 'row', 'Nuveen first: the layout is copied');
  eq(splitSharedTextDivisionsPatch(s, 'nuveen', ['n1']), null, 'Nuveen first: a second look has nothing to do');
  eq(splitSharedTextDivisionsPatch(s, 'blackstone', ['b1', 'b2']), null, 'Nuveen first: Blackstone is no longer sharing either');
}

// Blackstone's popup opened first: same end state for the people with ids.
{
  const s = { ...legacy, ...splitSharedTextDivisionsPatch(legacy, 'blackstone', ['b1', 'b2']) };
  const theirs = divisionsFor(s, 'blackstone')[0].id;
  eq(names(s, theirs), ['Dan Egan', 'Shea Drake'], 'Blackstone first: its team goes with it');
  eq(names(s, SHARED), ['Jay Gattani', 'Typed By Hand'], 'Blackstone first: Nuveen keeps its own');
  eq(divisionsFor(s, 'blackstone')[1], { id: 'p5', company: 'BREIT' }, 'Blackstone first: a linked division is left alone');
}

// A company with none of the contacts still gets a box of its own, empty.
{
  const s = { ...legacy, ...splitSharedTextDivisionsPatch(legacy, 'nuveen', []) };
  eq(names(s, divisionsFor(s, 'nuveen')[0].id), [], 'no contacts of its own: an empty box, not somebody else\'s team');
  eq(names(s, SHARED).length, 4, 'and everybody stays where they were');
}

// The same typed division twice inside ONE chart: the first keeps the old id.
{
  const one = { divisionsMap: { root: [{ id: 'a', company: 'East' }, { id: 'b', company: 'West' }], a: [{ id: SHARED, company: 'Real Estate' }], b: [{ id: SHARED, company: 'Real Estate' }] } };
  const s = { ...one, ...splitSharedTextDivisionsPatch(one, 'root', []) };
  eq([s.divisionsMap.a[0].id, s.divisionsMap.b[0].id], [SHARED, 'txt:b::real estate'], 'shared inside one chart: the first keeps the id, the second gets its own');
}

eq(splitSharedTextDivisionsPatch({}, 'nuveen', []), null, 'no divisions at all is nothing to do');
eq(splitSharedTextDivisionsPatch(legacy, '', []), null, 'no company is nothing to do');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

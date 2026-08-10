// Assertion tests for the parent-company edge on the divisions chart.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/divisionParent.test.mjs
//
// A parent isn't a second mapping: it's the same divisionsMap edge read
// upward, which is the whole point (set a parent here and the company shows
// as its division on My Accounts). That sharing is also where the damage
// would be, so these tests lean on three things:
//
//   - setting a parent must not silently leave the company under two of
//     them, or a mapping appears on a popup nobody edited;
//   - a company must never end up its own ancestor — the chart's cycle
//     guard would hide it by drawing the same box above and below;
//   - a typed parent must keep the name as typed, since the `txt:` id is
//     lower-cased and can't be read back as a label.
import {
  divisionParentsFor,
  setDivisionParentPatch,
  isDivisionDescendant,
  divisionNameFor,
  removeDivisionPatch,
  addNamedDivisionPatch,
  textDivisionId,
} from '../src/utils/divisions.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// Three tracker companies plus whatever gets typed.
const COMPANIES = [
  { id: 'p1', company: 'Acme East' },
  { id: 'p2', company: 'Acme West' },
  { id: 'p3', company: 'Acme Holdings' },
];
const NAMES = new Map(COMPANIES.map(c => [c.id, c.company]));
const HOLDINGS_TXT = textDivisionId('Holdco Group');

// ---- reading the parent off the mapping -------------------------------------

eq(divisionParentsFor({}, 'p1', NAMES), [], 'no mapping, no parent');
eq(divisionParentsFor({ divisionsMap: { p3: [{ id: 'p1', company: 'Acme East' }] } }, 'p1', NAMES),
  [{ id: 'p3', company: 'Acme Holdings', missing: false }],
  'the owner of a list containing the company is its parent');
eq(divisionParentsFor({ divisionsMap: { p3: [{ id: 'p2', company: 'Acme West' }] } }, 'p1', NAMES),
  [], 'another company under the same parent is not this one\'s parent');

// The label comes from the live company name, not the snapshot stored on
// the edge — the same rule the boxes below the root follow.
eq(divisionParentsFor(
  { divisionsMap: { p3: [{ id: 'p1', company: 'Acme East (old)' }] } }, 'p1',
  new Map([['p3', 'Acme Holdings LLC']])),
[{ id: 'p3', company: 'Acme Holdings LLC', missing: false }],
'a renamed parent labels itself with its current name');

// A linked parent whose company record is gone is flagged, so it shows as a
// dashed box rather than vanishing and taking the edge with it.
eq(divisionParentsFor({ divisionsMap: { gone: [{ id: 'p1', company: 'Acme East' }] } }, 'p1', NAMES),
  [{ id: 'gone', company: 'gone', missing: true }], 'a dead link is flagged missing');

// A typed parent is never "missing" — it is its own text — and reads its
// label out of divisionNames.
eq(divisionParentsFor({
  divisionsMap: { [HOLDINGS_TXT]: [{ id: 'p1', company: 'Acme East' }] },
  divisionNames: { [HOLDINGS_TXT]: 'Holdco Group' },
}, 'p1', NAMES),
[{ id: HOLDINGS_TXT, company: 'Holdco Group', missing: false }],
'a typed parent keeps the name as typed');

// Two parents is legal in the mapping (a keyword rule can do it), so both
// are reported — the chart draws what's there rather than picking one.
eq(divisionParentsFor({
  divisionsMap: {
    p3: [{ id: 'p1', company: 'Acme East' }],
    p2: [{ id: 'p1', company: 'Acme East' }],
  },
}, 'p1', NAMES).map(p => p.company),
['Acme Holdings', 'Acme West'], 'both parents are reported, sorted by name');

// ---- setting a parent -------------------------------------------------------

const linked = setDivisionParentPatch({}, 'p1', 'Acme East', 'Acme Holdings', COMPANIES, null);
eq(linked.divisionsMap, { p3: [{ id: 'p1', company: 'Acme East' }] },
  'naming a tracker company links the edge to its record');
eq(linked.divisionNames, undefined, 'a linked parent needs no stored name');

const typed = setDivisionParentPatch({}, 'p1', 'Acme East', '  Holdco Group ', COMPANIES, null);
eq(typed.divisionsMap, { [HOLDINGS_TXT]: [{ id: 'p1', company: 'Acme East' }] },
  'a name with no record becomes a typed parent');
eq(divisionNameFor(typed, HOLDINGS_TXT), 'Holdco Group', 'the typed name is stored, trimmed');

// The edge is the same one the divisions list uses, so an existing parent
// keeps its other divisions when a second one is added under it.
const withWest = { divisionsMap: { p3: [{ id: 'p2', company: 'Acme West' }] } };
eq(setDivisionParentPatch(withWest, 'p1', 'Acme East', 'Acme Holdings', COMPANIES, null).divisionsMap,
  { p3: [{ id: 'p2', company: 'Acme West' }, { id: 'p1', company: 'Acme East' }] },
  'joining an existing parent appends, leaving its other divisions alone');

// Changing the box moves the company: it must not be left under both.
const underHoldings = { divisionsMap: { p3: [{ id: 'p1', company: 'Acme East' }] } };
const moved = setDivisionParentPatch(underHoldings, 'p1', 'Acme East', 'Holdco Group', COMPANIES, 'p3');
eq(moved.divisionsMap, { [HOLDINGS_TXT]: [{ id: 'p1', company: 'Acme East' }] },
  'changing the parent detaches from the old one');

// Moving out of a parent that had siblings leaves them where they are.
const shared = { divisionsMap: { p3: [{ id: 'p1', company: 'Acme East' }, { id: 'p2', company: 'Acme West' }] } };
eq(setDivisionParentPatch(shared, 'p1', 'Acme East', 'Holdco Group', COMPANIES, 'p3').divisionsMap, {
  p3: [{ id: 'p2', company: 'Acme West' }],
  [HOLDINGS_TXT]: [{ id: 'p1', company: 'Acme East' }],
}, 'moving out leaves the old parent\'s other divisions in place');

// ---- the edits that are refused ---------------------------------------------

eq(setDivisionParentPatch({}, 'p1', 'Acme East', '   ', COMPANIES, null), null, 'a blank name is refused');
eq(setDivisionParentPatch({}, 'p1', 'Acme East', 'acme  east', COMPANIES, null), null,
  'a company cannot be its own parent, spacing and case aside');
eq(setDivisionParentPatch(underHoldings, 'p1', 'Acme East', 'Acme Holdings', COMPANIES, 'p3'), null,
  're-picking the same parent is a no-op, not a duplicate');
eq(setDivisionParentPatch(underHoldings, 'p1', 'Acme East', 'Acme Holdings', COMPANIES, null), null,
  'and still a no-op when the edit came from the add box');

// The knot worth guarding: Acme East already has Acme West below it, so
// Acme West cannot also sit above it.
const eastOverWest = addNamedDivisionPatch({}, 'p1', 'Acme West', COMPANIES);
eq(isDivisionDescendant(eastOverWest, 'p1', 'p2'), true, 'a division is a descendant');
eq(isDivisionDescendant(eastOverWest, 'p2', 'p1'), false, '…and the relation is not symmetric');
eq(setDivisionParentPatch(eastOverWest, 'p1', 'Acme East', 'Acme West', COMPANIES, null), null,
  'a company below cannot be made the parent');

// Two levels down counts too.
const deep = { divisionsMap: { p1: [{ id: 'p2', company: 'Acme West' }], p2: [{ id: 'p3', company: 'Acme Holdings' }] } };
eq(isDivisionDescendant(deep, 'p1', 'p3'), true, 'descendants are found through the whole subtree');
eq(setDivisionParentPatch(deep, 'p1', 'Acme East', 'Acme Holdings', COMPANIES, null), null,
  'a grandchild cannot be made the parent either');

// A mapping that already contains a cycle must not hang the walk.
const cyclic = { divisionsMap: { p1: [{ id: 'p2', company: 'Acme West' }], p2: [{ id: 'p1', company: 'Acme East' }] } };
eq(isDivisionDescendant(cyclic, 'p1', 'p3'), false, 'a cycle in the mapping terminates the walk');

// ---- removing the parent ----------------------------------------------------

// Removal is the plain division removal, aimed the other way — the box is
// dropped from the parent's list and the parent's key goes with it when
// that empties it.
eq(removeDivisionPatch(underHoldings, 'p3', 'p1').divisionsMap, {},
  'removing the only division drops the parent key');
eq(removeDivisionPatch(shared, 'p3', 'p1').divisionsMap, { p3: [{ id: 'p2', company: 'Acme West' }] },
  'removing one leaves the parent\'s others');
eq(divisionParentsFor(removeDivisionPatch(underHoldings, 'p3', 'p1'), 'p1', NAMES), [],
  'and the company has no parent afterwards');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

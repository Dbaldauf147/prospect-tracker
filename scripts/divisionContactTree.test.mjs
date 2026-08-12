// Assertion tests for the reporting lines drawn on the divisions chart.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/divisionContactTree.test.mjs
//
// The chart doesn't own this data: it renders settings.contactReportsTo,
// the same mapping the contact editor writes and the By Category org
// chart draws. So what matters here is that reading it can't lose people:
//
//   - everyone assigned to a box is rendered exactly once, whether or not
//     their manager is on that box;
//   - a manager who ISN'T on the box still gets named, or a mapped
//     reporting line would just be missing from the chart;
//   - a mapping that says two people manage each other must not drop them
//     both (the guard that stops the walk looping).
import { buildDivisionContactTree } from '../src/utils/divisions.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const C = (id, name) => ({ id, name, jobtitle: '', email: '' });
const GREG = C('1', 'Gregory Beutler');
const DAN = C('2', 'Dan Egan');
const SHEA = C('3', 'Shea Drake');
const JONAH = C('4', 'Jonah Miller');

// The shape the chart actually consumes, flattened to names so a failure
// reads as an org chart rather than as JSON.
function shape(nodes) {
  return nodes.map(n => ({
    name: n.contact.name,
    reportsTo: n.managerNames,
    reports: shape(n.children),
  }));
}

// ---- nothing mapped ---------------------------------------------------------

eq(shape(buildDivisionContactTree([], {}, new Map())), [], 'no contacts, no rows');
eq(shape(buildDivisionContactTree([DAN, SHEA], {}, new Map())), [
  { name: 'Dan Egan', reportsTo: [], reports: [] },
  { name: 'Shea Drake', reportsTo: [], reports: [] },
], 'no reporting mapped: everyone sits flat, in the order they were added');

// ---- a manager on the same box ----------------------------------------------

const REPORTS = { 3: ['2'], 4: ['3'] };
eq(shape(buildDivisionContactTree([DAN, SHEA, JONAH], REPORTS, new Map())), [
  {
    name: 'Dan Egan',
    reportsTo: [],
    reports: [
      { name: 'Shea Drake', reportsTo: [], reports: [{ name: 'Jonah Miller', reportsTo: [], reports: [] }] },
    ],
  },
], 'a chain nests: Jonah under Shea under Dan');

// Order of assignment doesn't decide the hierarchy — the mapping does.
eq(shape(buildDivisionContactTree([JONAH, SHEA, DAN], REPORTS, new Map())), [
  {
    name: 'Dan Egan',
    reportsTo: [],
    reports: [
      { name: 'Shea Drake', reportsTo: [], reports: [{ name: 'Jonah Miller', reportsTo: [], reports: [] }] },
    ],
  },
], 'the same chain, assigned bottom-up');

// ---- a manager somewhere else -----------------------------------------------

// Gregory is on the parent box, not this one: no line to draw, so Dan
// stays at the top level and carries the name instead.
eq(shape(buildDivisionContactTree([DAN, SHEA], { 2: ['1'], 3: ['2'] }, new Map([['1', 'Gregory Beutler']]))), [
  {
    name: 'Dan Egan',
    reportsTo: ['Gregory Beutler'],
    reports: [{ name: 'Shea Drake', reportsTo: [], reports: [] }],
  },
], 'a manager on another box is named, not drawn');

eq(shape(buildDivisionContactTree([DAN], { 2: ['1'] }, new Map())), [
  { name: 'Dan Egan', reportsTo: [], reports: [] },
], 'a manager nobody can name is left off rather than shown as an id');

// A second manager beyond the one drawn is still worth saying.
eq(shape(buildDivisionContactTree([DAN, SHEA], { 3: ['2', '1'] }, new Map([['1', 'Gregory Beutler']]))), [
  { name: 'Dan Egan', reportsTo: [], reports: [{ name: 'Shea Drake', reportsTo: ['Gregory Beutler'], reports: [] }] },
], 'nested under the manager on this box, still named for the other one');

// ---- data that would otherwise hide someone ---------------------------------

// Nobody in a loop is nested — picking an edge to break would invent a
// hierarchy the data doesn't have. They render flat, each naming the
// other, which is enough to see that the mapping needs fixing.
eq(shape(buildDivisionContactTree([DAN, SHEA], { 2: ['3'], 3: ['2'] }, new Map())), [
  { name: 'Dan Egan', reportsTo: ['Shea Drake'], reports: [] },
  { name: 'Shea Drake', reportsTo: ['Dan Egan'], reports: [] },
], 'two people managing each other: both still render, once each');

eq(shape(buildDivisionContactTree([GREG, DAN, SHEA], { 1: ['3'], 3: ['2'], 2: ['1'] }, new Map())), [
  { name: 'Gregory Beutler', reportsTo: ['Shea Drake'], reports: [] },
  { name: 'Dan Egan', reportsTo: ['Gregory Beutler'], reports: [] },
  { name: 'Shea Drake', reportsTo: ['Dan Egan'], reports: [] },
], 'a three-person loop still renders everyone exactly once');

// A loop doesn't cost the people hanging off it their place.
eq(shape(buildDivisionContactTree([DAN, SHEA, JONAH], { 2: ['3'], 3: ['2'], 4: ['2'] }, new Map())), [
  { name: 'Dan Egan', reportsTo: ['Shea Drake'], reports: [{ name: 'Jonah Miller', reportsTo: [], reports: [] }] },
  { name: 'Shea Drake', reportsTo: ['Dan Egan'], reports: [] },
], 'someone reporting into a loop still nests under their own manager');

eq(shape(buildDivisionContactTree([DAN, { ...DAN }], { }, new Map())), [
  { name: 'Dan Egan', reportsTo: [], reports: [] },
  { name: 'Dan Egan', reportsTo: [], reports: [] },
], 'the same person twice on a box is the box’s own list to fix, not hidden here');

eq(shape(buildDivisionContactTree([DAN, C('', 'Typed Person')], { 2: ['1'] }, new Map([['1', 'Gregory Beutler']]))), [
  { name: 'Dan Egan', reportsTo: ['Gregory Beutler'], reports: [] },
  { name: 'Typed Person', reportsTo: [], reports: [] },
], 'a typed-in name has no id to map, so it sits flat beside the linked ones');

// A contact mapped as their own manager can't nest under themselves.
eq(shape(buildDivisionContactTree([DAN], { 2: ['2'] }, new Map())), [
  { name: 'Dan Egan', reportsTo: [], reports: [] },
], 'self-management is ignored');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

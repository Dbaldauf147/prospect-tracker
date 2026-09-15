// Assertion tests for the services that come with other services. Plain
// Node — no test framework (the project has none). Run:
//   node scripts/serviceAutoAdd.test.mjs
//
// The rules worth pinning: the resolution is transitive (a service pulled
// in brings its own list) and stays transitive through a service the Scope
// already holds, it terminates on a cycle, it never returns something
// already in Scope, and it hands back the board's spelling rather than
// whatever the cell was typed as — an auto-add that doesn't match a row
// ticks nothing and lands in the off-board bucket instead.
//
// The one caller that wants a chain to stop at what is already there asks
// for it by name: Account Potential's bundling passes `stopAtPresent`, so
// two bundles can't both count the same service's money.
import {
  parseAutoAddList, formatAutoAddList, autoAddListFor, autoAddedByMap, collectAutoAdds,
} from '../src/utils/serviceAutoAdd.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

// The overrides map the Services tab writes: service name → edited fields.
const overrides = {
  'CSRD readiness': { autoAdd: 'GHG, Cat 1 & 2' },
  'GHG': { autoAdd: 'AP upload (indirect payment)' },
  // A pair that names each other — a cycle, which must not hang.
  'Audits': { autoAdd: 'EV' },
  'EV': { autoAdd: 'Audits' },
  // Blank sentinels, and a name whose casing doesn't match the board.
  'Budgets': { autoAdd: '-' },
  'Ecovadis': { autoAdd: 'ghg,  , ESG report' },
};

check('parse splits and trims', parseAutoAddList(' A ,B , '), ['A', 'B']);
check('parse treats the dash as blank', parseAutoAddList('-'), []);
check('parse of nothing', parseAutoAddList(undefined), []);
check('format round-trips', formatAutoAddList([' A ', '', 'B']), 'A, B');

check('one service’s list', autoAddListFor('CSRD readiness', overrides), ['GHG', 'Cat 1 & 2']);
check('a service with no list', autoAddListFor('Bill payment', overrides), []);
check('a dash reads as no list', autoAddListFor('Budgets', overrides), []);

// Transitive: CSRD readiness names GHG, which names the AP upload.
check(
  'chains through what it pulled in',
  collectAutoAdds(['CSRD readiness'], overrides),
  ['GHG', 'Cat 1 & 2', 'AP upload (indirect payment)'],
);

// Nothing already in Scope comes back — the caller appends the result —
// but the chain runs THROUGH it: GHG is already there, so it isn't
// re-added, and what GHG itself pulls in is still owed to the tick.
check(
  'skips what is already in Scope, and keeps going through it',
  collectAutoAdds(['CSRD readiness'], overrides, { present: ['CSRD readiness', 'GHG'] }),
  ['Cat 1 & 2', 'AP upload (indirect payment)'],
);

// Case-insensitively, since Scope is free text. Everything the chain names
// is already there except the one at the end of it, which is what the tick
// is owed: an opp that arrived by paste holding GHG has never run this rule
// at all, so the service in the middle is exactly the one sitting there
// with its own list unresolved.
check(
  'matches what is there case-insensitively, and still finishes the chain',
  collectAutoAdds(['CSRD readiness'], overrides, { present: ['csrd readiness', 'ghg', 'cat 1 & 2'] }),
  ['AP upload (indirect payment)'],
);

// The whole chain already in Scope implies nothing: there is nothing left
// to add, and walking it again must not hand back what is there.
check(
  'a chain already in Scope end to end adds nothing',
  collectAutoAdds(['CSRD readiness'], overrides, {
    present: ['CSRD readiness', 'GHG', 'Cat 1 & 2', 'AP upload (indirect payment)'],
  }),
  [],
);

// The reason this changed, in the shape it was reported: A names B, B names
// C, and B is already in Scope. Ticking A owes the opp C.
const chain = {
  'Strategic sourcing': { autoAdd: 'Client sends invoices' },
  'Client sends invoices': { autoAdd: 'Client management' },
};
check(
  'a service named through one already in Scope is still added',
  collectAutoAdds(['Strategic sourcing'], chain, {
    present: ['Client sends invoices', 'Strategic sourcing'],
  }),
  ['Client management'],
);

// Account Potential divides one deal into bundles rather than choosing a
// Scope, so the same chain has to stop where another bundle already holds
// a service - otherwise both bundles bill Client management.
check(
  'stopAtPresent leaves the tail with the bundle that already holds it',
  collectAutoAdds(['Strategic sourcing'], chain, {
    present: ['Client sends invoices', 'Strategic sourcing'],
    stopAtPresent: true,
  }),
  [],
);

// A cycle terminates and yields each side once.
check('a cycle terminates', collectAutoAdds(['Audits'], overrides), ['EV', 'Audits']);

// Two triggers at once (the quick-add lists) don't double up.
check(
  'two triggers, one result each',
  collectAutoAdds(['GHG', 'CSRD readiness'], overrides, { present: ['GHG', 'CSRD readiness'] }),
  ['AP upload (indirect payment)', 'Cat 1 & 2'],
);

// The board's spelling wins, so the tick lands on a row.
check(
  'resolved to the board spelling',
  collectAutoAdds(['Ecovadis'], overrides, {
    canonical: (n) => (n.toLowerCase() === 'ghg' ? 'GHG' : n),
  }),
  ['GHG', 'ESG report', 'AP upload (indirect payment)'],
);

// A service name with a comma in it ("Cat 3, 5, 6, and 7 (part of GHG)") is
// one name, not four. Passing the known names in is what rebuilds it — see
// scripts/serviceNameList.test.mjs for the splitting itself.
const CAT = 'Cat 3, 5, 6, and 7 (part of GHG)';
const commaOverrides = { 'Comp GHG': { autoAdd: `${CAT}, GHG` } };
const commaNames = ['Comp GHG', CAT, 'GHG'];
check(
  'a comma in a name shreds the list without the vocabulary',
  autoAddListFor('Comp GHG', commaOverrides),
  ['Cat 3', '5', '6', 'and 7 (part of GHG)', 'GHG'],
);
check(
  'and survives with it',
  autoAddListFor('Comp GHG', commaOverrides, commaNames),
  [CAT, 'GHG'],
);
check(
  'so the Scope board ticks it rather than a fragment',
  collectAutoAdds(['Comp GHG'], commaOverrides, { names: commaNames }),
  [CAT, 'GHG'],
);
check(
  'and the reverse direction finds its row',
  autoAddedByMap(commaNames, commaOverrides).get(CAT.toLowerCase()),
  ['Comp GHG'],
);

// A service that names nothing implies nothing.
check('no list, no additions', collectAutoAdds(['Bill payment'], overrides), []);
check('nothing ticked, nothing added', collectAutoAdds([], overrides), []);

// The reverse direction the detail popup shows.
const reverse = autoAddedByMap(Object.keys(overrides), overrides);
check('who pulls GHG in', reverse.get('ghg'), ['CSRD readiness', 'Ecovadis']);
check('who pulls Audits in', reverse.get('audits'), ['EV']);
check('nobody pulls CSRD readiness in', reverse.get('csrd readiness'), undefined);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

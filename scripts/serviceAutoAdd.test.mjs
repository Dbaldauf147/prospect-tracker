// Assertion tests for the services that come with other services. Plain
// Node — no test framework (the project has none). Run:
//   node scripts/serviceAutoAdd.test.mjs
//
// The rules worth pinning: the resolution is transitive (a service pulled
// in brings its own list), it terminates on a cycle, it never returns
// something already in Scope, and it hands back the board's spelling rather
// than whatever the cell was typed as — an auto-add that doesn't match a row
// ticks nothing and lands in the off-board bucket instead.
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

// Nothing already in Scope comes back — the caller appends the result.
check(
  'skips what is already in Scope',
  collectAutoAdds(['CSRD readiness'], overrides, { present: ['CSRD readiness', 'GHG'] }),
  ['Cat 1 & 2'],
);

// Case-insensitively, since Scope is free text — and a service that was
// already there is left entirely alone, its own list included. That's what
// keeps an auto-add removable: take AP upload off an opp that has GHG, tick
// something else that names GHG, and the AP upload stays off.
check(
  'already in Scope, spelled differently, and not re-expanded',
  collectAutoAdds(['CSRD readiness'], overrides, { present: ['csrd readiness', 'ghg', 'cat 1 & 2'] }),
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

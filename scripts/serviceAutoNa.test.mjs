// Assertion tests for the services a sale takes off the table. Plain Node —
// no test framework (the project has none). Run:
//   node scripts/serviceAutoNa.test.mjs
//
// The rules worth pinning: only a closed-won status triggers it, a sold
// service is never itself marked N/A, the result names the sale that caused
// it, it does NOT chain the way auto-add does (a service ruled out by a sale
// wasn't sold, so its own list stays dormant), and a cell spelled differently
// from the board still lands on the board's row.
import {
  parseAutoNaList, formatAutoNaList, isSoldStatus, autoNaListFor, autoNaedByMap, collectAutoNa,
  autoNaTitle,
} from '../src/utils/serviceAutoNa.js';

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
  // The platform sale that retires the pieces underneath it.
  'RA platform': { autoNa: 'API/ETL, Budgets' },
  // And one of those pieces with a list of its own, which must NOT fire off
  // the back of the retirement above.
  'Budgets': { autoNa: 'Bill payment' },
  // A pair that retires each other.
  'Audits': { autoNa: 'EV' },
  'EV': { autoNa: 'Audits' },
  // Blank sentinels, and a name whose casing doesn't match the board.
  'Ecovadis': { autoNa: '-' },
  'GHG': { autoNa: 'comp ghg,  , Cat 1 & 2' },
};

const list = (map) => Object.fromEntries([...map.entries()]);

check('parse splits and trims', parseAutoNaList(' A ,B , '), ['A', 'B']);
check('parse treats the dash as blank', parseAutoNaList('-'), []);
check('format round-trips', formatAutoNaList([' A ', '', 'B']), 'A, B');

check('sold is sold', isSoldStatus('Sold'), true);
check('casing and space forgiven', isSoldStatus(' sold '), true);
// Only closed-won: a renewal or an in-flight stage is a conversation still
// running, and retiring a service off one would mean un-retiring it later.
check('a renewal is not a sale', isSoldStatus('Renewal'), false);
check('in flight is not a sale', isSoldStatus('Verbal'), false);
check('nothing is not a sale', isSoldStatus(undefined), false);

check('one service’s list', autoNaListFor('RA platform', overrides), ['API/ETL', 'Budgets']);
check('a service with no list', autoNaListFor('Bill payment', overrides), []);
check('a dash reads as no list', autoNaListFor('Ecovadis', overrides), []);

// The sale names what it retires, and each retirement carries its reason.
check(
  'a sale retires its list',
  list(collectAutoNa(['RA platform'], overrides)),
  { 'API/ETL': ['RA platform'], 'Budgets': ['RA platform'] },
);

// Not transitive: Budgets is N/A here, not sold, so Bill payment stays a
// live question. This is the difference from the auto-add chain.
check(
  'a retirement does not chain',
  [...collectAutoNa(['RA platform'], overrides).keys()],
  ['API/ETL', 'Budgets'],
);

// Sell both and the chain does run — one more sale, one more list.
check(
  'a second sale brings its own list',
  list(collectAutoNa(['RA platform', 'Budgets'], overrides)),
  { 'API/ETL': ['RA platform'], 'Bill payment': ['Budgets'] },
);

// A sold service is never N/A, whoever names it — two services that retire
// each other and are both sold simply cancel out.
check('a sold service is never N/A', list(collectAutoNa(['Audits', 'EV'], overrides)), {});
check('one side sold, the other retired', list(collectAutoNa(['Audits'], overrides)), { 'EV': ['Audits'] });

// Two sales naming the same service: one row, both reasons, so the board can
// say why rather than picking one arbitrarily.
const twoReasons = collectAutoNa(['RA platform', 'Audits'], {
  ...overrides,
  'Audits': { autoNa: 'API/ETL' },
});
check('both reasons kept', twoReasons.get('API/ETL'), ['RA platform', 'Audits']);

// The board's spelling wins, so the N/A lands on a row rather than on a name
// that matches nothing.
check(
  'resolved to the board spelling',
  [...collectAutoNa(['GHG'], overrides, {
    canonical: (n) => (n.toLowerCase() === 'comp ghg' ? 'Comp GHG' : n),
  }).keys()],
  ['Comp GHG', 'Cat 1 & 2'],
);

// A service name with a comma in it is one name, not several — the same
// rebuilding the auto-add column needs (src/utils/serviceNameList.js).
const CAT = 'Cat 3, 5, 6, and 7 (part of GHG)';
const commaOverrides = { 'Comp GHG': { autoNa: `${CAT}, GHG` } };
const commaNames = ['Comp GHG', CAT, 'GHG'];
check(
  'a comma name is retired whole',
  list(collectAutoNa(['Comp GHG'], commaOverrides, { names: commaNames })),
  { [CAT]: ['Comp GHG'], 'GHG': ['Comp GHG'] },
);
check(
  'and the reverse direction finds its row',
  autoNaedByMap(commaNames, commaOverrides).get(CAT.toLowerCase()),
  ['Comp GHG'],
);

// Nothing sold, nothing retired.
check('no sales, no N/As', list(collectAutoNa([], overrides)), {});
check('a sale with no list implies nothing', list(collectAutoNa(['Bill payment'], overrides)), {});

// The reverse direction the detail popup shows.
const reverse = autoNaedByMap(Object.keys(overrides), overrides);
check('what retires Budgets', reverse.get('budgets'), ['RA platform']);
check('what retires Audits', reverse.get('audits'), ['EV']);
check('nothing retires the RA platform', reverse.get('ra platform'), undefined);

// The sentence on the greyed-out row, singular and plural.
check(
  'one reason reads singular',
  autoNaTitle('Budgets', ['RA platform']).startsWith('N/A automatically: RA platform is sold'),
  true,
);
check(
  'two reasons read plural',
  autoNaTitle('API/ETL', ['RA platform', 'Audits']).startsWith('N/A automatically: RA platform and Audits are sold'),
  true,
);
check('no reason, no sentence', autoNaTitle('Budgets', []), '');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

// Assertion tests for the Pricing Basis the rate card shows. Plain Node — no
// test framework (the project has none). Run:
//   node scripts/pricedBases.test.mjs
//
// The rule being pinned: the Pricing Basis column is read off the fee
// breakdown, not off one stored field. A recurring line always named the
// basis by itself, but a SETUP line never did — so a service sold as one
// fee up front and nothing after showed a dash in the column while its
// breakdown plainly said "Flat fee". These tests cover both halves, the
// order they are read in, and the two ways the list has to go back to
// empty when the money is taken away.
import {
  pricedBases, pricingFor, setPricingLine, setPricingSetupLine, setPricingField,
} from '../src/utils/servicePricing.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const S = 'Remote assessments';
const read = (p, name = S) => pricedBases(pricingFor(p, name));

// Nothing priced at all.
check('empty service has no bases', read({}), []);

// The case from the screenshot: a flat fee charged once, no recurring rate.
let setupOnly = setPricingSetupLine({}, S, 'flat', { rate: 45000 });
setupOnly = setPricingSetupLine(setupOnly, S, 'flat', { rateHigh: 87000 });
check('a setup-only service names its basis', read(setupOnly), ['flat']);
check('setup-only leaves the stored basis alone', pricingFor(setupOnly, S).basis, '');

// A recurring line already named the basis, and still does.
const recurring = setPricingLine({}, S, 'per_site', { rate: 450 });
check('a recurring line names its basis', read(recurring), ['per_site']);

// Both halves: the recurring line leads, because the card's rate columns
// show it; the setup-only basis follows.
const both = setPricingSetupLine(recurring, S, 'flat', { rate: 2000 });
check('recurring leads, setup follows', read(both), ['per_site', 'flat']);

// One basis carrying both a recurring rate and a setup rate is ONE line,
// not two — it is one row in the breakdown.
const sameBasis = setPricingSetupLine(recurring, S, 'per_site', { rate: 40 });
check('a basis priced on both halves is listed once', read(sameBasis), ['per_site']);

// Several recurring lines keep the order they were written in.
const multi = setPricingLine(setPricingLine(recurring, S, 'per_meter', { rate: 12 }), S, 'pct_deal', { rate: 5 });
check('extra recurring lines follow the headline', read(multi), ['per_site', 'per_meter', 'pct_deal']);

// Clearing the money clears the basis — the whole point of deriving it
// rather than storing it.
check(
  'clearing the setup rate drops the basis',
  read(setPricingSetupLine(setupOnly, S, 'flat', { rate: '' })),
  [],
);
check(
  'clearing the recurring rate drops the basis',
  read(setPricingLine(recurring, S, 'per_site', { rate: '' })),
  [],
);
// ...and clearing one half of a two-line service leaves the other standing.
check(
  'clearing the recurring half leaves the setup basis',
  read(setPricingSetupLine(setPricingLine(both, S, 'per_site', { rate: '' }), S, 'flat', { rate: 2000 })),
  ['flat'],
);

// A basis picked off the dropdown before any rate is typed is a choice, not
// a price: it is not "priced on", though the column still leads with it
// (ServicesPricingTab reads entry.basis first).
const pickedOnly = setPricingField({}, S, 'basis', 'per_account');
check('a picked basis with no rate is not priced on', read(pickedOnly), []);
check('a picked basis is still stored', pricingFor(pickedOnly, S).basis, 'per_account');

// A legacy setup fee — saved as components, before setup lines existed — is
// real money and has to name a basis too.
const legacy = { [S]: { setup: [{ label: 'Kickoff', kind: 'fixed', amount: 5000 }] } };
check('a legacy fixed setup component names the flat basis', read(legacy), ['flat']);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

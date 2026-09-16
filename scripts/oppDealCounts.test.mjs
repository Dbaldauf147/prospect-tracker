// Assertion tests for the counts the Lead deal-size prompt prices against.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/oppDealCounts.test.mjs
//
// Every per-unit fee in that prompt is one of these numbers times a rate, so
// what is guarded here is which number is used and what it is said to be:
//
//   1. Which record answers. The opp carries what THIS deal covers; the
//      company card carries what the account HAS. The opp is the more
//      specific claim, so it wins — pricing a 40-site rollout against a
//      portfolio's 6,176 sites is wrong in a way no total will reveal.
//   2. That a zero is not an answer. A count of 0 (or a blank, or a dash)
//      means nobody has recorded one, not that the account has none of them.
//   3. What is reported as missing, and when. A unit nothing has recorded is
//      the reason a fee below reads $0 — but only worth saying when some
//      service in the scope actually charges on it.
//   4. That every chip says where it came from. A surprising count is only
//      checkable if the reader is told which record to go and look at.

import { oppDealCounts, missingUnitChips, dealCountRows } from '../src/utils/oppDealCounts.js';
import { PRICING_UNITS } from '../src/utils/servicePricing.js';

let passed = 0, failed = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed += 1; console.log(`PASS  ${name}`); return; }
  failed += 1;
  console.log(`FAIL  ${name}\n      expected ${e}\n      got      ${a}`);
}

const COMPANY = {
  company: 'Prologis',
  numberOfSites: 6176,
  sitesWithMandate: 300,
  numberOfAccounts: 1240,
};
const opp = (extra = {}) => ({ Account: 'Prologis', ...extra });

// --- which record answers --------------------------------------------------

eq('the company card fills every count it carries',
  oppDealCounts({ opp: opp(), company: COMPANY, units: PRICING_UNITS }).counts,
  { sites: 6176, sites_mandate: 300, accounts: 1240 });

// The deal covers 40 of the 6,176 — pricing it against the portfolio is the
// mistake this rule exists to prevent.
eq("the opp's own Sites beats the portfolio's",
  oppDealCounts({ opp: opp({ Sites: '40' }), company: COMPANY, units: PRICING_UNITS }).counts,
  { sites: 40, sites_mandate: 300, accounts: 1240 });

eq('an opp with no company behind it still prices on what it carries',
  oppDealCounts({ opp: opp({ Sites: '40' }), company: null, units: PRICING_UNITS }).counts,
  { sites: 40 });
eq('and an opp with nothing at all has nothing to price on',
  oppDealCounts({ opp: opp(), company: null, units: PRICING_UNITS }).counts, {});
eq('no arguments at all is not a crash',
  oppDealCounts().counts, {});

// --- a zero is not an answer ------------------------------------------------
//
// These records are hand-typed and sheet-imported: a blank arrives as '', a
// dash, or a zero somebody left in the cell. None of them means "this account
// has no sites" — they all mean nobody has recorded one.

for (const blank of ['', '   ', '-', '0', 0, null, undefined]) {
  eq(`Sites of "${blank}" on the opp falls back to the card`,
    oppDealCounts({ opp: opp({ Sites: blank }), company: COMPANY, units: PRICING_UNITS }).counts.sites,
    6176);
}
eq('and a blank on the card is simply not a count',
  oppDealCounts({ opp: opp(), company: { company: 'X', numberOfSites: '-' }, units: PRICING_UNITS }).counts,
  {});
// Spreadsheet formatting survives the trip: "1,240" is the number typed.
eq('a count typed with separators is still a number',
  oppDealCounts({ opp: opp({ Sites: '1,240' }), company: null, units: PRICING_UNITS }).counts.sites, 1240);

// --- what each chip says ----------------------------------------------------

{
  const { chips } = oppDealCounts({ opp: opp({ Sites: '40' }), company: COMPANY, units: PRICING_UNITS });
  eq('the opp count leads, then the card fills the rest',
    chips.map(c => [c.label, c.value, c.source]),
    [['Sites', 40, 'opp'], ['Sites w/ Mandate', 300, 'company'], ['Accounts', 1240, 'company']]);
  eq('and each says which record to go and look at',
    chips.map(c => c.from),
    ['this opp', 'Prologis’s company card', 'Prologis’s company card']);
}

// --- what is reported as missing --------------------------------------------

{
  const counts = { sites: 40 };
  eq('a unit the scope charges on and nothing answers is reported',
    missingUnitChips({ counts, needed: ['meters', 'sites'], units: PRICING_UNITS })
      .map(c => [c.label, c.value]),
    [['Meters', null]]);
  eq('a unit nothing in the scope charges on is not',
    missingUnitChips({ counts, needed: ['sites'], units: PRICING_UNITS }), []);
  eq('and neither is a scope that charges on nothing',
    missingUnitChips({ counts, needed: null, units: PRICING_UNITS }), []);
}

// A unit the pricing bases don't name still reads as itself rather than
// vanishing — a custom basis is the user's own vocabulary.
eq('an unknown unit is labelled with its own key',
  missingUnitChips({ counts: {}, needed: ['widgets'], units: PRICING_UNITS })[0].label, 'widgets');

// --- the boxes the Deal Size popup types into -------------------------------
//
// Same numbers, now with somewhere to put them. What is guarded is the one
// rule that makes the boxes trustworthy: the box you type in and the number
// that prices the deal are the same number. Route a site count to the opp
// column while the card's 6,176 goes on pricing it and the popup shows an
// empty box above a fee worked against a figure the box never held.

const rowsFor = (opp_, company, needed) =>
  dealCountRows({ opp: opp_, company, units: PRICING_UNITS, needed });
const shape = (rows) => rows.map(r => [r.unit, r.value, r.target, r.column || r.field, r.blocked]);

{
  // Nothing recorded: each count goes to the record that OWNS that fact -
  // the opp for the sites this deal covers, the card for what the account
  // has.
  eq('an empty account offers a box on the right record for each count',
    shape(rowsFor(opp(), { id: 'c1', company: 'Prologis' }, ['sites', 'accounts', 'meters'])),
    [['sites', null, 'opp', 'Sites', null],
     ['accounts', null, 'company', 'numberOfAccounts', null],
     ['meters', null, 'company', 'numberOfMeters', null]]);

  // Recorded: you edit the record it CAME from, so what is in the box is
  // what prices the deal.
  eq('a count edits the record that answered it',
    shape(rowsFor(opp({ Sites: '40' }), COMPANY, ['sites', 'accounts'])),
    [['sites', 40, 'opp', 'Sites', null],
     ['sites_mandate', 300, 'company', 'sitesWithMandate', null],
     ['accounts', 1240, 'company', 'numberOfAccounts', null]]);

  // The card answered sites, so the card is what the box writes to. Sending
  // it to the opp column would leave 6,176 pricing the deal from behind an
  // empty box.
  eq("a site count off the card edits the card, not the opp's blank column",
    shape(rowsFor(opp(), COMPANY, ['sites'])),
    [['sites', 6176, 'company', 'numberOfSites', null],
     ['sites_mandate', 300, 'company', 'sitesWithMandate', null],
     ['accounts', 1240, 'company', 'numberOfAccounts', null]]);
}

{
  // A row with nowhere to write still shows: the missing count is why a fee
  // below reads $0, and an offered box that drops what is typed into it is
  // worse than none.
  eq('no company card means the opp can still be typed and the rest cannot',
    shape(rowsFor(opp(), null, ['sites', 'accounts'])),
    [['sites', null, 'opp', 'Sites', null],
     ['accounts', null, null, null, 'no-company']]);
  eq('a unit no record carries says so rather than offering a box',
    shape(rowsFor(opp(), COMPANY, ['invoices'])).filter(r => r[0] === 'invoices'),
    [['invoices', null, null, null, 'no-field']]);
}

{
  // Projects are a fact about the SERVICE, not the account: three lighting
  // retrofits and a chiller replacement is four projects and neither
  // service is priced on four. There is no single number to type.
  eq('projects are never asked for here',
    rowsFor(opp(), COMPANY, ['projects']).map(r => r.unit),
    ['sites', 'sites_mandate', 'accounts']);

  eq('a unit nothing charges on and nothing answers gets no row',
    rowsFor(opp(), null, null), []);

  // ...unless the caller asked for the whole vocabulary. Then the row is
  // there to be typed into and is NOT marked as something this scope is
  // waiting on - nothing below reads $0 for want of it.
  const everyUnit = PRICING_UNITS.map(u => u.unit);
  eq('offering every count gives a box for each the records can hold',
    shape(dealCountRows({
      opp: opp(), company: { id: 'c1', company: 'Prologis' },
      units: PRICING_UNITS, needed: null, offer: everyUnit,
    })),
    [['sites', null, 'opp', 'Sites', null],
     ['sites_mandate', null, 'company', 'sitesWithMandate', null],
     ['accounts', null, 'company', 'numberOfAccounts', null],
     ['meters', null, 'company', 'numberOfMeters', null],
     ['mwh', null, 'company', 'annualMwh', null],
     ['equipment', null, 'company', 'equipmentCount', null]]);
  eq('and none of them is marked as one this scope is waiting on',
    dealCountRows({
      opp: opp(), company: COMPANY, units: PRICING_UNITS,
      needed: ['accounts'], offer: everyUnit,
    }).filter(r => r.needed).map(r => r.unit),
    ['accounts']);

  // An offer is only an offer where the number can be saved. Invoices are
  // carried by no record, and the company fields have no card behind them,
  // so neither is somewhere to type - the deal's own Sites still is.
  eq('an offered count with nowhere to write is not offered at all',
    dealCountRows({
      opp: opp(), company: COMPANY, units: PRICING_UNITS, offer: everyUnit,
    }).map(r => r.unit).includes('invoices'), false);
  eq('and an Account matching no company card offers only the opp\u2019s own',
    shape(dealCountRows({
      opp: opp(), company: null, units: PRICING_UNITS, offer: everyUnit,
    })),
    [['sites', null, 'opp', 'Sites', null]]);
  // A count this scope DOES charge on still says why it cannot be answered.
  eq('a needed count with nowhere to write still shows its blocker',
    shape(dealCountRows({
      opp: opp(), company: null, units: PRICING_UNITS,
      needed: ['accounts'], offer: everyUnit,
    })),
    [['sites', null, 'opp', 'Sites', null],
     ['accounts', null, null, null, 'no-company']]);
  eq('and a row says whether this scope is actually waiting on it',
    rowsFor(opp(), COMPANY, ['accounts']).map(r => [r.unit, r.needed]),
    [['sites', false], ['sites_mandate', false], ['accounts', true]]);
  eq('no arguments at all is not a crash', dealCountRows(), []);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

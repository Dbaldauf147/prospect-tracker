// Assertion tests for the per-country deregulation reference.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/countryDeregulation.test.mjs
//
// The rules worth pinning: 'Not served' earns nothing on either motion
// (it's a statement about our coverage, not about the market), it isn't
// softened into the European "TBD", and it reaches every alias of the
// country it's set on.
import {
  COUNTRY_DEREGULATION, NOT_SERVED, isCountryNotServed,
  countryElectricSavings, countryGasSavings, countryHasRegulatedRateOpportunity,
} from '../src/data/countryDeregulation.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

// --- a market we won't buy in ----------------------------------------
check('Russia is not served', isCountryNotServed('Russia'), true);
check('...through its aliases too', isCountryNotServed('Russian Federation'), true);
// All three buckets, or a motion still quotes a number: the commodity
// motion reads electric/gas, the reg-rate motion reads the third column.
check('every bucket is set', [
  COUNTRY_DEREGULATION['Russia'].electric,
  COUNTRY_DEREGULATION['Russia'].gas,
  COUNTRY_DEREGULATION['Russia'].powerRateOptimization,
], [NOT_SERVED, NOT_SERVED, NOT_SERVED]);

check('no electric commodity savings',
  countryElectricSavings('Russia'), { status: NOT_SERVED, range: '', lowPct: null, highPct: null });
check('no gas commodity savings',
  countryGasSavings('Russia'), { status: NOT_SERVED, range: '', lowPct: null, highPct: null });
check('no regulated-rate motion either',
  countryHasRegulatedRateOpportunity('Russia'), false);

// Russia's region is Europe/Asia, and European markets normally surface
// "TBD" in place of a committed range. TBD promises a number later; for a
// market we won't buy in there is no number coming, so it stays blank.
check('not softened into the European TBD', countryElectricSavings('Russia').range, '');
check('a served European market still reads TBD', countryElectricSavings('Germany').range, 'TBD');

// --- the rest of the table is untouched -------------------------------
check('Germany still earns the commodity motion',
  countryElectricSavings('Germany').status, 'Deregulated');
check('the US still earns the reg-rate motion',
  countryHasRegulatedRateOpportunity('United States'), true);
check('a genuinely regulated market is not "not served"',
  isCountryNotServed('Cuba'), false);
check('an unknown country has no entry', countryElectricSavings('Atlantis'), null);
check('...and is not reported as not served', isCountryNotServed('Atlantis'), false);
// Only the country asked for. A blanket sweep of sanctioned markets is a
// business call, not a code one — this pins that none was made.
check('only Russia is marked so far',
  Object.entries(COUNTRY_DEREGULATION).filter(([, v]) => v.electric === NOT_SERVED).map(([k]) => k),
  ['Russia']);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

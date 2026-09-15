// Assertion tests for the per-country deregulation reference.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/countryDeregulation.test.mjs
//
// The rules worth pinning: 'Not served' earns nothing on either motion
// (it's a statement about our coverage, not about the market), it isn't
// softened into the European "TBD", and it reaches every alias of the
// country it's set on. Plus the three ways a status turns into money -
// a full band, a 0 - 0 % floor, and no band at all - since two of those
// look alike from the outside and mean different things on a sheet.
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

// --- what each status is worth ----------------------------------------
//
// Three outcomes, and the difference between the last two matters on a
// sheet: a 0 - 0 % market is NAMED on the Indicative Savings tab with
// every column resolving to $0, while a market with no band at all
// quotes nothing.
//
// "Some deregulation" is the narrow-retail-choice case, and it is the
// one that changed: it used to earn the full 2 - 4 %, which is the same
// claim as a fully competitive market. It now reads 0 - 0 %, matching
// what its US and Canadian counterparts have always carried - AZ / CA /
// MI electric ("Limited") and the large-load-only gas states.
check('a fully competitive market earns the band',
  countryElectricSavings('Australia'), { status: 'Deregulated', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 });
check('some deregulation earns a floor, not the band',
  countryElectricSavings('China'), { status: 'Some deregulation', range: '0 - 0%', lowPct: 0, highPct: 0 });
check('on gas as well as electric',
  countryGasSavings('Colombia'), { status: 'Some deregulation', range: '0 - 0%', lowPct: 0, highPct: 0 });
check('and it is a floor, not an absence - the row still quotes a range',
  countryElectricSavings('Belize').range !== '', true);
check('an unlikely market has no band at all',
  countryElectricSavings('Bolivia'), { status: 'Unlikely', range: '', lowPct: null, highPct: null });

// Every one of them, not just the ones spelled out above.
const someDeregBands = [];
for (const [name, d] of Object.entries(COUNTRY_DEREGULATION)) {
  if (d.electric === 'Some deregulation') someDeregBands.push(countryElectricSavings(name));
  if (d.gas === 'Some deregulation') someDeregBands.push(countryGasSavings(name));
}
check('there are some deregulation markets to check', someDeregBands.length > 20, true);
check('every one of them is 0 - 0%',
  someDeregBands.every(b => b.range === '0 - 0%' && b.lowPct === 0 && b.highPct === 0), true);

// The European TBD override covers a band that could produce a dollar.
// A market we have decided earns nothing is not waiting on a number.
check('a European some-deregulation market is 0 - 0%, not TBD',
  countryElectricSavings('Lithuania').range, '0 - 0%');
check('and on gas too', countryGasSavings('Turkey').range, '0 - 0%');
check('while a European deregulated market still reads TBD',
  countryGasSavings('Luxembourg').range, 'TBD');

// Status is untouched by any of this: it decides whether a market is
// competitive at all, which drives the site counts and the market tier,
// not what a competitive market is worth.
check('some deregulation is still some deregulation',
  COUNTRY_DEREGULATION['China'].electric, 'Some deregulation');

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

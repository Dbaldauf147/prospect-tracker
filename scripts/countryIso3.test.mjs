// Assertion tests for ISO 3166-1 alpha-3 country codes in the Country
// column. Plain Node — no test framework (the project has none). Run:
//   node scripts/countryIso3.test.mjs
//
// Site lists arrive with the country either spelled out or written as its
// three-letter code. Only the spelled-out form used to resolve, and the
// failure was silent and total: a list carrying "CAN" / "MEX" / "TUN" got
// no deregulation status (the Market column read Unknown), no indicative
// rate, and — because the savings bucket skips a row with neither a US/CA
// state nor a recognized country — no indicative savings at all.
//
// What is pinned here:
//   * the codes resolve, and resolve to the SAME entry the spelled-out
//     name does, in both the deregulation table and the rates table;
//   * every country in either reference table has a code, and every code
//     points at a country both tables actually hold — the two tables are
//     keyed by the same list, so a code that yields a dereg status must
//     also yield a rate;
//   * alpha-2 is deliberately NOT accepted. "IN", "DE", "AL", "PA" are US
//     state codes as often as they are countries, and a Country cell
//     mis-filled with a state code resolving to India / Germany / Albania
//     / Panama would be worse than not resolving at all.
import { ISO3_TO_COUNTRY, countryNameFromIso3 } from '../src/data/countryIso3.js';
import {
  COUNTRY_DEREGULATION,
  normalizeCountryName,
  countryDeregulation,
  countryHasRegulatedRateOpportunity,
} from '../src/data/countryDeregulation.js';
import { COUNTRY_RATES, countryElectricRate, normalizeCountryRateName } from '../src/data/countryRates.js';

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        expected ${e}\n        got      ${a}`}`);
}

// --- the codes from the report that started this --------------------------
check('CAN resolves to Canada', normalizeCountryName('CAN'), 'Canada');
check('MEX resolves to Mexico', normalizeCountryName('MEX'), 'Mexico');
check('TUN resolves to Tunisia', normalizeCountryName('TUN'), 'Tunisia');
check('lower-case can resolves', normalizeCountryName('can'), 'Canada');
check('a padded code resolves', normalizeCountryName('  MEX  '), 'Mexico');

// A code and its spelled-out name must land on the identical entry —
// otherwise the same portfolio scores differently depending on how its
// Country column happens to be written.
for (const [code, name] of Object.entries(ISO3_TO_COUNTRY)) {
  const byCode = countryDeregulation(code);
  const byName = countryDeregulation(name);
  if (JSON.stringify(byCode) !== JSON.stringify(byName)) {
    failures += 1;
    console.log(`FAIL  ${code} and ${name} disagree on deregulation`);
  }
  if (countryElectricRate(code) !== countryElectricRate(name)) {
    failures += 1;
    console.log(`FAIL  ${code} and ${name} disagree on electric rate`);
  }
}
console.log(`PASS  every code agrees with its spelled-out name (${Object.keys(ISO3_TO_COUNTRY).length} codes)`);

// The savings-bearing consequences, spot-checked on the three countries
// from the report.
check('Canada is deregulated for electric', countryDeregulation('CAN').electric, 'Deregulated');
check('Mexico carries a reg-rate motion', countryHasRegulatedRateOpportunity('MEX'), true);
check('Tunisia is Unlikely for electric', countryDeregulation('TUN').electric, 'Unlikely');
check('CAN gets an indicative rate', countryElectricRate('CAN'), countryElectricRate('Canada'));
check('MEX resolves in the rates table', normalizeCountryRateName('MEX'), 'Mexico');

// --- coverage: the two tables and the code map are one list ---------------
const coded = new Set(Object.values(ISO3_TO_COUNTRY));
check('every dereg country has a code',
  Object.keys(COUNTRY_DEREGULATION).filter((n) => !coded.has(n)), []);
check('every rates country has a code',
  Object.keys(COUNTRY_RATES).filter((n) => !coded.has(n)), []);
check('every code lands in the dereg table',
  [...coded].filter((n) => !COUNTRY_DEREGULATION[n]), []);
check('every code lands in the rates table',
  [...coded].filter((n) => !COUNTRY_RATES[n]), []);

// --- what must NOT resolve ------------------------------------------------
// Alpha-2 codes that double as US state codes. Left unresolved on purpose.
for (const code of ['IN', 'DE', 'AL', 'PA', 'CO', 'ID', 'LA', 'MD', 'MT', 'NE', 'AR', 'IL', 'MN', 'SC', 'SD', 'VA']) {
  check(`${code} (a US state code) does not resolve to a country`, normalizeCountryName(code), null);
}
// 'CA' stays unresolved here too — SitesView reads it as Canada through its
// own North-America predicates, which is the only place that spelling is
// unambiguous.
check('CA does not resolve through the country tables', normalizeCountryName('CA'), null);
// Only exactly-three-letter input reaches the code map.
check('a four-letter word is not a code', countryNameFromIso3('CANS'), null);
check('a two-letter code is not tried', countryNameFromIso3('CA'), null);
check('a digit-bearing code is not tried', countryNameFromIso3('C4N'), null);
check('an empty string is not a code', countryNameFromIso3(''), null);
check('null does not throw', countryNameFromIso3(null), null);
// A real name still beats the code map — 'Chad' is four letters, but
// 'Oman' / 'Iran' / 'Iraq' / 'Cuba' / 'Peru' / 'Togo' / 'Mali' are the ones
// worth pinning: four letters, so the guard keeps them off the code path.
for (const name of ['Chad', 'Oman', 'Iran', 'Iraq', 'Cuba', 'Peru', 'Togo', 'Mali']) {
  check(`${name} still resolves as a name`, normalizeCountryName(name), name);
}

console.log(failures === 0 ? '\nAll country ISO-3 tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

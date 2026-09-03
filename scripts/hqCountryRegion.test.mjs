// Assertion tests for classifying a bare HQ Country cell. Plain Node — no
// test framework (the project has none). Run:
//   node scripts/hqCountryRegion.test.mjs
//
// The company popup's Portfolio Companies table defaults a row with no
// status of its own to "Hold Off" when its HQ Country is outside North
// America, so this call decides which rows get that default. Two ways to
// get it wrong: calling a North American company foreign (a US portfolio
// company would open on Hold Off, which is exactly backwards), or leaving a
// blank cell to guess (a row with no country at all must stay unknown).
import {
  classifyHqCountry, classifyHqRegion, NORTH_AMERICA, OUTSIDE_NORTH_AMERICA,
} from '../src/utils/hqRegion.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// ── North America ──────────────────────────────────────────────────────
{
  for (const c of ['United States', 'United States of America', 'USA', 'usa ', 'US']) {
    eq(classifyHqCountry(c), NORTH_AMERICA, `"${c}" is North America`);
  }
  // The abbreviations with periods: `clean` strips a trailing one, so both
  // written forms have to resolve.
  eq(classifyHqCountry('U.S.'), NORTH_AMERICA, '"U.S." is North America');
  eq(classifyHqCountry('U.S.A.'), NORTH_AMERICA, '"U.S.A." is North America');

  eq(classifyHqCountry('Canada'), NORTH_AMERICA, 'Canada is North America');
  eq(classifyHqCountry('Mexico'), NORTH_AMERICA, 'Mexico is North America');
  eq(classifyHqCountry('Bermuda'), NORTH_AMERICA, 'Bermuda is North America');
  eq(classifyHqCountry('Puerto Rico'), NORTH_AMERICA, 'Puerto Rico is North America');

  // ISO 3166-1 alpha-3, the way several uploaded portfolios write it.
  eq(classifyHqCountry('CAN'), NORTH_AMERICA, 'the alpha-3 code CAN resolves');
  eq(classifyHqCountry('MEX'), NORTH_AMERICA, 'the alpha-3 code MEX resolves');

  // A state in a column headed Country: the cell is wrong about what it
  // holds, not about where the company is.
  eq(classifyHqCountry('Texas'), NORTH_AMERICA, 'a US state in the Country cell still places it');
  eq(classifyHqCountry('Ontario'), NORTH_AMERICA, 'and so does a Canadian province');
}

// ── Outside North America ──────────────────────────────────────────────
{
  for (const c of ['Singapore', 'United Kingdom', 'Sweden', 'Italy', 'Malaysia', 'Germany', 'Australia']) {
    eq(classifyHqCountry(c), OUTSIDE_NORTH_AMERICA, `${c} is outside North America`);
  }
  eq(classifyHqCountry('GBR'), OUTSIDE_NORTH_AMERICA, 'the alpha-3 code GBR is outside North America');

  // Unlike a free-text location, a Country cell has no city/country
  // ambiguity to protect against — one unrecognised segment is a country
  // we don't have listed, not a city we might mistake for one.
  eq(classifyHqCountry('Kazakhstan'), OUTSIDE_NORTH_AMERICA, 'an unlisted country is outside North America');
}

// ── Nothing to go on ───────────────────────────────────────────────────
{
  eq(classifyHqCountry(''), '', 'a blank country is unknown, not foreign');
  eq(classifyHqCountry('   '), '', 'and so is whitespace');
  eq(classifyHqCountry(null), '', 'and so is a missing cell');
  eq(classifyHqCountry(undefined), '', 'and so is an undefined one');
}

// ── The full-location classifier still behaves ─────────────────────────
{
  // classifyHqCountry must not have changed how a free-text location reads:
  // a bare city there is still unknown rather than foreign.
  eq(classifyHqRegion('Toronto, Ontario, Canada'), NORTH_AMERICA, 'a NA location still classifies');
  eq(classifyHqRegion('Zug, Switzerland'), OUTSIDE_NORTH_AMERICA, 'a foreign location still classifies');
  eq(classifyHqRegion('Houston'), '', 'a bare city is still unknown');
  eq(classifyHqRegion('Dallas, U.S.'), NORTH_AMERICA, 'a location ending "U.S." now resolves too');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

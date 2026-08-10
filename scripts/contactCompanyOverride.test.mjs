// Assertion tests for the per-contact Company pin. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/contactCompanyOverride.test.mjs
//
// The pin is what makes a typed Company name survive the next HubSpot
// sync, so the failures that matter are the ones that lose an edit or
// lose somebody else's data:
//
//   - not writing the pin at all (the bug this replaced: the popup saved
//     to HubSpot and the cache, and the next refresh put the old name
//     back);
//   - clobbering the other local fields on the same contact, or the pins
//     on other contacts, while writing this one.
import { withCompanyOverride } from '../src/utils/contactCompanyOverride.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// ---- setting a pin ----------------------------------------------------------

eq(withCompanyOverride({}, '101', 'Revantage'), { 101: { _companyOverride: 'Revantage' } },
  'a typed company is pinned under the contact id');
eq(withCompanyOverride(null, '101', 'Revantage'), { 101: { _companyOverride: 'Revantage' } },
  'a missing map is treated as empty, not a crash');
eq(withCompanyOverride(undefined, '101', 'Revantage'), { 101: { _companyOverride: 'Revantage' } },
  'so is undefined');
eq(withCompanyOverride({}, 101, 'Revantage'), { 101: { _companyOverride: 'Revantage' } },
  'a numeric contact id keys the same entry as its string form');
eq(withCompanyOverride({}, '101', '  Revantage  '), { 101: { _companyOverride: 'Revantage' } },
  'the pinned value is trimmed');

// ---- nothing to write -------------------------------------------------------

eq(withCompanyOverride({ 101: { _companyOverride: 'Revantage' } }, '101', 'Revantage'), null,
  're-pinning the same name is a no-op, so no settings write');
eq(withCompanyOverride({}, '101', ''), null, 'clearing a pin that was never set is a no-op');
eq(withCompanyOverride({}, '', 'Revantage'), null, 'no contact id means nothing to pin');
eq(withCompanyOverride({}, null, 'Revantage'), null, 'a null contact id is the same');
eq(withCompanyOverride({}, '101', '   '), null, 'whitespace is not a name to pin');

// ---- clearing a pin ---------------------------------------------------------

eq(withCompanyOverride({ 101: { _companyOverride: 'Revantage' } }, '101', ''), {},
  'clearing the only local field drops the contact from the map entirely');
eq(withCompanyOverride({ 101: { _companyOverride: 'Revantage' } }, '101', null), {},
  'null clears it too — the popup passes null when the field is emptied');
eq(withCompanyOverride({ 101: { _companyOverride: 'Revantage', _newCompany: 'Acme' } }, '101', ''),
  { 101: { _newCompany: 'Acme' } },
  'clearing the pin leaves the contact\'s other local fields alone');

// ---- everything else on the map is untouched --------------------------------

eq(withCompanyOverride({ 101: { _newCompany: 'Acme', _linkedinProfile: 'in/x' } }, '101', 'Revantage'),
  { 101: { _newCompany: 'Acme', _linkedinProfile: 'in/x', _companyOverride: 'Revantage' } },
  'pinning merges into the contact\'s existing local fields');
eq(withCompanyOverride({ 102: { _companyOverride: 'Blackstone' } }, '101', 'Revantage'),
  { 102: { _companyOverride: 'Blackstone' }, 101: { _companyOverride: 'Revantage' } },
  'another contact\'s pin survives');

// The input map is never mutated — callers hand in the live settings
// object and hold onto it until the write lands.
{
  const before = { 101: { _companyOverride: 'Blackstone' } };
  const snapshot = JSON.stringify(before);
  withCompanyOverride(before, '101', 'Revantage');
  eq(JSON.stringify(before), snapshot, 'the settings map handed in is not mutated');
}

// A corrupt payload reads as "no pins" rather than throwing on a save.
eq(withCompanyOverride(['nope'], '101', 'Revantage'), { 101: { _companyOverride: 'Revantage' } },
  'an array payload is ignored rather than spread into the map');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

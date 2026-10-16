// Assertion tests for the company popup's division rule (divisionQualifiers
// and carriesDivision in src/utils/companyIndex.js). Run:
//   node scripts/carriesDivision.test.mjs
//
// The reported case: "Brookfield (Self Storage)" listed the parent's
// contacts ("Brookfield", "Brookfield Asset Management") because the fuzzy
// match drops the bracket.
import assert from 'node:assert/strict';
import { divisionQualifiers, carriesDivision } from '../src/utils/companyIndex.js';

const SS = 'Brookfield (Self Storage)';
assert.equal(carriesDivision('Brookfield', SS), false);
assert.equal(carriesDivision('Brookfield Asset Management', SS), false);
assert.equal(carriesDivision('Brookfield Asset Management Inc (BAM)', SS), false);
assert.equal(carriesDivision('Brookfield Properties', SS), false);
assert.equal(carriesDivision('Brookfield Self Storage', SS), true);
assert.equal(carriesDivision('Brookfield (Self Storage)', SS), true);
assert.equal(carriesDivision('brookfield self-storage', SS), true);
assert.equal(carriesDivision('', SS), false);

// One-word division brackets that aren't acronyms count too.
assert.equal(carriesDivision('Brookfield', 'Brookfield (Residential)'), false);
assert.equal(carriesDivision('Brookfield Residential', 'Brookfield (Residential)'), true);

// Brackets that aren't a division change nothing.
for (const name of [
  '(TIAA) Teachers Insurance and Annuity Association of America',
  'Jones Lang LaSalle (JLL)',
  'Blue Sky Holdings (US)',
  'Rehlko (a Platinum Equity Co.)',
  'Acme (formerly Zenith)',
  'Acme (owned by KKR)',
  'Acme Realty',
]) {
  assert.deepEqual(divisionQualifiers(name), [], name);
  assert.equal(carriesDivision('Anything', name), true, name);
}

assert.deepEqual(divisionQualifiers(SS), [['self', 'storage']]);
assert.deepEqual(divisionQualifiers('Brookfield (Maymont Homes)'), [['maymont', 'homes']]);

console.log('carriesDivision: all assertions passed');

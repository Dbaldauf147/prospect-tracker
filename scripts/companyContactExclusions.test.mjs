// node scripts/companyContactExclusions.test.mjs
import { companyContactRestoreUpdate } from '../src/utils/companyContactExclusions.js';

let passed = 0; let failed = 0;
const eq = (got, want, msg) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { passed++; console.log(`  ok  ${msg}`); }
  else { failed++; console.log(`  FAIL ${msg}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); }
};

const settings = { companyContactExclusions: { 'the carlyle group': ['1', '2'], hines: ['1'] } };
eq(companyContactRestoreUpdate('the carlyle group', '1')(settings),
  { companyContactExclusions: { 'the carlyle group': ['2'], hines: ['1'] } }, 're-add takes the id off that company only');
eq(companyContactRestoreUpdate('Hines', 1)(settings),
  { companyContactExclusions: { 'the carlyle group': ['1', '2'] } }, 'a company left empty drops out; key and id are normalised');
eq(companyContactRestoreUpdate('hines', '9')(settings), null, 'not removed there: no write');
eq(companyContactRestoreUpdate('hines', '1')({}), null, 'no exclusions at all: no write');
eq(settings.companyContactExclusions['the carlyle group'], ['1', '2'], 'the settings passed in are not changed');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

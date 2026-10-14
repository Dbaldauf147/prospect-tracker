// Assertion tests for sub verticals mapped from verticals.
// Run: node scripts/subVerticals.test.mjs
import {
  subVerticalsFor, withSubVertical, withoutSubVertical, renameSubVertical, subVerticalOnList,
} from '../src/utils/subVerticals.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const map = { Healthcare: ['Hospitals', 'Clinics'], Retail: ['Grocery'] };

check('for', subVerticalsFor(map, 'Healthcare'), ['Hospitals', 'Clinics']);
check('for ignores case and spaces', subVerticalsFor(map, ' healthcare '), ['Hospitals', 'Clinics']);
check('for unknown vertical', subVerticalsFor(map, 'Education'), []);
check('for no vertical', subVerticalsFor(map, ''), []);
check('for no map', subVerticalsFor(undefined, 'Retail'), []);

// Add.
check('add to existing', withSubVertical(map, 'healthcare', ' Labs ').Healthcare, ['Hospitals', 'Clinics', 'Labs']);
check('add keeps the existing key', Object.keys(withSubVertical(map, 'healthcare', 'Labs')), ['Healthcare', 'Retail']);
check('add new vertical', withSubVertical(map, 'Education', 'K-12').Education, ['K-12']);
check('add duplicate is a no-op', withSubVertical(map, 'Healthcare', 'hospitals'), map);
check('add blank is a no-op', withSubVertical(map, 'Healthcare', '  '), map);
check('add with no vertical is a no-op', withSubVertical(map, '', 'X'), map);
check('add does not mutate', map.Healthcare, ['Hospitals', 'Clinics']);

// Remove.
check('remove', withoutSubVertical(map, 'Healthcare', 'clinics').Healthcare, ['Hospitals']);
check('remove last drops the vertical', 'Retail' in withoutSubVertical(map, 'Retail', 'Grocery'), false);
check('remove missing', withoutSubVertical(map, 'Healthcare', 'Nope').Healthcare, ['Hospitals', 'Clinics']);

// Rename.
check('rename in place', renameSubVertical(map, 'Healthcare', 'Clinics', 'Outpatient').Healthcare, ['Hospitals', 'Outpatient']);
check('rename onto existing is a no-op', renameSubVertical(map, 'Healthcare', 'Clinics', 'hospitals'), map);
check('rename case only', renameSubVertical(map, 'Healthcare', 'Clinics', 'CLINICS').Healthcare, ['Hospitals', 'CLINICS']);
check('rename to blank is a no-op', renameSubVertical(map, 'Healthcare', 'Clinics', ' '), map);
check('rename missing is a no-op', renameSubVertical(map, 'Healthcare', 'Nope', 'X'), map);

check('on list', subVerticalOnList(map, 'healthcare', 'HOSPITALS'), true);
check('not on list', subVerticalOnList(map, 'Retail', 'Hospitals'), false);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

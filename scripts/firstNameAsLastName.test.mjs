// Assertion tests for the contact popup's "first name in the Last Name box"
// warning. Plain Node, no test framework. Run:
//   node scripts/firstNameAsLastName.test.mjs
import { isTypicalFirstName, firstNameAsLastNameWarning, contactNameWarning } from '../src/utils/firstNameAsLastName.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

for (const n of ['Sarah', 'michael', ' JENNIFER ', 'Zoë', 'Mike']) check(`${n} is a first name`, isTypicalFirstName(n), true);
// Names that are ordinary surnames too stay quiet, as do real surnames.
for (const n of ['Thomas', 'James', 'Martin', 'Lee', 'Scott', 'Taylor', 'Kelly', 'Chen', 'Smith', 'Johnson', 'Peters', 'Williams', '', null, 'Mary Ann']) {
  check(`${n} is not flagged`, isTypicalFirstName(n), false);
}

check('swapped names', firstNameAsLastNameWarning('Chen', 'Sarah'),
  { lastname: 'Sarah', firstname: 'Chen', firstAlsoGiven: false, canSwap: true });
check('two first names', firstNameAsLastNameWarning('Sarah', 'Michael'),
  { lastname: 'Michael', firstname: 'Sarah', firstAlsoGiven: true, canSwap: true });
check('no first name, nothing to swap', firstNameAsLastNameWarning('', ' John '),
  { lastname: 'John', firstname: '', firstAlsoGiven: false, canSwap: false });
check('an ordinary name', firstNameAsLastNameWarning('Sarah', 'Chen'), null);
check('a two-way surname', firstNameAsLastNameWarning('Chris', 'Martin'), null);
check('no last name', firstNameAsLastNameWarning('Sarah', ''), null);
check('nothing at all', firstNameAsLastNameWarning(), null);

// A contact as a list holds it.
check('record fields win over the display name', contactNameWarning({ firstname: 'Krisch', lastname: 'Michael', name: 'Michael Krisch' })?.lastname, 'Michael');
check('record fields that are fine', contactNameWarning({ firstname: 'Michael', lastname: 'Krisch', name: 'Krisch Michael' }), null);
check('a display name alone', contactNameWarning({ name: 'Kochevar  Margaret' }),
  { lastname: 'Margaret', firstname: 'Kochevar', firstAlsoGiven: false, canSwap: true });
check('middle words are skipped', contactNameWarning({ name: 'Lopez de la Danny' })?.lastname, 'Danny');
check('a one-word name', contactNameWarning({ name: 'Sarah' }), null);
check('the names on the Draft Emails list', ['Colindres Issac', 'Collier Philip', 'Knolle Matthew', 'Kochevar Margaret', 'Krisch Michael', 'Lopez Danny', 'Jennifer McLean', 'Douglas Odeyssa', 'Duncan Russell', 'Marc Garry', 'Mark Lewis']
  .filter(n => contactNameWarning({ name: n })), ['Colindres Issac', 'Collier Philip', 'Knolle Matthew', 'Kochevar Margaret', 'Krisch Michael', 'Lopez Danny']);
check('no contact', contactNameWarning(null), null);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

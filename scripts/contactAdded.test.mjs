// Assertion tests for the Contacts > History Date Added helpers. Plain Node:
//   node scripts/contactAdded.test.mjs
import { contactAddedMs, addedWithin } from '../src/utils/contactAdded.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}

const iso = '2026-11-10T15:00:00.000Z';
check('ISO create date', contactAddedMs({ createdate: iso }), Date.parse(iso));
check('epoch-ms string create date', contactAddedMs({ createdate: String(Date.parse(iso)) }), Date.parse(iso));
check('no create date is null, not 1970', [contactAddedMs({}), contactAddedMs({ createdate: '' }), contactAddedMs(null)], [null, null, null]);

const now = Date.parse('2026-11-19T12:00:00.000Z');
check('inside the window', addedWithin(Date.parse(iso), 30, now), true);
check('outside the window', addedWithin(Date.parse(iso), 7, now), false);
check('no date is in no window', addedWithin(null, 90, now), false);

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nAll passed');

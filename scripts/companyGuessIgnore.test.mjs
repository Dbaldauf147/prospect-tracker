// Assertion tests for ignoring a guessed-company pairing on the HubSpot
// page. Plain Node, no test framework. Run:
//   node scripts/companyGuessIgnore.test.mjs
import {
  guessPairKey, groupGuessedCompanies, ignoredGuessSet, isGuessIgnored,
  ignoreGuessesUpdate, unignoreGuessUpdate,
} from '../src/utils/companyGuessIgnore.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const contacts = [
  { id: '1', firstname: 'Ann', lastname: 'Lee', company: 'Acme Corp', guessedCompany: 'Acme Corporation', email: 'ann@acme.com' },
  { id: '2', firstname: 'Bo', lastname: 'Ray', company: ' acme corp ', guessedCompany: 'Acme Corporation', email: 'bo@other.com' },
  { id: '3', company: '', guessedCompany: 'Acme Corporation', email: 'cy@Acme.com' },
  { id: '4', company: '', guessedCompany: 'Acme Corporation', email: 'di@acmegroup.com' },
  { id: '5', company: 'Zed', guessedCompany: '', email: 'e@zed.com' },
];

eq(guessPairKey(contacts[0]), 'acme corp=>acme corporation', 'a typed name keys the pair');
eq(guessPairKey(contacts[2]), '@acme.com=>acme corporation', 'a blank company keys on the email domain');
eq(guessPairKey(contacts[4]), '', 'no guess, no key');

const rows = groupGuessedCompanies(contacts);
eq(rows.map(r => [r.current, r.guess, r.count]), [
  ['Acme Corp', 'Acme Corporation', 2],
  ['(blank) @acme.com', 'Acme Corporation', 1],
  ['(blank) @acmegroup.com', 'Acme Corporation', 1],
], 'one row per pairing, biggest first, domains kept apart');
eq(rows[0].examples, 'Ann Lee, Bo Ray', 'examples name the contacts');

// Ignoring one domain's guess leaves the other domain's alone.
const patch = ignoreGuessesUpdate(['@acmegroup.com=>acme corporation'])({});
eq(patch, { ignoredCompanyGuesses: ['@acmegroup.com=>acme corporation'] }, 'ignore writes the key list');
const ignored = ignoredGuessSet(patch);
eq(contacts.map(c => isGuessIgnored(ignored, c)), [false, false, false, true, false], 'only that pairing is ignored');
eq(isGuessIgnored(ignored, { company: '', guessedCompany: 'ACME Corporation', email: 'new@acmegroup.com' }), true,
  'a contact synced later with the same pairing is ignored too');
eq(ignoreGuessesUpdate(['@acmegroup.com=>acme corporation'])(patch), null, 'ignoring it again writes nothing');
eq(unignoreGuessUpdate('@acmegroup.com=>acme corporation')(patch), { ignoredCompanyGuesses: [] }, 'undo removes it');
eq(unignoreGuessUpdate('nope')(patch), null, 'undoing an unknown key writes nothing');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

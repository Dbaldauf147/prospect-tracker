// Which address to offer a contact nobody has an email for, and which of
// them to back with the star.
// Plain Node, no test framework (the project has none). Run:
//   node scripts/emailSuggestions.test.mjs
//
// The chips themselves are old. What is new is the claim that one of them
// is likelier than the others, and a claim is worth testing because somebody
// is going to act on it by sending an email.
//
// Four ways it goes wrong:
//
//   1. Backing a guess over knowledge. A company whose Email Domains field
//      names its convention has already answered this; a star anywhere else
//      is the form ignoring its own record.
//
//   2. Starring nothing. A recorded pattern can build an address the four
//      fixed shapes never produce (lastname.firstname@), and a star on a
//      chip that is not in the list is no star at all.
//
//   3. Learning from the wrong people. A convention read off a parent
//      company's roster says nothing about how a subsidiary spells its
//      addresses, and free-mail addresses say nothing about anybody's
//      employer.
//
//   4. Saying "we know" when it means "usually". first.last@ is the
//      commonest convention there is and that is still a guess; the basis
//      has to come back different so the tooltip can say so.
import { emailSuggestions } from '../src/utils/emailSuggestions.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${actual}\n      want: ${expected}`}`);
}
const NAME = { firstname: 'Carrie', lastname: 'Leonard' };
const run = (opts) => emailSuggestions({ ...NAME, ...opts });
const starred = (rows) => (rows.find(r => r.primary) || {}).email || '(none)';
const emails = (rows) => rows.map(r => r.email).join(',');

// ---- the shapes on offer -------------------------------------------------
{
  const rows = run({ emailDomains: ['amh.com'] });
  check('every shape the form has always offered is still offered',
    new Set(rows.map(r => r.email)).size, 4);
  check('and they are all at the domain on file',
    rows.every(r => r.email.endsWith('@amh.com')), true);
  check('exactly one of them is backed', rows.filter(r => r.primary).length, 1);
}

// ---- nothing to go on ----------------------------------------------------
// The commonest convention leads, and says that is all it is.
{
  const rows = run({ emailDomains: ['amh.com'] });
  check('with nothing on record the commonest convention leads',
    starred(rows), 'carrie.leonard@amh.com');
  check('and it says so rather than claiming to know', rows[0].basis, 'common');
  check('the backed one is first in the list', rows[0].primary, true);
}

// ---- the company's own record wins --------------------------------------
{
  const rows = run({ emailDomains: ['firstinitiallastname@amh.com'] });
  check('a recorded pattern is what gets backed', starred(rows), 'cleonard@amh.com');
  check('on the record, not on a guess', rows[0].basis, 'recorded');
  check('and it leads the list', emails(rows).startsWith('cleonard@amh.com'), true);
  // The other three are still there: a record can be out of date, and the
  // chips are how somebody corrects it in the moment.
  check('the other shapes are still offered', rows.length, 4);
}

// A pattern the four fixed shapes never build. Starring a chip that is not
// in the list would be starring nothing.
{
  const rows = run({ emailDomains: ['lastname.firstname@amh.com'] });
  check('a pattern outside the fixed four is added to the list',
    starred(rows), 'leonard.carrie@amh.com');
  check('rather than quietly dropped', rows.length, 5);
  check('and it leads', rows[0].email, 'leonard.carrie@amh.com');
}

// A bare domain listed before a pattern for the same domain must not
// silence it - the field is free text and the order in it means nothing.
{
  const rows = run({ emailDomains: ['amh.com', 'firstinitiallastname@amh.com'] });
  check('a bare domain does not out-rank a pattern for the same domain',
    starred(rows), 'cleonard@amh.com');
  check('and the domain is still only offered once', rows.length, 4);
}

// ---- learning from the people already there ------------------------------
{
  const contacts = [
    { firstname: 'Ann', lastname: 'Waters', email: 'awaters@amh.com' },
    { firstname: 'Bob', lastname: 'Reilly', email: 'breilly@amh.com' },
    { firstname: 'Cass', lastname: 'Nunez', email: 'cass.nunez@amh.com' },
  ];
  const rows = run({ emailDomains: ['amh.com'], contacts });
  check('with no pattern on file the roster decides',
    starred(rows), 'cleonard@amh.com');
  check('and says it was read off them', rows[0].basis, 'learned');
  check('naming how many it counted', rows[0].why.includes('2 of the 3 contacts'), true);

  // Knowledge beats evidence: somebody wrote the field down on purpose.
  const recorded = run({ emailDomains: ['firstname.lastname@amh.com'], contacts });
  check('a recorded pattern beats what the roster implies',
    starred(recorded), 'carrie.leonard@amh.com');
  check('and says which it used', recorded[0].basis, 'recorded');
}

// A convention learned at a domain this company does not list is a
// convention for somebody else's addresses.
{
  const elsewhere = [
    { firstname: 'Ann', lastname: 'Waters', email: 'awaters@parentco.com' },
    { firstname: 'Bob', lastname: 'Reilly', email: 'breilly@parentco.com' },
  ];
  const rows = run({ emailDomains: ['amh.com'], contacts: elsewhere });
  check('a pattern at another domain does not decide this one',
    starred(rows), 'carrie.leonard@amh.com');
  check('so it falls back to the common convention', rows[0].basis, 'common');
}

// Free-mail addresses say nothing about an employer's convention.
{
  const personal = [
    { firstname: 'Ann', lastname: 'Waters', email: 'awaters@gmail.com' },
    { firstname: 'Bob', lastname: 'Reilly', email: 'breilly@gmail.com' },
  ];
  const rows = run({ emailDomains: ['amh.com'], contacts: personal });
  check('a gmail address is not evidence about the company',
    rows[0].basis, 'common');
}

// ---- several domains -----------------------------------------------------
{
  const rows = run({ emailDomains: ['amh.com', 'ah4r.com'] });
  check('both domains are offered', rows.length, 8);
  check('and the first one on the field is the one backed',
    starred(rows), 'carrie.leonard@amh.com');

  // A pattern recorded for the second domain still wins over a guess at the
  // first: a record beats no record, wherever in the field it sits.
  const mixed = run({ emailDomains: ['amh.com', 'firstinitiallastname@ah4r.com'] });
  check('a recorded pattern anywhere in the field beats a guess',
    starred(mixed), 'cleonard@ah4r.com');
}

// ---- half a name ---------------------------------------------------------
{
  const firstOnly = emailSuggestions({ firstname: 'Carrie', emailDomains: ['amh.com'] });
  check('a first name alone still offers what it can', emails(firstOnly), 'carrie@amh.com');
  check('and backs it', firstOnly[0].primary, true);
  // A recorded pattern that needs both names cannot be built from one.
  const needsBoth = emailSuggestions({
    firstname: 'Carrie', emailDomains: ['firstname.lastname@amh.com'],
  });
  check('a pattern that needs a surname is not built without one',
    starred(needsBoth), 'carrie@amh.com');
  check('falling back rather than offering a half-built address',
    needsBoth[0].basis, 'common');
  const lastOnly = emailSuggestions({ lastname: 'Leonard', emailDomains: ['amh.com'] });
  check('a surname alone builds none of the four shapes', emails(lastOnly), '');
}

// ---- nothing to offer ----------------------------------------------------
check('no name, no suggestions', emailSuggestions({ emailDomains: ['amh.com'] }).length, 0);
check('no domain, no suggestions', run({ emailDomains: [] }).length, 0);
check('and a domain that is not one is skipped', run({ emailDomains: ['amh'] }).length, 0);
check('no arguments at all is still an empty list', emailSuggestions().length, 0);

console.log(`\n${failures ? `${failures} FAILED` : 'All passed'}`);
process.exit(failures ? 1 : 0);

// Assertion tests for the email format a company card learns from its own
// contacts. Plain Node - no test framework (the project has none). Run:
//   node scripts/emailDomainPattern.test.mjs
//
// The Email Domains field is not decoration: it is what every guessed
// address on the account is built from, so a wrong estimate is a wrong
// address sent to a real person. What is pinned here is therefore mostly
// where the estimate REFUSES to guess - no work addresses, no agreement,
// a free-mail-only account - and that the pattern keys it writes are the
// same strings buildEmailFromPattern reads back.
import {
  EMAIL_PATTERN_RULES, estimateEmailDomain, detectLocalPattern, buildEmailFromPattern, domainOf,
} from '../src/utils/emailDomainPattern.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const c = (email, firstname, lastname) => ({ email, firstname, lastname });

// --- reading one address -------------------------------------------------
check('firstname.lastname', detectLocalPattern('john.smith@ahr.com', 'John', 'Smith'), 'firstname.lastname');
check('firstinitiallastname', detectLocalPattern('jsmith@ahr.com', 'John', 'Smith'), 'firstinitiallastname');
check('lastname.firstname', detectLocalPattern('smith.john@ahr.com', 'John', 'Smith'), 'lastname.firstname');
check('a name with an apostrophe still reads', detectLocalPattern("andrew.od@ahr.com", 'Andrew', "O'D"), 'firstname.lastname');
// A filing tag is one person's habit, not the company's convention.
check('a +tag suffix is ignored', detectLocalPattern('john.smith+crm@ahr.com', 'John', 'Smith'), 'firstname.lastname');
check('an address that matches nothing', detectLocalPattern('jxs7@ahr.com', 'John', 'Smith'), null);
check('no address at all', detectLocalPattern('', 'John', 'Smith'), null);
check('the domain half', domainOf('John.Smith@AHR.com'), 'ahr.com');

// --- the estimate --------------------------------------------------------
const roster = [
  c('john.smith@ahr.com', 'John', 'Smith'),
  c('jane.doe@ahr.com', 'Jane', 'Doe'),
  c('mia.czarnecki@ahr.com', 'Mia', 'Czarnecki'),
  // A personal address says nothing about the employer's format.
  c('somebody@gmail.com', 'Some', 'Body'),
  // On the domain, but following nothing: counted as a contact, not a vote.
  c('info@ahr.com', 'Front', 'Desk'),
];
const est = estimateEmailDomain(roster);
check('the winning entry', est.entry, 'firstname.lastname@ahr.com');
check('counted off the domain, free-mail excluded', [est.domainCount, est.votes, est.total], [4, 3, 4]);
check('and says which address taught it', est.sample, 'john.smith@ahr.com');

// The busiest domain decides, and only the people ON it get a vote - a
// handful at a parent company must not set a subsidiary's convention.
const twoDomains = [
  c('john.smith@ahr.com', 'John', 'Smith'),
  c('jane.doe@ahr.com', 'Jane', 'Doe'),
  c('adoe@parentco.com', 'Alice', 'Doe'),
  c('bsmith@parentco.com', 'Bob', 'Smith'),
  c('mia.czarnecki@ahr.com', 'Mia', 'Czarnecki'),
];
check(
  'the busiest domain wins, with its own people voting',
  estimateEmailDomain(twoDomains).entry,
  'firstname.lastname@ahr.com',
);

// --- where it declines to guess -----------------------------------------
check('nobody to learn from', estimateEmailDomain([]).reason, 'no-contacts');
check('nobody to learn from offers nothing', estimateEmailDomain([]).entry, null);
check(
  'free-mail and blanks only',
  estimateEmailDomain([c('a@gmail.com', 'A', 'B'), c('', 'C', 'D')]).reason,
  'no-work-emails',
);
const noPattern = estimateEmailDomain([
  c('info@ahr.com', 'Front', 'Desk'),
  c('jxs7@ahr.com', 'John', 'Smith'),
]);
check('a domain nobody spells the same way', [noPattern.entry, noPattern.reason, noPattern.domain],
  [null, 'no-pattern', 'ahr.com']);
// A bare domain is deliberately NOT offered: the field's job is to build an
// address, and "ahr.com" builds nothing. See estimateEmailDomain.
check('so no bare domain is handed back', noPattern.entry, null);

// One contact is a thin sample but a real answer, and the button says how
// thin it is (the count is on the label).
check(
  'one contact is still an answer',
  estimateEmailDomain([c('john.smith@ahr.com', 'John', 'Smith')]).entry,
  'firstname.lastname@ahr.com',
);

// Same roster, same answer, whatever order it arrives in: two domains with
// equal counts break the tie on the name rather than on iteration order.
const tied = [c('a.b@alpha.com', 'A', 'B'), c('c.d@beta.com', 'C', 'D')];
check('a tie is broken the same way every run',
  [estimateEmailDomain(tied).domain, estimateEmailDomain([...tied].reverse()).domain],
  ['alpha.com', 'alpha.com']);

// --- the round trip that matters ----------------------------------------
// Whatever the estimate writes, buildEmailFromPattern has to read: this is
// the pair that turns a name-only paste into an address.
for (const rule of EMAIL_PATTERN_RULES) {
  const local = rule.build('john', 'smith');
  if (!local) continue;
  const learned = estimateEmailDomain([c(`${local}@ahr.com`, 'John', 'Smith')]);
  const built = buildEmailFromPattern(learned.entry, 'John', 'Smith');
  check(`round trip: ${rule.key}`, built, `${local}@ahr.com`);
}
check('a bare domain builds nothing', buildEmailFromPattern('ahr.com', 'John', 'Smith'), '');
check('an unknown pattern builds nothing', buildEmailFromPattern('initials@ahr.com', 'John', 'Smith'), '');
check('no name, no address', buildEmailFromPattern('firstname.lastname@ahr.com', '', ''), '');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

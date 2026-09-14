// Assertion tests for the ownership rule behind steps 6 and 7 of the
// Prospecting ladder. Plain Node - no test framework (the project has
// none). Run:
//   node scripts/ladderOwnership.test.mjs
//
// Two rules and one lookup, and the lookup is the part that can quietly go
// wrong: the PE step holds the account record itself, but the visit step
// holds a HubSpot contact whose Company is free text somebody typed. Match
// it too loosely and another CDM's account lands on the page; match it too
// tightly and the user's own contacts vanish because the account is spelled
// "Acme Corporation" in Table View and "Acme Corp" in HubSpot.
//
// The rules themselves:
//   1. The account's CDM is this user - read through the same matchesCdm
//      the rest of the app uses, so the abbreviated spellings the sheet is
//      full of still resolve.
//   2. Its Status is not "Lost - Not Sold" - the account has answered, and
//      a ladder of what to work next should not be naming it.
//   3. No account behind the contact at all is NOT the user's. A company
//      nobody has put in Table View is not evidence of ownership, and
//      guessing otherwise is how somebody else's book reaches this page.
import { isOwnedAccount, makeOwnedContactGate, NOT_SOLD_STATUS } from '../src/utils/ladderOwnership.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const ME = 'Dan Baldauf';

// --- the rule on an account record --------------------------------------
check('this user\'s account', isOwnedAccount({ cdm: ME, status: 'Qualifying' }, ME), true);
check('another CDM\'s is not', isOwnedAccount({ cdm: 'Alex Moreno', status: 'Qualifying' }, ME), false);
check('a blank CDM is nobody\'s', isOwnedAccount({ cdm: '', status: 'Client' }, ME), false);
check('the abbreviated spellings still resolve',
  ['Dan Baldauf', 'Daniel Baldauf', 'D. Baldauf', 'Baldauf, Dan', 'Dan B.'].map(cdm => isOwnedAccount({ cdm }, ME)),
  [true, true, true, true, true]);
check('written off is off the list', isOwnedAccount({ cdm: ME, status: NOT_SOLD_STATUS }, ME), false);
check('and the status is spelled as the record spells it', NOT_SOLD_STATUS, 'Lost - Not Sold');
check('every other status is still workable',
  ['Client', 'Inside Sales', 'Qualifying', 'Hold Off', 'Old Client', 'Partnering w/Another CDM', '']
    .map(status => isOwnedAccount({ cdm: ME, status }, ME)),
  [true, true, true, true, true, true, true]);
check('no record is not an account', isOwnedAccount(null, ME), false);
// A user with no CDM name of their own matches nothing rather than
// everything - the same reading every other CDM-scoped list in the app
// gives it.
check('no cdm name matches nothing', isOwnedAccount({ cdm: ME }, ''), false);

// --- the lookup from a contact back to an account ------------------------
const prospects = [
  { company: 'Acme Corporation', cdm: ME, status: 'Qualifying', emailDomain: 'acme.com' },
  { company: 'Borex Industries', cdm: 'Alex Moreno', status: 'Qualifying', emailDomain: 'borex.com' },
  { company: 'Cindermill', cdm: ME, status: NOT_SOLD_STATUS, website: 'https://www.cindermill.com/about' },
  { company: 'Drayton Foods', cdm: ME, status: 'Client' },
];
const owned = makeOwnedContactGate(prospects, ME);

check('an exact company name', owned({ company: 'Drayton Foods' }), true);
check('case and padding do not matter', owned({ company: '  drayton foods ' }), true);
check('another CDM\'s account', owned({ company: 'Borex Industries' }), false);
check('a written-off account', owned({ company: 'Cindermill' }), false);
// HubSpot's Company text and Table View's rarely agree to the character.
check('a shorter spelling still finds the account', owned({ company: 'Acme Corp' }), true);
check('a suffix is not a difference', owned({ company: 'Drayton Foods, Inc.' }), true);
// ...but the fuzzy fallback must not reach past the account it belongs to.
check('a single shared word is not the same company', owned({ company: 'Acme Bank' }), false);
// The account's own domains answer when the company text doesn't.
check('the email domain stands in for a missing company',
  owned({ company: '', email: 'ann@acme.com' }), true);
check('and it is the account\'s domain that decides, not the user\'s',
  owned({ company: '', email: 'bob@borex.com' }), false);
check('a Website field is a domain too',
  owned({ company: '', email: 'cy@cindermill.com' }), false);
// A personal address belongs to a person, not an account.
check('free mail never stands in for an account',
  owned({ company: '', email: 'ann@gmail.com' }), false);
// The company text wins over the domain when both are there: it is what the
// contacts pages show and what the user edited.
check('the company name is read first',
  owned({ company: 'Borex Industries', email: 'someone@acme.com' }), false);

// Nothing behind the contact is not the user's, however it got that way.
check('a company nobody has in Table View', owned({ company: 'Nowhere Ltd' }), false);
check('no company and no usable email', owned({ company: '', email: '' }), false);
check('nothing at all', owned(null), false);

// An empty book owns nothing rather than everything.
check('an empty book', makeOwnedContactGate([], ME)({ company: 'Acme Corporation' }), false);
check('no book at all', makeOwnedContactGate(null, ME)({ company: 'Acme Corporation' }), false);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

// Assertion tests for the Email Campaign Tracker's "add an email" suggestions.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/contactSuggest.test.mjs
//
// What's worth pinning: a name, an address and a company all find the same
// person; the start of any of them beats the middle of it; somebody already
// in the campaign is never offered; and — the one that decides whether the
// box is still usable for an address HubSpot has never heard of — a query too
// short, or a pasted list, offers nothing rather than guessing.
import {
  contactName, matchContacts, isAddressList, normContactEmail,
} from '../src/utils/contactSuggest.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const contacts = [
  { id: '1', firstname: 'Drew', lastname: 'Gadigian', email: 'dgadigian@cerberus.com', company: 'Cerberus Capital Management' },
  { id: '2', firstname: 'Trista', lastname: 'Huang', email: 'thuang@brehotels.com', company: 'BRE Hotels & Resorts' },
  { id: '3', firstname: 'Eric', lastname: 'Pan', email: 'eric.pan@warburgpincus.com', company: 'Warburg Pincus' },
  { id: '4', firstname: 'Andrew', lastname: 'Quigley', email: 'equigley@performproperties.com', company: 'Perform Properties' },
  { id: '5', firstname: 'William', lastname: 'Loyd', email: 'william.loyd@nb.com', company: 'Neuberger Berman' },
];
const emails = (rows) => rows.map(r => r.email);

// --- the name on a row ----------------------------------------------------
check('first and last', contactName(contacts[0]), 'Drew Gadigian');
check('a bare name field', contactName({ name: 'Sam Reed' }), 'Sam Reed');
// Nameless in HubSpot: the address is all there is, so it is made readable
// rather than leaving the row blank.
check('read off the address', contactName({ email: 'carrie.denning-jackson@x.com' }), 'Carrie Denning Jackson');
check('nothing at all', contactName({}), '');

// --- finding a person -----------------------------------------------------
// "An-drew Quigley" contains it too, and should be offered — just second.
check('by first name', emails(matchContacts(contacts, 'drew')),
  ['dgadigian@cerberus.com', 'equigley@performproperties.com']);
check('by last name', emails(matchContacts(contacts, 'huang')), ['thuang@brehotels.com']);
check('by address', emails(matchContacts(contacts, 'equigley')), ['equigley@performproperties.com']);
check('by domain', emails(matchContacts(contacts, '@nb.com')), ['william.loyd@nb.com']);
check('by company', emails(matchContacts(contacts, 'warburg')), ['eric.pan@warburgpincus.com']);
check('case is ignored', emails(matchContacts(contacts, 'DREW')),
  ['dgadigian@cerberus.com', 'equigley@performproperties.com']);
check('nobody matches', matchContacts(contacts, 'zzzz'), []);

// The start of a name beats the middle of one: "Drew Gadigian" leads even
// though "Andrew Quigley" also contains "drew".
check('prefix leads', matchContacts(contacts, 'drew')[0].name, 'Drew Gadigian');
const dre = matchContacts(contacts, 'dre', { limit: 5 });
check('Drew leads Andrew', emails(dre), ['dgadigian@cerberus.com', 'equigley@performproperties.com']);
check('the leader is a prefix match', dre[0].score, 2);
check('the follower is a substring match', dre[1].score, 1);

// --- what a row carries ---------------------------------------------------
check('a row is name, address and company', (({ name, email, company }) => ({ name, email, company }))(dre[0]),
  { name: 'Drew Gadigian', email: 'dgadigian@cerberus.com', company: 'Cerberus Capital Management' });

// --- who is left out ------------------------------------------------------
check('already in the campaign',
  emails(matchContacts(contacts, 'dre', { exclude: ['DGADIGIAN@cerberus.com'] })),
  ['equigley@performproperties.com']);
check('no address, no row', matchContacts([{ firstname: 'Ghost', lastname: 'Contact' }], 'ghost'), []);
check('the same address twice is one row',
  matchContacts([contacts[0], { ...contacts[0], id: '99', firstname: 'Drew' }], 'drew').length, 1);

// --- when NOT to suggest --------------------------------------------------
// The box has to stay a plain text field for an address nobody has on file.
check('nothing typed', matchContacts(contacts, ''), []);
check('one character is not a search', matchContacts(contacts, 'd'), []);
check('whitespace is nothing typed', matchContacts(contacts, '   '), []);
check('no contacts cached yet', matchContacts([], 'drew'), []);
check('no cache at all', matchContacts(undefined, 'drew'), []);
check('a semicolon list', isAddressList('a@x.com; b@y.com'), true);
check('a comma list', isAddressList('a@x.com, b@y.com'), true);
check('one address is not a list', isAddressList('a@x.com'), false);
check('a half-typed name is not a list', isAddressList('drew'), false);

// --- the cap --------------------------------------------------------------
const many = Array.from({ length: 30 }, (_, n) => ({ id: String(n), firstname: 'Sam', lastname: `Reed${n}`, email: `sam${n}@acme.com` }));
check('capped by default', matchContacts(many, 'sam').length, 8);
check('the cap is settable', matchContacts(many, 'sam', { limit: 3 }).length, 3);

// --- the address key ------------------------------------------------------
check('trimmed and lowered', normContactEmail('  SAM@Acme.com '), 'sam@acme.com');
check('nothing', normContactEmail(undefined), '');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

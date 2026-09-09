// Assertion tests for the "Met In Person" rule and the Prospecting page's
// visit list. Plain Node — no test framework (the project has none). Run:
//   node scripts/metInPerson.test.mjs
//
// The rules worth pinning: the local checkbox beats the legacy HubSpot tag
// in both directions, a contact nobody has ticked either way still counts
// as met when the old tag says so, and the list under the visits step
// groups by the account a trip would be to — with a coverage that hasn't
// landed reading as "unknown" rather than "you have met everybody".
import { hasMetInPersonTag, resolveMetInPerson, keyContactsNotMet } from '../src/utils/metInPerson.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

// --- the flag itself -------------------------------------------------
check('the legacy tag, in the column the cache happens to carry',
  hasMetInPersonTag({ dans_tags: 'Decision Maker;Met In Person' }), true);
check('and in the older spelling', hasMetInPersonTag({ dan_s_tags: 'met in person' }), true);
check('no tag, not met', hasMetInPersonTag({ dans_tags: 'Decision Maker' }), false);
check('nothing at all', hasMetInPersonTag(null), false);

const tagged = { id: '1', dans_tags: 'Met In Person' };
const untagged = { id: '2', dans_tags: 'Decision Maker' };

check('untouched falls back to the tag', resolveMetInPerson(tagged, {}), true);
check('untouched and untagged is not met', resolveMetInPerson(untagged, {}), false);
check('the checkbox ticks someone the tag never did', resolveMetInPerson(untagged, { 2: true }), true);
// The one that matters: unticking is an answer, not an absence, so the old
// tag must not put the contact back.
check('an explicit no beats the tag', resolveMetInPerson(tagged, { 1: false }), false);
check('no map at all is the tag', resolveMetInPerson(tagged, null), true);
// Numeric ids off HubSpot and the string keys settings stores them under
// are the same contact.
check('numeric id, string key', resolveMetInPerson({ id: 7 }, { 7: true }), true);
check('vid stands in for id', resolveMetInPerson({ vid: '9' }, { 9: true }), true);

// --- the visit list --------------------------------------------------
const person = (id, name, company, extra = {}) => ({
  id, name, company,
  email: `${name.toLowerCase().replace(/ /g, '.')}@example.com`,
  contact: { id, company, city: extra.city, state: extra.state, dans_tags: extra.tags || '' },
});
const coverage = {
  key: {
    people: [
      person('1', 'Ann Alpha', 'Acme Corp', { city: 'Chicago', state: 'IL' }),
      person('2', 'Bob Beta', 'Acme Corp', { city: 'Chicago', state: 'IL' }),
      person('3', 'Cy Gamma', 'Acme Corp', { city: 'Chicago', state: 'IL', tags: 'Met In Person' }),
      person('4', 'Dee Delta', 'Borex', { state: 'OH' }),
      person('5', 'Eve Epsilon', '', {}),
    ],
  },
};

const all = keyContactsNotMet(coverage, {});
// Cy is tagged met, so four names over three groups.
check('the unmet total', all.total, 4);
// The company-less group isn't an account to visit, so it isn't counted as one.
check('accounts to visit', all.accounts, 2);
check('grouped by account, fullest first, no-company last',
  all.groups.map(g => [g.company, g.location, g.people.map(p => p.name)]),
  [
    ['Acme Corp', 'Chicago, IL', ['Ann Alpha', 'Bob Beta']],
    ['Borex', 'OH', ['Dee Delta']],
    ['', '', ['Eve Epsilon']],
  ]);
// The popup opens off the row, so the record has to travel with the name.
check('the record travels with the name', all.groups[0].people[0].contact.id, '1');

// Ticking the box on the page drops the name; unticking Cy's legacy tag
// brings him back.
const ticked = keyContactsNotMet(coverage, { 1: true, 2: true });
check('ticked contacts drop off', ticked.groups.map(g => g.company), ['Borex', '']);
check('and the account count follows', [ticked.total, ticked.accounts], [2, 1]);
check('an explicit no puts the tagged one back',
  keyContactsNotMet(coverage, { 3: false }).groups[0].people.map(p => p.name),
  ['Ann Alpha', 'Bob Beta', 'Cy Gamma']);

// Everybody met is an empty list, which the page renders as nothing at all.
check('nobody left to meet',
  keyContactsNotMet(coverage, { 1: true, 2: true, 4: true, 5: true }),
  { total: 0, accounts: 0, groups: [] });

// And a coverage that hasn't landed is unknown, not empty — otherwise the
// step would claim a finished book while the contacts were still loading.
check('coverage not loaded', keyContactsNotMet(null, {}), null);
check('no key roster on it', keyContactsNotMet({ all: { people: [] } }, {}), null);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

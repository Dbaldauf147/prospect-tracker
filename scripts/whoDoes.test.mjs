// "Who does ___ at this company?" suggestions on the Contacts tab.
//
// Run: node scripts/whoDoes.test.mjs
import { keywordsOf, titleMatches, titleSuggestions, namedOnTab, namedToDraft } from '../src/utils/whoDoes.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n  expected ${e}\n  actual   ${a}`); }
}

const q = { id: 'q1', question: 'Who does energy procurement?', keywords: 'energy, procurement; sustainability' };
eq(keywordsOf(q), ['energy', 'procurement', 'sustainability'], 'keywords split on commas and semicolons');
eq(titleMatches({ jobtitle: 'VP, Energy & Sustainability' }, ['energy']), true, 'title keyword match');
eq(titleMatches({ jobtitle: 'Synergy Lead' }, ['energy']), false, 'whole words only (no "synergy")');
eq(titleMatches({ jobtitle: 'Head of Facilities Management' }, ['facilities management']), true, 'phrase keyword');
eq(titleMatches({ jobtitle: '' }, ['energy']), false, 'no title, no match');

const onTabContacts = [
  { id: '1', firstname: 'Ann', lastname: 'Able', jobtitle: 'Energy Manager', email: 'ann@acme.com', company: 'Acme Corp' },
  { id: '2', firstname: 'Bob', lastname: 'Baker', jobtitle: 'CFO', email: 'bob@acme.com', company: 'Acme Corp' },
];
const all = [
  ...onTabContacts,
  { id: '3', firstname: 'Cy', lastname: 'Cole', jobtitle: 'Procurement Director', email: 'cy@acme.com', company: 'ACME Holdings' },
  { id: '4', firstname: 'Di', lastname: 'Dunn', jobtitle: 'Sustainability Lead', email: 'di@other.com', company: 'Acme Industries' },
  { id: '5', firstname: 'Ed', lastname: 'Eng', jobtitle: 'Energy Analyst', email: 'ed@zeta.com', company: 'Zeta' },
  { id: '6', firstname: 'Fay', lastname: 'Fox', jobtitle: 'Energy Buyer', email: 'fay@acme.com', company: 'Acme', dans_tags: 'Hide' },
  { id: '7', firstname: 'Gil', lastname: 'Gray', jobtitle: 'Energy VP', email: 'gil@acme.com', company: 'Acme' },
];
const s = titleSuggestions({ question: q, company: 'Acme Corp', companyContacts: onTabContacts, allContacts: all, domains: ['acme.com'], excludedIds: ['7'] });
eq(s.onTab.map(c => c.id), ['1'], 'on-tab contacts whose title matches');
eq(s.toAdd.map(c => c.id), ['3', '4'], 'close matches off the tab: by domain (3) and lead word (4); not elsewhere (5), hidden (6) or removed (7)');
eq(titleSuggestions({ question: { keywords: '' }, company: 'Acme', companyContacts: onTabContacts, allContacts: all }), { onTab: [], toAdd: [] }, 'no keywords, no suggestions');

eq(namedOnTab({ name: 'x', email: 'BOB@acme.com' }, onTabContacts)?.id, '2', 'named person found by email');
eq(namedOnTab({ name: 'Ann Able' }, onTabContacts)?.id, '1', 'or by name when no email given');
eq(namedOnTab({ name: 'New Person', email: 'new@acme.com' }, onTabContacts), null, 'not on the tab yet');
eq(namedToDraft({ name: 'Mary Ann Smith', email: 'm@acme.com', title: 'Facilities' }, 'Acme Corp'),
  { company: 'Acme Corp', firstname: 'Mary', lastname: 'Ann Smith', email: 'm@acme.com', jobtitle: 'Facilities', phone: '', mobilephone: '', hs_linkedin_url: '', dans_tags: '' },
  'named person becomes an Add Contact draft');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

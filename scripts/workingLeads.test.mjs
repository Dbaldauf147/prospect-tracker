// Assertion tests for the Working Marketing Leads bucket that the Draft
// Emails right column shows below Saved Drafts. Plain Node - no test
// framework (the project has none). Run:
//   node scripts/workingLeads.test.mjs
//
// The cases worth guarding are the ones that DROP a lead, since a lead
// silently missing from the bucket looks the same as a lead nobody set to
// Working: hidden leads, leads with no usable email, and the same person
// saved twice.
import { workingLeadContacts, isWorkingLead, leadToDraftContact } from '../src/utils/workingLeads.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const lead = (over = {}) => ({
  id: over.id || `s_${over.name || 'x'}`,
  name: '', email: '', company: '', jobTitle: '', status: '', ...over,
});
const names = list => list.map(c => c.name);

// ---- which statuses count --------------------------------------------

eq(isWorkingLead({ status: 'Working' }), true, 'Working is the worked status');
eq(isWorkingLead({ status: '  working ' }), true, 'status matching ignores case and padding');
eq(isWorkingLead({ status: 'Nurture' }), false, 'another status is not Working');
eq(isWorkingLead({ status: '' }), false, 'a blank status is not Working');
eq(isWorkingLead({}), false, 'a missing status is not Working');
eq(isWorkingLead(null), false, 'a missing row is not Working');

// ---- the bucket -------------------------------------------------------

const settings = {
  marketingLeads: [
    lead({ id: 'a', name: 'Rita Alvarez', email: 'rita@acme.com', company: 'Acme', jobTitle: 'VP Ops', status: 'Working' }),
    lead({ id: 'b', name: 'Colleen Reid', email: 'colleen@globex.com', company: 'Globex', status: 'working' }),
    lead({ id: 'c', name: 'Sam Nurture', email: 'sam@initech.com', status: 'Nurture' }),
    lead({ id: 'd', name: 'No Email', email: '', status: 'Working' }),
    lead({ id: 'e', name: 'Bad Email', email: 'not-an-address', status: 'Working' }),
  ],
};

eq(names(workingLeadContacts(settings)), ['Colleen Reid', 'Rita Alvarez'],
  'only Working leads with a usable email, sorted by name');

eq(workingLeadContacts({ marketingLeads: [] }), [], 'no saved leads gives an empty bucket');
eq(workingLeadContacts(undefined), [], 'missing settings gives an empty bucket');
eq(workingLeadContacts({ marketingLeads: 'nope' }), [], 'a non-list marketingLeads gives an empty bucket');

// ---- hidden leads stay hidden ----------------------------------------

eq(names(workingLeadContacts({ ...settings, marketingLeadsHiddenLeads: ['a'] })), ['Colleen Reid'],
  'a lead hidden on the Marketing Leads page is left out of the bucket');

// ---- one person, one recipient ---------------------------------------

const dupes = {
  marketingLeads: [
    lead({ id: 'a', name: 'Rita Alvarez', email: 'rita@acme.com', status: 'Working' }),
    lead({ id: 'a2', name: 'Rita Alvarez', email: 'RITA@ACME.COM', status: 'Working' }),
  ],
};
eq(workingLeadContacts(dupes).length, 1, 'the same email saved twice collapses to one recipient');
eq(workingLeadContacts(dupes)[0].id, 'lead:a', 'the first copy of a duplicated email wins');

// ---- the contact shape the composer gets ------------------------------

eq(leadToDraftContact(lead({ id: 'a', name: 'Rita Del Mar Alvarez', email: ' rita@acme.com ', company: 'Acme', jobTitle: 'VP Ops' })), {
  id: 'lead:a',
  name: 'Rita Del Mar Alvarez',
  firstName: 'Rita',
  lastName: 'Del Mar Alvarez',
  email: 'rita@acme.com',
  company: 'Acme',
  title: 'VP Ops',
}, 'a lead becomes a composer contact with the name split for {firstName}');

eq(leadToDraftContact(lead({ id: 'z', name: '', email: 'anon@acme.com' })).name, 'anon@acme.com',
  'a nameless lead falls back to its email for display');

eq(workingLeadContacts(settings)[1].id, 'lead:a',
  'bucket ids are namespaced so a lead cannot collide with a HubSpot contact id');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

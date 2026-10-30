// Assertion tests for the company popup's list of title-only event
// attendees (titleOnlyAttendeesForCompany in src/utils/eventsStore.js).
// Plain Node, no framework. Run:
//   node scripts/titleOnlyAttendees.test.mjs
//
// What has to hold: only title-only attendees count, matched on their
// company or the lookup row's company against any of the company's names;
// one entry per title with each event once, newest first; decision makers
// on top.
import { titleOnlyAttendeesForCompany } from '../src/utils/eventsStore.js';
import { normalizeCompany } from '../src/utils/companyNorm.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed += 1; console.log(`PASS  ${name}`); }
  else { failed += 1; console.log(`FAIL  ${name}\n  expected ${e}\n  actual   ${a}`); }
}

const events = [
  { id: 'e1', name: 'NAREIT', date: '2026-06-01', attendees: [
    { titleOnly: true, title: 'VP Sustainability', company: 'Acme Realty' },
    { titleOnly: true, title: 'Head of ESG', company: 'Acme Realty Inc.', decisionMaker: true },
    { titleOnly: true, title: 'CFO', company: 'Globex' },
    { contactId: '1', name: 'Jane Doe', company: 'Acme Realty', title: 'VP Sustainability' },
  ] },
  { id: 'e2', name: 'GRESB', date: '2026-09-15', attendees: [
    { titleOnly: true, title: 'vp sustainability', company: 'ACME', lookupCompany: 'Acme Realty' },
    { titleOnly: true, title: 'VP Sustainability', company: 'Acme Realty' },
  ] },
];
const got = titleOnlyAttendeesForCompany(events, ['Acme Realty'], normalizeCompany);
eq(got.map(g => g.title), ['Head of ESG', 'VP Sustainability'], 'title-only attendees at the company, decision makers first, named contacts and other companies left out');
eq(got[1].events.map(e => e.name), ['GRESB', 'NAREIT'], 'one entry per title, each event once, newest first, matched on the lookup company too');
eq(got[0].decisionMaker, true, 'a decision maker is flagged');
eq(titleOnlyAttendeesForCompany(events, ['Globex Holdings', 'Globex'], normalizeCompany).map(g => g.title), ['CFO'], 'an alias matches');
eq(titleOnlyAttendeesForCompany(events, [''], normalizeCompany), [], 'no names, nothing');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

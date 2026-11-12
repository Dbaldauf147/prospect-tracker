// Hubspot Mapping > Gap Fill: which export contacts are missing from the
// app, and which the app has with blanks the export can fill.
// Plain Node:
//   node scripts/hubspotContactGaps.test.mjs
import assert from 'node:assert/strict';
import { appContactsByEmail, contactGapRows, appContactName, GAP, gapFillPlan, gapFillBlocked } from '../src/utils/hubspotContactGaps.js';

const app = [
  { id: '1', email: 'Full@Acme.com', firstname: 'Ann', lastname: 'Full', jobtitle: 'CFO', phone: '555', hs_linkedin_url: 'https://linkedin.com/in/ann', company: 'Acme' },
  { id: '2', email: 'gaps@acme.com', firstname: 'Bo', lastname: '', jobtitle: '', mobilephone: '', company: 'Acme' },
  { id: '3', email: 'new.address@beta.com', firstname: 'Cy', lastname: 'Moved', jobtitle: 'VP', phone: '1', linkedin_url: 'x', company: 'Beta' },
  { id: '4', email: 'cell@acme.com', firstname: 'Di', lastname: 'Cell', jobtitle: 'Dir', mobilephone: '777', hs_linkedinid: 'di', company: 'Acme' },
];
const byEmail = appContactsByEmail(app, { 3: 'old.address@beta.com; other@beta.com', 99: 'ghost@x.com' });
assert.equal(byEmail.get('full@acme.com').id, '1', 'emails are matched without case');
assert.equal(byEmail.get('old.address@beta.com').id, '3', 'an old email finds its contact');
assert.equal(byEmail.has('ghost@x.com'), false, 'old emails of a contact the app no longer has are ignored');

const exportRows = [
  // Has everything already: no row.
  { email: 'full@acme.com', firstName: 'Ann', lastName: 'Full', jobTitle: 'CFO', phone: '555', linkedIn: 'https://linkedin.com/in/ann', companyName: 'Acme' },
  // App is blank on last name, title, phone, LinkedIn.
  { email: 'GAPS@acme.com', firstName: 'Bo', lastName: 'Gaps', jobTitle: 'Head of ESG', phone: '+1 212', linkedIn: 'https://linkedin.com/in/bo', companyName: 'Acme' },
  // Not in the app.
  { email: 'brand.new@acme.com', firstName: 'Ed', jobTitle: 'Analyst' },
  // In the app under an old email: nothing missing, so no row.
  { email: 'old.address@beta.com', firstName: 'Cy', lastName: 'Moved', jobTitle: 'VP', phone: '1', linkedIn: 'x', companyName: 'Beta' },
  // A mobile number and a LinkedIn id count as the app having them.
  { email: 'cell@acme.com', phone: '999', linkedIn: 'https://linkedin.com/in/di' },
  // No email: skipped, whatever else it has.
  { contactName: 'No Email', phone: '1' },
  { email: 'not-an-email', phone: '1' },
  // Same email twice (two companies): one row.
  { email: 'brand.new@acme.com', companyName: 'Other Co' },
  // Found through the work email.
  { email: '', workEmail: 'gaps@acme.com', phone: '1' },
];
const rows = contactGapRows(exportRows, byEmail);
assert.deepEqual(rows.map(r => [r.gapEmail, r.gap]), [
  ['gaps@acme.com', GAP.missingData],
  ['brand.new@acme.com', GAP.notInApp],
]);
const gaps = rows[0];
assert.deepEqual(gaps.fill, ['phone', 'linkedIn', 'jobTitle', 'lastName']);
assert.equal(gaps.fillLabels, 'Phone, LinkedIn, Job title, Last name');
assert.equal(gaps.app.id, '2');
assert.equal(rows[1].app, null);
assert.deepEqual(rows[1].fill, []);
assert.equal(rows[1].companyName, undefined, 'the first copy of a repeated email is the one kept');

assert.equal(appContactName(app[0]), 'Ann Full');
assert.equal(appContactName({ email: 'x@y.com' }), 'x@y.com');
assert.deepEqual(contactGapRows([], byEmail), []);
assert.equal(contactGapRows([{ email: 'a@b.com' }], new Map())[0].gap, GAP.notInApp, 'an empty app reads every email as not in it');

// What Gap Fill sends.
assert.deepEqual(gapFillPlan({
  gap: GAP.notInApp, gapEmail: 'eric@aegon.com', firstName: 'Eric', lastName: 'Verschut', jobTitle: 'Director', phone: '+31 70',
  linkedIn: 'https://linkedin.com/in/eric', companyName: 'Aegon USA Investment Management', account: { company: 'Aegon' },
}), { kind: 'add', properties: { email: 'eric@aegon.com', phone: '+31 70', hs_linkedin_url: 'https://linkedin.com/in/eric', jobtitle: 'Director', firstname: 'Eric', lastname: 'Verschut', company: 'Aegon' } }, 'add takes every field, and the My Accounts company name');
assert.deepEqual(gapFillPlan({ gap: GAP.notInApp, gapEmail: 'x@y.com', companyName: 'HubSpot Co' }).properties, { email: 'x@y.com', company: 'HubSpot Co' }, 'no account: HubSpot\'s company name');
assert.deepEqual(gapFillPlan({
  gap: GAP.missingData, gapEmail: 'j@a.com', fill: ['phone', 'companyName'], phone: '(210) 373-8238', jobTitle: 'Already there',
  companyName: 'Alberta Investment Management', account: { company: 'AIMCo' }, app: { id: '123', jobtitle: 'Already there' },
}), { kind: 'fill', contactId: '123', properties: { phone: '(210) 373-8238', company: 'AIMCo' } }, 'fill sends only the blank fields');
assert.equal(gapFillPlan({ gap: GAP.missingData, gapEmail: 'j@a.com', fill: ['phone'], phone: '1', app: { id: 'local-1' } }), null, 'a local-only contact is not in HubSpot to update');
assert.equal(gapFillPlan({ gap: GAP.missingData, gapEmail: 'j@a.com', fill: [], app: { id: '1' } }), null, 'nothing to fill');
assert.equal(gapFillPlan(null), null);

// Add / Fill only on an active My Accounts company.
assert.equal(gapFillBlocked({ account: { company: 'Aegon', status: 'Client' } }), '', 'an active account');
assert.equal(gapFillBlocked({ account: null }), 'Not one of your My Accounts companies');
assert.equal(gapFillBlocked({ account: { company: 'X', status: 'Old Client' } }), 'X is Old Client');
assert.equal(gapFillBlocked({ account: { company: 'X', status: 'Lost - Not Sold' } }), 'X is Lost - Not Sold');
assert.equal(gapFillBlocked({ account: { company: 'X', status: 'Hold Off' } }), 'X is Hold Off');
assert.equal(gapFillBlocked({ account: { company: 'X', status: 'Client' } }, () => 'Budget'), 'X is Hold Off', 'a substatus reads as Hold Off');

console.log('hubspotContactGaps: all assertions passed');

// Assertion tests for Draft Emails > Client Campaigns: which current
// clients a campaign reached, and who at each.
// Plain Node, no framework. Run:
//   node scripts/clientCampaignCoverage.test.mjs
import { currentClients, campaignChoices, clientCampaignRows } from '../src/utils/clientCampaignCoverage.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}

const prospects = [
  { id: '1', company: 'Acme Holdings', status: 'Client', cdm: 'Dan Baldauf', emailDomain: 'acme.com' },
  { id: '2', company: 'Globex Corp', status: 'Client', cdm: 'Dan Baldauf', website: 'https://www.globex.io/about' },
  { id: '3', company: 'Initech', status: 'Client', cdm: 'Someone Else' },
  { id: '4', company: 'Umbrella', status: 'Prospect', cdm: 'Dan Baldauf' },
  { id: '5', company: 'Acme Holdings', status: 'Client', cdm: 'Dan Baldauf' },
  { id: '6', company: 'Hooli', status: 'Client', cdm: 'Dan Baldauf' },
];

check('clients: mine, Client only, one per company', currentClients(prospects, 'Dan Baldauf').map(p => p.id), ['1', '2', '6']);
check('clients: no CDM set means every Client', currentClients(prospects, '').map(p => p.id), ['1', '2', '3', '6']);

const campaign = {
  title: 'Q4 rates update',
  contacts: [
    { email: 'jane@acme.com', name: 'Jane Doe', company: 'Acme Holdings', sentDate: '2026-10-01T12:00:00Z', replied: true },
    { email: 'bob@acme.com', name: 'Bob', company: '', sentDate: '2026-10-03T12:00:00Z' },
    { email: 'zed@acme.com', name: 'Zed', company: 'Acme' },
    { email: 'amy@globex.io; carl@hooli.com', name: 'Amy', company: '', sentDate: '2026-09-20' },
    { email: 'pat@initech.com', name: 'Pat', company: 'Initech', sentDate: '2026-10-01' },
    { email: 'me@se.com', name: 'Internal', company: 'Acme Holdings' },
    { email: 'x@gmail.com', name: 'Free mail', company: '' },
  ],
};
const rows = clientCampaignRows({ prospects, cdmName: 'Dan Baldauf', campaign });
const by = Object.fromEntries(rows.map(r => [r.company, r]));
check('rows: one per current client', rows.map(r => r.company), ['Acme Holdings', 'Globex Corp', 'Hooli']);
check('acme: matched by name and by domain, replied first', by['Acme Holdings'].people.map(p => [p.name, p.status]), [
  ['Jane Doe', 'Replied'], ['Bob', 'No Reply'], ['Zed', 'Not Sent'],
]);
check('acme: counts', [by['Acme Holdings'].onCampaign, by['Acme Holdings'].sent, by['Acme Holdings'].replied, by['Acme Holdings'].lastSent], [3, 2, 1, '2026-10-03']);
check('globex: matched by website domain', by['Globex Corp'].people.map(p => p.name), ['Amy']);
check('hooli: no domain on the record, so a grouped send by address does not match', by.Hooli.onCampaign, 0);
check('internal addresses are left out', rows.flatMap(r => r.people).some(p => p.name === 'Internal'), false);
check('no campaign: every client with nobody', clientCampaignRows({ prospects, cdmName: 'Dan Baldauf', campaign: null }).map(r => r.onCampaign), [0, 0, 0]);

check('choices: newest first', campaignChoices([
  { title: 'Old', savedAt: '2026-01-01' }, { title: 'New', savedAt: '2026-06-01' }, null,
]).map(c => c.label), ['New', 'Old']);

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nAll client campaign coverage tests passed.');

// Assertion tests for Draft Emails > Client Campaigns: which current
// clients a campaign reached, and who at each.
// Plain Node, no framework. Run:
//   node scripts/clientCampaignCoverage.test.mjs
import { currentClients, campaignChoices, clientCampaignRows, clientServiceBuckets, rosterAccounts } from '../src/utils/clientCampaignCoverage.js';

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
check("clients: Don't Track ticks are left out", currentClients(prospects, 'Dan Baldauf', { 'globex corp': true }).map(p => p.id), ['1', '6']);
check("rows: a Don't Track client has no row", clientCampaignRows({ prospects, cdmName: 'Dan Baldauf', campaign: null, untrackedMap: { hooli: true } }).map(r => r.company), ['Acme Holdings', 'Globex Corp']);
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

{
  const rows = clientCampaignRows({ prospects, cdmName: 'Dan Baldauf', campaign: null });
  const status = { 'Acme Holdings': 'Sold', 'Globex Corp': 'N/A', Hooli: 'Renewal' };
  const out = clientServiceBuckets({ rows, services: ['Advisory'], statusOf: (c, svc) => (svc === 'Advisory' ? status[c.company] : '') });
  check('buckets: one block per service', out.map(o => o.service), ['Advisory']);
  check('buckets: every bucket listed, empty ones too', out[0].buckets.map(b => `${b.label}:${b.clients.map(x => x.row.company).join('|')}`),
    ['Sold:Acme Holdings', 'In progress:', 'Not sold:', 'N/A:Globex Corp', 'Not explored:Hooli']);
  check('buckets: Renewal shows under Not explored', out[0].buckets.find(b => b.key === 'none').clients.map(x => x.status), ['Renewal']);
}

{
  // Key Contacts / Prospects: the companies behind a contact roster.
  const contacts = [
    { email: 'kim@umbrella.com', company: 'Umbrella', key: true },
    { email: 'lee@umbrella.com', company: 'Umbrella Corp', key: true },
    { email: 'ann@acme.com', company: '', key: true },
    { email: 'off@initech.com', company: 'Initech', key: false },
    { email: 'who@nowhere.com', company: 'Nowhere LLC', key: true },
    { email: 'via@sub.com', company: 'Sub Co', key: true, via: 'Hooli' },
  ];
  const gate = c => c.key;
  check('roster accounts: gate passers, one per company, unmatched dropped',
    rosterAccounts({ prospects, contacts, gate }).map(p => p.id), ['4', '1']);
  check('roster accounts: accountOf names the record',
    rosterAccounts({ prospects, contacts, gate, accountOf: c => c.via || '' }).map(p => p.id), ['4', '1', '6']);
  check("roster accounts: Don't Track left off",
    rosterAccounts({ prospects, contacts, gate, untrackedMap: { umbrella: true } }).map(p => p.id), ['1']);
  const accounts = rosterAccounts({ prospects, contacts, gate });
  const krows = clientCampaignRows({ prospects, campaign: { contacts: [{ email: 'kim@umbrella.com', name: 'Kim', company: 'Umbrella', sentDate: '2026-10-01' }, { email: 'jane@acme.com', name: 'Jane', company: 'Acme Holdings' }] }, accounts });
  check('rows over other accounts: one per account, people matched to them',
    krows.map(r => [r.company, r.people.map(p => p.name)]), [['Umbrella', ['Kim']], ['Acme Holdings', ['Jane']]]);
}

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nAll client campaign coverage tests passed.');

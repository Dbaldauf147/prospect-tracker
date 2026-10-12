// Assertion tests for Prospecting > Tiered's last-activity reading. Plain
// Node, no framework. Run:
//   node scripts/tieredAccountActivity.test.mjs
import { lastActivityByAccount, myTieredAccounts, daysSince, ownerVia } from '../src/utils/tieredAccountActivity.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const prospects = [
  { id: 'a', company: 'Acme Corp', cdm: 'Dan Baldauf', tier: 'Tier 2', status: 'Qualifying' },
  { id: 'b', company: 'Beta Industries', cdm: 'Dan Baldauf', tier: 'Tier 1', bfoCompanyName: 'Beta Ind Holdings' },
  { id: 'c', company: 'Gamma', cdm: 'Dan Baldauf', tier: 'Not on tier list' },
  { id: 'd', company: 'Delta', cdm: 'Someone Else', tier: 'Tier 1' },
  { id: 'e', company: 'Echo', cdm: 'Baldauf', tier: 'Tier 1' },
];

const accounts = myTieredAccounts(prospects, 'Dan Baldauf');
eq(accounts.map(p => p.id), ['b', 'e', 'a'], 'my Tier 1-3 accounts only, tier then name order');

const contacts = [
  { id: '1', company: 'Acme Corp', email: 'jo@acme.com', phone: '(555) 111-2222', notes_last_contacted: '2026-08-01T10:00:00Z' },
  { id: '2', company: 'Acme', email: 'al@acme.com' },
  { id: '3', company: 'Acme Corp', email: 'me@se.com', dans_tags: 'Schneider' },
  { id: '4', company: 'Acme Corp', email: 'gone@acme.com', dans_tags: 'Hide' },
];
const t = (s) => Date.parse(s);
const outreachIndex = {
  emails: {
    'al@acme.com': { tsMs: t('2026-09-15T12:00:00Z'), type: 'email' },
    'gone@acme.com': { tsMs: t('2026-10-05T12:00:00Z'), type: 'email' },
  },
  phones: { 5551112222: { tsMs: t('2026-09-01T12:00:00Z'), type: 'call' } },
};
const m = lastActivityByAccount({ accounts, contacts, outreachIndex });
eq(m.get('a')?.source, 'HubSpot email', 'newest Acme activity is the email (hidden contact ignored)');
eq(m.get('a')?.detail, 'al@acme.com', 'names who it was with');
eq(m.get('a')?.tsMs, t('2026-09-15T12:00:00Z'), 'its timestamp');
eq(m.has('b'), false, 'no contact activity reads as absent');
eq(m.has('e'), false, 'no activity found reads as absent');

{
  // BFO Activity is not a source on this tab: a BFO row is matched on a
  // fuzzy account name, so one opportunity dated every look-alike account.
  const bfoActivity = {
    headers: ['Opportunity Name', 'Account Name', 'Last Activity'],
    rows: [{ 'Opportunity Name': 'Beta EAM', 'Account Name': 'Beta Industries', 'Last Activity': '9/20/2026' }],
  };
  const withBfo = lastActivityByAccount({ accounts, contacts, outreachIndex, bfoActivity });
  eq(withBfo.has('b'), false, 'BFO rows are ignored');
}

const noIndex = lastActivityByAccount({ accounts, contacts });
eq(noIndex.get('a')?.source, 'HubSpot last contacted', 'falls back to HubSpot Last Contacted without the index');

const excluded = lastActivityByAccount({ accounts, contacts, outreachIndex, exclusions: { 'acme corp': ['2'] } });
eq(excluded.get('a')?.source, 'HubSpot call', 'a contact removed from the account by hand no longer counts');

eq(m.get('a')?.contact, { id: '2', name: 'al@acme.com', email: 'al@acme.com', company: 'Acme', owner: '', tsMs: t('2026-09-15T12:00:00Z'), source: 'HubSpot email' }, 'contact is the newest one reached, at the account itself');
eq(noIndex.get('a')?.contact?.source, 'HubSpot last contacted', 'contact from Last Contacted without the index');

{
  // A contact at the parent, tied by the loose name match, is flagged as
  // reached through the owner.
  const storage = { id: 's', company: 'Brookfield (Self Storage)', cdm: 'Dan Baldauf', tier: 'Tier 3', peOwner: 'Brookfield' };
  const people = [
    { id: '20', company: 'Brookfield', firstname: 'Wendy', lastname: 'Lau', email: 'wendy@brookfield.com' },
    { id: '21', company: 'Brookfield Self Storage', firstname: 'Sam', lastname: 'Roe', email: 'sam@bss.com' },
  ];
  const parent = lastActivityByAccount({
    accounts: [storage], contacts: people,
    outreachIndex: { emails: { 'wendy@brookfield.com': { tsMs: t('2026-10-12T12:00:00Z') }, 'sam@bss.com': { tsMs: t('2026-09-01T12:00:00Z') } } },
  });
  eq([parent.get('s')?.contact?.name, parent.get('s')?.contact?.owner], ['Wendy Lau', 'Brookfield'], 'parent contact is flagged with the owner');
  const own = lastActivityByAccount({
    accounts: [storage], contacts: people,
    outreachIndex: { emails: { 'sam@bss.com': { tsMs: t('2026-09-01T12:00:00Z') } } },
  });
  eq([own.get('s')?.contact?.name, own.get('s')?.contact?.owner], ['Sam Roe', ''], 'contact at the account itself has no owner');
}

eq(daysSince(t('2026-10-01T00:00:00Z'), t('2026-10-09T12:00:00Z')), 8, 'whole days since');
eq(daysSince(null), null, 'no activity, no days');

eq(ownerVia({ company: 'Acme Corp', peOwner: 'KKR, Blue Owl Capital' }, 'Blue Owl Capital'), 'Blue Owl Capital', 'second of several owners');
eq(ownerVia({ company: 'Acme Corp', peOwner: 'KKR' }, 'Acme Corp.'), '', 'the account itself is not its owner');
eq(ownerVia({ company: 'Acme Corp' }, 'KKR'), '', 'no PE Owner field, no owner');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

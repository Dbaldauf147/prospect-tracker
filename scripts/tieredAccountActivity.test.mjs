// Assertion tests for Prospecting > Tiered's last-activity reading. Plain
// Node, no framework. Run:
//   node scripts/tieredAccountActivity.test.mjs
import { lastActivityByAccount, myTieredAccounts, daysSince } from '../src/utils/tieredAccountActivity.js';

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
const bfoActivity = {
  headers: ['Opportunity Name', 'Account Name', 'Last Activity'],
  rows: [
    { 'Opportunity Name': 'Beta EAM', 'Account Name': 'Beta Ind Holdings', 'Last Activity': '9/20/2026' },
    { 'Opportunity Name': 'Beta old', 'Account Name': 'Beta Ind Holdings', 'Last Activity': '1/2/2026' },
  ],
};

const m = lastActivityByAccount({ accounts, contacts, outreachIndex, bfoActivity });
eq(m.get('a')?.source, 'HubSpot email', 'newest Acme activity is the email (hidden contact ignored)');
eq(m.get('a')?.detail, 'al@acme.com', 'names who it was with');
eq(m.get('a')?.tsMs, t('2026-09-15T12:00:00Z'), 'its timestamp');
eq(m.get('b')?.source, 'BFO activity', 'BFO row matched on BFO Company Name');
eq(m.get('b')?.detail, 'Beta EAM', 'newest BFO row wins');
eq(m.has('e'), false, 'no activity found reads as absent');

const noIndex = lastActivityByAccount({ accounts, contacts });
eq(noIndex.get('a')?.source, 'HubSpot last contacted', 'falls back to HubSpot Last Contacted without the index');

const excluded = lastActivityByAccount({ accounts, contacts, outreachIndex, exclusions: { 'acme corp': ['2'] } });
eq(excluded.get('a')?.source, 'HubSpot call', 'a contact removed from the account by hand no longer counts');

eq(daysSince(t('2026-10-01T00:00:00Z'), t('2026-10-09T12:00:00Z')), 8, 'whole days since');
eq(daysSince(null), null, 'no activity, no days');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

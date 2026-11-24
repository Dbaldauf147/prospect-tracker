// Strategic Accounts warning in the company modal: which list rows are this
// company and who owns them. Plain Node, no framework. Run:
//   node scripts/strategicAccounts.test.mjs
//
// The two ways it goes wrong: flagging a company that is not on the list
// (fuzzy or already mapped elsewhere), and missing one that is (a mapped
// row whose name differs). Owners must come through whatever the column
// is called and however several names are packed into one cell.
import { strategicMatches, strategicNameKey, strategicLookup, strategicAccountRows } from '../src/utils/strategicAccounts.js';

let failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) console.log(`PASS  ${name}`);
  else { failed++; console.log(`FAIL  ${name}\n  expected ${e}\n  actual   ${a}`); }
}

const rows = [
  { 'Account Name': 'Blackstone Inc.', 'Account Owner': 'Jane Doe; John Roe' },
  { 'Account Name': 'Brookfield Asset Management', 'Account Owner': 'Sam Lee' },
  { 'Account Name': 'Hines', 'Account Owner': 'Pat Kim', 'Secondary Owner': 'Lee Park' },
  { 'Account Name': 'Hines', 'Account Owner': 'Pat Kim, Ana Ruiz' },
  { 'Account Name': 'Prologis', 'Account Owner': '' },
];

eq(strategicMatches(rows, 'Blackstone'), [{ name: 'Blackstone Inc.', owners: ['Jane Doe', 'John Roe'], mapped: false }], 'exact normalised name matches and splits owners');
eq(strategicMatches(rows, 'Brookfield'), [], 'a partial name is not flagged');
eq(strategicMatches(rows, 'Brookfield', { 'name::brookfield asset management': 'Brookfield' }), [{ name: 'Brookfield Asset Management', owners: ['Sam Lee'], mapped: true }], 'a row mapped here matches whatever its name');
eq(strategicMatches(rows, 'Blackstone', { 'name::blackstone': 'Blackstone Real Estate' }), [], 'a row mapped to another company is not this one');
eq(strategicMatches(rows, 'Blackstone', {}, { 'name::blackstone': true }), [], 'a dismissed row is not flagged');
eq(strategicMatches(rows, 'Hines'), [{ name: 'Hines', owners: ['Pat Kim', 'Lee Park', 'Ana Ruiz'], mapped: false }], 'duplicate rows merge owners across every owner column');
eq(strategicMatches(rows, 'Prologis'), [{ name: 'Prologis', owners: [], mapped: false }], 'a row with no owner still matches');
eq(strategicMatches([], 'Hines'), [], 'empty list');
eq(strategicNameKey([{ 'Owner Name': 'x', 'Company': 'y' }]), 'Company', 'an owner column is never the name column');

// My Accounts > Strategic Accounts: Tier 2 accounts, plus the CDM's own
// companies that the list names. Tier 1 accounts are left off, listed or not.
{
  const prospects = [
    { id: 'a', company: 'Blackstone', cdm: 'Dan', status: 'Prospect', tier: 'Tier 1' },
    { id: 'b', company: 'Hines', cdm: 'Dan', status: 'Client', tier: 'Tier 3' },
    { id: 'c', company: 'Prologis', cdm: 'Someone Else', tier: 'Tier 3' },
    { id: 'd', company: 'Acme', cdm: 'Dan', tier: 'Tier 3' },
    { id: 'e', company: 'Zeta', cdm: 'Dan', tier: 'Tier 2' },
    { id: 'f', company: 'Brookfield', cdm: 'Dan', tier: '' },
  ];
  // My Accounts carries a, d, e and (Tier 3) b; f is not on it at all.
  const accounts = [
    { ...prospects[0], myTier: 'Tier 1', tierLabel: 'Tier 1' },
    { ...prospects[1], myTier: 'Tier 3', tierLabel: 'Tier 3' },
    { ...prospects[3], myTier: 'Tier 3', tierLabel: 'Tier 3' },
    { ...prospects[4], myTier: 'Tier 2', tierLabel: 'Tier 2' },
  ];
  const lookup = strategicLookup(rows, { 'name::brookfield asset management': 'Brookfield' });
  const got = strategicAccountRows({ accounts, prospects, lookup, isCdm: c => c === 'Dan' });
  eq(got.map(r => [r.company, r.tier, r.reasons.join(' + '), r.owners.join(' + ')]), [
    ['Brookfield', '', 'Strategic Accounts list', 'Sam Lee'],
    ['Hines', 'Tier 3', 'Strategic Accounts list', 'Pat Kim + Lee Park + Ana Ruiz'],
    ['Zeta', 'Tier 2', 'Tier 2', ''],
  ], 'Tier 2 and my listed companies, not a Tier 1 account (even a listed one), another CDM\'s listed company or my unlisted Tier 3');
  eq(got.find(r => r.company === 'Brookfield').listNames, ['Brookfield Asset Management'], 'the list row behind a mapped company is named');
  eq(strategicAccountRows({ accounts, prospects, lookup: strategicLookup([]), isCdm: () => true }).map(r => r.company), ['Zeta'], 'no list uploaded leaves Tier 2');
}

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }

// Strategic Accounts warning in the company modal: which list rows are this
// company and who owns them. Plain Node, no framework. Run:
//   node scripts/strategicAccounts.test.mjs
//
// The two ways it goes wrong: flagging a company that is not on the list
// (fuzzy or already mapped elsewhere), and missing one that is (a mapped
// row whose name differs). Owners must come through whatever the column
// is called and however several names are packed into one cell.
import { strategicMatches, strategicNameKey, strategicLookup, strategicAccountRows, strategicTypeKey, isNamStrategicType, withoutNamStrategicRows, strategicTypes } from '../src/utils/strategicAccounts.js';

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

eq(strategicMatches(rows, 'Blackstone'), [{ name: 'Blackstone Inc.', owners: ['Jane Doe', 'John Roe'], types: [], mapped: false }], 'exact normalised name matches and splits owners');
eq(strategicMatches(rows, 'Brookfield'), [], 'a partial name is not flagged');
eq(strategicMatches(rows, 'Brookfield', { 'name::brookfield asset management': 'Brookfield' }), [{ name: 'Brookfield Asset Management', owners: ['Sam Lee'], types: [], mapped: true }], 'a row mapped here matches whatever its name');
eq(strategicMatches(rows, 'Blackstone', { 'name::blackstone': 'Blackstone Real Estate' }), [], 'a row mapped to another company is not this one');
eq(strategicMatches(rows, 'Blackstone', {}, { 'name::blackstone': true }), [], 'a dismissed row is not flagged');
// Mapped on the list page's My Accounts / Portfolio Companies columns rather than in Table View.
eq(strategicMatches(rows, 'Brookfield', {}, {}, [{ 'name::brookfield asset management': 'Brookfield' }]), [{ name: 'Brookfield Asset Management', owners: ['Sam Lee'], types: [], mapped: true }], 'a My Accounts mapping counts as a mapping');
eq(strategicMatches(rows, 'Brookfield Asset Management', {}, {}, [{ 'name::brookfield asset management': 'Brookfield' }]), [], 'and the row stops answering to its own name');
eq(strategicMatches(rows, 'Brookfield', {}, { 'name::brookfield asset management': true }, [{}, { 'name::brookfield asset management': 'Brookfield' }]), [{ name: 'Brookfield Asset Management', owners: ['Sam Lee'], types: [], mapped: true }], 'a column mapping outlives a Table View dismissal');
eq(['Blackstone RE', 'Blackstone Credit'].map(c => strategicMatches(rows, c, { 'name::blackstone': 'Blackstone RE' }, {}, [{ 'name::blackstone': 'Blackstone Credit' }]).length), [1, 1], 'a row mapped to two companies answers to both');
eq(strategicMatches(rows, 'Blackstone', {}, {}, [{ 'name::blackstone': { company: 'x' } }, undefined]).length, 1, 'a malformed column mapping is ignored');
eq(strategicMatches(rows, 'Hines'), [{ name: 'Hines', owners: ['Pat Kim', 'Lee Park', 'Ana Ruiz'], types: [], mapped: false }], 'duplicate rows merge owners across every owner column');
eq(strategicMatches(rows, 'Prologis'), [{ name: 'Prologis', owners: [], types: [], mapped: false }], 'a row with no owner still matches');
eq(strategicMatches([], 'Hines'), [], 'empty list');
eq(strategicNameKey([{ 'Owner Name': 'x', 'Company': 'y' }]), 'Company', 'an owner column is never the name column');

// My Accounts > Strategic Accounts: Tier 2 accounts, plus the CDM's own
// companies that the list names. A Tier 1 account is here only when the list names it.
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
    ['Blackstone', 'Tier 1', 'Strategic Accounts list', 'Jane Doe + John Roe'],
    ['Brookfield', '', 'Strategic Accounts list', 'Sam Lee'],
    ['Hines', 'Tier 3', 'Strategic Accounts list', 'Pat Kim + Lee Park + Ana Ruiz'],
    ['Zeta', 'Tier 2', 'Tier 2', ''],
  ], 'Tier 2 and my listed companies (a listed Tier 1 included), not another CDM\'s listed company or my unlisted Tier 3');
  eq(got.find(r => r.company === 'Brookfield').listNames, ['Brookfield Asset Management'], 'the list row behind a mapped company is named');
  eq(strategicAccountRows({ accounts, prospects, lookup: strategicLookup([]), isCdm: () => true }).map(r => r.company), ['Zeta'], 'no list uploaded leaves Tier 2, so an unlisted Tier 1 is off');
}

// The list's Type column: Global Strategic Account or NAM Strategic Account.
// The company popup names the Type; My Accounts > Strategic Accounts leaves
// the NAM rows out before matching.
{
  const typed = [
    { 'Account Name': 'Brookfield', 'Account Owner': 'Sam Lee', Type: 'Global Strategic Account' },
    { 'Account Name': 'Hines', 'Account Owner': 'Pat Kim', Type: 'NAM Strategic Account' },
    { 'Account Name': 'Zeta', 'Account Owner': 'Ana Ruiz', Type: 'NAM Strategic Account' },
    { 'Account Name': 'Zeta', 'Account Owner': 'Bo Chen', Type: 'Global Strategic Account' },
    { 'Account Name': 'Acme', 'Account Owner': 'Cy Dunn', Type: '' },
  ];
  eq(strategicTypeKey(typed), 'Type', 'the Type column is found');
  eq(strategicTypeKey([{ 'Account Name': 'x', 'Owner Type': 'y', 'Account Type': 'z' }]), 'Account Type', 'an owner column is never the Type column');
  eq(strategicTypeKey(rows), '', 'a list with no Type column has none');
  eq(['NAM Strategic Account', 'nam', 'North America Strategic', 'Global Strategic Account', 'Dynamic', ''].map(isNamStrategicType), [true, true, true, false, false, false], 'NAM is read as a word, not as letters inside another');
  eq(strategicMatches(typed, 'Hines'), [{ name: 'Hines', owners: ['Pat Kim'], types: ['NAM Strategic Account'], mapped: false }], 'a match carries its Type');
  eq(strategicTypes(strategicMatches(typed, 'Zeta')), ['NAM Strategic Account', 'Global Strategic Account'], 'a company listed both ways has both Types');
  eq(strategicTypes(strategicMatches(typed, 'Acme')), [], 'a blank Type gives none');
  eq(withoutNamStrategicRows(typed).map(r => r['Account Name']), ['Brookfield', 'Zeta', 'Acme'], 'NAM rows are dropped, blank and Global kept');
  eq(withoutNamStrategicRows(rows).length, rows.length, 'a list with no Type column is left whole');

  // The subtab: Hines (Tier 3, NAM only) is off; Meridian (Tier 2, NAM only)
  // stays as a Tier 2 account but not as a listed one; Zeta is still listed
  // through its Global row, with only that row's owner.
  const prospects = [
    { id: 'a', company: 'Brookfield', cdm: 'Dan', tier: 'Tier 1' },
    { id: 'b', company: 'Hines', cdm: 'Dan', tier: 'Tier 3' },
    { id: 'c', company: 'Zeta', cdm: 'Dan', tier: 'Tier 3' },
    { id: 'd', company: 'Meridian', cdm: 'Dan', tier: 'Tier 2' },
  ];
  const accounts = prospects.map(p => ({ ...p, myTier: p.tier, tierLabel: p.tier }));
  const list = [...typed, { 'Account Name': 'Meridian', 'Account Owner': 'Di Park', Type: 'NAM Strategic Account' }];
  const got = strategicAccountRows({ accounts, prospects, lookup: strategicLookup(withoutNamStrategicRows(list)), isCdm: c => c === 'Dan' });
  eq(got.map(r => [r.company, r.reasons.join(' + '), r.owners.join(' + ')]), [
    ['Brookfield', 'Strategic Accounts list', 'Sam Lee'],
    ['Meridian', 'Tier 2', ''],
    ['Zeta', 'Strategic Accounts list', 'Bo Chen'],
  ], 'NAM Strategic Accounts do not count as listed on the subtab');
}

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }

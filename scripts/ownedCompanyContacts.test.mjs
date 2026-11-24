// The collapsed "contacts at owned companies" table on the company card:
// which people it lists and which owned company it puts them under. Run:
//   node scripts/ownedCompanyContacts.test.mjs
import { ownedCompanyList, ownedCompanyContacts, ownedCompanyFor, recordOwnedCompanies } from '../src/utils/ownedCompanyContacts.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// ── The owned list ────────────────────────────────────────────────────
eq(
  ownedCompanyList([
    { name: 'Brookfield Asset Management', kind: 'division' },
    { name: 'brookfield asset management', kind: 'holding' },
    { name: 'Brookfield', kind: 'holding' },
    { name: '  ', kind: 'holding' },
    { name: 'Oaktree Capital', kind: 'holding' },
  ], 'Brookfield'),
  [{ name: 'Brookfield Asset Management', kind: 'division' }, { name: 'Oaktree Capital', kind: 'holding' }],
  'dedupes by name (division wins), drops blanks and the company itself',
);

// ── The contacts ──────────────────────────────────────────────────────
const owned = [
  { name: 'Brookfield Asset Management', kind: 'division' },
  { name: 'Brookfield (Self Storage)', kind: 'division' },
  { name: 'Oaktree Capital', kind: 'holding' },
];
const contacts = [
  { id: '1', company: 'Brookfield Asset Management' },
  { id: '2', company: 'Oaktree Capital LLC' },
  { id: '3', company: 'Brookfield' },
  { id: '4', company: 'Brookfield (Self Storage)' },
  { id: '5', company: 'Acme' },
  { id: '6', company: 'Oaktree Capital', hidden: true },
  { id: '7', company: 'Someone Else Inc' },
  { id: '8', company: 'Oaktree Capital' },
];
const run = (opts) => ownedCompanyContacts(contacts, owned, {
  isHidden: (c) => !!c.hidden,
  links: { 'oaktree capital': ['7'] },
  exclusions: { 'oaktree capital': ['8'] },
  ...opts,
}).map(r => [r.contact.id, r.company, r.kind]);

eq(run(), [
  ['1', 'Brookfield Asset Management', 'division'],
  ['2', 'Oaktree Capital', 'holding'],
  ['4', 'Brookfield (Self Storage)', 'division'],
  ['7', 'Oaktree Capital', 'holding'],
], 'fuzzy name, division bracket, and hand links; hidden and removed left out');

eq(run({ skipIds: new Set(['1', '7']) }).map(r => r[0]), ['2', '4'],
  'contacts already on the roster are not listed twice');

eq(run({ showHidden: true }).map(r => r[0]), ['1', '2', '4', '6', '7', '8'],
  'Show hidden brings back hide-tagged and removed contacts');

eq(ownedCompanyContacts(contacts, []), [], 'no owned companies, no rows');

// ── Roster contacts who work at an owned company ──────────────────────
{
  const owned = [
    { name: 'Brookfield (Self Storage)', kind: 'division' },
    { name: 'Westinghouse', kind: 'holding' },
    { name: 'Brookfield Asset Management Ltd', kind: 'holding' },
  ];
  const opts = { self: 'Brookfield Asset Management', ownNames: ['BAM'], links: { westinghouse: ['5', '7'], 'brookfield asset management': ['6', '7'] } };
  const at = (company, id = 'x') => ownedCompanyFor({ id, company }, owned, opts)?.name || null;
  eq(at('Westinghouse Inc'), 'Westinghouse', 'Company names a holding: moves');
  eq(at('Brookfield (Self Storage)'), 'Brookfield (Self Storage)', 'Company carries a division bracket: moves');
  eq(at('Brookfield Asset Management'), null, 'exactly the company itself: stays');
  eq(at('BAM'), null, 'one of its aliases: stays');
  eq(at('Brookfield Asset Management Inc'), null, 'fuzzy match to both the company and a holding: stays');
  eq(at('Brookfield Asset Management', '5'), 'Westinghouse', 'linked by hand to a holding: moves');
  eq(at('Westinghouse Inc', '6'), null, 'linked by hand to the company itself, Company only fuzzy names a holding: stays');
  eq(at('Westinghouse', '6'), 'Westinghouse', 'linked by hand to the company itself, Company is exactly a holding: moves');
  eq(at('Brookfield (Self Storage)', '6'), 'Brookfield (Self Storage)', 'linked by hand to the parent, Company pinned to its division: moves');
  eq(at('Brookfield Asset Management', '7'), 'Westinghouse', 'linked to both: the holding wins');
  eq(at(''), null, 'no Company text: stays');
}

// ── What a record owns, for screens with no card open (Account MRI) ──
{
  const record = { id: 'bam', company: 'Brookfield Asset Management',
    portfolioCompanies: [{ companyName: 'Westinghouse' }, { companyName: 'Old name', linkedProspectId: 'oak' }] };
  const settings = { divisionsMap: { bam: [{ id: 'ss', company: 'Brookfield (Self Storage)' }], ss: [{ id: 'text:ssw', company: 'Self Storage West' }] } };
  const prospects = [record, { id: 'ss', company: 'Brookfield (Self Storage)' }, { id: 'oak', company: 'Oaktree Capital' }];
  eq(recordOwnedCompanies(record, settings, prospects).map(o => `${o.kind}:${o.name}`),
    ['division:Brookfield (Self Storage)', 'division:Self Storage West', 'holding:Westinghouse', 'holding:Oaktree Capital'],
    'divisions (sub-divisions too), then holdings, a mapped row by its record\'s name');
  const owned = recordOwnedCompanies(record, settings, prospects);
  eq(ownedCompanyFor({ id: 'w', company: 'Brookfield (Self Storage)' }, owned,
    { self: record.company, links: { 'brookfield asset management': ['w'] } })?.name,
    'Brookfield (Self Storage)', 'a division person linked to the parent is not the parent\'s');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

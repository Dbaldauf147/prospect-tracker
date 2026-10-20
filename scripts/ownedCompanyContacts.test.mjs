// The collapsed "contacts at owned companies" table on the company card:
// which people it lists and which owned company it puts them under. Run:
//   node scripts/ownedCompanyContacts.test.mjs
import { ownedCompanyList, ownedCompanyContacts } from '../src/utils/ownedCompanyContacts.js';

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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

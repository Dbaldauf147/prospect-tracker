// My Accounts > Name Matcher: pasted names to Table companies.
// Plain Node, no test framework. Run:
//   node scripts/pasteCompanyMatch.test.mjs

import assert from 'node:assert/strict';
import { parsePastedNames, makePasteMatcher } from '../src/utils/pasteCompanyMatch.js';

let failed = 0;
function test(name, fn) {
  try { fn(); console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n ', e.message); }
}

const prospects = [
  { id: 1, company: 'Blackstone Inc.', cdm: 'Dan Baldauf', tier: 'Tier 1' },
  { id: 2, company: 'Hines', goesBy: 'Hines Interests', cdm: 'Jane Doe', tier: 'Tier 2' },
  { id: 3, company: 'Brookfield Asset Management', aliases: ['BAM'], cdm: 'Dan Baldauf', tier: 'Tier 3' },
  { id: 4, company: 'Prologis', hubspotCompanyNames: 'Prologis Logistics\nPLD', cdm: '', tier: '' },
];
const match = makePasteMatcher(prospects);

test('a paste splits by line, keeps the first cell, drops blanks and repeats', () => {
  assert.deepEqual(
    parsePastedNames('Blackstone\n\n  Hines \t123\n\tPrologis\nblackstone inc\n"Acme, LLC"\r\n'),
    ['Blackstone', 'Hines', 'Prologis', 'Acme, LLC'],
  );
});

test('an exact name match ignores case and corporate suffixes', () => {
  const r = match('BLACKSTONE');
  assert.equal(r.exact, true);
  assert.equal(r.suggestions[0].prospect.id, 1);
  assert.equal(r.suggestions[0].via, 'exact');
});

test('Goes By, Also Known As and HubSpot names count as exact (alias)', () => {
  assert.equal(match('Hines Interests').suggestions[0].prospect.id, 2);
  assert.equal(match('BAM').suggestions[0].via, 'alias');
  assert.equal(match('PLD').suggestions[0].prospect.id, 4);
});

test('a near name is suggested with a score under 100', () => {
  const r = match('Brookfield Asset Mgmt');
  assert.equal(r.exact, false);
  assert.equal(r.suggestions[0].prospect.id, 3);
  assert.ok(r.suggestions[0].score < 100 && r.suggestions[0].score >= 60);
});

test('an unrelated name gets no suggestion', () => {
  assert.deepEqual(match('Zebra Widgets').suggestions, []);
  assert.deepEqual(match('   ').suggestions, []);
});

if (failed) { console.log(`${failed} failed`); process.exit(1); }

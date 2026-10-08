// Assertion tests for the company popup's Targets list box
// (src/utils/targetAccountMatch.js). Plain Node. Run:
//   node scripts/targetAccountMatch.test.mjs
import {
  targetAccountRows, nameSimilarity, suggestTargetMatches, mappedTargetNames, targetRowFlags,
} from '../src/utils/targetAccountMatch.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const data = { sheetNames: ['S'], sheets: { S: { records: [
  { 'Account Name': 'Vibrantz Technologies', CDM: 'Sam Ouimet', Tier: '2', Industry: 'chemicals & plastics' },
  { 'Account Name': 'Vibrant Energy', CDM: 'Dan Baldauf', Tier: 'Tier 1', Industry: 'Utilities' },
  { 'Account Name': 'Acme Corp', CDM: 'Dan Baldauf', Tier: '', Industry: '' },
  { 'Account Name': 'Vibrantz Technologies', CDM: 'Someone Else', Tier: '3' },
] } } };
const rows = targetAccountRows(data, {});

// rows
check('one row per account, first wins', rows.map(r => r.name), ['Vibrantz Technologies', 'Vibrant Energy', 'Acme Corp']);
check('a row carries CDM, Tier and Vertical', rows[0], { name: 'Vibrantz Technologies', cdm: 'Sam Ouimet', tier: 'Tier 2', vertical: 'chemicals & plastics' });
check('an untiered row is still a row', rows[2].tier, '');

// suggestions
check('Technology vs Technologies is a match', nameSimilarity('Vibrantz Technology', 'Vibrantz Technologies'), 1);
check('a typo in a long word still matches (Techonology)', nameSimilarity('Vibrantz Techonology', 'Vibrantz Technologies'), 1);
check('and the typo case is suggested', suggestTargetMatches('Vibrantz Techonology', rows).map(r => r.name), ['Vibrantz Technologies']);
check('a typo in the first word still matches', nameSimilarity('Vibrantx Technologies', 'Vibrantz Technologies'), 1);
check('short words must match exactly (Acme is not Acne)', nameSimilarity('Acme Corp', 'Acne Corp'), 0);
check('Vibrantz is not Vibrant (one letter, but a different company)', suggestTargetMatches('Vibrantz Technology', rows).some(r => r.name === 'Vibrant Energy'), false);
check('a different first word is no match', nameSimilarity('Acme Technology', 'Vibrantz Technologies'), 0);
check('suffixes are ignored', nameSimilarity('Acme Corp', 'Acme, Inc.'), 1);
check('a short name inside a longer one is a likely match', nameSimilarity('Vibrantz', 'Vibrantz Technologies'), 0.75);
check('the Vibrantz case suggests Vibrantz Technologies, not Vibrant Energy',
  suggestTargetMatches('Vibrantz Technology', rows).map(r => r.name), ['Vibrantz Technologies']);
check('nothing alike, nothing suggested', suggestTargetMatches('Zebra Labs', rows), []);

// mapping
check('mapped names read as a list', mappedTargetNames({ targetMap: { p1: 'Acme Corp' } }, 'p1'), ['Acme Corp']);
check('unmapped is empty', mappedTargetNames({ targetMap: {} }, 'p1'), []);
check('a new company (no id) is never mapped', mappedTargetNames({ targetMap: { undefined: ['x'] } }, undefined), []);

// flags
const opts = ['Chemicals & Plastics', 'Utilities'];
const f = targetRowFlags(rows[0], { cdm: 'Dan Baldauf', tier: 'Tier 3', vertical: '' }, opts);
check('CDM differs: flagged, applies the list', f.cdm, { row: 'Sam Ouimet', card: 'Dan Baldauf', apply: 'Sam Ouimet' });
check('Tier differs: flagged', f.tier, { row: 'Tier 2', card: 'Tier 3', apply: 'Tier 2' });
check('Vertical blank on the card: flagged, in the Dropdowns spelling', f.vertical, { row: 'Chemicals & Plastics', card: '', apply: 'Chemicals & Plastics' });
const ok = targetRowFlags(rows[0], { cdm: 'Sam Ouimet', tier: 'Tier 2', vertical: 'Chemicals & Plastics' }, opts);
check('all agree: no flags', ok, { cdm: null, tier: null, vertical: null });
check('a row with no CDM or vertical flags neither', targetRowFlags({ name: 'Bare', cdm: '', tier: '', vertical: '' }, { cdm: 'X', tier: '', vertical: 'Y' }, opts), { cdm: null, tier: null, vertical: null });
check('no row, no flags', targetRowFlags(null, {}), { cdm: null, tier: null, vertical: null });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

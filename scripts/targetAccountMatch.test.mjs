// Assertion tests for the company popup's Targets list box
// (src/utils/targetAccountMatch.js). Plain Node. Run:
//   node scripts/targetAccountMatch.test.mjs
import {
  targetAccountRows, nameSimilarity, suggestTargetMatches, mappedTargetNames, targetRowFlags, sameWord,
  targetSuggestionsForAccounts, targetAcceptPatch,
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
check('a row carries CDM, Tier and Vertical', rows[0], { name: 'Vibrantz Technologies', cdm: 'Sam Ouimet', tier: 'Tier 2', vertical: 'chemicals & plastics', sheet: 'S' });
check('an untiered row is still a row', rows[2].tier, '');
{
  // Silver Lake: tiered on the PE sheet with no owner, owned on another.
  const two = { sheetNames: ['Owners', 'PE'], sheets: {
    Owners: { records: [{ 'Account Name': 'Silver Lake', CDM: 'Dan Baldauf', Tier: '' }] },
    PE: { records: [{ 'Account Name': 'Silver Lake', CDM: '', Tier: '3', Industry: 'Private Equity' }] },
  } };
  const [r] = targetAccountRows(two, {});
  check('the tiered row keeps the CDM another row has', [r.tier, r.cdm, r.vertical, r.sheet], ['Tier 3', 'Dan Baldauf', 'Private Equity', 'PE']);
  const flipped = { sheetNames: ['PE', 'Owners'], sheets: two.sheets };
  const [f2] = targetAccountRows(flipped, {});
  check('and a later untiered row fills it in too', [f2.tier, f2.cdm], ['Tier 3', 'Dan Baldauf']);
  check('the first row with a CDM still wins it', rows[0].cdm, 'Sam Ouimet');
}

// suggestions
check('Technology vs Technologies is a match', nameSimilarity('Vibrantz Technology', 'Vibrantz Technologies'), 1);
check('a typo in a long word still matches (Techonology)', nameSimilarity('Vibrantz Techonology', 'Vibrantz Technologies'), 1);
check('and the typo case is suggested', suggestTargetMatches('Vibrantz Techonology', rows).map(r => r.name), ['Vibrantz Technologies']);
check('a typo in the first word still matches', nameSimilarity('Vibrantx Technologies', 'Vibrantz Technologies'), 1);
check('short words must match exactly (Acme is not Acne)', nameSimilarity('Acme Corp', 'Acne Corp'), 0);
check('Vibrantz is not Vibrant (one letter, but a different company)', suggestTargetMatches('Vibrantz Technology', rows).some(r => r.name === 'Vibrant Energy'), false);
check('swapped letters in the first word still match (Virbantz)', nameSimilarity('Virbantz Technology', 'Vibrantz Technologies'), 1);
check('and the swapped-letter case is suggested', suggestTargetMatches('Virbantz Technology', rows).map(r => r.name), ['Vibrantz Technologies']);
check('a 5-letter name a letter off is no match (AECOM is not ALCOM)', nameSimilarity('AECOM', 'ALCOM'), 0);
check('nor a 6-letter one', sameWord('anchor', 'anchar'), false);
check('a 7-letter word still forgives one typo', sameWord('pacific', 'pacifik'), true);
check('a swap counts as one edit, so a short word still needs an exact match', sameWord('acme', 'amce'), false);
check('a swap plus another slip in an 8-letter word is too far', sameWord('virbantx', 'vibrantz'), false);
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

// Hubspot Mapping's Targets list helper
{
  const list = [
    { name: 'Vibrantz Technologies', cdm: 'Sam Ouimet', tier: 'Tier 2', vertical: 'Chemicals' },
    { name: 'Acme Corp', cdm: 'Dan Baldauf', tier: '', vertical: '' },
    { name: 'Taken Co', cdm: '', tier: 'Tier 1', vertical: '' },
  ];
  const accts = [
    { id: 'a', company: 'Vibrantz Technology' },
    { id: 'b', company: 'Vibrantz' },
    { id: 'c', company: 'Acme, Inc.' },
    { id: 'd', company: 'Taken Company' },
    { id: 'e', company: 'Acme Corp', targetNames: ['Acme Corp'] },
    { id: 'f', company: 'Acme Corp' },
    { id: 'opps-only:acme corp', company: 'Acme Corp' },
    { id: 'g', company: 'Zebra Labs' },
  ];
  const got = targetSuggestionsForAccounts(accts, list, { targetMap: { x: ['Taken Co'], f: [] } });
  check('the closer name keeps a row two accounts want', got.get('a')?.name, 'Vibrantz Technologies');
  check('the other account gets nothing', got.has('b'), false);
  check('a row another account is mapped to is not suggested', got.has('c') || got.has('d'), false);
  check('an account already matched by name is left out', got.has('e'), false);
  check('an account cleared on purpose is left out', got.has('f'), false);
  check('an Opps-only row is left out', got.has('opps-only:acme corp'), false);
  check('nothing alike, nothing suggested', got.has('g'), false);
  const ign = targetSuggestionsForAccounts([{ id: 'a', company: 'Vibrantz Technology' }], list, { ignoredTargetSuggestions: { a: { 'vibrantz technologies': true } } });
  check('an ignored suggestion is not offered', ign.has('a'), false);

  check('accepting writes the CDM, tier and vertical that differ',
    targetAcceptPatch(list[0], { cdm: 'Dan Baldauf', tier: 'Tier 3', vertical: '' }, { verticalOptions: ['Chemicals'] }),
    { cdm: 'Sam Ouimet', tier: 'Tier 2', vertical: 'Chemicals' });
  check('a row with no tier or vertical leaves those alone',
    targetAcceptPatch(list[1], { cdm: 'Dan Baldauf', tier: 'Tier 1', vertical: 'Office' }), {});
  check('the CDM is spelled as the dropdown spells it',
    targetAcceptPatch(list[0], { cdm: '', tier: 'Tier 2', vertical: 'Chemicals' }, { canonicalCdm: () => 'Samuel Ouimet' }), { cdm: 'Samuel Ouimet' });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

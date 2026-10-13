// The Pricing page's hand-made mappings (Line Item -> Services, Linked To
// defaults and the rest) sync to the user's account through localMirrorSync.
// These are the merge rules used the first time a browser that already held
// some of them meets the cloud copy. Plain Node. Run:
//   node scripts/pricingMirror.test.mjs
//
// Why a merge at all: the mappings were browser-only until this sync, so on
// the day it ships two machines can each hold part of the work. The mirror's
// default for such unstamped data is "adopt it whole and push", which would
// let whichever machine signs in last erase the rows the other one had.
import { readFileSync } from 'node:fs';
import { mergeMirroredMaps } from '../src/utils/localMirrorSync.js';
import { PRICING_MIRRORED_KEYS } from '../src/utils/pricingMirroredKeys.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// The incident: 27 line items mapped on one machine, one on the other.
eq(mergeMirroredMaps(
  { 'invoice - data': ['Utility Bill Pay'], 'invoice collection': ['Utility Bill Pay'] },
  { 'enterprise data - setup inv. based a/c': ['Data Management'] },
), {
  'invoice - data': ['Utility Bill Pay'],
  'invoice collection': ['Utility Bill Pay'],
  'enterprise data - setup inv. based a/c': ['Data Management'],
}, 'rows from both machines survive the first sync');

eq(mergeMirroredMaps({ a: ['Old'] }, { a: ['New'] }), { a: ['New'] },
  'where both have a row, the cloud (stamped) copy wins');
eq(mergeMirroredMaps({ a: ['Kept'] }, { a: [] }), { a: ['Kept'] },
  'an empty cloud row does not blank a mapped local one');
eq(mergeMirroredMaps(['esg', 'audit'], ['audit', 'carbon']), ['audit', 'carbon', 'esg'],
  'lists are unioned');
eq(mergeMirroredMaps({}, { a: true }), { a: true }, 'an empty local map takes the cloud one');

// Hydration at signin only reaches stores it has loaded, so the Pricing keys
// module has to be on its list.
const mirrorSrc = readFileSync(new URL('../src/utils/localMirrorSync.js', import.meta.url), 'utf8');
eq(mirrorSrc.includes("import('./pricingMirroredKeys.js')"), true, 'hydration loads the Pricing keys');
eq(PRICING_MIRRORED_KEYS.includes('lineItemServices'), true, 'the Line Item -> Services mapping is one of them');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

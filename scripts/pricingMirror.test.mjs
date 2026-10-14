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
import { PRICING_MIRRORED_KEYS, mergeFeeStructures, mergeFeeBuilderSaved } from '../src/utils/pricingMirroredKeys.js';

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

// Fee structures: a service both machines have keeps every structure either
// built. The plain map merge took the cloud's service whole and dropped the
// structures only this browser had.
eq(mergeFeeStructures(
  { ubm: { structures: [{ id: 's1', name: 'Standard' }, { id: 's2', name: 'Option 2' }], standardId: 's1' }, audit: { structures: [{ id: 'a1' }], standardId: 'a1' } },
  { ubm: { structures: [{ id: 's1', name: 'Standard (edited)' }, { id: 's3', name: 'Option 3' }], standardId: 's3' }, esg: { structures: [{ id: 'e1' }], standardId: 'e1' } },
), {
  ubm: { structures: [{ id: 's1', name: 'Standard (edited)' }, { id: 's3', name: 'Option 3' }, { id: 's2', name: 'Option 2' }], standardId: 's3' },
  audit: { structures: [{ id: 'a1' }], standardId: 'a1' },
  esg: { structures: [{ id: 'e1' }], standardId: 'e1' },
}, 'fee structures from both machines survive, the cloud copy of a shared one wins');
eq(mergeFeeStructures(
  { ubm: { structures: [{ id: 's2' }], standardId: 's2' } },
  { ubm: { structures: [], standardId: null } },
), { ubm: { structures: [{ id: 's2' }], standardId: 's2' } }, 'an empty cloud service keeps the local standard');

// Fee Builder saved scenarios: every one either side has, the later save winning.
eq(mergeFeeBuilderSaved(
  { 'company:acme': { key: 'company:acme', savedAt: 200, name: 'local' }, 'company:beta': { key: 'company:beta', savedAt: 5 } },
  { 'company:acme': { key: 'company:acme', savedAt: 100, name: 'cloud' }, 'company:gamma': { key: 'company:gamma', savedAt: 7 } },
), {
  'company:acme': { key: 'company:acme', savedAt: 200, name: 'local' },
  'company:beta': { key: 'company:beta', savedAt: 5 },
  'company:gamma': { key: 'company:gamma', savedAt: 7 },
}, 'saved scenarios from both machines survive, the later save of a shared one wins');
eq(PRICING_MIRRORED_KEYS.includes('feeBuilderSaved'), true, 'Fee Builder saved scenarios are synced');

// Hydration at signin only reaches stores it has loaded, so the Pricing keys
// module has to be on its list.
const mirrorSrc = readFileSync(new URL('../src/utils/localMirrorSync.js', import.meta.url), 'utf8');
eq(mirrorSrc.includes("import('./pricingMirroredKeys.js')"), true, 'hydration loads the Pricing keys');
eq(PRICING_MIRRORED_KEYS.includes('lineItemServices'), true, 'the Line Item -> Services mapping is one of them');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

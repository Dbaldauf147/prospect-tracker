// Assertion tests for the contact-category buckets (contactHasTag in
// src/components/ProspectModal/contactTags.js). Run:
//   node scripts/contactBucketTags.test.mjs
//
// Matching ignores case and spacing, so a tag HubSpot spells differently
// from the bucket list still files the contact under that bucket.
import { BUCKETS, contactHasTag, contactIsHidden } from '../src/components/ProspectModal/contactTags.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  if (actual === expected) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${expected}\n  actual   ${actual}`);
}
const cap = BUCKETS.find(b => b.key === 'capitalplanning').tag;
check('no spaces', contactHasTag({ dans_tags: 'Decision Maker;CapitalPlanning' }, cap), true);
check('bucket spelling', contactHasTag({ dans_tags: 'Capital Planning' }, cap), true);
check('odd spacing and case', contactHasTag({ dans_tags: ' capital  PLANNING ' }, cap), true);
check('a different tag does not match', contactHasTag({ dans_tags: 'Capital;Planning' }, cap), false);
check('Efficiency / Renewables is no longer a bucket', BUCKETS.some(b => b.key === 'efficiencyrenewables'), false);
check('other field spelling read too', contactHasTag({ dan_s_tags: 'Climate Risk' }, 'climate risk'), true);
check('hidden still read', contactIsHidden({ dans_tags: 'Hide' }), true);
check('no tags', contactHasTag({}, cap), false);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

// Assertion tests for the contact-category buckets (contactHasTag in
// src/components/ProspectModal/contactTags.js). Run:
//   node scripts/contactBucketTags.test.mjs
//
// HubSpot stores "Efficiency/Renewables" while the bucket list spells it
// "Efficiency / Renewables"; an exact match left those contacts out of the
// Efficiency / Renewables column of the By Category view.
import { BUCKETS, contactHasTag, contactIsHidden } from '../src/components/ProspectModal/contactTags.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  if (actual === expected) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${expected}\n  actual   ${actual}`);
}
const eff = BUCKETS.find(b => b.key === 'efficiencyrenewables').tag;
check('HubSpot spelling, no spaces', contactHasTag({ dans_tags: 'Decision Maker;Efficiency/Renewables' }, eff), true);
check('bucket spelling', contactHasTag({ dans_tags: 'Efficiency / Renewables' }, eff), true);
check('odd spacing and case', contactHasTag({ dans_tags: ' efficiency/ RENEWABLES ' }, eff), true);
check('a different tag does not match', contactHasTag({ dans_tags: 'Efficiency;Renewables' }, eff), false);
check('other field spelling read too', contactHasTag({ dan_s_tags: 'Climate Risk' }, 'climate risk'), true);
check('hidden still read', contactIsHidden({ dans_tags: 'Hide' }), true);
check('no tags', contactHasTag({}, eff), false);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

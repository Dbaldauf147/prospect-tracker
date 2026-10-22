// Assertion tests for the email campaign roster's Tier column.
//   node scripts/campaignTier.test.mjs
import { buildCampaignTierLookup, prospectTier, tierRank } from '../src/utils/campaignTier.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const CDM = 'Dan Baldauf';
const prospects = [
  { company: 'Invitation Homes', tier: 'Tier 1', cdm: 'Someone Else' },
  { company: 'American Homes 4 Rent', tier: 'Tier 2', cdm: 'Dan Baldauf' },
  { company: 'PulteGroup', tier: '', cdm: 'Baldauf, Dan' },
  { company: 'Tricon Residential', tier: '', cdm: 'Someone Else' },
  { company: 'Lennar', tier: 'Tier 3', cdm: 'Dan Baldauf' },
  { company: 'Lennar Corporation', tier: 'Tier 1', cdm: 'Dan Baldauf' },
  { company: 'D.R. Horton', tier: 'Not on tier list', cdm: 'Someone Else', tierOwnTarget: true },
  { company: 'Maymont Homes', tier: '', cdm: 'Dan Baldauf', tierOwnTarget: true },
  { company: 'Blackstone', tier: 'Tier 1', cdm: 'Dan Baldauf', tierOwnTarget: true },
];
const tierFor = buildCampaignTierLookup(prospects, CDM);

check('explicit Tier 1, whoever covers it', tierFor('Invitation Homes'), 'Tier 1');
check('explicit Tier 2', tierFor('American Homes 4 Rent'), 'Tier 2');
check('my CDM account without a tier is Tier 3', tierFor('PulteGroup'), 'Tier 3');
check('someone else’s untiered account has none', tierFor('Tricon Residential'), '');
check('not an account at all', tierFor('FirstKey Homes'), '');
check('matched on the normalized name', tierFor('Invitation Homes, Inc.'), 'Tier 1');
check('case and spacing ignored', tierFor('  americAN homes 4 rent '), 'Tier 2');
check('two accounts on one name keep the higher tier', tierFor('Lennar'), 'Tier 1');
check('own target reads Strategic target, whoever covers it', tierFor('D.R. Horton'), 'Strategic target');
check('own target beats the CDM Tier 3', tierFor('Maymont Homes'), 'Strategic target');
check('a real tier beats own target', tierFor('Blackstone'), 'Tier 1');
check('blank company', tierFor(''), '');
check('no prospects', buildCampaignTierLookup(null, CDM)('Lennar'), '');
check('no CDM name: only explicit tiers', buildCampaignTierLookup(prospects, '')('PulteGroup'), '');
check('prospectTier reads Tier 2', prospectTier({ tier: ' Tier 2 ' }, CDM), 'Tier 2');
check('sort: tiers in order, none last', ['', 'Tier 3', 'Strategic target', 'Tier 1', 'Tier 2'].sort((a, b) => tierRank(a) - tierRank(b)), ['Tier 1', 'Tier 2', 'Strategic target', 'Tier 3', '']);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

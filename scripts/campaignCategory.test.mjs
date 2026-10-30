// Assertion tests for the Saved Campaigns table's Category column
// (src/utils/campaignCategory.js) and its place in the summary CSV.
// Plain Node, no framework. Run:
//   node scripts/campaignCategory.test.mjs
import { campaignCategory, campaignCategoryOptions, normalizeCampaignCategory } from '../src/utils/campaignCategory.js';
import { campaignSummaryRow, CAMPAIGN_SUMMARY_HEADERS } from '../src/utils/campaignExport.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

eq(campaignCategory({ category: '  Events   NYC ' }), 'Events NYC', 'a category is tidied');
eq(campaignCategory({}), '', 'no category reads blank');
eq(campaignCategory(null), '', 'no campaign reads blank');

const campaigns = [{ category: 'Webinars' }, { category: 'events' }, { category: 'Events' }, {}, { category: ' ' }, { category: 'Data Centers' }];
eq(campaignCategoryOptions(campaigns), ['Data Centers', 'events', 'Webinars'], 'options: once each, case-insensitive, A to Z, first spelling kept');

eq(normalizeCampaignCategory('EVENTS', ['events', 'Webinars']), 'events', 'a typed category takes the spelling already in use');
eq(normalizeCampaignCategory('  Market  Update ', ['events']), 'Market Update', 'a new category is tidied');
eq(normalizeCampaignCategory('   ', ['events']), '', 'blank clears it');

eq(CAMPAIGN_SUMMARY_HEADERS[CAMPAIGN_SUMMARY_HEADERS.length - 1], 'Category', 'the CSV gains Category as its last column');
eq(CAMPAIGN_SUMMARY_HEADERS.indexOf('Event Link'), 11, 'the columns before it keep their places');
const row = campaignSummaryRow({ subject: 's', category: 'Webinars' });
eq([row.length, row[row.length - 1]], [CAMPAIGN_SUMMARY_HEADERS.length, 'Webinars'], 'a campaign row carries its category');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

// Assertion tests for the Biggest Deal column on the Prospecting page's
// Prospects and PCs lists. Plain Node, no framework. Run:
//   node scripts/prospectingDeals.test.mjs
//
// The pricing is accountPotential's and is tested there. What matters here
// is that a row reads the company record the way the company card does:
// its own counts price the services, and an answered service never wins.
import { biggestDealFor, dealMid, dealHasStatus } from '../src/utils/prospectingDeals.js';
import { PRICING_BASES } from '../src/utils/servicePricing.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const meta = { serviceType: 'recurring', years: 3 };
const serviceRows = [
  { name: 'Bill payment', bucket: 'DATA', meta },
  { name: 'GHG reporting', bucket: 'GHG Reporting', meta },
];
const pricing = {
  'Bill payment': { basis: 'per_site', rate: 100 },
  'GHG reporting': { basis: 'flat', rate: 5000 },
};
const ctx = { serviceRows, pricing, bases: PRICING_BASES };

{
  const deal = biggestDealFor({ company: 'Big Co', numberOfSites: 200 }, ctx);
  eq([deal?.name, deal?.fee], ['Bill payment', 20000], 'per-site service on a big estate is the biggest deal');
}
{
  const deal = biggestDealFor({ company: 'Small Co', numberOfSites: 10 }, ctx);
  eq(deal?.name, 'GHG reporting', 'on a small estate the flat service wins');
}
{
  const deal = biggestDealFor({ company: 'Sold Co', numberOfSites: 200, servicesExplored: { 'Bill payment': 'Sold' } }, ctx);
  eq(deal?.name, 'GHG reporting', 'a sold service is never the biggest deal');
}
{
  const deal = biggestDealFor({ company: 'Opp Co', numberOfSites: 200 }, { ...ctx, oppStages: new Map([['Bill payment', 'Sold']]) });
  eq(deal?.name, 'GHG reporting', 'a service sold through an opp is ruled out too');
}
{
  const deal = biggestDealFor({ company: 'NS Co', numberOfSites: 200, servicesExplored: { 'Bill payment': 'Not Sold' } }, ctx);
  eq(deal?.name, 'GHG reporting', 'a Not Sold service is never the biggest deal');
}
{
  const deal = biggestDealFor({ company: 'NA Co', numberOfSites: 200, servicesExplored: { 'Bill payment': 'N/A' } }, ctx);
  eq(deal?.name, 'GHG reporting', 'an N/A service is never the biggest deal');
}
{
  const deal = biggestDealFor({ company: 'Q Co', numberOfSites: 200, servicesExplored: { 'Bill payment': 'Quoting' } }, ctx);
  eq([deal?.name, deal?.status, deal?.fromOpp], ['Bill payment', 'Quoting', false], 'the deal carries its service status');
}
{
  const deal = biggestDealFor({ company: 'P Co', numberOfSites: 200 }, { ...ctx, oppStages: new Map([['Bill payment', 'Proposed']]) });
  eq([deal?.status, deal?.fromOpp], ['Proposed', true], 'a status from an opp says so');
}
{
  const deal = biggestDealFor({ company: 'Fresh Co', numberOfSites: 200 }, ctx);
  eq(deal?.status, '', 'an unexplored service has no status');
}
eq(biggestDealFor({ company: 'X' }, { ...ctx, serviceRows: [] }), null, 'no rate card, no deal');
eq(biggestDealFor(null, ctx), null, 'no record, no deal');
eq(dealMid({ fee: 100, feeHigh: 300 }), 200, 'sorts on the middle of the range');
eq(dealMid(null), -1, 'no deal sorts last');

eq(dealHasStatus({ status: 'Quoted' }), true, 'a status hides the row');
eq(dealHasStatus({ status: 'Exploring', fromOpp: true }), true, 'one from an opp too');
eq(dealHasStatus({ status: '' }), false, 'blank is no status');
eq(dealHasStatus({ status: '-' }), false, '"-" (auto) is no status');
eq(dealHasStatus({ status: '  ' }), false, 'whitespace is no status');
eq(dealHasStatus(null), false, 'no deal, nothing to hide');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

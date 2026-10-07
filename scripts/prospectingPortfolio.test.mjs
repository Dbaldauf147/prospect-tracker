// Assertion tests for the Prospecting page's Prospects and PCs lists: which
// companies land on each, and where each Sites / Accounts / Energy figure
// comes from. Plain Node, no framework. Run:
//   node scripts/prospectingPortfolio.test.mjs
import { allPcRows, companyFigures, myProspectRows, sumFigures } from '../src/utils/prospectingPortfolio.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const prospects = [
  { id: 'pe1', company: 'Acme Capital', cdm: 'Dan Baldauf', status: 'Prospect',
    portfolioCompanies: [
      { companyName: 'Alpha Foods, Inc.', siteCount: '40', energyGwh: '12' },
      { companyName: 'Gamma Unknown', siteCount: '3', energyGwh: '0.5' },
    ] },
  { id: 'pe2', company: 'Bravo Partners', cdm: 'Someone Else',
    portfolioCompanies: [{ companyName: 'Gamma Unknown', siteCount: '9' }] },
  { id: 'a', company: 'Alpha Foods', cdm: 'Dan B.', status: 'Qualifying',
    numberOfSites: 38, numberOfAccounts: 76, totalEnergyMwh: 15000, indicativeAnalysisMeta: { savedAt: '2026-01-01' } },
  { id: 'b', company: 'Beta Logistics', cdm: 'Baldauf', annualMwh: 900 },
  { id: 'c', company: 'Other Co', cdm: 'Jane Doe', numberOfSites: 5 },
];
const siteLists = { 'beta-logistics': { rows: [{}, {}, {}] } };

{
  const rows = myProspectRows(prospects, 'Dan Baldauf', siteLists);
  eq(rows.map(r => r.company), ['Acme Capital', 'Alpha Foods', 'Beta Logistics'], 'prospects are the CDM-matched companies, A to Z');
  const beta = rows.find(r => r.company === 'Beta Logistics');
  eq([beta.sites, beta.sitesFrom], [3, 'siteList'], 'site count falls back to the saved site list');
  eq([beta.energyMwh, beta.energyFrom], [900, 'electric'], 'energy falls back to Electric MWh, marked');
  eq(beta.accounts, null, 'no accounts without an analysis');
  const alpha = rows.find(r => r.company === 'Alpha Foods');
  eq([alpha.sites, alpha.accounts, alpha.energyMwh, alpha.sitesFrom], [38, 76, 15000, 'analysis'], 'analysis figures win');
}

{
  const rows = allPcRows(prospects, siteLists);
  eq(rows.map(r => r.company), ['Alpha Foods', 'Gamma Unknown'], 'each PC once, named as the tracker names it');
  const alpha = rows.find(r => r.company === 'Alpha Foods');
  eq([alpha.prospect?.id, alpha.sites, alpha.energyMwh, alpha.status], ['a', 38, 15000, 'Qualifying'], 'tracked PC uses its own record');
  const gamma = rows.find(r => r.company === 'Gamma Unknown');
  eq(gamma.peFirms, ['Acme Capital', 'Bravo Partners'], 'a PC two firms list names both');
  eq([gamma.sites, gamma.sitesFrom, gamma.energyMwh, gamma.energyFrom], [3, 'estimate', 500, 'estimate'], 'untracked PC uses the firm table estimates (GWh to MWh)');
  eq(sumFigures(rows), { sites: 41, accounts: 76, energyMwh: 15500, count: 2 }, 'totals sum what is shown');
}

eq(companyFigures(null, {}).sites, null, 'no record, no figures');

// Old Client, Lost - Not Sold and Hold Off companies are left off both lists.
{
  const closed = [
    { id: 'pe', company: 'Firm', cdm: 'Dan Baldauf', status: 'Client',
      portfolioCompanies: [
        { companyName: 'Live PC' },
        { companyName: 'Tracked Lost PC' },
        { companyName: 'Row Hold PC', status: 'hold off' },
      ] },
    { id: 'o', company: 'Old Co', cdm: 'Dan Baldauf', status: 'Old Client' },
    { id: 'l', company: 'Tracked Lost PC', cdm: 'Dan Baldauf', status: 'Lost - Not Sold' },
    { id: 'h', company: 'Held Co', cdm: 'Dan Baldauf', status: ' Hold Off ' },
    { id: 'q', company: 'Open Co', cdm: 'Dan Baldauf', status: 'Qualifying' },
  ];
  eq(myProspectRows(closed, 'Dan Baldauf', {}).map(r => r.company), ['Firm', 'Open Co'], 'prospects drop closed statuses');
  eq(allPcRows(closed, {}).map(r => r.company), ['Live PC'], 'PCs drop closed statuses, from the record or the firm row');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

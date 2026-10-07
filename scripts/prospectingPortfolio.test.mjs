// Assertion tests for the Prospecting page's Prospects and PCs lists: which
// companies land on each, and where each Sites / Accounts / Energy figure
// comes from. Plain Node, no framework. Run:
//   node scripts/prospectingPortfolio.test.mjs
import { allPcRows, companyFigures, myProspectRows, sumFigures, NO_TYPE, rowTypeLabel, typesOnRows, withoutTypes, typeLabel } from '../src/utils/prospectingPortfolio.js';

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

// Hide types on the Prospects list.
{
  const rs = myProspectRows([
    { id: 1, company: 'Firm', cdm: 'Dan Baldauf', type: 'Private Equity' },
    { id: 2, company: 'Owner', cdm: 'Dan Baldauf', type: ' Owner Operator ' },
    { id: 3, company: 'Blank', cdm: 'Dan Baldauf' },
  ], 'Dan Baldauf', {});
  eq(rs.map(r => r.type), ['', 'Private Equity', 'Owner Operator'], 'prospect rows carry their type, trimmed');
  eq(rowTypeLabel(rs[0]), NO_TYPE, 'no type files under (No type)');
  eq(typesOnRows(rs), ['Owner Operator', 'Private Equity', NO_TYPE], 'types listed A-Z, (No type) last');
  eq(withoutTypes(rs, ['Private Equity']).map(r => r.company), ['Blank', 'Owner'], 'hiding PE drops the firm');
  eq(withoutTypes(rs, [NO_TYPE]).map(r => r.company), ['Firm', 'Owner'], 'and (No type) can be hidden too');
  eq(withoutTypes(rs, []).length, 3, 'nothing hidden, nothing dropped');
}

// "PE Firm" and "Private Equity" are one type.
{
  const rs = myProspectRows([
    { id: 1, company: 'Thoma Bravo', cdm: 'Dan Baldauf', type: 'Private Equity' },
    { id: 2, company: 'Dragoneer', cdm: 'Dan Baldauf', type: 'PE Firm' },
    { id: 3, company: 'Owner', cdm: 'Dan Baldauf', type: 'Owner Operator' },
  ], 'Dan Baldauf', {});
  eq(typesOnRows(rs), ['Owner Operator', 'Private Equity'], 'PE Firm and Private Equity list as one');
  eq(withoutTypes(rs, ['Private Equity']).map(r => r.company), ['Owner'], 'hiding Private Equity hides the PE Firm too');
  eq(withoutTypes(rs, ['PE Firm']).map(r => r.company), ['Owner'], 'a saved "PE Firm" still hides both');
  eq(typeLabel(' pe firm '), 'Private Equity', 'any case and spacing');
  eq(typeLabel('Developer'), 'Developer', 'other types are left as they are');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

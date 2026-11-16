// Issues > "Opp company not in Table View" (utils/oppCompanyMissing).
// Plain Node. Run: node scripts/oppCompanyMissing.test.mjs
import { oppCompaniesMissing, oppCompanyMissingIssues, rankCompanyChoices } from '../src/utils/oppCompanyMissing.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const prospects = [
  { id: 'wsp', company: 'WSP', companyAliases: ['WSP Global'] },
  { id: 'hig', company: 'HIG Capital, LLC' },
  { id: 'bf', company: 'Brookfield (Dubai)' },
];
const opps = [
  { _id: 'a', Account: 'WSP', Stage: 'Sold' },
  { _id: 'b', Account: 'WSP Global Inc.', Stage: 'Quoted' },
  { _id: 'c', Account: 'H.I.G Capital', Stage: 'Lead' },
  { _id: 'd', Account: 'Acme Widgets', Stage: 'Sold' },
  { _id: 'e', Account: 'Acme Widgets, Inc.', Stage: 'Lead' },
  { _id: 'f', Account: 'Zeta Partners', Stage: '' },
  { _id: 'g', Account: '', Stage: 'Lead' },
  { _id: 'h', Account: '-', Stage: 'Lead' },
  { _id: 'i', Account: 'Brookfield (Dubai)', Stage: 'Sold' },
  { _id: 'j', Account: 'Brookfield (Self Storage)', Stage: 'Sold' },
];

const missing = oppCompaniesMissing(opps, prospects);
eq(missing.map(g => g.account), ['Acme Widgets', 'Brookfield (Self Storage)', 'Zeta Partners'],
  'flags only Accounts no company or alias answers to, most opps first');
eq(missing[0].accounts, ['Acme Widgets', 'Acme Widgets, Inc.'], 'spellings of one company make one group');
eq(missing[0].stages, { Sold: 1, Lead: 1 }, 'stages counted');
eq(oppCompaniesMissing(opps, []), [], 'nothing flagged before the roster loads');

const nums = new Map([['d', 4], ['e', 9], ['f', 2]]);
const issues = oppCompanyMissingIssues(opps, prospects, nums);
eq(issues.map(i => i.id), ['opp-company-missing:acmewidgets', 'opp-company-missing:brookfield|self storage', 'opp-company-missing:zetapartners'], 'one row per company, keyed by it');
eq([issues[0].source, issues[0].type, issues[0].company, issues[0].oppNumber], ['Opps', 'Opp company not in Table View', 'Acme Widgets', null], 'row shape');
eq(issues[0].detail.includes('Opp # 4, 9') && issues[0].detail.includes('"Acme Widgets, Inc."'), true, 'detail lists the opp numbers and spellings');
eq(issues[2].oppNumber, 2, 'a single opp carries its Opp #');
eq(issues[2].detail.startsWith('1 opp names "Zeta Partners"') && issues[2].detail.includes('1 No stage'), true, 'singular wording, blank stage');
eq(/—/.test(issues.map(i => i.detail).join('')), false, 'no em dash in what the page shows');


// The Resolve popup's payload: every opp in the group, the spellings.
eq(issues[0].resolve, { kind: 'oppCompany', account: 'Acme Widgets', accounts: ['Acme Widgets', 'Acme Widgets, Inc.'], oppIds: ['d', 'e'] }, 'resolve carries the opps to re-point');

// Ranking Table View names for mapping an Account to one.
const roster = [
  { company: 'Westin Hotels' }, { company: 'Jones Lang LaSalle (JLL)' }, { company: 'Starwood Capital Group' },
  { company: 'Apollo' }, { company: 'Capital One' }, { company: 'Starwood Capital Group' },
];
const sw = rankCompanyChoices('Starwood Capital G...', roster);
eq(sw.best, 'Starwood Capital Group', 'the closest name is suggested');
eq(sw.names.length, 5, 'each name offered once');
eq(sw.names[0], 'Starwood Capital Group', 'and listed first');
eq(rankCompanyChoices('Jones Lang LaSalle, Inc.', roster).best, 'Jones Lang LaSalle (JLL)', 'a longer spelling finds it');
eq(rankCompanyChoices('Capital Partners LLC', roster).best, '', 'sharing only a filler word suggests nothing');
eq(rankCompanyChoices('Nothing Alike', roster).best, '', 'no match, no suggestion');
eq(rankCompanyChoices('Apollo', []).names, [], 'no roster, nothing offered');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

// Assertion tests for the Target Accounts List's "Table View" column and
// its "% mapped" count. Plain Node, no framework. Run:
//   node scripts/targetTableViewMap.test.mjs
//
// The column has to agree with My Accounts about which company is which
// row, or the percentage means nothing:
//
//   * A saved mapping wins over the name match, and a cleared one (empty
//     array) maps to nothing even when the names match exactly.
//   * Without a saved mapping the name matcher still links the obvious
//     cases ("Prologis Inc" to "Prologis").
//   * A mapping to a name that isn't on the list doesn't count.
//   * The percentage counts rows, once each, not companies.
//   * A suggestion carries its match %, and bulk-accepting maps each
//     company once, to its closest row, taking that row's CDM/Tier/Vertical.

import {
  tableViewCompaniesByTarget, tableViewMappingCoverage, bestSuggestionScore,
  matchScoreBucket, planSuggestionAccepts,
} from '../src/utils/targetTableViewMap.js';

let failures = 0;
function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

const targets = ['CBRE', 'Prologis', 'Simon Property Group', 'Acme Holdings'];
const prospects = [
  { id: 'a', company: 'Prologis Inc' },
  { id: 'b', company: 'CBRE Group' },
  { id: 'c', company: 'Simon Property Group' },
  { id: 'd', company: 'Totally Unrelated LLC' },
  { id: 'e', company: 'Acme' },
];

{
  const by = tableViewCompaniesByTarget(prospects, targets, {});
  eq('name match links Prologis Inc to Prologis', by.get('prologis'), [{ id: 'a', company: 'Prologis Inc', auto: true, score: 100 }]);
  eq('exact name links Simon Property Group', by.get('simon property group')?.map(x => x.id), ['c']);
  eq('unrelated company maps nowhere', [...by.values()].flat().some(x => x.id === 'd'), false);
}

{
  const by = tableViewCompaniesByTarget(prospects, targets, { c: [], d: ['CBRE'], e: 'Acme Holdings' });
  eq('cleared mapping maps to nothing', by.get('simon property group'), undefined);
  eq('saved mapping listed ahead of the suggestion', by.get('cbre'), [
    { id: 'd', company: 'Totally Unrelated LLC', auto: false, score: null },
    { id: 'b', company: 'CBRE Group', auto: true, score: 100 },
  ]);
  eq('old single-string mapping still reads', by.get('acme holdings'), [{ id: 'e', company: 'Acme', auto: false, score: null }]);
}

{
  const by = tableViewCompaniesByTarget(prospects, targets, { a: ['Not On The List'] });
  eq('mapping to a name off the list does not count', by.get('prologis'), undefined);
}

{
  // "Acme" cleared, so Acme Holdings is the one row with nobody on it.
  const by = tableViewCompaniesByTarget(prospects, targets, { d: ['CBRE'], e: [] });
  const cov = tableViewMappingCoverage([...targets, 'cbre'], by);
  eq('coverage counts each row once', cov.total, 4);
  eq('coverage mapped', cov.mapped, 3);
  eq('coverage manual', cov.manual, 1);
  eq('coverage pct', cov.pct, 75);
  eq('empty list is 0%', tableViewMappingCoverage([], new Map()).pct, 0);
}

{
  const by = tableViewCompaniesByTarget([{ id: 'x', company: 'Acme' }], ['Acme Holdings Group Partners'], {});
  const score = by.get('acme holdings group partners')?.[0]?.score;
  eq('partial name scores below 100', score > 0 && score < 100, true);
  eq('best score ignores saved mappings', bestSuggestionScore([{ auto: false, score: null }, { auto: true, score: 80 }, { auto: true, score: 60 }]), 80);
  eq('no suggestion has no best score', bestSuggestionScore([{ auto: false, score: null }]), null);
  eq('buckets', ['No suggestion', '100%', '90-99%', '75-89%', '50-74%', 'Under 50%'],
    [null, 100, 95, 80, 50, 10].map(matchScoreBucket));
}

{
  const rowsByName = new Map([
    ['cbre', { name: 'CBRE', cdm: 'Dan Baldauf', tier: 'Tier 1', vertical: 'Real Estate' }],
    ['cbre investment', { name: 'CBRE Investment', cdm: 'Someone Else', tier: 'Tier 3', vertical: '' }],
  ]);
  const prospectsById = new Map([
    ['b', { id: 'b', company: 'CBRE Group', cdm: '', tier: 'Tier 3', vertical: 'Real Estate' }],
    ['s', { id: 's', company: 'Saved Co', cdm: '', tier: '', vertical: '' }],
  ]);
  const plans = planSuggestionAccepts([
    { target: 'CBRE Investment', entry: { id: 'b', company: 'CBRE Group', auto: true, score: 70 } },
    { target: 'CBRE', entry: { id: 'b', company: 'CBRE Group', auto: true, score: 100 } },
    { target: 'CBRE', entry: { id: 's', company: 'Saved Co', auto: true, score: 90 } },
    { target: 'CBRE', entry: { id: 'm', company: 'Manual', auto: false, score: null } },
    { target: 'Not a row', entry: { id: 'z', company: 'Zed', auto: true, score: 100 } },
  ], { prospectsById, rowsByName, targetMap: { s: [] } });
  eq('one plan per company, closest row, saved/manual/unknown skipped', plans.map(p => [p.id, p.target, p.score]), [['b', 'CBRE', 100]]);
  eq('patch takes the row CDM and Tier, leaves a matching Vertical', plans[0].patch, { cdm: 'Dan Baldauf', tier: 'Tier 1' });
}

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nAll passed');

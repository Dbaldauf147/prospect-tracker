// Assertion tests for the Issues page's "Service not in Dropdowns" row: an
// opp whose Scope names a service the Dropdowns tab's services list doesn't
// have. Plain Node, no test framework (the project has none). Run:
//   node scripts/oppScopeOffListIssues.test.mjs
import { oppScopeOffList, remapScopeService, scopeRemapPatches, suggestServiceMatch, rankServiceMatches } from '../src/utils/oppScopeOffList.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const knownServices = ['GHG', 'Budgets', 'Cat 3, 5, 6, and 7 (part of GHG)', 'Old Retired Thing'];
const records = [
  { _id: 'a', Account: 'Acme', Stage: 'Lead', Scope: 'GHG, budgets' },
  { _id: 'b', Account: 'Beta', Stage: 'Sold', Scope: 'GHG, Carbon Thing, Typo Svc' },
  { _id: 'c', Account: 'Gamma', Stage: 'Lead', Scope: 'Cat 3, 5, 6, and 7 (part of GHG), Old Retired Thing' },
  { _id: 'd', Account: 'Delta', Stage: 'Lead', Scope: '-' },
  { _id: 'e', Account: 'Eps', Stage: 'Lead', Scope: '' },
];
{
  const rows = oppScopeOffList(records, knownServices);
  eq(rows.map(r => r.record.Account), ['Beta'], 'only the opp naming unknown services is flagged (case, commas in names, retired, placeholders all fine)');
  eq(rows[0].off, ['Carbon Thing', 'Typo Svc'], 'names every unmatched service');
}
eq(oppScopeOffList([{ Scope: 'Foo, foo' }], knownServices)[0].off, ['Foo'], 'deduped case-insensitively');
eq(oppScopeOffList(records, null).length, 0, 'no list to check against flags nothing');
eq(oppScopeOffList(records, []).length, 0, 'an empty list flags nothing');
eq(oppScopeOffList(records, [...knownServices, 'carbon thing', 'Typo Svc']).length, 0, 'adding the names on Dropdowns clears it');

// ---- Fix popup: mapping an unmatched name onto a listed service ----
eq(remapScopeService('GHG, Typo Svc, Budgets', 'typo svc', 'Carbon', knownServices), 'GHG, Carbon, Budgets', 'remap swaps the name in place, matched case-insensitively');
eq(remapScopeService('GHG, Typo Svc', 'Typo Svc', 'GHG', knownServices), 'GHG', 'remapping onto a service the opp already names drops the duplicate');
eq(remapScopeService('Cat 3, 5, 6, and 7 (part of GHG), Typo Svc', 'Typo Svc', 'Budgets', knownServices), 'Cat 3, 5, 6, and 7 (part of GHG), Budgets', 'a service with commas in its name survives the rewrite');
eq(remapScopeService('GHG, Budgets', 'Typo Svc', 'Carbon', knownServices), 'GHG, Budgets', 'a Scope not naming it is returned untouched');
{
  const recs = [
    { _id: 1, Scope: 'Typo Svc' },
    { _id: 2, Scope: 'GHG, typo svc, Carbon Thing' },
    { _id: 3, Scope: 'GHG' },
  ];
  const remaps = [{ from: 'Typo Svc', to: 'Budgets' }, { from: 'Carbon Thing', to: 'GHG' }];
  eq(scopeRemapPatches(recs, remaps, knownServices), { 1: { Scope: 'Budgets' }, 2: { Scope: 'GHG, Budgets' } }, 'patches every opp naming it, and only those');
  eq(scopeRemapPatches(recs, remaps, knownServices, [2]), { 2: { Scope: 'GHG, Budgets' } }, 'limited to one opp when asked');
  const fixed = recs.map(r => ({ ...r, ...(scopeRemapPatches(recs, remaps, knownServices)[r._id] || {}) }));
  eq(oppScopeOffList(fixed, knownServices).length, 0, 'after the remap nothing is flagged');
}
eq(remapScopeService('Budgets, RA & GHG, Carbon', 'RA & GHG', ['GHG', 'Risk Management'], knownServices), 'Budgets, GHG, Risk Management, Carbon', 'one name can map to several services, in place');
eq(remapScopeService('GHG, RA & GHG', 'ra & ghg', ['GHG', 'Budgets'], knownServices), 'GHG, Budgets', 'several targets skip the ones the opp already names');
eq(scopeRemapPatches([{ _id: 7, Scope: 'RA & GHG' }], [{ from: 'RA & GHG', to: ['GHG', 'Budgets'] }], knownServices), { 7: { Scope: 'GHG, Budgets' } }, 'patches carry every target');
eq(rankServiceMatches('gh', ['Budgets', 'Scope 3 GHG', 'GHG', 'Highlights']), ['GHG', 'Scope 3 GHG', 'Highlights'], 'type-ahead: starts-with, then word start, then anywhere');
eq(rankServiceMatches('', ['A', 'B', 'C'], { exclude: ['b'] }), ['A', 'C'], 'type-ahead with nothing typed lists all but the picked ones');
eq(suggestServiceMatch('Risk managment', ['Risk Management', 'Recap']), 'Risk Management', 'suggests the close spelling');
eq(suggestServiceMatch('becs', ['BECS', 'GHG']), 'BECS', 'suggests a case-only match');
eq(suggestServiceMatch('Cleantech', ['Risk Management', 'GHG']), '', 'no guess for an unrelated name');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

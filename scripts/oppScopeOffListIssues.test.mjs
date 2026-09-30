// Assertion tests for the Issues page's "Service not in Dropdowns" row: an
// opp whose Scope names a service the Dropdowns tab's services list doesn't
// have. Plain Node, no test framework (the project has none). Run:
//   node scripts/oppScopeOffListIssues.test.mjs
import { oppScopeOffList } from '../src/utils/oppScopeOffList.js';

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

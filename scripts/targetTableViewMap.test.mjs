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

import { tableViewCompaniesByTarget, tableViewMappingCoverage } from '../src/utils/targetTableViewMap.js';

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
  eq('name match links Prologis Inc to Prologis', by.get('prologis'), [{ id: 'a', company: 'Prologis Inc', auto: true }]);
  eq('exact name links Simon Property Group', by.get('simon property group')?.map(x => x.id), ['c']);
  eq('unrelated company maps nowhere', [...by.values()].flat().some(x => x.id === 'd'), false);
}

{
  const by = tableViewCompaniesByTarget(prospects, targets, { c: [], d: ['CBRE'], e: 'Acme Holdings' });
  eq('cleared mapping maps to nothing', by.get('simon property group'), undefined);
  eq('saved mapping wins, sorted by name', by.get('cbre'), [
    { id: 'b', company: 'CBRE Group', auto: true },
    { id: 'd', company: 'Totally Unrelated LLC', auto: false },
  ]);
  eq('old single-string mapping still reads', by.get('acme holdings'), [{ id: 'e', company: 'Acme', auto: false }]);
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

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nAll passed');

// Assertion tests for renaming a service from its popup's title. Plain Node,
// no test framework (the project has none). Run:
//   node scripts/serviceRenamePopup.test.mjs
import { renameServiceUpdates, renameTargetTaken, renameServiceFromPopup } from '../src/utils/serviceRename.js';
import { getEffectiveDropdownLists } from '../src/utils/dropdownListsStore.js';
import { SERVICE_RENAME_LOG_KEY } from '../src/utils/serviceNameMerges.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
const solutionsOf = (s) => getEffectiveDropdownLists(s).find(l => l.key === 'solutions').options;

const settings = {
  dropdownLists: { solutions: ['GHG', 'RA + - pull through', 'Budgets'], other: ['x'] },
  customServiceCategories: [{ name: 'RA Modules', items: ['RA + - pull through', 'Boxed Only'] }],
};

{
  const u = renameServiceUpdates(settings, 'ra + - pull through', '  RA pull through ');
  const after = { ...settings, ...u };
  eq(solutionsOf(after), ['Boxed Only', 'Budgets', 'GHG', 'RA pull through'], 'renamed on the list, trimmed; every other service stays');
  eq([...after.customServiceCategories[0].items].sort(), ['Boxed Only', 'RA pull through'], 'keeps its box on the board under the new name');
  eq(solutionsOf(after).includes('RA + - pull through'), false, 'the old name is not served back by the board union');
  eq(after[SERVICE_RENAME_LOG_KEY].map(e => [e.from, e.to]), [['RA + - pull through', 'RA pull through']], 'logged for the rename pass that moves it everywhere else');
  eq(after.dropdownLists.other, ['x'], 'other lists untouched');
}

eq(renameServiceUpdates(settings, 'GHG', 'GHG'), null, 'an unchanged name writes nothing');
eq(renameServiceUpdates(settings, 'GHG', '   '), null, 'a blank name writes nothing');
eq(renameServiceUpdates(settings, 'Not listed', 'Anything'), null, 'an unlisted name has nothing to rename');
eq(SERVICE_RENAME_LOG_KEY in renameServiceUpdates(settings, 'GHG', 'ghg'), false, 'a change of case is not logged');

eq(renameTargetTaken(settings, 'GHG', 'budgets'), 'Budgets', 'another listed service is taken, by its listed spelling');
eq(renameTargetTaken(settings, 'GHG', 'ghg'), null, 'its own name in another case is not');
{
  const u = renameServiceUpdates(settings, 'GHG', 'budgets');
  eq(u.dropdownLists.solutions.filter(o => o.toLowerCase() !== 'boxed only'), ['Budgets', 'RA + - pull through'], 'merging into a listed service lists it once');
}

{
  let written = null;
  const declined = renameServiceFromPopup(settings, (u) => { written = u; }, 'GHG', 'Budgets', () => false);
  eq([declined, written], [null, null], 'declining the merge writes nothing');
  const merged = renameServiceFromPopup(settings, (u) => { written = u; }, 'GHG', 'budgets', () => true);
  eq(merged, 'Budgets', 'a merge reports the listed spelling, so the popup follows it');
  const plain = renameServiceFromPopup(settings, (u) => { written = u; }, 'GHG', 'GHG Inventory', () => { throw new Error('asked'); });
  eq([plain, written.dropdownLists.solutions.includes('GHG Inventory')], ['GHG Inventory', true], 'a free name renames without asking');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

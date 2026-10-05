// Assertion tests for deleting a service from its popup. Plain Node, no test
// framework (the project has none). Run:
//   node scripts/serviceDelete.test.mjs
import { deleteServiceUpdates } from '../src/utils/serviceDelete.js';
import { getEffectiveDropdownLists } from '../src/utils/dropdownListsStore.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
const solutionsOf = (s) => getEffectiveDropdownLists(s).find(l => l.key === 'solutions').options;
const has = (s, n) => solutionsOf(s).some(o => o.toLowerCase() === n.toLowerCase());

const settings = {
  dropdownLists: { solutions: ['GHG', 'Mircogrid', 'Budgets'], other: ['x'] },
  customServiceCategories: [{ name: 'Other services', items: ['Mircogrid', 'Boxed Only'] }],
  hiddenServices: ['Mircogrid', 'GHG'],
};
eq(has(settings, 'Mircogrid'), true, 'setup: on the list');
{
  const u = deleteServiceUpdates(settings, 'mircogrid');
  const after = { ...settings, ...u };
  eq(has(after, 'Mircogrid'), false, 'deleted name is off the served list (board union does not put it back)');
  eq(has(after, 'GHG') && has(after, 'Budgets') && has(after, 'Boxed Only'), true, 'every other service stays');
  eq(after.customServiceCategories[0].items, ['Boxed Only'], 'it leaves its box on the board; the box stays');
  eq(after.hiddenServices, ['GHG'], 'dropped from the hidden list');
  eq(after.dropdownLists.other, ['x'], 'other lists untouched');
}
{
  const u = deleteServiceUpdates(settings, 'Boxed Only');
  const after = { ...settings, ...u };
  eq(has(after, 'Boxed Only'), false, 'a board-only service can be deleted too');
  eq('hiddenServices' in u, false, 'hidden list not rewritten when it did not name it');
}
eq(deleteServiceUpdates(settings, 'Not There'), null, 'a name not on the list is a no-op');
eq(deleteServiceUpdates(settings, '  '), null, 'blank is a no-op');
eq(deleteServiceUpdates({ ...settings, dropdownListsHidden: ['solutions'] }, 'GHG'), null, 'list hidden is a no-op');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

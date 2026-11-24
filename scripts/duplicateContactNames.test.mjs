// Same-name contacts on one roster: which ones the duplicate warning names.
//
// Run: node scripts/duplicateContactNames.test.mjs
const { contactNameKey, duplicateNameGroups, duplicateNameCounts } = await import('../src/utils/duplicateContactNames.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}

const roster = [
  { id: 1, firstname: 'Elizabeth', lastname: 'Randall' },
  { id: 2, firstname: 'elizabeth ', lastname: ' RANDALL' },
  { id: 3, firstname: 'Harjit', lastname: 'Singhkohli' },
  { id: 4, firstname: 'Liz', lastname: 'Randall' },
  { id: 5, firstname: 'John', lastname: '' },
  { id: 6, firstname: 'John', lastname: '' },
  { id: 7, firstname: '', lastname: '' },
  { id: 8, firstname: '', lastname: '' },
];
const groups = duplicateNameGroups(roster);
ok(groups.length === 1, 'one repeated name');
ok(groups[0].name === 'Elizabeth Randall', 'named as the first one is written');
ok(groups[0].contacts.map(c => c.id).join() === '1,2', 'both records, roster order');
ok(!groups.some(g => g.contacts.some(c => c.id === 4)), 'a nickname is not an exact match');
ok(!groups.some(g => g.contacts.some(c => c.id === 5)), 'first name alone does not count');
ok(!groups.some(g => g.contacts.some(c => c.id === 7)), 'blank names do not count');
ok(contactNameKey({ firstname: 'Mary  Ann', lastname: 'Lee' }) === contactNameKey({ firstname: 'mary ann', lastname: 'LEE' }), 'case and spacing ignored');
ok(duplicateNameCounts(roster).get('elizabeth randall') === 2, 'count by name key');
ok(duplicateNameGroups([]).length === 0 && duplicateNameGroups(null).length === 0, 'empty roster');
const three = duplicateNameGroups([
  { firstname: 'A', lastname: 'B' }, { firstname: 'C', lastname: 'D' },
  { firstname: 'C', lastname: 'D' }, { firstname: 'A', lastname: 'B' }, { firstname: 'A', lastname: 'B' },
]);
ok(three.length === 2 && three[0].contacts.length === 3 && three[1].contacts.length === 2, 'several names, any count');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

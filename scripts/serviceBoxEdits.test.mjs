// Assertion tests for adding, renaming, deleting and reordering the boxes of
// the services board. Plain Node, no test framework. Run:
//   node scripts/serviceBoxEdits.test.mjs
import {
  addServiceBox, renameServiceBox, deleteServiceBox, moveServiceBox, UNGROUPED_SERVICES,
} from '../src/utils/serviceCategoriesStore.js';

let failures = 0;
function check(name, cond, detail) {
  if (cond) return;
  failures += 1;
  console.error(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`);
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `expected ${e}\n     got      ${a}`);
}

const board = () => [
  { name: 'DATA', items: ['IDM'] },
  { name: 'Targets', items: ['SBT AV', 'Target setting'] },
  { name: 'Graveyard', items: ['Old'] },
];
const names = r => r.categories.map(c => c.name);

// --- add ---------------------------------------------------------------------
const b = board();
eq('add puts an empty bucket on the end', addServiceBox(b, '  Comms  ').categories.at(-1), { name: 'Comms', items: [] });
eq('add leaves the passed layout alone', b.length, 3);
check('add refuses a blank name', !!addServiceBox(b, '   ').error);
check('add refuses a taken name, whatever the case', !!addServiceBox(b, 'data').error);
check('add refuses the Other services card', !!addServiceBox(b, UNGROUPED_SERVICES.toUpperCase()).error);

// --- rename ------------------------------------------------------------------
const renamed = renameServiceBox(b, 'Targets', 'Target Setting');
eq('rename keeps place and services', renamed.categories[1], { name: 'Target Setting', items: ['SBT AV', 'Target setting'] });
eq('rename to a case change is allowed', renameServiceBox(b, 'DATA', 'Data').categories[0].name, 'Data');
eq('rename to the same name writes nothing', renameServiceBox(b, 'DATA', ' DATA ').categories, null);
check('rename refuses a name another bucket has', !!renameServiceBox(b, 'DATA', 'targets').error);
check('rename refuses an unknown bucket', !!renameServiceBox(b, 'Nope', 'X').error);
check('rename refuses a blank name', !!renameServiceBox(b, 'DATA', '').error);

// --- delete ------------------------------------------------------------------
eq('delete drops only that bucket', names(deleteServiceBox(b, 'Targets')), ['DATA', 'Graveyard']);
check('delete refuses an unknown bucket', !!deleteServiceBox(b, 'Nope').error);

// --- move --------------------------------------------------------------------
eq('move up', names(moveServiceBox(b, 'Targets', -1)), ['Targets', 'DATA', 'Graveyard']);
eq('move down', names(moveServiceBox(b, 'DATA', 1)), ['Targets', 'DATA', 'Graveyard']);
eq('move past the top writes nothing', moveServiceBox(b, 'DATA', -1).categories, null);
eq('move past the bottom writes nothing', moveServiceBox(b, 'Graveyard', 1).categories, null);
eq('move leaves the passed layout alone', b.map(c => c.name), ['DATA', 'Targets', 'Graveyard']);

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('PASS serviceBoxEdits');

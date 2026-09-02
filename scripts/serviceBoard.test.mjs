// Assertion tests for the services board layout — the cards every board
// shows, and the "Other services" catch-all among them. Plain Node — no
// test framework (the project has none). Run:
//   node scripts/serviceBoard.test.mjs
//
// The bug this pins down: a service added on Dropdowns › Services but not
// yet filed into a box appeared in the Dropdowns table (under "Other
// services") and in the Opps Scope picker, but was missing entirely from the
// company card's Services Explored board — the Scope picker built the
// catch-all card and the company card did not. Both now build it here, so
// the two boards cannot show different services again.
//
// The catch-all is a VIEW, not a box. Nothing is stored under it, it is
// absent when every service is filed, and filing a service into or out of it
// goes through moveServiceToBucket rather than being written back as a box.
import {
  buildServiceBoard,
  moveServiceToBucket,
  serviceBucketOf,
  UNGROUPED_SERVICES,
} from '../src/utils/serviceCategoriesStore.js';

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        expected ${e}\n        got      ${a}`}`);
}

const settings = {
  customServiceCategories: [
    { name: 'DATA', items: ['Bill payment', 'IDM'] },
    { name: 'Targets', items: ['SBT AV'] },
  ],
};
const names = (board) => board.map(c => `${c.name}: ${c.items.join(', ')}`);

// --- the catch-all card ---------------------------------------------------
check('an unfiled service gets the catch-all card',
  names(buildServiceBoard(settings, ['Bill payment', 'IDM', 'SBT AV', 'Orphan service'])),
  ['DATA: Bill payment, IDM', 'Targets: SBT AV', 'Other services: Orphan service']);

check('no catch-all card when everything is filed',
  names(buildServiceBoard(settings, ['Bill payment', 'IDM', 'SBT AV'])),
  ['DATA: Bill payment, IDM', 'Targets: SBT AV']);

check('no catch-all card for an empty list',
  names(buildServiceBoard(settings, [])),
  ['DATA: Bill payment, IDM', 'Targets: SBT AV']);

// Filed is matched case- and whitespace-insensitively, the same test
// serviceBucketOf uses — otherwise a service would show twice, once in its
// box and once in the catch-all.
check('a filed service is not repeated in the catch-all',
  names(buildServiceBoard(settings, ['  bill payment  ', 'IDM', 'SBT AV'])),
  ['DATA: Bill payment, IDM', 'Targets: SBT AV']);

check('the catch-all de-duplicates and sorts by display name',
  buildServiceBoard(settings, ['Zeta', 'alpha', 'ZETA', 'Cat 10', 'Cat 9']).at(-1),
  { name: UNGROUPED_SERVICES, items: ['alpha', 'Cat 9', 'Cat 10', 'Zeta'] });

check('blank entries never become a service',
  names(buildServiceBoard(settings, ['Bill payment', '', '   ', null, undefined])),
  ['DATA: Bill payment, IDM', 'Targets: SBT AV']);

// A rename sorts by what is on screen, matching every other board.
check('the catch-all sorts by the renamed label',
  buildServiceBoard({ ...settings, serviceRenames: { Zeta: 'Aardvark' } }, ['Zeta', 'Beta']).at(-1).items,
  ['Zeta', 'Beta']);

// --- the catch-all is not a box -------------------------------------------
// Nothing is stored under it: the board is built from the layout, so the
// layout itself never gains an "Other services" entry.
check('the stored layout is untouched by the catch-all',
  settings.customServiceCategories.map(c => c.name), ['DATA', 'Targets']);

// Filing out of the catch-all into a real box.
const filed = moveServiceToBucket(settings.customServiceCategories, 'Orphan service', 'DATA');
check('filing an unfiled service puts it in the box',
  serviceBucketOf(filed, 'Orphan service'), 'DATA');
check('and it leaves the catch-all',
  names(buildServiceBoard({ customServiceCategories: filed }, ['Bill payment', 'IDM', 'SBT AV', 'Orphan service'])),
  ['DATA: Bill payment, IDM, Orphan service', 'Targets: SBT AV']);

// Filing back out — UNGROUPED_SERVICES means "out of every box", so the
// pseudo-card never becomes a real one.
const unfiled = moveServiceToBucket(filed, 'Orphan service', UNGROUPED_SERVICES);
check('filing to the catch-all removes it from every box',
  serviceBucketOf(unfiled, 'Orphan service'), '');
check('and never creates a box named after the catch-all',
  unfiled.map(c => c.name), ['DATA', 'Targets']);

console.log(failures === 0 ? '\nAll service board tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

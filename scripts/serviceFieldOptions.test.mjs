// Assertion tests for the service popup's dropdown menus (Region, Years,
// SME, …): what each menu offers, and what adding, removing and renaming an
// option writes. Plain Node, no framework. Run:
//   node scripts/serviceFieldOptions.test.mjs
import {
  serviceFieldOptions,
  serviceFieldOptionUpdates,
} from '../src/utils/serviceFieldOptions.js';
import { buildServiceRows } from '../src/utils/serviceRows.js';

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${a}, want ${e})`}`);
}

// Two services from the seed catalog and one with no seed at all.
const base = {
  dropdownLists: { solutions: ['API/ETL', 'Arc performance certs', 'Brand new thing'] },
  serviceOverrides: {
    'Brand new thing': { sme: 'Nicole Popp', region: 'EMEA' },
    'API/ETL': { sme: 'nicole popp' },
  },
};
const rowsOf = (s) => buildServiceRows(s).filter(r => base.dropdownLists.solutions.includes(r.name));
const menu = (s, f) => serviceFieldOptions(s, rowsOf(s))[f];
const apply = (s, u) => ({ ...s, ...(u || {}) });

check('menu is built from what the services carry, case-folded, with counts',
  menu(base, 'sme').map(o => [o.value.toLowerCase(), o.count]), [['nicole popp', 2]]);
check('seed values count too',
  menu(base, 'region').map(o => o.value), ['EMEA', 'NAM']);

// Add
let s = apply(base, serviceFieldOptionUpdates(base, 'add', 'sme', 'Dan B'));
check('added option shows with no users', menu(s, 'sme').find(o => o.value === 'Dan B'), { value: 'Dan B', count: 0 });
check('adding one already added writes nothing', serviceFieldOptionUpdates(s, 'add', 'sme', 'dan b'), null);
{
  const kept = apply(s, serviceFieldOptionUpdates(s, 'add', 'sme', 'Nicole Popp'));
  const moved = { ...kept, serviceOverrides: { 'Brand new thing': { region: 'EMEA' } } };
  check('a remembered value stays after no service uses it',
    menu(moved, 'sme').find(o => o.value === 'Nicole Popp'), { value: 'Nicole Popp', count: 0 });
}
check('blank add writes nothing', serviceFieldOptionUpdates(s, 'add', 'sme', '  '), null);
check('unknown field writes nothing', serviceFieldOptionUpdates(s, 'add', 'notes', 'x'), null);

// Remove
s = apply(s, serviceFieldOptionUpdates(s, 'remove', 'region', 'EMEA'));
check('removed option leaves the menu', menu(s, 'region').map(o => o.value), ['NAM']);
check('but the service keeps its value',
  buildServiceRows(s).find(r => r.name === 'Brand new thing').meta.region, 'EMEA');
s = apply(s, serviceFieldOptionUpdates(s, 'add', 'region', 'emea'));
check('adding it back restores it', menu(s, 'region').map(o => o.value), ['EMEA', 'NAM']);

// Rename
s = apply(s, serviceFieldOptionUpdates(s, 'rename', 'sme', 'Nicole Popp', 'N. Popp'));
check('rename rewrites every service carrying it',
  rowsOf(s).map(r => r.meta.sme), ['N. Popp', '', 'N. Popp']);
check('rename keeps the other fields of the override',
  s.serviceOverrides['Brand new thing'].region, 'EMEA');
check('menu shows the new name only',
  menu(s, 'sme').map(o => o.value), ['Dan B', 'N. Popp']);
s = apply(s, serviceFieldOptionUpdates(s, 'rename', 'sme', 'Dan B', 'Dan Baldauf'));
check('renaming an unused added option renames the list entry',
  menu(s, 'sme').map(o => o.value), ['Dan Baldauf', 'N. Popp']);
check('renaming a seed value overrides the seed',
  rowsOf(apply(s, serviceFieldOptionUpdates(s, 'rename', 'region', 'NAM', 'North America')))
    .map(r => r.meta.region), ['North America', 'North America', 'EMEA']);
check('renaming something nobody has writes nothing',
  serviceFieldOptionUpdates(s, 'rename', 'sme', 'Ghost', 'Other'), null);

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nAll passed');

// Assertion tests for the company popup's Targets tab: the stored rows, the
// five-yearly refresh, and the Target Type list.
// Plain Node, no framework. Run:
//   node scripts/companyTargets.test.mjs
import { normalizeTargets, updateTarget, removeTarget, cleanYear, blankTarget, scopesLabel, refreshDue } from '../src/utils/companyTargets.js';

const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
const types = await import('../src/utils/targetTypeOptions.js');

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}

check('normalize: not an array', normalizeTargets(null), []);
check('normalize: fills blanks, drops junk', normalizeTargets([{ id: 'a', type: 'Net zero', baseYear: 2019 }, null, 'x']), [
  { id: 'a', type: 'Net zero', yearSet: '', baseYear: '2019', targetYear1: '', targetYear2: '', scope1: false, scope2: false, scope3: false },
]);
check('cleanYear: digits only, four max', [cleanYear('20a305'), cleanYear(''), cleanYear(null)], ['2030', '', '']);
const list = [{ id: 'a', type: '' }, { id: 'b', type: 'SBTi' }];
const edited = updateTarget(list, 'a', 'targetYear1', '2030x');
check('update: year cleaned, other row untouched', [edited[0].targetYear1, edited[1].type], ['2030', 'SBTi']);
check('update: scope flag', updateTarget(list, 'b', 'scope3', 1)[1].scope3, true);
check('remove', removeTarget(list, 'a').map(r => r.id), ['b']);
const b = blankTarget();
check('blank: has id and empty fields', [!!b.id, b.type, b.scope1], [true, '', false]);
check('scopesLabel', [scopesLabel({ scope1: true, scope3: true }), scopesLabel({})], ['1, 3', '']);

check('update: year set cleaned', updateTarget(list, 'a', 'yearSet', '2o21')[0].yearSet, '221');
check('blank: has a year set', blankTarget().yearSet, '');

// Refresh: year set + 5, judged against this year.
check('refresh: none without a year set', refreshDue({ yearSet: '' }, 2026), null);
check('refresh: none on a half-typed year', refreshDue({ yearSet: '202' }, 2026), null);
check('refresh: upcoming', refreshDue({ yearSet: '2023' }, 2026), { year: 2028, status: 'upcoming', label: 'Upcoming' });
check('refresh: due this year', refreshDue({ yearSet: '2021' }, 2026), { year: 2026, status: 'due', label: 'Due this year' });
check('refresh: overdue', refreshDue({ yearSet: '2019' }, 2026), { year: 2024, status: 'overdue', label: 'Overdue' });

// Target Type list.
check('types: defaults before anything is saved', types.loadTargetTypeOptions(), types.DEFAULT_TARGET_TYPES);
check('types: adding a new one', [types.addTargetTypeOption(' GRESB target '), types.loadTargetTypeOptions().at(-1)], [true, 'GRESB target']);
check('types: same name in another case is not added', types.addTargetTypeOption('net ZERO'), false);
check('types: blank is not added', types.addTargetTypeOption('   '), false);
check('types: a removed default stays removed', [types.removeTargetTypeOption('Net zero'), types.loadTargetTypeOptions().includes('Net zero')], [true, false]);
check('types: removing what is not there', types.removeTargetTypeOption('Nope'), false);
check('types: dedupe keeps first spelling', types.dedupeTypes(['A', 'a', ' b ', '', 3]), ['A', 'b']);

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nAll company targets tests passed.');

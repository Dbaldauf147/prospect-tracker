// Assertion tests for saved column presets ("Dan's column formatting").
// Plain Node, no test framework (the project has none). Run:
//   node scripts/columnPresets.test.mjs
//
// A preset is a named view: which columns show, and in what order. What's
// worth holding is that applying one shows exactly its columns, that a
// column the table gained since doesn't break it, and that saving under an
// existing name replaces rather than duplicates.
import {
  sanitizePresets, savePreset, deletePreset, applyPreset, presetMatches, MAX_PRESETS,
} from '../src/utils/columnPresets.js';

let failures = 0;
function same(label, actual, expected) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  const ok = a === b;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${a}\n      want: ${b}`}`);
}
const COLS = ['company', 'status', 'sites', 'energy', 'notes'];

// --- sanitizing what was stored ---------------------------------------------

same('garbage reads as no presets', sanitizePresets('nope'), []);
same('entries without a name or id are dropped',
  sanitizePresets([{ id: 'a', name: '' }, { name: 'x' }, null, { id: 'b', name: ' Ok ', cols: ['a', 3] }]),
  [{ id: 'b', name: 'Ok', cols: ['a'], order: [] }]);
same('a duplicate id keeps the first',
  sanitizePresets([{ id: 'a', name: 'One' }, { id: 'a', name: 'Two' }]).map(p => p.name), ['One']);

// --- saving ------------------------------------------------------------------

let list = savePreset([], { name: 'Energy', cols: ['company', 'energy'], order: COLS, now: 1 });
same('saving adds a preset', list.map(p => [p.name, p.cols]), [['Energy', ['company', 'energy']]]);
const firstId = list[0].id;
list = savePreset(list, { name: 'Notes', cols: ['company', 'notes'], order: COLS, now: 2 });
same('a second name adds a second preset', list.map(p => p.name), ['Energy', 'Notes']);
list = savePreset(list, { name: 'energy', cols: ['company', 'sites'], order: COLS, now: 3 });
same('the same name (any case) replaces in place', list.map(p => [p.name, p.cols]), [['energy', ['company', 'sites']], ['Notes', ['company', 'notes']]]);
same('and keeps its id', list[0].id, firstId);
same('a blank name saves nothing', savePreset(list, { name: '  ', cols: [] }), list);
same('cols can be a Set', savePreset([], { name: 'S', cols: new Set(['a']), order: [], now: 4 })[0].cols, ['a']);
let many = [];
for (let i = 0; i < MAX_PRESETS + 5; i++) many = savePreset(many, { name: `P${i}`, cols: [], order: [], now: 100 + i });
same('the list is capped', many.length, MAX_PRESETS);
same('deleting removes by id', deletePreset(list, firstId).map(p => p.name), ['Notes']);

// --- applying ----------------------------------------------------------------

const preset = { id: 'x', name: 'X', cols: ['company', 'energy'], order: ['energy', 'company', 'status', 'sites', 'notes'] };
same('applying hides every column it does not list',
  applyPreset(preset, { columnKeys: COLS }).hidden, ['status', 'sites', 'notes']);
same('and restores its order',
  applyPreset(preset, { columnKeys: COLS }).order, ['energy', 'company', 'status', 'sites', 'notes']);
same('an always-visible column is never hidden',
  applyPreset({ ...preset, cols: ['energy'] }, { columnKeys: COLS, alwaysVisible: ['company'] }).hidden, ['status', 'sites', 'notes']);
same('a column added since the save hides, and slots in after its neighbour',
  applyPreset(preset, { columnKeys: [...COLS.slice(0, 3), 'newCol', ...COLS.slice(3)] }),
  { hidden: ['status', 'sites', 'newCol', 'notes'], order: ['energy', 'company', 'status', 'sites', 'newCol', 'notes'] });
same('a column the table dropped is ignored',
  applyPreset({ ...preset, cols: ['company', 'gone'], order: ['gone', 'company'] }, { columnKeys: ['company', 'status'] }),
  { hidden: ['status'], order: ['company', 'status'] });
same('a preset with no saved order leaves the order alone',
  applyPreset({ ...preset, order: [] }, { columnKeys: COLS }).order, null);

// --- which chip is lit ---------------------------------------------------------

same('matches when exactly its columns show',
  presetMatches(preset, { visibleKeys: new Set(['company', 'energy']), columnKeys: COLS }), true);
same('not when an extra column shows',
  presetMatches(preset, { visibleKeys: ['company', 'energy', 'notes'], columnKeys: COLS }), false);
same('always-visible columns do not count',
  presetMatches({ ...preset, cols: ['energy'] }, { visibleKeys: ['company', 'energy'], columnKeys: COLS, alwaysVisible: ['company'] }), true);

if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log('\nall passing');

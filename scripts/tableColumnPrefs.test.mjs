// Assertion tests for the shared table's column preferences. Plain Node —
// no test framework (the project has none). Run:
//   node scripts/tableColumnPrefs.test.mjs
//
// The behaviour worth holding is what happens when a page ships a NEW
// column: the user's hidden columns stay hidden, the new one shows, and
// nobody's layout resets. That's the whole reason this stores hidden keys
// rather than visible ones.
import {
  resolveHiddenKeys, isColumnVisible, resetToStarred, applyStar, pickLegacyBucket,
  orderColumns, mergeColumnOrder,
} from '../src/utils/tableColumnPrefs.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}
function same(label, actual, expected) {
  check(label, JSON.stringify(actual), JSON.stringify(expected));
}
const sorted = (set) => [...set].sort();
const COLS = ['a', 'b', 'c', 'd'];

// --- hidden keys -----------------------------------------------------------

same('a stored hidden list is used as-is',
  sorted(resolveHiddenKeys({ hidden: ['b'], columnKeys: COLS })), ['b']);
same('no prefs at all hides nothing',
  sorted(resolveHiddenKeys({ columnKeys: COLS })), []);
// The migration: an old visible-key list becomes the complement, so the
// screen the user left is the screen they come back to.
same('an old visible list converts to its complement',
  sorted(resolveHiddenKeys({ legacyVisible: ['a', 'c'], columnKeys: COLS })), ['b', 'd']);
same('an empty old list is not "hide everything"',
  sorted(resolveHiddenKeys({ legacyVisible: [], columnKeys: COLS })), []);
same('a stored hidden list wins over the old one',
  sorted(resolveHiddenKeys({ hidden: [], legacyVisible: ['a'], columnKeys: COLS })), []);

// --- visibility ------------------------------------------------------------

const hidden = new Set(['b']);
const removed = new Set(['c']);
const alwaysVisible = ['a'];
check('a plain column shows', isColumnVisible('d', { hidden, removed, alwaysVisible }), true);
check('a hidden column does not', isColumnVisible('b', { hidden, removed, alwaysVisible }), false);
check('a deleted column does not', isColumnVisible('c', { hidden, removed, alwaysVisible }), false);
check('scaffolding columns ignore both',
  isColumnVisible('a', { hidden: new Set(['a']), removed: new Set(['a']), alwaysVisible }), true);
// The point of the whole model: a column the stored prefs have never seen.
check('a column added by an update shows',
  isColumnVisible('brand-new', { hidden, removed, alwaysVisible }), true);

// --- reset to the starred view --------------------------------------------

const reset = resetToStarred({ columnKeys: COLS, starred: new Set(['a', 'c']), alwaysVisible: [] });
same('reset hides everything unstarred', sorted(reset.hidden), ['b', 'd']);
same('and brings deleted columns back', sorted(reset.removed), []);
const resetNoStars = resetToStarred({ columnKeys: COLS, starred: new Set() });
same('with nothing starred, reset shows everything', sorted(resetNoStars.hidden), []);
same('scaffolding is never hidden by a reset',
  sorted(resetToStarred({ columnKeys: COLS, starred: new Set(['a']), alwaysVisible: ['d'] }).hidden),
  ['b', 'c']);

// --- starring --------------------------------------------------------------

const starred = applyStar({
  key: 'b', star: true,
  starred: new Set(['a']), hidden: new Set(['b']), removed: new Set(['b']),
});
same('starring a column stars it', sorted(starred.starred), ['a', 'b']);
same('and un-hides it', sorted(starred.hidden), []);
same('and un-deletes it', sorted(starred.removed), []);
const unstarred = applyStar({
  key: 'a', star: false,
  starred: new Set(['a', 'b']), hidden: new Set(), removed: new Set(),
});
same('un-starring drops the star', sorted(unstarred.starred), ['b']);
same('and leaves the column on screen', sorted(unstarred.hidden), []);

// --- adopting a stranded bucket -------------------------------------------

const entries = [
  { id: 'deals:a|b', keys: ['a', 'b'] },
  { id: 'deals:a|b|c|zz', keys: ['a', 'b', 'c', 'zz'] },
  { id: 'deals:x|y', keys: ['x', 'y'] },
];
check('the closest-matching old layout wins', pickLegacyBucket(entries, COLS), 'deals:a|b|c|zz');
check('a layout with nothing in common is ignored', pickLegacyBucket([entries[2]], COLS), '');
check('no old layouts, nothing to adopt', pickLegacyBucket([], COLS), '');
check('no current columns, nothing to adopt', pickLegacyBucket(entries, []), '');
// Same overlap, different sizes: the richer layout carries more of the
// user's widths and renames, so it wins the tie.
check('ties go to the bigger layout',
  pickLegacyBucket([{ id: 'small', keys: ['a'] }, { id: 'big', keys: ['a', 'q'] }], COLS), 'big');

// --- column order ----------------------------------------------------------

const cols = (...keys) => keys.map(k => ({ key: k, label: k.toUpperCase() }));
const keysOf = (list) => list.map(c => c.key);

same('no saved order leaves the columns alone',
  keysOf(orderColumns(cols('a', 'b', 'c'), [])), ['a', 'b', 'c']);
same('a saved order leads',
  keysOf(orderColumns(cols('a', 'b', 'c'), ['c', 'a', 'b'])), ['c', 'a', 'b']);
// The case this is all for: the page ships a new column and the arrangement
// has to survive it.
same('a column the order never saw lands at the tail',
  keysOf(orderColumns(cols('a', 'b', 'c', 'brandNew'), ['c', 'a', 'b'])), ['c', 'a', 'b', 'brandNew']);
same('and several keep their own relative order',
  keysOf(orderColumns(cols('a', 'new1', 'b', 'new2'), ['b', 'a'])), ['b', 'a', 'new1', 'new2']);
same('a saved key for a column that is gone is skipped',
  keysOf(orderColumns(cols('a', 'b'), ['b', 'ghost', 'a'])), ['b', 'a']);
same('a duplicated saved key does not duplicate the column',
  keysOf(orderColumns(cols('a', 'b'), ['b', 'b', 'a'])), ['b', 'a']);

// --- merging a drag back into the stored order -----------------------------

same('a drag among shown columns is stored as dragged',
  mergeColumnOrder(['a', 'b', 'c'], ['c', 'a', 'b']), ['c', 'a', 'b']);
// `deleted` isn't in the picker's list, but it sat after `a` and should
// still be there when it's restored.
same('a column the picker did not show keeps its slot',
  mergeColumnOrder(['a', 'deleted', 'b', 'c'], ['c', 'a', 'b']), ['c', 'a', 'deleted', 'b']);
same('one that led the old order still leads',
  mergeColumnOrder(['deleted', 'a', 'b'], ['b', 'a']), ['deleted', 'b', 'a']);
same('two adjacent hidden keys keep their run',
  mergeColumnOrder(['a', 'x', 'y', 'b'], ['b', 'a']), ['b', 'a', 'x', 'y']);
same('no stored order yet just takes the drag',
  mergeColumnOrder([], ['b', 'a']), ['b', 'a']);
same('a junk stored order is ignored', mergeColumnOrder(null, ['b', 'a']), ['b', 'a']);

console.log(failures === 0 ? '\nAll tableColumnPrefs tests passed.' : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);

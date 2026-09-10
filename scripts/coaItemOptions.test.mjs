// Assertion tests for the COA items list — the one the Dropdowns page's COA
// Items tab edits and every opp's Stage 6 table reads. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/coaItemOptions.test.mjs
//
// The list used to be "DEFAULT_COA_ITEMS plus whatever was typed", stored as
// an array of the typed extras. Now it is edited directly, which the old
// shape cannot express: remove "3% esc" on the tab and an array of extras
// says nothing about it, so it would come back on the next read. So the tab
// writes the whole list, `{ items: [...] }`, and reads accept both shapes.
//
// What's guarded here is that pair of shapes — a browser holding the old one
// keeps the list it had, and the first save through either route makes the
// list mean exactly what it says — plus the cleaning every write does, since
// the tab hands over names as they were typed.

import { DEFAULT_COA_ITEMS } from '../src/utils/coaItems.js';

// The store reads localStorage through utils/userLs, so give it one. No uid
// is set in a plain-Node run, which userLs answers with its own anon prefix.
const KEY = 'u:_anon:opps-coa-item-options';
const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

let failures = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { console.log(`PASS  ${name}`); return; }
  failures += 1;
  console.log(`FAIL  ${name}\n      expected ${e}\n      got      ${a}`);
}

// A fresh copy of the module per scenario. The store caches the last list it
// read (the Flags column asks for it per row), and only its own writes clear
// that cache — so a test that plants a stored value has to start from a
// module that has never read one.
let n = 0;
async function freshStore(raw) {
  if (raw === null) delete store[KEY];
  else store[KEY] = raw;
  n += 1;
  return import(`../src/utils/coaItemOptions.js?case=${n}`);
}

// --- a browser that has never had one -------------------------------------

{
  const { loadCoaItemOptions } = await freshStore(null);
  eq('nothing stored: the list ships with 3% esc', loadCoaItemOptions(), DEFAULT_COA_ITEMS);
}

// --- the shape written before the tab existed ------------------------------

{
  const { loadCoaItemOptions } = await freshStore(JSON.stringify(['Payment terms']));
  eq('the old array shape: presets lead, what was typed follows',
    loadCoaItemOptions(), ['3% esc', 'Payment terms']);
}
{
  // Whatever the old shape held, it was extras — a preset spelled into it is
  // the same item, not a second row on every opp.
  const { loadCoaItemOptions } = await freshStore(JSON.stringify(['3% ESC', 'Payment terms']));
  eq('a preset re-typed into the old shape is still one item',
    loadCoaItemOptions(), ['3% esc', 'Payment terms']);
}
{
  const { loadCoaItemOptions } = await freshStore('not json at all');
  eq('unreadable storage falls back to the shipped list',
    loadCoaItemOptions(), DEFAULT_COA_ITEMS);
}

// --- the tab writes the whole list ----------------------------------------

{
  const { saveCoaItemOptions, loadCoaItemOptions } = await freshStore(null);
  saveCoaItemOptions(['Payment terms', '3% esc', 'Non-standard terms']);
  eq('saved in the order it was arranged',
    loadCoaItemOptions(), ['Payment terms', '3% esc', 'Non-standard terms']);
  eq('and stored as the whole list', JSON.parse(store[KEY]),
    { items: ['Payment terms', '3% esc', 'Non-standard terms'] });
}
{
  // The point of the second shape: a default can be removed and stay removed.
  const { saveCoaItemOptions, loadCoaItemOptions } = await freshStore(null);
  saveCoaItemOptions(['Payment terms']);
  eq('a removed preset does not come back', loadCoaItemOptions(), ['Payment terms']);
}
{
  const { saveCoaItemOptions, loadCoaItemOptions } = await freshStore(null);
  saveCoaItemOptions(['  Payment terms  ', 'payment TERMS', '', null, '3% esc']);
  eq('names are cleaned on the way in, first spelling wins',
    loadCoaItemOptions(), ['Payment terms', '3% esc']);
}
{
  // Emptying the list is a decision too — opps then show a table with one
  // blank row (see coaItems.js), not the shipped item again.
  const { saveCoaItemOptions, loadCoaItemOptions } = await freshStore(null);
  saveCoaItemOptions([]);
  eq('an emptied list stays empty', loadCoaItemOptions(), []);
}

// --- typing a name into an opp still adds it ------------------------------

{
  const { addCoaItemOption, loadCoaItemOptions } = await freshStore(null);
  eq('a new name is added', addCoaItemOption(' One-off waiver '), true);
  eq('and lands at the end', loadCoaItemOptions(), ['3% esc', 'One-off waiver']);
  eq('the same name again is a no-op', addCoaItemOption('one-off WAIVER'), false);
  eq('a blank is a no-op', addCoaItemOption('   '), false);
  eq('the list is unchanged', loadCoaItemOptions(), ['3% esc', 'One-off waiver']);
}
{
  // Adding from an opp is a save like any other: it writes the whole list, so
  // the presets it inherited are written down rather than re-derived.
  const { addCoaItemOption } = await freshStore(JSON.stringify(['Payment terms']));
  addCoaItemOption('One-off waiver');
  eq('an add migrates the old shape to the whole list', JSON.parse(store[KEY]),
    { items: ['3% esc', 'Payment terms', 'One-off waiver'] });
}

console.log(failures === 0 ? '\nAll COA item list tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

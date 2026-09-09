// Source-level guard on KeyContactsView's per-row `cells` object. Plain Node —
// no test framework (the project has none). Run:
//   node scripts/contactRowCells.test.mjs
//
// KeyContactsView renders five pages (Key / Active / Client Contacts, Key
// Prospects, Changed Jobs) plus All Contacts, and the ones that differ do so
// through optional props that DEFAULT TO NULL — categorizeContact is the
// obvious one: only All Contacts passes it, and only All Contacts shows the
// Category column.
//
// The catch is that the per-row `cells` object is built EAGERLY: one entry per
// column key for every row, whether or not that column is visible, with the
// visible ones picked out afterwards by `cells[col.key]`. So the Category
// cell's body runs on Key Contacts too — and when it called categorizeContact
// without a guard, every page except All Contacts died on
// "categorizeContact is not a function", taking the whole table down behind
// the error boundary. It shipped that way and stood for six days, because the
// one page anybody renders in a verify harness first is All Contacts, where
// the prop is set.
//
// A render test would need a browser. This reads the source instead: inside
// the cells object, a prop that can be null must never be called bare.
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
function ok(cond, name, detail = '') {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
}

const src = readFileSync(new URL('../src/components/KeyContactsView/KeyContactsView.jsx', import.meta.url), 'utf8');

// --- the props that can be absent ----------------------------------------
// Read off KeyContactsViewInner's own signature rather than hard-coded, so a
// new optional prop is covered the day it is added.
const signature = src.slice(src.indexOf('function KeyContactsViewInner({'), src.indexOf('}) {\n  const lsKey'));
const nullable = [...signature.matchAll(/^\s{2}(\w+) = null,$/gm)].map(m => m[1]);
ok(nullable.includes('categorizeContact'),
  'the props that default to null are read off the component signature',
  `found: ${nullable.join(', ') || '(none)'}`);

// --- the eagerly-built row cells ------------------------------------------
const start = src.indexOf('const cells = {');
ok(start !== -1, 'the per-row cells object is found');
// Ends at the closing brace at its own indentation, the line before the row's
// own `return (`.
const end = src.indexOf('\n                  };\n', start);
ok(end !== -1, 'and so is its end');
const cells = src.slice(start, end);

// Every cell is constructed for every row — that is the premise of this file.
ok(/filteredContacts\.map\(\(c, i\) => \{/.test(src.slice(0, start)),
  'the cells are built once per row, before any visibility check');
ok(/cells\[col\.key\]/.test(src.slice(end)),
  'and the visible ones are picked out of the object afterwards');

for (const prop of nullable) {
  // A call is `prop(` not preceded by a truthiness check of the same name.
  const calls = [...cells.matchAll(new RegExp(`\\b${prop}\\(`, 'g'))];
  const bare = calls.filter(m => !/\?\s*$/.test(cells.slice(Math.max(0, m.index - 40), m.index).replace(new RegExp(`${prop}\\s*$`), '')));
  ok(bare.length === 0,
    `${prop} is never called bare inside the row cells`,
    bare.length ? `${bare.length} unguarded call(s) — the pages that pass no ${prop} would throw` : '');
}

// The guard the fix put in, named so a refactor that drops it fails here
// rather than in a user's browser.
ok(/const cats = \(categorizeContact \? categorizeContact\(c\.raw \|\| c\) : \[\]\) \|\| \[\];/.test(cells),
  'the Category cell falls back to no categories when the page passes none');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

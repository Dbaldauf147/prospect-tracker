// Assertion tests for Account Potential's "N ticked rows below - show
// them" button. Plain Node - no test framework (the project has none).
// Run:
//   node scripts/scopeShowTicked.test.mjs
//
// The button exists because the deal panel and the ticks it is made of
// are a long way apart: the table is in money order, so a ticked service
// worth $1,600 sits below a hundred rows the reader never scrolls to, and
// the scope outlives the visit that built it. The panel then reads as a
// deal the page invented.
//
// Two things have to hold for the button to answer that:
//
//   - the sort it fires has to LAND. Every other sortSignal in the app is
//     a background correction and is refused when the user is sorting by
//     something else; this one is the click itself, so it carries `force`.
//   - the scope column has to put the ticked rows on top in the direction
//     the button asks for, or the sort would land and show the same rows.
import { resolveSortSignal } from '../src/utils/tableSortSignal.js';

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${a}, want ${e})`}`);
}

const button = { key: 'scope', direction: 'asc', force: true, nonce: 1 };

// --- the signal the button fires -----------------------------------------
// The table opens sorted by rank, which is exactly the case the ordinary
// rule refuses. Refusing it here would be a button that does nothing.
check(
  'lands from the money order the table opens in',
  resolveSortSignal({ key: 'rank', direction: 'asc' }, button),
  { key: 'scope', direction: 'asc' },
);
check(
  'lands from a column the user sorted by hand',
  resolveSortSignal({ key: 'name', direction: 'desc' }, button),
  { key: 'scope', direction: 'asc' },
);
// Clicked twice, or clicked after sorting the tick column the other way:
// still the ticked rows on top. A forced signal states its direction, or
// the second click would leave the reader looking at the unticked ones.
check(
  'keeps ticked-first when the tick column is already sorted the other way',
  resolveSortSignal({ key: 'scope', direction: 'desc' }, button),
  { key: 'scope', direction: 'asc' },
);
check(
  'a forced signal still needs a key',
  resolveSortSignal({ key: 'rank', direction: 'asc' }, { direction: 'asc', force: true, nonce: 2 }),
  null,
);

// --- and the rule it is an exception to, unchanged ------------------------
// The background re-ranks (Opps 2's Call In) must still be refused when
// the user is sorting by something else - see oppsCallInRerank.test.mjs
// for the full set. Pinned here too because `force` is the one thing that
// could quietly turn every one of them into an interruption.
check(
  'an unforced signal is still refused from another column',
  resolveSortSignal({ key: 'Account', direction: 'asc' }, { key: 'Call In', direction: 'asc', nonce: 3 }),
  null,
);
check(
  'an unforced signal still keeps the direction the user chose',
  resolveSortSignal({ key: 'Call In', direction: 'desc' }, { key: 'Call In', direction: 'asc', nonce: 4 }),
  { key: 'Call In', direction: 'desc' },
);

// --- the column the signal sorts on --------------------------------------
// The scope column's own sort value, copied from the column definition in
// AccountPotentialTab: ticked rows first when ascending, which is the
// direction the button asks for, and the money order kept inside each
// half so the page's other answer survives the trip.
const UNRANKED = 1e6;
const scopeSortValue = (row) => (row._scoped ? 0 : 2 * UNRANKED)
  + (row._rank ?? row._leadRank ?? UNRANKED);
const rows = [
  { name: 'Capital asset planning', _scoped: false, _rank: 1 },
  { name: 'Invoice variance testing', _scoped: true, _rank: 57 },
  { name: 'GRESB fully managed', _scoped: false, _rank: 2 },
  // Nothing on the rate card, so no rank at all: still last of the
  // unticked rather than first.
  { name: 'API/ETL', _scoped: false, _rank: null },
  { name: 'RA dashboards & reporting', _scoped: true, _rank: 41 },
  // Sold with the ticked reporting service, so it rides on its lead's
  // rank and stays beside the row carrying its money.
  { name: 'RA AV report', _scoped: true, _rank: null, _leadRank: 41 },
];
const sorted = [...rows].sort((a, b) => scopeSortValue(a) - scopeSortValue(b));
check(
  'ascending puts the ticked rows on top, in money order',
  sorted.map(r => r.name),
  [
    'RA dashboards & reporting', 'RA AV report', 'Invoice variance testing',
    'Capital asset planning', 'GRESB fully managed', 'API/ETL',
  ],
);

// The count on the button label. Read off the table's rows rather than
// the scope set: a name left in the scope for a service the account has
// since ruled on has no row to show, and counting it would send somebody
// looking for a checkbox that is not on the page.
const scopedCount = rows.filter(r => r._scoped).length;
check('the label counts the rows that are actually there', scopedCount, 3);

console.log(failures === 0 ? '\nAll passed.' : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);

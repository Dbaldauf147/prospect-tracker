// Assertion tests for the savings ownership scope. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/savingsOwnershipScope.test.mjs
//
// Indicative savings are a procurement motion on the supply contract behind
// the meter, and on a leased location that contract is usually the
// landlord's — so the Master Analysis never projects savings onto one.
//
// Two things about the rule matter enough to pin down here:
//
//   * It reads the Utility Lookup row's `__ownership__`, the canonical value
//     the upload normalizes to — not the raw string the file carried.
//   * It drops what is KNOWN to be leased, exactly like the compliance
//     scope. A blank or unplaceable status is a gap in the upload, not
//     evidence the building is somebody else's, so those sites keep their
//     savings. Silently zeroing half a portfolio's savings because half its
//     Ownership column was blank would be the worse failure by far.
import { isLeasedUtilityRow, savingsOwnershipScope } from '../src/components/SitesView/ownershipScope.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

const row = (ownership, raw = null) => ({ __ownership__: ownership, __ownershipRaw__: raw });

// --- the test itself ------------------------------------------------------
check('a leased site is leased', isLeasedUtilityRow(row('Leased')), true);
check('an owned site is not', isLeasedUtilityRow(row('Owned')), false);
check('a blank status is not', isLeasedUtilityRow(row(null)), false);
check('an empty string is not', isLeasedUtilityRow(row('')), false);
// The upload canonicalizes before this runs, so anything else reaching it is
// a value normalizeOwnership couldn't place — it keeps its savings.
check('an unplaceable status is not', isLeasedUtilityRow(row(null, 'Owned/Leased')), false);
check('a non-canonical spelling is not', isLeasedUtilityRow(row('leased')), false);
check('a missing row does not throw', isLeasedUtilityRow(undefined), false);
check('a null row does not throw', isLeasedUtilityRow(null), false);

// --- the counts the export reports ---------------------------------------
const MIXED = [
  row('Owned'),
  row('Leased'),
  row('Leased'),
  row(null),                  // never mapped
  row(null, 'Owned/Leased'),  // mapped, unplaceable
];
const scope = savingsOwnershipScope(MIXED);
check('total', scope.total, 5);
check('leased', scope.leased, 2);
check('what the savings are taken off', scope.scoped, 3);
check('the scope does something', scope.active, true);

// A portfolio that mapped no Ownership column at all: nothing is dropped,
// and the export says so by leaving the leased columns off entirely.
const UNMAPPED = [row(null), row(null), row(null)];
check('an unmapped portfolio keeps every site', savingsOwnershipScope(UNMAPPED).scoped, 3);
check('and reports itself inert', savingsOwnershipScope(UNMAPPED).active, false);

// An all-leased portfolio legitimately projects nothing.
const ALL_LEASED = [row('Leased'), row('Leased')];
check('an all-leased portfolio has nothing to project on', savingsOwnershipScope(ALL_LEASED).scoped, 0);
check('and the scope is active, so the sheet says why', savingsOwnershipScope(ALL_LEASED).active, true);

// --- junk in --------------------------------------------------------------
check('empty list', savingsOwnershipScope([]).total, 0);
check('no argument', savingsOwnershipScope().scoped, 0);
check('null entries do not throw', savingsOwnershipScope([null, row('Leased')]).leased, 1);

console.log(failures === 0 ? '\nAll passed.' : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);

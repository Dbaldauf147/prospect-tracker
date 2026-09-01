// Assertion tests for the Tenure (Owned / Leased) coverage counts behind the
// Utility Lookup page's missing-tenure warning. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/tenureCoverage.test.mjs
//
// The warning exists because the absence of this column is invisible in
// every figure it moves: with nothing marked Leased, the compliance subtabs
// screen the whole list and the Master Analysis projects savings on the full
// deregulated spend — exactly what a portfolio that owns everything outright
// would produce. So the counts have to separate three things a single
// "is it Leased?" test collapses:
//
//   * a canonical Owned / Leased, which scopes,
//   * a value the upload could not place ("Owned/Leased", "TBD"), which is
//     an answer about that site even though it scopes nothing — the page
//     shows it as typed, so it must not be reported as a missing upload,
//   * nothing at all, which is the gap being warned about.
import { tenureCoverage } from '../src/components/SitesView/ownershipScope.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

// A Utility Lookup row: the canonical status the upload normalized to, and
// the raw string it came from when normalizeOwnership could not place it.
const row = (ownership, raw = null) => ({ __ownership__: ownership, __ownershipRaw__: raw });

// --- a fully mapped portfolio ---------------------------------------------
const FULL = [row('Owned'), row('Owned'), row('Leased')];
check('every site counted', tenureCoverage(FULL).total, 3);
check('owned counted', tenureCoverage(FULL).owned, 2);
check('leased counted', tenureCoverage(FULL).leased, 1);
check('nothing missing', tenureCoverage(FULL).missing, 0);
check('all known', tenureCoverage(FULL).known, 3);

// --- the case the warning is for ------------------------------------------
// No Ownership column mapped: every row is blank, and no downstream figure
// says so on its own.
const NONE = [row(null), row(null), row(null)];
check('an unmapped column leaves nothing known', tenureCoverage(NONE).known, 0);
check('and every site missing', tenureCoverage(NONE).missing, 3);
check('and nothing with a value', tenureCoverage(NONE).withValue, 0);
// An empty string is the same silence as null — a mapped column with blank
// cells reads as no answer, not as an answer of "".
check('an empty string is missing too', tenureCoverage([row('', '')]).missing, 1);
check('whitespace is missing too', tenureCoverage([row(null, '   ')]).missing, 1);

// --- partial coverage ------------------------------------------------------
const PARTIAL = [row('Owned'), row('Leased'), row(null), row(null)];
check('partial: known', tenureCoverage(PARTIAL).known, 2);
check('partial: missing', tenureCoverage(PARTIAL).missing, 2);
check('partial: total', tenureCoverage(PARTIAL).total, 4);

// --- a value the upload could not place ------------------------------------
// "Owned/Leased" names both and stays unresolved, but the file did answer
// for that site and the page shows the string as typed. Counting it as a
// missing upload would tell the user to map a column they already mapped.
const UNPLACEABLE = [row(null, 'Owned/Leased'), row(null, 'TBD'), row('Owned')];
check('unplaceable values are counted apart', tenureCoverage(UNPLACEABLE).unplaceable, 2);
check('and are not missing', tenureCoverage(UNPLACEABLE).missing, 0);
check('but they are not known either', tenureCoverage(UNPLACEABLE).known, 1);
check('withValue spans both', tenureCoverage(UNPLACEABLE).withValue, 3);

// --- junk in ---------------------------------------------------------------
check('empty list', tenureCoverage([]).total, 0);
check('empty list has no gap to warn about', tenureCoverage([]).missing, 0);
check('no argument', tenureCoverage().missing, 0);
check('null entries do not throw', tenureCoverage([null, row('Leased')]).leased, 1);
check('and a null entry counts as missing', tenureCoverage([null, row('Leased')]).missing, 1);
check('undefined entries do not throw', tenureCoverage([undefined]).missing, 1);

console.log(failures === 0 ? '\nAll passed.' : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);

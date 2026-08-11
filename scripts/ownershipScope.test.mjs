// Assertion tests for the compliance ownership scope. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/ownershipScope.test.mjs
//
// Building compliance obligations fall on the owner, so the two compliance
// subtabs default to leaving leased buildings out. The rule that matters is
// which way round that filter is stated:
//
//   keep === 'Owned'    — what it used to do
//   drop === 'Leased'   — what it does now
//
// They agree on every site whose status the upload could place, and differ
// on every site whose status is missing or unrecognized. That difference was
// the bug: a portfolio that mapped the Ownership column for half its list had
// the other half silently screened out of its own compliance report, with
// nothing on the page saying a building had been dropped for want of a value
// rather than for being somebody else's.
//
// An unknown status now screens. The cost of being wrong that way is a site
// reviewed unnecessarily; the cost the other way was a site missed.
import {
  ownershipScopeStats,
  ownershipScopeActive,
  scopeSitesByOwnership,
} from '../src/components/SitesView/ownershipScope.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

const site = (name, ownership) => ({ siteName: name, ownership });
const names = (list) => list.map(s => s.siteName).join(',');

const MIXED = [
  site('owned', 'Owned'),
  site('leased', 'Leased'),
  site('blank', ''),
  site('missing', null),
  site('ambiguous', 'Owned/Leased'),   // the upload couldn't place it
  site('tbd', 'TBD'),
];

// --- the counts -----------------------------------------------------------
const stats = ownershipScopeStats(MIXED);
check('total', stats.total, 6);
check('owned', stats.owned, 1);
check('leased', stats.leased, 1);
check('unspecified covers blank, null and unplaceable', stats.unspecified, 4);
check('known is owned + leased only', stats.known, 2);
check('screened is everything not leased', stats.screened, 5);
check('empty list', ownershipScopeStats([]).total, 0);
check('no argument', ownershipScopeStats().screened, 0);

// --- the filter: drop leased, keep everything else ------------------------
check('leased is the only thing dropped',
  names(scopeSitesByOwnership(MIXED, true)), 'owned,blank,missing,ambiguous,tbd');
check('an unknown status is not a blocker',
  scopeSitesByOwnership(MIXED, true).some(s => s.siteName === 'missing'), true);
check('nor is an unplaceable one',
  scopeSitesByOwnership(MIXED, true).some(s => s.siteName === 'ambiguous'), true);
check('the leased site is gone',
  scopeSitesByOwnership(MIXED, true).some(s => s.siteName === 'leased'), false);
check('scope off keeps everything', names(scopeSitesByOwnership(MIXED, false)), names(MIXED));

// The regression this is guarding: a half-mapped portfolio. Under the old
// keep-only-Owned rule this returned 1 of 4; it must now return 3.
const HALF_MAPPED = [site('a', 'Owned'), site('b', 'Leased'), site('c', ''), site('d', null)];
check('a half-mapped list keeps its unmapped sites',
  names(scopeSitesByOwnership(HALF_MAPPED, true)), 'a,c,d');

// A list nobody mapped at all screens whole, rather than emptying out.
const UNMAPPED = [site('a', ''), site('b', null), site('c', undefined)];
check('an unmapped list is untouched', names(scopeSitesByOwnership(UNMAPPED, true)), 'a,b,c');
check('and the scope reports itself inert', ownershipScopeActive(UNMAPPED, true), false);

// --- when the scope does anything at all ---------------------------------
check('active when something is leased', ownershipScopeActive(MIXED, true), true);
check('inert when the toggle is off', ownershipScopeActive(MIXED, false), false);
check('inert when nothing is leased',
  ownershipScopeActive([site('a', 'Owned'), site('b', '')], true), false);
check('inert on an empty list', ownershipScopeActive([], true), false);

// --- an all-leased list ---------------------------------------------------
// Legitimately empties the screening; the subtabs say so rather than
// rendering a blank report.
const ALL_LEASED = [site('a', 'Leased'), site('b', 'Leased')];
check('an all-leased list screens nothing', scopeSitesByOwnership(ALL_LEASED, true).length, 0);
check('and the scope is active, so the message is about leasing',
  ownershipScopeActive(ALL_LEASED, true), true);

// --- case sensitivity -----------------------------------------------------
// The upload normalizes to the canonical spellings before these run, so a
// stray lowercase value is an unplaceable one — and unplaceable screens.
check('a non-canonical spelling screens', names(scopeSitesByOwnership([site('a', 'leased')], true)), 'a');

// --- junk in --------------------------------------------------------------
check('missing list', scopeSitesByOwnership(undefined, true).length, 0);
check('null entries do not throw', scopeSitesByOwnership([null, site('a', 'Leased')], true).length, 1);

console.log(failures === 0 ? '\nAll passed.' : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);

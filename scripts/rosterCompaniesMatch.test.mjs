// Assertion tests for the fuzzy company-name compare behind the roster gates
// and decision-maker coverage. Plain Node - no test framework. Run:
//   node scripts/rosterCompaniesMatch.test.mjs
//
// The compare was split into a key (rosterMatchKey) and a pairwise check
// (rosterKeysMatch) so the contact x account loops build each name's key
// once; that took the sidebar's coverage from seconds to well under one.
// What's worth pinning:
//   - the rule itself, on the spellings it exists for (suffixes, casing,
//     punctuation, one name inside another) and the ones it must refuse;
//   - the split form answers exactly what the one-call form answers, for
//     every pair, so a loop using keys can never disagree with a caller
//     that doesn't;
//   - asking twice gives the same answer (the stripped names are cached).
import { rosterCompaniesMatch, rosterMatchKey, rosterKeysMatch } from '../src/utils/contactRosters.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

// The rule.
check('exact, any casing and spacing', rosterCompaniesMatch(' Acme Realty ', 'ACME REALTY'), true);
check('legal suffix dropped', rosterCompaniesMatch('Acme Realty, Inc.', 'Acme Realty LLC'), true);
check('one name inside the other', rosterCompaniesMatch('Blue Sky Holdings', 'Blue Sky Holdings Group'), true);
check('punctuation ignored', rosterCompaniesMatch('A&B Partners', 'AB Partners'), true);
check('different companies', rosterCompaniesMatch('Acme Realty', 'Zenith Capital'), false);
check('blank never matches', rosterCompaniesMatch('', 'Acme'), false);
check('blank never matches blank', rosterCompaniesMatch(null, undefined), false);
check('suffix-only name strips to nothing', rosterCompaniesMatch('Inc.', 'LLC'), false);
check('Corp and Corporation are one suffix', rosterCompaniesMatch('Acme Corp', 'Acme Corporation'), true);
check('Company and Limited are suffixes too', rosterCompaniesMatch('Acme Company Limited', 'ACME'), true);
// A short name only matches itself, not any longer name that contains it:
// a "KKR" contact counted as a Key Prospect at "Accel-KKR" before.
check('short name inside a longer one is not a match', rosterCompaniesMatch('KKR', 'Accel-KKR'), false);
check('short name inside a longer one, other way round', rosterCompaniesMatch('KKR Real Estate Finance Trust', 'KKR'), false);
check('short name still matches itself with a suffix', rosterCompaniesMatch('KKR', 'KKR & Co'), true);
check('a word inside a parenthetical is not a match', rosterCompaniesMatch('Stonepeak', 'Akumin (a Stonepeak co.)'), false);
check('stripped containment still works when close in length', rosterCompaniesMatch('Acme Realty, Inc.', 'Acme Realty Group'), true);

// The split form agrees with the one-call form on every pair.
const names = [
  '', ' ', 'Acme', 'acme inc', 'ACME, Inc.', 'Acme Realty', 'Acme Realty LLC', 'Acme Realty Co',
  'Colt', 'Colt Co', 'Co-Op Energy', 'Lp Holdings', 'LP', 'Corp One', 'Inc Realty', 'Ltd. Group',
  'A&B', 'A B', 'North', 'North Star', 'Northstar Capital', 'Blue Sky', 'Blue Sky Holdings (US)',
  'Zenith', 'Zenith!', 'Brookfield', 'Brookfield Properties', 'Brookfield Asset Management Ltd.',
];
let disagreements = 0;
for (const a of names) {
  for (const b of names) {
    if (rosterKeysMatch(rosterMatchKey(a), rosterMatchKey(b)) !== rosterCompaniesMatch(a, b)) disagreements += 1;
  }
}
check('keys agree with the one-call compare on every pair', disagreements, 0);

// Cached answers don't drift.
const first = names.map(a => names.map(b => rosterCompaniesMatch(a, b) ? 1 : 0).join('')).join('|');
const second = names.map(a => names.map(b => rosterCompaniesMatch(a, b) ? 1 : 0).join('')).join('|');
check('asking twice gives the same answers', second, first);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

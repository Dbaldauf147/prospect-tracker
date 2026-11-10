// splitPeOwners keeps firm names that contain a comma in one piece.
//   node scripts/peOwners.test.mjs
import { splitPeOwners, joinPeOwners, registerKnownPeOwnerNames } from '../src/utils/peOwners.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`); }
}

eq(splitPeOwners('Blue Owl Capital, KKR'), ['Blue Owl Capital', 'KKR'], 'plain two owners');
eq(splitPeOwners('Bain Capital, LP'), ['Bain Capital, LP'], 'corp suffix glued');
eq(splitPeOwners('Clayton, Dubilier & Rice (CD&R)'), ['Clayton, Dubilier & Rice (CD&R)'], 'CD&R stays one owner');
eq(splitPeOwners('Clayton, Dubilier & Rice'), ['Clayton, Dubilier & Rice'], 'CD&R plain');
eq(splitPeOwners('KKR, Clayton, Dubilier & Rice (CDR), Apollo'), ['KKR', 'Clayton, Dubilier & Rice (CDR)', 'Apollo'], 'CD&R among others');
eq(splitPeOwners('Clayton, Dubilier & Rices Cousin'), ['Clayton', 'Dubilier & Rices Cousin'], 'prefix needs a word boundary');
eq(splitPeOwners('Welsh, Carson, Anderson & Stowe, KKR'), ['Welsh, Carson, Anderson & Stowe', 'KKR'], 'WCAS');
eq(splitPeOwners('Smith, Jones Partners, Blackstone'), ['Smith', 'Jones Partners', 'Blackstone'], 'unknown before registration');
registerKnownPeOwnerNames(['Smith, Jones Partners']);
eq(splitPeOwners('Smith, Jones Partners, Blackstone'), ['Smith, Jones Partners', 'Blackstone'], 'registered roster name');
const round = joinPeOwners(splitPeOwners('Clayton, Dubilier & Rice (CD&R), KKR'));
eq(splitPeOwners(round), ['Clayton, Dubilier & Rice (CD&R)', 'KKR'], 'join/split round trip');

// A returned array can be changed by its caller without changing the next answer.
const mutated = splitPeOwners('Blue Owl Capital, KKR'); mutated.push('X');
eq(splitPeOwners('Blue Owl Capital, KKR'), ['Blue Owl Capital', 'KKR'], 'cached result is not shared');

// Speed: the app registers every comma company on the roster, and splits
// inside firm x prospect loops at startup. Scanning every known name per
// fragment froze the page for ~18s on load (Nov 10), so 20,000 distinct
// splits against 1,000 registered names must stay well under a second.
registerKnownPeOwnerNames(Array.from({ length: 1000 }, (_, i) => `Perf Co ${i}, Inc`));
const t0 = performance.now();
for (let i = 0; i < 20000; i++) splitPeOwners(`Firm ${i} Capital, Firm ${i + 1} Partners, Perf Co ${i % 1000}, Inc`);
const ms = performance.now() - t0;
eq(ms < 1000, true, `20,000 splits with 1,000 known names in ${ms.toFixed(0)}ms`);
eq(splitPeOwners('Perf Co 7, Inc, KKR'), ['Perf Co 7, Inc', 'KKR'], 'registered bulk name');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

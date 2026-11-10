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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

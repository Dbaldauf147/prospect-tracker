// Assertion tests for flagging PE-owner and Primary Point of Contact
// attendees on the Opportunity form. Plain Node. Run:
//   node scripts/attendeeRoles.test.mjs
import { matchPeOwner, isPrimaryPoc, attendeeRoles } from '../src/utils/attendeeRoles.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`); }
}

eq(matchPeOwner('Strategic Value Partners', 'Strategic Value Partners'), 'Strategic Value Partners', 'exact firm name');
eq(matchPeOwner('Strategic Value Partners, LLC', 'Strategic Value Partners'), 'Strategic Value Partners', 'suffix ignored');
eq(matchPeOwner('KKR', 'Blue Owl Capital, KKR'), 'KKR', 'second of two owners');
eq(matchPeOwner('KKR Infrastructure', 'KKR'), 'KKR', 'leading-word run');
eq(matchPeOwner('OXEA', 'Strategic Value Partners'), '', 'portfolio company is not the owner');
eq(matchPeOwner('Bain', 'Bain Capital, LP'), 'Bain Capital, LP', 'short form of owner');
eq(matchPeOwner('Ba', 'Bain Capital'), '', 'stub does not match');
eq(matchPeOwner('', 'KKR'), '', 'no company');
eq(matchPeOwner('KKR', ''), '', 'no owner');

eq(isPrimaryPoc({ dans_tags: 'Decision Maker;Primary Point of Contact' }), true, 'tag in list');
eq(isPrimaryPoc({ dans_tags: 'primary point of contact' }), true, 'any case');
eq(isPrimaryPoc({ dans_tags: 'Decision Maker' }), false, 'other tags only');
eq(isPrimaryPoc(null), false, 'no contact');

eq(
  attendeeRoles({ match: { company: 'Strategic Value Partners', dans_tags: 'Primary Point of Contact' } }, ['Strategic Value Partners']),
  { peOwner: 'Strategic Value Partners', primaryPoc: true },
  'both roles',
);
eq(attendeeRoles({}, 'KKR'), { peOwner: '', primaryPoc: false }, 'unmatched attendee');

console.log(failed === 0 ? `\nAll ${passed} attendeeRoles tests passed.` : `\n${failed} test(s) failed.`);
process.exit(failed === 0 ? 0 : 1);

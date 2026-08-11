// Assertion tests for the "tag isn't an allowed option" self-heal in
// api/hubspot.js. Plain Node — no test framework (the project has none). Run:
//   node scripts/dansTagsOptionError.test.mjs
//
// Writing a tag HubSpot hasn't registered on the Dan's Tags property 400s.
// The API answers that by adding the option and retrying, which is what lets
// the app carry a tag vocabulary of its own — but only if the failure is
// recognised. The detector used to insist the response name the property,
// and HubSpot's validation body often doesn't: it quotes the rejected VALUE
// and nothing else. Bulk-tagging with a new tag then died on a 400 telling
// the user to add the option by hand.
//
// The body below is the real one from that failure, trimmed only where the
// allowed-options list runs long.
import { isDansTagsOptionError, normalizeDansTagsForHubSpot } from '../api/hubspot.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  if (actual === expected) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${expected}\n        got      ${actual}`); }
}

// What HubSpot actually returned: the value is quoted, the property is not.
const unnamed = JSON.stringify({
  status: 'error',
  message: 'Property values were not valid: [{"isValid":false,"message":"Nam only was not one of the allowed options: '
    + '[Procurement, Hide, Decision Maker, Left, Climate Risk, EU, Efficiency/Renewables, Private Equity, Utilities, '
    + 'Test, Real Estate, Dan Key Target, Primary Point of Contact, ESG]","error":"INVALID_OPTION"}]',
  category: 'VALIDATION_ERROR',
});

// The same failure on a tenant whose body does name the property.
const named = JSON.stringify({
  status: 'error',
  message: 'Property values were not valid: [{"isValid":false,"message":"NAM Only was not one of the allowed options: '
    + '[Procurement, Hide]","error":"INVALID_OPTION","name":"dans_tags"}]',
  category: 'VALIDATION_ERROR',
});

// ---- recognising the failure ------------------------------------------------

eq(isDansTagsOptionError(400, unnamed, 'Nam only'), true,
  'the rejected value alone is enough — this is the case that was failing');
eq(isDansTagsOptionError(400, unnamed, 'Dan Key Target;Nam only'), true,
  'found among several tags in the same write');
eq(isDansTagsOptionError(400, named, 'NAM Only'), true, 'a body naming dans_tags still matches');
eq(isDansTagsOptionError(400, named, ''), true, 'the property name alone is enough, no tags needed');

// ---- and not over-reaching --------------------------------------------------

// An option error about a value we didn't write belongs to some other
// enumeration on the same PATCH: registering our tags wouldn't fix it, so it
// stays a hard error rather than burning a pointless retry.
const otherProp = JSON.stringify({
  status: 'error',
  message: 'Property values were not valid: [{"isValid":false,"message":"Platinum was not one of the allowed options: '
    + '[Gold, Silver]","error":"INVALID_OPTION","name":"tier"}]',
});
eq(isDansTagsOptionError(400, otherProp, 'NAM Only'), false, 'another property\'s option error is not ours');

eq(isDansTagsOptionError(400, 'Contact does not exist', 'NAM Only'), false, 'an unrelated 400 is not an option error');
eq(isDansTagsOptionError(404, unnamed, 'Nam only'), false, 'only a 400 counts');
eq(isDansTagsOptionError(400, '', 'Nam only'), false, 'no body, no match');
eq(isDansTagsOptionError(400, unnamed, ''), false,
  'no tags in the write and no property name: nothing ties this to dans_tags');

// A tag that merely appears somewhere in the body — in the ALLOWED list, say
// — isn't the rejected one, so it mustn't trigger the self-heal on its own.
eq(isDansTagsOptionError(400, unnamed, 'Procurement'), false,
  'a tag listed as allowed is not the rejection');

// ---- the spellings sent to HubSpot ------------------------------------------

// Guardrails on the normalizer the same writes run through, since a tag that
// gets rewritten on the way out is a tag the detector has to match on.
eq(normalizeDansTagsForHubSpot('Efficiency / Renewables'), 'Efficiency/Renewables',
  'the spaced spelling is rewritten to the one HubSpot registered');
eq(normalizeDansTagsForHubSpot('NAM Only'), 'NAM Only', 'a tag with no alias goes out as typed');
eq(normalizeDansTagsForHubSpot('EU;Met In Person;NAM Only'), 'EU;NAM Only',
  'Met In Person is local-only and never written');
eq(normalizeDansTagsForHubSpot('EU; eu ;EU'), 'EU', 'repeats collapse case-insensitively');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

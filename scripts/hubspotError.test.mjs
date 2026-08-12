// Assertion tests for the HubSpot error describer. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/hubspotError.test.mjs
//
// The case that prompted this: a bulk tag apply came back as
//
//   Tagged 0 contacts · 3 failed: Update failed 400: {"status":"error",
//   "message":"Property values were not valid: [{\"isValid\":false,
//   \"message\":\"NAM Only was not one of the allowed options: [Procurement,
//   Hide, Decision Maker, Left, Climate Risk, EU, Efficiency/Renewables,
//   Private Equity, Utilities, Test, Real Estate, Dan Key Target,
//   Primary Point o
//
// — the raw body sliced at 300 characters, which lands in the middle of
// the allowed-options list and cuts off the two fields that say what went
// wrong: the property name and the error code. Worse, the truncation ate
// the `"name":"dans_tags"` the self-heal was keying on, so whether the
// missing tag got registered was invisible.
//
// So the tests below check both halves: that the rejected VALUE is named
// (it's what the user has to act on) and that the property is identified
// even when the body shape puts it somewhere else.
// The detector that decides whether the self-heal runs at all
// (isDansTagsOptionError) has its own tests in dansTagsOptionError.test.mjs;
// this file covers what the user is shown when it still fails.
import { describeHubSpotError, invalidPropertyValues, rejectedOptionValues } from '../api/_lib/hubspotError.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}
function contains(label, haystack, needle) {
  const ok = String(haystack).includes(needle);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got: ${JSON.stringify(haystack)}\n      missing: ${JSON.stringify(needle)}`}`);
}

// The real body, rebuilt: HubSpot serializes the per-property array into
// the top-level `message` as a JSON string.
const ALLOWED = [
  'Procurement', 'Hide', 'Decision Maker', 'Left', 'Climate Risk', 'EU',
  'Efficiency/Renewables', 'Private Equity', 'Utilities', 'Test', 'Real Estate',
  'Dan Key Target', 'Primary Point of Contact', 'NAM', 'Sustainability',
];
const invalidOptionBody = JSON.stringify({
  status: 'error',
  message: 'Property values were not valid: ' + JSON.stringify([{
    isValid: false,
    message: `NAM Only was not one of the allowed options: [${ALLOWED.join(', ')}]`,
    error: 'INVALID_OPTION',
    name: 'dans_tags',
  }]),
  correlationId: '019fec2f-0000-0000-0000-000000000000',
  category: 'VALIDATION_ERROR',
});

// --- the value and property are both recovered ----------------------------
const parsed = invalidPropertyValues(invalidOptionBody);
check('one rejected property', parsed.length, 1);
check('names the rejected value', parsed[0].value, 'NAM Only');
check('names the property', parsed[0].property, 'dans_tags');
check('rejectedOptionValues filters by property', rejectedOptionValues(invalidOptionBody, 'dans_tags').join(','), 'NAM Only');
check('and returns nothing for another property', rejectedOptionValues(invalidOptionBody, 'jobtitle').length, 0);

// --- the sentence the user sees -------------------------------------------
const described = describeHubSpotError(400, invalidOptionBody);
contains('the description names the value', described, '“NAM Only”');
contains('and the property', described, 'dans_tags');
check('and is short enough to read', described.length <= 420, true);
// The old behaviour: the raw envelope, cut mid-list. Guard against a
// regression back to replaying it.
check('it is not the raw envelope', described.startsWith('{"status"'), false);
check('and does not replay the allowed list', described.includes('Efficiency/Renewables'), false);

// --- the shape that omits the property name -------------------------------
// Some bodies come back without `name`. The value still has to surface,
// and rejectedOptionValues has to keep it (the caller knows what it wrote).
const noName = JSON.stringify({
  status: 'error',
  message: 'Property values were not valid: ' + JSON.stringify([{
    isValid: false,
    message: 'NAM Only was not one of the allowed options: [Procurement, Hide]',
    error: 'INVALID_OPTION',
  }]),
});
check('value survives a missing property name', rejectedOptionValues(noName, 'dans_tags').join(','), 'NAM Only');
contains('and is still described', describeHubSpotError(400, noName), '“NAM Only”');

// --- a body already truncated upstream ------------------------------------
// 300 chars of the real body — no closing bracket, no `name`. The
// last-resort scan should still name the value.
const truncated = invalidOptionBody.slice(0, 300);
check('a cut body still yields the value', rejectedOptionValues(truncated, 'dans_tags').join(','), 'NAM Only');

// --- several bad values at once -------------------------------------------
const twoBad = JSON.stringify({
  status: 'error',
  message: 'Property values were not valid: ' + JSON.stringify([
    { isValid: false, message: 'NAM Only was not one of the allowed options: [A, B]', error: 'INVALID_OPTION', name: 'dans_tags' },
    { isValid: false, message: 'Foo Bar was not one of the allowed options: [A, B]', error: 'INVALID_OPTION', name: 'dans_tags' },
  ]),
});
check('both values are reported', rejectedOptionValues(twoBad, 'dans_tags').join(', '), 'NAM Only, Foo Bar');

// --- the shapes that already worked keep working --------------------------
const scopeBody = JSON.stringify({
  status: 'error',
  message: "This app hasn't been granted all required scopes to make this call.",
  correlationId: 'abc',
  category: 'MISSING_SCOPES',
  errors: [{ message: 'One or more of the following scopes are required: crm.objects.contacts.write.' }],
});
contains('scope errors still name the scope', describeHubSpotError(403, scopeBody), 'crm.objects.contacts.write');
contains('and still say where to fix it', describeHubSpotError(403, scopeBody), 'Private Apps');
check('a lone scope is named without alternatives', describeHubSpotError(403, scopeBody).includes('also accepts'), false);

// --- several scopes would satisfy the call ---------------------------------
// The company-rename 403. HubSpot lists the sensitive-data variants first,
// so replaying its order told the user to grant
// crm.objects.companies.highly_sensitive.write.v2 — a scope a private app
// can't hold until the portal is enabled for sensitive data — when
// crm.objects.companies.write is what the call actually wanted.
const companyScopeBody = JSON.stringify({
  status: 'error',
  message: "This app hasn't been granted all required scopes to make this call.",
  correlationId: 'def',
  category: 'MISSING_SCOPES',
  errors: [{
    message: 'One or more of the following scopes are required: '
      + 'crm.objects.companies.highly_sensitive.write.v2, crm.objects.companies.sensitive.write.v2, '
      + 'crm.objects.companies.write, crm.schemas.companies.write.',
  }],
});
const companyDescribed = describeHubSpotError(403, companyScopeBody);
contains('the ordinary object scope is the one recommended', companyDescribed, 'needs the crm.objects.companies.write scope');
contains('the rest are demoted to alternatives', companyDescribed, 'HubSpot also accepts crm.schemas.companies.write, crm.objects.companies.sensitive.write.v2, or crm.objects.companies.highly_sensitive.write.v2');
check('and none of them is what "Add it" points at', /needs the crm\.objects\.companies\.(highly_)?sensitive/.test(companyDescribed), false);
contains('the fix instruction survives in full', companyDescribed, 'Add it in HubSpot under Settings → Integrations → Private Apps → Auth, then save the app.');
check('and the whole thing stays readable', companyDescribed.length <= 420, true);

// A pile of alternatives drops the parenthetical rather than the instruction.
const manyScopes = JSON.stringify({
  status: 'error',
  category: 'MISSING_SCOPES',
  message: "This app hasn't been granted all required scopes to make this call.",
  errors: [{
    message: 'One or more of the following scopes are required: '
      + Array.from({ length: 12 }, (_, i) => `crm.objects.companies.sensitive.write.v${i}`).join(', ')
      + ', crm.objects.companies.write.',
  }],
});
const manyDescribed = describeHubSpotError(403, manyScopes);
contains('a long list still recommends the plain scope', manyDescribed, 'needs the crm.objects.companies.write scope.');
contains('and still says where to fix it', manyDescribed, 'Private Apps → Auth');
check('and stays within budget', manyDescribed.length <= 420, true);

// No scope names at all: the instruction is still the point.
const bareScopeBody = JSON.stringify({
  status: 'error',
  category: 'MISSING_SCOPES',
  message: "This app hasn't been granted all required scopes to make this call.",
});
contains('a nameless scope failure still points somewhere', describeHubSpotError(403, bareScopeBody), 'Private Apps → Auth');

check('a non-JSON body falls back to its text', describeHubSpotError(500, 'Bad Gateway'), 'Bad Gateway');
check('an empty body still says something', describeHubSpotError(502, ''), 'HubSpot returned HTTP 502 with no details');
check('no invalid values in a plain body', invalidPropertyValues('Bad Gateway').length, 0);
check('rejectedOptionValues is empty for junk', rejectedOptionValues('', 'dans_tags').length, 0);

console.log(failures === 0 ? '\nAll passed.' : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);

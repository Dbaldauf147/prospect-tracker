// Links from a contact name to its HubSpot record.
//
// Run: node scripts/hubspotRecordLink.test.mjs
import { hubspotContactUrl } from '../src/utils/hubspotRecordLink.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n  expected ${e}\n  actual   ${a}`); }
}

eq(hubspotContactUrl({ portalId: '244957983', uiDomain: 'app-na2.hubspot.com' }, '12345'),
  'https://app-na2.hubspot.com/contacts/244957983/record/0-1/12345', 'regional domain from HubSpot');
eq(hubspotContactUrl({ portalId: '1', uiDomain: '' }, 7), 'https://app.hubspot.com/contacts/1/record/0-1/7', 'default domain');
eq(hubspotContactUrl({ portalId: '1', uiDomain: 'https://app-eu1.hubspot.com/' }, '7'), 'https://app-eu1.hubspot.com/contacts/1/record/0-1/7', 'scheme and slash tolerated');
eq(hubspotContactUrl(null, '7'), '', 'no portal, no link');
eq(hubspotContactUrl({ portalId: '1' }, ''), '', 'no id, no link');
eq(hubspotContactUrl({ portalId: '1' }, 'abc'), '', 'a non-HubSpot id is not linked');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

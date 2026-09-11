// Assertion tests for the contact popup's phone numbers surviving a sync.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/contactCellPhone.test.mjs
//
// The Cell Phone Number kept having to be re-typed. Three things had to line
// up for that, and each is pinned below:
//
//   1. The sync asked HubSpot for `phone` but never `mobilephone`, so the cell
//      number came back undefined on every refresh.
//   2. The cache kept a hand-listed subset of each contact that didn't mention
//      `mobilephone` either — so even fetching it wouldn't have been enough.
//   3. The popup posts its whole form on every save, so once the field showed
//      blank, the next edit of ANY field wrote that blank over HubSpot's copy.
//      The number wasn't just missing from the screen; it was being deleted.
import { CONTACT_SYNC_PROPERTIES } from '../api/hubspot.js';
import { slimHubspotContact, withoutUnknownBlanks, LOCAL_CONTACT_KEYS } from '../src/utils/hubspotContactFields.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  if (actual === expected) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`); }
}

// 1. Both numbers are fetched.
eq(CONTACT_SYNC_PROPERTIES.includes('phone'), true, 'the sync asks for the work phone');
eq(CONTACT_SYNC_PROPERTIES.includes('mobilephone'), true, 'the sync asks for the cell phone');

// 2. Both numbers survive the trip into the cache.
const fromHubSpot = { id: '1', phone: '555-0100', mobilephone: '555-0199', firstname: 'Dana' };
eq(slimHubspotContact(fromHubSpot).phone, '555-0100', 'the cache keeps the work phone');
eq(slimHubspotContact(fromHubSpot).mobilephone, '555-0199', 'the cache keeps the cell phone');

// The invariant behind both: a field the cache keeps but the sync never asks
// for is a field that arrives undefined, every single refresh. This is the test
// that fails if someone adds a column to slimHubspotContact and stops there.
const unfetched = Object.keys(slimHubspotContact(fromHubSpot))
  .filter(k => !LOCAL_CONTACT_KEYS.includes(k))
  .filter(k => !CONTACT_SYNC_PROPERTIES.includes(k));
eq(unfetched.join(', '), '', 'every cached field is one the sync actually fetches');

// 3. A blank the form can't speak for stays out of the write.
const seeded = { id: '1', firstname: 'Dana', phone: '555-0100' }; // no mobilephone at all
const pruned = withoutUnknownBlanks(
  { firstname: 'Dana', phone: '555-0100', mobilephone: '', jobtitle: 'CFO' },
  seeded,
  new Set(['jobtitle']),
);
eq('mobilephone' in pruned, false, "an untouched blank on a field the record lacks isn't written");
eq(pruned.jobtitle, 'CFO', 'the edit that triggered the save still goes');
eq(pruned.phone, '555-0100', 'a field that has a value still goes');

// Clearing a field on purpose is still a write — typing in it marks it touched.
const cleared = withoutUnknownBlanks({ mobilephone: '' }, seeded, new Set(['mobilephone']));
eq(cleared.mobilephone, '', 'a blank the user typed clears HubSpot as asked');

// So is a blank on a field the record itself carries as empty: HubSpot has
// nothing there, so writing '' is a no-op rather than a wipe.
const knownEmpty = withoutUnknownBlanks({ mobilephone: '' }, { mobilephone: '' }, new Set());
eq(knownEmpty.mobilephone, '', 'a blank the record confirms is empty still goes');

// A null from HubSpot counts as "the record says this is empty" too.
const nullSeed = withoutUnknownBlanks({ mobilephone: '' }, { mobilephone: null }, new Set());
eq(nullSeed.mobilephone, '', 'a null on the record reads as a known empty');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

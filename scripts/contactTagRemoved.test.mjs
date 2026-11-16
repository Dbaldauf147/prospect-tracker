// The "Test" tag removed from every contact (api/_lib/contactTagStore.js
// REMOVED_TAGS). Plain Node with the in-memory Firestore stand-in. Run:
//   node scripts/contactTagRemoved.test.mjs
import {
  withoutRemovedTags, overlayTags, loadContactTags, saveContactTags,
  contactsWithStoredTags, purgeRemovedTags, removedTagEntries,
} from '../api/_lib/contactTagStore.js';
import { TAG_OPTIONS, tagVocabulary } from '../src/utils/contactTagReview.js';
import { fakeDb } from './_fakeTagDb.mjs';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

eq(withoutRemovedTags('ESG;Test;Utilities'), 'ESG;Utilities', 'Test is stripped');
eq(withoutRemovedTags(' test ;ESG; TEST'), 'ESG', 'any case or spacing');
eq(withoutRemovedTags('Testing;ESG'), 'Testing;ESG', 'a different tag that starts with Test is kept');
eq(removedTagEntries({ 1: 'ESG;Test', 2: 'ESG', 3: 'Test' }), [{ id: '1', tags: 'ESG' }, { id: '3', tags: '' }], 'only entries carrying it need rewriting');
eq(overlayTags([{ id: 1, dans_tags: 'x' }], { 1: 'Test;ESG' }).contacts[0].dans_tags, 'ESG', 'the overlay never shows it');

const uid = 'dan';
const db = fakeDb();
const ref = `contactTags/${uid}`;
db.docs.set(ref, { tags: { 1: 'ESG;Test', 2: 'Procurement', 3: 'Test' }, count: 3 });

eq(await loadContactTags(db, uid), { 1: 'ESG', 2: 'Procurement', 3: '' }, 'loads read without it');

// The contacts read purges the store and seeds HubSpot's value without it.
const out = await contactsWithStoredTags(db, uid, [
  { id: 1, dans_tags: 'ESG;Test' }, { id: 2, dans_tags: 'Procurement' }, { id: 3 }, { id: 4, dans_tags: 'Test;Utilities' },
]);
eq(out.map(c => c.dans_tags), ['ESG', 'Procurement', '', 'Test;Utilities'], 'read: stored contacts shown without it (unseen keeps HubSpot value this read)');
eq(db.docs.get(ref).tags, { 1: 'ESG', 2: 'Procurement', 3: '', 4: 'Utilities' }, 'store rewritten; the seed is stored without it');
const logs = [...db.docs.entries()].filter(([k]) => k.startsWith(`${ref}/log/`)).map(([, v]) => v);
eq(logs.map(l => [l.contactId, l.from, l.to, l.source]), [['1', 'ESG;Test', 'ESG', 'remove-tag'], ['3', 'Test', '', 'remove-tag']],
  'each removal is logged with what it was');

eq(await purgeRemovedTags(db, uid), 0, 'a second purge writes nothing');
await saveContactTags(db, uid, [{ id: 2, tags: 'Procurement;Test' }]);
eq(db.docs.get(ref).tags['2'], 'Procurement', 'an edit carrying it cannot put it back');

eq(TAG_OPTIONS.includes('Test'), false, 'no longer offered');
eq(tagVocabulary(['Test', 'ESG']).includes('Test'), false, 'and not pulled back in from a contact carrying it');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

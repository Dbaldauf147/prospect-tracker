// Tests for the app's own tag store (api/_lib/contactTagStore.js): tags
// kept in Firestore rather than HubSpot. Plain Node with an in-memory
// stand-in for the Firestore calls it makes. Run:
//   node scripts/contactTagStore.test.mjs
import {
  overlayTags, tagsOfProps, hasTagField, withoutTagFields,
  loadContactTags, saveContactTags, contactsWithStoredTags,
} from '../api/_lib/contactTagStore.js';
import { fakeDb } from './_fakeTagDb.mjs';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// The pure parts.
eq(tagsOfProps({ dans_tags: 'ESG;Utilities' }), 'ESG;Utilities', 'tagsOfProps reads dans_tags');
eq(tagsOfProps({ dan_s_tags: 'ESG' }), 'ESG', 'tagsOfProps reads the other spellings');
eq(tagsOfProps({ email: 'x' }), undefined, 'tagsOfProps: none');
eq(hasTagField({ dans_tags: '' }), true, 'hasTagField: an empty string is still a tag write (clearing them)');
eq(withoutTagFields({ dans_tags: 'ESG', dan_s_tags: 'ESG', email: 'a@b.com' }), { email: 'a@b.com' }, 'withoutTagFields strips every spelling');

const over = overlayTags([
  { id: 1, dans_tags: 'Old', email: 'a' },
  { id: '2', dans_tags: '', dan_s_tags: 'Stale' },
  { id: 3, dans_tags: 'ESG; Utilities ' },
], { 1: 'ESG;Procurement', 2: '' });
eq(over.contacts[0].dans_tags, 'ESG;Procurement', 'overlay: stored tags win over HubSpot');
eq([over.contacts[1].dans_tags, over.contacts[1].dan_s_tags], ['', ''], 'overlay: a stored empty value blanks every spelling, so no stale one shows through');
eq(over.contacts[2].dans_tags, 'ESG; Utilities ', 'overlay: a contact the store has not seen keeps HubSpot value');
eq(over.unseen, [{ id: '3', tags: 'ESG;Utilities' }], 'overlay: unseen contacts reported, cleaned, for seeding');

// The Firestore parts.
const db = fakeDb();
eq(await loadContactTags(db, 'u1'), {}, 'nothing stored yet reads as {}');

const seeded = await contactsWithStoredTags(db, 'u1', [{ id: 10, dans_tags: 'ESG' }, { id: 11, dans_tags: '' }]);
eq(seeded.map(c => c.dans_tags), ['ESG', ''], 'first read shows HubSpot values');
eq(await loadContactTags(db, 'u1'), { 10: 'ESG', 11: '' }, 'first read seeds the store');
eq([...db.docs.keys()].filter(k => k.includes('/log/')).length, 0, 'seeding writes no log rows');

eq(await saveContactTags(db, 'u1', [{ id: 10, tags: 'ESG;Utilities' }]), 1, 'an edit changes one contact');
eq(await saveContactTags(db, 'u1', [{ id: 10, tags: ' ESG ; Utilities' }]), 0, 'the same tags again is no change');
const log = [...db.docs.entries()].filter(([k]) => k.includes('/log/')).map(([, v]) => [v.contactId, v.from, v.to, v.source]);
eq(log, [['10', 'ESG', 'ESG;Utilities', 'edit']], 'the edit is logged with its before and after');

// HubSpot changing underneath no longer matters once the store has it.
const later = await contactsWithStoredTags(db, 'u1', [{ id: 10, dans_tags: '' }, { id: 11, dans_tags: 'Hide' }]);
eq(later.map(c => c.dans_tags), ['ESG;Utilities', ''], 'later reads ignore HubSpot for contacts the store has');

await saveContactTags(db, 'u1', [{ id: 11, tags: 'Procurement' }], { source: 'restore' });
const doc = db.docs.get('contactTags/u1');
eq([doc.tags, doc.count], [{ 10: 'ESG;Utilities', 11: 'Procurement' }, 2], 'map merged key by key, count of tagged contacts kept');
eq(await loadContactTags(db, 'u2'), {}, 'each user has their own store');

let threw = '';
try { await saveContactTags(db, '', [{ id: 1, tags: 'x' }]); } catch (e) { threw = e.message; }
eq(/no signed-in user/.test(threw), true, 'no user: refuses rather than writing somewhere shared');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

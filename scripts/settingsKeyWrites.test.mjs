// What a settings key write does to the key it names.
//
// The report was "I take a CC address off a contact, come back the next day
// and it is back" — and the same for a manager unticked in Reports To, a
// Standing put back to Neutral, a note cleared. Every one of those is
// written the same way: copy the map, drop the entry, save the map. The
// save went out as setDoc(merge: true), and Firestore merges a map field
// KEY BY KEY, so the entry that was dropped from the copy simply stayed on
// the server. Additions landed, removals never did, and the next load
// brought the old value back.
//
// These hold the fix in place: a whole-key write REPLACES the key, the way
// the HTTPS fallback's update mask always did, while keys the write does
// not name stay exactly as they were.
//
// Run: node scripts/settingsKeyWrites.test.mjs
import { register } from 'node:module';
register('./stubs/loader.mjs', import.meta.url);

const fs = await import('./stubs/firestore.mjs');
const { saveUserSettings } = await import('../src/utils/userSettingsSync.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}

const DOC = 'userSettings/u1';
const read = () => fs.store.get(DOC);

function seed(data) {
  fs.reset();
  fs.store.set(DOC, { _lastWriteAt: 100, ...data });
}

// ── The removal that kept coming back ──────────────────────────────────
{
  seed({
    ccMap: { 'meggan@berkshirepartners.com': ['dan@ra.com'], 'caitlin@berkshirepartners.com': ['dan@ra.com'] },
    contactNotes: { 101: 'spoke at the conference' },
  });

  // The popup dropped one address from its copy of the map and saved it.
  await saveUserSettings('u1', { ccMap: { 'caitlin@berkshirepartners.com': ['dan@ra.com'] } }, { expectedAt: 100 });

  const doc = read();
  ok(!('meggan@berkshirepartners.com' in doc.ccMap), 'the removed address is gone from the document');
  ok(Array.isArray(doc.ccMap['caitlin@berkshirepartners.com']), 'the address that stayed is still there');
  ok(doc.contactNotes[101] === 'spoke at the conference', 'a key the write never named is untouched');
  ok(doc._lastWriteAt > 100, 'and the write stamp other devices watch has moved');
}

// ── Clearing the last entry ────────────────────────────────────────────
//
// Untick the only manager in Reports To and the handler deletes the
// contact's entry outright. That is the same shape as above with nothing
// left over, and it is the one people notice first.
{
  seed({ contactReportsTo: { 101: ['202'], 303: ['404'] } });
  await saveUserSettings('u1', { contactReportsTo: { 303: ['404'] } }, { expectedAt: 100 });
  const doc = read();
  ok(!(101 in doc.contactReportsTo), "the cleared contact's entry is removed");
  ok(doc.contactReportsTo[303][0] === '404', 'the other contact keeps their manager');
}

// ── An addition still lands ────────────────────────────────────────────
{
  seed({ contactSentiment: { 101: 'champion' } });
  await saveUserSettings('u1', { contactSentiment: { 101: 'champion', 303: 'detractor' } }, { expectedAt: 100 });
  ok(read().contactSentiment[303] === 'detractor', 'a new entry is written');
  ok(read().contactSentiment[101] === 'champion', 'beside the one already there');
}

// ── A key with a dot in its name ───────────────────────────────────────
//
// updateDoc reads a dotted STRING as a path into a nested map, so a key
// like that has to go through FieldPath or the write lands somewhere
// nothing reads.
{
  seed({});
  await saveUserSettings('u1', { 'orgCharts.acme': { rows: 2 } }, { expectedAt: 100 });
  const doc = read();
  ok(doc['orgCharts.acme']?.rows === 2, 'the dotted key is written as one literal key');
  ok(doc.orgCharts === undefined, 'not as a nested map under its first segment');
}

// ── null drops the key ─────────────────────────────────────────────────
//
// What the REST fallback has always meant by it (in the mask, absent from
// the body), so both paths agree.
{
  seed({ utilityLookupCompanyName: 'Veris Residential', contactNotes: { 101: 'keep me' } });
  await saveUserSettings('u1', { utilityLookupCompanyName: null }, { expectedAt: 100 });
  const doc = read();
  ok(!('utilityLookupCompanyName' in doc), 'the key is gone');
  ok(doc.contactNotes[101] === 'keep me', 'and nothing else moved');
}

// ── The first save a user ever makes ───────────────────────────────────
//
// updateDoc refuses a document that does not exist. That is a brand-new
// account, and it still has to end up with its settings.
{
  fs.reset();
  await saveUserSettings('u1', { contactNotes: { 101: 'first' } }, {});
  ok(read()?.contactNotes[101] === 'first', 'the document is created with the write');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

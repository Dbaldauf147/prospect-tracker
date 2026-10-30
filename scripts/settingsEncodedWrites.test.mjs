// The big settings maps stored as one JSON string each (utils/settingsCodec),
// written and read through the real save functions against the Firestore
// stub: a dotted-path save into one, the stale check reading one, and a
// write from a tab still running the old code.
//
// Run: node scripts/settingsEncodedWrites.test.mjs
import { register } from 'node:module';
register('./stubs/loader.mjs', import.meta.url);

const fs = await import('./stubs/firestore.mjs');
const { saveUserSettings, savePathUpdates, fetchUserSettings } = await import('../src/utils/userSettingsSync.js');
const { decodeSettingsDoc } = await import('../src/utils/settingsCodec.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}

const DOC = 'userSettings/u1';
const raw = () => fs.store.get(DOC);
const read = () => decodeSettingsDoc(raw());
function seed(data) {
  fs.reset();
  fs.store.set(DOC, { _lastWriteAt: 100, ...data });
}

// ── A document saved before the change moves over on its next save ──────
{
  seed({ contactTagReview: { c1: [{ tag: 'DM' }] }, cdmName: 'Dan Baldauf' });
  const before = await fetchUserSettings('u1');
  ok(before.contactTagReview.c1[0].tag === 'DM', 'the old map form still reads');
  const whole = { contactTagReview: { ...before.contactTagReview, c2: [{ tag: 'Energy' }] } };
  await savePathUpdates('u1', { 'contactTagReview.c2': [{ tag: 'Energy' }] }, { expectedAt: 100, wholeValues: whole });
  ok(typeof raw().contactTagReview_json === 'string', 'a path save into it writes the text field');
  ok(!('contactTagReview' in raw()), 'and drops the old map field');
  ok(read().contactTagReview.c1[0].tag === 'DM' && read().contactTagReview.c2[0].tag === 'Energy', 'with every entry, old and new');
  ok(read().cdmName === 'Dan Baldauf', 'leaving the other keys alone');
}

// ── A path save without the whole map is refused, nothing written ──────
{
  seed({ contactTagReview_json: JSON.stringify({ c1: [] }) });
  let threw = false;
  try { await savePathUpdates('u1', { 'contactTagReview.c2': [] }, { expectedAt: 100 }); } catch { threw = true; }
  ok(threw, 'refused');
  ok(raw().contactTagReview_json === JSON.stringify({ c1: [] }), 'and the stored map is untouched');
}

// ── The stale check hands back the map as an object ────────────────────
{
  seed({ _lastWriteAt: 500, targetMap_json: JSON.stringify({ p1: ['Acme'] }) });
  const res = await saveUserSettings('u1', { targetMap: { p2: ['Beta'] } }, { expectedAt: 100 });
  ok(res.stale && res.remoteData.targetMap.p1[0] === 'Acme', 'the other device\'s map arrives decoded for the merge');
}

// ── A tab still on the old code writes the plain field ─────────────────
{
  seed({ targetMap_json: JSON.stringify({ p1: ['Acme'] }) });
  // What the old code sends for one mapping: a dotted path into the map.
  fs.store.get(DOC).targetMap = { p9: ['Old Tab Co'] };
  ok(read().targetMap.p1[0] === 'Acme' && read().targetMap.p9[0] === 'Old Tab Co', 'its entry reads alongside the stored ones');
  const current = read();
  await saveUserSettings('u1', { targetMap: { ...current.targetMap, p2: ['Beta'] } }, { force: true });
  ok(!('targetMap' in raw()) && Object.keys(read().targetMap).sort().join() === 'p1,p2,p9', 'and the next save folds it into the text');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

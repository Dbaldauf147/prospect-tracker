// The big settings maps kept in their own documents
// (`userSettings/{uid}/settingsKeys/{key}`, utils/settingsCodec), written and
// read through the real save functions against the Firestore stub: a
// dotted-path save into one, the stale check reading one, a full read, the
// move off the settings document, and a write from a tab on the old code.
//
// Run: node scripts/settingsEncodedWrites.test.mjs
import { register } from 'node:module';
register('./stubs/loader.mjs', import.meta.url);

const fs = await import('./stubs/firestore.mjs');
const { saveUserSettings, savePathUpdates, fetchUserSettings } = await import('../src/utils/userSettingsSync.js');
const { settingsDocReport, overSettingsBudget } = await import('../src/utils/settingsDocSize.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}

const DOC = 'userSettings/u1';
const KEY = (k) => `userSettings/u1/settingsKeys/${k}`;
const raw = () => fs.store.get(DOC);
const keyDoc = (k) => fs.store.get(KEY(k));
const keyVal = (k) => (keyDoc(k) ? JSON.parse(keyDoc(k).json) : undefined);
function seed(data, keys = {}) {
  fs.reset();
  fs.store.set(DOC, { _lastWriteAt: 100, ...data });
  for (const [k, v] of Object.entries(keys)) fs.store.set(KEY(k), { json: JSON.stringify(v), at: 1 });
}

// ── A settings document from before: the map moves out on its next save ─
{
  seed({ contactTagReview: { c1: [{ tag: 'DM' }] }, cdmName: 'Dan Baldauf' });
  const before = await fetchUserSettings('u1');
  ok(before.contactTagReview.c1[0].tag === 'DM', 'the old form still reads');
  const whole = { contactTagReview: { ...before.contactTagReview, c2: [{ tag: 'Energy' }] } };
  await savePathUpdates('u1', { 'contactTagReview.c2': [{ tag: 'Energy' }] }, { expectedAt: 100, wholeValues: whole });
  ok(keyVal('contactTagReview')?.c1[0].tag === 'DM' && keyVal('contactTagReview')?.c2[0].tag === 'Energy', 'a path save puts the whole map in its own document');
  ok(!('contactTagReview' in raw()), 'and the settings document drops its copy');
  ok(raw().cdmName === 'Dan Baldauf' && raw()._lastWriteAt > 100, 'leaving the other keys, with the write stamp moved');
  const after = await fetchUserSettings('u1');
  ok(after.contactTagReview.c2[0].tag === 'Energy' && after.cdmName === 'Dan Baldauf', 'a full read puts it all back together');
}

// ── A path save without the whole map is refused, nothing written ──────
{
  seed({}, { contactTagReview: { c1: [] } });
  let threw = false;
  try { await savePathUpdates('u1', { 'contactTagReview.c2': [] }, { expectedAt: 100 }); } catch { threw = true; }
  ok(threw, 'refused');
  ok(JSON.stringify(keyVal('contactTagReview')) === '{"c1":[]}', 'and the stored map is untouched');
}

// ── The stale check hands back the other device's map for the merge ────
{
  seed({ _lastWriteAt: 500 }, { targetMap: { p1: ['Acme'] } });
  const res = await saveUserSettings('u1', { targetMap: { p2: ['Beta'] } }, { expectedAt: 100 });
  ok(res.stale && res.remoteData.targetMap.p1[0] === 'Acme', 'read from its document');
  ok(keyVal('targetMap').p1 && !keyVal('targetMap').p2, 'and nothing was written');
}

// ── Whole-key save and delete ──────────────────────────────────────────
{
  seed({ targetMap_json: JSON.stringify({ p0: [] }) });
  await saveUserSettings('u1', { targetMap: { p1: ['Acme'] }, cdmName: 'Dan' }, { expectedAt: 100 });
  ok(keyVal('targetMap').p1[0] === 'Acme', 'a whole-key save lands in the document');
  ok(!('targetMap_json' in raw()) && raw().cdmName === 'Dan', 'the string form is dropped, the rest saved as usual');
  await saveUserSettings('u1', { targetMap: null }, { force: true });
  ok(keyDoc('targetMap') === undefined, 'saving null deletes the document');
}

// ── A tab still on the old code writes the plain field ─────────────────
{
  seed({ targetMap: { p9: ['Old Tab Co'] } }, { targetMap: { p1: ['Acme'] } });
  const current = await fetchUserSettings('u1');
  ok(current.targetMap.p1[0] === 'Acme' && current.targetMap.p9[0] === 'Old Tab Co', 'its entry reads alongside the stored ones');
  await saveUserSettings('u1', { targetMap: { ...current.targetMap, p2: ['Beta'] } }, { force: true });
  ok(!('targetMap' in raw()) && Object.keys(keyVal('targetMap')).sort().join() === 'p1,p2,p9', 'and the next save folds it into the document');
}

// ── The size check: the maps don't count against the settings document ──
{
  const big = Object.fromEntries(Array.from({ length: 4000 }, (_, i) => [`co${i}`, { notes: 'x'.repeat(200) }]));
  const report = settingsDocReport({ cdmName: 'Dan', companyOpportunities: big, contactTagReview: big });
  ok(report.bytes < 10000 && !overSettingsBudget(report), 'two ~900 KB maps leave the settings document small');
  const huge = Object.fromEntries(Array.from({ length: 6000 }, (_, i) => [`co${i}`, { notes: 'x'.repeat(200) }]));
  ok(overSettingsBudget(settingsDocReport({ companyOpportunities: huge })), 'but one past its own document\'s 1 MB is still refused');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

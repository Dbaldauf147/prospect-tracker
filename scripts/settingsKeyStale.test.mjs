// The Changed Jobs hides and snoozes that didn't hold.
//
// Hide and Snooze on the Changed Jobs page are flags in
// settings.contactLocalFields, a big map that lives in a document of its own
// (settingsCodec). A save's stale check only looked at the settings
// document's _lastWriteAt. The two documents arrive in separate snapshots, so
// just after a load a tab could hold the settings document fresh from the
// server and contactLocalFields still as the local cache had it. The stamp
// matched, the save was "not stale", and the old map plus one click replaced
// the stored one: every hide and snooze made since that cache was written
// was gone.
//
// These hold the fix: a save also compares the `at` of each map document it
// writes with the one it holds.
//
// Run: node scripts/settingsKeyStale.test.mjs
import { register } from 'node:module';
register('./stubs/loader.mjs', import.meta.url);

const fs = await import('./stubs/firestore.mjs');
const { saveUserSettings, savePathUpdates } = await import('../src/utils/userSettingsSync.js');
const { keyDocData, keyDocValue, composeSettings, splitSettingsUpdates, staleKeysIn, KEY_AT_FIELD } = await import('../src/utils/settingsCodec.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}

const DOC = 'userSettings/u1';
const KEY = `${DOC}/settingsKeys/contactLocalFields`;
const stored = { a: { _changedJobsHidden: true }, b: { _changedJobsSnoozeUntil: '2027-02-01T00:00:00.000Z' } };

function seed() {
  fs.reset();
  fs.store.set(DOC, { _lastWriteAt: 200 });
  fs.store.set(KEY, keyDocData(stored, 150));
}

// ── The settings document is fresh, the map is the cached copy ─────────
{
  seed();
  // What the tab holds: no a/b flags yet (the cache predates them), plus
  // the click it just made on contact c.
  const res = await saveUserSettings('u1', { contactLocalFields: { c: { _changedJobsHidden: true } } }, {
    expectedAt: 200,
    expectedKeyAt: { contactLocalFields: 100 },
  });
  ok(res.stale === true, 'a save holding an older map than the stored one is stale');
  ok(res.remoteData?.contactLocalFields?.a?._changedJobsHidden === true, 'and hands back the stored map to build on');
  ok(res.remoteData?.[KEY_AT_FIELD]?.contactLocalFields === 150, 'with its stamp');
  ok(keyDocValue(fs.store.get(KEY)).b, 'nothing was written over the stored map');
}

// ── Holding the map the store has: an ordinary save ────────────────────
{
  seed();
  const next = { ...stored, c: { _changedJobsHidden: true } };
  const res = await saveUserSettings('u1', { contactLocalFields: next }, {
    expectedAt: 200,
    expectedKeyAt: { contactLocalFields: 150 },
  });
  ok(!res.stale, 'the same stamp is not stale');
  ok(res.keysWritten?.includes('contactLocalFields'), 'and says which map documents it wrote');
  const doc = fs.store.get(KEY);
  ok(keyDocValue(doc).c && doc.at === res.writtenAt, 'the map is written, stamped with the write');
}

// ── No map stamp held at all ───────────────────────────────────────────
{
  seed();
  const res = await saveUserSettings('u1', { contactLocalFields: { c: {} } }, { expectedAt: 200, expectedKeyAt: {} });
  ok(res.stale === true, 'a tab that never saw the map document is behind it');
}

// ── A save that doesn't write the map isn't held up by it ──────────────
{
  seed();
  const res = await saveUserSettings('u1', { cdmName: 'Dan' }, { expectedAt: 200, expectedKeyAt: {} });
  ok(!res.stale, 'only the maps a save writes are compared');
}

// ── Path saves check the same way ──────────────────────────────────────
{
  seed();
  const res = await savePathUpdates('u1', { 'contactLocalFields.c': { _changedJobsHidden: true } }, {
    expectedAt: 200,
    expectedKeyAt: { contactLocalFields: 100 },
    wholeValues: { contactLocalFields: { c: { _changedJobsHidden: true } } },
  });
  ok(res.stale === true, 'a path into an older map is stale too');
  ok(keyDocValue(fs.store.get(KEY)).a, 'and wrote nothing');
}

// ── The stamps are read, never stored ──────────────────────────────────
{
  const composed = composeSettings({ _lastWriteAt: 1 }, { contactLocalFields: stored }, { contactLocalFields: 150 });
  ok(composed[KEY_AT_FIELD]?.contactLocalFields === 150, 'settings carry each map document\'s stamp');
  const { main } = splitSettingsUpdates({ cdmName: 'Dan', [KEY_AT_FIELD]: { contactLocalFields: 1 } });
  ok(!(KEY_AT_FIELD in main), 'a save (a restored backup, say) never writes them to the settings document');
  ok(staleKeysIn(['x', 'y'], { x: 5, y: 9 }, { x: 6, y: 9 }).join() === 'x', 'staleKeysIn names only the maps stored later than held');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

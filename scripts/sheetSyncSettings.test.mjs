// Assertion tests for where the Google Sheets sync reads its
// configuration. Plain Node — no test framework (the project has none).
// Run:
//   node scripts/sheetSyncSettings.test.mjs
//
// The configuration moved out of localStorage and onto the settings
// document so it follows the account rather than the machine. The
// migration is the part worth pinning: read it wrong and a browser that
// still holds the legacy copy overwrites a newer one set on another
// computer, or the sync goes quiet because neither source is consulted.

// userLs reads localStorage, which Node doesn't have. A minimal stub is
// enough — the module only ever getItem's.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};

const { readSheetSync, autoSyncSchedule, planSheetSyncMigration, SHEET_SYNC_KEY, LEGACY_SETTINGS_KEY } =
  await import('../src/utils/sheetSyncSettings.js');
const { setUserLsUserId } = await import('../src/utils/userLs.js');

// userLs scopes every key to the signed-in user, so the reads under test
// only find a legacy value the way the app does: signed in, with the
// un-prefixed key left over from before scoping.
setUserLsUserId('user-1');

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
const setLegacy = (v) => { store.clear(); if (v !== undefined) globalThis.localStorage.setItem(LEGACY_SETTINGS_KEY, JSON.stringify(v)); };
const legacyRaw = (raw) => { store.clear(); globalThis.localStorage.setItem(LEGACY_SETTINGS_KEY, raw); };

// ── Reading the configuration ──────────────────────────────────────────
{
  setLegacy(undefined);
  eq(readSheetSync({ [SHEET_SYNC_KEY]: { sheetsUrl: 'x' } }), { sheetsUrl: 'x' }, 'the settings document is the source');
  eq(readSheetSync({}), {}, 'an account with nothing stored reads as empty, not undefined');
  eq(readSheetSync(null), {}, 'and so does no settings object at all');
  eq(readSheetSync({ [SHEET_SYNC_KEY]: 'nonsense' }), {}, 'a non-object value is ignored rather than returned');
}

{
  // The browser that still holds the legacy copy keeps working while the
  // migration is in flight — otherwise the sync goes quiet for one load.
  setLegacy({ sheetsUrl: 'legacy', mainFreq: 15 });
  eq(readSheetSync({}), { sheetsUrl: 'legacy', mainFreq: 15 }, 'localStorage is the fallback until the lift lands');
  eq(readSheetSync({ [SHEET_SYNC_KEY]: { sheetsUrl: 'stored' } }), { sheetsUrl: 'stored' },
    'but the stored copy wins the moment there is one');
}

// ── The schedule ───────────────────────────────────────────────────────
{
  setLegacy(undefined);
  const sched = (cfg) => autoSyncSchedule({ [SHEET_SYNC_KEY]: cfg }).intervalMs;
  eq(sched({ sheetsUrl: 'x' }), 5 * 60 * 1000, 'five minutes is the default');
  eq(sched({ sheetsUrl: 'x', mainFreq: 30 }), 30 * 60 * 1000, 'a set frequency is honoured');
  eq(sched({}), null, 'no sheet configured means no schedule');
  eq(sched({ sheetsUrl: 'x', mainPaused: true }), null, 'paused means no schedule');
  eq(sched({ sheetsUrl: 'x', mainFreq: 0 }), null, 'and manual-only means no schedule');
  eq(autoSyncSchedule(null).intervalMs, null, 'nor does an account with no settings run anything');
}

// ── The one-time lift ──────────────────────────────────────────────────
{
  setLegacy({ sheetsUrl: 'legacy', mainFreq: 15, extraSheets: [{ url: 'e' }] });
  eq(planSheetSyncMigration({}), { [SHEET_SYNC_KEY]: { sheetsUrl: 'legacy', mainFreq: 15, extraSheets: [{ url: 'e' }] } },
    'the whole legacy blob is carried up, extra sheets included');
  eq(planSheetSyncMigration({ [SHEET_SYNC_KEY]: { sheetsUrl: 'stored' } }), null,
    'an account that already has a copy is left alone — this is what stops a stale browser clobbering another device');
  eq(planSheetSyncMigration({ [SHEET_SYNC_KEY]: {} }), null,
    'including a deliberately empty one');
}

{
  setLegacy(undefined);
  eq(planSheetSyncMigration({}), null, 'a browser with nothing to lift plans nothing');
  eq(planSheetSyncMigration(null), null, 'and neither does no settings object');
  legacyRaw('{not json');
  eq(planSheetSyncMigration({}), null, 'nor does an unparseable legacy value');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

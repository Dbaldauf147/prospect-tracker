// The next Firestore crash has to say what it was, and a crashed tab has
// to reload itself without costing the user a half-typed edit or a save.
//
// Pinned: the cause is the assertion quoted inside the b815 aftermath, the
// crash is logged to this device (newest first, capped), the Copy details
// text carries the cause, viaSdkOrRest is counted as a save in flight, and
// the auto-reload waits for a hidden, idle tab with nothing saving and no
// text field focused.
//
// Run: node scripts/firestoreCrashDiagnostics.test.mjs

// A minimal localStorage, which Node lacks.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

// The crash note logs to the console; that is expected here.
console.error = () => {};

const health = await import('../src/utils/firestoreClientHealth.js');
const {
  assertionIds, crashCauseId, noteClientWedged, recentClientCrashes, clientCrashReport,
  safeToAutoReload, viaSdkOrRest, __resetClientHealth,
} = health;

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const nested = new Error('FIRESTORE (12.18.0) INTERNAL ASSERTION FAILED: Unexpected state (ID: b815) CONTEXT: {"Pc":"Error: FIRESTORE (12.18.0) INTERNAL ASSERTION FAILED: Unexpected state (ID: 2f8e) CONTEXT: {}"}');
check('ids, outermost first', assertionIds(nested), ['b815', '2f8e']);
check('the cause is the inner one', crashCauseId(nested), '2f8e');
check('b815 alone is its own cause', crashCauseId(new Error('Unexpected state (ID: b815)')), 'b815');
check('no id, no cause', crashCauseId(new Error('AsyncQueue is already failed')), '');

__resetClientHealth();
noteClientWedged(nested);
const log = recentClientCrashes();
check('logged once', log.length, 1);
check('logged with its cause and sdk', [log[0].cause, log[0].sdk], ['2f8e', '12.18.0']);
check('a second note in the same tab is not logged again', (noteClientWedged(nested), recentClientCrashes().length), 1);
check('report names the cause', /cause 2f8e/.test(clientCrashReport()), true);
for (let i = 0; i < 12; i++) { __resetClientHealth(); noteClientWedged(new Error(`(ID: a${i})`)); }
check('capped at ten, newest first', [recentClientCrashes().length, recentClientCrashes()[0].cause], [10, 'a11']);

// The reload guard.
const base = { now: 1_000_000, hiddenSince: 1_000_000 - 60_000, lastInputAt: 1_000_000 - 120_000, saving: 0, lastSave: 1_000_000 - 60_000, editableFocused: false };
check('hidden, idle, quiet: reload', safeToAutoReload(base), true);
check('tab in view: wait', safeToAutoReload({ ...base, hiddenSince: null }), false);
check('only just hidden: wait', safeToAutoReload({ ...base, hiddenSince: base.now - 5_000 }), false);
check('typed a moment ago: wait', safeToAutoReload({ ...base, lastInputAt: base.now - 10_000 }), false);
check('a save running: wait', safeToAutoReload({ ...base, saving: 1 }), false);
check('a save just finished: wait', safeToAutoReload({ ...base, lastSave: base.now - 2_000 }), false);
check('a text field focused: wait', safeToAutoReload({ ...base, editableFocused: true }), false);

// viaSdkOrRest still behaves, and still falls back.
__resetClientHealth();
check('healthy: the sdk answers', await viaSdkOrRest(async () => 'sdk', async () => 'rest'), 'sdk');
check('crash: the rest answers', await viaSdkOrRest(async () => { throw nested; }, async () => 'rest'), 'rest');
__resetClientHealth();
let threw = null;
try { await viaSdkOrRest(async () => { throw new Error('permission-denied'); }, async () => 'rest'); } catch (e) { threw = e.message; }
check('another error still throws', threw, 'permission-denied');

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

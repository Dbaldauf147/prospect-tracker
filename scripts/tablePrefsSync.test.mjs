// Assertion tests for the column-layout persistence every table shares.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/tablePrefsSync.test.mjs
//
// A column layout is stored twice: locally so the table draws it on the first
// paint, and in the settings document so it follows the user to their other
// machine. What follows pins the parts of that which are easy to get wrong
// and invisible when you do — a layout silently not travelling, a drag
// costing one network write per pixel, and two tables saving in the same tick
// overwriting each other's entry.
//
// localStorage doesn't exist in Node, so it's stubbed: the module reads and
// writes through the same global the browser provides.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const {
  tablePrefsKeys, persistTablePrefs, flushTablePrefs, readRemoteTablePrefs, settingsHaveLoaded,
  loadColWidths, loadColHidden, loadColStarred, loadColOrder, loadColRemoved, loadColVisibleRaw,
  encodeRemoteMap, decodeRemoteMap,
} = await import('../src/utils/tablePrefsSync.js');

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${b}\n        got      ${a}`); }
}
const ok = (cond, name) => eq(!!cond, true, name);

const keys = tablePrefsKeys('my-accounts');

// A recording stand-in for the settings hook.
function fakeSettings(initial = {}) {
  const calls = [];
  const settings = { _lastWriteAt: 1, tablePrefs: initial };
  return {
    settings,
    calls,
    updateSettings: (patch) => { calls.push(patch); Object.assign(settings, patch); },
  };
}

// ── both copies get written ──────────────────────────────────────────────

const s1 = fakeSettings();
persistTablePrefs(keys, 'my-accounts', s1.settings, s1.updateSettings, { widths: { company: 240 } });
eq(loadColWidths(keys), { company: 240 }, 'a width change lands locally straight away');
eq(s1.calls.length, 0, 'but the settings write waits — a drag fires this per mousemove');
flushTablePrefs();
eq(s1.calls.length, 1, 'and goes out once the drag settles');
eq(s1.calls[0].tablePrefs['my-accounts'].widths, { company: 240 }, 'carrying the layout');

// ── the coalescing is what makes a drag affordable ───────────────────────

const s2 = fakeSettings();
for (let px = 100; px < 160; px += 1) {
  persistTablePrefs(keys, 'my-accounts', s2.settings, s2.updateSettings, { widths: { company: px } });
}
eq(s2.calls.length, 0, 'sixty mousemoves queue no settings writes');
flushTablePrefs();
eq(s2.calls.length, 1, 'they become one');
eq(s2.calls[0].tablePrefs['my-accounts'].widths, { company: 159 }, 'holding where the drag ended');

// Changes of different kinds in one burst all survive the coalescing.
const s3 = fakeSettings();
persistTablePrefs(keys, 'my-accounts', s3.settings, s3.updateSettings, { widths: { a: 10 } });
persistTablePrefs(keys, 'my-accounts', s3.settings, s3.updateSettings, { hidden: ['b'] });
persistTablePrefs(keys, 'my-accounts', s3.settings, s3.updateSettings, { starred: new Set(['c']) });
flushTablePrefs();
const entry3 = s3.calls[0].tablePrefs['my-accounts'];
eq([entry3.widths, entry3.hidden, entry3.starred], [{ a: 10 }, ['b'], ['c']],
  'a width, a hidden column and a star in one burst all reach the write');
eq(loadColHidden(keys), ['b'], 'hidden is stored as a plain array');
eq([...loadColStarred(keys)], ['c'], 'and a starred Set reads back as a Set');

// ── two tables saving at once keep each other's layout ───────────────────
//
// Each caller builds its update from the settings snapshot it captured, and a
// settings write replaces the whole tablePrefs key — so writing separately in
// one tick would silently drop whichever landed first.
const s4 = fakeSettings({ untouched: { widths: { z: 5 } } });
persistTablePrefs(tablePrefsKeys('opps2'), 'opps2', s4.settings, s4.updateSettings, { widths: { a: 1 } });
persistTablePrefs(tablePrefsKeys('issues'), 'issues', s4.settings, s4.updateSettings, { widths: { b: 2 } });
flushTablePrefs();
eq(s4.calls.length, 1, 'two tables flush as a single settings write');
eq(Object.keys(s4.calls[0].tablePrefs).sort(), ['issues', 'opps2', 'untouched'],
  'holding both layouts — and leaving a third table alone');

// A table the user has never touched on this device keeps what the other one saved.
const s5 = fakeSettings({ 'my-accounts': { widths: { company: 300 }, hidden: ['tier'] } });
persistTablePrefs(keys, 'my-accounts', s5.settings, s5.updateSettings, { widths: { company: 320 } });
flushTablePrefs();
eq(s5.calls[0].tablePrefs['my-accounts'], { widths: { company: 320 }, hidden: ['tier'] },
  'changing a width leaves the hidden columns saved with it alone');

// ── reading back what the other machine saved ────────────────────────────

const remote = readRemoteTablePrefs(
  { tablePrefs: { t: { widths: { '_x___select__': 40, plain: 90 }, hidden: ['x'] } } }, 't');
eq(remote.widths, { __select__: 40, plain: 90 },
  'a column key Firestore refuses (leading and trailing __) round-trips intact');
eq(remote.hidden, ['x'], 'other kinds come back unchanged');
eq(readRemoteTablePrefs({ tablePrefs: {} }, 't'), undefined, 'a table with no saved layout reads as nothing');
eq(readRemoteTablePrefs(undefined, 't'), undefined, 'and so does no settings at all');
eq(encodeRemoteMap({ __select__: 1 }), { _x___select__: 1 }, 'encoding is the inverse');
eq(decodeRemoteMap(encodeRemoteMap({ __a__: 1, b: 2 })), { __a__: 1, b: 2 }, 'and round-trips');

// The "have settings arrived" test guards the adopt step: without it an empty
// settings object during load reads as "no saved layout" and the table would
// overwrite a real one with its defaults.
eq(settingsHaveLoaded({}), false, 'settings that have not arrived are not loaded');
eq(settingsHaveLoaded({ _lastWriteAt: 12 }), true, 'a stamped settings document is');
eq(settingsHaveLoaded(undefined), false, 'and nothing is not');

// ── a table that is not wired for sync still works ───────────────────────

store.clear();
persistTablePrefs(keys, 'my-accounts', null, null, { widths: { company: 111 } });
eq(loadColWidths(keys), { company: 111 }, 'no settings: the local copy is still written');
flushTablePrefs();
eq(loadColOrder(keys), [], 'kinds never written read as empty');
eq(loadColHidden(keys), null, 'except hidden, which reads as null — "never chosen"');
eq(loadColVisibleRaw(keys), null, 'and the legacy visible list, same reason');
eq([...loadColRemoved(keys)], [], 'removed reads as an empty set');

// Junk in storage is a layout that never got saved, not a crash.
store.set(keys.widths, 'not json');
store.set(keys.hidden, '{"not":"an array"}');
store.set(keys.starred, 'null');
eq(loadColWidths(keys), {}, 'unparseable widths read as none');
eq(loadColHidden(keys), null, 'a non-array hidden list reads as never chosen');
eq([...loadColStarred(keys)], [], 'and a null starred list as nothing starred');

// An empty saved visible list would render a table with no columns at all.
store.set(keys.visible, '[]');
eq(loadColVisibleRaw(keys), null, 'an empty visible list reads as no preference, not "show nothing"');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

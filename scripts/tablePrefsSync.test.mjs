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
  sameStoredValue, SET_PREF,
  loadColWidths, loadColHidden, loadColStarred, loadColOrder, loadColRemoved, loadColVisibleRaw,
  encodeRemoteMap, decodeRemoteMap, localOnlyTablePrefs, seedTablePrefsFromLocal, lsHas,
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
eq(s1.calls.length, 0, 'but the settings write waits - a drag fires this per mousemove');
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
  'holding both layouts - and leaving a third table alone');

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
eq(loadColHidden(keys), null, 'except hidden, which reads as null - "never chosen"');
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

// ── the stored-shape comparison ──────────────────────────────────────────
//
// How a table decides whether an incoming layout is news. It has to compare
// in the shape the layout is STORED in: a hidden-column list is a Set while
// it's in state, and JSON.stringify of any Set is "{}" — so comparing live
// values reported every incoming set as already-equal, and a column hidden on
// one machine never arrived on the other. Caught in a browser; pinned here.

eq(sameStoredValue('{"a":1}', { a: 1 }), true, 'an unchanged map is not news');
eq(sameStoredValue('{"a":2}', { a: 1 }), false, 'a changed map is');
eq(sameStoredValue('["x"]', new Set(['x']), SET_PREF.toRemote), true,
  'a Set holding the same keys is not news');
eq(sameStoredValue('["x","y"]', new Set(['x']), SET_PREF.toRemote), false,
  'a Set that gained a key IS news - the bug this pins made this read as equal');
eq(sameStoredValue('[]', new Set(['x']), SET_PREF.toRemote), false,
  'and so is one that lost its last key');
eq(SET_PREF.fromRemote(['a', 'b']) instanceof Set, true, 'a stored list reads back as a Set');
eq([...SET_PREF.fromRemote(null)], [], 'and a missing one as an empty Set');

// ── sort and filters travel too ──────────────────────────────────────────
//
// The PE Portfolio table keeps its own local copy of both and syncs them
// through useSyncedTablePref, so all this module has to do is carry them.
const s6 = fakeSettings({ 'pe-portfolio': { hidden: ['x'] } });
persistTablePrefs(null, 'pe-portfolio', s6.settings, s6.updateSettings, { sort: { dir: 'asc', key: 'company' } });
persistTablePrefs(null, 'pe-portfolio', s6.settings, s6.updateSettings, {
  filters: { status: ['Prospect'], __flag__: { picks: [], draft: 'bl' } },
});
flushTablePrefs();
const entry6 = s6.calls[0].tablePrefs['pe-portfolio'];
eq(entry6.sort, { dir: 'asc', key: 'company' }, 'a sort reaches the settings write');
eq(entry6.filters, { status: ['Prospect'], _x___flag__: { picks: [], draft: 'bl' } },
  'and so do the filters, with column keys encoded like widths');
eq(entry6.hidden, ['x'], 'leaving the rest of the entry alone');
eq(readRemoteTablePrefs(s6.settings, 'pe-portfolio').filters,
  { status: ['Prospect'], __flag__: { picks: [], draft: 'bl' } },
  'filters read back with their column keys decoded');
eq(readRemoteTablePrefs(s6.settings, 'pe-portfolio').sort, { dir: 'asc', key: 'company' },
  'and the sort reads back as saved');
const s7 = fakeSettings({ 'pe-portfolio': { filters: { status: ['Prospect'] } } });
persistTablePrefs(null, 'pe-portfolio', s7.settings, s7.updateSettings, { filters: {} });
flushTablePrefs();
eq(s7.calls[0].tablePrefs['pe-portfolio'].filters, {},
  'clearing every filter is written as an empty map, so the other machine clears too');

// ── uploading layouts only this browser has ──────────────────────────────
// A layout that predates its table syncing exists locally and nowhere else
// until the user changes it, so clearing site data would lose it. The sweep
// at sign-in sends it up, but only what was actually saved, and never over
// what the account already holds.

// A storage with the length/key() enumeration the sweep walks.
function fakeStorage(entries) {
  const m = new Map(Object.entries(entries));
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
  };
}
{
  const storage = fakeStorage({
    'prospect-col-widths-deals': JSON.stringify({ company: 200 }),
    'prospect-col-hidden-deals': JSON.stringify(['notes']),
    'prospect-col-visible-deals': JSON.stringify(['company']),     // superseded by hidden
    'prospect-col-starred-sites': JSON.stringify(['name']),
    'prospect-col-widths-sites': JSON.stringify({ name: 120 }),    // account already has widths
    'prospect-col-order-empty': JSON.stringify([]),                // nothing saved worth sending
    'prospect-col-visible-blank': JSON.stringify([]),
    'prospect-col-hidden-cleared': JSON.stringify([]),             // "show everything" is a choice
    'prospect-col-widths': JSON.stringify({ company: 300 }),       // the main Table view's own names
    'prospect-col-chosen-deals': JSON.stringify(['notes']),        // per-machine by design
    'prospect-col-widths-deals:company|notes': JSON.stringify({ a: 1 }), // legacy lineup bucket
    'prospect-col-names-broken': '{not json',
    'unrelated-key': '1',
  });
  const settings = { _lastWriteAt: 1, tablePrefs: { sites: { widths: { name: 90 } } } };
  const out = localOnlyTablePrefs(settings, storage);
  eq(out.deals, { widths: { company: 200 }, hidden: ['notes'] },
    'a local-only layout is found, and hidden wins over the old visible list');
  eq(out.sites, { starred: ['name'] }, 'what the account already has is left alone');
  eq(out['table-view'], { widths: { company: 300 } }, "the main Table view's unsuffixed keys count");
  eq(out.cleared, { hidden: [] }, 'an empty hidden list is a choice, so it goes up');
  ok(!out.empty && !out.blank, 'an empty order or visible list is no preference, so it stays');
  ok(!Object.keys(out).some(k => k.includes('|')), 'legacy per-lineup buckets are not uploaded');
  ok(!out.broken, 'an unreadable value is skipped rather than crashing the sweep');
  ok(!JSON.stringify(out).includes('chosen'), 'the per-machine chosen flags stay local');

  const remoteHidden = localOnlyTablePrefs(
    { _lastWriteAt: 1, tablePrefs: { deals: { hidden: ['x'] } } },
    fakeStorage({ 'prospect-col-visible-deals': JSON.stringify(['company']) }),
  );
  eq(remoteHidden, {}, 'nor is a visible list sent to a table the account has a hidden list for');
}
{
  // The upload itself: one coalesced write carrying every table, layered
  // onto what the account already had.
  const realStorage = globalThis.localStorage;
  globalThis.localStorage = fakeStorage({
    'prospect-col-widths-deals': JSON.stringify({ company: 200 }),
    'prospect-col-starred-sites': JSON.stringify(['name']),
  });
  const s8 = fakeSettings({ sites: { widths: { name: 90 } } });
  eq(seedTablePrefsFromLocal(s8.settings, s8.updateSettings), 2, 'the sweep reports how many tables it sent');
  flushTablePrefs();
  eq(s8.calls.length, 1, 'as one settings write');
  eq(s8.calls[0].tablePrefs.deals, { widths: { company: 200 } }, 'carrying the local-only table');
  eq(s8.calls[0].tablePrefs.sites, { widths: { name: 90 }, starred: ['name'] },
    'and merging into the entry the account already had');
  const s9 = fakeSettings({ deals: { widths: { company: 1 } }, sites: { starred: [] } });
  eq(seedTablePrefsFromLocal(s9.settings, s9.updateSettings), 0, 'nothing to send, nothing sent');
  eq(seedTablePrefsFromLocal(null, s9.updateSettings), 0, 'and no settings, no sweep');
  ok(lsHas('prospect-col-widths-deals') && !lsHas('nope'), 'lsHas tells a saved key from a missing one');
  globalThis.localStorage = realStorage;
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

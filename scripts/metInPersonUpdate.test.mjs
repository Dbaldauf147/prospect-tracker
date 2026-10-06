// Saving one contact's "Met In Person" answer must not put back an older
// copy of the map.
//
// Every writer used to spread its own render-time copy of
// settings.contactMetInPerson. The contact popup writes the dropdown when
// it is picked AND again when its HubSpot save comes back, so a save that
// started before the pick finished after it and restored the old map:
// the Yes just chosen was gone. metInPersonUpdate builds the write from the
// settings as they are when it runs (updateSettings calls it with them).
//
// Run: node scripts/metInPersonUpdate.test.mjs
import { readFileSync } from 'node:fs';
const { metInPersonUpdate, MET_YES, MET_NO, MET_HOLD } = await import('../src/utils/metInPerson.js');

let passed = 0, failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n  expected ${e}\n  actual   ${a}`); }
}

// A stand-in for updateSettings: applies each update to the live settings.
let live = { contactMetInPerson: { other: MET_HOLD } };
const apply = (u) => { const patch = typeof u === 'function' ? u(live) : u; if (patch) live = { ...live, ...patch }; };

// The reported sequence: a save captured the map, the user picked Yes,
// then the save landed. Built lazily, the late write can't undo the pick.
const lateWrite = metInPersonUpdate('42', MET_YES);   // created before the pick
apply(metInPersonUpdate('42', MET_YES));              // the pick
apply(metInPersonUpdate('7', MET_NO));                // another contact meanwhile
apply(lateWrite);                                     // the save comes back
check('a late write keeps every answer saved since', live.contactMetInPerson,
  { other: MET_HOLD, 42: MET_YES, 7: MET_NO });

check('booleans from older callers: true is Yes', metInPersonUpdate('1', true)({}), { contactMetInPerson: { 1: MET_YES } });
check('false is No', metInPersonUpdate('1', false)({}), { contactMetInPerson: { 1: MET_NO } });
check('the four answers pass through', metInPersonUpdate('1', 'hold')({}), { contactMetInPerson: { 1: MET_HOLD } });
check('no contact id writes nothing', metInPersonUpdate(null, MET_YES)({}), null);
check('no settings yet', metInPersonUpdate(5, 'asked')(undefined), { contactMetInPerson: { 5: 'asked' } });

// Every writer goes through it, and the Prospecting page no longer turns the
// answer into a boolean (which stored No and Hold off as Yes).
const files = [
  'src/hooks/useContactEditSettings.js',
  'src/components/ProspectModal/ProspectModal.jsx',
  'src/components/KeyContactsView/KeyContactsView.jsx',
  'src/components/OppsView2/OppsView2.jsx',
  'src/components/MarketingLeadsView/MarketingLeadsView.jsx',
  'src/components/DraftEmailView/DraftEmailView.jsx',
];
for (const f of files) {
  const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  check(`${f} spreads no copy of contactMetInPerson`, /contactMetInPerson:\s*\{\s*\.\.\./.test(src), false);
}
const modal = readFileSync(new URL('../src/components/ProspectModal/ProspectModal.jsx', import.meta.url), 'utf8');
check('the popup save writes the answer as it is now, not as it was', /onSaveMetInPerson\(savedCid, latest\.metInPerson\)/.test(modal), true);
const hook = readFileSync(new URL('../src/hooks/useUserSettings.js', import.meta.url), 'utf8');
check('updateSettings accepts a function of the current settings', /typeof updatesOrFn === 'function'[\s\S]{0,80}updatesOrFn\(settingsRef\.current/.test(hook), true);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

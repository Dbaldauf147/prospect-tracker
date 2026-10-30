// Assertion tests for where the big userSettings maps live
// (src/utils/settingsCodec.js). Plain Node. Run:
//   node scripts/settingsCodec.test.mjs
import {
  composeSettings, splitSettingsUpdates, splitPathUpdates, legacyKeysIn, keyDocData, keyDocValue,
  ENCODED_SETTINGS_KEYS, encodedFieldName,
} from '../src/utils/settingsCodec.js';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}
function throws(label, fn) {
  try { fn(); failed += 1; console.log(`FAIL ${label}: did not throw`); } catch { passed += 1; }
}

const tm = { p1: ['Acme Corp'], p2: [] };

// reading
check('a map comes from its own document', composeSettings({ cdmName: 'Dan' }, { targetMap: tm }), { cdmName: 'Dan', targetMap: tm });
check('a document from before any of this reads as it always did', composeSettings({ targetMap: tm }), { targetMap: tm });
check('the brief string form still reads', composeSettings({ targetMap_json: JSON.stringify(tm) }), { targetMap: tm });
check('its own document wins over the string form',
  composeSettings({ targetMap_json: JSON.stringify({ old: [] }) }, { targetMap: tm }), { targetMap: tm });
check('an old tab\'s plain entries are laid over its own document',
  composeSettings({ targetMap: { p3: ['New Co'] } }, { targetMap: tm }),
  { targetMap: { p1: ['Acme Corp'], p2: [], p3: ['New Co'] } });
check('a "drop this field" null on the settings document is not a value', composeSettings({ targetMap: null }, { targetMap: tm }), { targetMap: tm });
check('no settings document but a map: still settings', composeSettings(null, { ccMap: { a: 1 } }), { ccMap: { a: 1 } });
check('nothing at all: nothing', composeSettings(null, {}), null);
check('a key document round trip', keyDocValue(keyDocData(tm, 5)), tm);
const quiet = console.error; console.error = () => {};
check('a broken key document reads as missing', keyDocValue({ json: '{oops' }), undefined);
console.error = quiet;

// whole-key writes
check('a big map goes to its document, and the settings document drops its old copies',
  splitSettingsUpdates({ targetMap: tm, cdmName: 'Dan' }),
  { keys: { targetMap: tm }, main: { targetMap: null, cdmName: 'Dan', targetMap_json: null } });
check('deleting a big map deletes its document', splitSettingsUpdates({ ccMap: null }).keys, { ccMap: null });
check('other keys stay on the settings document', splitSettingsUpdates({ cdmName: 'Dan' }), { keys: {}, main: { cdmName: 'Dan' } });
check('a raw backup carrying the string form lands in the document too',
  splitSettingsUpdates({ targetMap_json: JSON.stringify(tm) }).keys, { targetMap: tm });

// path writes
const after = { targetMap: { ...tm, p3: ['New Co'] } };
check('a path into a big map writes the whole new map to its document',
  splitPathUpdates({ 'targetMap.p3': ['New Co'], 'other.x': 1 }, after),
  { keys: { targetMap: after.targetMap }, main: { 'other.x': 1, targetMap: null, targetMap_json: null } });
check('a path that sets the key outright needs nothing else', splitPathUpdates({ ccMap: { a: 1 } }).keys, { ccMap: { a: 1 } });
check('a path that deletes the key outright deletes its document', splitPathUpdates({ ccMap: null }).keys, { ccMap: null });
throws('a path into a big map without the whole map is refused, not written as a delete', () => splitPathUpdates({ 'targetMap.p3': ['x'] }));
throws('nor with settings that lack that map', () => splitPathUpdates({ 'targetMap.p3': ['x'] }, { cdmName: 'Dan' }));
check('paths outside the big maps stay on the settings document', splitPathUpdates({ 'portfolioStarredCols.a': true }), { keys: {}, main: { 'portfolioStarredCols.a': true } });

// the one-time move out on load
check('a settings document still holding maps: they are due to move', legacyKeysIn({ targetMap: tm, ccMap_json: '{}', cdmName: 'Dan' }), ['targetMap', 'ccMap']);
check('a settings document without them: nothing to do', legacyKeysIn({ cdmName: 'Dan' }), []);
check('a "drop this field" null is nothing to move', legacyKeysIn({ targetMap: null }), []);
check('no document, nothing to do', legacyKeysIn(null), []);

// every map kept apart is also on the exemption list, so a settings document
// still holding the old map form is covered while it moves
const ex = JSON.parse(readFileSync(new URL('../firestore.field-exemptions.json', import.meta.url), 'utf8'));
const exempt = new Set(ex.fieldOverrides.map(f => f.fieldPath));
check('every moved key is on the exemption list', ENCODED_SETTINGS_KEYS.filter(k => !exempt.has(k)), []);
check('the string-form field name', encodedFieldName('targetMap'), 'targetMap_json');
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
check('the security rules let you reach the maps\' documents', /match \/userSettings\/\{userId\}\/settingsKeys\/\{settingsKey\}/.test(rules), true);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

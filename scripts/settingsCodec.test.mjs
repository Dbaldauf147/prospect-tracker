// Assertion tests for how the big userSettings maps are stored
// (src/utils/settingsCodec.js). Plain Node. Run:
//   node scripts/settingsCodec.test.mjs
import {
  decodeSettingsDoc, encodeSettingsUpdates, encodePathUpdates, ENCODED_SETTINGS_KEYS, encodedFieldName, plainEncodedKeys,
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

// writing whole keys
check('a big map is written as its JSON string, and its map field dropped',
  encodeSettingsUpdates({ targetMap: tm, cdmName: 'Dan' }),
  { targetMap: null, cdmName: 'Dan', targetMap_json: JSON.stringify(tm) });
check('deleting a big map deletes both fields', encodeSettingsUpdates({ ccMap: null }), { ccMap: null, ccMap_json: null });
check('other keys go through untouched', encodeSettingsUpdates({ cdmName: 'Dan' }), { cdmName: 'Dan' });
check('a raw backup carrying the string is written the same way',
  encodeSettingsUpdates({ targetMap_json: JSON.stringify(tm) }),
  { targetMap: null, targetMap_json: JSON.stringify(tm) });

// reading
check('the string reads back as the map', decodeSettingsDoc({ targetMap_json: JSON.stringify(tm), cdmName: 'Dan' }), { cdmName: 'Dan', targetMap: tm });
check('a document saved before the change reads as it always did', decodeSettingsDoc({ targetMap: tm }), { targetMap: tm });
check('an old tab\'s plain entries are laid over the stored ones',
  decodeSettingsDoc({ targetMap_json: JSON.stringify(tm), targetMap: { p3: ['New Co'] } }),
  { targetMap: { p1: ['Acme Corp'], p2: [], p3: ['New Co'] } });
check('a round trip gives back what went in', decodeSettingsDoc(encodeSettingsUpdates({ listMappings: { a: { b: 1 } } })).listMappings, { a: { b: 1 } });
const quiet = console.error; console.error = () => {};
check('a broken string does not take the plain entries with it', decodeSettingsDoc({ ccMap_json: '{oops', ccMap: { a: 1 } }), { ccMap: { a: 1 } });
console.error = quiet;

// path writes
const after = { targetMap: { ...tm, p3: ['New Co'] } };
check('a path into a big map writes the whole new map',
  encodePathUpdates({ 'targetMap.p3': ['New Co'], 'other.x': 1 }, after),
  { 'other.x': 1, targetMap_json: JSON.stringify(after.targetMap), targetMap: null });
check('a path that sets the key outright needs nothing else', encodePathUpdates({ ccMap: { a: 1 } }), { ccMap_json: '{"a":1}', ccMap: null });
check('a path that deletes the key outright deletes both fields', encodePathUpdates({ ccMap: null }), { ccMap_json: null, ccMap: null });
throws('a path into a big map without the whole map is refused, not written as a delete', () => encodePathUpdates({ 'targetMap.p3': ['x'] }));
throws('nor with settings that lack that map', () => encodePathUpdates({ 'targetMap.p3': ['x'] }, { cdmName: 'Dan' }));
check('paths outside the big maps pass through', encodePathUpdates({ 'portfolioStarredCols.a': true }), { 'portfolioStarredCols.a': true });

// every map stored as text is also on the exemption list, so a document
// still holding the old map form is covered by both while it migrates
const ex = JSON.parse(readFileSync(new URL('../firestore.field-exemptions.json', import.meta.url), 'utf8'));
const exempt = new Set(ex.fieldOverrides.map(f => f.fieldPath));
check('every encoded key is on the exemption list', ENCODED_SETTINGS_KEYS.filter(k => !exempt.has(k)), []);
check('the stored field name', encodedFieldName('targetMap'), 'targetMap_json');

// the one-time move to text on load
check('a document from before the change: its big maps are due to move', plainEncodedKeys({ targetMap: tm, ccMap: {}, cdmName: 'Dan' }), ['targetMap', 'ccMap']);
check('a moved document: nothing left to do', plainEncodedKeys({ targetMap_json: '{}', cdmName: 'Dan' }), []);
check('an old tab\'s plain field is picked up too', plainEncodedKeys({ targetMap_json: '{}', targetMap: { p9: [] } }), ['targetMap']);
check('no document, nothing to do', plainEncodedKeys(null), []);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

// Assertion tests for the Firestore index-exemption release. Plain Node,
// no framework. Run:
//   node scripts/deployFirestoreIndexExemptions.test.mjs
//
// What has to hold:
//   * the exemptions file in the repo parses, and targetMap is in it (the
//     field that took userSettings past 40,000 index entries),
//   * a bad entry is refused rather than sent,
//   * a field already exempt is left alone, and one on the database
//     default (or reverting to it) is changed,
//   * importing the script does not attempt a release.
import { readFileSync } from 'node:fs';
import { exemptionsFrom, fieldName, isExempt, describeApiError } from './deployFirestoreIndexExemptions.mjs';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
function throws(fn, name) {
  try { fn(); failed++; console.log(`FAIL  ${name} (did not throw)`); } catch { passed++; console.log(`PASS  ${name}`); }
}

const file = exemptionsFrom(JSON.parse(readFileSync(new URL('../firestore.field-exemptions.json', import.meta.url), 'utf8')));
eq(file.some(e => e.collectionGroup === 'userSettings' && e.fieldPath === 'targetMap'), true, 'the repo file exempts userSettings.targetMap');
eq(file.every(e => e.collectionGroup === 'userSettings'), true, 'every exemption is on userSettings');

eq(exemptionsFrom({ fieldOverrides: [{ collectionGroup: 'userSettings', fieldPath: 'a' }, { collectionGroup: 'userSettings', fieldPath: 'a' }] }).length, 1, 'duplicates collapse');
eq(exemptionsFrom({}), [], 'no list, no exemptions');
throws(() => exemptionsFrom({ fieldOverrides: [{ collectionGroup: 'userSettings', fieldPath: 'has space' }] }), 'a field path that needs quoting is refused');
throws(() => exemptionsFrom({ fieldOverrides: [{ fieldPath: 'targetMap' }] }), 'a missing collection group is refused');

eq(fieldName('tracker-3161a', { collectionGroup: 'userSettings', fieldPath: 'targetMap' }),
  'projects/tracker-3161a/databases/(default)/collectionGroups/userSettings/fields/targetMap', 'field name');

eq(isExempt({ indexConfig: { usesAncestorConfig: true, indexes: [{ order: 'ASCENDING' }] } }), false, 'database default: not exempt');
eq(isExempt({ indexConfig: { usesAncestorConfig: false, indexes: [] } }), true, 'own empty config: exempt');
eq(isExempt({ indexConfig: { usesAncestorConfig: false } }), true, 'own config with no indexes listed: exempt');
eq(isExempt({ indexConfig: { usesAncestorConfig: false, indexes: [{ order: 'ASCENDING' }] } }), false, 'own config that still indexes: not exempt');
eq(isExempt({ indexConfig: { usesAncestorConfig: false, indexes: [], reverting: true } }), false, 'reverting to the default: not exempt');
eq(isExempt({}), false, 'no config: not exempt');

eq(describeApiError(403, 'denied', 'p').includes('roles/datastore.indexAdmin'), true, 'a 403 names the role to grant');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

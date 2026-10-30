// Assertion tests for the index entry estimate behind the "too many index
// entries" save message (src/utils/settingsDocSize.js). Plain Node. Run:
//   node scripts/settingsIndexEntries.test.mjs
import { readFileSync } from 'node:fs';
import {
  valueIndexEntries, settingsIndexReport, isIndexEntryLimitError, indexLimitMessage, FIRESTORE_INDEX_ENTRY_LIMIT,
} from '../src/utils/settingsDocSize.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

check('a plain value is two entries (ascending and descending)', valueIndexEntries('x'), 2);
check('a map costs itself plus each key', valueIndexEntries({ a: 1, b: 'x' }), 6);
check('an array costs itself plus each distinct element', valueIndexEntries(['a', 'b', 'a']), 4);
check('a company-keyed map grows per company', valueIndexEntries({ p1: ['Acme'], p2: ['Beta'] }), 2 + 3 + 3);

const settings = {
  targetMap: Object.fromEntries(Array.from({ length: 15000 }, (_, i) => [`p${i}`, [`Co ${i}`]])),
  small: { a: 1 },
  companySiteLists: { huge: 'stored elsewhere' },
};
const r = settingsIndexReport(settings, new Set(['targetMap']));
check('the biggest key comes first and says it is exempt', [r.keys[0].key, r.keys[0].exempt], ['targetMap', true]);
check('exempted keys are left out of the total', r.total, 4);
check('but counted in the total without exemptions', r.totalIfNoExemptions > FIRESTORE_INDEX_ENTRY_LIMIT, true);
check('keys stored off the document are not counted', r.keys.some(k => k.key === 'companySiteLists'), false);

check('the Firestore error is recognised', isIndexEntryLimitError(new Error('too many index entries for entity /userSettings/x')), true);
check('other errors are not', isIndexEntryLimitError(new Error('permission denied')), false);

const live = indexLimitMessage(r);
check('fits once exempt: the message says the exemptions are not live', /not live on Firestore yet/.test(live), true);
const over = indexLimitMessage(settingsIndexReport(settings, new Set()));
check('over even with exemptions: the message says a key needs adding', /needs adding/.test(over), true);
check('the message names the key', /targetMap - about/.test(over), true);
check('the message has no em dash', /—/.test(live + over), false);

// The client reads the same exemption list the build releases.
const ex = JSON.parse(readFileSync(new URL('../firestore.field-exemptions.json', import.meta.url), 'utf8'));
check('the exemption list covers targetMap', ex.fieldOverrides.some(f => f.fieldPath === 'targetMap'), true);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

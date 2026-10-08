// Assertion tests for reading the Target Accounts workbook on the server
// (api/_lib/firestoreChunks.js loadTargetAccounts). Plain Node. Run:
//   node scripts/targetAccountsChunks.test.mjs
//
// The page writes it through utils/chunkedDoc once it outgrows Firestore's
// 1 MiB document cap: an empty `json` and a chunkCount on the parent, the
// JSON in `chunks/{i}` under the field `s`. The scheduled PE Monthly email
// reads it with no page open, so it has to take that layout and the two
// older ones, or a big workbook reads as no workbook and every Tier / CDM
// on the email goes blank.
import { loadTargetAccounts } from '../api/_lib/firestoreChunks.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

// Just enough of firebase-admin: collection(name).doc(id) with get() and
// a `chunks` subcollection.
function fakeDb(parent, chunks = []) {
  const snap = (data) => ({ exists: data != null, data: () => data });
  const ref = {
    get: async () => snap(parent),
    collection: () => ({
      get: async () => ({ forEach: (fn) => chunks.forEach((c, i) => fn({ id: String(i), data: () => c })) }),
    }),
  };
  return { collection: () => ({ doc: () => ref }) };
}

const workbook = { sheetNames: ['Targets'], sheets: { Targets: { headers: ['Account'], records: [{ Account: 'Prologis' }] } } };
const json = JSON.stringify(workbook);

check('chunked: joined from the `s` field of each chunk',
  await loadTargetAccounts(fakeDb({ chunkCount: 2, json: '' }, [{ s: json.slice(0, 20) }, { s: json.slice(20) }]), 'u'), workbook);
check('inline: the JSON under `json`',
  await loadTargetAccounts(fakeDb({ chunkCount: 0, json }), 'u'), workbook);
check('the pre-chunking layout (no chunkCount) still reads',
  await loadTargetAccounts(fakeDb({ json, updatedAt: '2026-01-01' }), 'u'), workbook);
check('the oldest layout, the workbook as the document',
  await loadTargetAccounts(fakeDb(workbook), 'u'), workbook);
check('no document, no workbook', await loadTargetAccounts(fakeDb(null), 'u'), null);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

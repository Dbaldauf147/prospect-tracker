// Assertion tests for the full-backup file format. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/fullBackup.test.mjs
//
// What's worth holding here is the part a user only finds out about when
// they need it: that everything the app stores survives the round trip
// through JSON (Blobs, typed arrays, Dates — none of which JSON has a
// shape for), that a value which CANNOT survive is recorded as skipped
// rather than silently written back as an empty object, and that a restore
// re-addresses keys to whoever is signed in now instead of the uid the
// backup happened to be taken under. The collect / restore halves need
// IndexedDB and Firestore and are exercised in the browser.
import {
  APP_DB, FILES_DB, FULL_BACKUP_FORMAT, FULL_BACKUP_VERSION,
  backupFileName, decodeValue, encodeValue, isFullBackupEnvelope,
  planLocalRestore, summarizeBackup,
} from '../src/utils/fullBackup.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}
function same(label, actual, expected) {
  check(label, JSON.stringify(actual), JSON.stringify(expected));
}

// A round trip that goes through the file, not just through the pair of
// functions: encode, stringify, parse, decode. A value that only survives
// while it stays in memory is no backup at all.
async function roundTrip(value, ctx = { skipped: [] }) {
  return decodeValue(JSON.parse(JSON.stringify(await encodeValue(value, ctx))));
}

// --- plain values ----------------------------------------------------------

same('strings, numbers and booleans survive', await roundTrip({ a: 'x', b: 2, c: true, d: null }),
  { a: 'x', b: 2, c: true, d: null });
same('nested arrays and objects survive', await roundTrip({ rows: [{ id: 1, tags: ['a', 'b'] }] }),
  { rows: [{ id: 1, tags: ['a', 'b'] }] });

// JSON turns Infinity and NaN into null, which would read back as a real
// value the app never stored. They're skipped instead, with a note.
const numberCtx = { skipped: [] };
check('a non-finite number does not come back as null', await roundTrip(Infinity, numberCtx), null);
check('...and is recorded as skipped', numberCtx.skipped.length, 1);

// --- the types JSON has no shape for ---------------------------------------

const date = await roundTrip(new Date('2026-03-04T05:06:07.000Z'));
check('a Date comes back a Date', date instanceof Date, true);
check('...with its time intact', date.toISOString(), '2026-03-04T05:06:07.000Z');

const bytes = await roundTrip(new Uint8Array([0, 1, 250, 255]));
check('a typed array comes back typed', bytes instanceof Uint8Array, true);
same('...with its bytes intact', [...bytes], [0, 1, 250, 255]);

const buf = await roundTrip(new Uint8Array([7, 8, 9]).buffer);
check('an ArrayBuffer comes back an ArrayBuffer', buf instanceof ArrayBuffer, true);
same('...with its bytes intact', [...new Uint8Array(buf)], [7, 8, 9]);

// The attachments on a Market Update and the RFP workbooks on an opp are
// Blobs, which is the whole reason the encoding exists.
const blob = await roundTrip(new Blob(['hello backup'], { type: 'text/plain' }));
check('a Blob comes back a Blob', blob instanceof Blob, true);
check('...with its type', blob.type, 'text/plain');
check('...and its bytes', await blob.text(), 'hello backup');

const map = await roundTrip(new Map([['k', [1, 2]]]));
check('a Map comes back a Map', map instanceof Map, true);
same('...with its entries', [...map.entries()], [['k', [1, 2]]]);
const set = await roundTrip(new Set(['a', 'b']));
check('a Set comes back a Set', set instanceof Set, true);
same('...with its items', [...set], ['a', 'b']);

// --- what can't be saved ---------------------------------------------------

// The Call Recordings page keeps a FileSystemDirectoryHandle in IndexedDB.
// Nothing can serialize it; the file has to SAY so rather than quietly
// storing `{}` and restoring a folder that points nowhere.
class DirectoryHandleish { constructor() { this.kind = 'directory'; } }
const handleCtx = { skipped: [] };
const encodedHandle = await encodeValue({ folder: new DirectoryHandleish(), name: 'calls' }, handleCtx);
check('an unserializable value is not written as data', encodedHandle.folder.__ptBackup, 'skipped');
check('...and its neighbours are still saved', encodedHandle.name, 'calls');
check('...and it is reported once', handleCtx.skipped.length, 1);
check('...naming where it was', handleCtx.skipped[0].path, 'folder');
check('...and what it was', handleCtx.skipped[0].reason.includes('DirectoryHandleish'), true);
check('a skipped value decodes to null, not an empty object',
  decodeValue(JSON.parse(JSON.stringify(encodedHandle))).folder, null);

// --- recognising a backup file ---------------------------------------------

const envelope = {
  format: FULL_BACKUP_FORMAT,
  version: FULL_BACKUP_VERSION,
  createdAt: Date.parse('2026-08-31T14:05:00Z'),
  uid: 'uid-old',
  email: 'baldaufdanwork@gmail.com',
  localStorage: {
    scoped: { 'deals-list-override': '[{"Client Name":"Acme"}]', 'clients-notes-map': '{}' },
    shared: { 'utility-lookup:vendor-decisions': '{"a":1}', 'u:someone-else:secret': 'no' },
  },
  indexedDb: {
    [APP_DB]: { 'bfo-activity': { keyPath: null, records: [{ key: 'data', value: { rows: [] } }] } },
    [FILES_DB]: { 'uploaded-lists': { keyPath: 'key', records: [{ key: 'CDP', value: { key: 'CDP', rows: [] } }] } },
  },
  firestore: { prospects: [{ id: 'p1' }, { id: 'p2' }], userSettings: { cdmName: 'Dan' }, opps2: { records: [{ id: 1 }] } },
  manifest: { skipped: [{ path: 'x', reason: 'y' }], bytes: 4096 },
};

check('a backup file is recognised', isFullBackupEnvelope(envelope), true);
check('a settings backup is not mistaken for one', isFullBackupEnvelope({ companyOpportunities: {} }), false);
check('nor is junk', isFullBackupEnvelope(null), false);

const summary = summarizeBackup(envelope);
check('the summary counts local keys', summary.localKeys, 4);
check('the summary counts stored records', summary.idbRecords, 2);
check('the summary counts companies', summary.prospects, 2);
check('the summary counts opps', summary.opps2Records, 1);
check('the summary sees the settings document', summary.hasSettings, true);
check('the summary carries what was skipped', summary.skipped, 1);
check('the summary of a non-backup is nothing', summarizeBackup({}), null);

// --- the restore plan ------------------------------------------------------

const plan = planLocalRestore(envelope, 'uid-new');
const byKey = Object.fromEntries(plan.localStorage.map(i => [i.key, i]));

// The point of storing keys unprefixed: a backup taken under one uid has
// to land under whoever is signed in when it is restored.
check('a scoped key is re-addressed to the signed-in user',
  !!byKey['u:uid-new:deals-list-override'], true);
check('...and not left under the old one', !!byKey['u:uid-old:deals-list-override'], false);
check('...keeping the mirror name it is published under',
  byKey['u:uid-new:deals-list-override'].mirrorKey, 'deals-list-override');
check('an unscoped key restores as itself', !!byKey['utility-lookup:vendor-decisions'], true);
check('...and carries no mirror name', byKey['utility-lookup:vendor-decisions'].mirrorKey, null);

// A hand-edited file must not be able to write into another account's slot.
check('another account\'s key is refused', !!byKey['u:someone-else:secret'], false);
check('...and the refusal is reported', plan.skipped.length, 1);

const app = plan.idb.find(r => r.db === APP_DB);
check('a db.js record is partitioned under the signed-in user', app.key, 'uid-new:data');
check('...while keeping the name its mirror is published under', app.rawKey, 'data');
check('...and its out-of-line key path', app.keyPath, null);
const files = plan.idb.find(r => r.db === FILES_DB);
check('an uploaded list keeps its own key', files.key, 'CDP');
check('...and its in-line key path', files.keyPath, 'key');

// Signed out (or a backup restored before auth resolves) still has to go
// somewhere predictable rather than dropping the data.
check('with no user, scoped keys land in the anonymous slot',
  !!Object.fromEntries(planLocalRestore(envelope, null).localStorage.map(i => [i.key, i]))['u:_anon:deals-list-override'], true);

check('the file is named for the person and the day',
  backupFileName(envelope).startsWith('prospect-tracker-backup-baldaufdanwork-'), true);
check('...and is a .json', backupFileName(envelope).endsWith('.json'), true);

console.log(failures === 0 ? '\nAll passed.' : `\n${failures} FAILED.`);
process.exit(failures === 0 ? 0 : 1);

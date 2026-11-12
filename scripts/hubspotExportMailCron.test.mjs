// The scheduled "Dan's Company Export" check (api/hubspot-export-mail.js:
// runForUser, runScheduled, the status action, the kept refresh token) and
// the server's chunked writer, with Firestore, Graph and the CSV host faked.
//
// What has to hold:
//   * a browser check that sends a refresh token leaves it for the cron,
//   * the cron loads the email into Hubspot Mapping keeping Dan's links,
//     folds it into se-hubspot keeping colleagues' companies, keeps the
//     rotated refresh token and logs what it did,
//   * the same email again changes nothing, a newer hand-dropped file is
//     kept, an expired sign-in is logged with what to do about it,
//   * writeChunkedValue writes what readChunkedValue (and so the browser's
//     chunkedDoc) reads back, big or small.
import assert from 'node:assert/strict';

process.env.OUTLOOK_CLIENT_ID = 'id';
process.env.OUTLOOK_CLIENT_SECRET = 'secret';
const { handler, runForUser, runScheduled } = await import('../api/hubspot-export-mail.js');
const { readChunkedValue, writeChunkedValue } = await import('../api/_lib/firestoreChunks.js');
const { applyToMapping } = await import('../src/utils/hubspotExportMailApply.js');

let passed = 0;
const ok = (name) => { passed++; console.log(`PASS  ${name}`); };

// ---- A small in-memory Firestore ----------------------------------------
function fakeDb() {
  const docs = new Map();
  const writes = [];
  const docRef = (path) => ({
    path,
    id: path.split('/').pop(),
    async get() { const d = docs.get(path); return { exists: !!d, data: () => d, id: path.split('/').pop() }; },
    async set(value, opts) {
      writes.push(path);
      const prev = docs.get(path) || {};
      if (opts?.merge) {
        const next = { ...prev };
        for (const [k, v] of Object.entries(value)) next[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? { ...(prev[k] || {}), ...v } : v;
        docs.set(path, next);
      } else docs.set(path, { ...value });
    },
    async delete() { docs.delete(path); },
    collection: (name) => colRef(`${path}/${name}`),
  });
  const colRef = (path) => ({
    doc: (id) => docRef(`${path}/${id}`),
    async get() {
      const depth = path.split('/').length + 1;
      const found = [...docs.keys()].filter(k => k.startsWith(`${path}/`) && k.split('/').length === depth);
      const list = found.map(k => ({ id: k.split('/').pop(), data: () => docs.get(k), ref: docRef(k) }));
      return { docs: list, forEach: (fn) => list.forEach(fn) };
    },
  });
  return {
    docs, writes,
    collection: colRef,
    batch() {
      const ops = [];
      return {
        set: (ref, v) => ops.push(() => ref.set(v)),
        delete: (ref) => ops.push(() => ref.delete()),
        commit: async () => { for (const op of ops) await op(); },
      };
    },
  };
}

// ---- Microsoft and HubSpot ----------------------------------------------
const csvUrl = 'https://app.hubspot.com/export/file.csv?token=1';
const csv = 'Record ID,Company name,Company Domain Name,Company owner,Lifecycle Stage\n101,Acme,acme.com,Dan Baldauf,Customer\n102,Beta,,Dan Baldauf,Lead\n';
let mail = { id: 'm2', subject: "Dan's Company Export", receivedDateTime: '2026-11-12T14:32:00Z' };
let refreshDead = false;
const refreshedWith = [];
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  if (url.includes('/oauth2/v2.0/token')) {
    refreshedWith.push(new URLSearchParams(String(init.body)).get('refresh_token'));
    if (refreshDead) return json({ error: 'invalid_grant' }, 400);
    return json({ access_token: 'fresh', refresh_token: 'rotated', expires_in: 3600 });
  }
  if (url.includes('graph.microsoft.com')) {
    if (init.headers?.Authorization === 'Bearer stale') return json({}, 401);
    if (url.includes('/me/messages/')) return json({ ...mail, body: { content: `<a href="${csvUrl}">Download CSV</a>` } });
    return json({ value: [mail] });
  }
  if (url === csvUrl) return new Response(csv, { headers: { 'content-type': 'text/csv' } });
  throw new Error(`unexpected fetch ${url}`);
};

function call(req, auth, db) {
  return new Promise((resolve) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    handler({ method: 'GET', headers: {}, query: {}, ...req }, res, auth, { db });
  });
}

const UID = 'dan';
const db = fakeDb();
const mapPath = `lookupTables/${UID}/items/hubspot-mapping`;
const sePath = `lookupTables/${UID}/items/se-hubspot`;
// What the browser had stored: an older drop with a link Dan made, and a
// colleague's company in se-hubspot.
db.docs.set(mapPath, { chunkCount: 0, json: JSON.stringify({ companies: [{ id: '101', name: 'Acme old' }], links: { acct1: '101' }, meta: { file: 'old.zip', at: '2026-11-01T00:00:00Z' } }) });
db.docs.set(sePath, { chunkCount: 0, json: JSON.stringify({ companies: [{ id: '900', name: 'Colleague Co' }], contacts: [{ id: 'c1' }], overrides: {}, meta: {} }) });

// ---- A browser check leaves its refresh token -----------------------------
{
  const out = await call({ headers: { 'x-ms-token': 'stale', 'x-ms-refresh-token': 'browser-r' }, query: { rows: '1' } }, { uid: UID }, db);
  assert.equal(out.code, 200);
  assert.equal(out.body.found, true);
  assert.equal(db.docs.get(`integrationTokens/${UID}`)?.outlookExport?.refreshToken, 'rotated');
  ok('a browser check keeps the newest refresh token for the scheduled check');

  const anon = fakeDb();
  await call({ headers: { 'x-ms-token': 'good', 'x-ms-refresh-token': 'r' } }, null, anon);
  assert.equal(anon.docs.size, 0);
  ok('without a signed-in caller nothing is kept');

  const none = await call({ headers: {} }, { uid: UID }, db);
  assert.equal(none.code, 401);
  assert.equal(none.body.error, 'Outlook is not connected.');
  ok('no tokens at all says Outlook is not connected');
}

// ---- The cron -----------------------------------------------------------
{
  const results = await runScheduled(db);
  assert.equal(results.length, 1);
  const r = results[0];
  assert.equal(r.uid, UID);
  assert.equal(r.ok, true, r.message);
  assert.match(r.message, /Loaded the 11\/12\/2026 email: 2 HubSpot companies\./);
  assert.equal(refreshedWith.at(-1), 'rotated', 'the cron signs in with the kept token');

  const mapping = await readChunkedValue(db.collection('lookupTables').doc(UID).collection('items').doc('hubspot-mapping'), { field: 's' });
  assert.deepEqual(mapping.companies.map(c => [c.id, c.name, c.lifecycle]), [['101', 'Acme', 'Customer'], ['102', 'Beta', 'Lead']]);
  assert.deepEqual(mapping.links, { acct1: '101' });
  assert.equal(mapping.meta.mailId, 'm2');
  assert.equal(db.docs.get(mapPath).companies, 2, 'parent carries the count, as the browser writes it');
  ok('the cron replaces the Mapping companies and keeps the links');

  const se = await readChunkedValue(db.collection('lookupTables').doc(UID).collection('items').doc('se-hubspot'), { field: 's' });
  assert.deepEqual(se.companies.map(c => c.id).sort(), ['101', '102', '900']);
  assert.deepEqual(se.contacts, [{ id: 'c1' }]);
  assert.equal(se.meta.companiesMailId, 'm2');
  assert.match(r.seHubspot.message, /2 new, 0 refreshed/);
  ok('the cron merges into se-hubspot, keeping the colleague and the contacts');

  const log = db.docs.get(`hubspotExportMail/${UID}`);
  assert.equal(log.ok, true);
  const status = await call({ query: { action: 'status' } }, { uid: UID }, db);
  assert.equal(status.body.scheduled, true);
  assert.equal(status.body.last.message, r.message);
  ok('the run is logged and the status action hands it back');

  db.writes.length = 0;
  const again = await runForUser(db, UID, 'rotated');
  assert.match(again.message, /^Up to date with the 11\/12\/2026 email\.$/);
  assert.deepEqual(db.writes.filter(p => p.startsWith('lookupTables')), []);
  ok('the same email again writes nothing');

  refreshDead = true;
  const dead = await runForUser(db, UID, 'rotated');
  assert.equal(dead.ok, false);
  assert.match(dead.message, /expired\. Click Connect Outlook/);
  assert.equal(dead.message.includes('—'), false);
  refreshDead = false;
  ok('an expired sign-in is logged with what to do');

  const signedOut = await call({ query: { action: 'status' } }, null, db);
  assert.equal(signedOut.code, 401);
  ok('status needs a signed-in caller');
}

// ---- A hand-dropped file newer than the email is kept ----------------------
{
  const res = applyToMapping({ companies: [{ id: '1', name: 'X' }], links: {}, meta: { file: 'mine.zip', at: '2026-11-13T00:00:00Z' } },
    { messageId: 'm3', subject: "Dan's Company Export", receivedAt: '2026-11-12T14:32:00Z', rows: [] });
  assert.equal(res.next, null);
  assert.match(res.message, /^Kept mine\.zip from 11\/12\/2026|^Kept mine\.zip from 11\/13\/2026/);
  ok('a newer hand-dropped file is kept');
}

// ---- writeChunkedValue round trip -------------------------------------------
{
  const cdb = fakeDb();
  const ref = cdb.collection('lookupTables').doc('u').collection('items').doc('big');
  const big = { rows: Array.from({ length: 6000 }, (_, i) => ({ i, name: `Company ${i} é中\u{1F600}`.repeat(20) })) };
  await writeChunkedValue(cdb, ref, big, { meta: { n: 6000 } });
  const parent = cdb.docs.get('lookupTables/u/items/big');
  assert.ok(parent.chunkCount > 1, 'big value is chunked');
  assert.equal(parent.n, 6000);
  for (let i = 0; i < parent.chunkCount; i++) {
    assert.ok(Buffer.byteLength(cdb.docs.get(`lookupTables/u/items/big/chunks/${i}`).s, 'utf8') < 1024 * 1024, `chunk ${i} under 1 MiB`);
  }
  assert.deepEqual(await readChunkedValue(ref, { field: 's' }), big);
  const before = parent.chunkCount;
  await writeChunkedValue(cdb, ref, { small: true });
  assert.equal(cdb.docs.get('lookupTables/u/items/big').chunkCount, 0);
  assert.equal(cdb.docs.has(`lookupTables/u/items/big/chunks/${before - 1}`), false, 'old chunks dropped');
  assert.deepEqual(await readChunkedValue(ref, { field: 's' }), { small: true });
  ok('writeChunkedValue round-trips big and small values and drops stale chunks');
}

console.log(`\n${passed} passed`);

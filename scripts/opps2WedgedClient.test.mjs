// The Opps auto-save, with the Firestore SDK dead.
//
// The report was the Opps tab's own sync banner:
//
//   ⚠ Cloud sync failed: your changes are saved on this device only.
//   Reason: FIRESTORE (12.11.0) INTERNAL ASSERTION FAILED: Unexpected
//   state (ID: b815) CONTEXT: {"Pc":"Error: FIRESTORE (12.11.0) INTERNAL
//   ASSERTION FAILED: Unexpected state (ID: b7de) CONTEXT:
//   {\"batchId\":5526}"}
//
// Same crash as the settings save (see userSettingsWedgedClient.test.mjs),
// a different inner assertion: b7de is a mutation batch the local store
// could not find, and b815 is what every SDK call gets for the rest of the
// tab's life afterwards. The banner's advice — check your connection, then
// retry — was wrong on both counts: the connection was fine, and retrying
// through a dead async queue can only fail again. Meanwhile the WHOLE opps
// dataset was stranded in IndexedDB.
//
// So every Firestore step in opps2Store now has an HTTPS twin. These tests
// hold that in place.
//
// Run: node scripts/opps2WedgedClient.test.mjs
import { register } from 'node:module';
register('./stubs/loader.mjs', import.meta.url);

const fs = await import('./stubs/firestore.mjs');
const store = await import('../src/utils/opps2Store.js');
const health = await import('../src/utils/firestoreClientHealth.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}

const DOC = 'opps2Data/u1';
const DOCS = 'https://firestore.googleapis.com/v1/projects/test-project/databases/(default)/documents';

// The error exactly as it arrived: the outer assertion quoting the inner
// one that killed the queue.
const wedgedError = () => new Error(
  'FIRESTORE (12.11.0) INTERNAL ASSERTION FAILED: Unexpected state (ID: b815) '
  + 'CONTEXT: {"Pc":"Error: FIRESTORE (12.11.0) INTERNAL ASSERTION FAILED: '
  + 'Unexpected state (ID: b7de) CONTEXT: {\\"batchId\\":5526}"}',
);

// A fake REST endpoint that remembers documents, so a save and the load
// after it are talking about the same database.
let restCalls = [];
let restDocs = new Map();
const realFetch = globalThis.fetch;

const pathOf = (url) => decodeURIComponent(new URL(url).pathname.split('/documents/')[1] || '');

function stubFetch({ failStatus = 0, failOn = null } = {}) {
  restCalls = [];
  globalThis.fetch = async (url, init) => {
    const method = init?.method || 'GET';
    const path = pathOf(url);
    const body = init?.body ? JSON.parse(init.body) : null;
    restCalls.push({ url: String(url), method, path, body });
    const reply = (status, payload) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    });
    if (failStatus && (!failOn || failOn(path, method))) {
      return reply(failStatus, { error: { message: 'nope' } });
    }
    if (method === 'PATCH') {
      const mask = new URL(url).searchParams.getAll('updateMask.fieldPaths');
      const prior = restDocs.get(path) || {};
      const next = mask.length ? { ...prior } : {};
      for (const field of mask) {
        if (body?.fields && field in body.fields) next[field] = body.fields[field];
        else delete next[field]; // masked but absent from the body = delete
      }
      if (!mask.length) Object.assign(next, body?.fields || {});
      restDocs.set(path, next);
      return reply(200, { fields: next });
    }
    if (method === 'DELETE') { restDocs.delete(path); return reply(200, {}); }
    // GET: an odd number of path segments is a collection (listing), an
    // even number is one document.
    if (path.split('/').length % 2 === 1) {
      const prefix = `${path}/`;
      const documents = [...restDocs.entries()]
        .filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
        .map(([p, fields]) => ({ name: `projects/test-project/databases/(default)/documents/${p}`, fields }));
      return reply(200, { documents });
    }
    const fields = restDocs.get(path);
    return fields ? reply(200, { fields }) : reply(404, {});
  };
}
const restore = () => { globalThis.fetch = realFetch; };

function fresh() {
  fs.reset();
  health.__resetClientHealth();
  restCalls = [];
  restDocs = new Map();
}

const maskOf = (call) => [...new URL(call.url).searchParams.getAll('updateMask.fieldPaths')];
const dataset = (n, pad = '') => ({
  headers: ['Company'],
  records: Array.from({ length: n }, (_, i) => ({ _id: String(i), Company: `Co ${i}${pad}` })),
});

// ── The assertion this report carried ──────────────────────────────────
{
  ok(health.isClientWedgedError(wedgedError()), 'the b815/b7de assertion is recognised as a crashed client');
  ok(health.isClientWedgedError(new Error('FIRESTORE (12.11.0) INTERNAL ASSERTION FAILED: Unexpected state (ID: b7de) CONTEXT: {"batchId":5526}')),
    'so is the inner batch assertion on its own');
}

// ── The auto-save that used to be lost ─────────────────────────────────
{
  fresh();
  stubFetch();
  fs.failOn(/^opps2Data\/u1/, wedgedError()); // reads and writes alike

  const ts = await store.saveOpps2ToFirestore('u1', dataset(3));

  ok(Number.isFinite(ts) && ts > 0, 'the save reports a timestamp rather than throwing');
  const write = restCalls.find((c) => c.method === 'PATCH');
  ok(!!write, 'a REST write was made');
  ok(write.path === DOC, 'against the user\'s opps document');
  ok(write.url.startsWith(`${DOCS}/opps2Data/u1`), 'on the Firestore REST endpoint');
  const saved = JSON.parse(write.body.fields.json.stringValue);
  ok(saved.records.length === 3 && saved.records[0].Company === 'Co 0', 'carrying the whole dataset');
  ok(saved._updatedAt === ts, 'stamped with the timestamp the caller was handed');
  ok(health.isClientWedged(), 'and the client is marked crashed for the rest of the tab');
  restore();
}

// ── The mask keeps it a merge ──────────────────────────────────────────
//
// A PATCH with no update mask REPLACES the document. The parent doc also
// holds the chunk bookkeeping, so falling back that way would be a
// different kind of data loss.
{
  fresh();
  stubFetch();
  fs.failOn(/^opps2Data\/u1/, wedgedError());

  await store.saveOpps2ToFirestore('u1', dataset(1));
  const mask = maskOf(restCalls.find((c) => c.method === 'PATCH'));
  ok(mask.length === 3, 'the patch names exactly the fields it writes');
  ok(mask.includes('json') && mask.includes('chunkCount') && mask.includes('updatedAt'),
    'the payload, the chunk count and the timestamp — nothing else');
  restore();
}

// ── Once crashed, stop asking the SDK ──────────────────────────────────
{
  fresh();
  stubFetch();
  fs.failOn(/^opps2Data\/u1/, wedgedError());
  await store.saveOpps2ToFirestore('u1', dataset(1));

  const before = fs.calls.length;
  await store.saveOpps2ToFirestore('u1', dataset(2));
  ok(fs.calls.length === before, 'the next save makes no SDK call at all');
  const last = restCalls.filter((c) => c.method === 'PATCH').pop();
  ok(JSON.parse(last.body.fields.json.stringValue).records.length === 2, 'and still writes the newer dataset');
  restore();
}

// ── Reading it back ────────────────────────────────────────────────────
//
// Hydration and the guarded flush both read before they write. A read
// that can't happen turns the flush into a blind overwrite.
{
  fresh();
  stubFetch();
  fs.failOn(/^opps2Data\/u1/, wedgedError());

  await store.saveOpps2ToFirestore('u1', dataset(4));
  const loaded = await store.loadOpps2FromFirestore('u1');
  ok(loaded?.records?.length === 4, 'the dataset loads back over HTTPS');
  ok(loaded.records[3].Company === 'Co 3', 'with its rows intact');
  restore();
}

// ── A dataset past the single-document budget ──────────────────────────
//
// Over ~950 KB the payload is split across a `chunks` subcollection, which
// the SDK does as one batch commit. REST has no batch, so the order has to
// carry the atomicity: every chunk first, the parent's chunkCount last.
{
  fresh();
  stubFetch();
  fs.failOn(/^opps2Data\/u1/, wedgedError());

  const big = dataset(1200, 'x'.repeat(900)); // comfortably over the budget
  await store.saveOpps2ToFirestore('u1', big);

  const chunkWrites = restCalls.filter((c) => c.method === 'PATCH' && c.path.includes('/chunks/'));
  const parentWrite = restCalls.filter((c) => c.method === 'PATCH' && c.path === DOC).pop();
  ok(chunkWrites.length >= 2, 'the payload went up as several chunk documents');
  ok(restCalls.indexOf(chunkWrites[chunkWrites.length - 1]) < restCalls.indexOf(parentWrite),
    'every chunk is written before the parent points at them');
  ok(Number(parentWrite.body.fields.chunkCount.integerValue) === chunkWrites.length,
    'and the parent records how many there are');
  ok(maskOf(parentWrite).includes('json') && !('json' in parentWrite.body.fields),
    'the single-doc json field is cleared, which is how REST spells a delete');

  const loaded = await store.loadOpps2FromFirestore('u1');
  ok(loaded?.records?.length === 1200, 'and the chunked dataset reassembles on the way back');
  restore();
}

// ── A shrinking dataset drops its leftovers ────────────────────────────
{
  fresh();
  stubFetch();
  fs.failOn(/^opps2Data\/u1/, wedgedError());

  await store.saveOpps2ToFirestore('u1', dataset(1200, 'x'.repeat(900)));
  const wideChunks = [...restDocs.keys()].filter((p) => p.includes('/chunks/')).length;
  await store.saveOpps2ToFirestore('u1', dataset(3));
  const leftOver = [...restDocs.keys()].filter((p) => p.includes('/chunks/')).length;

  ok(wideChunks >= 2, 'the large save left chunks behind');
  ok(leftOver === 0, 'and the small one that follows deletes them');
  const loaded = await store.loadOpps2FromFirestore('u1');
  ok(loaded.records.length === 3, 'so the reload sees the small dataset, not a stitched-together old one');
  restore();
}

// ── The anti-wipe guard still guards ───────────────────────────────────
//
// An empty payload must not replace a populated cloud dataset. The check
// is a read, so with the SDK dead it has to be a REST read — a read that
// silently failed would turn the guard off exactly when it is needed.
{
  fresh();
  stubFetch();
  fs.failOn(/^opps2Data\/u1/, wedgedError());
  await store.saveOpps2ToFirestore('u1', dataset(5));

  let threw = null;
  try { await store.saveOpps2ToFirestore('u1', { headers: [], records: [] }); }
  catch (err) { threw = err; }
  ok(/refusing to overwrite a populated cloud dataset/.test(String(threw?.message)),
    'an empty save is still refused with the SDK gone');

  const ts = await store.saveOpps2ToFirestore('u1', { headers: [], records: [] }, { allowEmpty: true });
  ok(Number.isFinite(ts), 'and a deliberate clear-all still goes through');
  restore();
}

// ── An ordinary failure is still an ordinary failure ───────────────────
//
// The fallback is for a crashed client, not for a database that said no.
// A rules rejection must keep reaching the caller — and must not be
// retried over HTTPS, where it would be rejected all over again.
{
  fresh();
  stubFetch();
  const denied = new Error('Missing or insufficient permissions.');
  denied.code = 'permission-denied';
  fs.failOn(/^opps2Data\/u1/, denied);

  let threw = null;
  try { await store.saveOpps2ToFirestore('u1', dataset(2)); }
  catch (err) { threw = err; }
  ok(threw === denied, 'the rules rejection reaches the caller unchanged');
  ok(restCalls.length === 0, 'and no HTTPS retry was made');
  ok(!health.isClientWedged(), 'the client is not marked crashed');
  restore();
}

// ── When HTTPS is refused too ──────────────────────────────────────────
//
// The banner's job is to say WHY. A fallback that fails must throw its own
// HTTP status, not the assertion — the status is the only part anyone can
// act on.
{
  fresh();
  stubFetch({ failStatus: 429 });
  fs.failOn(/^opps2Data\/u1/, wedgedError());

  let threw = null;
  try { await store.saveOpps2ToFirestore('u1', dataset(2)); }
  catch (err) { threw = err; }
  ok(threw?.status === 429, 'the quota status comes back');
  ok(!/INTERNAL ASSERTION/.test(String(threw?.message)), 'rather than the SDK assertion nobody can act on');
  restore();
}

// ── Telling the view its live updates have stopped ─────────────────────
//
// Saves survive the crash; the snapshot listener does not. The Opps tab
// subscribes so it can say so while the user is still looking at it.
{
  fresh();
  let told = 0;
  const unsub = health.subscribeToClientWedged(() => { told += 1; });
  ok(told === 0, 'a healthy client tells the view nothing');
  health.noteClientWedged(wedgedError());
  ok(told === 1, 'the crash reaches the view as it happens');
  health.noteClientWedged(wedgedError());
  ok(told === 1, 'and only once');
  unsub();

  let late = 0;
  health.subscribeToClientWedged(() => { late += 1; });
  ok(late === 1, 'a view mounted after the crash is told immediately');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

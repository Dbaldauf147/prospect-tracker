// The save that could never finish.
//
// "Save to Veris Residential" left the Utility Lookup page reading
// "Saving 0.6 MB to Veris Residential…" and stayed there. Nothing was
// logged, no error appeared, and the only way out was to reload — which is
// what a Firestore write looks like when the browser can't reach
// firestore.googleapis.com. setDoc resolves on SERVER acknowledgement, so a
// wedged long-poll, a blocking extension, or a project over its daily quota
// (writes come back RESOURCE_EXHAUSTED, which the SDK retries forever)
// leaves the promise pending for the life of the tab. It never rejects, so
// the try/catch around the save never runs.
//
// Two things had to be true for that to be the end of it: the save awaited
// four separate round-trips behind one spinner, and the last of them — the
// prune that deletes the PREVIOUS workbook's chunks — was awaited even
// though the analysis was already stored by then. So the page could sit
// frozen on a save that had actually succeeded.
//
// Run: node scripts/analysisSaveTimeout.test.mjs
import { register } from 'node:module';
register('./stubs/loader.mjs', import.meta.url);

const fs = await import('./stubs/firestore.mjs');
const { saveIndicativeAnalysis, setProspectsUser, ensureFirestoreOnline } = await import('../src/utils/firestoreSync.js');
const { isTimeoutError } = await import('../src/utils/withTimeout.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}

// The shared (admin) collection, so paths below are prospects/<id>/analyses.
setProspectsUser(null, 'baldaufdan@gmail.com');
const COL = 'prospects/p1/analyses';
const fast = { readTimeoutMs: 50, writeTimeoutMs: 50, probeTimeoutMs: 50 };
const payload = (chars) => ({ fileName: 'a.xlsx', dataBase64: 'A'.repeat(chars), sizeBytes: Math.floor(chars * 3 / 4) });
// Let a detached prune (which the save deliberately doesn't await) run.
const settle = () => new Promise((r) => setTimeout(r, 30));
// The REST fallback goes through global fetch; each case that stubs it puts
// the real one back, so a later case can't accidentally depend on it.
const realFetch = globalThis.fetch;
const restoreFetch = () => { globalThis.fetch = realFetch; };

// ── A save that works ──────────────────────────────────────────────────
{
  fs.reset();
  const phases = [];
  await saveIndicativeAnalysis('p1', payload(10), { onPhase: (p) => phases.push(p) });
  const main = fs.store.get(`${COL}/main`);
  ok(!!main, 'the metadata doc is written');
  ok(main.chunkCount === 1, 'a small workbook is one chunk');
  const chunkPaths = [...fs.store.keys()].filter((p) => p.includes('/chunk-'));
  ok(chunkPaths.length === 1, 'and one chunk document exists');
  ok(fs.store.get(chunkPaths[0]).data === 'A'.repeat(10), 'holding the payload');
  // main LAST: a reader that sees main must find every chunk it names.
  const order = fs.calls.filter((c) => c.op === 'setDoc').map((c) => c.path);
  ok(order.indexOf(`${COL}/main`) === order.length - 1
    || order.lastIndexOf(`${COL}/main`) > order.indexOf(chunkPaths[0]),
    'the metadata doc is written after its chunks');
  ok(phases.map((p) => p.step).join(',').startsWith('probing,probed,uploading'),
    'the steps are reported as they happen, starting with the test write');
  ok(phases.some((p) => p.step === 'saved'), 'including the one that means it landed');
}

// ── A workbook past one document ───────────────────────────────────────
{
  fs.reset();
  // Three chunks at the 700 KiB split.
  await saveIndicativeAnalysis('p1', payload(700 * 1024 * 2 + 5), {});
  const main = fs.store.get(`${COL}/main`);
  ok(main.chunkCount === 3, 'a workbook over the chunk size is split across documents');
  const sizes = [...fs.store.entries()].filter(([p]) => p.includes('/chunk-')).map(([, d]) => d.data.length);
  ok(Math.max(...sizes) <= 700 * 1024, 'and no chunk exceeds the split size');
}

// ── The hang this exists for: a chunk write that never answers ─────────
{
  fs.reset();
  // Every chunk write hangs, whatever generation or size it lands under.
  fs.hangOn(/\/chunk-/, 'setDoc');
  const t0 = Date.now();
  let raised = null;
  try { await saveIndicativeAnalysis('p1', payload(10), fast); }
  catch (err) { raised = err; }
  ok(isTimeoutError(raised), 'a write that never answers rejects instead of hanging');
  ok(/uploading part 1 of 1/.test(raised?.message || ''), 'and the rejection names the step that stalled');
  ok(Date.now() - t0 < 3000, 'within the ceilings, not the life of the tab');
  ok(!fs.store.has(`${COL}/main`), 'nothing claims the analysis was saved');
  // The probe went through, so the caller can say the connection works and
  // it is the upload that doesn't — a different sentence, and a different fix.
  ok(raised.probeOk === true, 'and carries what the test write learned');
  const attempts = new Set(fs.calls.filter((c) => c.op === 'setDoc' && c.path.includes('/chunk-')).map((c) => c.path.split('-')[1]));
  ok(attempts.size === 3, `every rung of the ladder is tried (${attempts.size} attempts)`);
  // No disable/enable churn between rungs: taking the client offline to
  // "refresh" it is how an app ends up offline for the life of the tab.
  ok(!fs.network.calls.includes('disable'), 'without ever taking the client offline between rungs');
}

// ── The save that only fails at 700 KB ─────────────────────────────────
{
  fs.reset();
  // What a proxy with a request-body cap does: the small writes land, the
  // big one never answers. Before the ladder this was indistinguishable
  // from a dead connection, and equally unrecoverable.
  fs.hangIf((c) => c.op === 'setDoc' && typeof c.data?.data === 'string' && c.data.data.length > 200 * 1024);
  let raised = null;
  const chars = 700 * 1024 + 5; // two chunks at the top rung, four at the next
  try { await saveIndicativeAnalysis('p1', payload(chars), fast); }
  catch (err) { raised = err; }
  ok(raised === null, 'the save succeeds by cutting the workbook smaller');
  const main = fs.store.get(`${COL}/main`);
  ok(!!main && main.chunkCount === Math.ceil(chars / (200 * 1024)), 'at the first size the connection will carry');
  // What readers get back has to be the whole workbook, not most of it.
  const gen = main.gen;
  const rebuilt = Array.from({ length: main.chunkCount }, (_, i) => fs.store.get(`${COL}/chunk-${gen}-${i}`).data).join('');
  ok(rebuilt === 'A'.repeat(chars), 'and the stored chunks reassemble to the original');
}

// ── The step down serialises, or it isn't a smaller request ────────────
{
  fs.reset();
  fs.hangIf((c) => c.op === 'setDoc' && typeof c.data?.data === 'string' && c.data.data.length > 200 * 1024);
  // Writes take long enough to overlap if they are going to. Counting the
  // chunk writes only: the bookkeeping write races them by design.
  fs.timing.delayMs = 5;
  fs.timing.track = (c) => c.path.includes('/chunk-');
  await saveIndicativeAnalysis('p1', payload(700 * 1024 + 5), fast);
  // The SDK batches queued mutations into one request, so chunks written at
  // once are one big request however small each document is. The rung that
  // exists to make the request smaller has to write them one at a time.
  ok(fs.timing.maxInFlight === 1, `the retry writes one document at a time (peak ${fs.timing.maxInFlight})`);
  fs.timing.delayMs = 0;
}

// ── ...but the first attempt still goes up in parallel ─────────────────
{
  fs.reset();
  fs.timing.delayMs = 5;
  fs.timing.track = (c) => c.path.includes('/chunk-');
  await saveIndicativeAnalysis('p1', payload(700 * 1024 * 2 + 5), fast);
  ok(fs.timing.maxInFlight > 1, `a normal save uploads in parallel (peak ${fs.timing.maxInFlight})`);
  fs.timing.delayMs = 0;
}

// ── When nothing lands at all, the ladder is not the answer ────────────
{
  fs.reset();
  // The probe fails too, so no size of chunk will help and re-cutting the
  // workbook three times would only be three times the wait. The save goes
  // straight around the SDK instead.
  fs.hangOn(/./, 'setDoc');
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
  const t0 = Date.now();
  let raised = null;
  try { await saveIndicativeAnalysis('p1', payload(10), fast); }
  catch (err) { raised = err; }
  ok(raised === null, 'the save completes by another route');
  const sdkChunkWrites = fs.calls.filter((c) => c.op === 'setDoc' && c.path.includes('/chunk-'));
  ok(sdkChunkWrites.length === 0, 'the ladder is not walked when nothing is getting through');
  ok(Date.now() - t0 < 1500, 'so the answer comes quickly');
  restoreFetch();
}

// ── A read that never answers must not stop the upload ─────────────────
{
  fs.reset();
  // The two bookkeeping reads say what may be DELETED, not what to write,
  // so the upload does not wait on them at all. This is the step the page
  // was found sitting on: "checking what is stored…", forever.
  fs.hangOn(`${COL}/main`, 'getDoc');
  fs.hangOn(`${COL}/pending`, 'getDoc');
  const t0 = Date.now();
  let raised = null;
  try { await saveIndicativeAnalysis('p1', payload(10), fast); }
  catch (err) { raised = err; }
  const elapsed = Date.now() - t0;
  ok(raised === null, 'the save still completes when the bookkeeping reads stall');
  ok(!!fs.store.get(`${COL}/main`), 'and the analysis is stored');
  // Under the read ceiling, not merely under it plus the upload: the reads
  // are not on the path at all any more.
  ok(elapsed < fast.readTimeoutMs, `without waiting on them even once (${elapsed}ms)`);
  const firstWrite = fs.calls.findIndex((c) => c.op === 'setDoc' && c.path.includes('/chunk-'));
  const firstRead = fs.calls.findIndex((c) => c.op === 'getDoc');
  ok(firstWrite >= 0 && firstRead >= 0 && firstWrite < firstRead + 3,
    'the upload starts alongside the reads rather than behind them');
  await settle();
  ok(!fs.calls.some((c) => c.op === 'deleteDoc'), 'and with no prune plan, nothing is deleted by id');
}

// ── The freeze after the save had already succeeded ────────────────────
{
  fs.reset();
  // A previous generation to clean up: main points at gen "old" with one chunk.
  fs.store.set(`${COL}/main`, { fileName: 'old.xlsx', chunkCount: 1, gen: 'old' });
  fs.store.set(`${COL}/chunk-old-0`, { i: 0, gen: 'old', data: 'x' });
  // The delete of that chunk never answers.
  fs.hangOn(`${COL}/chunk-old-0`, 'deleteDoc');
  const t0 = Date.now();
  await saveIndicativeAnalysis('p1', payload(10), fast);
  const elapsed = Date.now() - t0;
  ok(elapsed < 50, `the save returns without waiting on the cleanup (${elapsed}ms)`);
  const main = fs.store.get(`${COL}/main`);
  ok(main.fileName === 'a.xlsx', 'and the new analysis is what readers get');
  await settle();
  ok(fs.calls.some((c) => c.op === 'deleteDoc' && c.path === `${COL}/chunk-old-0`),
    'the cleanup still runs, just not on the critical path');
}

// ── Never leave the client offline ─────────────────────────────────────
{
  fs.reset();
  const online = await ensureFirestoreOnline();
  ok(online === true, 'the online check reports success');
  // The disable half is gone on purpose: with the multi-tab persistent
  // cache, a disable not cleanly followed by an enable leaves the whole app
  // offline for the life of the tab — the very bug it was meant to fix.
  ok(!fs.network.calls.includes('disable'), 'and never takes the client offline to do it');
  ok(fs.network.calls.includes('enable'), 'only ever opening the connection');
}

// ── When the SDK can't get a byte out, go around it ────────────────────
{
  fs.reset();
  // Every SDK write hangs, the probe included: not a size problem, and no
  // rung of the ladder fixes it. But the SDK's streams are the unusual
  // traffic — plain HTTPS to the same host is often still fine.
  fs.hangOn(/./, 'setDoc');
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
  };
  let raised = null;
  const chars = 100 * 1024;
  try { await saveIndicativeAnalysis('p1', payload(chars), fast); }
  catch (err) { raised = err; }
  ok(raised === null, 'the save succeeds over HTTPS when the SDK is mute');
  const chunkReqs = requests.filter((r) => r.url.includes('/chunk-'));
  const mainReq = requests.find((r) => r.url.endsWith('/main'));
  ok(chunkReqs.length === Math.ceil(chars / (64 * 1024)), 'every chunk is written as its own request');
  ok(!!mainReq, 'and the metadata document is written');
  ok(requests.indexOf(mainReq) === requests.length - 1, 'last, after the chunks it names');
  ok(mainReq.body.fields.chunkCount.integerValue === String(chunkReqs.length), 'naming the chunk count it wrote');
  ok(requests.every((r) => r.url.startsWith('https://firestore.googleapis.com/v1/projects/test-project/')),
    'against the signed-in project');
  const rebuilt = chunkReqs.map((r) => r.body.fields.data.stringValue).join('');
  ok(rebuilt === 'A'.repeat(chars), 'and the documents reassemble to the original workbook');
  restoreFetch();
}

// ── ...and when that fails too, say what the server said ───────────────
{
  fs.reset();
  fs.hangOn(/./, 'setDoc');
  globalThis.fetch = async () => ({
    ok: false,
    status: 429,
    text: async () => JSON.stringify({ error: { message: 'Quota exceeded.' } }),
  });
  let raised = null;
  try { await saveIndicativeAnalysis('p1', payload(10), fast); }
  catch (err) { raised = err; }
  ok(!!raised, 'a save with no way through still fails');
  ok(raised.restTried === true, 'having tried the plain request');
  ok(/429/.test(raised.restDetail) && /Quota exceeded/.test(raised.restDetail),
    'and carries the status and the server\'s own words');
  // The first hard fact this failure has ever produced: silence from the
  // SDK says nothing, a status code says which of three things is wrong.
  ok(raised.status === 429, 'so the page can tell a quota from a firewall');
  restoreFetch();
}

// ── A blocked network reads as a blocked network ───────────────────────
{
  fs.reset();
  fs.hangOn(/./, 'setDoc');
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  let raised = null;
  try { await saveIndicativeAnalysis('p1', payload(10), fast); }
  catch (err) { raised = err; }
  ok(raised?.networkFailure === true, 'a request that never completes is marked as a network failure');
  ok(/Failed to fetch/.test(raised?.restDetail || ''), 'with what the browser said about it');
  restoreFetch();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

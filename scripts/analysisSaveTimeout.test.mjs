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
const { saveIndicativeAnalysis, setProspectsUser, kickFirestoreConnection } = await import('../src/utils/firestoreSync.js');
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
  ok(fs.network.calls.length >= 2, 'on a fresh connection each time');
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

// ── When nothing lands at all, one attempt is enough to say so ─────────
{
  fs.reset();
  // The probe fails too: no size of chunk will help, so stepping down the
  // ladder would only be three times the wait before saying the same thing.
  fs.hangOn(/./, 'setDoc');
  const t0 = Date.now();
  let raised = null;
  try { await saveIndicativeAnalysis('p1', payload(10), fast); }
  catch (err) { raised = err; }
  ok(isTimeoutError(raised), 'the save still rejects rather than hanging');
  ok(raised.probeOk === false, 'and reports that even a test write went unanswered');
  const attempts = new Set(fs.calls.filter((c) => c.op === 'setDoc' && c.path.includes('/chunk-')).map((c) => c.path.split('-')[1]));
  ok(attempts.size === 1, 'the ladder is not walked when nothing is getting through');
  ok(Date.now() - t0 < 1500, 'so the answer comes quickly');
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

// ── The lever a retry pulls before trying again ────────────────────────
{
  fs.reset();
  // A stall is the SDK waiting on a stream it still believes in, so a retry
  // that doesn't close the connection first waits on the same dead stream.
  const kicked = await kickFirestoreConnection();
  ok(kicked === true, 'the connection restart reports success');
  ok(fs.network.calls.join(',') === 'disable,enable', 'and closes the connection before reopening it');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

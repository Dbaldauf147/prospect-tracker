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
const { saveIndicativeAnalysis } = await import('../src/utils/firestoreSync.js');
const { setProspectsUser } = await import('../src/utils/firestoreSync.js');
const { isTimeoutError } = await import('../src/utils/withTimeout.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}

// The shared (admin) collection, so paths below are prospects/<id>/analyses.
setProspectsUser(null, 'baldaufdan@gmail.com');
const COL = 'prospects/p1/analyses';
const fast = { readTimeoutMs: 50, writeTimeoutMs: 50 };
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
  ok(phases.map((p) => p.step).join(',').startsWith('reading,uploading'), 'the steps are reported as they happen');
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
  // Every chunk write hangs, whatever generation this save picks.
  fs.hangOn(/\/chunk-/, 'setDoc');
  const t0 = Date.now();
  let raised = null;
  try { await saveIndicativeAnalysis('p1', payload(10), fast); }
  catch (err) { raised = err; }
  ok(isTimeoutError(raised), 'a write that never answers rejects instead of hanging');
  ok(/uploading part 1 of 1/.test(raised?.message || ''), 'and the rejection names the step that stalled');
  ok(Date.now() - t0 < 2000, 'within the ceiling, not the life of the tab');
  ok(!fs.store.has(`${COL}/main`), 'nothing claims the analysis was saved');
  // The generation is on the pending list, so the next save can clean up
  // whatever this one did manage to upload.
  ok((fs.store.get(`${COL}/pending`)?.gens || []).length === 1, 'the abandoned generation is on record for the next save');
}

// ── A read that never answers must not stop the upload ─────────────────
{
  fs.reset();
  // The two bookkeeping reads say what may be DELETED, not what to write.
  fs.hangOn(`${COL}/main`, 'getDoc');
  fs.hangOn(`${COL}/pending`, 'getDoc');
  const t0 = Date.now();
  let raised = null;
  // Only the reads hang; the writes that follow answer normally.
  try { await saveIndicativeAnalysis('p1', payload(10), fast); }
  catch (err) { raised = err; }
  ok(raised === null, 'the save still completes when the bookkeeping reads stall');
  ok(!!fs.store.get(`${COL}/main`), 'and the analysis is stored');
  ok(Date.now() - t0 < 2000, 'without waiting on the reads that never came back');
  // With no prune plan, nothing may be deleted by id...
  await settle();
  ok(!fs.calls.some((c) => c.op === 'deleteDoc' && c.path.endsWith('/main')), 'the live analysis is never deleted');
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

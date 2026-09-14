// Removing a company's saved Master Analysis.
//
// The workbook is not one document. It is a `main` record naming a
// generation, a `pending` doc holding the bookkeeping, and however many
// `chunk-<gen>-<i>` docs the base64 needed - plus, on a company whose save
// once died partway, chunks from generations no `main` ever pointed at.
// Those orphans are exactly the megabytes a remove is expected to reclaim,
// so it lists the collection rather than deleting the ids `main` names.
//
// Two ways this goes wrong quietly, and both are pinned below:
//
//   - A batch takes 500 writes. A collection that has collected orphans
//     across several generations passes that, and an unsliced commit does
//     not delete 499 of them and fail on the rest - it rejects and deletes
//     NOTHING, leaving the card on screen with the workbook still there.
//
//   - A Firestore read of an uncached collection never settles when the
//     client can't reach the server, and neither does a commit. Without a
//     timeout the Remove button spins for as long as the modal is open,
//     which is the same failure the save had (see analysisSaveTimeout).
//
// Run: node scripts/analysisRemove.test.mjs
import { register } from 'node:module';
register('./stubs/loader.mjs', import.meta.url);

const fs = await import('./stubs/firestore.mjs');
const { deleteIndicativeAnalysis, setProspectsUser } = await import('../src/utils/firestoreSync.js');
const { isTimeoutError } = await import('../src/utils/withTimeout.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}

setProspectsUser(null, 'baldaufdan@gmail.com');
const COL = 'prospects/p1/analyses';
const left = () => [...fs.store.keys()].filter(p => p.startsWith(`${COL}/`));
// The real ceilings are twenty and thirty seconds. Watching a stall at
// those would put a minute of doing nothing into the suite.
const fast = { readTimeoutMs: 50, writeTimeoutMs: 50 };

// Seed a saved analysis: metadata, bookkeeping, and `n` chunks.
function seed(n, { gen = 'g1', orphans = 0 } = {}) {
  fs.reset();
  fs.store.set(`${COL}/main`, { fileName: 'BRE Hotels & Resorts_Master Analysis.xlsx', chunkCount: n, gen });
  fs.store.set(`${COL}/pending`, { gens: [{ gen, chunkCount: n, at: Date.now() }] });
  for (let i = 0; i < n; i += 1) fs.store.set(`${COL}/chunk-${gen}-${i}`, { i, gen, data: 'A' });
  // Chunks from saves that died before `main` ever named them.
  for (let i = 0; i < orphans; i += 1) fs.store.set(`${COL}/chunk-dead${i}-0`, { i: 0, gen: `dead${i}`, data: 'A' });
}

// ── The ordinary case ──────────────────────────────────────────────────
{
  seed(3);
  // Another company's analysis, to prove the delete is scoped to one.
  fs.store.set('prospects/p2/analyses/main', { fileName: 'Someone Else.xlsx', chunkCount: 1 });
  await deleteIndicativeAnalysis('p1');
  ok(left().length === 0, 'the metadata, the bookkeeping and every chunk go');
  ok(fs.store.has('prospects/p2/analyses/main'), 'and another company keeps its own');
}

// ── Orphans from a save that died ──────────────────────────────────────
{
  seed(2, { orphans: 3 });
  ok(left().length === 7, 'the collection starts with the orphans in it');
  await deleteIndicativeAnalysis('p1');
  ok(left().length === 0, 'chunks no main ever pointed at are reclaimed too');
}

// ── Past one batch ─────────────────────────────────────────────────────
// 900 KB a chunk means a 40 MB ceiling is ~60 docs, so one save never gets
// here. A company saved over and over, each leaving a dead generation
// behind, does.
{
  seed(10, { orphans: 900 });
  const before = left().length;
  ok(before === 912, 'a collection well past a single batch');
  await deleteIndicativeAnalysis('p1');
  ok(left().length === 0, 'is still emptied completely');
  const commits = fs.calls.filter(c => c.op === 'commit');
  ok(commits.length === 3, 'across several commits rather than one oversized batch');
  ok(commits.every(c => c.size <= 500), 'none of them over the 500-write limit');
}

// ── Nothing saved ──────────────────────────────────────────────────────
{
  fs.reset();
  let threw = null;
  try { await deleteIndicativeAnalysis('p1'); } catch (e) { threw = e; }
  ok(threw === null, 'removing an analysis that was never saved is not an error');
  ok(fs.calls.filter(c => c.op === 'commit').length === 0, 'and writes nothing');
}

// ── A client that cannot reach the server ──────────────────────────────
// The read first: a getDocs on a collection that is by definition not in
// the local cache is the shape that hangs forever.
{
  seed(2);
  fs.hangIf(c => c.op === 'getDocs');
  let err = null;
  try { await deleteIndicativeAnalysis('p1', fast); } catch (e) { err = e; }
  ok(isTimeoutError(err), 'a stalled read gives up rather than hanging the button');
  ok(String(err?.message || '').includes('reading the saved analysis'),
    'and says which leg stalled');
}

// Then the commit, which is the same story: a write resolves on server
// acknowledgement and simply never settles offline.
{
  seed(2);
  fs.hangIf(c => c.op === 'commit');
  let err = null;
  try { await deleteIndicativeAnalysis('p1', fast); } catch (e) { err = e; }
  ok(isTimeoutError(err), 'a stalled commit gives up too');
  ok(String(err?.message || '').includes('removing the saved analysis'),
    'naming the remove rather than a generic write');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

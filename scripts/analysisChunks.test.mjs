// What a Master Analysis save is allowed to delete after it finishes.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/analysisChunks.test.mjs
//
// A save used to find its deletable chunks by listing the whole `analyses`
// subcollection, which downloaded every stored chunk's base64 — the previous
// workbook in full, plus every generation an earlier prune had failed to
// remove — before the new one could start uploading. That read grew with
// every save and sat on the critical path of "Save to <company>".
//
// It now deletes by id instead, from two small bookkeeping docs: `main`
// (the generation readers currently reassemble) and `pending` (generations
// whose chunks exist but that `main` doesn't name — the one being written
// now, and any a save that died left behind). Nothing lists the collection.
//
// That trade only holds if the id rule is right, and it has two ways to be
// wrong that nothing downstream would catch quickly:
//
//   - deleting the live generation's chunks, which corrupts the analysis
//     that was just saved and only surfaces on the next download; or
//   - deleting a generation another device is still uploading, same result
//     on that device.
//
// Both are what these assertions pin down.
import {
  analysisChunkId,
  analysisChunkIds,
  isAnalysisChunkId,
  planAnalysisPrune,
  ANALYSIS_PENDING_GRACE_MS,
} from '../src/utils/analysisChunks.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}
function same(label, actual, expected) {
  check(label, JSON.stringify(actual), JSON.stringify(expected));
}

const NOW = 1_800_000_000_000;

// --- ids -------------------------------------------------------------

check('a generation stamps its chunk ids', analysisChunkId('ab12', 3), 'chunk-ab12-3');
check('no generation is the pre-generation layout', analysisChunkId('', 3), 'chunk-3');
same('a generation lists every chunk it wrote', analysisChunkIds('ab12', 3), ['chunk-ab12-0', 'chunk-ab12-1', 'chunk-ab12-2']);
same('a zero chunk count lists nothing', analysisChunkIds('ab12', 0), []);
same('a junk chunk count lists nothing', analysisChunkIds('ab12', 'seven'), []);

check('a generation-stamped chunk is a chunk', isAnalysisChunkId('chunk-ab12-0'), true);
check('a pre-generation chunk is a chunk', isAnalysisChunkId('chunk-7'), true);
check('the metadata doc is not a chunk', isAnalysisChunkId('main'), false);
check('the bookkeeping doc is not a chunk', isAnalysisChunkId('pending'), false);

// --- what a finished save deletes ------------------------------------

// The ordinary case: one previous analysis, this save's own entry on the
// pending list, nothing else. The previous generation goes; this one stays.
{
  const { ids, keep } = planAnalysisPrune({
    prevMeta: { gen: 'old1', chunkCount: 2 },
    pending: [{ gen: 'new1', chunkCount: 1, at: NOW }],
    liveGen: 'new1',
    now: NOW,
  });
  same('the generation main pointed at is deleted', ids, ['chunk-old1-0', 'chunk-old1-1']);
  same('the save that just landed is taken off the pending list', keep, []);
}

// The one that must never happen: the live generation appearing anywhere in
// the inputs must not put its own chunks on the delete list.
{
  const { ids } = planAnalysisPrune({
    prevMeta: { gen: 'live', chunkCount: 3 },
    pending: [{ gen: 'live', chunkCount: 3, at: NOW - 60 * 60 * 1000 }],
    liveGen: 'live',
    now: NOW,
  });
  same('the live generation is never deleted', ids, []);
}

// A save that died an hour ago: past the grace window, so its orphan chunks
// are cleaned up here rather than sitting in storage forever.
{
  const { ids, keep } = planAnalysisPrune({
    prevMeta: { gen: 'old1', chunkCount: 1 },
    pending: [
      { gen: 'died', chunkCount: 2, at: NOW - 60 * 60 * 1000 },
      { gen: 'new1', chunkCount: 1, at: NOW },
    ],
    liveGen: 'new1',
    now: NOW,
  });
  same('an abandoned save is pruned once it is past the grace window', ids, [
    'chunk-old1-0', 'chunk-died-0', 'chunk-died-1',
  ]);
  same('and comes off the pending list with it', keep, []);
}

// A save running RIGHT NOW on another device. Deleting its chunks would
// corrupt the analysis it is about to point `main` at, so it is left alone
// — and left on the list, so it is still prunable if it never finishes.
{
  const { ids, keep } = planAnalysisPrune({
    prevMeta: { gen: 'old1', chunkCount: 1 },
    pending: [
      { gen: 'other', chunkCount: 4, at: NOW - 5_000 },
      { gen: 'new1', chunkCount: 1, at: NOW },
    ],
    liveGen: 'new1',
    now: NOW,
  });
  same('a save in flight on another device is not deleted', ids, ['chunk-old1-0']);
  same('and stays on the pending list for next time', keep, [{ gen: 'other', chunkCount: 4 }]);
}

// The boundary: exactly at the grace window, an entry is old enough to go.
{
  const { ids } = planAnalysisPrune({
    prevMeta: {},
    pending: [{ gen: 'edge', chunkCount: 1, at: NOW - ANALYSIS_PENDING_GRACE_MS }],
    liveGen: 'new1',
    now: NOW,
  });
  same('an entry exactly at the grace window is prunable', ids, ['chunk-edge-0']);
}

// An analysis saved before generations existed: no `gen` on `main`, chunks
// under plain `chunk-<i>`. They are still what the new save replaces.
{
  const { ids } = planAnalysisPrune({
    prevMeta: { chunkCount: 2 },
    pending: [],
    liveGen: 'new1',
    now: NOW,
  });
  same('pre-generation chunks are deleted by their own ids', ids, ['chunk-0', 'chunk-1']);
}

// Nothing saved before (a first save), and junk on the pending doc: neither
// may produce a delete.
{
  const first = planAnalysisPrune({ prevMeta: {}, pending: [], liveGen: 'new1', now: NOW });
  same('a first save deletes nothing', first.ids, []);
  const junk = planAnalysisPrune({
    prevMeta: null,
    pending: [null, 'nonsense', { gen: '', chunkCount: 5 }, { gen: 'x' }],
    liveGen: 'new1',
    now: NOW,
  });
  same('unreadable pending entries delete nothing', junk.ids, []);
  same('and are dropped rather than kept', junk.keep, []);
}

// The same generation named twice (main and pending) must not queue two
// deletes for one document.
{
  const { ids } = planAnalysisPrune({
    prevMeta: { gen: 'old1', chunkCount: 2 },
    pending: [{ gen: 'old1', chunkCount: 2, at: NOW - 60 * 60 * 1000 }],
    liveGen: 'new1',
    now: NOW,
  });
  same('a generation named twice is deleted once', ids, ['chunk-old1-0', 'chunk-old1-1']);
}

console.log(failures === 0 ? '\nAll analysis chunk tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

// Chunk-doc bookkeeping for a company's saved Master Analysis.
//
// The workbook is stored as base64 split across sibling `chunk-<gen>-<i>`
// docs in the prospect's `analyses` subcollection, with a `main` doc holding
// the metadata and naming the generation readers should reassemble. Pure
// here, with no firebase import, so the rule that decides what a save may
// delete can be tested directly — getting it wrong either leaves orphan
// megabytes behind forever or deletes the chunks the live `main` points at,
// and the second one is only visible as a corrupt download weeks later.

// Chunk doc ids carry the generation that wrote them: `chunk-<gen>-<i>`.
//
// They used to be plain `chunk-<i>`, which meant a save that died partway
// left the collection holding a mix of two workbooks — the chunks it managed
// to overwrite, and the older ones it didn't reach. The `main` doc still
// pointed at the previous chunkCount, so the next read reassembled across
// that seam and produced base64 that decoded to a broken zip. The symptom
// was a error from deep inside the xlsx reader ("Bad compressed size:
// 5714 != 6246") with nothing to connect it back to a half-finished upload.
//
// Generation-stamped ids make a partial save inert instead: its chunks are
// under an id no `main` references, so readers keep seeing the last complete
// workbook until a save finishes and swings `main` over to the new
// generation. The stale ones are pruned on the next successful save.
export const newAnalysisGen = () => {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID().slice(0, 8);
  } catch { /* fall through to the timestamp form */ }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
};

export const analysisChunkId = (gen, i) => (gen ? `chunk-${gen}-${i}` : `chunk-${i}`);

// True for any doc id that is a payload chunk, of any generation — what the
// legacy sweep needs in order to recognise the docs it may delete. `main`,
// `pending` and anything else in the collection are left alone.
export const isAnalysisChunkId = (id) => /^chunk-(?:[a-z0-9-]+-)?\d+$/i.test(String(id || ''));

// Every chunk id a generation wrote, so it can be deleted by id without
// listing (and downloading) the collection first.
export const analysisChunkIds = (gen, chunkCount) => (
  Array.from({ length: Math.max(0, Math.trunc(Number(chunkCount)) || 0) }, (_, i) => analysisChunkId(gen, i))
);

// A recorded generation, as { gen, chunkCount }, or null for anything that
// isn't one — a half-written entry, a shape from a future version, junk.
export const asAnalysisGenEntry = (e) => {
  const gen = typeof e?.gen === 'string' ? e.gen.trim() : '';
  const chunkCount = Math.trunc(Number(e?.chunkCount)) || 0;
  if (!gen || chunkCount <= 0) return null;
  return { gen, chunkCount };
};

// How long a generation recorded on the `pending` doc is left alone before
// a later save may delete its chunks. A save that is still uploading has
// its generation on that list, and another device pruning it mid-flight
// would delete the chunks that device's `main` is about to point at. Longer
// than any real upload takes, and short enough that a save which died is
// cleaned up the next time somebody saves that company.
export const ANALYSIS_PENDING_GRACE_MS = 15 * 60 * 1000;

// What a finished save should delete, and what it should leave on the
// `pending` doc for next time.
//
// `ids` covers the generation `main` pointed at before this save (safe to
// delete the moment `main` names the new one) plus every pending generation
// old enough to be past the grace window — a save that died, rather than one
// still running on another device. `keep` is the rest: entries too young to
// judge, which stay on record so they are still prunable later.
//
// `prevMeta` is the `main` document as it was read at the start of the save.
// An analysis written before generations existed carries no `gen`, and its
// chunks are plain `chunk-<i>` — which analysisChunkId() builds from an
// empty gen, so those are covered by the same walk. The save's own entry is
// dropped from `keep` and never appears in `ids`: `main` names it now, so
// deleting it would break the analysis that was just saved.
export function planAnalysisPrune({
  prevMeta,
  pending,
  liveGen,
  now = Date.now(),
  graceMs = ANALYSIS_PENDING_GRACE_MS,
} = {}) {
  const live = typeof liveGen === 'string' ? liveGen.trim() : '';
  const prevGen = typeof prevMeta?.gen === 'string' ? prevMeta.gen.trim() : '';
  const ids = [];
  const keep = [];
  const seen = new Set();
  const add = (gen, chunkCount) => {
    if (gen && gen === live) return;
    for (const id of analysisChunkIds(gen, chunkCount)) {
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  };
  add(prevGen, prevMeta?.chunkCount);
  for (const raw of (Array.isArray(pending) ? pending : [])) {
    const entry = asAnalysisGenEntry(raw);
    if (!entry || entry.gen === live) continue;
    // No timestamp means it predates this bookkeeping (or was written by a
    // version that didn't stamp one): treat it as old, since nothing else
    // will ever make it prunable.
    const at = Number(raw?.at) || 0;
    if (at && now - at < graceMs) { keep.push(entry); continue; }
    add(entry.gen, entry.chunkCount);
  }
  return { ids, keep };
}

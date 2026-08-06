import { useEffect, useState } from 'react';
import { getIndicativeAnalysisMeta } from '../utils/firestoreSync';

// Module-level cache, keyed by prospect id: a company's saved-analysis
// metadata doesn't change while you're looking at a table of it, and the
// PE Overview table re-derives its rows on every edit. Kept outside React
// so switching tabs and coming back doesn't re-read the same docs.
// `null` is a cached "nothing saved" — as much a result as a hit.
const metaCache = new Map();

/**
 * Which of these companies have a Master Analysis saved against them, and when.
 *
 * Two sources, in order of cost:
 *   1. The `indicativeAnalysisMeta` marker stamped on the prospect record at
 *      save time — free, already in memory with the prospect.
 *   2. For companies without that marker, a metadata-only read of their
 *      analyses doc. Analyses saved before the marker existed only show up
 *      here, and a table that said "not saved" about a company that has one
 *      would be worse than no column at all.
 *
 * The reads are one document each, cached across renders and capped, and run
 * a few at a time so opening the tab doesn't fire a hundred parallel gets.
 *
 * Returns a Map of prospect id -> { fileName, sizeBytes, savedAt } | null.
 */
export function useSavedAnalyses(prospects, { max = 300 } = {}) {
  const [, bump] = useState(0);

  // Only the ids matter for the fetch; join them so the effect doesn't re-run
  // every time an unrelated field on a prospect changes.
  const ids = (prospects || []).map(p => p?.id).filter(Boolean);
  const idKey = ids.join(',');

  useEffect(() => {
    // Seed the cache from the markers first — no read needed for those.
    for (const p of prospects || []) {
      if (p?.id && p.indicativeAnalysisMeta && !metaCache.has(p.id)) {
        metaCache.set(p.id, p.indicativeAnalysisMeta);
      }
    }
    const missing = ids.filter(id => !metaCache.has(id)).slice(0, max);
    if (missing.length === 0) return;

    let cancelled = false;
    (async () => {
      const BATCH = 8;
      for (let i = 0; i < missing.length; i += BATCH) {
        if (cancelled) return;
        await Promise.all(missing.slice(i, i + BATCH).map(async (id) => {
          try {
            metaCache.set(id, await getIndicativeAnalysisMeta(id));
          } catch {
            // Unreadable — cache the miss so we don't retry it every render.
            metaCache.set(id, null);
          }
        }));
        if (!cancelled) bump(n => n + 1);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey, max]);

  const out = new Map();
  for (const p of prospects || []) {
    if (!p?.id) continue;
    // The marker wins when it carries a date: it's written at save time, so
    // it's never staler than the cached read.
    const marker = p.indicativeAnalysisMeta?.savedAt ? p.indicativeAnalysisMeta : null;
    const meta = marker || metaCache.get(p.id) || null;
    if (meta) out.set(p.id, meta);
  }
  return out;
}

// When a saved analysis was written, phrased for a table cell: recent saves
// read as a relative age, older ones as a date, with the year only when it
// isn't the current one.
export function formatAnalysisDate(savedAt) {
  const d = savedAt ? new Date(savedAt) : null;
  if (!d || isNaN(d)) return 'Saved';
  const midnight = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const now = new Date();
  const days = Math.round((midnight(now) - midnight(d)) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

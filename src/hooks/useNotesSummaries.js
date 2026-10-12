// Summaries of opps' running notes for the Notes column on the New Opps
// and PE Opps subtabs, and of their Scope for the Scope column on New Opps,
// fetched from /api/summarize-notes as the rows come into view and cached
// by the text they summarise.
//
// The cache is module-level (so both subtabs, and a remount of either,
// share it) and mirrored to localStorage (so a reload doesn't pay for the
// same summaries again). A summary is keyed by a hash of the notes, so it
// is reused exactly as long as the notes haven't changed and no longer.
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../utils/apiFetch';
import { chunk, needsSummary, oppNotesText, summaryKey } from '../utils/notesSummary';
import { needsScopeSummary, oppScopeText } from '../utils/scopeSummary';

// v2: summaries capped at 3 bullets (v1 allowed 4), so older cached ones
// are asked for again rather than shown at the old length.
const STORAGE_KEY = 'notes-summary-cache:v2';
// Enough for every opp a person works, a few edits deep, without letting
// the stored map grow forever.
const MAX_STORED = 1500;

try { localStorage.removeItem('notes-summary-cache:v1'); } catch { /* ignore */ }
// Matches MAX_ITEMS in api/_lib/summarizeNotes.js.
const BATCH = 25;

// One summariser per kind of text: its own cache (module-level, so every
// table and remount shares it, and mirrored to localStorage so a reload
// doesn't pay for the same summaries again) and its own fetch, against the
// same endpoint with the `kind` it asks for. `textOf(row)` is the text a
// row is summarised from and `needs(text)` whether it is worth a call.
function createSummaries({ storageKey, kind, textOf, needs }) {
  const cache = new Map(); // key -> bullets[]
  const inFlight = new Set(); // keys being fetched
  const failed = new Map(); // key -> error message, so a bad answer isn't re-asked every render
  const listeners = new Set();

  try {
    const raw = JSON.parse(localStorage.getItem(storageKey) || '{}');
    if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw)) {
        if (Array.isArray(v) && v.length) cache.set(k, v.map(String));
      }
    }
  } catch { /* no storage: start empty */ }

  function persist() {
    try {
      const entries = [...cache.entries()].slice(-MAX_STORED);
      localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(entries)));
    } catch { /* storage full or blocked: the in-memory cache still works */ }
  }

  function notify() {
    for (const fn of listeners) fn();
  }

  async function fetchBatch(batch) {
    for (const it of batch) inFlight.add(it.key);
    notify();
    try {
      const r = await apiFetch('/api/summarize-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, items: batch.map(it => ({ id: it.key, text: it.text })) }),
      });
      const txt = await r.text();
      let data = null;
      try { data = JSON.parse(txt); } catch { data = null; }
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
      const got = data?.summaries || {};
      for (const it of batch) {
        if (Array.isArray(got[it.key]) && got[it.key].length) {
          cache.delete(it.key);
          cache.set(it.key, got[it.key].map(String));
        } else {
          failed.set(it.key, 'No summary returned');
        }
      }
      persist();
    } catch (err) {
      for (const it of batch) failed.set(it.key, err?.message || 'Could not summarize');
    } finally {
      for (const it of batch) inFlight.delete(it.key);
      notify();
    }
  }

  const infoOf = (r) => {
    const text = textOf(r);
    return { text, key: needs(text) ? summaryKey(text) : null };
  };

  /**
   * For each row, what its cell should show:
   *   { text, bullets: string[] | null, status: 'empty'|'short'|'ready'|'loading'|'error', error? }
   * Returned as a lookup by row (`get(row)`), so a table column's render can
   * ask for its own row without the hook knowing about columns. A row the
   * hook wasn't handed (a copy made after) is read off its own text.
   */
  return function useSummaries(rows, { enabled = true } = {}) {
    const [tick, setTick] = useState(0);
    useEffect(() => {
      const fn = () => setTick(t => t + 1);
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    }, []);

    // Each row's text and key, computed once per rows change.
    const info = useMemo(() => {
      const m = new Map();
      for (const r of rows || []) m.set(r, infoOf(r));
      return m;
    }, [rows]);

    useEffect(() => {
      if (!enabled) return;
      const want = new Map();
      for (const { text, key } of info.values()) {
        if (!key || cache.has(key) || inFlight.has(key) || failed.has(key)) continue;
        want.set(key, { key, text });
      }
      if (want.size === 0) return;
      // Sequential batches: a table of a hundred opps is four quiet calls,
      // not four at once against the rate limit.
      (async () => {
        for (const batch of chunk([...want.values()], BATCH)) await fetchBatch(batch);
      })();
    }, [info, enabled]);

    return useMemo(() => ({
      get(row) {
        const i = info.get(row) || infoOf(row);
        if (!i.text) return { text: '', bullets: null, status: 'empty' };
        if (!i.key) return { text: i.text, bullets: null, status: 'short' };
        if (cache.has(i.key)) return { text: i.text, bullets: cache.get(i.key), status: 'ready' };
        if (failed.has(i.key)) return { text: i.text, bullets: null, status: 'error', error: failed.get(i.key) };
        return { text: i.text, bullets: null, status: 'loading' };
      },
    // `tick` changes on every cache update, so the lookup re-reads it.
    }), [info, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  };
}

/** Opps' running notes (Next Steps), as a few bullets each. */
export const useNotesSummaries = createSummaries({
  storageKey: STORAGE_KEY, kind: 'notes', textOf: oppNotesText, needs: needsSummary,
});

// v1: the first Scope summaries.
const SCOPE_STORAGE_KEY = 'scope-summary-cache:v1';

/** Opps' Scope, as one short line each (bullets[0]). */
export const useScopeSummaries = createSummaries({
  storageKey: SCOPE_STORAGE_KEY, kind: 'scope', textOf: oppScopeText, needs: needsScopeSummary,
});

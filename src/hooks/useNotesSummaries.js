// Summaries of opps' running notes for the Notes column on the New Opps
// and PE Opps subtabs, fetched from /api/summarize-notes as the rows come
// into view and cached by the text they summarise.
//
// The cache is module-level (so both subtabs, and a remount of either,
// share it) and mirrored to localStorage (so a reload doesn't pay for the
// same summaries again). A summary is keyed by a hash of the notes, so it
// is reused exactly as long as the notes haven't changed and no longer.
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../utils/apiFetch';
import { chunk, needsSummary, oppNotesText, summaryKey } from '../utils/notesSummary';

const STORAGE_KEY = 'notes-summary-cache:v1';
// Enough for every opp a person works, a few edits deep, without letting
// the stored map grow forever.
const MAX_STORED = 1500;
// Matches MAX_ITEMS in api/_lib/summarizeNotes.js.
const BATCH = 25;

const cache = new Map(); // key -> bullets[]
const inFlight = new Set(); // keys being fetched
const failed = new Map(); // key -> error message, so a bad answer isn't re-asked every render
const listeners = new Set();

try {
  const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) {
      if (Array.isArray(v) && v.length) cache.set(k, v.map(String));
    }
  }
} catch { /* no storage: start empty */ }

function persist() {
  try {
    const entries = [...cache.entries()].slice(-MAX_STORED);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
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
      body: JSON.stringify({ items: batch.map(it => ({ id: it.key, text: it.text })) }),
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

/**
 * For each row, what its Notes cell should show:
 *   { text, bullets: string[] | null, status: 'empty'|'short'|'ready'|'loading'|'error', error? }
 * Returned as a lookup by row (`get(row)`), so a table column's render can
 * ask for its own row without the hook knowing about columns.
 */
export function useNotesSummaries(rows, { enabled = true } = {}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick(t => t + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);

  // Each row's notes text and key, computed once per rows change.
  const info = useMemo(() => {
    const m = new Map();
    for (const r of rows || []) {
      const text = oppNotesText(r);
      m.set(r, { text, key: needsSummary(text) ? summaryKey(text) : null });
    }
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
      const i = info.get(row) || { text: oppNotesText(row), key: null };
      if (!i.text) return { text: '', bullets: null, status: 'empty' };
      if (!i.key) return { text: i.text, bullets: null, status: 'short' };
      if (cache.has(i.key)) return { text: i.text, bullets: cache.get(i.key), status: 'ready' };
      if (failed.has(i.key)) return { text: i.text, bullets: null, status: 'error', error: failed.get(i.key) };
      return { text: i.text, bullets: null, status: 'loading' };
    },
  // `tick` changes on every cache update, so the lookup re-reads it.
  }), [info, tick]); // eslint-disable-line react-hooks/exhaustive-deps
}

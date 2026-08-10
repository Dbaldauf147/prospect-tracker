// Market Updates saved on the Draft Emails page: one entry per email dropped
// onto the tab, with its attachments kept alongside the draft built from it.
//
// IndexedDB rather than Firestore. Attachments are routinely several MB —
// a research PDF, a rate deck — which is past Firestore's per-document cap
// and would need the same chunk-and-reassemble machinery the Indicative
// Savings analyses use. These are working drafts on the machine you dropped
// them on, so the local store is the right size of tool. Keys are scoped per
// user by db.js, so two accounts on one browser don't see each other's.

import { dbGet, dbPut } from './db';

const STORE = 'market-updates';
const KEY = 'entries';

export const MARKET_UPDATES_EVENT = 'market-updates-changed';

function notify() {
  try { window.dispatchEvent(new Event(MARKET_UPDATES_EVENT)); } catch { /* SSR / no window */ }
}

/** Every saved entry, newest first. Returns [] when nothing is stored. */
export async function loadMarketUpdates() {
  try {
    const raw = await dbGet(STORE, KEY);
    const list = Array.isArray(raw) ? raw : [];
    return [...list].sort((a, b) => (b?.savedAt || 0) - (a?.savedAt || 0));
  } catch {
    return [];
  }
}

async function writeAll(entries) {
  await dbPut(STORE, entries, KEY);
  notify();
  return entries;
}

/**
 * Insert or replace one entry, keyed by id. Returns the full list, newest
 * first, so a caller can set state from the result without a second read.
 */
export async function saveMarketUpdate(entry) {
  if (!entry?.id) throw new Error('A market update needs an id.');
  const list = await loadMarketUpdates();
  const next = list.filter(e => e.id !== entry.id);
  next.unshift({ ...entry, savedAt: entry.savedAt || Date.now() });
  await writeAll(next);
  return next.sort((a, b) => (b?.savedAt || 0) - (a?.savedAt || 0));
}

export async function deleteMarketUpdate(id) {
  const list = await loadMarketUpdates();
  const next = list.filter(e => e.id !== id);
  await writeAll(next);
  return next;
}

// A stable id for a newly dropped email. Time-based so entries sort by when
// they arrived even before savedAt is read.
export function newMarketUpdateId() {
  return `mu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

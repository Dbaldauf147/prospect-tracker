// Market Updates saved on the Draft Emails page: one entry per email dropped
// onto the tab, with its attachments kept alongside the draft built from it.
//
// IndexedDB for the fast local copy, plus a Firestore copy per entry.
// Attachments are routinely several MB — a research PDF, a rate deck —
// which is past Firestore's per-document cap, so the copy goes through
// utils/chunkedDoc: a chunk per document, and the Blob rides over inside
// the same tagged encoding the downloaded backup file uses.
//
// Calling these "working drafts on the machine you dropped them on" was
// the reasoning for keeping them local. It was thin — a dropped email is
// the only copy of an attachment somebody sent you once — and it made
// clearing site data destroy them outright.
//
// One document per entry, not one for the whole list: an entry is what a
// user adds and deletes, and a 40 MB list rewritten on every save would
// cost the whole thing per drop.

import { collection, doc } from 'firebase/firestore';
import { db as firestore } from '../firebase';
import { dbGet, dbPut, getDbUserId } from './db';
import { deleteChunkedDoc, readChunkedCollection, writeChunkedDoc } from './chunkedDoc.js';

const STORE = 'market-updates';
const KEY = 'entries';

// A ceiling on what travels to Firestore. Past this an entry stays local
// (and in the downloaded backup) rather than costing sixty document writes
// on every save.
export const MARKET_UPDATE_MAX_SYNC_BYTES = 25 * 1024 * 1024;

function entryDoc(userId, id) {
  return doc(firestore, 'marketUpdates', String(userId), 'entries', String(id));
}

function entriesCol(userId) {
  return collection(firestore, 'marketUpdates', String(userId), 'entries');
}

// Roughly how big an entry is, for the cap above. Blob sizes are exact;
// the rest is text whose JSON length is close enough to judge by.
function entryBytes(entry) {
  let n = 0;
  const walk = (v) => {
    if (!v) return;
    if (typeof Blob !== 'undefined' && v instanceof Blob) { n += v.size; return; }
    if (ArrayBuffer.isView(v)) { n += v.byteLength; return; }
    if (v instanceof ArrayBuffer) { n += v.byteLength; return; }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v === 'object') { Object.values(v).forEach(walk); return; }
    if (typeof v === 'string') n += v.length;
  };
  walk(entry);
  return n;
}

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
  const saved = { ...entry, savedAt: entry.savedAt || Date.now() };
  next.unshift(saved);
  await writeAll(next);
  void backUpEntry(saved);
  return next.sort((a, b) => (b?.savedAt || 0) - (a?.savedAt || 0));
}

// Best-effort and deliberately not awaited by the save: the entry is
// already in IndexedDB, and a slow upload of a 20 MB attachment must not
// hold up the tab the user is still typing in.
async function backUpEntry(entry) {
  const userId = getDbUserId();
  if (!userId || !entry?.id) return;
  const bytes = entryBytes(entry);
  if (bytes > MARKET_UPDATE_MAX_SYNC_BYTES) {
    console.warn(`Market update ${entry.id} is ${bytes} bytes — too big to back up to Firestore; it stays on this device.`);
    return;
  }
  try {
    await writeChunkedDoc(entryDoc(userId, entry.id), entry, {
      meta: { savedAt: entry.savedAt || Date.now(), subject: String(entry.subject || '').slice(0, 200) },
    });
  } catch (err) {
    console.warn('Market update Firestore backup failed', entry.id, err);
  }
}

export async function deleteMarketUpdate(id) {
  const list = await loadMarketUpdates();
  const next = list.filter(e => e.id !== id);
  await writeAll(next);
  const userId = getDbUserId();
  if (userId && id) {
    try { await deleteChunkedDoc(entryDoc(userId, id)); }
    catch (err) { console.warn('Market update Firestore delete failed', id, err); }
  }
  return next;
}

/**
 * Pull down every entry this browser is missing and merge them in by id.
 * Called once at signin — a cleared browser has nothing to prompt a
 * per-entry fetch, since the page only knows about entries it can see.
 *
 * A local entry always wins: it is the one being edited on this machine.
 */
export async function hydrateMarketUpdates(userId) {
  if (!userId) return 0;
  let remote;
  try { remote = await readChunkedCollection(entriesCol(userId)); }
  catch (err) { console.warn('Market updates restore failed', err); return 0; }
  const list = await loadMarketUpdates();
  const have = new Set(list.map(e => e?.id));
  const missing = remote.map(r => r.value).filter(v => v?.id && !have.has(v.id));
  if (!missing.length) return 0;
  await writeAll([...list, ...missing].sort((a, b) => (b?.savedAt || 0) - (a?.savedAt || 0)));
  return missing.length;
}

// A stable id for a newly dropped email. Time-based so entries sort by when
// they arrived even before savedAt is read.
export function newMarketUpdateId() {
  return `mu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// History of every SIA workbook loaded on the Pricing page. One entry per
// load (see siaHistoryEntry.js for what it holds), so a past SIA's sites,
// accounts and cost lines can be looked up after the page has moved on to
// another file.
//
// IndexedDB for the local copy plus a chunked Firestore mirror, the same
// pairing oppPricingSourceFile uses, so the history survives a cleared
// browser and follows you to the other machine.

import { collection, doc } from 'firebase/firestore';
import { db as firestore } from '../firebase';
import { dbDelete, dbGetAllEntries, dbPut, getDbUserId } from './db';
import { deleteChunkedDoc, readChunkedCollection, writeChunkedDoc } from './chunkedDoc.js';
import { mergeSiaHistory, siaHistorySummary } from './siaHistoryEntry.js';

const STORE = 'sia-load-history';
export const SIA_HISTORY_EVENT = 'pricing:siaHistoryChanged';

function itemsCol(userId) {
  return collection(firestore, 'siaLoadHistory', String(userId), 'items');
}

function announce() {
  try { window.dispatchEvent(new CustomEvent(SIA_HISTORY_EVENT)); } catch { /* not in a browser */ }
}

export async function saveSiaHistoryEntry(entry) {
  if (!entry?.id) return;
  await dbPut(STORE, entry, entry.id);
  announce();
  const userId = getDbUserId();
  if (!userId) return;
  // Best-effort: an offline browser keeps the local copy and the next
  // listing on this device still shows it.
  try {
    const s = siaHistorySummary(entry);
    await writeChunkedDoc(doc(itemsCol(userId), entry.id), entry, {
      meta: { fileName: entry.fileName, loadedAt: entry.loadedAt, costLines: s.costLines },
    });
  } catch (err) {
    console.warn('SIA history Firestore backup failed', entry.id, err);
  }
}

// Local entries straight away; `onRemote` is called again with the merged
// list once the Firestore copy answers (entries loaded on another machine,
// or before this browser's data was cleared). Those are cached locally.
export async function listSiaHistory({ onRemote } = {}) {
  let local = [];
  try { local = (await dbGetAllEntries(STORE)).map(e => e.value); }
  catch (err) { console.warn('SIA history local read failed', err); }
  const merged = mergeSiaHistory(local);
  const userId = getDbUserId();
  if (userId && onRemote) {
    Promise.resolve()
      .then(() => readChunkedCollection(itemsCol(userId)))
      .then(async (rows) => {
        const remote = rows.map(r => r.value).filter(v => v?.id);
        const have = new Set(local.map(e => e.id));
        for (const e of remote) {
          if (!have.has(e.id)) { try { await dbPut(STORE, e, e.id); } catch { /* cache only */ } }
        }
        onRemote(mergeSiaHistory(local, remote));
      })
      .catch(err => console.warn('SIA history Firestore read failed', err));
  }
  return merged;
}

export async function deleteSiaHistoryEntry(id) {
  if (!id) return;
  try { await dbDelete(STORE, id); } catch { /* best-effort */ }
  announce();
  const userId = getDbUserId();
  if (!userId) return;
  try { await deleteChunkedDoc(doc(itemsCol(userId), id)); }
  catch (err) { console.warn('SIA history Firestore delete failed', id, err); }
}

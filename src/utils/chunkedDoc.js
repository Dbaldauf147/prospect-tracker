// A value too big for one Firestore document, stored as a parent document
// plus a `chunks` subcollection.
//
// Firestore caps a DOCUMENT at 1 MiB — the whole document, not each field.
// Two stores in this app got that wrong and split their payload across
// `chunk0`, `chunk1`, … fields on a single document, which means the write
// fails the moment there is more than one chunk. listBackupSync even says
// so out loud ("bounded only by the per-doc field count (1500), so up to
// ~900MB"); what actually happens is that every list past ~600 KB of JSON
// — CDP, GRESB, the ones big enough to hurt to lose — fails to back up,
// and because the caller fire-and-forgets the promise, nothing says a word.
// The same is true of any RFP workbook over about a megabyte.
//
// So: one implementation, doing what localMirrorSync and opps2Store already
// do correctly — a chunk per document, under the parent. Callers hand over
// a value and get it back; the chunking is not their problem.
//
// Values ride through the tagged encoding in utils/fullBackup, so a payload
// can hold Blobs (an email attachment, a workbook) and typed arrays and
// still be JSON on the wire. That is the same encoding the downloaded
// backup file uses — one way of writing this app's data down, not two.
//
// Reads accept the legacy inline-chunk layout so backups written by the old
// code still restore. Nothing writes it any more.

import { collection, deleteDoc, doc, getDoc, getDocs, writeBatch } from 'firebase/firestore';
import { decodeValue, encodeValue } from './fullBackup.js';

// src/firebase.js reads import.meta.env and THROWS while it is still
// evaluating when the config is absent — which is every plain-Node
// context, including scripts/*.test.mjs. The batch writer is the only
// thing here that needs the database handle, so it is fetched on use,
// the same way localMirrorSync does it.
let dbPromise = null;
function getDb() {
  if (!dbPromise) dbPromise = import('../firebase.js').then((m) => m.db);
  return dbPromise;
}

// Under Firestore's ~1 MB per-document cap, with headroom for field names
// and metadata. Same numbers localMirrorSync settled on.
const CHUNK_BYTES = 700 * 1024;
const SINGLE_DOC_MAX_BYTES = 900 * 1024;

// Firestore takes at most 500 writes per batch; the parent needs one of
// them, and a margin keeps this honest if that ever changes.
const BATCH_LIMIT = 400;

// The OTHER cap on a commit, and the one that actually bites here: the
// whole write request may not exceed 11 MiB ("Request payload size exceeds
// the limit: 11534336 bytes"). Writes per batch is not the binding limit
// when each write carries 700 KB — sixteen chunks is already over, and the
// commit is rejected WHOLE, so nothing is written at all.
//
// That is this module's own version of the mistake it was written to fix.
// A list past ~11 MB of JSON — CDP, GRESB, the big compliance exports, the
// ones it hurts to lose — sent every chunk in one commit, got it refused,
// and reported nothing: saveListBackup fire-and-forgets, so the list looked
// backed up and was not. Clearing site data then took it for good.
//
// 8 MiB leaves room for document paths, field names and protobuf framing,
// none of which are in the string length being measured.
const BATCH_MAX_BYTES = 8 * 1024 * 1024;

/**
 * How to divide `sizes` (the byte length of each chunk, in order) into
 * commits: a list of `[from, to)` index ranges, each within BOTH caps.
 *
 * A chunk bigger than the byte budget on its own still gets sent — it
 * cannot be split further from here, and CHUNK_BYTES keeps that from
 * arising — but it never has company.
 */
function planBatches(sizes) {
  const batches = [];
  let start = 0;
  let count = 0;
  let bytes = 0;
  for (let i = 0; i < sizes.length; i++) {
    if (count > 0 && (count >= BATCH_LIMIT || bytes + sizes[i] > BATCH_MAX_BYTES)) {
      batches.push([start, i]);
      start = i;
      count = 0;
      bytes = 0;
    }
    count += 1;
    bytes += sizes[i];
  }
  if (count > 0) batches.push([start, sizes.length]);
  return batches;
}

function utf8Len(str) {
  try { return new TextEncoder().encode(str).length; }
  catch { return str.length; }
}

// Split on BYTES, not characters: the cap Firestore enforces is bytes, and
// text that is mostly multi-byte can be three times its character length —
// which is how a "safely under 1 MB" chunk becomes a rejected write.
function splitByUtf8Bytes(str, maxBytes) {
  const parts = [];
  let i = 0;
  while (i < str.length) {
    let end = Math.min(str.length, i + maxBytes);
    // Never cut between the halves of a surrogate pair: neither half is a
    // valid character on its own, and what survives the round trip through
    // UTF-8 would not rejoin into the original.
    if (end < str.length) {
      const code = str.charCodeAt(end - 1);
      if (code >= 0xd800 && code <= 0xdbff) end -= 1;
    }
    while (end > i + 1 && utf8Len(str.slice(i, end)) > maxBytes) {
      // Overshoot is proportional to how multi-byte the text is, so scale
      // down by the measured ratio rather than stepping one char at a time.
      const over = utf8Len(str.slice(i, end)) / maxBytes;
      let next = i + Math.max(1, Math.floor((end - i) / Math.max(over, 1.05)));
      if (next >= end) next = end - 1;
      const code = str.charCodeAt(next - 1);
      end = (code >= 0xd800 && code <= 0xdbff) ? next - 1 : next;
    }
    // A budget too small to hold even one character would otherwise leave
    // end === i: an empty piece, and a loop that never advances. Emit the
    // whole character and go over budget instead. Unreachable at the sizes
    // this module uses, and the alternative is a hung tab.
    if (end <= i) {
      const code = str.charCodeAt(i);
      end = i + ((code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) ? 2 : 1);
    }
    parts.push(str.slice(i, end));
    i = end;
  }
  return parts;
}

async function dropChunks(ref, from, to) {
  for (let start = from; start < to; start += BATCH_LIMIT) {
    const batch = writeBatch(await getDb());
    for (let i = start; i < Math.min(start + BATCH_LIMIT, to); i++) {
      batch.delete(doc(ref, 'chunks', String(i)));
    }
    await batch.commit();
  }
}

/**
 * Write `value` at `ref`. `meta` is written onto the parent document as
 * plain fields, so a caller can list what it has (file names, row counts,
 * timestamps) without pulling every chunk down.
 *
 * Returns the encoded size in bytes.
 */
export async function writeChunkedDoc(ref, value, { meta = {} } = {}) {
  const json = JSON.stringify(await encodeValue(value));
  const bytes = utf8Len(json);
  const updatedAt = Date.now();

  let priorChunks = 0;
  try { priorChunks = Number((await getDoc(ref)).data()?.chunkCount) || 0; } catch { /* first write */ }

  if (bytes <= SINGLE_DOC_MAX_BYTES) {
    const batch = writeBatch(await getDb());
    batch.set(ref, { ...meta, chunkCount: 0, updatedAt, json });
    await batch.commit();
    await dropChunks(ref, 0, priorChunks);
    return bytes;
  }

  const parts = splitByUtf8Bytes(json, CHUNK_BYTES);
  for (const [from, to] of planBatches(parts.map(utf8Len))) {
    const batch = writeBatch(await getDb());
    for (let i = from; i < to; i++) {
      batch.set(doc(ref, 'chunks', String(i)), { s: parts[i] });
    }
    await batch.commit();
  }
  // The parent lands last, so a reader never sees a chunkCount whose chunks
  // are not all written yet.
  const parent = writeBatch(await getDb());
  parent.set(ref, { ...meta, chunkCount: parts.length, updatedAt, json: '' });
  await parent.commit();
  if (priorChunks > parts.length) await dropChunks(ref, parts.length, priorChunks);
  return bytes;
}

// The joined JSON string behind a parent snapshot, or null. `legacy` reads
// the inline `chunk0`/`chunk1`/… layout the old code wrote — it never
// spanned more than one document, so anything it holds is small enough to
// come back in one piece.
async function readJson(ref, snap) {
  const data = snap.data() || {};
  const n = Number(data.chunkCount) || 0;
  if (n > 0) {
    const parts = new Array(n).fill('');
    const chunks = await getDocs(collection(ref, 'chunks'));
    chunks.forEach((d) => {
      const i = Number(d.id);
      if (Number.isInteger(i) && i >= 0 && i < n) parts[i] = String(d.data()?.s || '');
    });
    const joined = parts.join('');
    // A chunkCount with no chunk documents behind it is a document written
    // in the LEGACY inline layout, where the count referred to `chunk0`…
    // fields on the document itself. Report nothing rather than an empty
    // string, so the caller falls through to its own legacy reader instead
    // of logging a parse failure on every load.
    return joined || null;
  }
  if (typeof data.json === 'string' && data.json) return data.json;
  return null;
}

/**
 * The value at `ref`, or null when there is nothing there. Returns
 * `{ value, meta, updatedAt }` — `meta` is the parent document's own
 * fields, minus the chunking bookkeeping.
 */
export async function readChunkedDoc(ref) {
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const json = await readJson(ref, snap);
  if (json == null) return null;
  let value;
  try { value = decodeValue(JSON.parse(json)); }
  catch (err) {
    console.warn('chunkedDoc: stored value could not be read back', ref.path, err);
    return null;
  }
  // eslint-disable-next-line no-unused-vars
  const { chunkCount, json: _json, updatedAt, ...meta } = snap.data() || {};
  return { value, meta, updatedAt: Number(updatedAt) || 0 };
}

/** Every document in `colRef`, decoded. Chunked entries are fetched too. */
export async function readChunkedCollection(colRef) {
  const snap = await getDocs(colRef);
  const out = [];
  for (const d of snap.docs) {
    const entry = await readChunkedDoc(d.ref);
    if (entry) out.push({ id: d.id, ...entry });
  }
  return out;
}

/** Remove a value and every chunk under it. */
export async function deleteChunkedDoc(ref) {
  let n = 0;
  try { n = Number((await getDoc(ref)).data()?.chunkCount) || 0; } catch { /* already gone */ }
  await dropChunks(ref, 0, n);
  await deleteDoc(ref);
}

/** Exported for the tests — the byte-accurate splitter is the fiddly part. */
export const __test__ = { splitByUtf8Bytes, utf8Len, planBatches, CHUNK_BYTES, SINGLE_DOC_MAX_BYTES, BATCH_LIMIT, BATCH_MAX_BYTES };

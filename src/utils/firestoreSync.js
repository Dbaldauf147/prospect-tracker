// `getDoc` is aliased: this module already has a local getDoc(id) helper
// that builds a prospect doc ref, and the two names would collide.
import { collection, doc, getDoc as fsGetDoc, setDoc, updateDoc, deleteDoc, getDocs, writeBatch, onSnapshot, serverTimestamp, disableNetwork, enableNetwork } from 'firebase/firestore';
import { db } from '../firebase';
// A ceiling on a Firestore call that might never settle — see the note on
// the analysis timeouts below for why a save needs one.
import { withTimeout, isTimeoutError } from './withTimeout.js';

// Subcollection path for analyses saved against a prospect. Kept
// separate from the prospect doc so the bulk subscribeToProspects
// query stays lean — a 500 KB base64 XLSX would otherwise multiply
// initial-load size across the whole list.
const ANALYSIS_DOC_ID = 'main';

const SHARED_COL = 'prospects';

// How two names are compared to decide they are the same company lives in
// utils/companyKey — pure, so the Google Sheets diff can share it without
// pulling the firebase SDK into that module. Re-exported here because this
// is where every caller already imports it from.
export { normalizeCompanyName, companyQualifier, identifyingQualifier, companyDedupeKey } from './companyKey.js';
import { companyDedupeKey } from './companyKey.js';
import { newSheetRows } from './sheetSyncDiff.js';
// The "richest record survives" ranking and the bulk-import plan live in
// utils/prospectMerge — pure, so the rules can be tested directly and the
// CSV import and the duplicate collapse cannot drift apart.
import { planProspectReconcile, prospectScore, createdMillis, isEmptyValue, MERGE_FIELDS } from './prospectMerge.js';
import { markImportedTier } from './tierSource.js';
// Chunk-doc ids, and the rule for which of them a finished save may delete.
// Pure and firebase-free so it can be tested on its own — see
// scripts/analysisChunks.test.mjs.
import {
  analysisChunkId,
  analysisChunkIds,
  isAnalysisChunkId,
  newAnalysisGen,
  planAnalysisPrune,
} from './analysisChunks.js';
export { prospectScore, MERGE_FIELDS, planProspectReconcile } from './prospectMerge.js';

// Admin uses the shared collection; everyone else gets their own
let _userId = null;
let _useShared = false;

export function setProspectsUser(uid, email) {
  _userId = uid;
  _useShared = (email === 'baldaufdan@gmail.com');
}

// True when this session's prospects live in the shared collection (the
// admin account) rather than a per-user one. Callers that write into
// `prospects` directly need to know which roster they are comparing
// against — see useSheetSync.
export function usesSharedProspects() {
  return _useShared;
}

function getCol() {
  if (_useShared) return collection(db, SHARED_COL);
  if (_userId) return collection(db, 'users', _userId, 'prospects');
  return collection(db, SHARED_COL);
}

function getDoc(id) {
  if (_useShared) return doc(db, SHARED_COL, id);
  if (_userId) return doc(db, 'users', _userId, 'prospects', id);
  return doc(db, SHARED_COL, id);
}

// The listener behind the whole roster. `onError` matters as much as
// `onChange`: when the snapshot fails (rules, an offline browser, an
// extension blocking firestore.googleapis.com) Firestore calls the error
// callback ONCE and then drops the listener -- no retry, no later
// delivery. Logging it and returning was enough to leave the app on
// "Loading prospects..." for good, so the failure is handed back to the
// caller to show.
export function subscribeToProspects(onChange, onError) {
  return onSnapshot(getCol(), (snap) => {
    const prospects = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    onChange(prospects);
  }, (err) => {
    console.error('Firestore prospects subscription error:', err);
    if (onError) onError(err);
  });
}

export async function addProspect(prospect) {
  const ref = doc(getCol());
  await setDoc(ref, {
    ...sanitizeFirestoreData(prospect),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

// Firestore rejects writes that contain a field with an empty name
// ("Document fields must not be empty") or an `undefined` value (the
// whole write fails). Stray "" / whitespace-only keys can ride in from
// imported docs — and merging two prospects folds the source's fields
// in wholesale — so scrub them recursively (nested maps and array
// elements included) before every write rather than trusting callers.
function isPlainObject(v) {
  if (!v || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}
function sanitizeFirestoreData(value) {
  if (Array.isArray(value)) return value.map(sanitizeFirestoreData);
  // Only descend into plain object maps. Special Firestore types
  // (Timestamp, GeoPoint, DocumentReference, FieldValue) and Dates must
  // pass through untouched — recursing would strip their prototype and
  // corrupt the stored value.
  if (isPlainObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      if (typeof k !== 'string' || k.trim() === '') continue;
      out[k] = sanitizeFirestoreData(v);
    }
    return out;
  }
  return value;
}

export async function updateProspect(id, updates) {
  await updateDoc(getDoc(id), {
    ...sanitizeFirestoreData(updates || {}),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteProspect(id) {
  await deleteDoc(getDoc(id));
}

// The ONE place an import may create prospect documents.
//
// Every importer used to hand-roll this — read the roster, decide what is
// missing, mint documents in batches — which meant each one answered "do
// we already have this company?" for itself. addProspect used
// companyDedupeKey while the two Google Sheets importers compared
// lowercased names character for character, so the timer-driven import
// minted a second account for every spelling variant, and the duplicate
// collapse (which uses the key) could not merge what it had made. The
// guard existed; the biggest writer went around it.
//
// Routing every importer through here is what keeps the rule single.
// scripts/prospectWrites.test.mjs fails the moment a module outside this
// one addresses the prospects collection again.
//
// `roster` is what the caller already has in memory (or via
// readAllProspects) — deliberately not read here, because a full
// collection read per import is what exhausted the project's Firestore
// quota before. Costs no writes at all when nothing is new.
export async function addProspectsIfNew(rows, roster, { batchSize = 450 } = {}) {
  const fresh = newSheetRows(rows, roster);
  const col = getCol();
  for (let i = 0; i < fresh.length; i += batchSize) {
    const batch = writeBatch(db);
    for (const p of fresh.slice(i, i + batchSize)) {
      const now = new Date().toISOString();
      // A tier from an import is not a choice — mark it so the Target
      // Accounts list outranks it (see utils/tierSource).
      batch.set(doc(col), { ...markImportedTier(p), createdAt: now, updatedAt: now });
    }
    await batch.commit();
  }
  return { added: fresh.length, skipped: (rows?.length || 0) - fresh.length, fresh };
}

// The whole roster, straight from Firestore. For the one caller that
// needs an authoritative answer rather than the subscription's copy: the
// manual "Sheets -> Website" pull can be pressed before the subscription
// has delivered, and an empty in-memory roster would read every sheet row
// as missing.
export async function readAllProspects() {
  const snap = await getDocs(getCol());
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Write backed-up company records back, keyed by their original document
// id. Restoring is recovery, not reconciliation: it never deletes a record
// that exists today and isn't in the file, and it keeps ids intact because
// settings.targetMap / divisionsMap / hqRegionMap are keyed by them — a
// restore that minted new ids would orphan every mapping it touched, the
// same way replaceAllProspects used to. Returns how many were written.
export async function restoreProspectDocs(rows, { batchSize = 400 } = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter(r => r && r.id);
  for (let i = 0; i < list.length; i += batchSize) {
    const batch = writeBatch(db);
    for (const row of list.slice(i, i + batchSize)) {
      const { id, ...data } = row;
      batch.set(getDoc(id), data, { merge: true });
    }
    await batch.commit();
  }
  return list.length;
}

function waitFrame() {
  return new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

// Make the roster match an uploaded file.
//
// Replaces replaceAllProspects, which deleted every document and wrote
// the rows back as new ones. Every record got a NEW document id, and
// settings.targetMap / divisionsMap / hqRegionMap are all keyed by
// document id — so one upload orphaned every Target Account mapping,
// division and HQ region on the roster at once, and nothing could repair
// it afterwards: orphaned mappings are not duplicates, so the duplicate
// collapse had nothing to merge.
//
// A company in both the file and the roster now keeps its document, and
// with it every mapping pointed at that document. See
// planProspectReconcile for what counts as "in both".
//
// `confirm` is called with the counts BEFORE anything is written and can
// abort the import — so what the user is shown is what actually happens,
// planned against the live collection rather than a possibly-stale
// in-memory copy. Returns the counts, plus loser-to-keeper `remaps` for
// records that were already duplicates of each other so the caller can
// move their id-keyed settings instead of orphaning them.
export async function reconcileAllProspects(newProspects, { onProgress, confirm } = {}) {
  const snap = await getDocs(getCol());
  const existing = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const plan = planProspectReconcile(newProspects, existing);

  if (confirm && !(await confirm(plan.counts))) {
    return { ...plan.counts, remaps: [], cancelled: true };
  }

  const totalSteps = plan.updates.length + plan.creates.length + plan.deletes.length;
  let completed = 0;
  async function report(phase) {
    const pct = totalSteps ? Math.round((completed / totalSteps) * 100) : 100;
    if (onProgress) onProgress(`${phase} · ${pct}%`);
    // Yield to browser so UI can repaint
    await waitFrame();
  }

  // Writes before deletes: a failure part-way through then leaves the
  // roster with extra records rather than missing ones.
  //
  // merge:true because the uploaded row only carries the columns the file
  // has. A full overwrite would wipe everything the app knows and the CSV
  // does not — PE stage, portfolio companies, scoping notes. The parser
  // omits blank cells entirely, so an empty column never blanks a value.
  for (let i = 0; i < plan.updates.length; i += 400) {
    const batch = writeBatch(db);
    plan.updates.slice(i, i + 400).forEach(u => {
      batch.set(getDoc(u.id), { ...u.record, updatedAt: serverTimestamp() }, { merge: true });
    });
    await batch.commit();
    completed += Math.min(400, plan.updates.length - i);
    await report('Updating existing companies');
  }

  for (let i = 0; i < plan.creates.length; i += 400) {
    const batch = writeBatch(db);
    plan.creates.slice(i, i + 400).forEach(p => {
      // Same as the sheet importers: a tier that arrived in a file
      // column defers to the Targets list. Only on records being
      // created — a company already on the roster may carry a tier
      // someone chose, and a bulk file is no reason to demote it.
      batch.set(doc(getCol()), { ...markImportedTier(p), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    });
    await batch.commit();
    completed += Math.min(400, plan.creates.length - i);
    await report('Adding new companies');
  }

  for (let i = 0; i < plan.deletes.length; i += 400) {
    const batch = writeBatch(db);
    plan.deletes.slice(i, i + 400).forEach(id => batch.delete(getDoc(id)));
    await batch.commit();
    completed += Math.min(400, plan.deletes.length - i);
    await report('Removing companies not in the file');
  }

  return { ...plan.counts, remaps: plan.remaps, cancelled: false };
}

// Group an in-memory prospect array by normalized company name and
// return only the groups with more than one record — i.e. duplicates.
// Pure (no Firestore I/O), so callers that already hold the live list
// from the subscription can detect duplicates for free. Each group is
// sorted richest-first so the first element is the keeper.
export function groupDuplicateProspects(list) {
  const byKey = new Map();
  for (const p of (list || [])) {
    const key = companyDedupeKey(p?.company);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(p);
  }
  const groups = [];
  for (const [key, docs] of byKey) {
    if (docs.length < 2) continue;
    docs.sort((a, b) => {
      const ds = prospectScore(b) - prospectScore(a);
      if (ds !== 0) return ds;
      return createdMillis(a) - createdMillis(b); // tie-break: oldest first
    });
    groups.push({ key, docs });
  }
  return groups;
}

// Collapse the given duplicate groups: keep the richest record, backfill
// any fields it lacks from the copies, then delete the extras. Only
// touches Firestore when there is something to merge or remove.
export async function collapseDuplicateGroups(groups) {
  let removed = 0;
  const merged = [];
  // loser-id → keeper-id for every removed duplicate. Prospect record
  // fields are backfilled onto the keeper below, but ID-keyed maps that
  // live in the *settings* doc (Target Account mappings, divisions, HQ
  // regions) aren't reachable from here — callers use these remaps to move
  // those entries onto the keeper so a mapping stored on a removed copy
  // isn't silently orphaned.
  const remaps = [];
  for (const { docs } of (groups || [])) {
    const keeper = docs[0];
    const losers = docs.slice(1);
    // Backfill empty keeper fields from the duplicates being removed.
    const patch = {};
    for (const field of MERGE_FIELDS) {
      if (!isEmptyValue(keeper[field])) continue;
      for (const l of losers) {
        if (!isEmptyValue(l[field])) { patch[field] = l[field]; break; }
      }
    }
    if (Object.keys(patch).length > 0) await updateProspect(keeper.id, patch);
    for (const l of losers) remaps.push({ from: l.id, to: keeper.id });
    for (let i = 0; i < losers.length; i += 400) {
      const batch = writeBatch(db);
      losers.slice(i, i + 400).forEach(l => batch.delete(getDoc(l.id)));
      await batch.commit();
      removed += Math.min(400, losers.length - i);
    }
    merged.push({ company: keeper.company, removed: losers.length });
  }
  return { groups: groups?.length || 0, removed, merged, remaps };
}

// Read the live collection and return its duplicate groups. Used by the
// on-demand "Remove duplicates" button, which wants fresh server state
// rather than whatever the client currently holds.
export async function findDuplicateProspects() {
  const snap = await getDocs(getCol());
  const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return groupDuplicateProspects(list);
}

// Collapse duplicates by reading fresh from Firestore first. For the
// per-load auto-cleanup, prefer collapseDuplicateGroups() with the
// already-subscribed list so no extra read is incurred.
export async function dedupeProspects() {
  const groups = await findDuplicateProspects();
  return collapseDuplicateGroups(groups);
}

function getAnalysisCol(prospectId) {
  if (_useShared) return collection(db, SHARED_COL, prospectId, 'analyses');
  if (_userId) return collection(db, 'users', _userId, 'prospects', prospectId, 'analyses');
  return collection(db, SHARED_COL, prospectId, 'analyses');
}

// Base64 chars per chunk doc, largest first. Base64 is ASCII (1 byte/char)
// so this is also the document's size in bytes, under Firestore's ~1 MiB
// per-document cap.
//
// A ladder rather than one number, because "the database never answered"
// turned out to have two causes that look identical from the page and have
// opposite fixes. A browser that cannot reach Firestore at all fails every
// write, small or large. A connection that carries small writes fine but
// drops a 700 KB one — a proxy or gateway with a request-body cap, which is
// the ordinary shape of a corporate network — fails only the workbook, and
// only because of how it was cut up. The second one is ours to fix: cut it
// smaller and it goes through. So a stalled upload drops to the next size
// down and tries again rather than declaring the save impossible.
//
// 700 KiB first because that is what every other chunked store in this app
// settled on (chunkedDoc, localMirrorSync, opps2Store) and it is one
// document per 700 KB. The lower rungs cost more documents for the same
// workbook, which is a real cost — but not against a save that cannot
// happen at all.
//
// Reads are unaffected by any of this: `main` records the chunk count that
// was written, so an analysis saved at any size still reassembles.
const ANALYSIS_CHUNK_SIZES = [700 * 1024, 200 * 1024, 64 * 1024];

// A few bytes written to the same collection before the workbook, so the
// two failures above can be told apart while it still matters — by the
// page, in the message it shows, rather than by whoever reads the console
// afterwards.
const ANALYSIS_PROBE_DOC_ID = 'probe';
const ANALYSIS_PROBE_TIMEOUT_MS = 12_000;

// Ceilings for the round-trips a save makes.
//
// setDoc resolves on SERVER acknowledgement. A client that cannot reach
// firestore.googleapis.com — a wedged long-poll, a VPN or proxy, an
// extension blocking Google domains, or a project over its daily quota
// (writes come back RESOURCE_EXHAUSTED, which the SDK retries forever) —
// queues the write locally and leaves that promise pending for the life of
// the tab. It never rejects, so the caller's try/catch never runs: the
// Utility Lookup page sat on "Saving 0.6 MB to <company>…" with nothing to
// click and nothing in the console. getDoc sits the same way when the
// document isn't cached.
const ANALYSIS_READ_TIMEOUT_MS = 20_000;

// Applied to each chunk write, but scaled by the size of the WHOLE
// workbook: the chunks go up in parallel and share the link, so what a
// single one of them is worth waiting for depends on how much is in flight
// beside it — not on how many pieces the payload was cut into. (Scaling by
// the count instead meant dropping to smaller chunks bought a longer wait
// for the same bytes, which is backwards.)
const ANALYSIS_WRITE_TIMEOUT_MIN_MS = 30_000;
const ANALYSIS_WRITE_TIMEOUT_MAX_MS = 6 * 60_000;
const analysisWriteTimeout = (totalChars) => Math.min(
  ANALYSIS_WRITE_TIMEOUT_MAX_MS,
  Math.max(ANALYSIS_WRITE_TIMEOUT_MIN_MS, 30_000 + (totalChars / (1024 * 1024)) * 20_000),
);

// Tear the client's connection down and bring it back up.
//
// When a save stalls, the SDK is not "offline" — it believes it has a
// connection and is waiting on a stream that will never answer, which is
// why the promises neither resolve nor reject. Firestore has no way to ask
// "is this stream still alive"; disableNetwork() closes the streams and
// discards that belief (queued writes are kept), and enableNetwork() opens
// fresh ones. It is the one lever a client has for a wedged transport, so a
// retry that doesn't pull it is a retry onto the same dead stream.
//
// Both calls are local state changes, but they are bounded anyway: this
// runs on the path taken because something that should have answered
// didn't. Best-effort throughout — a failure here just means the retry
// tries its luck on the connection it had.
export async function kickFirestoreConnection() {
  try {
    await withTimeout(disableNetwork(db), 5_000, 'closing the database connection');
    await withTimeout(enableNetwork(db), 5_000, 'reopening the database connection');
    return true;
  } catch (err) {
    console.warn('Could not restart the Firestore connection:', err?.message || err);
    // Never leave the client offline because the reopen went wrong: that
    // would take the rest of the app down with the save. Unawaited on
    // purpose — this is the path where waiting is what went wrong.
    enableNetwork(db).catch(() => {});
    return false;
  }
}

// Small sibling doc listing the generations whose chunks are on the server
// but that `main` does not point at: the one currently being written, and
// any left behind by a save that died partway.
//
// It exists so a save never has to read the collection to find what it may
// delete. It used to getDocs() the whole `analyses` collection for that,
// which downloaded every stored chunk's base64 — the previous workbook in
// full, plus every generation an earlier prune had failed to remove —
// before the new one could start uploading. On a portfolio that had been
// saved a few times that read was several megabytes of pure waste on the
// critical path, and it grew with every save.
const ANALYSIS_PENDING_DOC_ID = 'pending';

// One-off cleanup for a prospect whose analyses predate the pending doc:
// those collections can hold orphan chunks under generations nothing ever
// recorded, and their ids can only be learned by listing. Runs at most once
// per prospect (the pending doc's absence is what marks it), detached from
// the save so the user never waits on it.
async function sweepLegacyAnalysisChunks(col, liveGen) {
  try {
    // Re-read the two bookkeeping docs first: a save on another device may
    // have swung `main` over, or be part-way through writing its chunks, in
    // the time this sweep took to start. Those generations are spared —
    // everything else under a chunk id is an orphan nothing can reach.
    const [mainSnap, pendingSnap] = await Promise.all([
      fsGetDoc(doc(col, ANALYSIS_DOC_ID)),
      fsGetDoc(doc(col, ANALYSIS_PENDING_DOC_ID)),
    ]);
    const spared = new Set([liveGen]);
    const currentGen = mainSnap.exists() ? mainSnap.data()?.gen : '';
    if (typeof currentGen === 'string' && currentGen) spared.add(currentGen);
    for (const e of (Array.isArray(pendingSnap.data()?.gens) ? pendingSnap.data().gens : [])) {
      if (typeof e?.gen === 'string' && e.gen) spared.add(e.gen);
    }
    const all = await getDocs(col);
    const stale = all.docs.filter((d) => (
      isAnalysisChunkId(d.id) && ![...spared].some((g) => d.id.startsWith(`chunk-${g}-`))
    ));
    await Promise.all(stale.map((d) => deleteDoc(d.ref)));
  } catch (err) {
    console.warn('Analysis legacy chunk sweep failed (old chunks left behind):', err);
  }
}

// Base64 length for a payload of `sizeBytes`: 4 characters per 3 bytes,
// padded up. Lets a read check the reassembled string against the size the
// writer recorded without decoding it first.
const base64LenForBytes = (sizeBytes) => Math.ceil(Number(sizeBytes || 0) / 3) * 4;

// Persist an Indicative Savings XLSX (base64) against a prospect. The
// payload is split across sibling `chunk-<i>` docs in the analyses
// subcollection so it can exceed Firestore's ~1 MiB single-document cap;
// the `main` doc holds only metadata + the chunk count. Chunk docs sit
// alongside `main` (not nested under it) so they're covered by the same
// /analyses/{analysisId} security rule — no rules change required.
export async function saveIndicativeAnalysis(
  prospectId,
  { fileName, dataBase64, sizeBytes },
  // The ceilings and the chunk ladder are the module's, taken as options so
  // a test can prove they work without sitting through one.
  {
    onPhase,
    readTimeoutMs = ANALYSIS_READ_TIMEOUT_MS,
    writeTimeoutMs,
    probeTimeoutMs = ANALYSIS_PROBE_TIMEOUT_MS,
    chunkSizes = ANALYSIS_CHUNK_SIZES,
  } = {},
) {
  const col = getAnalysisCol(prospectId);
  const data = String(dataBase64 || '');
  // Which step the save is on, so the page can name it. Every step below
  // can be the one that doesn't come back, and "Saving…" doesn't say which.
  const phase = (step, extra) => { try { onPhase?.({ step, ...extra }); } catch { /* never fail a save on its own progress report */ } };
  const writeMs = writeTimeoutMs ?? analysisWriteTimeout(data.length);

  // Can this browser write to this collection AT ALL? A few bytes answers
  // it in well under a second on any working connection, and the answer
  // decides what a stalled upload means: with the probe through, the
  // connection works and it is the SIZE of the write that isn't getting
  // there; without it, nothing is, and no amount of re-cutting the workbook
  // will help.
  phase('probing');
  const probe = await probeAnalysisWrite(col, probeTimeoutMs);
  phase('probed', { ok: probe.ok, ms: probe.ms });
  console.log(probe.ok
    ? `Save to company · a test write was acknowledged in ${probe.ms}ms`
    : `Save to company · a test write got no answer in ${probe.ms}ms (${probe.error?.message || 'failed'})`);

  // Largest chunks first, stepping down each time an upload stalls. Only
  // worth stepping down at all when the probe got through: if a few bytes
  // don't land, 64 KiB won't either, and three attempts would just be three
  // times the wait before saying so.
  const ladder = probe.ok ? chunkSizes : chunkSizes.slice(0, 1);
  let lastErr = null;
  for (let attempt = 0; attempt < ladder.length; attempt += 1) {
    try {
      await uploadAnalysisGeneration({
        col, data, fileName, sizeBytes,
        chunkSize: ladder[attempt],
        // First attempt goes up in parallel, which is what makes a normal
        // save quick. Every attempt after it goes one document at a time:
        // the SDK batches queued mutations into a single request, so four
        // 200 KB chunks written at once are one 800 KB request — the very
        // thing the step down was supposed to avoid. Serialising is what
        // actually makes the request smaller, and by then speed has stopped
        // being the thing worth optimising for.
        sequential: attempt > 0,
        phase, writeMs, readTimeoutMs,
      });
      return;
    } catch (err) {
      lastErr = err;
      // Only a stall is worth re-cutting the workbook for. A rejection
      // (permissions, a malformed document) says what is wrong and would
      // say it again at every size.
      if (!isTimeoutError(err) || attempt === ladder.length - 1) break;
      const next = ladder[attempt + 1];
      console.warn(
        `Analysis upload stalled at ${Math.round(ladder[attempt] / 1024)} KB chunks; `
        + `retrying at ${Math.round(next / 1024)} KB:`, err.message,
      );
      phase('shrinking', { from: ladder[attempt], to: next });
      // A stall is the SDK waiting on a stream it still believes in, so the
      // smaller chunks deserve a fresh one to go out on.
      await kickFirestoreConnection();
    }
  }
  // What the probe learned rides along on the error: it is the difference
  // between "your connection is dropping large requests" and "this browser
  // cannot reach the database", and only the caller can say either.
  if (lastErr) lastErr.probeOk = probe.ok;
  throw lastErr;
}

// A few bytes to the analyses collection, to find out whether writing to it
// works at all. Never throws — the answer is the return value, because both
// outcomes are information the save wants rather than reasons to stop.
async function probeAnalysisWrite(col, timeoutMs) {
  const t0 = Date.now();
  try {
    await withTimeout(
      setDoc(doc(col, ANALYSIS_PROBE_DOC_ID), { at: Date.now() }),
      timeoutMs,
      'a test write',
    );
    return { ok: true, ms: Date.now() - t0, error: null };
  } catch (err) {
    return { ok: false, ms: Date.now() - t0, error: err };
  }
}

// One attempt at storing the workbook, at one chunk size, under its own
// generation. Rejects if any write stalls or fails; the previous analysis
// is untouched either way, because nothing here writes over the documents
// the current `main` points at until `main` itself is rewritten last.
async function uploadAnalysisGeneration({ col, data, fileName, sizeBytes, chunkSize, sequential = false, phase, writeMs, readTimeoutMs }) {
  const gen = newAnalysisGen();
  const chunks = [];
  for (let i = 0; i < data.length; i += chunkSize) chunks.push(data.slice(i, i + chunkSize));

  // Started here, deliberately NOT awaited: reading what is already stored
  // and recording this generation are both bookkeeping for the PRUNE at the
  // end. Neither is needed to write a new generation, and awaiting them put
  // two server round-trips in front of the first uploaded byte — which is
  // exactly where a save was found sitting, on "checking what is stored…",
  // when the browser could not reach Firestore at all. The upload starts
  // immediately now; the prune uses whatever this has learned by the time
  // the upload finishes, and cleans up on its own terms if it learned
  // nothing.
  const bookkeeping = readAnalysisBookkeeping(col, gen, chunks.length, { readTimeoutMs, writeTimeoutMs: writeMs });

  // Write every chunk first, then the `main` metadata doc LAST, so a live
  // subscriber only reassembles once all referenced chunks exist. Under a
  // fresh generation, so nothing here touches the docs the current `main`
  // points at — if any of these writes fails, the previous analysis is
  // still whole and still what readers get.
  let done = 0;
  phase('uploading', { done, total: chunks.length, chunkSize, sequential });
  const writeChunk = (c, i) => withTimeout(
    setDoc(doc(col, analysisChunkId(gen, i)), { i, gen, data: c }),
    writeMs,
    `uploading part ${i + 1} of ${chunks.length}`,
  ).then(() => { done += 1; phase('uploading', { done, total: chunks.length, chunkSize, sequential }); });
  if (sequential) {
    for (let i = 0; i < chunks.length; i += 1) await writeChunk(chunks[i], i);
  } else {
    await Promise.all(chunks.map(writeChunk));
  }
  // setDoc without merge so any legacy inline `dataBase64` on the main doc
  // is dropped when re-saving over an older single-doc analysis.
  phase('finalizing');
  await withTimeout(setDoc(doc(col, ANALYSIS_DOC_ID), {
    fileName,
    sizeBytes,
    chunkCount: chunks.length,
    gen,
    capturedAt: serverTimestamp(),
  }), writeMs, 'saving the analysis record');
  phase('saved');

  // The analysis is saved the moment `main` names the new generation —
  // everything below is bookkeeping about the generation it replaced, and
  // the caller is not made to wait on it. It used to be awaited, which put
  // a pile of deletes (each its own server round-trip, each able to hang on
  // exactly the connection that makes this worth guarding) between a
  // finished upload and the word "Saved".
  bookkeeping
    .then((bk) => pruneOldAnalysisChunks({ col, gen, ...bk }))
    .catch((err) => console.warn('Analysis chunk cleanup failed (old chunks left behind):', err));
}

// What the prune needs to know, gathered alongside the upload rather than
// in front of it: the generation `main` points at, and the generations a
// previous save left unreferenced. Between them they name every chunk this
// save may delete, by id, so nothing has to list (and download) the
// collection to find out.
//
// Also records this save's own generation on the `pending` doc, so an
// upload that dies partway leaves its chunk ids on record for the next save
// to clean up. That write no longer strictly precedes the chunks it
// describes — it races them — which costs the cleanup nothing in practice
// and buys the upload a round-trip it never had to wait for.
//
// Never rejects: a stalled read means no prune plan, which is a storage
// cost, not a failed save.
async function readAnalysisBookkeeping(col, gen, chunkCount, { readTimeoutMs, writeTimeoutMs }) {
  try {
    const [mainSnap, pendingSnap] = await withTimeout(Promise.all([
      fsGetDoc(doc(col, ANALYSIS_DOC_ID)),
      fsGetDoc(doc(col, ANALYSIS_PENDING_DOC_ID)),
    ]), readTimeoutMs, 'reading the saved analysis metadata');
    const prevMeta = mainSnap.exists() ? (mainSnap.data() || {}) : {};
    const pendingRaw = pendingSnap.exists() ? pendingSnap.data() : null;
    const priorPending = Array.isArray(pendingRaw?.gens) ? pendingRaw.gens : [];
    await withTimeout(setDoc(doc(col, ANALYSIS_PENDING_DOC_ID), {
      gens: [...priorPending, { gen, chunkCount, at: Date.now() }],
    }), writeTimeoutMs, 'recording the upload');
    return { prevMeta, priorPending, hadPendingDoc: pendingSnap.exists(), degraded: false };
  } catch (err) {
    // Nothing is known about what came before, so nothing may be deleted by
    // id and the pending list must not be overwritten with a shorter one.
    // The sweep, which reads the collection itself, cleans up instead.
    console.warn('Analysis bookkeeping did not complete; saving without a prune plan:', err?.message || err);
    return { prevMeta: {}, priorPending: [], hadPendingDoc: false, degraded: true };
  }
}

// Delete the chunks the save above orphaned, and tidy the pending list.
// Detached and best-effort: a failure here wastes storage but leaves the
// analysis readable, so it must never fail — or delay — the save.
async function pruneOldAnalysisChunks({ col, prevMeta, priorPending, gen, degraded, hadPendingDoc }) {
  // No prune plan (the bookkeeping reads didn't answer): touch nothing by
  // id and let the sweep, which reads the collection itself, do the work.
  if (degraded) { sweepLegacyAnalysisChunks(col, gen); return; }
  // The generation `main` pointed at is described by `main` itself; the
  // rest come off the pending list. An analysis written before generations
  // existed carries no `gen` and its chunks are plain `chunk-<i>`, which
  // analysisChunkId() still builds from an empty gen.
  const { ids: doomed, keep } = planAnalysisPrune({ prevMeta, pending: priorPending, liveGen: gen });
  try {
    if (doomed.length) await Promise.all(doomed.map((id) => deleteDoc(doc(col, id))));
    // This save's own entry comes off the list (`main` names it now); a
    // generation still inside the grace window stays on it, so a save
    // running on another device isn't deleted out from under itself and is
    // still cleaned up if it never finishes.
    await setDoc(doc(col, ANALYSIS_PENDING_DOC_ID), { gens: keep });
  } catch (err) {
    console.warn('Analysis chunk cleanup failed (old chunks left behind):', err);
  }
  // First save under the pending-doc scheme for this prospect: its
  // collection may still hold orphans from before, whose ids nothing
  // recorded. Swept once — the save is already done.
  if (!hadPendingDoc) sweepLegacyAnalysisChunks(col, gen);
}

// Metadata-only read of a saved analysis: fetches just the `main` doc and
// never touches the chunk docs, so callers that only need "does an analysis
// exist, and when was it saved" stay at a single document read. Returns
// { fileName, sizeBytes, savedAt } or null when nothing is saved.
export async function getIndicativeAnalysisMeta(prospectId) {
  if (!prospectId) return null;
  const snap = await fsGetDoc(doc(getAnalysisCol(prospectId), ANALYSIS_DOC_ID));
  if (!snap.exists()) return null;
  const meta = snap.data() || {};
  return {
    fileName: meta.fileName || '',
    sizeBytes: Number(meta.sizeBytes) || 0,
    savedAt: meta.capturedAt?.toDate?.()?.toISOString() || null,
  };
}

// One-shot read of a saved analysis, chunks and all. Same reassembly as
// subscribeIndicativeAnalysis, but for callers that want the workbook
// once (e.g. the Utility Lookup page importing a company's saved Master
// Analysis) rather than a live subscription. Returns
// { fileName, sizeBytes, savedAt, dataBase64 } or null when nothing is
// saved against the prospect.
export async function loadIndicativeAnalysis(prospectId) {
  if (!prospectId) return null;
  const col = getAnalysisCol(prospectId);
  const snap = await fsGetDoc(doc(col, ANALYSIS_DOC_ID));
  if (!snap.exists()) return null;
  const meta = snap.data() || {};
  const base = {
    fileName: meta.fileName || '',
    sizeBytes: Number(meta.sizeBytes) || 0,
    savedAt: meta.capturedAt?.toDate?.()?.toISOString() || null,
  };
  // Legacy single-doc format: the whole base64 lived on the main doc.
  if (typeof meta.dataBase64 === 'string') return { ...base, dataBase64: meta.dataBase64 };
  const chunkCount = Number(meta.chunkCount) || 0;
  if (chunkCount === 0) return { ...base, dataBase64: '' };
  // Analyses written before generations are stored under plain `chunk-<i>`.
  const gen = typeof meta.gen === 'string' ? meta.gen : '';
  // Fetched by id rather than by listing the collection: `main` says
  // exactly which chunks make up this workbook, and a listing would also
  // pull down any older generation still awaiting cleanup — doubling (or
  // worse) the download for parts that get thrown away.
  const snaps = await Promise.all(
    analysisChunkIds(gen, chunkCount).map((id) => fsGetDoc(doc(col, id))),
  );
  const parts = new Array(chunkCount);
  const missing = [];
  for (let i = 0; i < chunkCount; i++) {
    const part = snaps[i]?.exists() ? (snaps[i].data()?.data || '') : '';
    if (!part) missing.push(i + 1);
    parts[i] = part;
  }
  // A gap used to join into a shorter string and reach the xlsx reader as a
  // truncated zip, which failed with a byte-count mismatch that said nothing
  // about the real problem. Name it here instead.
  if (missing.length) {
    throw new Error(
      `This company's saved analysis is incomplete — ${missing.length} of its ${chunkCount} parts `
      + `${missing.length === 1 ? 'is' : 'are'} missing (${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}). `
      + 'Re-save it from the Utility Lookup page to replace it.',
    );
  }
  const dataBase64 = parts.join('');
  // Every part present but the total is the wrong length: the stored parts
  // don't add up to the workbook the writer recorded, so decoding would
  // again fail somewhere unhelpful.
  const expected = base64LenForBytes(base.sizeBytes);
  if (base.sizeBytes > 0 && dataBase64.length !== expected) {
    throw new Error(
      `This company's saved analysis is corrupt — it reassembled to ${dataBase64.length} characters `
      + `where ${expected} were expected for a ${base.sizeBytes}-byte workbook. `
      + 'Re-save it from the Utility Lookup page to replace it.',
    );
  }
  return { ...base, dataBase64 };
}

// Live metadata for a prospect's saved analysis — { fileName, sizeBytes,
// capturedAt } — watching only the `main` doc. The chunk docs are never
// touched, so opening a company popup costs one document read no matter how
// large the workbook is; callers fetch the payload with
// loadIndicativeAnalysis() when the user actually asks to download it.
export function subscribeIndicativeAnalysisMeta(prospectId, onChange) {
  const col = getAnalysisCol(prospectId);
  return onSnapshot(doc(col, ANALYSIS_DOC_ID), (snap) => {
    if (!snap.exists()) { onChange(null); return; }
    const meta = snap.data() || {};
    // Legacy single-doc analyses carry the base64 inline; drop it here so a
    // metadata subscription never drags the payload into memory.
    onChange({
      fileName: meta.fileName || '',
      sizeBytes: Number(meta.sizeBytes) || 0,
      capturedAt: meta.capturedAt || null,
    });
  }, (err) => {
    console.error('Firestore analysis subscription error:', err);
  });
}

export async function deleteIndicativeAnalysis(prospectId) {
  const col = getAnalysisCol(prospectId);
  const existing = await getDocs(col);
  if (existing.empty) return;
  const batch = writeBatch(db);
  existing.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

export async function seedProspects(prospects) {
  // Check if collection already has data
  const snap = await getDocs(getCol());
  if (snap.size > 0) return false; // already seeded

  const batch = writeBatch(db);
  for (const prospect of prospects) {
    const ref = doc(getCol());
    batch.set(ref, {
      ...prospect,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  await batch.commit();
  return true;
}

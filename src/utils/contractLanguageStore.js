// The contract-language library: the wording that goes into a contract for
// each service.
//
// One Firestore document per service under
// `userSettings/{uid}/contractLanguage/{slug}`, following the split
// companySiteLists already had to make. Clause text is long-form prose, and
// a library covering the service catalogue would eat the settings
// document's 1 MiB budget — at which point EVERY settings write starts
// failing, not just this feature's. Per-service documents put the cap on
// one service's wording instead of on the whole library.
//
// A service holds an ordered list of named clauses:
//
//   { id, label, text }
//
// so one service can carry a "Standard", a "Pilot" and a "3-year term"
// wording side by side rather than one blob that has to say everything.
//
// Writes report Firestore's own error code rather than swallowing it.
// 'permission-denied' is the one worth acting on — it means the deployed
// rules predate this collection — and a library that silently failed to
// save would read exactly like one that saved fine.

import { collection, doc, deleteDoc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

const COL = 'userSettings';
const SUB = 'contractLanguage';

// Deterministic 32-bit hash, rendered base36. Only used to disambiguate
// slugs — not a checksum, and never parsed back.
function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// Firestore document ids can't contain '/', and service names are free text
// from the catalogue ("RA + - pull through", "Cat 3, 5, 6, and 7"), so they
// get slugged. The hash suffix keeps two services that punctuate differently
// from landing on the same document; the original name is stored in the
// document, so a slug never has to be reversed.
export function serviceSlug(name) {
  const raw = String(name || '');
  const base = raw.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${base || 'service'}-${hash(raw)}`;
}

export function newClauseId() {
  return `cl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// Drop anything malformed and normalize the shape, so a hand-edited or
// half-written document can't crash the tab that renders it.
function normalizeClauses(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(c => c && typeof c === 'object')
    .map(c => ({
      id: String(c.id || newClauseId()),
      label: String(c.label || ''),
      text: String(c.text || ''),
    }));
}

/**
 * Live view of the whole library as a `{ serviceName: clauses[] }` map.
 * Keyed by the stored service name rather than the slug, so the caller
 * never has to know how documents are addressed.
 */
export function subscribeContractLanguage(userId, onChange, onError) {
  if (!userId) return () => {};
  return onSnapshot(
    collection(db, COL, userId, SUB),
    (snap) => {
      const out = {};
      snap.forEach((d) => {
        const data = d.data() || {};
        const service = String(data.service || '').trim();
        if (!service) return;
        const clauses = normalizeClauses(data.clauses);
        if (clauses.length) out[service] = clauses;
      });
      onChange(out);
    },
    (err) => {
      console.warn('contractLanguage: subscription failed', err);
      onError?.(err);
    },
  );
}

/**
 * Replace one service's clauses. An empty list deletes the document rather
 * than leaving an empty one behind, so the library only holds services that
 * actually have wording.
 *
 * Returns { ok, error, code } — see the note at the top about why a failure
 * is reported rather than swallowed.
 */
export async function saveServiceClauses(userId, service, clauses) {
  const name = String(service || '').trim();
  if (!userId || !name) return { ok: false, error: 'Nothing to save.', code: 'invalid-argument' };
  const ref = doc(db, COL, userId, SUB, serviceSlug(name));
  const kept = normalizeClauses(clauses).filter(c => c.label.trim() || c.text.trim());
  try {
    if (kept.length === 0) await deleteDoc(ref);
    else await setDoc(ref, { service: name, clauses: kept, updatedAt: Date.now() });
    return { ok: true, error: '', code: '' };
  } catch (err) {
    console.warn('contractLanguage: write failed', err);
    return { ok: false, error: err?.message || String(err), code: err?.code || '' };
  }
}

// Two clauses are the same wording if they differ only in whitespace. A
// quote lifted twice out of the same contract — by a re-run, or by an
// amendment that repeats the clause — shouldn't land in the library twice.
function wordingKey(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Append clauses to services without disturbing what's already there.
 *
 * This is how the Contract Services subtab hands its work over: it reads a
 * signed contract, and the verbatim quote it captured as evidence for each
 * service IS that service's contract language. Appending rather than
 * replacing matters — the library is built up over many contracts, and a
 * service's existing wording is not this document's to overwrite.
 *
 * `entries` is [{ service, clauses: [{ label, text }] }]. Wording already on
 * file is skipped, so pressing the button twice is a no-op rather than a
 * duplicate.
 *
 * Returns { ok, added, skipped, services, error, code } — `added` and
 * `skipped` count clauses, `services` counts documents actually written.
 */
export async function appendContractLanguage(userId, entries) {
  const tally = { ok: true, added: 0, skipped: 0, services: 0, error: '', code: '' };
  if (!userId) return { ...tally, ok: false, error: 'Not signed in — nothing was saved.' };
  for (const entry of entries || []) {
    const name = String(entry?.service || '').trim();
    const incoming = normalizeClauses(entry?.clauses).filter(c => c.text.trim());
    if (!name || incoming.length === 0) continue;
    const ref = doc(db, COL, userId, SUB, serviceSlug(name));
    try {
      const snap = await getDoc(ref);
      const existing = snap.exists() ? normalizeClauses(snap.data()?.clauses) : [];
      const seen = new Set(existing.map(c => wordingKey(c.text)));
      const fresh = [];
      for (const c of incoming) {
        const k = wordingKey(c.text);
        if (seen.has(k)) { tally.skipped += 1; continue; }
        seen.add(k);
        fresh.push(c);
      }
      if (fresh.length === 0) continue;
      await setDoc(ref, { service: name, clauses: [...existing, ...fresh], updatedAt: Date.now() });
      tally.added += fresh.length;
      tally.services += 1;
    } catch (err) {
      console.warn('contractLanguage: append failed', err);
      return { ...tally, ok: false, error: err?.message || String(err), code: err?.code || '' };
    }
  }
  return tally;
}

/**
 * Move one service's clauses onto another service and delete the source
 * document — the library's half of folding two spellings of the same
 * service into one (see utils/serviceNameMerges.js).
 *
 * Wording already on file under the surviving service is skipped, so a
 * clause captured under both names ends up filed once. A source document
 * that doesn't exist is a no-op, which is what makes this safe to run
 * against an account that never had the retired spelling.
 *
 * Returns { ok, moved, skipped, error, code }.
 */
export async function mergeServiceLanguage(userId, from, to) {
  const fromName = String(from || '').trim();
  const toName = String(to || '').trim();
  if (!userId || !fromName || !toName) {
    return { ok: false, moved: 0, skipped: 0, error: 'Nothing to merge.', code: 'invalid-argument' };
  }
  const fromRef = doc(db, COL, userId, SUB, serviceSlug(fromName));
  try {
    const snap = await getDoc(fromRef);
    if (!snap.exists()) return { ok: true, moved: 0, skipped: 0, error: '', code: '' };
    const clauses = normalizeClauses(snap.data()?.clauses).filter(c => c.text.trim());
    if (clauses.length) {
      const res = await appendContractLanguage(userId, [{ service: toName, clauses }]);
      // The source is only dropped once its wording is safely on the other
      // document — a failed append that still deleted would lose the clauses.
      if (!res.ok) return { ok: false, moved: res.added, skipped: res.skipped, error: res.error, code: res.code };
      await deleteDoc(fromRef);
      return { ok: true, moved: res.added, skipped: res.skipped, error: '', code: '' };
    }
    await deleteDoc(fromRef);
    return { ok: true, moved: 0, skipped: 0, error: '', code: '' };
  } catch (err) {
    console.warn('contractLanguage: merge failed', err);
    return { ok: false, moved: 0, skipped: 0, error: err?.message || String(err), code: err?.code || '' };
  }
}

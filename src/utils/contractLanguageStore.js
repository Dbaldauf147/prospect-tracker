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

import { collection, doc, deleteDoc, onSnapshot, setDoc } from 'firebase/firestore';
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

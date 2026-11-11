// Email draft history: the Firestore half. One document per distinct draft
// under `userSettings/{uid}/emailDraftHistory/{fingerprint}`, the same split
// companySiteLists and contractLanguage made, so an ever-growing history
// never eats the settings document's 1 MiB budget. See emailDraftHistory.js
// for the entry shape and the fingerprint rules.
//
// Writes return { ok, error, code } rather than swallowing the failure:
// 'permission-denied' means the deployed rules predate this collection, and
// a history that silently stopped saving would look exactly like one that
// worked.

import { collection, doc, deleteDoc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { onSnapshot } from './safeOnSnapshot';
import { db } from '../firebase';
import { buildHistoryEntry, mergeHistoryEntry, normalizeHistoryEntry, draftHasContent } from './emailDraftHistory.js';

const COL = 'userSettings';
const SUB = 'emailDraftHistory';

const fail = (err) => ({ ok: false, error: err?.message || String(err), code: err?.code || '' });

/** Live list of every history entry, newest save first. */
export function subscribeDraftHistory(userId, onChange, onError) {
  if (!userId) return () => {};
  return onSnapshot(
    collection(db, COL, userId, SUB),
    (snap) => {
      const out = [];
      snap.forEach((d) => out.push(normalizeHistoryEntry(d.id, d.data())));
      out.sort((a, b) => String(b.lastSavedAt).localeCompare(String(a.lastSavedAt)));
      onChange(out);
    },
    (err) => {
      console.warn('emailDraftHistory: subscription failed', err);
      onError?.(err);
    },
  );
}

/**
 * Record a save or send of `draft` ({ subject, body, contacts, cc, bannerId }).
 * The same content again bumps its entry; anything new gets its own.
 * `options` is { via: 'saved' | 'sent', campaign }.
 */
export async function recordDraftHistory(userId, draft, options = {}) {
  if (!userId) return { ok: false, error: 'Not signed in.', code: 'unauthenticated' };
  if (!draftHasContent(draft)) return { ok: true, error: '', code: '' };
  const entry = buildHistoryEntry(draft, options);
  const ref = doc(db, COL, userId, SUB, entry.id);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) await updateDoc(ref, mergeHistoryEntry(snap.data(), entry));
    else await setDoc(ref, entry);
    return { ok: true, error: '', code: '', id: entry.id };
  } catch (err) {
    console.warn('emailDraftHistory: write failed', err);
    return fail(err);
  }
}

/**
 * Copy drafts saved before the history existed (settings.emailDrafts) in,
 * keeping their original dates. Only creates what's missing, so it is safe
 * to run again.
 */
export async function importSavedDrafts(userId, drafts) {
  let added = 0;
  for (const d of Array.isArray(drafts) ? drafts : []) {
    if (!draftHasContent(d)) continue;
    const entry = buildHistoryEntry(d, { now: d.createdAt || new Date().toISOString() });
    const ref = doc(db, COL, userId, SUB, entry.id);
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) continue;
      await setDoc(ref, entry);
      added += 1;
    } catch (err) {
      console.warn('emailDraftHistory: import failed', err);
      return { ...fail(err), added };
    }
  }
  return { ok: true, error: '', code: '', added };
}

/** Tie an entry to a campaign (its primary subject), or '' to untie it. */
export async function setDraftCampaign(userId, id, campaign) {
  if (!userId || !id) return { ok: false, error: 'Nothing to update.', code: 'invalid-argument' };
  try {
    await updateDoc(doc(db, COL, userId, SUB, id), { campaign: String(campaign || '') });
    return { ok: true, error: '', code: '' };
  } catch (err) {
    console.warn('emailDraftHistory: campaign link failed', err);
    return fail(err);
  }
}

export async function deleteDraftHistory(userId, id) {
  if (!userId || !id) return { ok: false, error: 'Nothing to delete.', code: 'invalid-argument' };
  try {
    await deleteDoc(doc(db, COL, userId, SUB, id));
    return { ok: true, error: '', code: '' };
  } catch (err) {
    console.warn('emailDraftHistory: delete failed', err);
    return fail(err);
  }
}

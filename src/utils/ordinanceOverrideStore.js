// Where hand-corrected mandate data is kept.
//
// A correction to a jurisdiction's ordinance isn't personal: the deadline
// Columbus publishes is the same deadline for everyone screening a
// Columbus site. So corrections go to a SHARED collection, the same way
// the Lists tab's uploaded rows do (see listBackupSync.js) — one document
// per jurisdiction, read by every signed-in user.
//
//   complianceOrdinances/<govKey>
//     { bbs: {...}, audits: {...}, bps: {...},
//       updatedAt: ISO, updatedBy: email }
//
// The committed seed (src/data/masterOrdinances.js, built from a workbook
// by scripts/buildComplianceOrdinances.mjs) stays the base. This layer is
// what sits on top of it, so a correction takes effect for everyone
// without waiting for the seed to be rebuilt and shipped.
//
// A write that Firestore refuses is reported rather than swallowed: the
// caller falls back to the user's own settings so their screening still
// reflects what they typed, and the page says which of the two happened.
// A correction silently kept private would read as one that had been
// published to the team.

import { doc, getDoc, setDoc, collection, getDocs, deleteField, updateDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { CATEGORIES } from './complianceMandates.js';

const COLLECTION = 'complianceOrdinances';

/**
 * Every shared correction, as the { govKey: { category: patch } } map the
 * screening's override layer already speaks.
 *
 * Returns { overrides, ok, error }. An unreadable collection comes back
 * as an empty map with ok:false rather than throwing — the screening must
 * still run on the published seed when Firestore is unreachable.
 */
export async function loadSharedOrdinanceOverrides() {
  try {
    const snap = await getDocs(collection(db, COLLECTION));
    const overrides = {};
    snap.forEach((d) => {
      const data = d.data() || {};
      const entry = {};
      for (const c of CATEGORIES) {
        if (data[c] && typeof data[c] === 'object') entry[c] = data[c];
      }
      if (Object.keys(entry).length) overrides[d.id] = entry;
    });
    return { overrides, ok: true, error: '' };
  } catch (err) {
    console.warn('complianceOrdinances: read failed', err);
    return { overrides: {}, ok: false, error: err?.message || String(err), code: err?.code || '' };
  }
}

/**
 * Write (or clear, with a null patch) one jurisdiction's correction for
 * one mandate category.
 *
 * Returns { ok, error, code }. `code` is Firestore's own — 'permission-denied'
 * is the one worth acting on, and it is the expected answer for a user
 * without write access to the shared reference rather than a fault.
 */
export async function saveSharedOrdinanceOverride(govKey, category, patch, { email = '' } = {}) {
  // Who to credit (and, if it comes to it, ask about a wrong figure).
  // Read here rather than threaded in, so every caller stamps it.
  const by = email || auth?.currentUser?.email || '';
  if (!govKey || !CATEGORIES.includes(category)) {
    return { ok: false, error: 'Nothing to save.', code: 'invalid-argument' };
  }
  const ref = doc(db, COLLECTION, govKey);
  const stamp = { updatedAt: new Date().toISOString(), updatedBy: by };
  try {
    if (patch) {
      // Merge, so correcting BBS doesn't drop a correction someone else
      // made to the same jurisdiction's BPS.
      await setDoc(ref, { [category]: patch, ...stamp }, { merge: true });
    } else {
      // Clearing one category leaves the others in place. updateDoc on a
      // document that was never written throws 'not-found', which for a
      // clear is already the wanted state.
      try {
        await updateDoc(ref, { [category]: deleteField(), ...stamp });
      } catch (err) {
        if (err?.code !== 'not-found') throw err;
      }
    }
    return { ok: true, error: '', code: '' };
  } catch (err) {
    console.warn('complianceOrdinances: write failed', err);
    return { ok: false, error: err?.message || String(err), code: err?.code || '' };
  }
}

/** Whether a jurisdiction has any shared correction on file. */
export async function sharedOverrideFor(govKey) {
  if (!govKey) return null;
  try {
    const snap = await getDoc(doc(db, COLLECTION, govKey));
    return snap.exists() ? snap.data() : null;
  } catch {
    return null;
  }
}

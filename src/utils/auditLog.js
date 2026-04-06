import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Append an audit log entry to the `auditLog` Firestore collection.
 *
 * @param {Object|null} user  - Firebase Auth user (or null for anonymous actions)
 * @param {string}       action  - One of the predefined action strings
 * @param {Object}       [details={}] - Arbitrary extra context for the entry
 *
 * Predefined actions:
 *   contact_created, contact_updated, contact_deleted,
 *   prospect_created, prospect_updated, prospect_deleted,
 *   login, logout, export_csv, bulk_upload, email_draft_created
 */
export async function logAction(user, action, details = {}) {
  try {
    await addDoc(collection(db, 'auditLog'), {
      userId: user?.uid ?? null,
      userEmail: user?.email ?? null,
      action,
      details,
      timestamp: serverTimestamp(),
    });
  } catch (err) {
    // Audit logging should never break the app — swallow and warn.
    console.warn('Audit log write failed:', err);
  }
}

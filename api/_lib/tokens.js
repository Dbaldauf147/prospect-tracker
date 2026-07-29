// Per-user integration OAuth tokens, stored server-side in Firestore at
// integrationTokens/{uid} (one field per provider). Clients can't read
// this collection (see firestore.rules); only firebase-admin touches it.
import { adminDb } from './firebaseAdmin.js';

const COL = 'integrationTokens';

export async function getTokens(uid, provider) {
  const snap = await adminDb().collection(COL).doc(uid).get();
  if (!snap.exists) return null;
  return snap.data()?.[provider] || null;
}

export async function setTokens(uid, provider, tokens) {
  await adminDb().collection(COL).doc(uid).set(
    { [provider]: { ...tokens, updatedAt: Date.now() } },
    { merge: true },
  );
}

export async function clearTokens(uid, provider) {
  const { FieldValue } = await import('firebase-admin/firestore');
  await adminDb().collection(COL).doc(uid).set(
    { [provider]: FieldValue.delete() },
    { merge: true },
  );
}

// Lazily-initialised firebase-admin app, shared across API functions.
// Requires the service-account JSON in FIREBASE_SERVICE_ACCOUNT_KEY
// (paste the whole JSON, or a base64 of it, into the Vercel env var).
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY not configured');
  const json = raw.trim().startsWith('{')
    ? raw
    : Buffer.from(raw, 'base64').toString('utf8');
  return JSON.parse(json);
}

let app;
export function adminApp() {
  if (app) return app;
  app = getApps()[0] || initializeApp({ credential: cert(loadServiceAccount()) });
  return app;
}

export function adminAuth() {
  return getAuth(adminApp());
}

export function adminDb() {
  return getFirestore(adminApp());
}

import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Vite inlines these at build time, so a deploy built without them ships a
// config full of undefined and getAuth() throws "auth/invalid-api-key" while
// this module is still evaluating -- before React mounts, which means a blank
// page and a console error that names the SDK rather than the real problem.
// Fail here instead, saying which variables the build was missing.
const missing = Object.entries(firebaseConfig)
  .filter(([, v]) => !v)
  .map(([k]) => 'VITE_FIREBASE_' + k.replace(/[A-Z]/g, (c) => '_' + c).toUpperCase());
if (missing.length) {
  throw new Error(
    `Firebase is not configured: this build is missing ${missing.join(', ')}. ` +
    'Set them in the deployment environment and rebuild -- Vite reads them at build time, not in the browser.',
  );
}

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

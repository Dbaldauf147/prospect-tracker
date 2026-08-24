import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import {
  initializeFirestore, getFirestore,
  persistentLocalCache, persistentMultipleTabManager,
} from 'firebase/firestore';

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

// Firestore bills every document a listener receives, and this app opens
// with a subscription to the whole prospects roster — about 4,500
// documents. Without a local cache that is ~4,500 reads on every page
// load, so a dozen reloads spend the project's entire daily allowance and
// every read after that comes back RESOURCE_EXHAUSTED.
//
// The persistent (IndexedDB) cache lets a reload serve those documents
// from disk and resume the listener with a token, so the server sends
// only what changed. It is not free forever — after a long enough gap the
// resume token is no longer usable and the SDK re-reads the full set —
// but it turns "every reload" into "once in a while".
//
// The multi-tab manager is what makes that safe with the app open in more
// than one tab: they share the one cache instead of the first tab owning
// it and the rest falling back.
//
// 100 MB rather than the 40 MB default: the roster alone is a few thousand
// documents, and the Opps 2 chunk blobs are large enough to evict it at the
// default threshold — which would quietly put the reads back.
const CACHE_BYTES = 100 * 1024 * 1024;

function openFirestore() {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({
        cacheSizeBytes: CACHE_BYTES,
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch (err) {
    // No IndexedDB to persist into (private windows, storage blocked, an
    // old browser). Losing the cache costs reads; failing to start costs
    // the whole app, so take the in-memory one and say why.
    console.warn('Firestore persistent cache unavailable, falling back to memory:', err?.message || err);
    return getFirestore(app);
  }
}

export const db = openFirestore();
export const googleProvider = new GoogleAuthProvider();

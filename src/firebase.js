import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import {
  initializeFirestore, getFirestore,
  persistentLocalCache, persistentSingleTabManager, memoryLocalCache,
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
// ONE tab owns the cache (persistentSingleTabManager). This used to be the
// multi-tab manager, so every open tab shared it, and that sharing is what
// kept killing the SDK: the tabs pass the "primary" role between them
// (whichever is in the foreground wants it) and coordinate one mutation
// queue through IndexedDB, and a write acknowledged across that handover
// could find its batch already gone. That trips
//   INTERNAL ASSERTION FAILED: Unexpected state (ID: b7de) {batchId}
// (removeMutationBatch expected exactly one row), the async queue fails,
// and every call after it is b815 until a reload. It took down the Opps
// auto-save and the prospect merge. With a single owner there is no
// handover and no queue shared between tabs, so that whole class of crash
// cannot happen.
//
// The cost: a second tab opened while the first is still up can't get the
// IndexedDB lease, and the SDK falls back to an in-memory cache for it
// (canFallbackFromIndexedDbError treats the failed-precondition as
// recoverable). That tab pays full reads on load, as every tab did before
// the cache. The first tab keeps the savings, and a reload when it's the
// only tab gets them back.
//
// Which tab that is gets settled HERE, with a browser lock, not by the SDK.
// The SDK's own lease is a timestamp the owner refreshes every few seconds,
// and a backgrounded tab's timers are throttled well past the 5 s the lease
// lives for. So a second tab opened while the owner sat in the background
// found the lease stale and took it, and the owner's next refresh threw
//   Failed to obtain exclusive access to the persistence layer
// which the SDK treats as fatal mid-session: the async queue stops and
// every write after it is INTERNAL ASSERTION FAILED (b815) until a reload.
// That is what broke "+ Create" on the portfolio link dialog.
//
// A Web Lock is held for as long as the page is open, however throttled,
// and released by the browser when the page goes. The tab that gets it
// owns the cache; any other tab goes straight to the in-memory cache and
// never touches the lease, so the owner can't lose it. Without Web Locks
// (old browsers) it is the SDK's lease alone, as before.
const CACHE_LOCK = 'prospect-tracker:firestore-cache-owner';
function claimCacheOwnership() {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : null;
  if (!locks?.request) return Promise.resolve(true);
  return new Promise((resolve) => {
    locks.request(CACHE_LOCK, { ifAvailable: true }, (lock) => {
      resolve(!!lock);
      // Held until the page unloads.
      return lock ? new Promise(() => {}) : undefined;
    }).catch(() => resolve(true));
  });
}
const ownsCache = await claimCacheOwnership();

// 100 MB rather than the 40 MB default: the roster alone is a few thousand
// documents, and the Opps 2 chunk blobs are large enough to evict it at the
// default threshold — which would quietly put the reads back.
const CACHE_BYTES = 100 * 1024 * 1024;

function openFirestore() {
  if (!ownsCache) {
    return initializeFirestore(app, { localCache: memoryLocalCache() });
  }
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({
        cacheSizeBytes: CACHE_BYTES,
        tabManager: persistentSingleTabManager(),
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

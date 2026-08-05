import { lazy } from 'react';

// React.lazy for route views, with the one failure they all share.
//
// The views are code-split, so index.html names its chunks by content
// hash. A deploy rewrites those hashes, and a tab opened before it keeps
// the old index.html in memory — so the first navigation after a deploy
// asks for a chunk filename that no longer exists on the server. The
// import rejects with "Failed to fetch dynamically imported module",
// React unmounts the tree, and the user gets the crash screen for what
// is really just an out-of-date tab.
//
// Reloading fixes it, because index.html is served must-revalidate (see
// vercel.json) and comes back pointing at chunks that do exist. So do
// that automatically, once, rather than showing a crash for a condition
// with a known and complete remedy.

// Rollup/Vite word this differently per browser: Chrome says "Failed to
// fetch dynamically imported module", Firefox "error loading dynamically
// imported module", Safari "Importing a module script failed".
const CHUNK_ERROR = /dynamically imported module|Importing a module script failed|error loading dynamically imported/i;

export function isChunkLoadError(error) {
  return CHUNK_ERROR.test(String(error?.message || error || ''));
}

// One reload per window, tracked across the reload itself. Without this
// a chunk that is genuinely missing — a broken deploy, an asset that
// never uploaded — would reload forever instead of showing the error.
const RELOAD_KEY = 'chunk-reload-at';
const RELOAD_COOLDOWN_MS = 60000;

function reloadOnce() {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
  } catch {
    // Private mode with storage denied: no memory of a previous attempt,
    // so don't risk a loop. Fall through to the crash screen.
    return false;
  }
  if (Number.isFinite(last) && Date.now() - last < RELOAD_COOLDOWN_MS) return false;
  try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { return false; }
  window.location.reload();
  return true;
}

/**
 * lazy() for a route view. `load` is the same `() => import(...)` the
 * call site would have passed straight to lazy().
 */
export function lazyView(load) {
  return lazy(() => load().catch(err => {
    if (!isChunkLoadError(err) || !reloadOnce()) throw err;
    // The reload is underway but not instant. Returning a promise that
    // never settles keeps Suspense showing its fallback for the moment
    // the page has left, instead of flashing a crash on the way out.
    return new Promise(() => {});
  }));
}

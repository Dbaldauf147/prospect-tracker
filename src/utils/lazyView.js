import { lazy } from 'react';

// React.lazy for route views, with the two failures they all share.
//
// The views are code-split, so index.html names its chunks by content
// hash. A deploy rewrites those hashes, and a tab opened before it keeps
// the old index.html in memory — so the first navigation after a deploy
// asks for a chunk filename that no longer exists on the server. The
// import rejects with "Failed to fetch dynamically imported module",
// React unmounts the tree, and the user gets the crash screen for what
// is really just an out-of-date tab.
//
// Reloading fixes that one, because index.html is served must-revalidate
// (see vercel.json) and comes back pointing at chunks that do exist. So
// do it automatically, once, rather than showing a crash for a condition
// with a known and complete remedy.
//
// The second failure looks identical and reloading does nothing for it.
// Hashed chunks are served `immutable` for a year, which tells the
// browser it never has to ask about that URL again. If the copy it
// stored is not the chunk — an error page from a captive portal or a
// company proxy, the index.html this app serves for any path it doesn't
// recognise, a truncated response — then that is what every later load
// gets, out of disk, without a request going anywhere. index.html
// revalidates and still points at the same poisoned URL, so the reload
// lands straight back on the crash screen and the view stays broken for
// as long as the entry lives. Rewriting the entry first is what breaks
// that loop: see refetchPastCache below.

// Rollup/Vite word this differently per browser: Chrome says "Failed to
// fetch dynamically imported module", Firefox "error loading dynamically
// imported module", Safari "Importing a module script failed".
const CHUNK_ERROR = /dynamically imported module|Importing a module script failed|error loading dynamically imported/i;

export function isChunkLoadError(error) {
  return CHUNK_ERROR.test(String(error?.message || error || ''));
}

// The chunk the failed import was reaching for. Chrome and Firefox put it
// in the message ("...imported module: https://host/assets/View-abc.js");
// Safari's wording carries no URL, so treat this as best effort and keep
// every caller working without one.
//
// Only our own assets come back. The URL is about to be re-fetched, and a
// message naming somewhere else is either not ours to request or not the
// chunk we are trying to repair.
export function chunkUrlFrom(error) {
  const found = /\bhttps?:\/\/[^\s'")]+/.exec(String(error?.message || error || ''));
  if (!found) return '';
  try {
    const url = new URL(found[0], window.location.href);
    return url.origin === window.location.origin ? url.href : '';
  } catch {
    return '';
  }
}

// Ask the server for the chunk again, past whatever the browser has
// stored for that URL. `cache: 'reload'` is the part that matters: it
// skips the cached entry on the way out and overwrites it with the
// response on the way back, so the reload that follows has a real chunk
// to import instead of the poisoned copy that just failed.
//
// Every outcome here is fine to ignore. If the server 404s the URL the
// tab is simply out of date, which the reload fixes on its own; if the
// network is gone the reload is still the user's best move. The timeout
// only stops a hung request from holding the page on a Suspense fallback
// with nothing happening.
const REFETCH_TIMEOUT_MS = 4000;

async function refetchPastCache(url) {
  if (!url) return;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REFETCH_TIMEOUT_MS);
  try {
    await fetch(url, { cache: 'reload', credentials: 'same-origin', signal: abort.signal });
  } catch {
    // Offline, blocked, aborted: nothing to do differently.
  } finally {
    clearTimeout(timer);
  }
}

// Repair the cached copy of the failing chunk, then reload. Exported for
// the Reload button on the crash screen, which the user reaches precisely
// when the automatic attempt below was skipped or didn't take, and where
// a plain reload is the thing that has already been proven not to work.
export async function reloadPastCache(error) {
  await refetchPastCache(chunkUrlFrom(error));
  window.location.reload();
}

// One reload per window, tracked across the reload itself. Without this a
// chunk that is genuinely missing — a broken deploy, an asset that never
// uploaded — would reload forever instead of showing the error.
const RELOAD_KEY = 'chunk-reload-at';
const RELOAD_COOLDOWN_MS = 60000;

function claimReload() {
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
  return true;
}

/**
 * Handle a failed chunk import: repair the cached copy and reload, at
 * most once per cooldown. Resolves true when a reload is underway, false
 * when the caller should surface the error instead.
 */
export async function recoverFromChunkError(error) {
  if (!claimReload()) return false;
  await reloadPastCache(error);
  return true;
}

/**
 * lazy() for a route view. `load` is the same `() => import(...)` the
 * call site would have passed straight to lazy().
 */
export function lazyView(load) {
  return lazy(() => load().catch(async err => {
    if (!isChunkLoadError(err) || !(await recoverFromChunkError(err))) throw err;
    // The reload is underway but not instant. Returning a promise that
    // never settles keeps Suspense showing its fallback for the moment
    // the page has left, instead of flashing a crash on the way out.
    return new Promise(() => {});
  }));
}

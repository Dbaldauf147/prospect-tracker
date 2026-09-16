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
//
// The fourth is Vite's own. Its preload helper hangs a <link> for each
// stylesheet a view needs and throws "Unable to preload CSS for <url>"
// when one won't load, which is the same failure wearing different words:
// the view didn't load because a file it is built from didn't arrive.
// Without it here, a missing stylesheet reads as a component crash and
// nothing tries to recover.
const CHUNK_ERROR = /dynamically imported module|Importing a module script failed|error loading dynamically imported|Unable to preload CSS/i;

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
const REQUEST_TIMEOUT_MS = 4000;

function request(url, options) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
  return fetch(url, { credentials: 'same-origin', ...options, signal: abort.signal })
    .finally(() => clearTimeout(timer));
}

async function refetchPastCache(url) {
  if (!url) return;
  try {
    await request(url, { cache: 'reload' });
  } catch {
    // Offline, blocked, aborted: nothing to do differently.
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


// Reading the failure back out of the network.
//
// "Failed to fetch dynamically imported module" is the same sentence
// whether the file is missing from the deploy, the server answered with
// something that isn't JavaScript, or the request never left the browser
// because an extension or a company proxy ate it. It also names the
// module that was asked for rather than the file that actually failed: a
// view chunk imports a couple of dozen others, and any one of them not
// arriving takes the whole import down under the name of the one on top.
//
// None of that can be told apart by looking, and looking is all a report
// of this arrives with. So once a view has failed and the reload hasn't
// cleared it, ask the network directly and say what came back.

const JS_TYPE = /javascript|ecmascript/i;

// The files a chunk names in its own import statements. Bundled ESM puts
// them at the top, so the head of the file is enough, and only plain
// relative filenames are followed.
function staticDeps(source, base) {
  const deps = new Set();
  for (const m of source.slice(0, 8000).matchAll(/(?:import|from)\s*["'](\.\/[A-Za-z0-9._-]+\.(?:js|css))["']/g)) {
    try { deps.add(new URL(m[1], base).href); } catch { /* not a URL we can ask about */ }
  }
  return [...deps].slice(0, 40);
}

// HEAD is enough to learn whether the server has a file, and keeps this
// from re-downloading a couple of megabytes to answer a question. null
// means the request itself never completed.
async function head(url) {
  try {
    const res = await request(url, { method: 'HEAD', cache: 'reload' });
    return { url, status: res.status, ok: res.ok };
  } catch {
    return { url, status: 0, ok: false };
  }
}

const CAUSES = 'A browser extension, an ad or privacy blocker, a VPN, or a company proxy is the '
  + 'usual cause. An incognito window with extensions turned off is the quickest way to tell.';

/**
 * Work out why a chunk wouldn't load. Returns { verdict, summary, detail }:
 * `summary` is a sentence for the person looking at the crash screen,
 * `detail` a line for the report they copy. Never throws.
 */
export async function diagnoseChunk(url) {
  if (!url) {
    return {
      verdict: 'unknown',
      summary: 'This browser did not say which file it could not load, so there is nothing to test.',
      detail: 'Diagnosis: no module URL in the error message.',
    };
  }

  let res;
  try {
    res = await request(url, { cache: 'reload' });
  } catch {
    return {
      verdict: 'blocked',
      summary: `The request for this file never reached the server. ${CAUSES}`,
      detail: `Diagnosis: request for ${url} did not complete.`,
    };
  }

  if (!res.ok) {
    return {
      verdict: 'missing',
      summary: `The server does not have this file (HTTP ${res.status}). That is a problem with the deploy `
        + 'rather than with this browser, and reloading will not fix it.',
      detail: `Diagnosis: ${url} returned HTTP ${res.status}.`,
    };
  }

  const type = res.headers.get('content-type') || 'no content type';
  const wantsCss = /\.css($|\?)/.test(url);
  if (!(wantsCss ? /css/i.test(type) : JS_TYPE.test(type))) {
    return {
      verdict: 'wrong-type',
      summary: `The server answered with ${type.split(';')[0]} instead of the file itself, so the browser `
        + 'refused to run it.',
      detail: `Diagnosis: ${url} returned HTTP ${res.status} as ${type}.`,
    };
  }

  const deps = await Promise.all(staticDeps(await res.text().catch(() => ''), url).map(head));
  const bad = deps.find(d => !d.ok);
  if (bad) {
    const name = bad.url.split('/').pop();
    return {
      verdict: bad.status ? 'missing-dep' : 'blocked-dep',
      summary: bad.status
        ? `This file loads, but ${name}, which it is built from, returned HTTP ${bad.status}. The error `
          + 'above names the wrong file: that is the one missing from the server.'
        : `This file loads, but the request for ${name}, which it is built from, never reached the `
          + `server. ${CAUSES}`,
      detail: `Diagnosis: ${url} is served, but ${bad.url} returned ${bad.status || 'no response'}.`,
    };
  }

  return {
    verdict: 'reachable',
    summary: `This file and the ${deps.length} it is built from all download fine when asked for `
      + 'directly, so the server has everything. Something stopped the browser from loading it as part '
      + `of the page. ${CAUSES}`,
    detail: `Diagnosis: ${url} and its ${deps.length} imports are all served normally.`,
  };
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

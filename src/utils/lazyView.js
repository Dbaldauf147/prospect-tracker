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
  const url = chunkUrlFrom(error);
  if (url && /\.js($|\?)/.test(url)) {
    await repairGraph(url);
  } else {
    await refetchPastCache(url);
  }
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

// Is what came back actually the file?
//
// Status is not enough. A response can be 200 and still not be the
// module: the app's own index.html answered for a path the server didn't
// recognise, an error page from somewhere in the middle. The browser
// refuses those, and since a hashed asset is cached for a year, a copy
// like that stays in front of the real file until something overwrites
// it.
const looksLikeMarkup = /^\s*<(?:!doctype|html|head|body|\?xml)/i;

async function inspect(url, cache) {
  try {
    const res = await request(url, { cache });
    if (!res.ok) return { ok: false, why: `HTTP ${res.status}` };

    const type = (res.headers.get('content-type') || '').split(';')[0];
    const text = await res.text().catch(() => '');
    const wantsCss = /\.css($|\?)/.test(url);
    if (wantsCss ? !/css/i.test(type) : !JS_TYPE.test(type)) {
      return {
        ok: false,
        why: `${type || 'no content type'} instead of ${wantsCss ? 'a stylesheet' : 'JavaScript'}`,
      };
    }
    if (!wantsCss && looksLikeMarkup.test(text)) {
      return { ok: false, why: 'a page of HTML instead of the file' };
    }
    return { ok: true, text };
  } catch {
    return { ok: false, why: 'no response' };
  }
}

// Walk what the browser would actually have fetched: the chunk's
// imports, their imports, and so on. One level is not enough -- a view
// here imports two dozen files directly and pulls in ninety through
// them, and any one of the ninety failing takes the import down under
// the name of the chunk on top.
//
// `cache: 'default'` is the point rather than an optimisation: it reads
// what the module loader would read, stored copy and all, which is the
// only way to see a file that the server serves correctly and the
// browser has wrong. With `repair`, a file like that is fetched again
// past the cache, and if the real one comes back the walk carries on
// through it -- a bad copy has no imports to follow, so without this
// everything underneath it stays unexamined.
const GRAPH_LIMIT = 250;
const BATCH = 12;

async function walkGraph(entryUrl, entrySource, { repair = false } = {}) {
  const seen = new Set([entryUrl]);
  const broken = [];
  const repaired = [];
  let frontier = staticDeps(entrySource, entryUrl);
  let checked = 0;

  while (frontier.length && checked < GRAPH_LIMIT) {
    const batch = [];
    for (const url of frontier) {
      if (seen.has(url) || checked + batch.length >= GRAPH_LIMIT) continue;
      seen.add(url);
      batch.push(url);
    }
    frontier = [];

    for (let i = 0; i < batch.length; i += BATCH) {
      await Promise.all(batch.slice(i, i + BATCH).map(async (url) => {
        checked += 1;
        const stored = await inspect(url, 'default');
        if (stored.ok) { frontier.push(...staticDeps(stored.text, url)); return; }

        if (!repair) { broken.push({ url, why: stored.why }); return; }

        const fresh = await inspect(url, 'reload');
        if (!fresh.ok) { broken.push({ url, why: fresh.why }); return; }
        repaired.push(url);
        frontier.push(...staticDeps(fresh.text, url));
      }));
    }
  }
  return { broken, repaired, checked };
}

// Fix every stored copy in a view's graph that isn't the file, so the
// reload that follows has a whole tree to load rather than one repaired
// file and the same bad copy underneath it. Bounded: a stuck request
// must not hold the page on a Suspense fallback.
const REPAIR_DEADLINE_MS = 6000;

async function repairGraph(url) {
  const entry = await inspect(url, 'reload');
  if (!entry.ok) return { repaired: [], checked: 0 };
  return Promise.race([
    walkGraph(url, entry.text, { repair: true }),
    new Promise(resolve => setTimeout(() => resolve({ repaired: [], checked: 0 }), REPAIR_DEADLINE_MS)),
  ]);
}

// A fetch and a module load are not the same request. The browser tags a
// module `Sec-Fetch-Dest: script`, and a filter that only blocks scripts
// lets every fetch above through while refusing the import -- which
// looks, from the error alone, exactly like a file that isn't there.
//
// A modulepreload link is that same kind of request without running
// anything, so it tells the two apart. Browsers without modulepreload
// fire neither event, which is why 'unknown' is one of the answers.
const SCRIPT_PROBE_MS = 5000;

function loadsAsScript(url) {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') { resolve('unknown'); return; }
    let link = null;
    let timer = null;
    const done = (verdict) => { clearTimeout(timer); link?.remove(); resolve(verdict); };
    timer = setTimeout(() => done('unknown'), SCRIPT_PROBE_MS);
    try {
      link = document.createElement('link');
      link.rel = 'modulepreload';
      link.as = 'script';
      // A URL the module map has no opinion about yet, so the answer is
      // about the network rather than about this document's history.
      link.href = `${url}${url.includes('?') ? '&' : '?'}probe=${Date.now()}`;
      link.addEventListener('load', () => done('loaded'));
      link.addEventListener('error', () => done('failed'));
      document.head.appendChild(link);
    } catch {
      done('unknown');
    }
  });
}

const count = (n) => `${n} file${n === 1 ? '' : 's'}`;

const CAUSES = 'A browser extension, an ad or privacy blocker, a VPN, or a company proxy is the '
  + 'usual cause. An incognito window with extensions turned off is the quickest way to tell.';

// What the request that actually failed did, out of the browser's own
// record of it. Everything above re-asks for the file, and by then it
// usually loads: this is the only account of the attempt that went
// wrong. Whether a response ever arrived separates a file the network
// refused from one that never got a turn, and the count of what else was
// in flight is there because a view pulling in ninety files at once is a
// plausible way for one of them to be dropped.
function originalAttempt(url) {
  try {
    const bare = (name) => String(name).split('?')[0];
    const entries = performance.getEntriesByType('resource');
    const failed = entries.filter(e => bare(e.name) === bare(url)).shift();
    if (!failed) return '';
    const busy = entries.filter(e =>
      e !== failed && e.startTime <= failed.startTime && e.responseEnd >= failed.startTime).length;
    const outcome = failed.responseStatus ? `HTTP ${failed.responseStatus}` : 'no response';
    return `\nThe attempt that failed: ${outcome} after ${Math.round(failed.duration)} ms, `
      + `with ${count(busy)} loading alongside it.`;
  } catch {
    return '';
  }
}

/**
 * Work out why a chunk wouldn't load. Returns { verdict, summary, detail }:
 * `summary` is a sentence for the person looking at the crash screen,
 * `detail` a line for the report they copy. Never throws.
 */
export async function diagnoseChunk(url) {
  const verdict = await judgeChunk(url);
  return { ...verdict, detail: verdict.detail + originalAttempt(url) };
}

async function judgeChunk(url) {
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

  const { broken, repaired, checked } = await walkGraph(url, await res.text().catch(() => ''), { repair: true });

  const bad = broken[0];
  if (bad) {
    const name = bad.url.split('/').pop();
    return {
      verdict: bad.why === 'no response' ? 'blocked-dep' : 'missing-dep',
      summary: `This file loads, but ${name}, which it is built from, came back as ${bad.why}. The `
        + 'error above names the wrong file: that is the one to look at.'
        + (bad.why === 'no response' ? ` ${CAUSES}` : ''),
      detail: `Diagnosis: ${url} is served, but ${bad.url} came back as ${bad.why}.`,
    };
  }

  if (repaired.length) {
    const name = repaired[0].split('/').pop();
    return {
      verdict: 'repaired',
      summary: `The file itself was fine. ${count(repaired.length)} it is built from `
        + `${repaired.length === 1 ? 'was' : 'were'} not: this browser had something else saved in `
        + `${repaired.length === 1 ? 'its' : 'their'} place (${name}${repaired.length > 1 ? ' and the rest' : ''}), `
        + 'which is why the view would not load however many times it was tried. That has been fetched '
        + 'again from the server. Reload and it should open.',
      detail: `Diagnosis: ${url} is served, but a bad copy was stored for ${repaired.join(', ')}; `
        + `re-fetched past the cache. ${count(checked)} walked.`,
    };
  }

  // Everything the view is built from is on the server and downloads
  // here. So ask the one question a fetch can't: does the browser accept
  // this file when the page loads it the way a page loads code?
  const asScript = await loadsAsScript(url);
  const served = `${url} and the ${count(checked)} it pulls in are all served normally`;

  if (asScript === 'failed') {
    return {
      verdict: 'script-blocked',
      summary: 'This file downloads fine when the page asks for it as data, along with the '
        + `${count(checked)} it pulls in, but the browser refuses the same file when the page loads it `
        + 'as code. '
        + `That is a filter rather than a fault in the app or the server. ${CAUSES}`,
      detail: `Diagnosis: ${served}, but loading it as a script is refused.`,
    };
  }

  if (asScript === 'loaded') {
    return {
      verdict: 'transient',
      summary: `This file and the ${count(checked)} it pulls in all load now, as code as well as `
        + 'data, so whatever stopped it had passed by the time this screen went looking. The app '
        + 'already asked twice more and reloaded before showing you this, so if you are reading it '
        + 'the failure lasted longer than those attempts. The details below say what the request '
        + 'that failed actually did.',
      detail: `Diagnosis: ${served} and load as scripts.`,
    };
  }

  return {
    verdict: 'reachable',
    summary: `This file and the ${count(checked)} it pulls in all download fine when asked for `
      + 'directly, so the server has everything. Something stopped the browser from loading it as part '
      + `of the page. ${CAUSES}`,
    detail: `Diagnosis: ${served}; this browser would not say whether it accepts the file as a script.`,
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

// Asking for the same file again, at a URL the document has no history
// with.
//
// A module that failed to fetch is remembered as failed: the module map
// holds the failure for the life of the document, so `import()` on that
// URL a second time returns the same rejection without a request leaving
// the browser (measured under Chromium). Changing the query gives a new
// map entry and a real second attempt, and since the file's own imports
// are relative they still resolve to the canonical URLs, so everything
// shared stays shared. Only the view module itself ends up loaded twice,
// which costs nothing but the parse.
//
// Two attempts, a moment apart, because the failures that survive to here
// are the ones that clear on their own: a request lost in the burst when
// a view pulls in ninety files at once, a connection that dropped. The
// wait is what makes the second attempt worth making.
const RETRY_DELAYS_MS = [200, 1000];

async function importAgain(url) {
  // Only modules. A stylesheet that wouldn't preload reaches here too,
  // and import() is not how it gets loaded.
  if (!url || !/\.js($|\?)/.test(url)) return null;

  for (const [attempt, delay] of RETRY_DELAYS_MS.entries()) {
    await new Promise(resolve => setTimeout(resolve, delay));
    try {
      return await import(/* @vite-ignore */ `${url}${url.includes('?') ? '&' : '?'}retry=${attempt + 1}`);
    } catch {
      // Still no. The next attempt waits longer; after that the reload
      // and then the screen take over.
    }
  }
  return null;
}

/**
 * lazy() for a route view. `load` is the `() => import(...)` the call
 * site would have passed straight to lazy(); `exportName` is the
 * component to take out of it, so that a retry can load the same file
 * from a different URL and still know what to hand back.
 */
export function lazyView(load, exportName) {
  const pick = (mod) => ({ default: exportName ? mod[exportName] : mod.default });

  return lazy(() => load().then(pick).catch(async err => {
    if (!isChunkLoadError(err)) throw err;

    // Try again before doing anything the user can see. A view that
    // loads on the second ask is a view that loaded, not a crash screen
    // and a reload that throws away everything else the page is holding.
    const retried = await importAgain(chunkUrlFrom(err));
    if (retried) return pick(retried);

    if (!(await recoverFromChunkError(err))) throw err;
    // The reload is underway but not instant. Returning a promise that
    // never settles keeps Suspense showing its fallback for the moment
    // the page has left, instead of flashing a crash on the way out.
    return new Promise(() => {});
  }));
}

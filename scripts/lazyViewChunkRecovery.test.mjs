// Assertion tests for how a failed chunk import recovers.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/lazyViewChunkRecovery.test.mjs
//
// The rules worth pinning: the three browser wordings of a chunk failure
// are all recognised, the chunk URL is read back out of the message (and
// only when it is ours), and the recovery re-fetches that URL past the
// browser cache before reloading — because a hashed asset is served
// immutable for a year, so a bad copy sitting in the cache survives every
// ordinary reload and keeps the view broken until something overwrites it.

const ORIGIN = 'https://prospect-tracker-ashen.vercel.app';

const store = new Map();
let denyStorage = false;
globalThis.sessionStorage = {
  getItem(key) { if (denyStorage) throw new Error('storage denied'); return store.has(key) ? store.get(key) : null; },
  setItem(key, value) { if (denyStorage) throw new Error('storage denied'); store.set(key, String(value)); },
};

let scriptProbe = 'error';   // which event the modulepreload link fires
globalThis.document = {
  createElement: () => {
    const handlers = {};
    return {
      addEventListener(type, fn) { handlers[type] = fn; },
      remove() {},
      fire() { handlers[scriptProbe]?.(); },
    };
  },
  head: { appendChild: (link) => queueMicrotask(() => link.fire()) },
};
const noDocument = () => { const d = globalThis.document; delete globalThis.document; return () => { globalThis.document = d; }; };

let reloads = 0;
globalThis.window = { location: { href: `${ORIGIN}/`, origin: ORIGIN, reload() { reloads += 1; } } };

let fetches = [];
let fetchFails = false;
const routes = new Map();   // url -> { status, type, body } | 'throw'
globalThis.fetch = async (url, options) => {
  fetches.push({ url, options });
  const route = routes.get(String(url));
  if (fetchFails || route === 'throw') throw new TypeError('Failed to fetch');
  const { status = 200, type = 'text/javascript', body = '' } = route || {};
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? type : null) },
    text: async () => body,
  };
};

function reset() {
  store.clear();
  denyStorage = false;
  reloads = 0;
  fetches = [];
  fetchFails = false;
  routes.clear();
}

const {
  isChunkLoadError, chunkUrlFrom, recoverFromChunkError, reloadPastCache, diagnoseChunk,
} = await import('../src/utils/lazyView.js');

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const CHUNK = `${ORIGIN}/assets/DraftEmailsPage-BItk0RD6.js`;
const chrome = new Error(`Failed to fetch dynamically imported module: ${CHUNK}`);
const firefox = new Error(`error loading dynamically imported module: ${CHUNK}`);
const safari = new Error('Importing a module script failed.');

// --- recognising the failure -----------------------------------------
check('Chrome wording', isChunkLoadError(chrome), true);
check('Firefox wording', isChunkLoadError(firefox), true);
check('Safari wording', isChunkLoadError(safari), true);
check("Vite's CSS preload wording",
  isChunkLoadError(new Error(`Unable to preload CSS for ${ORIGIN}/assets/DraftEmailsPage-x.css`)), true);
check('an ordinary crash is not this', isChunkLoadError(new TypeError('x is not a function')), false);
check('nothing at all', isChunkLoadError(null), false);

// --- finding the chunk to repair -------------------------------------
check('reads the URL out of the message', chunkUrlFrom(chrome), CHUNK);
check('and out of the Firefox one', chunkUrlFrom(firefox), CHUNK);
check('Safari names no URL', chunkUrlFrom(safari), '');
check('somebody else\'s origin is not ours to fetch',
  chunkUrlFrom(new Error(`Failed to fetch dynamically imported module: https://evil.example/a.js`)), '');

// --- the recovery ----------------------------------------------------
reset();
check('recovery reports itself underway', await recoverFromChunkError(chrome), true);
check('it re-fetched the chunk', fetches.map(f => f.url), [CHUNK]);
check('past the cache', fetches[0]?.options?.cache, 'reload');
check('as us', fetches[0]?.options?.credentials, 'same-origin');
check('then reloaded', reloads, 1);

// A chunk that is genuinely gone would otherwise reload forever.
check('a second failure in the same minute gives up', await recoverFromChunkError(chrome), false);
check('so it stays at one fetch', fetches.length, 1);
check('and one reload', reloads, 1);

// The cooldown is what holds it back, not the fetch or the error.
reset();
store.set('chunk-reload-at', String(Date.now() - 61000));
check('a minute later it may try again', await recoverFromChunkError(chrome), true);
check('reloaded again', reloads, 1);

// Storage denied (private mode) means no memory of a previous attempt,
// so the loop guard can't hold: show the error instead of reloading.
reset();
denyStorage = true;
check('no storage, no automatic reload', await recoverFromChunkError(chrome), false);
check('and nothing fetched', fetches.length, 0);
check('and nothing reloaded', reloads, 0);

// Offline, blocked, aborted: the reload is still the user's best move.
reset();
fetchFails = true;
check('a failed re-fetch still reloads', await recoverFromChunkError(chrome), true);
check('it did try', fetches.length, 1);
check('and reloaded anyway', reloads, 1);

// Safari's message carries no URL, so there is nothing to repair — but
// the tab may still simply be out of date, which the reload does fix.
reset();
check('no URL, still reloads', await recoverFromChunkError(safari), true);
check('nothing to re-fetch', fetches.length, 0);
check('reloaded', reloads, 1);

// The crash screen's Reload button: the user got there because the
// automatic attempt was skipped or didn't take, so a plain reload is the
// move already known not to work. Repair first, every time, no cooldown.
reset();
store.set('chunk-reload-at', String(Date.now()));
await reloadPastCache(chrome);
check('the button repairs even inside the cooldown', fetches.map(f => f.url), [CHUNK]);
check('and reloads', reloads, 1);

// --- saying what actually went wrong ---------------------------------
// One sentence and one error message is all a report of this arrives
// with, and the message is the same whichever of these it was.
const DEP = `${ORIGIN}/assets/chunk-zsgVPwQN.js`;
const DEEP = `${ORIGIN}/assets/draftCampaignQueue-x.js`;
const withDeps = { body: `import{a}from"./chunk-zsgVPwQN.js";import"./draftEmail-x.js";` };
// chunk -> dep -> deep: the browser fetches all three, the error names none but the first.
const nested = () => {
  routes.set(CHUNK, withDeps);
  routes.set(DEP, { body: `import"./draftCampaignQueue-x.js";` });
};

reset();
routes.set(CHUNK, 'throw');
check('a request that never lands is called blocked', (await diagnoseChunk(CHUNK)).verdict, 'blocked');

reset();
routes.set(CHUNK, { status: 404, type: 'text/plain' });
const missing = await diagnoseChunk(CHUNK);
check('a 404 is the deploy, not the browser', missing.verdict, 'missing');
check('and says so with the status', missing.summary.includes('HTTP 404'), true);

reset();
routes.set(CHUNK, { status: 200, type: 'text/html; charset=utf-8', body: '<!doctype html>' });
check('HTML where JavaScript belongs', (await diagnoseChunk(CHUNK)).verdict, 'wrong-type');

reset();
routes.set(CHUNK, withDeps);
routes.set(DEP, { status: 404 });
const dep = await diagnoseChunk(CHUNK);
check('a missing import is found behind a chunk that serves fine', dep.verdict, 'missing-dep');
check('and named, since the error message names the wrong file',
  dep.summary.includes('chunk-zsgVPwQN.js'), true);
check('with the status it returned', dep.detail.includes('404'), true);

reset();
routes.set(CHUNK, withDeps);
routes.set(DEP, 'throw');
check('an import blocked on the way out', (await diagnoseChunk(CHUNK)).verdict, 'blocked-dep');

// One level is not enough: the view that started all this imports 24
// files directly and pulls in ninety through them.
reset();
nested();
routes.set(DEEP, { status: 404 });
const deep = await diagnoseChunk(CHUNK);
check('a file two levels down is still found', deep.verdict, 'missing-dep');
check('and named', deep.summary.includes('draftCampaignQueue-x.js'), true);

reset();
nested();
check('a clean graph is walked to the bottom', (await diagnoseChunk(CHUNK)).detail.includes('3 files'), true);
check('each file asked for once', new Set(fetches.map(f => f.url)).size, fetches.length);

// The question a fetch cannot answer: the browser tags a module
// `Sec-Fetch-Dest: script`, and a filter can refuse that while letting
// every fetch above through.
reset();
scriptProbe = 'error';
routes.set(CHUNK, withDeps);
const blockedScript = await diagnoseChunk(CHUNK);
check('downloads as data, refused as code', blockedScript.verdict, 'script-blocked');
check('and says it is a filter, not the app', blockedScript.summary.includes('That is a filter'), true);

reset();
scriptProbe = 'load';
routes.set(CHUNK, withDeps);
check('loads as code too, so it was momentary', (await diagnoseChunk(CHUNK)).verdict, 'transient');

reset();
routes.set(CHUNK, withDeps);
const restore = noDocument();
const reachable = await diagnoseChunk(CHUNK);
restore();
check('no way to ask, so no claim either way', reachable.verdict, 'reachable');
check('it still counted what it walked', reachable.summary.includes('the 2 files it pulls in'), true);

reset();
check('nothing to test without a URL', (await diagnoseChunk('')).verdict, 'unknown');

reset();
const CSS = `${ORIGIN}/assets/DraftEmailsPage-DBsKLELe.css`;
routes.set(CSS, { status: 200, type: 'text/css', body: '.x{color:red}' });
scriptProbe = 'load';
check('a stylesheet is judged as a stylesheet', (await diagnoseChunk(CSS)).verdict, 'transient');

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

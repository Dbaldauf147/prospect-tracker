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

let reloads = 0;
globalThis.window = { location: { href: `${ORIGIN}/`, origin: ORIGIN, reload() { reloads += 1; } } };

let fetches = [];
let fetchFails = false;
globalThis.fetch = async (url, options) => {
  fetches.push({ url, options });
  if (fetchFails) throw new TypeError('Failed to fetch');
  return { ok: true, status: 200 };
};

function reset() {
  store.clear();
  denyStorage = false;
  reloads = 0;
  fetches = [];
  fetchFails = false;
}

const {
  isChunkLoadError, chunkUrlFrom, recoverFromChunkError, reloadPastCache,
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

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

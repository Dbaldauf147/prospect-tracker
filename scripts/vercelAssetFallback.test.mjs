// Assertion tests for the routing in vercel.json.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/vercelAssetFallback.test.mjs
//
// What this guards, and why it is worth a test for two lines of JSON:
//
// The SPA fallback answers every path the filesystem doesn't have with
// index.html, so that any URL on the domain serves the app. Left as
// `/(.*)` it also answered requests for a hashed chunk that isn't in this
// deploy — with HTML, and status 200, under the `immutable` cache header
// below. The browser then holds a year-long copy of index.html at a URL
// the app imports as a module, and every later load fails on it without a
// request going anywhere. That is a chunk error nothing recovers from
// except overwriting the entry (see src/utils/lazyView.js).
//
// So the fallback now excludes /assets/, and a missing chunk 404s instead
// of masquerading as one. Getting that pattern wrong in the other
// direction is worse than the bug: if it stops matching ordinary paths,
// every URL on the site 404s. Hence both halves are pinned here.
//
// Two things measured under Chromium while writing this, so nobody has to
// re-derive them:
//   - Dropping `immutable` does NOT make a plain reload repair a bad
//     cached copy. Chrome stopped revalidating subresources on reload
//     long ago, so the entry is reused either way. Long-lived caching is
//     not the bug and removing it is not the fix.
//   - A 404 carrying that header is itself cached and reused. Whether
//     Vercel applies these headers to a 404 it generates is not something
//     this repo can test, so the client-side repair stays the layer that
//     actually heals a poisoned entry.

import { readFile } from 'node:fs/promises';

const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const fallback = config.rewrites?.find(r => r.destination === '/index.html');
check('there is still an SPA fallback', Boolean(fallback), true);

// Vercel compiles `source` with path-to-regexp, which passes a bare group
// through as regex and wraps the whole thing. Rebuilding it that way here
// keeps the test honest without taking on the dependency — but only for a
// source written as plain regex, so hold it to that.
check('the fallback source is plain regex, no :params', /:\w/.test(fallback?.source || ''), false);
const matches = (path) => new RegExp(`^(?:${fallback.source})[/#?]?$`, 'i').test(path);

// --- everything still reaches the app --------------------------------
check('the root', matches('/'), true);
check('a typed path', matches('/drafts'), true);
check('a deeper one', matches('/company/acme'), true);
check('a file at the root', matches('/favicon.svg'), true);
check('something that merely starts with the word', matches('/assetsomething'), true);

// --- except the build output -----------------------------------------
check('a chunk from this deploy is never answered with HTML',
  matches('/assets/DraftEmailsPage-BItk0RD6.js'), false);
check('nor a stylesheet', matches('/assets/index-abc123.css'), false);
check('nor anything else under it', matches('/assets/logo-x1.svg'), false);

// Real files are served before rewrites are consulted — the app works
// today under `/(.*)`, which would otherwise have answered every asset
// with index.html — so this only changes the case where the file is gone.

// --- the cache header the whole problem hangs on ----------------------
const assetHeader = config.headers
  ?.find(h => h.source === '/assets/(.*)')
  ?.headers?.find(h => h.key.toLowerCase() === 'cache-control')?.value || '';
const maxAge = Number(/max-age=(\d+)/.exec(assetHeader)?.[1] || 0);
check('hashed assets are still cached long', maxAge >= 604800, true);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

// Assertion tests for the short tracked-link form (/c/<id>/<index>).
// Plain Node, no framework. Run: node scripts/shortTrackedLinks.test.mjs
//
// The recipient sees the whole tracked href on hover, so links are written
// as /c/<id>/<index> rather than /api/track-click?id=...&l=.... vercel.json
// rewrites the short form onto the same endpoint; these checks pin the link
// shape, the id shape, and that the two stay in step.
import { readFileSync } from 'node:fs';
import { injectTracking, newTrackingId, trackedClickUrl, TRACKING_ID_LENGTH } from '../api/_lib/tracking.js';

let failures = 0;
function check(label, ok) {
  if (ok) console.log(`PASS  ${label}`);
  else { failures += 1; console.log(`FAIL  ${label}`); }
}

const base = 'https://example.app';

// ---- ids -----------------------------------------------------------------
const ids = new Set();
for (let i = 0; i < 2000; i++) ids.add(newTrackingId());
check('id: 12 url-safe base62 characters', [...ids].every(id => new RegExp(`^[0-9A-Za-z]{${TRACKING_ID_LENGTH}}$`).test(id)));
check('id: no collisions in 2000', ids.size === 2000);

// ---- link shape ----------------------------------------------------------
check('short url shape', trackedClickUrl(base, 'abcDEF123456', 2) === 'https://example.app/c/abcDEF123456/2');

const html = '<p><a href="https://youtube.com/watch?v=x&amp;t=1">video</a> '
  + '<a href="mailto:a@b.com">mail</a> '
  + '<a href="https://example.com/book">book</a></p>';
const out = injectTracking(html, { trackingId: 'abcDEF123456', baseUrl: base });
check('links rewritten to short form', out.html.includes('href="https://example.app/c/abcDEF123456/0"')
  && out.html.includes('href="https://example.app/c/abcDEF123456/1"'));
check('no long-form click links written', !out.html.includes('/api/track-click'));
check('mailto left alone', out.html.includes('href="mailto:a@b.com"'));
check('original urls stored by index, entities decoded',
  JSON.stringify(out.links) === JSON.stringify(['https://youtube.com/watch?v=x&t=1', 'https://example.com/book']));

// A body tracked twice is not double-wrapped, in either form.
const again = injectTracking(out.html, { trackingId: 'zzzzzzzzzzzz', baseUrl: base });
check('already-short links not re-wrapped', again.links.length === 0);
const legacy = injectTracking('<a href="https://example.app/api/track-click?id=x&l=0">x</a>', { trackingId: 'y', baseUrl: base });
check('legacy long links not re-wrapped', legacy.links.length === 0);

// ---- the rewrite that makes the short form work ----------------------------
const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const rw = vercel.rewrites || [];
const shortIdx = rw.findIndex(r => r.source === '/c/:id/:l' && r.destination === '/api/track-click?id=:id&l=:l');
const spaIdx = rw.findIndex(r => r.destination === '/index.html');
check('vercel.json rewrites /c/:id/:l to the click endpoint', shortIdx !== -1);
check('short-link rewrite sits before the SPA catch-all', shortIdx !== -1 && shortIdx < spaIdx);

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nAll short tracked-link checks passed.');

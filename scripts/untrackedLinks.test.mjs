// Assertion tests for per-link "don't track" (src/utils/untrackedLinks.js and
// the skipUrls option of injectTracking). Plain Node. Run:
//   node scripts/untrackedLinks.test.mjs
//
// The point of an untracked link is that its href is left EXACTLY as written,
// so the recipient's hover shows the real address. The other links in the
// same email must still be tracked, with indexes that line up with the links
// array the redirector resolves against.
import { listTrackableLinks, linkKey, untrackedKeySet, toggleUntracked } from '../src/utils/untrackedLinks.js';
import { injectTracking } from '../api/_lib/tracking.js';

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) console.log(`PASS  ${label}`);
  else { failures += 1; console.log(`FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
}

const event = 'https://events.se.com/event/4f975482-78c3-4759-8f63-fead4840746b/homepage?environment=production-eu&RefId=Outlook';
const eventHref = event.replace(/&/g, '&amp;');
const html = `<p>See the <a href="${eventHref}">event</a>, the <a href="https://youtube.com/v">video</a>,`
  + ` <a href='https://youtube.com/v/'>again</a>, <a href="mailto:x@y.com">mail</a>.</p>`;

// ---- listing -------------------------------------------------------------
check('lists distinct http links, decoded, in order',
  listTrackableLinks(html).map(l => l.url), [event, 'https://youtube.com/v']);
check('trailing slash is the same link', linkKey('https://youtube.com/v/'), linkKey('https://youtube.com/v'));
check('entity-encoded and plain hrefs share a key', linkKey(eventHref), linkKey(event));

// ---- saved choice --------------------------------------------------------
let saved = toggleUntracked(undefined, event, true);
check('toggle on adds the key', saved, [linkKey(event)]);
saved = toggleUntracked(saved, event, true);
check('toggle on twice keeps one entry', saved.length, 1);
check('toggle off removes it', toggleUntracked(saved, eventHref, false), []);
check('junk in settings is ignored', [...untrackedKeySet([null, '', 5, event])], ['5', linkKey(event)]);

// ---- injection -----------------------------------------------------------
const base = 'https://example.app';
const out = injectTracking(html, { trackingId: 'abcDEF123456', baseUrl: base, skipUrls: [event] });
check('untracked link href left exactly as written', out.html.includes(`href="${eventHref}"`), true);
check('other links still tracked from index 0',
  out.html.includes(`href="${base}/c/abcDEF123456/0"`) && out.html.includes(`href='${base}/c/abcDEF123456/1'`), true);
check('links array holds only the tracked ones', out.links, ['https://youtube.com/v', 'https://youtube.com/v/']);
check('mailto untouched', out.html.includes('href="mailto:x@y.com"'), true);

const none = injectTracking(html, { trackingId: 'abcDEF123456', baseUrl: base });
check('without skipUrls every link is tracked', none.links.length, 3);

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nAll untracked-link checks passed.');

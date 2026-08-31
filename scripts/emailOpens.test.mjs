// Assertion tests for the open-count classifier. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/emailOpens.test.mjs
//
// What prompted this: the campaign report showed 4 opens on an email sent
// that morning, and 1 open on rows HubSpot said were NOT SENT AT ALL. The
// tracking pixel is injected into the Outlook DRAFT (api/outlook-draft.js),
// so it fires while the user is still proof-reading — and api/track-open.js
// serves it no-store, so every re-render of the message fetches it again.
// The raw openCount is therefore "times the pixel was fetched", not "times
// somebody read this".
//
// The rules under test, in the order countOpens() applies them:
//   1. a hit before the send is a draft preview, not an open;
//   2. a hit from a scanner/bot user-agent is not a human;
//   3. a hit from the same client within 5 minutes is the same read.
// Everything else counts — INCLUDING Gmail's image proxy, which fetches
// because a human opened the message.

import { countOpens, describeExcludedOpens, isMachineOpen, trackingMillis } from '../src/utils/emailOpens.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}
function contains(label, haystack, needle) {
  const ok = String(haystack).includes(needle);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got: ${JSON.stringify(haystack)}\n      missing: ${JSON.stringify(needle)}`}`);
}

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const GMAIL = 'Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)';

const t = (iso) => new Date(iso).toISOString();
const open = (at, ua = MAC, ip = '203.0.113.9') => ({ at: t(at), ua, ip });

// --- timestamp shapes -------------------------------------------------
// The client sees Firestore Timestamps on the realtime path and the
// { _seconds } form on the /api/track-list fallback; both must compare.
check('trackingMillis reads the track-list shape', trackingMillis({ _seconds: 1700000000, _nanoseconds: 0 }), 1700000000000);
check('trackingMillis reads a Firestore Timestamp', trackingMillis({ toDate: () => new Date(1700000000000) }), 1700000000000);
check('trackingMillis reads an ISO string', trackingMillis('2026-08-31T12:00:00.000Z'), Date.parse('2026-08-31T12:00:00.000Z'));
check('trackingMillis on nothing is 0', trackingMillis(null), 0);

// --- rule 1: pre-send -------------------------------------------------
// The screenshot case: a row still marked "Not Sent" showing 1 open.
const neverSent = { openCount: 1, opens: [open('2026-08-31T14:00:00Z')] };
check('a hit on an unsent draft is not an open', countOpens(neverSent, { sentAt: null }).count, 0);
check('...and is reported as pre-send', countOpens(neverSent, { sentAt: null }).preSend, 1);
check('...while the raw count is preserved', countOpens(neverSent, { sentAt: null }).raw, 1);
check('...and with no send date known at all, it still counts', countOpens(neverSent).count, 1);

const proofRead = {
  openCount: 3,
  opens: [
    open('2026-08-31T09:12:00Z'),            // proof-reading the draft
    open('2026-08-31T09:40:00Z'),            // ...and again before sending
    open('2026-08-31T15:20:00Z', IPHONE, '198.51.100.4'), // the recipient
  ],
};
const sent = countOpens(proofRead, { sentAt: '2026-08-31T10:00:00Z' });
check('opens before the send are dropped', sent.count, 1);
check('...counted as pre-send', sent.preSend, 2);
check('...and first open is the recipient\'s', sent.firstOpenAt, Date.parse('2026-08-31T15:20:00Z'));

// Clock skew between HubSpot's send timestamp and our own server must not
// throw away a real open that lands a moment "before" the send.
const skewed = { openCount: 1, opens: [open('2026-08-31T09:59:00Z', IPHONE, '198.51.100.4')] };
check('an open a minute before the send survives the grace window', countOpens(skewed, { sentAt: '2026-08-31T10:00:00Z' }).count, 1);

// --- rule 2: machines -------------------------------------------------
check('a link scanner is a machine', isMachineOpen({ ua: 'Mozilla/5.0 (compatible; Barracuda Sentinel)' }), true);
check('Outlook link-preview is a machine', isMachineOpen({ ua: 'Microsoft Office Existence Discovery' }), true);
check('a bare HTTP client is a machine', isMachineOpen({ ua: 'curl/8.4.0' }), true);
check('no user-agent at all is a machine', isMachineOpen({ ua: '' }), true);
check('a real Mac is not', isMachineOpen({ ua: MAC }), false);
// Gmail's proxy fetches BECAUSE somebody opened the message. Excluding it
// would zero out the most common mail client there is.
check('Gmail image proxy is not a machine', isMachineOpen({ ua: GMAIL }), false);
const scanned = {
  openCount: 2,
  opens: [
    open('2026-08-31T11:00:00Z', 'Mozilla/5.0 (compatible; Proofpoint)', '192.0.2.7'),
    open('2026-08-31T11:30:00Z', GMAIL, '66.249.84.1'),
  ],
};
const scan = countOpens(scanned, { sentAt: '2026-08-31T10:00:00Z' });
check('the scanner hit is excluded', scan.machine, 1);
check('...and the Gmail proxy hit counts', scan.count, 1);

// --- rule 3: repeats --------------------------------------------------
// The pixel is served no-store, so scrolling back re-fetches it.
const reread = {
  openCount: 4,
  opens: [
    open('2026-08-31T15:00:00Z', IPHONE, '198.51.100.4'),
    open('2026-08-31T15:01:30Z', IPHONE, '198.51.100.4'),
    open('2026-08-31T15:04:00Z', IPHONE, '198.51.100.4'),
    open('2026-08-31T18:00:00Z', IPHONE, '198.51.100.4'), // a genuine re-read
  ],
};
const burst = countOpens(reread, { sentAt: '2026-08-31T10:00:00Z' });
check('a burst from one client counts once', burst.count, 2);
check('...with the rest called repeats', burst.repeat, 2);
check('...and the last open is the later read', burst.lastOpenAt, Date.parse('2026-08-31T18:00:00Z'));

// The window slides off the last hit, counted or not, so a client polling
// just inside it doesn't leak one open per window.
const drip = {
  openCount: 4,
  opens: [
    open('2026-08-31T15:00:00Z', IPHONE, '198.51.100.4'),
    open('2026-08-31T15:04:00Z', IPHONE, '198.51.100.4'),
    open('2026-08-31T15:08:00Z', IPHONE, '198.51.100.4'),
    open('2026-08-31T15:12:00Z', IPHONE, '198.51.100.4'),
  ],
};
check('a steady drip inside the window stays one open', countOpens(drip, { sentAt: '2026-08-31T10:00:00Z' }).count, 1);

// Two different people reading at the same moment are two opens.
const twoReaders = {
  openCount: 2,
  opens: [
    open('2026-08-31T15:00:00Z', IPHONE, '198.51.100.4'),
    open('2026-08-31T15:00:30Z', MAC, '203.0.113.77'),
  ],
};
check('different clients are not collapsed', countOpens(twoReaders, { sentAt: '2026-08-31T10:00:00Z' }).count, 2);

// --- events out of order ---------------------------------------------
// Verdicts are returned in the doc's own order even though the rules run
// chronologically, so the UI can label the list it already renders.
const outOfOrder = {
  openCount: 2,
  opens: [open('2026-08-31T15:02:00Z', IPHONE, '198.51.100.4'), open('2026-08-31T15:00:00Z', IPHONE, '198.51.100.4')],
};
const ordered = countOpens(outOfOrder, { sentAt: '2026-08-31T10:00:00Z' });
check('the earlier hit is the one counted', ordered.events[1].verdict, 'counted');
check('...and the later one is the repeat', ordered.events[0].verdict, 'repeat');

// --- docs with nothing to classify ------------------------------------
check('a doc with no events falls back to its raw count', countOpens({ openCount: 2, opens: [] }).count, 2);
check('...and says so', countOpens({ openCount: 2, opens: [] }).unclassified, 2);
check('a doc with no opens at all is 0', countOpens({ openCount: 0, opens: [] }).count, 0);
check('a missing doc is 0', countOpens(null).count, 0);
// Event arrays are capped (tracking.js MAX_EVENTS): hits we can no longer
// inspect are carried, not silently dropped.
const trimmed = { openCount: 120, opens: [open('2026-08-31T15:00:00Z', IPHONE, '198.51.100.4')] };
check('trimmed events are carried as unclassified', countOpens(trimmed, { sentAt: '2026-08-31T10:00:00Z' }).count, 120);

// --- the explanation shown to the user --------------------------------
check('nothing excluded means no explanation', describeExcludedOpens(countOpens(twoReaders, { sentAt: '2026-08-31T10:00:00Z' })), '');
const why = describeExcludedOpens(countOpens(proofRead, { sentAt: '2026-08-31T10:00:00Z' }));
contains('the explanation names the total', why, '2 of 3 pixel hits not counted');
contains('...and the reason', why, 'before the send (draft preview)');

console.log(failures === 0 ? '\nAll open-count tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

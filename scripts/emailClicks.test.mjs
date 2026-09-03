// Assertion tests for click filtering and screening detection on the Email
// Tracking tab. Plain Node — no test framework (the project has none). Run:
//   node scripts/emailClicks.test.mjs
//
// Clicks were the one metric on that page with nothing filtering them, while
// the page's own copy called them its hard signal. Corporate mail gateways —
// Mimecast, Proofpoint, Microsoft Defender's Safe Links — fetch every URL in an
// incoming message to scan it, and each fetch hits our redirector and looked
// exactly like a person deciding to click.
//
// Two asymmetries with the image-load filter are deliberate and asserted here.
//
//   1. Repeat clicks are NOT collapsed, where repeat loads are. Two loads from
//      one client inside five minutes are one message re-rendered; two clicks
//      are two decisions, and merging them would hide somebody going back to a
//      link.
//   2. A machine CLICK is enough on its own to report screening — nothing else
//      follows a tracking redirect — but a machine OPEN has to name a gateway
//      first, because a generic crawler trips the same filter and a crawler is
//      not evidence that the recipient's company screens its mail.
import {
  countClicks,
  describeExcludedClicks,
  screeningEvidence,
  scannerName,
} from '../src/utils/emailClicks.js';

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`PASS  ${label}`); }
  else { failures += 1; console.log(`FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
const MIMECAST = 'Mimecast link scanner/2.0';
const SAFELINKS = 'Mozilla/5.0 (compatible; SafeLinks)';
const t = (n) => new Date(2026, 2, 2, 9, n).toISOString();
const click = (min, ua, url = 'https://example.com/savings') => ({ at: t(min), ua, url });

// ---- scanner naming ------------------------------------------------------

check('names Mimecast', scannerName(MIMECAST), 'Mimecast');
check('names Defender from its SafeLinks agent', scannerName(SAFELINKS), 'Microsoft Defender');
check('an ordinary browser is not a scanner', scannerName(UA), '');
check('nothing in, nothing out', scannerName(null), '');

// ---- counting ------------------------------------------------------------

const mixed = countClicks({
  clickCount: 3,
  clicks: [click(0, MIMECAST), click(5, UA), click(40, UA)],
});
check('a gateway sweep is excluded and the human clicks stand',
  [mixed.count, mixed.machine, mixed.raw], [2, 1, 3]);
check('and each event carries its verdict',
  mixed.events.map(e => e.verdict), ['machine', 'counted', 'counted']);

// Asymmetry 1: no dedupe. Two clicks on the same link a minute apart are two.
check('repeat clicks are NOT collapsed the way repeat image loads are',
  countClicks({ clickCount: 2, clicks: [click(0, UA), click(1, UA)] }).count, 2);

check('a click with no user-agent is treated as a machine, as the pixel does',
  countClicks({ clickCount: 1, clicks: [{ at: t(0), url: 'https://example.com/x' }] }).count, 0);

check('an all-scanner send counts zero human clicks',
  countClicks({ clickCount: 2, clicks: [click(0, MIMECAST), click(0, SAFELINKS, 'https://example.com/legal')] }).count, 0);

// The event array is capped while the counter stays exact — clicks past the cap
// are kept as real rather than silently dropped.
check('clicks past the stored event cap stay counted',
  countClicks({ clickCount: 120, clicks: [click(0, UA)] }).count, 120);
check('a doc with no stored events reports its raw counter',
  countClicks({ clickCount: 4, clicks: [] }).count, 4);
check('an empty doc is zero, not an error', countClicks({}).count, 0);
check('no argument behaves the same', countClicks().count, 0);

// ---- what the tooltip says ----------------------------------------------

check('the exclusion note names the gateway when we know it',
  describeExcludedClicks(mixed, 'Mimecast'),
  '1 of 3 clicks not counted: a security scanner (Mimecast) followed the links before the recipient saw them.');
check('and stays quiet when nothing was excluded',
  describeExcludedClicks(countClicks({ clickCount: 1, clicks: [click(0, UA)] })), '');

// ---- screening detection -------------------------------------------------

const opens = (events) => ({ events });
check('a machine click alone reports screening, named',
  screeningEvidence(mixed, opens([])), { screened: true, scanner: 'Mimecast' });

// Asymmetry 2: an unnamed machine click still counts; an unnamed machine open
// does not. "Unnamed" means an agent the machine filter catches but the vendor
// list doesn't identify — a bare HTTP client, not an agent we've never seen.
// (An agent on NEITHER list is not filtered at all; see the note in the PR.)
check('a machine click we cannot name still reports screening',
  screeningEvidence(countClicks({ clickCount: 1, clicks: [click(0, 'python-requests/2.31.0')] }), opens([])),
  { screened: true, scanner: '' });
check('an agent on neither list is treated as a person, not silently dropped',
  countClicks({ clickCount: 1, clicks: [click(0, 'some-unknown-agent/1.0')] }).count, 1);
check('a generic crawler fetching the PIXEL is not evidence of a gateway',
  screeningEvidence(countClicks({}), opens([{ verdict: 'machine', event: { ua: 'some-crawler/1.0' } }])),
  { screened: false, scanner: '' });
check('a NAMED gateway fetching the pixel is',
  screeningEvidence(countClicks({}), opens([{ verdict: 'machine', event: { ua: SAFELINKS } }])),
  { screened: true, scanner: 'Microsoft Defender' });
check('an ordinary send reports no screening',
  screeningEvidence(countClicks({ clickCount: 1, clicks: [click(0, UA)] }), opens([{ verdict: 'counted', event: { ua: UA } }])),
  { screened: false, scanner: '' });
check('nothing at all does not throw',
  screeningEvidence(null, null), { screened: false, scanner: '' });

console.log(failures === 0 ? '\nAll click-filter tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

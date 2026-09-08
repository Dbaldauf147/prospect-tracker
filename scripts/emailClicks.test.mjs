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
// Two more ways to produce a click without a person were added after image
// loads were dropped from the page and the click became the number carrying
// its weight: a link followed while proof-reading the Outlook DRAFT (the
// rewritten links work before the mail is sent, so this used to count as the
// recipient clicking), and a gateway that presents an ordinary browser
// user-agent but sweeps every link in the message at once. Both are asserted
// at the bottom of this file, along with the line the sweep rule will not
// cross: a message with ONE link can never produce a sweep verdict, because a
// single-link sweep is indistinguishable from a person clicking the only
// thing there is to click.
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
  CLICK_SWEEP_MS,
} from '../src/utils/emailClicks.js';
import { isSelfSend } from '../src/utils/selfSends.js';

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`PASS  ${label}`); }
  else { failures += 1; console.log(`FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
const MIMECAST = 'Mimecast link scanner/2.0';
const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
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
  '1 of 3 clicks not counted: 1 followed by a security scanner (Mimecast).');
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

// ---- the pre-send gate ---------------------------------------------------
//
// Same three-way meaning countOpens() uses, and the difference between the
// three is the whole point: "send time unknown" and "known not sent" are not
// the same question, and answering them the same way is how a draft preview
// ends up counted as a prospect's click.

const SENT = new Date(2026, 2, 2, 9, 30).getTime();
const fromSend = (mins) => new Date(SENT + mins * 60000).toISOString();
const verdicts = (summary) => summary.events.map(e => e.verdict);

const proofRead = {
  clickCount: 2,
  clicks: [
    { url: 'https://example.com/book', ua: UA, at: fromSend(-30) },  // proof-reading
    { url: 'https://example.com/book', ua: UA, at: fromSend(120) },  // the recipient
  ],
};

check('gate: with a send time, a click before it is a draft preview',
  verdicts(countClicks(proofRead, { sentAt: SENT })), ['pre-send', 'counted']);
check('gate: only the click after the send is counted',
  countClicks(proofRead, { sentAt: SENT }).count, 1);
check('gate: with no send time known, nothing is gated',
  verdicts(countClicks(proofRead)), ['counted', 'counted']);
check('gate: known NOT sent means every click is a preview',
  verdicts(countClicks(proofRead, { sentAt: null })), ['pre-send', 'pre-send']);

// The send time comes from HubSpot and the click time from our own server, so
// they agree to the minute at best. A click a moment "before" the send is the
// recipient's, not a preview.
check('gate: the clock grace keeps a click at the moment of sending',
  verdicts(countClicks(
    { clickCount: 1, clicks: [{ url: 'https://example.com/a', ua: UA, at: fromSend(-1) }] },
    { sentAt: SENT },
  )), ['counted']);

check('gate: a draft preview is named as one in the tooltip',
  /proof-reading/.test(describeExcludedClicks(countClicks(proofRead, { sentAt: SENT }))), true);

// ---- gateways that don't announce themselves -----------------------------
//
// The shape is the evidence: one client, several distinct links, all inside a
// minute. No user-agent test would ever catch this one.

const sweepDoc = {
  clickCount: 3,
  clicks: [
    { url: 'https://example.com/a', ua: UA, ip: '10.0.0.1', at: fromSend(1) },
    { url: 'https://example.com/b', ua: UA, ip: '10.0.0.1', at: fromSend(1.1) },
    { url: 'https://example.com/c', ua: UA, ip: '10.0.0.1', at: fromSend(1.2) },
  ],
};
check('sweep: one client following every link at once is a machine',
  verdicts(countClicks(sweepDoc)), ['sweep', 'sweep', 'sweep']);
check('sweep: none of it survives into the count', countClicks(sweepDoc).count, 0);
check('sweep: it is described by what it was',
  /sweep/.test(describeExcludedClicks(countClicks(sweepDoc))), true);

check('sweep: the same links spread over hours are a person reading',
  verdicts(countClicks({
    clickCount: 3,
    clicks: [
      { url: 'https://example.com/a', ua: UA, ip: '10.0.0.1', at: fromSend(60) },
      { url: 'https://example.com/b', ua: UA, ip: '10.0.0.1', at: fromSend(180) },
      { url: 'https://example.com/c', ua: UA, ip: '10.0.0.1', at: fromSend(300) },
    ],
  })), ['counted', 'counted', 'counted']);

check('sweep: two different people clicking at once are not one sweep',
  verdicts(countClicks({
    clickCount: 2,
    clicks: [
      { url: 'https://example.com/a', ua: UA, ip: '10.0.0.1', at: fromSend(1) },
      { url: 'https://example.com/b', ua: PHONE, ip: '10.0.0.2', at: fromSend(1.1) },
    ],
  })), ['counted', 'counted']);

// The line this rule will not cross. A one-link email — which is what
// signature-only outreach is — cannot produce a sweep, however fast the clicks
// arrive, because there is no second destination to prove a machine walked the
// message. Crossing it would throw away real clicks on the only call to action
// the email has.
check('sweep: one link clicked twice in a second is still not a sweep',
  verdicts(countClicks({
    clickCount: 2,
    clicks: [
      { url: 'https://example.com/book', ua: UA, ip: '10.0.0.1', at: fromSend(1) },
      { url: 'https://example.com/book', ua: UA, ip: '10.0.0.1', at: fromSend(1.01) },
    ],
  })), ['counted', 'counted']);

// Proximity is the only evidence a sweep has, so events we cannot place in
// time are unknown, not close together.
check('sweep: events with no timestamp are never swept',
  verdicts(countClicks({
    clickCount: 2,
    clicks: [{ url: 'https://example.com/a', ua: UA }, { url: 'https://example.com/b', ua: UA }],
  })), ['counted', 'counted']);

check('sweep: a gap past the window splits the cluster',
  verdicts(countClicks({
    clickCount: 2,
    clicks: [
      { url: 'https://example.com/a', ua: UA, ip: '10.0.0.1', at: new Date(SENT + 60000).toISOString() },
      { url: 'https://example.com/b', ua: UA, ip: '10.0.0.1', at: new Date(SENT + 60000 + CLICK_SWEEP_MS + 1000).toISOString() },
    ],
  })), ['counted', 'counted']);

// A sweep is the same fact as a named scanner, caught by shape instead of by
// name — so it has to raise the same flag, or the one case the user-agent list
// cannot see would also be the one case the row never mentions.
check('sweep: an unnamed sweep is evidence of a gateway',
  screeningEvidence(countClicks(sweepDoc), opens([])), { screened: true, scanner: '' });

// ---- tests the sender addressed to themselves ----------------------------
//
// The composer keeps the user's own address in the To line on purpose, so
// these accumulate — and every click on one is the sender's own.

check('self: a send to the address that sent it is a test',
  isSelfSend({ to: 'daniel.baldauf@se.com', ownerEmail: 'daniel.baldauf@se.com' }), true);
check('self: casing and a display name do not hide it',
  isSelfSend({ to: 'Dan Baldauf <Daniel.Baldauf@SE.com>', ownerEmail: 'daniel.baldauf@se.com' }), true);
check('self: a prospect is not a test',
  isSelfSend({ to: 'prospect@acme.com', ownerEmail: 'daniel.baldauf@se.com' }), false);
check('self: a doc written before ownerEmail was stored falls back to the signed-in user',
  isSelfSend({ to: 'daniel.baldauf@se.com' }, 'daniel.baldauf@se.com'), true);
check('self: with no owner to compare against, nothing is a test',
  isSelfSend({ to: 'daniel.baldauf@se.com' }), false);

console.log(failures === 0 ? '\nAll click-filter tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

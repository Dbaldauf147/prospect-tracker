// Assertion tests for the click-by-link roll-up on the Email Tracking tab.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/emailLinks.test.mjs
//
// Two things are easy to get wrong here and both are quiet.
//
// The first is counting people as clicks. One recipient clicking the same
// link five times is one interested person, and a roll-up that reports "5"
// next to a link two other people clicked once each ranks the wrong link
// first. So every link carries both numbers.
//
// The second is the event cap. Each tracking doc stores at most 100 events
// but its clickCount stays exact, so on a heavily-clicked send the per-link
// numbers cannot add up to the total. That gap is reported rather than
// hidden, otherwise the breakdown quietly contradicts the tile above it.
import { shortLinkLabel, linkLabel, isSchedulingLink, linksForRow, clicksByLink } from '../src/utils/emailLinks.js';

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`PASS  ${label}`); }
  else { failures += 1; console.log(`FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
}

// ---- shortLinkLabel ------------------------------------------------------

check('label: host + last path segment',
  shortLinkLabel('https://www.example.com/reports/indicative-savings'), 'example.com/indicative savings');
check('label: query strings and tracking params are dropped',
  shortLinkLabel('https://example.com/book-a-call?utm_source=email&utm_campaign=q3'), 'example.com/book a call');
check('label: a bare domain is its own label',
  shortLinkLabel('https://example.com'), 'example.com');
check('label: a trailing slash does not produce an empty segment',
  shortLinkLabel('https://example.com/'), 'example.com');
check('label: a file extension is dropped',
  shortLinkLabel('https://example.com/docs/one-pager.pdf'), 'example.com/one pager');
check('label: an unparseable string comes back as itself',
  shortLinkLabel('not a url'), 'not a url');
check('label: nothing in, nothing out', shortLinkLabel(null), '');

// ---- linksForRow ---------------------------------------------------------

// Every fixture carries a browser user-agent: countClicks treats a click with
// no user-agent as a machine, the way the pixel always has, so a UA-less
// fixture would silently test the exclusion path instead of the counting one.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
const SCANNER = 'Mimecast link scanner';
const row = {
  to: 'dana@example.com',
  clickCount: 4,
  clicks: [
    { url: 'https://example.com/savings', ua: UA },
    { url: 'https://example.com/book', ua: UA },
    { url: 'https://example.com/savings', ua: UA },
    { url: 'https://example.com/savings', ua: UA },
  ],
};
check('row: distinct destinations, most-clicked first',
  linksForRow(row).map(l => [l.label, l.clicks]),
  [['example.com/savings', 3], ['example.com/book', 1]]);
check('row: no clicks reads as no links', linksForRow({ clicks: [] }), []);
check('row: a missing clicks array does not throw', linksForRow({}), []);

// ---- clicksByLink --------------------------------------------------------

const rows = [
  row,
  { to: 'priya@example.com', clickCount: 1, clicks: [{ url: 'https://example.com/book', ua: UA }] },
  { to: 'marcus@example.com', clickCount: 1, clicks: [{ url: 'https://example.com/book', ua: UA }] },
];
const agg = clicksByLink(rows);

// /savings has more raw clicks (3 vs 3) but they are all one person, and the
// tie breaks on recipients — which is the ranking that matters.
check('roll-up: ties break on distinct recipients, not raw clicks',
  agg.links.map(l => [l.label, l.clicks, l.recipients]),
  [['example.com/book', 3, 3], ['example.com/savings', 3, 1]]);
check('roll-up: the total is the human click count across the set', agg.totalClicks, 6);
check('roll-up: everything attributed when no doc hit the event cap', agg.unattributed, 0);

// A doc whose counter ran past its stored events — the cap in tracking.js.
const capped = clicksByLink([
  { to: 'a@example.com', clickCount: 120, clicks: [{ url: 'https://example.com/savings', ua: UA }] },
]);
check('roll-up: clicks past the stored event cap are reported, not dropped',
  [capped.totalClicks, capped.links[0].clicks, capped.unattributed], [120, 1, 119]);

const EMPTY = { links: [], totalClicks: 0, unattributed: 0, schedulingClicks: 0, schedulingRecipients: 0 };
check('roll-up: an empty set is empty, not an error', clicksByLink([]), EMPTY);
check('roll-up: no argument behaves the same', clicksByLink(), EMPTY);
// A click event with no url (shouldn't happen — the redirector only logs a
// resolved destination — but a malformed doc must not invent a blank link).
check('roll-up: an event with no url is skipped',
  clicksByLink([{ to: 'a@example.com', clickCount: 1, clicks: [{ url: '', ua: UA }] }]).links, []);

// A gateway sweeps every link in the message at once, which is exactly the
// shape that would otherwise crown the least interesting link.
const swept = clicksByLink([
  { to: 'a@example.com', clickCount: 3, clicks: [
    { url: 'https://example.com/savings', ua: UA },
    { url: 'https://example.com/legal', ua: SCANNER },
    { url: 'https://example.com/logo', ua: SCANNER },
  ] },
]);
check('roll-up: a scanner sweeping every link cannot top the chart',
  [swept.links.map(l => [l.label, l.clicks]), swept.totalClicks],
  [[['example.com/savings', 1]], 1]);
check('row: a scanner click is left out of the per-row links',
  linksForRow({ clickCount: 2, clicks: [
    { url: 'https://example.com/savings', ua: UA },
    { url: 'https://example.com/legal', ua: SCANNER },
  ] }).map(l => l.label), ['example.com/savings']);

// ---- scheduling links ----------------------------------------------------
//
// The booking link is the one destination that means something on its own, so
// it has to be recognised by provider rather than by the opaque segment the
// provider puts at the end of the URL. The trap worth testing is the opposite
// direction: outlook.office.com serves ordinary mail links too, and a tracking
// parameter that happens to say "calendly" must not promote a link into the
// one place on the page that claims intent.

check('scheduling: an Outlook Bookings link is a booking page',
  isSchedulingLink('https://outlook.office.com/bookwithme/user/abc123@se.com/meetingtype/XYZ?anonymous'), true);
check('scheduling: Calendly is a booking page', isSchedulingLink('https://calendly.com/dan/30min'), true);
check('scheduling: HubSpot meetings is a booking page',
  isSchedulingLink('https://meetings.hubspot.com/dan-baldauf'), true);
check('scheduling: an ordinary Outlook link is not',
  isSchedulingLink('https://outlook.office.com/mail/deeplink/compose'), false);
check('scheduling: a tracking parameter cannot promote a link',
  isSchedulingLink('https://example.com/report?utm_source=calendly.com'), false);
check('scheduling: nothing in, false out', isSchedulingLink(''), false);

check('scheduling: a booking link is labelled by what it is, not its URL tail',
  linkLabel('https://outlook.office.com/bookwithme/user/abc123@se.com/meetingtype/SVRwCe7HMUGxuT6WGxi68g2'),
  'Booking page');
check('scheduling: every other link keeps its ordinary label',
  linkLabel('https://example.com/reports/indicative-savings'), 'example.com/indicative savings');

// The booking subtotal is counted apart from the rest, because "two people
// opened your calendar" is the sentence worth reading — and a click on it is
// still not a booking, which is why it is reported as its own number rather
// than folded into a success rate.
const booking = clicksByLink([
  { to: 'a@example.com', clickCount: 2, clicks: [
    { url: 'https://calendly.com/dan/30min', ua: UA },
    { url: 'https://example.com/savings', ua: UA },
  ] },
  { to: 'b@example.com', clickCount: 1, clicks: [{ url: 'https://calendly.com/dan/30min', ua: UA }] },
]);
check('scheduling: booking clicks and the people behind them are subtotalled',
  [booking.schedulingClicks, booking.schedulingRecipients], [2, 2]);
check('scheduling: a set with no booking link subtotals to zero',
  [clicksByLink([{ to: 'a@example.com', clickCount: 1, clicks: [{ url: 'https://example.com/x', ua: UA }] }]).schedulingClicks], [0]);
check('scheduling: the per-row list flags which link was the booking page',
  linksForRow({ clickCount: 1, clicks: [{ url: 'https://calendly.com/dan/30min', ua: UA }] })
    .map(l => [l.label, l.scheduling]),
  [['Booking page', true]]);

// The caller owns the click summary, because only the caller knows the send
// time the pre-send gate needs. A passed summary must win over a recomputed
// one, or the breakdown would quietly disagree with the tiles above it.
check('roll-up: a caller-supplied summary is used instead of recounting',
  clicksByLink([{
    row: { to: 'a@example.com', clickCount: 9, clicks: [{ url: 'https://example.com/x', ua: UA }] },
    summary: { count: 1, events: [{ event: { url: 'https://example.com/gated', ua: UA }, verdict: 'counted' }] },
  }]).links.map(l => [l.label, l.clicks]),
  [['example.com/gated', 1]]);

console.log(failures === 0 ? '\nAll email-link tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

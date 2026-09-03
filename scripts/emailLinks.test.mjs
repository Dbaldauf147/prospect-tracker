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
import { shortLinkLabel, linksForRow, clicksByLink } from '../src/utils/emailLinks.js';

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

const row = {
  to: 'dana@example.com',
  clickCount: 4,
  clicks: [
    { url: 'https://example.com/savings' },
    { url: 'https://example.com/book' },
    { url: 'https://example.com/savings' },
    { url: 'https://example.com/savings' },
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
  { to: 'priya@example.com', clickCount: 1, clicks: [{ url: 'https://example.com/book' }] },
  { to: 'marcus@example.com', clickCount: 1, clicks: [{ url: 'https://example.com/book' }] },
];
const agg = clicksByLink(rows);

// /savings has more raw clicks (3 vs 3) but they are all one person, and the
// tie breaks on recipients — which is the ranking that matters.
check('roll-up: ties break on distinct recipients, not raw clicks',
  agg.links.map(l => [l.label, l.clicks, l.recipients]),
  [['example.com/book', 3, 3], ['example.com/savings', 3, 1]]);
check('roll-up: total clicks come off the exact counters', agg.totalClicks, 6);
check('roll-up: everything attributed when no doc hit the event cap', agg.unattributed, 0);

// A doc whose counter ran past its stored events — the cap in tracking.js.
const capped = clicksByLink([
  { to: 'a@example.com', clickCount: 120, clicks: [{ url: 'https://example.com/savings' }] },
]);
check('roll-up: clicks past the stored event cap are reported, not dropped',
  [capped.totalClicks, capped.links[0].clicks, capped.unattributed], [120, 1, 119]);

check('roll-up: an empty set is empty, not an error',
  clicksByLink([]), { links: [], totalClicks: 0, unattributed: 0 });
check('roll-up: no argument behaves the same',
  clicksByLink(), { links: [], totalClicks: 0, unattributed: 0 });
// A click event with no url (shouldn't happen — the redirector only logs a
// resolved destination — but a malformed doc must not invent a blank link).
check('roll-up: an event with no url is skipped',
  clicksByLink([{ to: 'a@example.com', clickCount: 1, clicks: [{ url: '' }] }]).links, []);

console.log(failures === 0 ? '\nAll email-link tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

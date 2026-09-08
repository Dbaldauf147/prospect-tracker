// Assertion tests for the Email Campaign CSV export.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/campaignExport.test.mjs
//
// What's worth pinning: the escaping (a subject line with a comma or a quote
// in it is normal, and one bad cell shifts every column after it), the status
// ladder the file shares with the table, the difference between "not tracked"
// and "tracked, never opened", and that the summary figures are the ones the
// Saved Campaigns table prints.
import {
  csvCell, toCsv, csvDate, csvDateTime, contactStatusLabel, eventStatusLabel,
  campaignContactRow, campaignContactsCsv, CAMPAIGN_CONTACT_HEADERS,
  campaignSummaryRow, campaignsSummaryCsv, csvFilename,
} from '../src/utils/campaignExport.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

// --- cells ------------------------------------------------------------
check('plain cell', csvCell('hello'), 'hello');
check('empty for null', csvCell(null), '');
check('empty for undefined', csvCell(undefined), '');
check('zero is not blank', csvCell(0), '0');
check('comma quotes', csvCell('Q4, revisited'), '"Q4, revisited"');
check('quote doubles', csvCell('He said "no"'), '"He said ""no"""');
check('newline quotes', csvCell('two\nlines'), '"two\nlines"');

check('rows join with CRLF', toCsv(['A', 'B'], [['1', '2'], ['3', '4']]), 'A,B\r\n1,2\r\n3,4');
check('headers only', toCsv(['A'], []), 'A');

// --- dates ------------------------------------------------------------
check('iso date', csvDate('2026-09-08T17:30:00Z'), '2026-09-08');
check('no date is blank', csvDate(''), '');
check('unparseable is blank', csvDate('not a date'), '');
check('iso date-time', csvDateTime(Date.parse('2026-09-08T17:30:00Z')), '2026-09-08 17:30 UTC');
check('no time is blank', csvDateTime(0), '');

// --- the status ladder ------------------------------------------------
// A reply outranks everything; a bounce outranks an auto-responder because a
// bounce means nothing arrived at all.
check('replied wins', contactStatusLabel({ replied: true, bounced: true, sentDate: 'x' }), 'Replied');
check('bounced over ooo', contactStatusLabel({ bounced: true, outOfOffice: true, sentDate: 'x' }), 'Bounced');
check('out of office', contactStatusLabel({ outOfOffice: true, sentDate: 'x' }), 'Out of Office');
check('sent, silent', contactStatusLabel({ sentDate: '2026-09-01' }), 'No Reply');
check('never sent', contactStatusLabel({}), 'Not Sent');
check('nothing at all', contactStatusLabel(null), 'Not Sent');

check('rsvp going', eventStatusLabel('going'), 'Going');
check('rsvp not going', eventStatusLabel('not-going'), 'Not going');
check('rsvp maybe', eventStatusLabel('maybe'), 'Maybe');
check('no rsvp', eventStatusLabel(''), '');

// --- one contact's row ------------------------------------------------
const campaign = { title: 'September market update', subject: 'Power prices, September', contacts: [] };

check('a replied contact', campaignContactRow({
  email: 'sam@acme.com',
  name: 'Sam Reed',
  company: 'Acme',
  recipientCount: 1,
  sentDate: '2026-09-01T14:00:00Z',
  replied: true,
  replyDate: '2026-09-02T09:12:00Z',
  repliedBy: 'Sam Reed',
  eventStatus: 'going',
}, {
  campaign,
  delivery: 'Confirmed',
  tracking: { openCount: 3, clickCount: 1, firstOpenAt: Date.parse('2026-09-01T14:05:00Z'), lastClickAt: Date.parse('2026-09-01T14:06:00Z') },
}), [
  'September market update', 'Power prices, September', 'sam@acme.com', 'Sam Reed', 'Acme', 1,
  '2026-09-01', 'Confirmed', 'Replied',
  3, 1, '2026-09-01 14:05 UTC', '2026-09-01 14:06 UTC',
  'Sam Reed', '2026-09-02', '', '', 'Going',
]);

// An untracked send leaves the four tracking cells empty. A 0 there would read
// as "watched and never opened", which is a different — and wrong — claim.
check('untracked leaves tracking blank', campaignContactRow(
  { email: 'lee@acme.com', sentDate: '2026-09-01T14:00:00Z' },
  { campaign, delivery: 'Delivered', tracking: null },
).slice(9, 13), ['', '', '', '']);

// Tracked but never opened really is zero.
check('tracked, never opened', campaignContactRow(
  { email: 'lee@acme.com', sentDate: '2026-09-01T14:00:00Z' },
  { campaign, delivery: 'Delivered', tracking: { openCount: 0, clickCount: 0, firstOpenAt: 0, lastClickAt: 0 } },
).slice(9, 13), [0, 0, '', '']);

// A click the counter threw out (a security gateway following the link) leaves
// no click time: the hook's lastClickAt is the raw one, and a timestamp beside
// a count of zero reads as a contradiction with no tooltip to explain it.
check('a scanned-only click has no time', campaignContactRow(
  { email: 'lee@acme.com', sentDate: '2026-09-01' },
  { campaign, tracking: { openCount: 0, clickCount: 0, firstOpenAt: 0, lastClickAt: Date.parse('2026-09-01T15:05:00Z') } },
).slice(9, 13), [0, 0, '', '']);

// A roster member nobody has emailed yet: no send date, no reply date, and
// the recipient count defaults to one.
check('an unsent roster member', campaignContactRow({ email: 'new@acme.com' }, { campaign }), [
  'September market update', 'Power prices, September', 'new@acme.com', '', '', 1,
  '', '', 'Not Sent', '', '', '', '', '', '', '', '', '',
]);

// A bounce and an out-of-office each carry their own date.
check('bounce date', campaignContactRow(
  { email: 'gone@acme.com', sentDate: '2026-09-01', bounced: true, bounceDate: '2026-09-01T14:01:00Z' },
  { campaign },
).slice(15, 17), ['2026-09-01', '']);
check('ooo date', campaignContactRow(
  { email: 'away@acme.com', sentDate: '2026-09-01', outOfOffice: true, oooDate: '2026-09-03T08:00:00Z' },
  { campaign },
).slice(15, 17), ['', '2026-09-03']);

// --- the whole file ---------------------------------------------------
const file = campaignContactsCsv(
  { title: 'Q4, revisited', subject: 'Say "hello"' },
  [{ email: 'a@x.com', sentDate: '2026-09-01' }, { email: 'b@x.com' }],
  { deliveryFor: () => 'Delivered', trackingFor: () => null },
);
const lines = file.split('\r\n');
check('header row', lines[0], CAMPAIGN_CONTACT_HEADERS.join(','));
check('one line per contact', lines.length, 3);
// The comma in the title and the quotes in the subject must not shift the
// columns that follow them.
check('escaped campaign + subject', lines[1].startsWith('"Q4, revisited","Say ""hello""",a@x.com,'), true);
check('order is the order given', lines[2].startsWith('"Q4, revisited","Say ""hello""",b@x.com,'), true);
check('no contacts is just a header', campaignContactsCsv(campaign, []), CAMPAIGN_CONTACT_HEADERS.join(','));
check('null contacts is just a header', campaignContactsCsv(campaign, null), CAMPAIGN_CONTACT_HEADERS.join(','));

// A campaign matching on several subject lines exports all of them in the
// one Subjects cell, so a row can be traced back to the campaign that claims
// it — one line still reads exactly as it always did.
check('one subject line', campaignContactRow({ email: 'a@x.com' }, { campaign })[1], 'Power prices, September');
check('several subject lines', campaignContactRow({ email: 'a@x.com' }, {
  campaign: { title: 'September market update', subjects: ['Power prices, September', 'September: ERCOT'] },
})[1], 'Power prices, September | September: ERCOT');
// The export goes out with every column whether or not the table is showing
// it — this is the data, not a screenshot.
check('every column ships', CAMPAIGN_CONTACT_HEADERS.length, campaignContactRow({}, { campaign }).length);

// --- the saved-campaign summary --------------------------------------
const NOW = Date.parse('2026-09-08T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

check('the summary carries every subject line too', campaignSummaryRow({
  title: 'September market update',
  subjects: ['Power prices, September', 'September: ERCOT'],
  uniqueRecipients: 1, totalContacts: 2,
}, NOW)[1], 'Power prices, September | September: ERCOT');

check('a half-sent campaign', campaignSummaryRow({
  title: 'September market update',
  subject: 'Power prices, September',
  uniqueRecipients: 13,
  totalContacts: 33,
  uniqueRepliers: 4,
  responseRate: 30.8,
  savedAt: daysAgo(10),
  refreshedAt: daysAgo(1),
}, NOW), [
  'September market update', 'Power prices, September', 33, 13, 39.4, 20,
  4, 30.8, 'Active', '2026-08-29', '2026-09-07',
]);

// Sixty days without a save or a refresh reads Inactive, and a manual
// override beats the clock either way — the same rule the table greys out on.
check('stale is inactive', campaignSummaryRow({ savedAt: daysAgo(90) }, NOW)[8], 'Inactive');
check('manual active wins', campaignSummaryRow({ savedAt: daysAgo(90), manualActive: true }, NOW)[8], 'Active');
check('manual inactive wins', campaignSummaryRow({ savedAt: daysAgo(1), manualActive: false }, NOW)[8], 'Inactive');
check('untitled campaign', campaignSummaryRow({ subject: '' }, NOW)[0], '(untitled campaign)');
check('title falls back to subject', campaignSummaryRow({ subject: 'Just a subject' }, NOW)[0], 'Just a subject');

const summary = campaignsSummaryCsv([
  { title: 'One', subject: 's1', uniqueRecipients: 1, totalContacts: 2, savedAt: daysAgo(1) },
  null,
  { title: 'Two', subject: 's2', uniqueRecipients: 2, totalContacts: 2, savedAt: daysAgo(2) },
], NOW).split('\r\n');
check('junk rows are dropped', summary.length, 3);
check('summary keeps the saved order', [summary[1].split(',')[0], summary[2].split(',')[0]], ['One', 'Two']);
check('no campaigns is just a header', campaignsSummaryCsv([], NOW).split('\r\n').length, 1);
check('not an array is just a header', campaignsSummaryCsv(undefined, NOW).split('\r\n').length, 1);

// --- filenames --------------------------------------------------------
const DAY = new Date('2026-09-08T17:00:00Z');
check('stamped filename', csvFilename('Email campaign - September update', DAY), 'Email campaign - September update 2026-09-08.csv');
check('path characters go', csvFilename('Q4: pricing / renewals?', DAY), 'Q4- pricing - renewals- 2026-09-08.csv');
check('no name still works', csvFilename('', DAY), 'export 2026-09-08.csv');
check('long names are trimmed', csvFilename('x'.repeat(200), DAY).length, 80 + ' 2026-09-08.csv'.length);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

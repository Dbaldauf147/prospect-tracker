// Assertion tests for the "Not Sold last week" email.
// Plain Node, no test framework (the project has none). Run:
//   node scripts/notSoldWeeklyEmail.test.mjs
//
// What it must get right: only Not Sold opps with a BFO Opportunity Name,
// and a window of the seven whole days before the send day, so a weekly
// send neither repeats a deal nor skips one.
import {
  notSoldLastWeek, notSoldWeekWindow, notSoldWeekLabel, buildNotSoldWeeklyEmailHtml,
  NOT_SOLD_WEEKLY_COLUMNS,
} from '../src/utils/notSoldWeeklyEmail.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

// Monday 23 Nov 2026, 9am local: the send a weekly schedule makes.
const now = new Date(2026, 10, 23, 9, 0, 0).getTime();
const opp = (account, stage, close, extra = {}) => ({ Account: account, Stage: stage, 'Close Date': close, 'BFO Link': `${account} opp`, ...extra });

const records = [
  opp('Today Co', 'Not Sold', '2026-11-23'),
  opp('Sunday Co', 'Not Sold', '2026-11-22'),
  opp('Monday Co', 'Not Sold', '2026-11-16'),
  opp('Older Co', 'Not Sold', '2026-11-15'),
  opp('Won Co', 'Sold', '2026-11-18'),
  opp('Open Co', 'Quoting', '2026-11-18'),
  opp('Future Co', 'Not Sold', '2026-12-01'),
  opp('Undated Co', 'Not Sold', ''),
  opp('Unnamed Co', 'Not Sold', '2026-11-18', { 'BFO Link': '-' }),
  opp('Beta Co', 'Not Sold', '2026-11-18'),
  opp('Alpha Co', 'Not Sold', '11/18/2026'),
  null,
];
const rows = notSoldLastWeek(records, { nowMs: now });
check('the seven days before today, newest first, then A to Z', rows.map(r => r.Account), ['Sunday Co', 'Alpha Co', 'Beta Co', 'Monday Co']);
check('days ago', rows.map(r => r._daysAgo), [1, 5, 5, 7]);
check('no records', notSoldLastWeek(null, { nowMs: now }), []);

// Back to back weekly sends: every day belongs to exactly one of them.
const nextWeek = notSoldLastWeek(records, { nowMs: now + 7 * 86400000 }).map(r => r.Account);
check('next week picks up today and nothing from this week', nextWeek, ['Today Co']);

const win = notSoldWeekWindow(now);
check('window start', new Date(win.start).toDateString(), 'Mon Nov 16 2026');
check('window end', new Date(win.end).toDateString(), 'Sun Nov 22 2026');
check('window label', notSoldWeekLabel(now), 'Nov 16, 2026 – Nov 22, 2026');

check('columns', NOT_SOLD_WEEKLY_COLUMNS.map(c => c.label),
  ['Account', 'Scope', 'Source', 'Deal Size', 'Close Date', 'Reason Not Sold', 'Competition', 'Loss Notes', 'BFO Link']);

const html = buildNotSoldWeeklyEmailHtml([
  { ...rows[0], Scope: 'Bill pay <all sites>', 'Quoted Amount': '$120,000', 'Reason Not Sold': 'Price', Competition: 'Engie', 'Loss Notes': 'Went with incumbent', 'BFO Address': 'https://example.test/opp/1' },
  rows[1],
], { message: 'Team, last week\'s losses.', nowMs: now });
const has = (label, needle, want = true) => check(label, html.includes(needle), want);
has('intro', 'Team, last week\'s losses.');
has('the days covered', 'Nov 16, 2026 – Nov 22, 2026');
has('the count', '2 opps marked Not Sold');
has('close date reads as a day', 'Nov 22, 2026');
has('reason', '>Price<');
has('competition', '>Engie<');
has('loss notes', 'Went with incumbent');
has('scope is escaped', 'Bill pay &lt;all sites&gt;');
has('BFO link', '<a href="https://example.test/opp/1"');
has('no em dash', '—', false);

const empty = buildNotSoldWeeklyEmailHtml([], { nowMs: now });
check('empty week says so', empty.includes('No opportunities were marked Not Sold last week.'), true);
check('empty week has no count', empty.includes('marked Not Sold</p>'), false);
check('one opp is singular', buildNotSoldWeeklyEmailHtml([rows[0]], { nowMs: now }).includes('1 opp marked Not Sold'), true);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

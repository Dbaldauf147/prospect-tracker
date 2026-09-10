// Assertion tests for the opps list on the company popup. Plain Node — no
// test framework (the project has none). Run:
//   node scripts/companyOppList.test.mjs
//
// The list is read-only, which makes it look like there is nothing to get
// wrong. Three things are:
//
//   1. The ORDER. The list is collapsed by default, so whoever opens it is
//      asking "what is in play with these people". A live deal at Agreement
//      Sent has to lead, and a deal that closed two years ago has to be at
//      the bottom — a list ordered by whatever the cache happened to hold
//      answers a different question, or none.
//   2. What a blank looks like. These rows come out of a spreadsheet export,
//      where "nothing here" arrives as a dash as often as an empty cell, and
//      a stage cell can be a broken formula. A row whose stage is unreadable
//      is NOT a closed deal, and must not be filed with them where nobody
//      will look at it again.
//   3. What the collapsed header claims. It is the only thing shown until
//      somebody opens the section, so "3 open · 2 closed" has to be true of
//      what is inside it.

import { companyOppRows, summarizeCompanyOpps } from '../src/utils/companyOppList.js';

let failures = 0;
function eq(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`PASS  ${label}`); return; }
  failures += 1;
  console.log(`FAIL  ${label}\n      expected ${e}\n      got      ${a}`);
}

// The Opps 2 keys this reads, spelled as that tab stores them: 'BFO Link'
// holds the opportunity NAME, and 'Quoted Amount' is its Deal Size.
const opp = (name, stage, extra = {}) => ({
  _id: name,
  Account: 'Prologis',
  'BFO Link': name,
  Stage: stage,
  ...extra,
});
const names = rows => rows.map(r => r.name);

// --- the order the list comes in ------------------------------------------

eq('live opps lead, furthest along first',
  names(companyOppRows([
    opp('lead', 'Lead'),
    opp('agreement', 'Agreement Sent'),
    opp('quoting', 'Quoting'),
  ])),
  ['agreement', 'quoting', 'lead']);

eq('a closed opp sits below every live one, however recent',
  names(companyOppRows([
    opp('sold last week', 'Sold', { 'Close Date': '2026-09-01' }),
    opp('lead', 'Lead', { 'Start Date': '2024-01-01' }),
  ])),
  ['lead', 'sold last week']);

// Two deals at the same stage: the one opened more recently is the one being
// worked, so it leads.
eq('at the same stage, the newer opp leads',
  names(companyOppRows([
    opp('older', 'Quoted', { 'Start Date': '2025-02-01' }),
    opp('newer', 'Quoted', { 'Start Date': '2026-02-01' }),
  ])),
  ['newer', 'older']);

eq('closed opps read newest first',
  names(companyOppRows([
    opp('lost in 2024', 'Not Sold', { 'Close Date': '2024-06-01' }),
    opp('won in 2026', 'Sold', { 'Close Date': '2026-06-01' }),
  ])),
  ['won in 2026', 'lost in 2024']);

// A closed opp nobody dated still has a start date, which beats sorting it
// to the bottom as if it were from 1970.
eq('a closed opp with no close date falls back to when it started',
  names(companyOppRows([
    opp('closed 2025', 'Sold', { 'Close Date': '2025-01-01' }),
    opp('undated, started 2026', 'Sold', { 'Start Date': '2026-01-01' }),
  ])),
  ['undated, started 2026', 'closed 2025']);

// --- what a blank looks like ----------------------------------------------

// A row whose Stage cell is a broken export is not a closed deal. Filing it
// with the closed ones is how an opp nobody has looked at since the import
// stays that way.
eq('a broken stage cell is not treated as closed',
  companyOppRows([opp('broken', '#N/A')]).map(r => [r.active, r.stage]),
  [[true, '#N/A']]);
eq('nor is a blank one',
  companyOppRows([opp('blank', '')]).map(r => r.active), [true]);

// "-" is how a blank arrives from the export, and the Opps tab already reads
// it as nothing rather than as a value.
eq('a dash reads as an empty cell',
  companyOppRows([{ 'BFO Link': '-', Stage: 'Lead', Scope: 'Bill payment', 'Quoted Amount': '-' }])
    .map(r => [r.name, r.scope, r.amount]),
  [['', 'Bill payment', '']]);

eq('junk rows are dropped rather than rendered blank',
  companyOppRows([null, 'nope', opp('real', 'Lead')]).map(r => r.name), ['real']);
eq('nothing at all is an empty list', companyOppRows(undefined), []);

// The row key: opps are re-read from the cache on every open, and two opps
// on one account with the same stage are common (a re-quote, a second site).
eq('rows are keyed by the opp id when there is one',
  companyOppRows([opp('a', 'Lead')]).map(r => r.id), ['a']);
eq('and by position when there is not',
  companyOppRows([{ Stage: 'Lead' }, { Stage: 'Lead' }]).map(r => r.id), ['opp-0', 'opp-1']);

// --- what the collapsed header claims -------------------------------------

eq('the header counts live and closed apart',
  summarizeCompanyOpps(companyOppRows([
    opp('a', 'Quoting'),
    opp('b', 'Agreement Sent'),
    opp('c', 'Sold'),
    opp('d', 'Not Sold'),
  ])),
  { total: 4, open: 2, closed: 2 });
eq('a company with nothing has nothing to claim',
  summarizeCompanyOpps([]), { total: 0, open: 0, closed: 0 });
// An unreadable stage is counted with the live ones, because that is where
// the list puts it — the header cannot say something the list contradicts.
eq('a broken stage is counted where it is shown',
  summarizeCompanyOpps(companyOppRows([opp('broken', '#REF!'), opp('sold', 'Sold')])),
  { total: 2, open: 1, closed: 1 });

console.log(failures === 0 ? '\nAll company opps list tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

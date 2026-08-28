// Assertion tests for the Not Sold Analysis roll-ups. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/notSoldAnalysis.test.mjs
//
// Two tables on that tab read the same set of lost opps two ways, so the
// thing worth pinning hardest is that they agree: the per-reason losses and
// the per-source losses both add up to the same total, and both take their
// percentages against it.
//
// The other rules here are about what happens to a loss the report can't
// place. A loss with no reason recorded is its own bucket rather than
// missing from the table, and a loss with no Close Date is counted while the
// report is unbounded but declared excluded once a date range is set — the
// one case where dropping it is right, and the one case where saying so
// matters.
import { notSoldBreakdown, reasonOf, sourceOf, NO_REASON } from '../src/utils/notSoldAnalysis.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}

const RECORDS = [
  { _id: 1, Stage: 'Not Sold', Source: 'Referral',  'Reason Not Sold': 'Price',  'Quoted Amount': '$50,000', 'Close Date': '2026-03-04' },
  { _id: 2, Stage: 'Not Sold', Source: 'Referral',  'Reason Not Sold': 'Price',  'Quoted Amount': '$20,000', 'Close Date': '2026-03-09' },
  { _id: 3, Stage: 'Not Sold', Source: 'Cold Call', 'Reason Not Sold': 'Timing', 'Close Date': '2026-05-01' },
  { _id: 4, Stage: 'Sold',     Source: 'Referral',  'Quoted Amount': '$90,000',  'Close Date': '2026-03-20' },
  { _id: 5, Stage: 'Not Sold', Source: 'Referral',  'Reason Not Sold': '-',      'Close Date': '' },
  { _id: 6, Stage: 'Qualifying', Source: 'Referral' },
];

// --- the two tables are the same losses, filed two ways -------------------
{
  const d = notSoldBreakdown(RECORDS);
  check('open stages are not losses', d.lossCount, 4);
  check('reasons add up to the losses', d.reasons.reduce((n, r) => n + r.count, 0), d.lossCount);
  check('sources add up to the same losses', d.sources.reduce((n, r) => n + r.losses, 0), d.lossCount);
  check('and so do the percentages',
    [Math.round(d.reasons.reduce((n, r) => n + r.percent, 0)),
     Math.round(d.sources.reduce((n, r) => n + r.percent, 0))], [100, 100]);
  check('reasons rank by frequency', d.reasons.map(r => r.reason),
    ['Price', NO_REASON, 'Timing']);
  check('sources rank by losses', d.sources.map(r => [r.source, r.losses]),
    [['Referral', 3], ['Cold Call', 1]]);
}

// --- what a loss was worth ------------------------------------------------
{
  const d = notSoldBreakdown(RECORDS);
  check('only quoted losses carry value', [d.lostValue, d.quotedLosses], [70000, 2]);
  check('a reason with nothing quoted is $0, not missing',
    d.reasons.find(r => r.reason === 'Timing').lost, 0);
  check('the won side of the window is counted too', d.winCount, 1);
}

// --- nothing recorded is still a loss -------------------------------------
{
  check('a placeholder reason reads as no reason', reasonOf({ 'Reason Not Sold': '-' }), NO_REASON);
  check('a blank reason reads as no reason', reasonOf({}), NO_REASON);
  check('a placeholder source reads as unspecified', sourceOf({ Source: '#N/A' }), '(Unspecified)');
  const d = notSoldBreakdown(RECORDS);
  check('the no-reason bucket is in the table', d.reasons.find(r => r.reason === NO_REASON).count, 1);
}

// --- a Close Date range -------------------------------------------------
{
  const q1 = notSoldBreakdown(RECORDS, { from: '2026-03-01', to: '2026-03-31' });
  check('losses are those closed in the window', q1.rows.map(r => r._id), [2, 1]);
  check('a loss with no Close Date is excluded, and said so', [q1.lossCount, q1.undated], [2, 1]);
  check('the wins in the window narrow with it', q1.winCount, 1);
  check('loss rate is losses over decided, in-window',
    q1.sources.map(s => [s.source, s.losses, s.wins, Math.round(s.lossRate)]),
    [['Referral', 2, 1, 67]]);

  const may = notSoldBreakdown(RECORDS, { from: '2026-05-01' });
  check('an open-ended range still bounds one side', may.rows.map(r => r._id), [3]);
  check('a source that lost nothing in range is not listed', may.sources.map(s => s.source), ['Cold Call']);
}

// --- unbounded keeps the undated loss -------------------------------------
{
  const d = notSoldBreakdown(RECORDS);
  check('with no range, a loss with no Close Date still counts',
    [d.rows.map(r => r._id).includes(5), d.undated], [true, 0]);
  check('losses sort newest close first, undated last', d.rows.map(r => r._id), [3, 2, 1, 5]);
}

// --- nothing to report ----------------------------------------------------
{
  const empty = notSoldBreakdown([]);
  check('an empty set reports zeroes, not NaN',
    [empty.lossCount, empty.lostValue, empty.reasons.length, empty.sources.length], [0, 0, 0, 0]);
}

console.log(failures ? `${failures} failed.` : 'All passed.');
process.exit(failures ? 1 : 0);

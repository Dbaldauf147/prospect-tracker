// Assertion tests for the Not Sold Analysis trend roll-up. Plain Node. Run:
//   node scripts/notSoldTrend.test.mjs
//
// What matters most: every dated loss lands in exactly one period (so the
// series add up to the total), empty periods in the middle show as zeros,
// and the Source / Reason filters narrow the right things - a reason filter
// can't drop wins, which carry no reason.
import {
  notSoldTrend, notSoldFacets, periodLabel, closePeriodOf, TREND_OTHER, NO_REASON,
} from '../src/utils/notSoldAnalysis.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}

const R = [
  { Stage: 'Not Sold', Source: 'Referral',  'Reason Not Sold': 'Price',  'Close Date': '2025-01-01' },
  { Stage: 'Not Sold', Source: 'Referral',  'Reason Not Sold': 'Price',  'Close Date': '2025-02-10' },
  { Stage: 'Not Sold', Source: 'Cold Call', 'Reason Not Sold': 'Timing', 'Close Date': '2025-08-01' },
  { Stage: 'Not Sold', Source: 'Cold Call', 'Reason Not Sold': 'Price',  'Close Date': '2026-01-15' },
  { Stage: 'Not Sold', Source: 'Cold Call', 'Reason Not Sold': '',       'Close Date': '3/2/2026' },
  { Stage: 'Not Sold', Source: 'Referral',  'Reason Not Sold': 'Price',  'Close Date': '' },
  { Stage: 'Sold',     Source: 'Referral',  'Close Date': '2025-01-20' },
  { Stage: 'Sold',     Source: 'Cold Call', 'Close Date': '2026-02-01' },
  { Stage: 'Qualifying', Source: 'Referral', 'Close Date': '2025-01-05' },
];

{
  const t = notSoldTrend(R, { period: 'quarter' });
  check('quarters run first to last with gaps filled', t.periods,
    ['2025-Q1', '2025-Q2', '2025-Q3', '2025-Q4', '2026-Q1']);
  check('undated losses sit out and are counted', [t.lossCount, t.undated], [5, 1]);
  check('series add up to the dated losses', t.series.reduce((n, s) => n + s.total, 0), t.lossCount);
  check('Jan 1 stays in Q1 of its own year', t.series.find(s => s.key === 'Price').counts['2025-Q1'], 2);
  check('series rank commonest first', t.series.map(s => s.key), ['Price', NO_REASON, 'Timing']);
  check('loss rate per period', t.totals['2025-Q1'], { losses: 2, wins: 1, lossRate: (2 / 3) * 100 });
  check('an empty period has no rate', t.totals['2025-Q2'].lossRate, null);
}

{
  const t = notSoldTrend(R, { period: 'year', groupBy: 'source' });
  check('by source, by year', t.series.map(s => [s.key, s.counts]),
    [['Cold Call', { 2025: 1, 2026: 2 }], ['Referral', { 2025: 2 }]]);
}

{
  const t = notSoldTrend(R, { period: 'year', sources: ['Referral'] });
  check('source filter narrows losses and wins', [t.lossCount, t.totals['2025']],
    [2, { losses: 2, wins: 1, lossRate: (2 / 3) * 100 }]);
  const r = notSoldTrend(R, { period: 'year', reasons: ['Price'] });
  check('reason filter keeps the wins', [r.lossCount, r.totals['2026'].wins], [3, 1]);
}

{
  const t = notSoldTrend(R, { period: 'year', topN: 1 });
  check('the tail folds into Other', t.series.map(s => [s.key, s.total]), [['Price', 3], [TREND_OTHER, 2]]);
  check('and says what it folded', t.series[1].folded, [NO_REASON, 'Timing']);
}

{
  const t = notSoldTrend(R, { period: 'month', years: [2025] });
  check('months, windowed to a year', t.periods.length, 8);
  check('month labels', periodLabel('2025-08', 'month'), 'Aug 2025');
  check('quarter labels', periodLabel('2025-Q3', 'quarter'), 'Q3 2025');
  check('a loss knows its period', closePeriodOf(R[4], 'quarter'), '2026-Q1');
}

check('facets list every reason and source among losses', notSoldFacets(R),
  { reasons: [NO_REASON, 'Price', 'Timing'], sources: ['Cold Call', 'Referral'] });

if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log('\nall passing');

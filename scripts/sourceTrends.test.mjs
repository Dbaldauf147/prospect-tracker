// Assertion tests for Opps > By Source > Over time. Plain Node. Run:
//   node scripts/sourceTrends.test.mjs
import { sourceOf, sourceShareTrend } from '../src/utils/sourceTrends.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`}`);
}

check('source cleaned, blanks unspecified', [sourceOf({ Source: ' PE partner ' }), sourceOf({ Source: '#N/A' }), sourceOf({})], ['PE partner', '(Unspecified)', '(Unspecified)']);

const recs = [
  { Source: 'A', Stage: 'Sold', 'Start Date': '2025-01-10' },
  { Source: 'A', Stage: 'Lead', 'Start Date': '2025-02-10' },
  { Source: 'B', Stage: 'Not Sold', 'Start Date': '2025-03-01' },
  { Source: 'B', Stage: 'Lead', 'Start Date': '2025-09-01' },
  { Source: 'A', Stage: 'Lead' },
];

const q = sourceShareTrend(recs, { period: 'quarter' });
check('periods fill the gap', q.periods, ['2025-Q1', '2025-Q2', '2025-Q3']);
check('totals per period', q.totals, { '2025-Q1': 3, '2025-Q2': 0, '2025-Q3': 1 });
check('totals and undated', [q.total, q.undated], [4, 1]);
check('series order and counts', q.series.map(s => [s.key, s.count, s.share]), [['A', 2, 50], ['B', 2, 50]]);
check('A by quarter', q.series[0].byPeriod, {
  '2025-Q1': { count: 2, share: (2 / 3) * 100 },
  '2025-Q2': { count: 0, share: null },
  '2025-Q3': { count: 0, share: 0 },
});
check('each period sums to 100%', q.periods.filter(p => q.totals[p]).map(p => Math.round(q.series.reduce((a, s) => a + s.byPeriod[p].share, 0) * 1e6) / 1e6), [100, 100]);

const active = sourceShareTrend(recs, { period: 'year', activity: 'active' });
check('active drops Sold / Not Sold', [active.total, active.series.map(s => [s.key, s.count])], [2, [['A', 1], ['B', 1]]]);
const closed = sourceShareTrend(recs, { period: 'year', activity: 'closed' });
check('closed keeps only Sold / Not Sold', closed.total, 2);
const ranged = sourceShareTrend(recs, { period: 'month', from: '2025-02-01', to: '2025-03-31' });
check('date range inclusive', [ranged.periods, ranged.total], [['2025-02', '2025-03'], 2]);
check('empty', sourceShareTrend([], {}).periods, []);

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nAll passed');

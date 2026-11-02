// Assertion tests for Opps > By Service's trend subtabs. Plain Node. Run:
//   node scripts/serviceTrends.test.mjs
import { servicesOf, serviceShareTrend, serviceCloseRateTrend } from '../src/utils/serviceTrends.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`}`);
}

check('scope split, deduped, blanks unspecified', [servicesOf({ Scope: 'A, B, A' }), servicesOf({ Scope: '-' })], [['A', 'B'], ['(Unspecified)']]);

const recs = [
  { Scope: 'A, B', Stage: 'Sold', 'Start Date': '2025-01-10', 'Close Date': '2025-06-01' },
  { Scope: 'A', Stage: 'Not Sold', 'Start Date': '2025-02-10', 'Close Date': '2025-07-01' },
  { Scope: 'B', Stage: 'Lead', 'Start Date': '2025-08-10' },
  { Scope: 'A', Stage: 'Sold', 'Start Date': '2025-09-01', 'Close Date': '2026-01-05' },
  { Scope: 'C', Stage: 'Not Sold', 'Start Date': '2026-01-02' },
  { Scope: 'A', Stage: 'Quoted' },
];

const sh = serviceShareTrend(recs, { period: 'quarter' });
check('share: periods filled', sh.periods, ['2025-Q1', '2025-Q2', '2025-Q3', '2025-Q4', '2026-Q1']);
check('share: totals per period', Object.values(sh.totals), [2, 0, 2, 0, 1]);
check('share: undated counted', sh.undated, 1);
const A = sh.series.find(s => s.key === 'A');
check('share: A by period', sh.periods.map(p => A.byPeriod[p].share), [100, null, 50, null, 0]);
check('share: A overall', [A.count, A.share], [3, 60]);
const shHidden = serviceShareTrend(recs, { period: 'quarter', hidden: ['A'] });
check('share: hiding A keeps the totals', [shHidden.series.map(s => s.key), shHidden.totals['2025-Q1']], [['B', 'C'], 2]);

const cr = serviceCloseRateTrend(recs, { period: 'year' });
check('close: periods', cr.periods, ['2025', '2026']);
check('close: undated decided opp counted', cr.undated, 1);
const crA = cr.series.find(s => s.key === 'A');
check('close: A per year', [crA.byPeriod['2025'], crA.byPeriod['2026']], [{ wins: 1, decided: 2, rate: 50 }, { wins: 1, decided: 1, rate: 100 }]);
check('close: overall counts each opp once', [cr.overall['2025'].decided, cr.wins, cr.decided], [2, 2, 3]);
const crHidden = serviceCloseRateTrend(recs, { period: 'year', hidden: ['A'] });
check('close: hiding A drops A-only opps from overall', [crHidden.decided, crHidden.series.map(s => s.key)], [1, ['B']]);
check('close: Close Date window', serviceCloseRateTrend(recs, { from: '2025-06-15', to: '2025-12-31' }).decided, 1);

process.exit(failures ? 1 : 0);

// Assertion tests for Opps > By Service's trend subtabs. Plain Node. Run:
//   node scripts/serviceTrends.test.mjs
import { servicesOf, serviceShareTrend, serviceCloseRateTrend, serviceDealSizeTrend } from '../src/utils/serviceTrends.js';

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
check('share: tag totals per period', Object.values(sh.tagTotals), [3, 0, 2, 0, 1]);
check('share: A mix by period', sh.periods.map(p => A.byPeriod[p].mix), [(2 / 3) * 100, null, 50, null, 0]);
check('share: each period mix sums to 100', sh.periods.filter(p => sh.tagTotals[p]).map(p => Math.round(sh.series.reduce((a, s) => a + (s.byPeriod[p].mix || 0), 0))), [100, 100, 100]);
check('share: A whole-window mix', A.mix, 50);
const shHidden = serviceShareTrend(recs, { period: 'quarter', hidden: ['A'] });
check('share: hiding A keeps the totals', [shHidden.series.map(s => s.key), shHidden.totals['2025-Q1']], [['B', 'C'], 2]);
check('share: hiding A drops it from the mix', [shHidden.tagTotals['2025-Q1'], shHidden.series[0].byPeriod['2025-Q1'].mix], [1, 100]);

const cr = serviceCloseRateTrend(recs, { period: 'year' });
check('close: periods', cr.periods, ['2025', '2026']);
check('close: undated decided opp counted', cr.undated, 1);
const crA = cr.series.find(s => s.key === 'A');
check('close: A per year', [crA.byPeriod['2025'], crA.byPeriod['2026']], [{ wins: 1, decided: 2, rate: 50 }, { wins: 1, decided: 1, rate: 100 }]);
check('close: overall counts each opp once', [cr.overall['2025'].decided, cr.wins, cr.decided], [2, 2, 3]);
const crHidden = serviceCloseRateTrend(recs, { period: 'year', hidden: ['A'] });
check('close: hiding A drops A-only opps from overall', [crHidden.decided, crHidden.series.map(s => s.key)], [1, ['B']]);
check('close: Close Date window', serviceCloseRateTrend(recs, { from: '2025-06-15', to: '2025-12-31' }).decided, 1);

// Groups: A and B filed together count an opp once toward the group.
const G = [{ name: 'AB', services: ['A', 'B'] }];
const shG = serviceShareTrend(recs, { period: 'quarter', groups: G });
const AB = shG.series.find(s => s.key === 'AB');
check('group: series keys', shG.series.map(s => s.key), ['AB', 'C']);
check('group: opp with A and B counts once', [AB.count, AB.byPeriod['2025-Q1'].count, shG.tagTotals['2025-Q1']], [4, 2, 2]);
check('group: mix still sums to 100', Math.round(shG.series.reduce((a, s) => a + (s.byPeriod['2025-Q1'].mix || 0), 0)), 100);
check('group: hidden member left out of the group', serviceShareTrend(recs, { period: 'quarter', groups: G, hidden: ['A'] }).series.find(s => s.key === 'AB').count, 2);
check('group: hiding the group name drops it', serviceShareTrend(recs, { period: 'quarter', groups: G, hidden: ['AB'] }).series.map(s => s.key), ['C']);
const crG = serviceCloseRateTrend(recs, { period: 'year', groups: G });
check('group: close rate per group', crG.series.find(s => s.key === 'AB').byPeriod['2025'], { wins: 1, decided: 2, rate: 50 });
check('group: blank and empty groups ignored', serviceShareTrend(recs, { groups: [{ name: ' ', services: ['A'] }, { name: 'X', services: [] }] }).series.map(s => s.key), ['A', 'B', 'C']);

const dsRecs = [
  { Scope: 'A, B', Stage: 'Sold', 'Start Date': '2025-01-10', 'Quoted Amount': '$10,000' },
  { Scope: 'A', Stage: 'Not Sold', 'Start Date': '2025-02-10', 'Quoted Amount': 'USD 20,000.00' },
  { Scope: 'B', Stage: 'Lead', 'Start Date': '2025-08-10', 'Quoted Amount': '' },
  { Scope: 'A', Stage: 'Sold', 'Start Date': '2025-09-01', 'Quoted Amount': '6000' },
  { Scope: 'C', Stage: 'Lead', 'Quoted Amount': '5000' },
];
const ds = serviceDealSizeTrend(dsRecs, { period: 'quarter' });
check('deal size: periods', ds.periods, ['2025-Q1', '2025-Q2', '2025-Q3']);
check('deal size: unsized and undated counted', [ds.unsized, ds.undated], [1, 1]);
const dA = ds.series.find(s => s.key === 'A');
check('deal size: A by period', ds.periods.map(p => dA.byPeriod[p].avg), [15000, null, 6000]);
check('deal size: A whole window', [dA.sized, dA.avg], [3, 12000]);
check('deal size: B gets the shared opp\'s full amount', ds.series.find(s => s.key === 'B').avg, 10000);
check('deal size: overall counts each opp once', [ds.sized, ds.avg, ds.overall['2025-Q1'].avg], [3, 12000, 15000]);
const dsSold = serviceDealSizeTrend(dsRecs, { period: 'year', sold: true });
check('deal size: sold only', [dsSold.sized, dsSold.series.find(s => s.key === 'A').avg], [2, 8000]);
check('deal size: nothing sized', serviceDealSizeTrend([], {}).periods, []);

const dsSplit = serviceDealSizeTrend(dsRecs, { period: 'quarter', split: true });
const sA = dsSplit.series.find(s => s.key === 'A');
check('deal size split: shared opp halves', sA.byPeriod['2025-Q1'].opps.map(o => o.counted), [5000, 20000]);
check('deal size split: A average', [sA.byPeriod['2025-Q1'].avg, sA.avg], [12500, (5000 + 20000 + 6000) / 3]);
check('deal size split: B gets half', dsSplit.series.find(s => s.key === 'B').avg, 5000);
check('deal size split: overall still full amounts', dsSplit.avg, 12000);
const dsSplitG = serviceDealSizeTrend(dsRecs, { period: 'year', split: true, groups: [{ name: 'AB', services: ['A', 'B'] }] });
check('deal size split: a group gets both shares', dsSplitG.series.find(s => s.key === 'AB').opps.map(o => o.counted), [10000, 20000, 6000]);
const dsSplitH = serviceDealSizeTrend(dsRecs, { period: 'year', split: true, hidden: ['B'] });
check('deal size split: hiding B keeps A at half', dsSplitH.series.find(s => s.key === 'A').opps[0].counted, 5000);
check('deal size: cell lists its opps', ds.overall['2025-Q1'].opps.length, 2);

process.exit(failures ? 1 : 0);

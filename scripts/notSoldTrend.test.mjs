// Assertion tests for the Not Sold Analysis trend roll-up. Plain Node. Run:
//   node scripts/notSoldTrend.test.mjs
//
// What matters most: every dated loss lands in exactly one period (so the
// series add up to the total), empty periods in the middle show as zeros,
// and the Source / Reason filters narrow the right things - a reason filter
// can't drop wins, which carry no reason.
import {
  notSoldTrend, notSoldFacets, periodLabel, closePeriodOf, TREND_OTHER, NO_REASON,
  trendChartRows, saveTrendView, deleteTrendView, sanitizeTrendViews, trendViewMatches,
  normaliseTrendState, trendDetailRows, closeRateTrend, closeRateChartRows,
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
  check('close rate per period', t.totals['2025-Q1'], { losses: 2, wins: 1, closeRate: (1 / 3) * 100 });
  check('an empty period has no rate', t.totals['2025-Q2'].closeRate, null);
}

{
  const t = notSoldTrend(R, { period: 'year', groupBy: 'source' });
  check('by source, by year', t.series.map(s => [s.key, s.counts]),
    [['Cold Call', { 2025: 1, 2026: 2 }], ['Referral', { 2025: 2 }]]);
}

{
  const t = notSoldTrend(R, { period: 'year', sources: ['Referral'] });
  check('source filter narrows losses and wins', [t.lossCount, t.totals['2025']],
    [2, { losses: 2, wins: 1, closeRate: (1 / 3) * 100 }]);
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

// --- hiding reasons takes them out of everything ---------------------------
{
  const t = notSoldTrend(R, { period: 'year', hideReasons: ['Price'] });
  check('hidden reason drops out of the series', t.series.map(s => s.key), [NO_REASON, 'Timing']);
  check('and out of the totals and close rate', t.totals['2025'], { losses: 1, wins: 1, closeRate: 50 });
}

// --- chart export is what the bars show -----------------------------------
{
  const t = notSoldTrend(R, { period: 'year' });
  check('one row per period, series then totals', trendChartRows(t, { period: 'year', hiddenSeries: ['Timing'] }), [
    { Period: '2025', Price: 2, [NO_REASON]: 0, 'Total losses': 3, 'Won (Sold)': 1, 'Close rate %': 25 },
    { Period: '2026', Price: 1, [NO_REASON]: 1, 'Total losses': 2, 'Won (Sold)': 1, 'Close rate %': 33.3 },
  ]);
  check('percent mode exports shares', trendChartRows(t, { period: 'year', mode: 'percent' })[0].Price, 66.7);
}

// --- saved views -----------------------------------------------------------
{
  const a = { groupBy: 'source', period: 'year', hideReasons: ['Unknown', 'Price'] };
  let v = saveTrendView([], { name: ' No noise ', state: a, now: 1 });
  check('saves a named view', v.map(x => x.name), ['No noise']);
  v = saveTrendView(v, { name: 'no NOISE', state: { ...a, mode: 'percent' }, now: 2 });
  check('same name replaces rather than duplicates', [v.length, v[0].state.mode], [1, 'percent']);
  check('an empty name saves nothing', saveTrendView(v, { name: '  ', state: a }).length, 1);
  check('matching ignores list order', trendViewMatches(v[0], { ...a, mode: 'percent', hideReasons: ['Price', 'Unknown'] }), true);
  check('and notices a difference', trendViewMatches(v[0], a), false);
  check('delete removes it', deleteTrendView(v, v[0].id), []);
  check('junk in settings is dropped', sanitizeTrendViews([null, { id: 'x' }, 'y']), []);
  check('defaults fill gaps', normaliseTrendState({ period: 'decade' }).period, 'quarter');
}

// --- the details sheet lists exactly the opps the chart counts ------------
{
  const opts = { period: 'year', sources: ['Cold Call'], hideReasons: ['Timing'] };
  const rows = trendDetailRows(R, opts);
  const t = notSoldTrend(R, opts);
  check('details: every counted loss and win, nothing else',
    rows.map(r => [r.Stage, r.Period, r['Reason Not Sold']]),
    [['Not Sold', '2026', 'Price'], ['Not Sold', '2026', NO_REASON], ['Sold', '2026', '']]);
  check('details agree with the chart totals',
    [rows.filter(r => r.Stage === 'Not Sold').length, rows.filter(r => r.Stage === 'Sold').length],
    [t.lossCount, t.totals['2026'].wins]);
  const all = trendDetailRows(R, { period: 'year', topN: 1, hiddenSeries: ['Price'] });
  check('undated loss listed as not counted', all.filter(r => r.Counted === 'No, no Close Date').length, 1);
  check('folded losses say Other', all.filter(r => r['Chart Series'] === TREND_OTHER).length, 2);
  check('legend-hidden losses marked', all.filter(r => r.Counted === 'In totals, hidden on chart').length, 3);
}

// --- close rate by source over time ---------------------------------------
{
  const c = closeRateTrend(R, { period: 'year' });
  check('sources ranked by decided opps', c.series.map(s => [s.key, s.wins, s.decided]),
    [['Cold Call', 1, 4], ['Referral', 1, 3]]);
  check('per-period close rate', c.series[0].byPeriod, {
    2025: { wins: 0, decided: 1, rate: 0 }, 2026: { wins: 1, decided: 3, rate: (1 / 3) * 100 },
  });
  check('nothing decided is a gap, not 0%', closeRateTrend(R, { period: 'quarter' }).series[1].byPeriod['2025-Q2'].rate, null);
  check('overall across sources', [c.wins, c.decided, c.overall['2025']], [2, 7, { wins: 1, decided: 4, rate: 25 }]);
  check('undated decided opps are counted out', c.undated, 1);
  check('the reason filters never touch a close rate',
    closeRateTrend(R, { period: 'year', reasons: ['Price'], hideReasons: ['Timing'] }).decided, 7);
  check('source filter narrows it', closeRateTrend(R, { period: 'year', sources: ['Referral'] }).series.map(s => s.key), ['Referral']);
  const o = closeRateTrend(R, { period: 'year', topN: 1 });
  check('the rest fold into Other', o.series.map(s => [s.key, s.wins, s.decided]), [['Cold Call', 1, 4], [TREND_OTHER, 1, 3]]);
  check('chart export columns', Object.keys(closeRateChartRows(c, { period: 'year', hiddenSeries: ['Referral'] })[0]),
    ['Period', 'Cold Call close rate %', 'Cold Call won', 'Cold Call decided', 'Overall close rate %', 'Overall won', 'Overall decided']);
}

if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log('\nall passing');

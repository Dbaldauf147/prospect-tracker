// Close Rate deep dive: the by-stage trend and the Excel shaping.
import assert from 'node:assert/strict';
import {
  stageCloseRateTrend, trendSheetRows, trendTableRows, withoutPullThroughs, closedOppSheetRows, fmtRate, fittedRateAxis,
} from '../src/utils/closeRateDeepDive.js';
import { closeRateTrend } from '../src/utils/notSoldAnalysis.js';

const opp = (o) => ({ Account: 'A', Scope: 'Audits', Source: 'Referral', ...o });
const records = [
  // Q1 2026: reached Stage 5 (Quoted On), sold
  opp({ Stage: 'Sold', 'Close Date': '2026-01-15', 'Quoted On': '2026-01-02' }),
  // Q1 2026: no stage signal, not sold
  opp({ Stage: 'Not Sold', 'Close Date': '2026-02-10', Source: 'Event' }),
  // Q3 2026: Stage 5, not sold (Q2 is a gap)
  opp({ Stage: 'Not Sold', 'Close Date': '2026-08-01', 'Quoted On': '2026-07-01' }),
  // pull-through: never counted
  opp({ Stage: 'Sold', 'Close Date': '2026-01-20', Scope: 'Pull through renewal' }),
  // open opp: not decided
  opp({ Stage: 'Stage 4', 'Close Date': '2026-01-20' }),
  // out of window
  opp({ Stage: 'Sold', 'Close Date': '2024-05-05' }),
];

const t = stageCloseRateTrend(records, { period: 'quarter', from: '2026-01-01' });
assert.deepEqual(t.periods, ['2026-Q1', '2026-Q2', '2026-Q3'], 'gaps are filled');
assert.equal(t.decided, 3, 'pull-through, open and out-of-window opps are left out');
assert.equal(t.wins, 1);
const s5 = t.series.find(s => s.key === 'Stage 5');
assert.equal(s5.decided, 2);
assert.equal(s5.byPeriod['2026-Q1'].rate, 100);
assert.equal(s5.byPeriod['2026-Q2'].rate, null, 'nothing closed is blank, not 0%');
assert.equal(s5.byPeriod['2026-Q3'].rate, 0);
assert.equal(t.overall['2026-Q1'].decided, 2);

const rows = trendTableRows(t);
assert.equal(rows[rows.length - 1].isOverall, true);
assert.equal(rows.length, t.series.length + 1);

const sheet = trendSheetRows(t, { period: 'quarter', nameHeader: 'Stage' });
const s5row = sheet.find(r => r.Stage.startsWith('Stage 5'));
assert.equal(s5row['Close rate (window)'], 50);
assert.equal(s5row['Q1 2026 %'], 100);
assert.equal(s5row['Q1 2026 Sold/Closed'], '1/1');
assert.equal(s5row['Q2 2026 %'], '');
assert.equal(sheet[sheet.length - 1].Stage, 'Overall');

// By source on the same records, pull-throughs dropped first.
const src = closeRateTrend(withoutPullThroughs(records), { period: 'quarter', from: '2026-01-01' });
assert.equal(src.decided, 3);

const opps = closedOppSheetRows(records, { period: 'quarter', from: '2026-01-01' });
assert.equal(opps.length, 3);
assert.equal(opps[0]['Close Date'], '2026-08-01', 'newest first');
assert.equal(opps[0]['Reached Stage 5'], 'Yes');
assert.equal(opps[0].Period, 'Q3 2026');

assert.equal(fmtRate(null), '-');
assert.equal(fmtRate(46.6), '47%');

console.log('PASS closeRateDeepDive');

// Filters: Lead stage or higher, pull-throughs.
{
  const { applyCloseRateFilters, reachedLead, stageCloseRateTrend: sct } = await import('../src/utils/closeRateDeepDive.js');
  const recs = [
    { Stage: 'Sold', 'Close Date': '2026-01-10', Scope: 'Audits' },                                              // reached all
    { Stage: 'Not Sold', 'Close Date': '2026-01-11', Scope: 'Audits', _stageHistory: [{ stage: 'Not Started' }] }, // never reached Lead
    { Stage: 'Not Sold', 'Close Date': '2026-01-12', Scope: 'Audits', _stageHistory: [{ stage: 'Lead' }] },        // reached Lead
    { Stage: 'Not Sold', 'Close Date': '2026-01-13', Scope: 'Audits' },                                           // unknown: kept
    { Stage: 'Sold', 'Close Date': '2026-01-14', Scope: 'Pull through' },                                          // pull-through
  ];
  assert.equal(reachedLead(recs[1]), false);
  assert.equal(reachedLead(recs[2]), true);
  assert.equal(reachedLead(recs[3]), null);
  const on = applyCloseRateFilters(recs);
  assert.equal(on.records.length, 3);
  assert.equal(on.belowLead, 1);
  assert.equal(on.pullThroughs, 1);
  assert.equal(on.unknownStage, 1);
  const off = applyCloseRateFilters(recs, { leadOrHigher: false, noPullThroughs: false });
  assert.equal(off.records.length, 5);
  // Pull-throughs back in: the by-stage trend counts them when told to.
  assert.equal(sct(off.records, { period: 'year' }).decided, 4);
  assert.equal(sct(off.records, { period: 'year', includePullThroughs: true }).decided, 5);
  console.log('PASS closeRateDeepDive filters');
}

// Stage reach sheet.
{
  const { stageReachSheetRows } = await import('../src/utils/closeRateDeepDive.js');
  const recs = [
    { Stage: 'Sold', 'Start Date': '2026-01-05', 'Close Date': '2026-03-01' },
    { Stage: 'Not Sold', 'Start Date': '2026-02-05', 'Close Date': '2026-03-02', _stageHistory: [{ stage: 'Quoting' }] },
    { Stage: 'Not Sold', 'Start Date': '2026-02-06', 'Close Date': '2026-03-03' }, // no history
  ];
  const rows = stageReachSheetRows(recs, { period: 'quarter' });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].Started, 'Q1 2026');
  assert.equal(rows[0]['Closed opps'], 2);
  assert.equal(rows[0]['No stage history (left out)'], 1);
  assert.equal(rows[0]['Quoting %'], 100);
  assert.equal(rows[0]['Sold %'], 50);
  assert.equal(rows[1].Started, 'All periods');
  console.log('PASS closeRateDeepDive stage reach');
}

{
  // Fitted y axis: 1 point over the top rate, rounded up, ticks on a round step.
  const data = [{ a: 12.5, b: 30, o: 8 }, { a: null, b: 37.2, o: 9 }];
  assert.deepEqual(fittedRateAxis(data, ['a', 'b', 'o']), { domain: [0, 39], ticks: [0, 10, 20, 30, 39] });
  assert.deepEqual(fittedRateAxis([{ a: 4 }], ['a']), { domain: [0, 5], ticks: [0, 1, 2, 3, 4, 5] });
  assert.deepEqual(fittedRateAxis([{ a: 100 }], ['a']).domain, [0, 100]);
  assert.deepEqual(fittedRateAxis([{ a: 0 }], ['a']).domain, [0, 1]);
  assert.equal(fittedRateAxis([{ a: null }], ['a']), null);
  assert.deepEqual(fittedRateAxis([{ a: 42.86 }], ['a']), { domain: [0, 44], ticks: [0, 10, 20, 30, 44] }, 'a step tick next to the top gives way');
  assert.deepEqual(fittedRateAxis([{ a: 60, b: 90 }], ['a']).domain, [0, 61], 'only the drawn keys count');
  console.log('PASS closeRateDeepDive fitted y axis');
}

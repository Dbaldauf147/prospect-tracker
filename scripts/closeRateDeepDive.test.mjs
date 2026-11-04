// Close Rate deep dive: the by-stage trend and the Excel shaping.
import assert from 'node:assert/strict';
import {
  stageCloseRateTrend, trendSheetRows, trendTableRows, withoutPullThroughs, closedOppSheetRows, fmtRate,
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

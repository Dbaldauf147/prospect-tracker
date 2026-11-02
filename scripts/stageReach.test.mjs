// Assertion tests for Opps > Days in Stage > Stage Reach. Plain Node. Run:
//   node scripts/stageReach.test.mjs
import {
  furthestStageRank, stageReachByPeriod, reachPeriodLabel, REACH_STAGES,
} from '../src/utils/stageReach.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`}`);
}

const won = { Stage: 'Sold', 'Start Date': '2026-01-10' };
const quoted = { Stage: 'Quoted', 'Start Date': '2026-02-03' };
const lostAtQuoting = {
  Stage: 'Not Sold', 'Start Date': '2026-03-30',
  _stageHistory: [{ stage: 'Lead' }, { stage: 'Quoting' }],
};
const lostNoHistory = { Stage: 'Not Sold', 'Start Date': '2026-01-15' };
const movedBack = { Stage: 'Lead', 'Start Date': '2026-04-02', _stageHistory: [{ stage: 'Contracting' }] };
const pull = { Stage: 'Sold', 'Start Date': '2026-01-20', 'Pull Through': 'Yes' };
const undated = { Stage: 'Lead' };
const notStarted = { Stage: 'Not Started', 'Start Date': '2026-07-01' };

check('Sold reached everything', furthestStageRank(won), 7);
check('loss with no history is unknown', furthestStageRank(lostNoHistory), null);
check('loss reads its history', furthestStageRank(lostAtQuoting), 3);
check('moving back keeps the furthest stage', furthestStageRank(movedBack), 5);
check('labels', [reachPeriodLabel('2026-Q1', 'quarter'), reachPeriodLabel('2026-03', 'month'), reachPeriodLabel('2026', 'year')], ['Q1 2026', 'Mar 2026', '2026']);

const all = [won, quoted, lostAtQuoting, lostNoHistory, movedBack, pull, undated, notStarted];
const q = stageReachByPeriod(all, { period: 'quarter' });
check('exclusions counted', [q.counted, q.undated, q.unknown, q.pullThrough], [5, 1, 1, 1]);
check('quarters run oldest first with the empty one filled', q.rows.map(r => [r.key, r.total]), [['2026-Q1', 3], ['2026-Q2', 1], ['2026-Q3', 1]]);
const q1 = q.rows[0];
check('Q1 reach', REACH_STAGES.map(s => q1.reached[s]), [3, 3, 3, 2, 1, 1, 1]);
check('Q1 percentages', [q1.pct.Lead, q1.pct.Quoted, q1.pct.Sold], [100, 66.7, 33.3]);
check('Not Started cohort reached nothing past it', q.rows[2].pct.Lead, 0);

const m = stageReachByPeriod(all, { period: 'month' });
check('month gaps filled, empty month has null pct', [m.rows.length, m.rows[4].key, m.rows[4].total, m.rows[4].pct.Lead], [7, '2026-05', 0, null]);

const windowed = stageReachByPeriod(all, { period: 'quarter', from: '2026-02-01', to: '2026-03-31' });
check('start-date window', windowed.counted, 2);

process.exit(failures ? 1 : 0);

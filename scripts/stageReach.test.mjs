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
const q = stageReachByPeriod(all, { period: 'quarter', closedOnly: false });
check('exclusions counted', [q.counted, q.undated, q.unknown, q.pullThrough], [5, 1, 1, 1]);
check('quarters run oldest first with the empty one filled', q.rows.map(r => [r.key, r.total]), [['2026-Q1', 3], ['2026-Q2', 1], ['2026-Q3', 1]]);
const q1 = q.rows[0];
check('Q1 reach', REACH_STAGES.map(s => q1.reached[s]), [3, 3, 3, 2, 1, 1, 1]);
check('Q1 percentages', [q1.pct.Lead, q1.pct.Quoted, q1.pct.Sold], [100, 66.7, 33.3]);
check('Not Started cohort reached nothing past it', q.rows[2].pct.Lead, 0);

const m = stageReachByPeriod(all, { period: 'month', closedOnly: false });
check('month gaps filled, empty month has null pct', [m.rows.length, m.rows[4].key, m.rows[4].total, m.rows[4].pct.Lead], [7, '2026-05', 0, null]);

const windowed = stageReachByPeriod(all, { period: 'quarter', from: '2026-02-01', to: '2026-03-31', closedOnly: false });
check('start-date window', windowed.counted, 2);

// Closed only (the default): open opps drop out, so a period describes
// the deals that finished and how far they got before closing.
const c = stageReachByPeriod(all);
check('closed only by default', c.closedOnly, true);
check('open opps left out and counted', [c.counted, c.open, c.unknown, c.pullThrough, c.undated], [2, 3, 1, 1, 1]);
check('closed-only quarters', c.rows.map(r => [r.key, r.total, r.unknown]), [['2026-Q1', 2, 1]]);
check('closed-only Q1 reach', REACH_STAGES.map(s => c.rows[0].reached[s]), [2, 2, 2, 1, 1, 1, 1]);
check('closed-only Q1 percentages', [c.rows[0].pct.Quoting, c.rows[0].pct.Quoted, c.rows[0].pct.Sold], [100, 50, 50]);
check('coverage is the share of closed deals counted', c.rows[0].coverage, 66.7);
check('overall coverage', [c.overall.total, c.overall.unknown, c.overall.coverage], [2, 1, 66.7]);

// A period whose closed deals all lack history still shows up, empty.
const onlyUnknown = stageReachByPeriod([won, { Stage: 'Not Sold', 'Start Date': '2026-07-05' }]);
check('all-unknown period kept with null pct and 0% coverage', onlyUnknown.rows.map(r => [r.key, r.total, r.unknown, r.coverage, r.pct.Lead]),
  [['2026-Q1', 1, 0, 100, 100], ['2026-Q2', 0, 0, null, null], ['2026-Q3', 0, 1, 0, null]]);

process.exit(failures ? 1 : 0);

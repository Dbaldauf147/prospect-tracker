// Assertion tests for the Pipeline export's Q4 Focus tab.
// Run: node scripts/q4Focus.test.mjs
import { buildQ4Focus, stageOdds } from '../src/utils/q4Focus.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const stages = [
  { label: 'Stage 6', closeGoal: 0.75, closeActual: 0.5, flaggedCount: 1, flaggedNames: ['Old Co'] },
  { label: 'Stage 5', closeGoal: 0.4, closeActual: null, flaggedCount: 0, flaggedNames: [] },
  { label: 'Stage 4', closeGoal: 0.25, closeActual: 0.1, flaggedCount: 0 },
  { label: 'Stage 3', closeGoal: 0.1, closeActual: 0, flaggedCount: 0 },
];
check('odds: actual, else goal', stageOdds(stages), { 6: 0.5, 5: 0.4, 4: 0.1, 3: 0.1 });

const opps = [
  { Account: 'Acme', 'BFO Link': 'Acme EMS', Stage: 'Agreement Sent', 'Close Date': '2026-12-15', 'Quoted Amount': '$200,000' },
  { Account: 'Beta', Scope: 'Audit', Stage: 'Quoted', 'Close Date': '2026-11-20', 'Quoted Amount': '100000' },
  { Account: 'Gamma', Stage: 'Qualifying', 'Close Date': '2026-10-15', 'Quoted Amount': '50000' }, // past due
  { Account: 'Delta', Stage: 'Contracting', 'Close Date': '2027-02-01', 'Quoted Amount': '300000' }, // pull-in
  { Account: 'Eps', Stage: 'Lead', 'Close Date': '2027-06-01', 'Quoted Amount': '90000' }, // neither
  { Account: 'Zeta', Stage: 'Quoted', 'Close Date': '', 'Quoted Amount': '40000' }, // undated late stage
  { Account: 'Sold Q4', Stage: 'Sold', 'Close Date': '2026-10-05', 'Quoted Amount': '25000' },
  { Account: 'Sold Q2', Stage: 'Sold', 'Close Date': '2026-05-05', 'Quoted Amount': '99000' },
  { Account: 'Lost', Stage: 'Not Sold', 'Close Date': '2026-11-01', 'Quoted Amount': '10000' },
];

const f = buildQ4Focus({
  today: '2026-10-30',
  oppsRecords: opps,
  stages,
  quota: { target: 1000000, closedYTD: 600000 },
  coverage: { goal: 3, actual: 2 },
  renewals: { windowDays: 90, rows: [{ company: 'Renew Co', daysUntil: 40 }] },
  postSaleFollowUp: { rows: [{ client: 'Happy Co' }] },
  newOppsByMonth: [{ label: 'Aug', count: 2 }, { label: 'Sep', count: 3 }, { label: 'Oct', count: 4 }],
  serviceCoverage: { rows: [{ service: 'Solar', explored: 1, total: 10, pct: 0.1 }, { service: 'EV', explored: 5, total: 10, pct: 0.5 }] },
});

check('days and weeks left', [f.daysLeft, f.weeksLeft], [63, 9]);
check('gap', f.gap, 400000);
check('deals dated this year, by weighted value', f.deals.map(d => [d.account, d.weighted, d.pastDue]),
  [['Acme', 100000, false], ['Beta', 40000, false], ['Gamma', 5000, true]]);
check('opp name from BFO link, else scope', f.deals.map(d => d.opp), ['Acme EMS', 'Audit', '-']);
check('weighted / face', [f.weightedQ4, f.faceQ4, f.projected], [145000, 350000, 745000]);
check('pull-in', f.pullIn.map(d => d.account), ['Delta']);
check('closed this quarter', f.closedQ4, 25000);

const focus = f.priorities.map(p => [p.priority, p.focus]);
check('priorities, High first', focus, [
  ['High', 'Close the $400,000 gap to target'],
  ['High', 'Get 1 agreement signed'],
  ['High', 'Fix 1 past-due close date'],
  ['High', 'Pull 1 late-stage deal into Q4'],
  ['Medium', 'Put a close date on 1 late-stage deal'],
  ['Medium', 'Lock in 1 renewal'],
  ['Medium', 'Push or kill 1 opp past the life goal'],
  ['Medium', 'Clear 1 post-sale follow-up'],
  ['Medium', 'Build the Q1 pipeline now'],
  ['Medium', 'Raise pipeline coverage'],
  ['Low', 'Cross-sell Solar'],
]);
check('gap why names the coverage', f.priorities[0].why.includes('covers 36% of the gap'), true);
check('short of gap says pull in', f.priorities[0].action.includes('pull deals in'), true);

check('plan from today', f.plan.map(w => [w.from, w.to]), [
  ['2026-10-30', '2026-11-15'], ['2026-11-16', '2026-11-25'], ['2026-11-26', '2026-12-12'], ['2026-12-13', '2026-12-31'],
]);
const late = buildQ4Focus({ today: '2026-12-01', oppsRecords: [], stages, quota: { target: 100, closedYTD: 200 } });
check('plan drops windows already past', late.plan.map(w => w.from), ['2026-12-01', '2026-12-13']);
check('target met', late.priorities[0].focus, 'Target is met: bank the upside');
check('no target, no gap row', buildQ4Focus({ today: '2026-10-30', stages: [], quota: {} }).priorities.length, 0);

// No em dashes in anything the sheet shows.
check('no em dash', JSON.stringify(f).includes('—'), false);

console.log(`${failed ? 'FAIL' : 'PASS'} q4Focus: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

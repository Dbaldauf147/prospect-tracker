// Assertion tests for the Pipeline export's Q4 Focus tab.
// Run: node scripts/q4Focus.test.mjs
import { buildQ4Focus } from '../src/utils/q4Focus.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const stages = [
  { label: 'Stage 6', flaggedCount: 1, flaggedNames: ['Old Co'] },
  { label: 'Stage 5', flaggedCount: 0, flaggedNames: [] },
];

const opps = [
  // In the Annual Sales projection: Agreement Sent / Contracting, any date.
  { Account: 'Acme', 'BFO Link': 'Acme EMS', Stage: 'Agreement Sent', 'Close Date': '2026-12-15', 'Quoted Amount': '$200,000' },
  { Account: 'Delta', Stage: 'Contracting', 'Close Date': '2027-02-01', 'Quoted Amount': '100000' },
  { Account: 'Omega', Stage: 'Contracting', 'Close Date': '2026-10-01', 'Quoted Amount': '50000' },
  // Outside it.
  { Account: 'Beta', Scope: 'Audit', Stage: 'Quoted', 'Close Date': '2026-11-20', 'Quoted Amount': '120000' },
  { Account: 'Gamma', Stage: 'Qualifying', 'Close Date': '2026-10-15', 'Quoted Amount': '50000' },
  { Account: 'Kappa', Stage: 'Quoted', 'Close Date': '2027-03-01', 'Quoted Amount': '80000' },
  { Account: 'Zeta', Stage: 'Quoted', 'Close Date': '', 'Quoted Amount': '40000' },
  { Account: 'Eps', Stage: 'Lead', 'Close Date': '2027-06-01', 'Quoted Amount': '90000' },
  // Sold.
  { Account: 'Sold Q4', Stage: 'Sold', 'Close Date': '2026-10-05', 'Quoted Amount': '25000' },
  { Account: 'Sold Q2', Stage: 'Sold', 'Close Date': '2026-05-05', 'Quoted Amount': '475000' },
  { Account: 'Sold 2025', Stage: 'Sold', 'Close Date': '2025-05-05', 'Quoted Amount': '999000' },
  { Account: 'Lost', Stage: 'Not Sold', 'Close Date': '2026-11-01', 'Quoted Amount': '10000' },
];

const base = {
  today: '2026-10-30',
  oppsRecords: opps,
  stages,
  quota: { target: 1000000, closedYTD: 1 },
  coverage: { goal: 3, actual: 2 },
  renewals: { windowDays: 90, rows: [{ company: 'Renew Co', daysUntil: 40 }] },
  postSaleFollowUp: { rows: [{ client: 'Happy Co' }] },
  newOppsByMonth: [{ label: 'Aug', count: 2 }, { label: 'Sep', count: 3 }, { label: 'Oct', count: 4 }],
  serviceCoverage: { rows: [{ service: 'Solar', explored: 1, total: 10, pct: 0.1 }] },
};
const f = buildQ4Focus(base);

check('days and weeks left', [f.daysLeft, f.weeksLeft], [63, 9]);
check('sold YTD by the chart rule, not the typed Closed YTD', f.soldYTD, 500000);
check('projected = Annual Sales Projected bar', f.projected, 850000);
check('gap to projected', f.toProjected, 350000);
check('short of target', f.projectedShort, 150000);
check('projection deals, biggest first', f.projectionDeals.map(d => [d.account, d.amount, d.share]),
  [['Acme', 200000, 200000 / 350000], ['Delta', 100000, 100000 / 350000], ['Omega', 50000, 50000 / 350000]]);
check('they add up to the projection', f.soldYTD + f.projectionDealsTotal, f.projected);
check('date flags', f.projectionDeals.map(d => [d.pastDue, d.nextYear]), [[false, false], [false, true], [true, false]]);
check('opp name from BFO link', f.projectionDeals[0].opp, 'Acme EMS');
check('nothing weighted', JSON.stringify(f).includes('weighted'), false);
check('upside: other deals dated this year', f.upside.map(d => [d.account, d.pastDue]), [['Beta', false], ['Gamma', true]]);
check('pull-in: quoted, dated next Q1, outside projection', f.pullIn.map(d => d.account), ['Kappa']);
check('closed this quarter', f.closedQ4, 25000);

check('priorities, High first', f.priorities.map(p => [p.priority, p.focus]), [
  ['High', 'Land the $350,000 behind the $850,000 projection'],
  ['High', 'Find $150,000 beyond the projection to hit target'],
  ['High', 'Get 1 agreement signed'],
  ['High', 'Fix 2 past-due close dates'],
  ['High', 'Pull 1 quoted deal into Q4'],
  ['Medium', 'Put a close date on 1 quoted deal'],
  ['Medium', 'Lock in 1 renewal'],
  ['Medium', 'Push or kill 1 opp past the life goal'],
  ['Medium', 'Clear 1 post-sale follow-up'],
  ['Medium', 'Build the Q1 pipeline now'],
  ['Medium', 'Raise pipeline coverage'],
  ['Low', 'Cross-sell Solar'],
]);
check('names the deal dated next year', f.priorities[0].why.includes('1 of them is dated next year: Delta'), true);

// A pin on the chart's Projected bar wins, and is said so.
const pinned = buildQ4Focus({ ...base, yoyOverrides: { annualSales: { Projected: { _total: 857000 } } } });
check('pinned projection', [pinned.projected, pinned.overridden, pinned.toProjected], [857000, true, 357000]);
check('pinned is mentioned', pinned.priorities[0].why.includes('pinned by hand'), true);

// Over target.
const over = buildQ4Focus({ ...base, quota: { target: 800000 } });
check('over target', over.priorities.some(p => p.focus === 'Protect the projection: $50,000 over target' && p.priority === 'Medium'), true);

// No Opps loaded: the typed Closed YTD stands in, no projection.
const none = buildQ4Focus({ today: '2026-10-30', stages: [], quota: { target: 100, closedYTD: 40 } });
check('no opps', [none.projected, none.soldYTD, none.priorities[0].focus], [null, 40, 'Close the $60 gap to target']);
check('nothing at all', buildQ4Focus({ today: '2026-10-30', stages: [], quota: {} }).priorities.length, 0);

check('plan from today', f.plan.map(w => [w.from, w.to]), [
  ['2026-10-30', '2026-11-15'], ['2026-11-16', '2026-11-25'], ['2026-11-26', '2026-12-12'], ['2026-12-13', '2026-12-31'],
]);
check('plan drops windows already past', buildQ4Focus({ ...base, today: '2026-12-01' }).plan.map(w => w.from), ['2026-12-01', '2026-12-13']);

// Workdays: Fri Oct 30, 21 Nov weekdays less Thanksgiving, 23 Dec
// weekdays less Christmas.
check('workdays left', f.workdaysLeft, 1 + 20 + 22);
check('workdays on the last day', buildQ4Focus({ ...base, today: '2026-12-31' }).workdaysLeft, 1);
check('scope from the Opps record', buildQ4Focus({ ...base, oppsRecords: [...opps, { Account: 'Scoped', Scope: 'Strategic sourcing', Stage: 'Agreement Sent', 'Close Date': '2026-12-01', 'Quoted Amount': '1' }] })
  .projectionDeals.find(d => d.account === 'Scoped').scope, 'Strategic sourcing');

// Largest Stage 5 deals, marked when the account is already a client.
const big = buildQ4Focus({
  ...base,
  clientCompanies: ['Park Hotels & Resorts', 'Hilton'],
  largeDeals: { minAmount: 100000, rows: [
    { account: 'Pursuit Aerospace', stage: 'Stage 5', amount: 175000 },
    { account: 'Park Hotels & Resorts - Headquarters', stage: 'Stage 5', amount: 337107 },
    { account: 'Hilton - Headquarters', stage: 'Stage 5', amount: 150000 },
    { account: 'Six Co', stage: 'Stage 6', amount: 900000 },
  ] },
});
check('large stage 5 only, biggest first, client marked', big.largeStage5.map(d => [d.account, d.existingClient]), [
  ['Park Hotels & Resorts - Headquarters', true], ['Pursuit Aerospace', false], ['Hilton - Headquarters', true],
]);
check('no large deals', f.largeStage5, []);

check('no em dash', JSON.stringify(f).includes('—'), false);

console.log(`${failed ? 'FAIL' : 'PASS'} q4Focus: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

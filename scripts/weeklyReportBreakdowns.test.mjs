// Assertion tests for the Weekly Report tab's click-through breakdowns.
// Plain Node, no test framework. Run:
//   node scripts/weeklyReportBreakdowns.test.mjs
//
// Each chart point and card on the tab opens one of these, and its Excel
// button writes `rows.exportData || rows.allData`. What matters is that the
// rows are the records the figure was counted from, and that a figure with
// no rows behind it says why instead of exporting an empty list.
import {
  weekWindow, emailsWeekBreakdown, newOppsWeekBreakdown, coverageRatioWeekBreakdown,
  accountCoverageBreakdown, kpiBreakdown, funnelStageBreakdown,
} from '../src/utils/weeklyReportBreakdowns.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
const exported = (b) => b.rows.exportData || b.rows.allData;

// ---- week window -----------------------------------------------------

const w = weekWindow('2026-09-21');
eq(new Date(w.start).getDate(), 21, 'a week key opens at local midnight on that Monday');
eq((w.end - w.start) / 86400000, 7, '...and runs seven days');
eq(weekWindow('nonsense'), null, 'a malformed key has no window');

// ---- emails ----------------------------------------------------------

const at = (d, h = 10) => new Date(2026, 8, d, h).getTime();
const cache = {
  fetchedAt: new Date(2026, 8, 26).toISOString(),
  emails: [
    { hs_timestamp: at(22), hs_email_direction: 'EMAIL', hs_email_from_email: 'me@se.com', hs_email_to_email: 'a@client.com', hs_email_subject: 'Hello' },
    { hs_timestamp: at(15), hs_email_direction: 'EMAIL', hs_email_from_email: 'me@se.com', hs_email_to_email: 'b@client.com', hs_email_subject: 'Last week' },
  ],
};
let b = emailsWeekBreakdown({ point: { key: '2026-09-21', value: 1, recorded: false }, cache, senderEmail: 'me@se.com' });
eq(b.value, '1 email', 'the value is the plotted count');
eq(exported(b).map(r => r[2]), ['Hello'], 'the rows are the week\'s sends only');
eq(Array.isArray(b.rows.columns), true, 'an Excel button is offered');

b = emailsWeekBreakdown({ point: { key: '2026-08-03', value: null }, cache, senderEmail: 'me@se.com' });
eq(b.value, 'No record', 'a week with no record says so');
eq(b.note.length > 0, true, '...and explains why');

// ---- new opps --------------------------------------------------------

const records = [
  { _id: 'o1', Account: 'Acme', Scope: 'Energy', Stage: 'Stage 3', 'Quoted Amount': '$10,000', _rowUpdatedAt: at(23) },
  { _id: 'o2', Account: 'Old Co', Stage: 'Sold', 'Quoted Amount': '$5,000', 'Close Date': '2026-03-01', _rowUpdatedAt: new Date(2026, 1, 1).getTime() },
];
b = newOppsWeekBreakdown({ point: { key: '2026-09-21', value: 1 }, records });
eq(exported(b).map(r => r[0]), ['Acme'], 'new opps list the week\'s new rows');
eq(b.rows.exportColumns.includes('Quoted Amount'), true, 'the export carries the full opp fields');

// ---- coverage ratio --------------------------------------------------

const log = {
  '2026-09-14': { ratio: 2.1, pipeline: 2100000, target: 1000000, goal: 3, at: at(15) },
  '2026-09-21': { ratio: 2.4, pipeline: 2400000, target: 1000000, goal: 3, at: at(22) },
};
b = coverageRatioWeekBreakdown({ point: { key: '2026-09-14', value: 2.1 }, log });
eq(b.value, '2.10×', 'the clicked reading is the value');
eq(b.inputs[0], { label: 'Open pipeline', value: '$2,100,000' }, 'its pipeline is an input');
eq(exported(b).map(r => r[0]), ['2026-09-14', '2026-09-21'], 'the export is every reading, the clicked week first');

// ---- account coverage ------------------------------------------------

const progressWeeks = [{
  week: '2026-09-21', t1ContactPct: 50,
  details: { t1WithContacts: ['Acme'], t1NoContacts: ['Beta'], t2WithContacts: ['Gamma'], t2NoContacts: [] },
}];
const chart = { id: 'contactPct', title: '% of Accounts with HubSpot Contacts' };
b = accountCoverageBreakdown({ chart, point: { key: '2026-09-21', t1: 50, t2: 100 }, tier: 1, progressWeeks });
eq(exported(b), [['Acme', 'Yes'], ['Beta', 'No']], 'a tier\'s point lists that tier\'s accounts, covered or not');
eq(b.formula, '1 of 2 Tier 1 accounts: Has HubSpot Contacts', 'the formula counts them');
b = accountCoverageBreakdown({ chart, point: { key: '2026-09-14', t1: 40, t2: 60 }, tier: 2, progressWeeks });
eq(b.note.length > 0 && exported(b).length === 0, true, 'a week with no snapshot says so');

// ---- KPI cards -------------------------------------------------------

const now = new Date(2026, 8, 25).getTime();
const kpis = {
  progressToTarget: { soldYTD: 5000, target: 100000 },
  coverageRatio: { pipelineActual: 30000, target: 100000, goal: 3, live: true },
  projectedYearEnd: { soldYTD: 5000, committedAmount: 0, target: 100000 },
};
const bfoMetrics = { 4: { rows: [{ account: 'Acme', oppName: 'Acme HVAC', scope: 'HVAC', amount: 30000, age: 20 }] } };
b = kpiBreakdown({ key: 'progress', card: { label: 'Progress to target', value: '5.0%' }, kpis, records, bfoMetrics, nowMs: now });
eq(exported(b).map(r => r[0]), ['Old Co'], 'Progress to target lists this year\'s sold deals');
b = kpiBreakdown({ key: 'coverage', card: { label: 'Coverage ratio' }, kpis, records, bfoMetrics, nowMs: now });
eq(exported(b), [[4, 'Acme', 'Acme HVAC', 'HVAC', 30000, 20]], 'Coverage ratio lists the open BFO opps');
b = kpiBreakdown({ key: 'projected', card: { label: 'Projected' }, kpis, records, bfoMetrics, nowMs: now });
eq(exported(b).map(r => r[0]), ['Old Co'], 'Projected lists the deals in the projection');

// ---- funnel ----------------------------------------------------------

b = funnelStageBreakdown({ stage: { stageNum: 4, label: 'Stage 4', countActual: 1, amtActual: 30000, closeRate: 0.25 }, bfoMetrics });
eq(exported(b).length, 1, 'a funnel stage lists its open opps');
eq(b.inputs[0].value, '25%', 'with the stage close rate');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

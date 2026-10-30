// Assertion tests for the KPI Trends table as the Pipeline Report export
// writes it. Plain Node, no test framework. Run:
//   node scripts/kpiTrendsExport.test.mjs
import { computeKpiTrends } from '../src/utils/kpiTrends.js';
import { kpiTrendsForExport } from '../src/utils/kpiTrendsExport.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const NOW = Date.parse('2026-10-30T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString().slice(0, 10);
const records = [
  { Account: 'A', 'BFO Link': 'OPP-A', 'Start Date': daysAgo(30), Stage: 'Sold', 'Close Date': daysAgo(10), 'Quoted On': daysAgo(20), 'Quoted Amount': '$100,000' },
  { Account: 'B', 'BFO Link': 'OPP-B', 'Start Date': daysAgo(60), Stage: 'Not Sold', 'Close Date': daysAgo(40) },
];
const trends = computeKpiTrends(records, { nowMs: NOW });
const out = kpiTrendsForExport(trends, { closeOverall: 90 });

eq(out.months, trends.months.map(m => m.label), 'one column per month, as labelled on the page');
eq(out.windows, ['6 mo', '12 mo'], 'the two trailing windows');
eq(out.rows.map(r => r.key), trends.rows.map(r => r.key), 'every KPI, in page order');
eq(out.rows[0].label, 'Opportunity Generation (avg / month)', 'generation reads as on the page');
const overall = out.rows.find(r => r.key === 'closeOverall');
eq([overall.totals[0].text, overall.totals[0].status], ['50%', 'missed'], 'a figure under its target is marked missed');
eq(overall.target, '90%', 'the target as the page shows it');
eq(out.rows.find(r => r.key === 'avgSize').target, '', 'no target, blank');
eq(out.rows.every(r => r.cells.every(c => c.text !== '-' || c.sub === '')), true, 'an empty month carries no count line');
eq(kpiTrendsForExport(computeKpiTrends([], { nowMs: NOW }), {}).rows.length, 6, 'no opps still lists the KPIs');
eq(kpiTrendsForExport(null), null, 'nothing computed, nothing exported');
eq(JSON.stringify(out).includes('—'), false, 'no em dash');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

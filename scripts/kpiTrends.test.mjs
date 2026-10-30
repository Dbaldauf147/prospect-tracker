// Assertion tests for the Pipeline page's KPI Trends (src/utils/kpiTrends.js).
// Plain Node, no framework. Run:
//   node scripts/kpiTrends.test.mjs
//
// What has to hold:
//   * each KPI counts what its definition says, over the right window,
//   * pull-through opps are left out everywhere,
//   * an opp is quoted by a Quoted On date or by time in Quoted / Agreement Sent,
//   * an empty window reads "-", not 0%,
//   * generation is opps opened per month, in the month columns and both windows,
//   * the month columns are the last six calendar months,
//   * a target is met at or over (at or under for life), at the precision shown,
//   * each cell carries the opps behind it, with their Opps tab columns.
import {
  computeKpiTrends, formatKpi, wasQuoted, trailingWindow, calendarMonths,
  sanitizeKpiTargets, parseKpiTarget, targetStatus, formatKpiTarget, KPI_DEFS,
} from '../src/utils/kpiTrends.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const NOW = Date.parse('2026-10-30T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString().slice(0, 10);
const opp = (o) => ({ Account: 'Acme', 'BFO Link': `OPP-${Math.random().toString(36).slice(2, 7)}`, Scope: 'Energy', ...o });

const records = [
  // Opened 30 days ago, quoted $100k, sold 10 days ago: life 20 days.
  opp({ Account: 'A', 'Start Date': daysAgo(30), Stage: 'Sold', 'Close Date': daysAgo(10), 'Quoted On': daysAgo(20), 'Quoted Amount': '$100,000' }),
  // Opened 60 days ago, never quoted, lost 40 days ago: life 20 days.
  opp({ Account: 'B', 'Start Date': daysAgo(60), Stage: 'Not Sold', 'Close Date': daysAgo(40) }),
  // Opened 300 days ago, quoted by stage history, sold 250 days ago: life 50 days. 12-month window only.
  opp({ Account: 'C', 'Start Date': daysAgo(300), Stage: 'Sold', 'Close Date': daysAgo(250), 'Quoted Amount': '50000', _stageHistory: [{ stage: 'Quoted', days: 12 }] }),
  // Opened 90 days ago, still open, quoted $200k.
  opp({ Account: 'D', 'Start Date': daysAgo(90), Stage: 'Quoted', 'Quoted Amount': 200000 }),
  // Pull-through: ignored everywhere.
  opp({ Account: 'P', 'Start Date': daysAgo(20), Stage: 'Sold', 'Close Date': daysAgo(5), Scope: 'Pull Through', 'Quoted Amount': 999999 }),
  // No BFO opportunity: not generated, but still a closed opp.
  { Account: 'E', 'BFO Link': '', 'Start Date': daysAgo(50), Stage: 'Not Sold', 'Close Date': daysAgo(30) },
  // Older than 12 months: in nothing.
  opp({ Account: 'Z', 'Start Date': daysAgo(500), Stage: 'Sold', 'Close Date': daysAgo(450) }),
];

const t = computeKpiTrends(records, { nowMs: NOW });
const k = Object.fromEntries(t.rows.map(r => [r.key, r]));
const v = (key) => k[key].totals.map(c => (c.value == null ? null : Math.round(c.value * 1000) / 1000));

eq(t.windows.map(w => w.label), ['Last 6 Months', 'Last 12 Months'], 'two windows, 6 and 12 months');
eq(new Date(trailingWindow(6, NOW).from).toISOString().slice(0, 10), '2026-04-30', 'a 6-month window starts six calendar months back');
eq(t.rows.map(r => r.label), ['Opportunity Generation', 'Average Opportunity Size', 'Percentage of Opportunities Quoted', 'Close Rate Quoted', 'Close Rate Overall', 'Average Opportunity Life'], 'the six KPIs, in order');

eq(v('generation'), [0.5, 0.333], 'generation: opened per month (3 in 6 mo, 4 in 12 mo), pull-through and no-BFO left out');
eq(k.generation.totals.map(c => c.sub), ['3 opened', '4 opened'], 'generation shows the count it averages');
eq(v('avgSize'), [150000, 116666.667], 'avg size: mean Quoted Amount of opened opps that have one');
eq(v('pctQuoted'), [0.333, 0.5], 'pct quoted: quoted share of closed opps (A of A, B, E; then A, C of four)');
eq(v('closeQuoted'), [1, 1], 'close rate quoted: Sold share of quoted closed opps');
eq(v('closeOverall'), [0.333, 0.5], 'close rate overall: Sold share of closed opps');
eq(v('avgLife'), [20, 27.5], 'avg life: days opened to closed');

eq(wasQuoted({ 'Quoted On': '2026-01-01' }), true, 'quoted by a Quoted On date');
eq(wasQuoted({ _stageHistory: [{ stage: 'Agreement Sent', days: 3 }] }), true, 'quoted by time in Agreement Sent');
eq(wasQuoted({ _stageHistory: [{ stage: 'Qualify', days: 3 }] }), false, 'not quoted otherwise');

eq(t.months.map(m => m.label), ['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'], 'six calendar month columns, ending with this one');
eq(calendarMonths(3, Date.parse('2026-01-15T12:00:00Z')).map(m => m.label), ['Nov ’25', 'Dec ’25', 'Jan ’26'], 'the year is labelled when the months cross one');
// Opened: D Aug 1, B Aug 31, A Sep 30. Closed: B and E Not Sold in Sep, A Sold Oct 20.
eq(k.generation.cells.map(c => c.value), [0, 0, 0, 2, 1, 0], 'a month column counts the opps opened in it');
eq(k.closeOverall.cells.map(c => c.value), [null, null, null, null, 0, 1], 'a month column with nothing closed is blank, not 0%');

const gen = KPI_DEFS.find(d => d.key === 'generation');
const life = KPI_DEFS.find(d => d.key === 'avgLife');
const rate = KPI_DEFS.find(d => d.key === 'closeOverall');
eq([targetStatus(gen, 0.5, 0.5), targetStatus(gen, 0.33, 0.5), targetStatus(gen, 0.5, null)], ['met', 'missed', null], 'generation target met at or over it');
eq([targetStatus(life, 20, 30), targetStatus(life, 40, 30)], ['met', 'missed'], 'life target met at or under it');
eq([targetStatus(rate, 0.304, 30), targetStatus(rate, 0.29, 30)], ['met', 'missed'], 'a rate target is typed as a percent and compared as shown');
eq([parseKpiTarget('30%'), parseKpiTarget('$1,500'), parseKpiTarget(''), parseKpiTarget('abc')], [30, 1500, null, null], 'typed targets read with or without % and $');
eq(sanitizeKpiTargets({ closeOverall: 30, avgLife: -1, bogus: 4, avgSize: 'x', generation: 0 }), { generation: 0, closeOverall: 30 }, 'only real, non-negative targets for known KPIs are kept');
eq([formatKpiTarget(rate, 30), formatKpiTarget(gen, 2.5), formatKpiTarget(life, undefined)], ['30%', '2.5', ''], 'targets read back in the KPI\'s own format');

const empty = computeKpiTrends([], { nowMs: NOW });
eq(empty.rows.find(r => r.key === 'closeOverall').totals.map(c => formatKpi(c.value, 'pct')), ['-', '-'], 'an empty window reads "-", not 0%');
eq(empty.rows.find(r => r.key === 'generation').totals[0].value, 0, 'no opps generated is a real 0');

const row = k.avgLife.totals[0].rows.find(r => r.Account === 'A');
eq([row['Life (days)'], row['Opened (as counted)'], row.Quoted, row.Scope, '_stageHistory' in row], [20, daysAgo(30), 'Yes', 'Energy', false], 'export rows carry what was counted plus the Opps tab columns, no bookkeeping');
eq(k.pctQuoted.totals[1].rows.length, 4, 'export rows are the opps behind the value');

eq([formatKpi(0.456, 'pct'), formatKpi(1234.4, 'money'), formatKpi(27.5, 'days'), formatKpi(7, 'count'), formatKpi(0.333, 'count')], ['46%', '$1,234', '28 days', '7', '0.3'], 'formatting');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

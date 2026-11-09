// Commissions > BFO opp popup: Actual (roster) and Expected (Deals page)
// revenue and commission by month.
// Run: node scripts/commissionBfoSchedule.test.mjs
const { buildBfoSchedule, normBfoKey } = await import('../src/utils/commissionBfoSchedule.js');

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
const today = new Date(2026, 10, 9); // Nov 2026

eq(normBfoKey('  Acme   Solar '), 'acme solar', 'BFO key normalizes case and spaces');

// July-June year, paid Jul..Oct.
const paying = {
  'Comm Start Date': '7/1/2026', 'Comm End Date': '6/30/2027', '%': '10%',
  July: 300, August: 300, September: 400, October: 400,
  'July Revenue': 3000, 'August Revenue': 3000, 'September Revenue': 4000, 'October Revenue': 4000,
};
const s = buildBfoSchedule([paying], { today });
eq([s.months.length, s.months[0].label, s.months[11].label], [12, 'Jul 2026', 'Jun 2027'], 'months follow the window');
eq(s.months.find(m => m.isCurrent).label, 'Nov 2026', 'current month flagged');
eq(s.actual.commission.cells.slice(0, 5), [300, 300, 400, 400, null], 'actual commission: recorded only, nothing projected');
eq([s.actual.revenue.total, s.actual.commission.total], [14000, 1400], 'actual totals');
eq([s.expected.deals, s.expected.revenue.total], [0, 0], 'no deals, nothing expected');

// Two rows sum per month; a row is blank before its window, and a recorded
// cell lands in the year its window puts it in.
const annex = { 'Comm Start Date': '1/1/2027', 'Comm End Date': '3/31/2027', 'January Revenue': 2000, January: 200 };
const two = buildBfoSchedule([paying, annex], { today });
const jan = two.months.findIndex(m => m.label === 'Jan 2027');
eq([two.actual.revenue.cells[jan], two.actual.commission.cells[jan]], [2000, 200], 'annex placed in Jan 2027');
eq(two.actual.revenue.cells[0], 3000, 'month sums only rows in their window');

// Undated row: read as this calendar year.
const undated = buildBfoSchedule([{ March: 50 }], { today });
eq([undated.months[0].label, undated.actual.commission.total], ['Jan 2026', 50], 'undated row reads as this year');

// Deals page: Setup (and its commission share) up front, the rest even.
const deal = { Commission: 1300, Setup: 1000, 'Recurring Revenue': 12000 };
const d = buildBfoSchedule([paying], { deals: [deal], today });
eq([d.expected.revenue.cells[0], d.expected.revenue.cells[1], d.expected.revenue.total], [2000, 1000, 13000], 'expected revenue: setup up front, recurring spread');
eq([d.expected.commission.cells[0], d.expected.commission.cells[1], Math.round(d.expected.commission.total)], [200, 100, 1300], 'expected commission: setup share up front');

// No commission rows: the deal's own term dates set the months.
const d2 = buildBfoSchedule([], { deals: [{ Commission: 600, 'Current Term Start Date': '1/1/2027', 'End Date': '6/30/2027' }], today });
eq([d2.months[0].label, d2.months.length, d2.expected.commission.cells[0]], ['Jan 2027', 6, 100], 'deal term dates set the months');

// No dates at all: the deal can't be placed.
const d3 = buildBfoSchedule([], { deals: [{ Commission: 600 }], today });
eq([d3.expected.undated, d3.expected.commission.total], [1, 0], 'undated deal not placed');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

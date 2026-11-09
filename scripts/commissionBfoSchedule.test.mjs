// Commissions > BFO opp popup: Actual (roster) and Expected (Deals page)
// revenue and commission by month.
// Run: node scripts/commissionBfoSchedule.test.mjs
const { buildBfoSchedule, normBfoKey, isSetupRow, bfoMatchState, bfoOkSignature, bfoComparisons } = await import('../src/utils/commissionBfoSchedule.js');

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
const A = (sch, k) => sch[k].actual;
eq(A(s, 'commission').recurring.cells.slice(0, 5), [300, 300, 400, 400, null], 'actual commission: recorded only, nothing projected');
eq([A(s, 'revenue').total.total, A(s, 'commission').total.total], [14000, 1400], 'actual totals');
eq([s.deals, s.revenue.expected.total.total], [0, 0], 'no deals, nothing expected');

// Setup vs recurring classification by project name.
eq([isSetupRow({ 'Project Name': 'Prologis_SoW#7 NonRecurring' }), isSetupRow({ 'Project Name': 'X Recurring' }), isSetupRow({ Name: 'Setup fee' }), isSetupRow({ 'Project Name': 'One-time implementation' })], [true, false, true, true], 'setup rows detected by name');

// Setup and recurring rows split into their own lines; total sums both.
const setupRow = { 'Project Name': 'Acme NonRecurring', 'Comm Start Date': '7/1/2026', 'Comm End Date': '6/30/2027', 'July Revenue': 5000, July: 500 };
const split = buildBfoSchedule([paying, setupRow], { today });
eq([A(split, 'revenue').setup.cells[0], A(split, 'revenue').recurring.cells[0], A(split, 'revenue').total.cells[0]], [5000, 3000, 8000], 'actual split into setup / recurring');
eq(A(split, 'commission').setup.total, 500, 'setup commission total');

// Two rows sum per month; a recorded cell lands in its window's year.
const annex = { 'Comm Start Date': '1/1/2027', 'Comm End Date': '3/31/2027', 'January Revenue': 2000, January: 200 };
const two = buildBfoSchedule([paying, annex], { today });
const jan = two.months.findIndex(m => m.label === 'Jan 2027');
eq([A(two, 'revenue').recurring.cells[jan], A(two, 'commission').recurring.cells[jan]], [2000, 200], 'annex placed in Jan 2027');

// Undated row: read as this calendar year.
const undated = buildBfoSchedule([{ March: 50 }], { today });
eq([undated.months[0].label, A(undated, 'commission').total.total], ['Jan 2026', 50], 'undated row reads as this year');

// Deals page: Setup (and its commission share) in month one, the rest even.
const deal = { Commission: 1300, Setup: 1000, 'Recurring Revenue': 12000 };
const d = buildBfoSchedule([paying], { deals: [deal], today });
const E = (k) => d[k].expected;
eq([E('revenue').setup.cells[0], E('revenue').setup.cells[1], E('revenue').recurring.cells[0], E('revenue').total.total], [1000, null, 1000, 13000], 'expected revenue: setup in month one, recurring spread');
eq([E('commission').setup.total, E('commission').recurring.cells[1], Math.round(E('commission').total.total)], [100, 100, 1300], 'expected commission: setup share in month one');

// No commission rows: the deal's own term dates set the months.
const d2 = buildBfoSchedule([], { deals: [{ Commission: 600, 'Current Term Start Date': '1/1/2027', 'End Date': '6/30/2027' }], today });
eq([d2.months[0].label, d2.months.length, d2.commission.expected.recurring.cells[0]], ['Jan 2027', 6, 100], 'deal term dates set the months');

// No dates at all: the deal can't be placed.
const d3 = buildBfoSchedule([], { deals: [{ Commission: 600 }], today });
eq([d3.undated, d3.commission.expected.total.total], [1, 0], 'undated deal not placed');

// Actual vs Expected states.
eq([bfoMatchState(null, null), bfoMatchState(0, null), bfoMatchState(100, 100.4), bfoMatchState(100, 120)], ['none', 'none', 'match', 'mismatch'], 'match states');
eq(bfoMatchState(100, 120, bfoOkSignature(100, 120)), 'ok', 'marked OK holds while amounts are the same');
eq(bfoMatchState(100, 130, bfoOkSignature(100, 120)), 'mismatch', 'marked OK lapses when an amount changes');
const cmp = bfoComparisons('revenue', d.revenue, d.months);
eq([cmp.length, cmp[0].key, cmp[0].actual, cmp[0].expected], [3 * 13, 'revenue:setup:2026-07', null, 1000], 'comparisons cover every line, month and total');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

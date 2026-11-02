// Commissions > Projected: which rows are projected and how. Run:
//   node scripts/commissionProjection.test.mjs
const { projectCommissionRow, projectionTotals, commissionRate } = await import('../src/utils/commissionProjection.js');

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
const today = new Date(2026, 10, 2);

eq([commissionRate('9%'), commissionRate(0.07), commissionRate(10), commissionRate('')], [0.09, 0.07, 0.1, null], 'rate parsing');

// Being paid: July-June year, paid Jul..Oct, latest is October.
const paying = { 'Comm Start Date': '7/1/2026', 'Comm End Date': '6/30/2027', '%': '10%', July: 300, August: 300, September: 400, October: 400, May: '' };
const p = projectCommissionRow(paying, { status: 'active', today });
eq([p.category, p.monthsPaid, p.paidSoFar, p.currentMonthly, p.projected, p.remaining], ['paying', 4, 1400, 400, 4800, 3400], 'being paid: latest month x 12, less paid');

// Fiscal order: for a July start, May (later in the year) beats October.
const fy = projectCommissionRow({ 'Comm Start Date': '7/1/2025', October: 100, May: 250 }, { status: 'active', today });
eq([fy.currentMonth, fy.currentMonthly], ['May', 250], 'latest month follows the commission year');

eq(projectCommissionRow(paying, { status: 'stopped', today }), null, 'stopped row left out');
eq(projectCommissionRow({ ...paying, __ignored: true }, { status: 'active', today }), null, 'ignored row left out');

// Not yet paid: from revenue x %.
const rev = projectCommissionRow({ 'Comm Start Date': '1/1/2027', '%': '10%', 'January Revenue': 5000 }, { status: 'unknown', today });
eq([rev.category, rev.expectedMonthly, rev.projected, rev.remaining], ['notYet', 500, 6000, 6000], 'not yet paid: revenue x %');

// Not yet paid: from the opp's Quoted Amount x % / 12.
const opp = projectCommissionRow({ 'Comm Start Date': '5/1/2026', 'Comm End Date': '4/30/2027', '%': '10%' }, { status: 'active', opp: { 'Quoted Amount': '$120,000' }, today });
eq([opp.category, opp.expectedMonthly, opp.projected], ['notYet', 1000, 12000], 'not yet paid: Quoted Amount x % / 12');

const none = projectCommissionRow({ 'Comm Start Date': '5/1/2026', '%': '10%' }, { status: 'unknown', today });
eq([none.category, none.expectedMonthly, none.projected], ['notYet', null, null], 'not yet paid with nothing to price it');

eq(projectCommissionRow({ 'Comm Start Date': '1/1/2025', 'Comm End Date': '12/31/2025' }, { status: 'stopped', today }), null, 'ended and never paid: left out');
eq(projectCommissionRow({ '%': '10%' }, { status: 'unknown', today }), null, 'undated and unpaid: left out');

const t = projectionTotals([{ projection: p }, { projection: rev }, { projection: none }]);
eq([t.paying.count, t.notYet.count, t.all.count, t.all.projected, t.all.remaining], [1, 2, 3, 10800, 9400], 'totals');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

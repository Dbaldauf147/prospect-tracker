// Commissions > BFO opp popup: month-by-month revenue / commission schedule.
// Run: node scripts/commissionBfoSchedule.test.mjs
const { buildBfoSchedule, normBfoKey } = await import('../src/utils/commissionBfoSchedule.js');
const { projectCommissionRow } = await import('../src/utils/commissionProjection.js');

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
const today = new Date(2026, 10, 9); // Nov 2026

eq(normBfoKey('  Acme   Solar '), 'acme solar', 'BFO key normalizes case and spaces');

// July-June year, paid Jul..Oct; Nov onward expected at the latest amount.
const paying = {
  'Project Name': 'Acme HQ', 'Comm Start Date': '7/1/2026', 'Comm End Date': '6/30/2027', '%': '10%',
  July: 300, August: 300, September: 400, October: 400,
  'July Revenue': 3000, 'August Revenue': 3000, 'September Revenue': 4000, 'October Revenue': 4000,
};
const projectionOf = (r) => projectCommissionRow(r, { status: 'active', today });
const s = buildBfoSchedule([paying], { projectionOf, today });
eq([s.months.length, s.months[0].label, s.months[11].label], [12, 'Jul 2026', 'Jun 2027'], 'months follow the window');
eq(s.months.find(m => m.isCurrent).label, 'Nov 2026', 'current month flagged');
const c = s.commission.lines[0];
eq(c.cells.slice(0, 6).map(x => x && [x.kind, x.value]), [['recorded', 300], ['recorded', 300], ['recorded', 400], ['recorded', 400], ['expected', 400], ['expected', 400]], 'commission: recorded, then expected');
eq([c.recorded, c.expected, c.total], [1400, 3200, 4600], 'commission totals');
const r = s.revenue.lines[0];
eq([r.recorded, r.expected], [14000, 8 * 3500], 'revenue: expected at the average revenue on file');

// Past months with nothing recorded stay blank; outside the window is blank.
const gap = buildBfoSchedule([{ ...paying, August: '' }], { projectionOf, today });
eq(gap.commission.lines[0].cells[1], null, 'past unrecorded month blank');

// Two rows, different windows: the range spans both; totals add up per month.
const notYet = { 'Project Name': 'Acme Annex', 'Comm Start Date': '1/1/2027', 'Comm End Date': '3/31/2027', '%': '10%', 'January Revenue': 2000 };
const two = buildBfoSchedule([paying, notYet], { projectionOf: (row) => projectCommissionRow(row, { status: 'unknown', today }) ?? projectionOf(row), today });
eq([two.months.length, two.months[0].label], [12, 'Jul 2026'], 'range spans both rows');
const jan = two.months.findIndex(m => m.label === 'Jan 2027');
eq(two.commission.totals[jan], { value: 400 + 200, kind: 'expected' }, 'month total sums rows');
eq(two.commission.lines[1].cells[0], null, 'row blank before its window');
// January Revenue on the not-yet row is recorded (it's in the window, placed in Jan 2027).
eq(two.revenue.lines[1].cells[jan], { value: 2000, kind: 'recorded' }, 'recorded cell placed in its window year');

// Stopped row: nothing expected going forward.
const stopped = buildBfoSchedule([paying], { projectionOf: () => null, today });
eq(stopped.commission.expected, 0, 'no projection, no expected amounts');

// Undated row: read as this calendar year.
const undated = buildBfoSchedule([{ 'Project Name': 'X', March: 50 }], { projectionOf: () => null, today });
eq([undated.months[0].label, undated.commission.recorded], ['Jan 2026', 50], 'undated row reads as this year');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

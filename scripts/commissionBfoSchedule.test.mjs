// Commissions > BFO opp popup: Actual (roster) and Expected (Deals page)
// revenue and commission by month.
// Run: node scripts/commissionBfoSchedule.test.mjs
const { buildBfoSchedule, normBfoKey, isSetupRow, bfoMatchState, bfoOkSignature, bfoComparisons, bfoAllGreen, bfoComparisonStates, bfoActualTotal, bfoPaymentStatus, bfoWatchPatch, BFO_WATCH_SETTINGS_KEY } = await import('../src/utils/commissionBfoSchedule.js');

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
eq([bfoMatchState(150, 120), bfoMatchState(6310, 3155), bfoMatchState(50, null)], ['match', 'match', 'match'], 'actual above expected is green');
eq(bfoMatchState(100, 120, bfoOkSignature(100, 120)), 'ok', 'marked OK holds while amounts are the same');
eq(bfoMatchState(100, 130, bfoOkSignature(100, 120)), 'mismatch', 'marked OK lapses when an amount changes');
const cmp = bfoComparisons('revenue', d.revenue, d.months);
eq([cmp.length, cmp[0].key, cmp[0].actual, cmp[0].expected], [3 * 13, 'revenue:setup:2026-07', null, 1000], 'comparisons cover every line, month and total');

// Projected: a Recurring row's latest month carried to its window's end,
// pushed out by how late the first payment came. Willco-shaped: Nov 2025 -
// Oct 2026, nothing in Nov, Dec..Jul recorded, so it runs to Nov 2026.
const willco = {
  'Project Name': 'Willco Construction 1st Amendment', 'Comm Start Date': '11/1/2025', 'Comm End Date': '10/31/2026',
  'December Revenue': 6310, 'January Revenue': 4000, 'June Revenue': 3800, 'July Revenue': 3550,
  December: 568, January: 360, June: 342, July: 320,
};
const pw = buildBfoSchedule([willco], { today });
eq(pw.revenue.projected.cells, [null, null, null, null, null, null, null, null, null, 3550, 3550, 3550, 3550], 'projected revenue: only after the latest recorded month, to the pushed-out end');
eq([pw.commission.projected.cells[9], pw.commission.projected.total], [320, 1280], 'projected commission carries the latest month');
eq(pw.revenue.actual.recurring.cells[9], null, 'actual cells stay recorded-only');
const ps = buildBfoSchedule([{ ...setupRow }], { today });
eq(ps.revenue.projected.total, 0, 'setup rows are never projected');

// All green: every compared cell matches or is marked OK; projected cells
// don't count against it.
const gRow = { 'Comm Start Date': '1/1/2026', 'Comm End Date': '3/31/2026', 'January Revenue': 1200, February: 0, January: 120 };
const gDeal = { 'Recurring Revenue': 3600, Commission: 360, 'Current Term Start Date': '1/1/2026', 'End Date': '3/31/2026' };
const full = { ...gRow, 'February Revenue': 1200, 'March Revenue': 1200, February: 120, March: 120 };
eq(bfoAllGreen([full], { deals: [gDeal], today }), true, 'all green when every month matches');
eq(bfoAllGreen([{ ...full, March: 90 }], { deals: [gDeal], today }), false, 'one red cell (short of expected): not green');
eq(bfoAllGreen([{ ...full, March: 150 }], { deals: [gDeal], today }), true, 'actual above expected stays green');
const redModel = buildBfoSchedule([{ ...full, March: 90 }], { deals: [gDeal], today });
const marks = {};
for (const [k, c] of bfoComparisonStates(redModel)) if (c.state === 'mismatch') marks[k] = bfoOkSignature(c.actual, c.expected);
eq(bfoAllGreen([{ ...full, March: 90 }], { deals: [gDeal], today, okMarks: marks }), true, 'reds marked OK count as green');
eq(bfoAllGreen([full], { deals: [], today }), false, 'nothing expected: not green');
eq(bfoAllGreen([], { deals: [gDeal], today }), false, 'no rows: not green');

// Expected starts when Actual does: window opens Nov 2025 but nothing is
// recorded until Dec 2025, so the deal's 12-month term moves to Dec-Nov.
const late = { 'Comm Start Date': '11/1/2025', 'Comm End Date': '10/31/2026', December: 568, 'December Revenue': 6310, January: 360, 'January Revenue': 4000 };
const lateS = buildBfoSchedule([late], { deals: [{ Commission: 1200, 'Recurring Revenue': 12000 }], today });
const lr = lateS.revenue.expected.recurring;
eq([lateS.months[0].label, lr.cells[0], lr.cells[1], lateS.months[lr.cells.lastIndexOf(1000)].label, lr.total], ['Nov 2025', null, 1000, 'Nov 2026', 12000], 'expected term moves to start with the first recorded month');
eq(lateS.commission.expected.recurring.cells.slice(0, 2), [null, 100], 'expected commission starts with actuals too');
// Paid a month late, so projection runs a month past Comm End (Nov 2026),
// to the end of the moved Expected term.
const lp = lateS.revenue.projected;
eq([lateS.months[lp.cells.length - 1].label, lp.cells[lp.cells.length - 1], lp.cells[lp.cells.length - 2], lp.cells[3]], ['Nov 2026', 4000, 4000, 4000], 'projection runs to the moved term end');
const lateNoDeal = buildBfoSchedule([late], { today });
eq(lateNoDeal.months[lateNoDeal.months.length - 1].label, 'Nov 2026', 'columns cover the pushed-out projection without a deal');

// The Total column compares recorded + projected against Expected.
const wd = { 'Recurring Revenue': 37857, Commission: 3407, 'Current Term Start Date': '11/1/2025', 'End Date': '10/31/2026' };
const wS = buildBfoSchedule([willco], { deals: [wd], today });
const recorded = wS.revenue.actual.total.total;
eq(bfoActualTotal(wS.revenue, 'total'), recorded + wS.revenue.projected.total, 'actual total includes the projection');
eq(bfoActualTotal(wS.revenue, 'setup'), wS.revenue.actual.setup.total, 'setup total has no projection');
const wSt = bfoComparisonStates(wS);
eq([wSt.get('revenue:total:total').actual, wSt.get('revenue:recurring:total').state], [recorded + wS.revenue.projected.total, recorded + wS.revenue.projected.total >= 37856 ? 'match' : 'mismatch'], 'total compared with projection included');

// To watch flags: added and removed without touching other opps' flags.
const at = new Date('2026-11-10T12:00:00Z');
const w1 = bfoWatchPatch({ [BFO_WATCH_SETTINGS_KEY]: { other: 'x' } }, 'divco', true, at);
eq(w1, { [BFO_WATCH_SETTINGS_KEY]: { other: 'x', divco: '2026-11-10T12:00:00.000Z' } }, 'watch flag added, others kept');
eq(bfoWatchPatch(w1, 'divco', false), { [BFO_WATCH_SETTINGS_KEY]: { other: 'x' } }, 'watch flag removed');
eq(bfoWatchPatch(undefined, 'a', true, at)[BFO_WATCH_SETTINGS_KEY], { a: '2026-11-10T12:00:00.000Z' }, 'watch flag with no settings yet');

eq([bfoPaymentStatus(120, 100), bfoPaymentStatus(80, 100), bfoPaymentStatus(100.4, 100), bfoPaymentStatus(0, null), bfoPaymentStatus(50, 0)], ['overpaid', 'underpaid', 'exact', null, 'overpaid'], 'payment status');

// Uploaded months: flagged on the month, and never projected into (the
// file is that month's record). Willco row, Nov 2025 - Oct 2026, latest
// paid Jul 2026: Aug and Sep uploaded, so only Oct and Nov 2026 project.
const up = buildBfoSchedule([willco], { today, uploads: { '2026-08': { fileName: 'Aug.xlsx', at: 'x' }, '2026-09': { fileName: 'Sep.xlsx', at: 'y' } } });
eq(up.months.filter(m => m.uploaded).map(m => m.label), ['Aug 2026', 'Sep 2026'], 'uploaded months flagged');
eq(up.revenue.projected.cells.slice(9), [null, null, 3550, 3550], 'no projection into uploaded months');
eq(buildBfoSchedule([willco], { today }).months.every(m => m.uploaded === null), true, 'no uploads, nothing flagged');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

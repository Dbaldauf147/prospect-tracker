// Assertion tests for the Setup-fee floor — the lowest the Setup fees on a
// Pricing Option can go before Year 1 stops paying for itself. Plain Node, no
// test framework (the project has none). Run:
//   node scripts/setupFeeFloor.test.mjs
//
// This number gets quoted at a customer, so the properties worth pinning are
// the ones that would be believed if they were wrong: the floor must never
// land total Year-1 fees under total Year-1 cost (rounding included — it is a
// minimum, so cents round UP), a row that bills outside Year 1 buys no
// headroom, and a deal already under water must not come back with a discount
// to give away.
//
// What Setup alone costs to deliver does NOT bound the cut — a year the
// recurring stream pays for is a year that pays for itself — but the solve
// still reports how far under that cost the floor lands, so the panel can say
// so.
import { solveSetupFeeFloor, isSetupFeeType } from '../src/utils/setupFeeFloor.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}
function ok(label, cond) { check(label, !!cond, true); }
const round2 = (n) => Math.round(n * 100) / 100;

// ── Which rows count as setup ─────────────────────────────────────────────
check('type: Setup', isSetupFeeType('Setup'), true);
check('type: padded / cased', isSetupFeeType('  setup '), true);
check('type: One Time is not setup', isSetupFeeType('One Time'), false);
check('type: Recurring is not setup', isSetupFeeType('Recurring (monthly)'), false);
check('type: blank', isSetupFeeType(''), false);

// ── The basic solve ───────────────────────────────────────────────────────
// $60k of recurring + $60k of setup against $100k of cost: $20k of headroom,
// so the setup fees can shed $20k of their $60k — a third off each row.
{
  const r = solveSetupFeeFloor({
    y1Cost: 100000,
    fixedY1Revenue: 60000,
    rows: [
      { key: 'a', label: 'Setup A', fee: 500, unitCount: 100, y1Revenue: 50000 },
      { key: 'b', label: 'Setup B', fee: 100, unitCount: 100, y1Revenue: 10000 },
    ],
  });
  check('basic: status', r.status, 'ok');
  check('basic: current cash flow', r.currentCashFlow, 20000);
  check('basic: cut is the whole headroom, bar rounding', round2(r.maxReduction), 19999);
  check('basic: proportional — both rows keep 2/3', r.rows.map(x => x.floorFee), [333.34, 66.67]);
  ok('basic: year 1 still clears', r.resultingCashFlow >= 0);
}

// ── Rounding is the failure mode, so pin it ───────────────────────────────
// A fee whose exact floor lands mid-cent ($2.70027), over enough units that
// the wrong rounding direction is real money. Rounding down to $2.70 bills
// $8,999.10 against $9,000 of cost — a floor that is itself under water.
{
  const r = solveSetupFeeFloor({
    y1Cost: 9000,
    fixedY1Revenue: 0,
    rows: [{ key: 'a', label: 'Odd', fee: 3, unitCount: 3333, y1Revenue: 9999 }],
  });
  check('rounding: up to the cent, not down', r.rows[0].floorFee, 2.71);
  ok('rounding: never below break even', r.resultingCashFlow >= 0);
}

// ── Headroom bigger than the setup fees themselves ────────────────────────
// The recurring alone pays for the year, so setup can go to $0 — and no
// further, however much headroom is left over.
{
  const r = solveSetupFeeFloor({
    y1Cost: 20000,
    fixedY1Revenue: 90000,
    rows: [{ key: 'a', label: 'Setup A', fee: 250, unitCount: 40, y1Revenue: 10000 }],
  });
  check('zero floor: status', r.status, 'zero-floor');
  check('zero floor: fee bottoms out at 0', r.rows[0].floorFee, 0);
  check('zero floor: cut is capped at the setup revenue', r.maxReduction, 10000);
  check('zero floor: the rest of the headroom survives', r.resultingCashFlow, 70000);
}

// ── Setup cost is reported, not enforced ─────────────────────────────────
// Same deal, but Setup costs $6,000 to deliver (tech depreciation included).
// The recurring stream already covers the year, so the fee can still go to $0
// — the cost is context, and the solve says how far under it that lands.
{
  const r = solveSetupFeeFloor({
    y1Cost: 20000,
    fixedY1Revenue: 90000,
    setupCostFloor: 6000,
    rows: [{ key: 'a', label: 'Setup A', fee: 250, unitCount: 40, y1Revenue: 10000 }],
  });
  check('setup cost: does not stop the cut', r.status, 'zero-floor');
  check('setup cost: fee still reaches zero', r.rows[0].floorFee, 0);
  check('setup cost: the whole setup fee is cuttable', round2(r.maxReduction), 10000);
  check('setup cost: how far under its own cost that lands', round2(r.belowSetupCostBy), 6000);
  ok('setup cost: the year still clears', r.resultingCashFlow >= 0);
}

// Year 1 is what binds: only $2,000 of headroom, so that is the whole cut,
// whatever Setup costs.
{
  const r = solveSetupFeeFloor({
    y1Cost: 98000,
    fixedY1Revenue: 90000,
    setupCostFloor: 6000,
    rows: [{ key: 'a', label: 'Setup A', fee: 250, unitCount: 40, y1Revenue: 10000 }],
  });
  check('year binds: status', r.status, 'ok');
  check('year binds: cash flow is the constraint', r.bindingConstraint, 'cashFlow');
  check('year binds: only the headroom comes off', round2(r.maxReduction), 2000);
  check('year binds: fee', r.rows[0].floorFee, 200);
  ok('year binds: year still clears', r.resultingCashFlow >= 0);
  check('year binds: floor is still above the setup cost', r.belowSetupCostBy, 0);
}

// Setup fees already below what Setup costs: that is worth reporting, but the
// year has headroom, so there is still room to discount.
{
  const r = solveSetupFeeFloor({
    y1Cost: 20000,
    fixedY1Revenue: 90000,
    setupCostFloor: 14000,
    rows: [{ key: 'a', label: 'Setup A', fee: 250, unitCount: 40, y1Revenue: 10000 }],
  });
  check('under cost already: still cuttable', r.status, 'zero-floor');
  check('under cost already: reported before the cut', round2(r.belowSetupCostBy), 14000);
}

// Pass-through Setup fees pay part of the setup cost, so the shortfall
// reported against the reducible rows nets them off.
{
  const r = solveSetupFeeFloor({
    y1Cost: 20000,
    fixedY1Revenue: 90000,
    setupCostFloor: 9000,
    heldSetupY1Revenue: 4000,
    rows: [{ key: 'a', label: 'Setup A', fee: 250, unitCount: 40, y1Revenue: 10000 }],
  });
  check('held setup: reported floor drops by what is held', round2(r.reducibleFloor), 5000);
  check('held setup: fee still reaches zero', r.rows[0].floorFee, 0);
  check('held setup: shortfall is net of it', round2(r.belowSetupCostBy), 5000);
}

// No setup cost given at all: nothing to report, same answer.
{
  const r = solveSetupFeeFloor({
    y1Cost: 20000,
    fixedY1Revenue: 90000,
    rows: [{ key: 'a', label: 'Setup A', fee: 250, unitCount: 40, y1Revenue: 10000 }],
  });
  check('no setup cost: still a zero floor', r.status, 'zero-floor');
  check('no setup cost: nothing to report', r.belowSetupCostBy, 0);
}

// The reported deal: $458,698 of Year-1 fees against $272,321 of Year-1 cost,
// with $132,767.48 of that fee being Setup. The headroom covers the whole
// Setup fee, so it can go to zero and the year still clears.
{
  const r = solveSetupFeeFloor({
    y1Cost: 272320.52,
    fixedY1Revenue: 458698 - 132767.48,
    setupCostFloor: 73022.11,
    rows: [{ key: 'a', label: 'Setup', fee: 132767.48, unitCount: 1, y1Revenue: 132767.48 }],
  });
  check('reported deal: setup can go to zero', r.status, 'zero-floor');
  check('reported deal: the whole setup fee', round2(r.maxReduction), 132767.48);
  check('reported deal: year still nets', round2(r.resultingCashFlow), 53610);
}

// ── Already under water ───────────────────────────────────────────────────
// Cutting setup fees makes this worse, not better. Report the gap and offer
// no discount at all.
{
  const r = solveSetupFeeFloor({
    y1Cost: 150000,
    fixedY1Revenue: 60000,
    rows: [{ key: 'a', label: 'Setup A', fee: 500, unitCount: 100, y1Revenue: 50000 }],
  });
  check('negative: status', r.status, 'already-negative');
  check('negative: shortfall', r.shortfall, 40000);
  check('negative: nothing to give away', r.maxReduction, 0);
  check('negative: fees stay put', r.rows[0].floorFee, 500);
}

// ── Rows that buy no headroom ─────────────────────────────────────────────
// A setup fee starting in Year 2 bills nothing in Year 1, so discounting it
// changes nothing about Year 1 — it must not be scaled and must not soak up
// part of the cut.
{
  const r = solveSetupFeeFloor({
    y1Cost: 50000,
    fixedY1Revenue: 60000,
    rows: [
      { key: 'y1', label: 'Bills in Y1', fee: 200, unitCount: 100, y1Revenue: 20000 },
      { key: 'y2', label: 'Starts month 14', fee: 900, unitCount: 10, y1Revenue: 0 },
    ],
  });
  check('out-of-year: dropped from the solve', r.rows.map(x => x.key), ['y1']);
  check('out-of-year: cut is capped at what bills in Y1', round2(r.maxReduction), 20000);
  check('out-of-year: only in-year revenue is reducible', r.setupY1Revenue, 20000);
  check('out-of-year: whole in-year fee can go', r.rows[0].floorFee, 0);
}

// ── Nothing to work with ──────────────────────────────────────────────────
{
  const r = solveSetupFeeFloor({ y1Cost: 10000, fixedY1Revenue: 30000, rows: [] });
  check('empty: status', r.status, 'nothing-to-reduce');
  check('empty: cash flow reported unchanged', r.resultingCashFlow, 20000);
}
{
  const r = solveSetupFeeFloor({
    y1Cost: 10000,
    fixedY1Revenue: 30000,
    rows: [{ key: 'a', label: 'Unpriced', fee: 0, unitCount: 10, y1Revenue: 0 }],
  });
  check('unpriced rows ignored', r.status, 'nothing-to-reduce');
}
{
  const r = solveSetupFeeFloor();
  check('no input at all', r.status, 'nothing-to-reduce');
  check('no input: cash flow is zero', r.resultingCashFlow, 0);
}

// ── Break even exactly ────────────────────────────────────────────────────
// Zero headroom: the fees are already as low as they go.
{
  const r = solveSetupFeeFloor({
    y1Cost: 100000,
    fixedY1Revenue: 60000,
    rows: [{ key: 'a', label: 'Setup A', fee: 400, unitCount: 100, y1Revenue: 40000 }],
  });
  check('break even: status', r.status, 'ok');
  check('break even: no room', r.maxReduction, 0);
  check('break even: fee unchanged', r.rows[0].floorFee, 400);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

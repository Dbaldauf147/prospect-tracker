// Assertion tests for the Setup-fee floor — the lowest the Setup fees on a
// Pricing Option can go before Year 1 stops paying for itself. Plain Node, no
// test framework (the project has none). Run:
//   node scripts/setupFeeFloor.test.mjs
//
// This number gets quoted at a customer, so the properties worth pinning are
// the ones that would be believed if they were wrong: the floor must never
// land Year 1 under water NOR bill the Setup work below what it costs to
// deliver (rounding included — it is a minimum, so cents round UP), a row that
// bills outside Year 1 buys no headroom, and a deal already under water must
// not come back with a discount to give away.
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

// ── The Setup cost floor ──────────────────────────────────────────────────
// Same deal as above, but Setup costs $6,000 to deliver (tech depreciation
// included). Break-even alone would give the setup work away for free on the
// strength of the recurring stream; the cost floor stops the cut at $6,000.
{
  const r = solveSetupFeeFloor({
    y1Cost: 20000,
    fixedY1Revenue: 90000,
    setupCostFloor: 6000,
    rows: [{ key: 'a', label: 'Setup A', fee: 250, unitCount: 40, y1Revenue: 10000 }],
  });
  check('cost floor: not a zero floor any more', r.status, 'ok');
  check('cost floor: the cost is what binds', r.bindingConstraint, 'setupCost');
  check('cost floor: fee stops at cost / units', r.rows[0].floorFee, 150);
  check('cost floor: revenue stops at the cost', round2(r.floorSetupY1Revenue), 6000);
  check('cost floor: only the excess is cuttable', round2(r.maxReduction), 4000);
  ok('cost floor: never below the cost', r.floorSetupY1Revenue >= 6000);
}

// Year 1 is the tighter of the two bounds: only $2,000 of headroom against a
// $6,000 cost floor that would have allowed $4,000 off. Break-even wins.
{
  const r = solveSetupFeeFloor({
    y1Cost: 98000,
    fixedY1Revenue: 90000,
    setupCostFloor: 6000,
    rows: [{ key: 'a', label: 'Setup A', fee: 250, unitCount: 40, y1Revenue: 10000 }],
  });
  check('tighter bound: cash flow binds', r.bindingConstraint, 'cashFlow');
  check('tighter bound: only the headroom comes off', round2(r.maxReduction), 2000);
  check('tighter bound: fee', r.rows[0].floorFee, 200);
  ok('tighter bound: still above the cost floor', r.floorSetupY1Revenue >= 6000);
  ok('tighter bound: year still clears', r.resultingCashFlow >= 0);
}

// Setup fees already below what Setup costs: the year may be healthy, but the
// setup work is billing at a loss and there is nothing to give away.
{
  const r = solveSetupFeeFloor({
    y1Cost: 20000,
    fixedY1Revenue: 90000,
    setupCostFloor: 14000,
    rows: [{ key: 'a', label: 'Setup A', fee: 250, unitCount: 40, y1Revenue: 10000 }],
  });
  check('at cost floor: status', r.status, 'at-cost-floor');
  check('at cost floor: nothing to give away', r.maxReduction, 0);
  check('at cost floor: fee stays put', r.rows[0].floorFee, 250);
  check('at cost floor: how far under cost', r.belowCostBy, 4000);
}

// Pass-through Setup fees pay part of the cost, so the reducible rows are only
// asked for the remainder: $9,000 of cost, $4,000 already held, floor $5,000.
{
  const r = solveSetupFeeFloor({
    y1Cost: 20000,
    fixedY1Revenue: 90000,
    setupCostFloor: 9000,
    heldSetupY1Revenue: 4000,
    rows: [{ key: 'a', label: 'Setup A', fee: 250, unitCount: 40, y1Revenue: 10000 }],
  });
  check('held setup: floor drops by what is held', round2(r.reducibleFloor), 5000);
  check('held setup: fee', r.rows[0].floorFee, 125);
  check('held setup: cut', round2(r.maxReduction), 5000);
}

// A cost floor exactly at the current fees leaves no room, and the panel still
// reports a clean "already at the floor" rather than a negative cut.
{
  const r = solveSetupFeeFloor({
    y1Cost: 20000,
    fixedY1Revenue: 90000,
    setupCostFloor: 10000,
    rows: [{ key: 'a', label: 'Setup A', fee: 250, unitCount: 40, y1Revenue: 10000 }],
  });
  check('exactly at cost: status', r.status, 'at-cost-floor');
  check('exactly at cost: not under by anything', r.belowCostBy, 0);
  check('exactly at cost: no cut', r.maxReduction, 0);
}

// No cost floor given: the old break-even-only behaviour is untouched.
{
  const r = solveSetupFeeFloor({
    y1Cost: 20000,
    fixedY1Revenue: 90000,
    rows: [{ key: 'a', label: 'Setup A', fee: 250, unitCount: 40, y1Revenue: 10000 }],
  });
  check('no cost floor: still a zero floor', r.status, 'zero-floor');
  check('no cost floor: reducible floor is zero', r.reducibleFloor, 0);
}

// Rounding still goes UP against the cost floor — a floor fee that rounds down
// bills less than the cost it is meant to cover.
{
  const r = solveSetupFeeFloor({
    y1Cost: 1000,
    fixedY1Revenue: 90000,
    setupCostFloor: 9999,
    rows: [{ key: 'a', label: 'Odd', fee: 3, unitCount: 3333, y1Revenue: 9999.99 }],
  });
  ok('cost floor rounding: never bills under the cost', r.floorSetupY1Revenue >= 9999);
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

// Assertion tests for the Setup-fee floor — the lowest the Setup fees on a
// Pricing Option can go before Year 1 stops paying for itself. Plain Node, no
// test framework (the project has none). Run:
//   node scripts/setupFeeFloor.test.mjs
//
// This number gets quoted at a customer, so the properties worth pinning are
// the ones that would be believed if they were wrong: the floor must never
// land Year 1 under water (rounding included — it is a minimum, so cents round
// UP), a row that bills outside Year 1 buys no headroom, and a deal already
// under water must not come back with a discount to give away.
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

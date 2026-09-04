// Assertion tests for the "same margin, lower setup" proposal — moving money
// off the Setup fee and onto the recurring fees without changing what the
// term brings in. Plain Node, no test framework (the project has none). Run:
//   node scripts/setupFeeShift.test.mjs
//
// This proposal gets quoted at a customer, so the properties worth pinning are
// the ones nobody would re-check by hand: term revenue (and so term margin)
// must come back identical or a shade above — never below, which would be
// margin quietly given away — Year 1 must still cover its own cost, and the
// shift must stop at $0 of Setup fee rather than inventing a negative one.
import { proposeSetupShift } from '../src/utils/setupFeeShift.js';

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

const setup = (over = {}) => ({ key: 's', label: 'Setup', index: 0, fee: 100000, unitCount: 1, y1Revenue: 100000, termRevenue: 100000, ...over });
const rec = (over = {}) => ({ key: 'r', label: 'Program fee', index: 1, fee: 2500, unitCount: 1, y1Revenue: 30000, termRevenue: 90000, ...over });

// ── The Setup fee reaches zero ────────────────────────────────────────────
// Year 1 has room to spare, so the whole Setup fee moves onto the recurring.
{
  const r = proposeSetupShift({
    y1Cost: 60000,
    totalY1Revenue: 130000,
    totalTermRevenue: 190000,
    termCost: 100000,
    setupRows: [setup()],
    recurringRows: [rec()],
  });
  check('zero setup: status', r.status, 'ok');
  check('zero setup: the Setup fee reaches 0', r.rows[0].proposedFee, 0);
  check('zero setup: the whole fee moved', round2(r.shift), 100000);
  check('zero setup: what bounded it', r.bindingConstraint, 'zeroSetup');
  // 100k spread over 90k of recurring term revenue is a 111.1% lift.
  check('zero setup: recurring lifts by the shift over its term revenue',
    round2(r.liftPct), 111.11);
  check('zero setup: recurring fee', r.rows[1].proposedFee, 5277.78);
  ok('zero setup: term revenue is not given away', r.proposedTermRevenue >= r.currentTermRevenue - 0.01);
  ok('zero setup: margin holds', Math.abs(r.proposedMargin - r.currentMargin) < 1e-6);
  ok('zero setup: Year 1 still covers its cost', r.proposedY1CashFlow >= 0);
}

// ── Year 1 is what stops it ───────────────────────────────────────────────
// A third of the recurring bills in Year 1, so each dollar shifted costs the
// year 2/3 of a dollar: $30,000 of headroom carries a $45,000 shift, not
// $30,000 — the uplift pays part of its own way back.
{
  const r = proposeSetupShift({
    y1Cost: 100000,
    totalY1Revenue: 130000,
    totalTermRevenue: 190000,
    termCost: 100000,
    setupRows: [setup()],
    recurringRows: [rec()],
  });
  check('year binds: what bounded it', r.bindingConstraint, 'cashFlow');
  check('year binds: shift is headroom ÷ (1 − k)', round2(r.shift), 45000);
  check('year binds: Setup fee left standing', r.rows[0].proposedFee, 55000);
  check('year binds: Year 1 lands exactly on its cost', round2(r.proposedY1CashFlow), 0);
  ok('year binds: never under it', r.proposedY1CashFlow >= 0);
  ok('year binds: margin holds', Math.abs(r.proposedMargin - r.currentMargin) < 1e-6);
}

// ── Every recurring row moves by the same percentage ──────────────────────
{
  const r = proposeSetupShift({
    y1Cost: 60000,
    totalY1Revenue: 160000,
    totalTermRevenue: 280000,
    setupRows: [setup()],
    recurringRows: [
      rec({ key: 'r1', index: 1, fee: 2500, y1Revenue: 30000, termRevenue: 90000 }),
      rec({ key: 'r2', index: 2, fee: 250, y1Revenue: 30000, termRevenue: 90000 }),
    ],
  });
  const lift = r.recurringLift;
  check('same percentage: big row', r.rows[1].proposedFee, Math.ceil(2500 * lift * 100 - 1e-6) / 100);
  check('same percentage: small row', r.rows[2].proposedFee, Math.ceil(250 * lift * 100 - 1e-6) / 100);
  ok('same percentage: both above their old fee', r.rows[1].proposedFee > 2500 && r.rows[2].proposedFee > 250);
}

// Two Setup rows come down by the same percentage too.
{
  const r = proposeSetupShift({
    y1Cost: 100000,
    totalY1Revenue: 130000,
    totalTermRevenue: 190000,
    setupRows: [
      setup({ key: 's1', index: 0, fee: 500, unitCount: 100, y1Revenue: 50000, termRevenue: 50000 }),
      setup({ key: 's2', index: 1, fee: 50000, unitCount: 1, y1Revenue: 50000, termRevenue: 50000 }),
    ],
    recurringRows: [rec({ index: 2 })],
  });
  check('two setup rows: both keep 55%', r.rows.slice(0, 2).map(x => x.proposedFee), [275, 27500]);
}

// ── Rounding goes up, never down ──────────────────────────────────────────
// A lift landing mid-cent must round the recurring fee UP: down gives back a
// slice of the margin the whole proposal exists to keep.
{
  const r = proposeSetupShift({
    y1Cost: 1000,
    totalY1Revenue: 130000,
    totalTermRevenue: 190000,
    termCost: 100000,
    setupRows: [setup()],
    recurringRows: [rec({ fee: 3.33, unitCount: 27027, termRevenue: 90000 })],
  });
  ok('rounding: recurring fee rounds up', r.rows[1].proposedFee >= 3.33 * r.recurringLift);
  ok('rounding: term revenue never lands under', r.proposedTermRevenue >= r.currentTermRevenue);
}

// ── Nothing to propose ────────────────────────────────────────────────────
{
  const r = proposeSetupShift({
    y1Cost: 60000, totalY1Revenue: 130000, totalTermRevenue: 190000,
    setupRows: [], recurringRows: [rec()],
  });
  check('no setup fee to move', r.status, 'no-setup');
  check('no setup fee: nothing moves', r.shift, 0);
}
{
  const r = proposeSetupShift({
    y1Cost: 60000, totalY1Revenue: 130000, totalTermRevenue: 190000,
    setupRows: [setup()], recurringRows: [],
  });
  check('nothing to carry it', r.status, 'no-recurring');
}
{
  const r = proposeSetupShift({
    y1Cost: 200000, totalY1Revenue: 130000, totalTermRevenue: 190000,
    setupRows: [setup()], recurringRows: [rec()],
  });
  check('already under water: status', r.status, 'already-negative');
  check('already under water: the gap', r.shortfall, 70000);
  check('already under water: nothing moves', r.shift, 0);
}
{
  // Zero headroom: the year is exactly on its cost, so no dollar can move.
  const r = proposeSetupShift({
    y1Cost: 130000, totalY1Revenue: 130000, totalTermRevenue: 190000,
    setupRows: [setup()], recurringRows: [rec()],
  });
  check('no headroom: nothing to move', r.status, 'no-room');
}
{
  const r = proposeSetupShift();
  check('no input at all', r.status, 'no-setup');
}

// A row billing nothing in Year 1, or carrying no fee, is not part of the
// trade — it can't fund a discount it doesn't bill.
{
  const r = proposeSetupShift({
    y1Cost: 60000, totalY1Revenue: 130000, totalTermRevenue: 190000,
    setupRows: [setup({ y1Revenue: 0 })], recurringRows: [rec()],
  });
  check('setup billing nothing in Y1 is out', r.status, 'no-setup');
}
{
  const r = proposeSetupShift({
    y1Cost: 60000, totalY1Revenue: 130000, totalTermRevenue: 190000,
    setupRows: [setup()], recurringRows: [rec({ fee: 0 })],
  });
  check('an unpriced recurring row cannot carry it', r.status, 'no-recurring');
}

// ── A 12-month term: the shift is Year-1 neutral ──────────────────────────
// All of the recurring bills inside Year 1, so moving money onto it costs the
// year nothing and the Setup fee can go to zero however tight Year 1 is.
{
  const r = proposeSetupShift({
    y1Cost: 129000,
    totalY1Revenue: 130000,
    totalTermRevenue: 130000,
    setupRows: [setup()],
    recurringRows: [rec({ y1Revenue: 30000, termRevenue: 30000 })],
  });
  check('12-month term: setup still reaches zero', r.rows[0].proposedFee, 0);
  ok('12-month term: year still covers its cost', r.proposedY1CashFlow >= 0);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

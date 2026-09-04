// The other half of "how low can Setup fees go?" — where the money goes
// instead.
//
// The floor answers how far the Setup fee can be cut before Year 1 stops
// covering its own cost. On a call that answer immediately raises the next
// question: the customer wants a smaller cheque up front, and giving it to
// them straight off the Setup fee hands away the margin with it. The deal
// that keeps the margin moves the money rather than dropping it — less
// upfront, more per month.
//
// The rule that makes it a fair trade is that TERM REVENUE DOESN'T CHANGE.
// Every dollar taken off the Setup fee is added back across the recurring
// fees over the term, so:
//
//   term revenue after = term revenue before  →  term margin is identical.
//
// Because the recurring rows absorb it in proportion to what each already
// bills over the term, every recurring fee moves by the SAME percentage —
// one number to explain, and no row singled out.
//
// Two things bound how much can move:
//
//   The Setup fee itself. It cannot go below $0.
//
//   Year 1. Setup bills in Year 1 in full; the recurring uplift only bills a
//   year's worth of it. So each dollar shifted costs Year 1 (1 − k) dollars,
//   where k is the share of recurring revenue that lands in Year 1 — about a
//   third of the term on a 36-month deal. Year 1 still has to cover its own
//   cost, which caps the shift at headroom ÷ (1 − k). Note that this is MORE
//   than the plain headroom: the uplift pays part of its own way back.
//
// Pass-through rows are left out of both sides. They bill at face cost, so
// moving money onto or off them changes margin rather than shape.
//
// Rounding goes UP on both sides, the same direction the floor rounds: a
// half-cent given away on the Setup fee lands Year 1 under its cost, and one
// given away on a recurring fee gives back margin the shift is meant to keep.

// Round up to whole cents. The epsilon keeps a value already on a cent
// boundary from ticking up one.
function ceilCents(n) {
  const v = Math.ceil(n * 100 - 1e-6) / 100;
  return v === 0 ? 0 : v;
}

/**
 * Propose a fee structure that cuts the Setup fees as far as they can go
 * while holding term revenue — and so term margin — exactly where it is.
 *
 * @param {object} input
 * @param {number} input.y1Cost           Year-1 cost, all of it, incl. tech depr.
 * @param {number} input.totalY1Revenue   Year-1 revenue of the whole schedule.
 * @param {number} input.totalTermRevenue Term revenue of the whole schedule.
 *                                        Rows this doesn't move stay in both
 *                                        totals untouched, so nothing has to
 *                                        be classified twice.
 * @param {number} input.termCost         Term cost, for reporting the margin.
 *                                        Optional.
 * @param {Array}  input.setupRows        Reducible Setup rows:
 *                                        { key, label, index, fee, unitCount,
 *                                          y1Revenue, termRevenue }
 * @param {Array}  input.recurringRows    Recurring rows that can absorb it,
 *                                        same shape.
 * @returns {object} status, per-row proposals, and the totals behind them.
 */
export function proposeSetupShift({
  y1Cost = 0,
  totalY1Revenue = 0,
  totalTermRevenue = 0,
  termCost = 0,
  setupRows = [],
  recurringRows = [],
} = {}) {
  const usableSetup = setupRows.filter(r =>
    Number.isFinite(r?.fee) && r.fee > 0 &&
    Number.isFinite(r?.y1Revenue) && r.y1Revenue > 0);
  const usableRecurring = recurringRows.filter(r =>
    Number.isFinite(r?.fee) && r.fee > 0 &&
    Number.isFinite(r?.termRevenue) && r.termRevenue > 0);

  const setupY1 = usableSetup.reduce((s, r) => s + r.y1Revenue, 0);
  const recY1 = usableRecurring.reduce((s, r) => s + (r.y1Revenue || 0), 0);
  const recTerm = usableRecurring.reduce((s, r) => s + r.termRevenue, 0);

  const currentY1Revenue = totalY1Revenue;
  const currentTermRevenue = totalTermRevenue;
  const headroom = currentY1Revenue - y1Cost;
  const marginOf = (rev) => (rev > 0 && termCost > 0) ? (rev - termCost) / rev : null;

  const base = {
    setupY1,
    recTerm,
    currentY1Revenue,
    currentTermRevenue,
    headroom,
    shift: 0,
    setupScale: 1,
    recurringLift: 1,
    liftPct: 0,
    bindingConstraint: 'none',
    rows: [],
    proposedY1Revenue: currentY1Revenue,
    proposedTermRevenue: currentTermRevenue,
    currentMargin: marginOf(currentTermRevenue),
    proposedMargin: marginOf(currentTermRevenue),
  };

  if (usableSetup.length === 0) return { ...base, status: 'no-setup' };
  if (usableRecurring.length === 0) return { ...base, status: 'no-recurring' };
  if (headroom < 0) return { ...base, status: 'already-negative', shortfall: -headroom };

  // Each dollar off Setup costs Year 1 (1 − k) dollars, k being the share of
  // recurring revenue that bills inside Year 1.
  const k = recTerm > 0 ? recY1 / recTerm : 0;
  const y1Cap = k >= 1 ? Infinity : headroom / (1 - k);
  const shift = Math.max(0, Math.min(setupY1, y1Cap));
  if (shift <= 0) return { ...base, status: 'no-room' };

  const bindingConstraint = shift >= setupY1 ? 'zeroSetup' : 'cashFlow';
  const setupScale = (setupY1 - shift) / setupY1;
  const recurringLift = 1 + shift / recTerm;

  const scaleRow = (r, factor, kind) => {
    const proposedFee = ceilCents(r.fee * factor);
    const ratio = proposedFee / r.fee;
    return {
      ...r,
      kind,
      proposedFee,
      proposedY1Revenue: (r.y1Revenue || 0) * ratio,
      proposedTermRevenue: (r.termRevenue ?? r.y1Revenue ?? 0) * ratio,
    };
  };
  const rows = [
    ...usableSetup.map(r => scaleRow(r, setupScale, 'setup')),
    ...usableRecurring.map(r => scaleRow(r, recurringLift, 'recurring')),
  ];

  // Only the rows that moved change the totals; everything else the schedule
  // bills is already in them.
  const proposedY1Revenue = currentY1Revenue
    + rows.reduce((s, r) => s + (r.proposedY1Revenue - (r.y1Revenue || 0)), 0);
  const proposedTermRevenue = currentTermRevenue
    + rows.reduce((s, r) => s + (r.proposedTermRevenue - (r.termRevenue ?? r.y1Revenue ?? 0)), 0);
  const proposedSetupY1 = rows.reduce((s, r) => r.kind === 'setup' ? s + r.proposedY1Revenue : s, 0);

  return {
    ...base,
    status: 'ok',
    shift: setupY1 - proposedSetupY1,
    setupScale,
    recurringLift,
    liftPct: (recurringLift - 1) * 100,
    bindingConstraint,
    rows,
    proposedSetupY1,
    proposedY1Revenue,
    proposedTermRevenue,
    proposedY1CashFlow: proposedY1Revenue - y1Cost,
    proposedMargin: marginOf(proposedTermRevenue),
  };
}

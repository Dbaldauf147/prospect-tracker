// How far the Setup fees on a Pricing Option can be cut before Year 1 stops
// paying for itself.
//
// The Pricing page already flags a negative Year-1 cash flow after the fact:
// you type a fee, and the red banner tells you the year is under water. The
// question that actually gets asked in a negotiation is the other direction —
// "how much can I give away on the setup fee and still not fund this deal out
// of pocket?" That is one subtraction (Year-1 revenue minus Year-1 cost) and
// then a division back across the setup rows, but doing it by hand against a
// schedule of eight rows with auto-derived fees is where the discount ends up
// guessed at.
//
// The model:
//
//   Headroom. Year-1 cash flow at today's numbers. Every dollar of it can come
//   off the setup fees and the year still breaks even at exactly $0. Nothing
//   else on the page moves — costs, recurring fees and one-time fees are taken
//   as given, because those are not what is being discounted.
//
//   Cost floor. The setup fees are not allowed below what setup actually costs
//   to deliver, tech depreciation included — the "Setup" row of Totals by type.
//   Year-1 break-even alone would happily give the setup work away for free and
//   let the recurring stream carry it, which is a real number but not one worth
//   quoting: it books the delivery at a loss and hides that inside a healthy
//   looking year. Whichever of the two constraints binds first is the floor.
//   Setup fee revenue held outside the cut (pass-through setup rows) counts
//   toward covering that cost, so it is not asked for twice.
//
//   Reducible rows. Only Setup rows that actually bill inside Year 1. A Setup
//   fee starting in month 14 contributes nothing to Year-1 revenue, so cutting
//   it buys no headroom and it is left alone. Pass-through rows are left alone
//   too: they bill at face cost, so a dollar off the fee is a dollar straight
//   out of margin rather than out of slack.
//
//   Proportional. The cut is spread across the reducible rows in proportion to
//   what each one bills, so a $50k row and a $5k row give up the same
//   percentage. Any split summing to the same total holds the year at break
//   even; proportional is the one that needs no further input.
//
// The floor is a floor, not a recommendation — at it the setup work bills at
// exactly its own cost, or the year nets exactly zero, whichever bound is
// reached first. Neither leaves anything for the cost of carrying the deal. It
// answers "how low CAN I go", which is the question asked.
//
// Per-unit fees round UP to the cent. The solved fee is a floor — a minimum —
// so shaving it further is the one rounding direction that lands the year
// under water, by exactly the cents given away across every unit.

// Round up to whole cents, so a scaled fee never falls below its own floor.
// The epsilon keeps a value already on a cent boundary from ticking up one.
function ceilCents(n) {
  const v = Math.ceil(n * 100 - 1e-6) / 100;
  // Math.ceil(-1e-6) is -0, which formats as "-$0.00" on a fee that is simply
  // free. Normalize it back to plain zero.
  return v === 0 ? 0 : v;
}

// Which Alt Fee rows this treats as setup. The schedule's Type dropdown
// offers Setup / One Time / Recurring (monthly); only Setup is in scope —
// One Time fees are a separate charge the user did not ask to discount.
export function isSetupFeeType(type) {
  return /^\s*setup\s*$/i.test(String(type || ''));
}

/**
 * Solve for the lowest Setup fees that keep Year-1 cash flow at or above zero
 * AND keep the Setup fees at or above what Setup costs to deliver.
 *
 * @param {object} input
 * @param {number} input.y1Cost          Year-1 cost, all of it.
 * @param {number} input.fixedY1Revenue  Year-1 revenue from everything that is
 *                                       NOT being cut (recurring, one-time,
 *                                       pass-through and out-of-year setup).
 * @param {number} input.setupCostFloor  Setup cost including tech depreciation
 *                                       — the "Total cost (incl. tech depr)"
 *                                       on the Setup row of Totals by type.
 *                                       The Setup fees may not go below it.
 *                                       Omitted / 0 means break-even only.
 * @param {number} input.heldSetupY1Revenue
 *                                       Year-1 Setup fee revenue that is NOT
 *                                       reducible (pass-through setup rows).
 *                                       It already covers part of the setup
 *                                       cost, so the cost floor asked of the
 *                                       reducible rows drops by it.
 * @param {Array} input.rows             Reducible setup rows:
 *                                       { key, label, fee, unitCount, y1Revenue }
 *                                       `fee` is the effective per-unit fee
 *                                       (manual, or auto-derived from linked
 *                                       costs) and `y1Revenue` what the row
 *                                       bills in Year 1.
 * @returns {object} status + the totals and per-row floors behind it.
 */
export function solveSetupFeeFloor({
  y1Cost = 0,
  fixedY1Revenue = 0,
  setupCostFloor = 0,
  heldSetupY1Revenue = 0,
  rows = [],
} = {}) {
  const usable = rows.filter(r =>
    Number.isFinite(r?.fee) && r.fee > 0 &&
    Number.isFinite(r?.y1Revenue) && r.y1Revenue > 0);

  const setupY1Revenue = usable.reduce((s, r) => s + r.y1Revenue, 0);
  const currentY1Revenue = fixedY1Revenue + setupY1Revenue;
  const currentCashFlow = currentY1Revenue - y1Cost;

  // What the reducible rows have to keep billing to cover the setup cost.
  // Pass-through setup fees already pay for part of it, so only the remainder
  // is asked of the rows being cut. A fee can never go below zero either, so
  // that is the other bound on the floor.
  const costFloor = Math.max(0, Number(setupCostFloor) || 0);
  const heldSetup = Math.max(0, Number(heldSetupY1Revenue) || 0);
  const reducibleFloor = Math.max(0, costFloor - heldSetup);

  const base = {
    y1Cost,
    fixedY1Revenue,
    setupY1Revenue,
    currentY1Revenue,
    currentCashFlow,
    setupCostFloor: costFloor,
    heldSetupY1Revenue: heldSetup,
    reducibleFloor,
    bindingConstraint: 'none',
    rows: usable.map(r => ({ ...r, floorFee: r.fee, floorY1Revenue: r.y1Revenue, reduction: 0 })),
    maxReduction: 0,
    floorSetupY1Revenue: setupY1Revenue,
    resultingCashFlow: currentCashFlow,
    scale: 1,
  };

  // Already under water: the setup fees are not the lever — they would have to
  // go UP (or cost come out) to reach break even. Report the gap instead.
  if (currentCashFlow < 0) {
    return { ...base, status: 'already-negative', shortfall: -currentCashFlow };
  }
  // Nothing billing in Year 1 to cut. Year 1 is fine, it just isn't setup fees
  // holding it up.
  if (usable.length === 0) {
    return { ...base, status: 'nothing-to-reduce' };
  }
  // The setup fees are already at or under what setup costs to deliver. The
  // year may still be healthy on the recurring stream, but the setup work is
  // not paying for itself and there is nothing here to give away.
  if (costFloor > 0 && setupY1Revenue <= reducibleFloor) {
    return {
      ...base,
      status: 'at-cost-floor',
      bindingConstraint: 'setupCost',
      belowCostBy: reducibleFloor - setupY1Revenue,
    };
  }

  // Room to the cost floor, and room to break even. The cut is whichever runs
  // out first.
  const roomToCostFloor = setupY1Revenue - reducibleFloor;
  const bindingConstraint = roomToCostFloor < currentCashFlow ? 'setupCost' : 'cashFlow';
  const maxReduction = Math.min(currentCashFlow, roomToCostFloor);
  const scale = setupY1Revenue > 0 ? (setupY1Revenue - maxReduction) / setupY1Revenue : 0;

  const solved = usable.map(r => {
    const floorFee = ceilCents(r.fee * scale);
    // Revenue moves with the fee, whatever the row's unit count and billing
    // shape — deriving it from the ratio keeps this honest for any row whose
    // Year-1 revenue isn't simply fee × units.
    const floorY1Revenue = r.y1Revenue * (floorFee / r.fee);
    return { ...r, floorFee, floorY1Revenue, reduction: r.y1Revenue - floorY1Revenue };
  });

  const floorSetupY1Revenue = solved.reduce((s, r) => s + r.floorY1Revenue, 0);

  return {
    ...base,
    // "zero-floor" is only honest when the fees really can reach $0 — with a
    // cost floor in play they stop at it instead, however much headroom is left.
    status: (reducibleFloor <= 0 && maxReduction >= setupY1Revenue) ? 'zero-floor' : 'ok',
    bindingConstraint,
    rows: solved,
    scale,
    maxReduction: setupY1Revenue - floorSetupY1Revenue,
    floorSetupY1Revenue,
    resultingCashFlow: fixedY1Revenue + floorSetupY1Revenue - y1Cost,
  };
}

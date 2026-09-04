// Pricing a recurring Alternative Fee row so its TERM margin lands on the
// target GM%, not just its first year.
//
// A recurring fee and the costs behind it escalate on different clocks: the
// fee rises by the annual escalator (3% by default), the supplier cost by
// the cost escalator (3.85%, because supplier cost creeps faster than what
// we can raise). Deriving the fee as "year-1 cost marked up to target"
// therefore hits the target in year 1 and drifts below it every year after
// — on a 36-month term at those defaults, a 45% target shows 44.5%, which
// is real margin the deal never earns.
//
// So the fee is derived from what the whole term has to bring in instead:
//
//   term revenue needed = Σ over the linked cost rows of their marked-up
//                         price projected the way that cost actually
//                         behaves — a monthly cost escalated at the cost
//                         escalator, an upfront (Rolled) cost booked once.
//   fee per unit        = that ÷ (the term's escalated month count × units)
//
// Both sides are full-term and ignore start month, which is what the Fee
// GM% column compares, so the fee it derives reads back as exactly the
// target.
//
// Setup / One Time rows need none of this: neither their fee nor their cost
// escalates, so marking the cost up already lands on target.

// The escalated month count of a term: what one unit of monthly fee bills
// over `months`, with the escalator applied to each successive 12-month
// band. 36 months at 3% is 37.09, not 36 — the same projection the margin
// calc runs, kept here so the fee derives against the number it's measured
// by. Zero escalator gives back the plain month count.
export function termMonthFactor(escPct, months) {
  if (!months || months <= 0) return 0;
  const esc = typeof escPct === 'number' && Number.isFinite(escPct) ? escPct : 0;
  let total = 0;
  let remaining = months;
  let mult = 1;
  while (remaining > 0) {
    const band = Math.min(12, remaining);
    total += mult * band;
    remaining -= band;
    mult *= (1 + esc);
  }
  return total;
}

// Per-unit monthly fee for a recurring row.
//
//   recurringMonthlyPrice  Σ marked-up price of the linked Recurring
//                          (monthly) cost rows — a monthly figure, and one
//                          that escalates at the COST escalator over the
//                          term because that is what the cost does.
//   rolledUpfrontPrice     Σ marked-up price of the linked Rolled rows.
//                          The cost lands once, upfront; only the billing
//                          is spread across the term, so the term has to
//                          recover it exactly once.
//
// Returns null when there is nothing to price against — same as deriving no
// fee at all, which reads as "nothing linked yet" rather than a fee of 0.
export function recurringFeePerUnit({
  recurringMonthlyPrice = 0,
  rolledUpfrontPrice = 0,
  annualEscalator = 0,
  costEscalator = 0,
  termMonths = 0,
  unitCount = 1,
} = {}) {
  const uc = Number(unitCount);
  if (!Number.isFinite(uc) || uc <= 0) return null;
  const feeMonths = termMonthFactor(annualEscalator, termMonths);
  if (feeMonths <= 0) return null;
  const termRevenueNeeded =
    recurringMonthlyPrice * termMonthFactor(costEscalator, termMonths) + rolledUpfrontPrice;
  if (!Number.isFinite(termRevenueNeeded) || termRevenueNeeded <= 0) return null;
  return termRevenueNeeded / (feeMonths * uc);
}

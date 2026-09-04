// Pricing a recurring Alternative Fee row so its TERM margin lands on the
// target GM% — over the months it actually bills, against the cost those
// months have to carry.
//
// Two clocks pull a recurring fee off target, and both are invisible in the
// year it's quoted:
//
//   Escalators. The fee rises by the annual escalator (3% by default), the
//   supplier cost by the cost escalator (3.85%, because supplier cost creeps
//   faster than what we can raise). A fee derived from year-1 cost is on
//   target the day it's quoted and under it every year after.
//
//   Start months. A fee that starts in month 4 bills 33 months of a 36-month
//   term, while the cost behind it has been running since month 1. Those
//   three months are real cost with no fee against them.
//
// So the fee is derived from what the whole term has to bring in:
//
//   term revenue needed = Σ over the linked cost rows of their marked-up
//                         price projected the way that cost actually
//                         behaves — a monthly cost escalated at the cost
//                         escalator from ITS start month, an upfront
//                         (Rolled) cost booked once.
//   fee per unit        = that ÷ (the months the fee bills, escalated × units)
//
// Both sides are the same projection the Fee GM% column and the Deal margin
// row measure, so a fee derived here reads back as exactly the target in
// both places.
//
// Setup / One Time rows need none of this: neither their fee nor their cost
// escalates, so marking the cost up already lands on target.

// The escalated month count a monthly line bills over a term: months from
// `startMonth` through `months`, with the escalator applied to each
// successive 12-month band. 36 months at 3% from month 1 is 37.09, not 36;
// from month 4 it's 34.00. Mirrors the per-year projection the page renders
// from, so the fee derives against the number it's measured by.
export function billedMonthFactor(escPct, months, startMonth = 1) {
  if (!months || months <= 0) return 0;
  const esc = typeof escPct === 'number' && Number.isFinite(escPct) ? escPct : 0;
  const start = Math.max(1, Math.round(Number(startMonth) || 1));
  if (start > months) return 0;
  const numYears = Math.max(1, Math.ceil(months / 12));
  let total = 0;
  for (let y = 1; y <= numYears; y++) {
    const billStart = Math.max((y - 1) * 12 + 1, start);
    const billEnd = Math.min(y * 12, months);
    if (billEnd < billStart) continue;
    total += (billEnd - billStart + 1) * Math.pow(1 + esc, y - 1);
  }
  return total;
}

// Per-unit monthly fee for a recurring row.
//
//   recurringCosts  the linked Recurring (monthly) cost rows, as
//                   { price, startMonth } — price is the row's marked-up
//                   MONTHLY price, and it escalates at the COST escalator
//                   from its own start month, because that is what the cost
//                   does.
//   rolledCosts     the linked Rolled rows, as { price, startMonth }. The
//                   cost lands once, upfront; only the billing is spread
//                   across the term, so the term recovers it exactly once.
//   feeStartMonth   the month this fee starts billing.
//
// Returns null when there is nothing to price against — same as deriving no
// fee at all, which reads as "nothing linked yet" rather than a fee of 0.
export function recurringFeePerUnit({
  recurringCosts = [],
  rolledCosts = [],
  feeStartMonth = 1,
  annualEscalator = 0,
  costEscalator = 0,
  termMonths = 0,
  unitCount = 1,
} = {}) {
  const uc = Number(unitCount);
  if (!Number.isFinite(uc) || uc <= 0) return null;
  const feeMonths = billedMonthFactor(annualEscalator, termMonths, feeStartMonth);
  if (feeMonths <= 0) return null;
  let termRevenueNeeded = 0;
  for (const c of recurringCosts) {
    const price = Number(c?.price);
    if (!Number.isFinite(price)) continue;
    termRevenueNeeded += price * billedMonthFactor(costEscalator, termMonths, c?.startMonth);
  }
  for (const c of rolledCosts) {
    const price = Number(c?.price);
    if (!Number.isFinite(price)) continue;
    const start = Math.max(1, Math.round(Number(c?.startMonth) || 1));
    if (start > termMonths) continue;
    termRevenueNeeded += price;
  }
  if (!Number.isFinite(termRevenueNeeded) || termRevenueNeeded <= 0) return null;
  return termRevenueNeeded / (feeMonths * uc);
}

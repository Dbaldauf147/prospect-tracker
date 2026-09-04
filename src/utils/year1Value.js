// What a priced line item bills the customer inside Year 1.
//
// The Totals by type table reads across three different bases and says so in
// its headers: Cost / Tech Depr / Marked-up are per period, "Term value" is
// the whole contract. Between them sits the number people actually quote —
// what year one costs the customer — and until now it had to be worked out
// from two other columns, differently per row. Setup is its face value,
// Recurring is twelve times a monthly figure, and a Rolled charge is neither.
//
// Three rules, and the third is the one worth writing down:
//
//   Recurring (monthly) bills every month, so Year 1 is twelve of them —
//   unescalated, because the escalator starts in Year 2.
//
//   Setup / One Time bill once, upfront, so Year 1 is the whole charge.
//
//   Setup Rolled / One Time Rolled bill upfront in the ledger and monthly on
//   the invoice: the charge is amortized across the term. A three-year rolled
//   setup puts a third of itself in Year 1, not all of it — reading it as the
//   full face value overstates year one by two thirds of the charge, on the
//   one row type where the whole point is that the customer doesn't pay it
//   all up front.
//
// A term shorter than a year truncates all of this: Year 1 can only ever bill
// what the term contains.

// Months of Year 1 the contract actually covers.
export function year1Months(termMonths) {
  const t = Number(termMonths);
  if (!Number.isFinite(t) || t <= 0) return 0;
  return Math.min(12, t);
}

/**
 * Year-1 value of one line item, at whatever price basis is passed in — the
 * marked-up price for revenue, the raw CTS for cost.
 *
 * `recurring` and `rolled` are the caller's own classification of the item's
 * Type, so this can't disagree with how the same row was bucketed elsewhere
 * in the table.
 *
 * @param {object} input
 * @param {number} input.price       Per-month figure for recurring rows, whole
 *                                   charge for everything else.
 * @param {number} input.termMonths  Contract length.
 * @param {boolean} input.recurring  Bills every month.
 * @param {boolean} input.rolled     Whole charge amortized across the term.
 * @returns {number}
 */
export function year1ValueFor({ price, termMonths, recurring = false, rolled = false } = {}) {
  const p = Number(price);
  if (!Number.isFinite(p)) return 0;
  const months = year1Months(termMonths);

  if (recurring) return p * months;
  if (rolled) {
    const t = Number(termMonths);
    // A rolled charge with no term to amortize over has nowhere to spread:
    // it falls back to billing in full, which is what a zero-month term
    // means everywhere else on the page.
    if (!Number.isFinite(t) || t <= 0) return p;
    return (p / t) * months;
  }
  return p;
}

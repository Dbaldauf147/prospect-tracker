// Why a market row on the Indicative Savings tab isn't showing a savings
// number.
//
// The tab tints those rows amber and leaves it at that, which reads as "this
// one is a dud" without saying which kind of dud — a market with no
// deregulated sites, one where every site is leased, one whose spend is too
// small to source, and one locked into supply contracts for the whole horizon
// all render as the same $0 row. The seller then has to reconstruct the reason
// from the surrounding columns.
//
// So every row carries one short, standardized status. The vocabulary is
// deliberately small and fixed (SAVINGS_STATUS below): the column is scanned
// down, not read, and two spellings of the same reason defeat that.
//
// Lives outside SitesView.jsx so the precedence can be asserted directly —
// see scripts/savingsStatus.test.mjs. Getting it wrong is quiet: the sheet
// still exports, it just explains a row with the wrong reason.

// The complete vocabulary. Anything the export writes into the Savings Status
// column is one of these.
export const SAVINGS_STATUS = {
  // Savings are projected on this row. The only non-reason in the set.
  ELIGIBLE: 'Eligible',
  // Retail choice exists but is gated — AZ / MI can only be served where the
  // customer already holds a third-party supply contract.
  LIMITED: 'Limited market',
  // Deregulated market, but nothing in this portfolio qualifies.
  NO_DEREG_SITES: 'No deregulated sites',
  // Deregulated sites, but no cost data on any of them to take a percentage of.
  NO_SPEND: 'No spend on file',
  // Every deregulated dollar here sits at a leased location, and the supply
  // contract behind a leased meter is usually the landlord's.
  NO_OWNED_SITES: 'No owned sites',
  // No committed savings percentage to apply — an international market the
  // reference table still carries as TBD, or a band that resolves to 0 %.
  NO_BAND: 'No savings band',
  // Spend and a band, but every site is under contract through the whole
  // 5-year horizon, so no month of it is free to re-source.
  UNDER_CONTRACT: 'Under contract',
  // Below the threshold where the motion is worth running: < $1M/yr of
  // deregulated electric spend, < $30K/yr of gas.
  SMALL_ELECTRIC: 'Small market (<$1M)',
  LOW_GAS: 'Spend too low (<$30K)',
  // The rolled-up line for the states filtered off the tab entirely.
  REGULATED: 'Regulated market',
};

// Deregulated electric spend below this is too small to run the sourcing
// motion on; mirrors the "small electric market" flag on the row.
export const SMALL_ELECTRIC_SPEND = 1_000_000;
// The gas equivalent.
export const LOW_GAS_SPEND = 30_000;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// A committed savings percentage to apply. Null on the markets the reference
// table carries as TBD; a 0 % top of band counts as none either, since a
// percentage that can't produce a dollar isn't a band.
function hasSavingsBand(row) {
  return row?.lowPct != null && row?.highPct != null && num(row.highPct) > 0;
}

// Does this row project any savings at all across the 5-year horizon?
//
// Three things have to hold: spend the savings can be taken off (leased
// locations are already out of `savingsEligibleSpend`), a committed savings
// band, and at least one month inside the horizon not covered by an existing
// supply contract — which is exactly what a non-zero Year 5 cumulative means,
// since the monthly vectors behind it are contract-gated.
export function hasProjectedSavings(row) {
  if (!row || row.isParent) return false;
  if (!(num(row.savingsEligibleSpend) > 0)) return false;
  if (!hasSavingsBand(row)) return false;
  const yr5 = row.year5;
  if (!yr5 || typeof yr5 !== 'object') return false;
  return num(yr5.high) > 0;
}

/**
 * The one-phrase reason this market row reads the way it does.
 *
 * Two questions, in order. Is anything projected here at all? If not, which
 * of the several things that could be missing is the most useful one to name
 * — a Limited market with nothing qualifying has no deregulated sites, no
 * spend and no eligible spend either, and only the first of those tells the
 * seller something. If savings ARE projected, the only thing left to say is
 * whether the market is big enough to be worth the motion.
 *
 * @param row        a state / country row off the savings table
 * @param commodity  'electric' | 'gas' — only changes which spend threshold
 *                   counts as too small
 * @returns one of SAVINGS_STATUS, or '' for rows that aren't markets
 *          (the United States / Canada aggregates)
 */
export function savingsStatusFor(row, commodity = 'electric') {
  // Parent aggregate rows roll up children that each carry their own status;
  // a status on the parent would be a summary of several different reasons.
  if (!row || row.isParent) return '';

  if (!hasProjectedSavings(row)) {
    // Gated markets first: AZ / MI can only be served where third-party
    // supply is already in place, which is the market-level fact behind
    // everything else being empty.
    if (row.status === 'Limited') return SAVINGS_STATUS.LIMITED;
    if (!(num(row.deregulatedSites) > 0)) return SAVINGS_STATUS.NO_DEREG_SITES;
    if (!(num(row.spend) > 0)) return SAVINGS_STATUS.NO_SPEND;
    // Spend exists but none of it is eligible — the difference is the leased
    // locations, which the export holds out of the savings basis.
    if (!(num(row.savingsEligibleSpend) > 0)) return SAVINGS_STATUS.NO_OWNED_SITES;
    if (!hasSavingsBand(row)) return SAVINGS_STATUS.NO_BAND;
    // Everything a projection needs is here, so what's left is timing: every
    // site is locked into supply through the whole horizon.
    return SAVINGS_STATUS.UNDER_CONTRACT;
  }

  // Savings ARE projected. A Limited market that got this far has deregulated
  // sites carrying spend — third-party supply is already in place, which is
  // exactly the condition its gating asks for — so it reads like any other
  // market from here.
  const spend = num(row.spend);
  if (commodity === 'gas') {
    if (spend < LOW_GAS_SPEND) return SAVINGS_STATUS.LOW_GAS;
  } else if (spend < SMALL_ELECTRIC_SPEND) {
    return SAVINGS_STATUS.SMALL_ELECTRIC;
  }
  return SAVINGS_STATUS.ELIGIBLE;
}

// Whether the row should carry the amber "nothing to pursue here" tint.
// Kept next to the status so the two can't drift: every row the sheet tints
// has a reason in the column, and every row with a reason is tinted.
export function isNoSavingsRow(row, commodity = 'electric') {
  const status = savingsStatusFor(row, commodity);
  return status !== '' && status !== SAVINGS_STATUS.ELIGIBLE;
}

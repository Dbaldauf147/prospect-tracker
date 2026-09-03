// Market-classification coverage — how much of a loaded portfolio the
// Master Analysis can actually place in a market, and whether the part it
// can't is big enough to change what the sheets say.
//
// Every "Deregulated Sites" figure the page and the exports print counts
// sites the market classifier returned 'Deregulated' for. A site it could
// not classify is neither deregulated nor regulated — it lands in the
// Unknown bucket and is silently absent from that column while still
// counting in Total Sites. Two very different portfolios then look alike:
// one with no competitive supply, and one whose upload simply never
// carried the utility data needed to tell.
//
// The classifier returns Unknown for exactly two reasons, and they have
// different fixes, so they're counted apart:
//
//   * no utility — the site IS in a competitive state, but has neither a
//     utility nor a supplier on file, so nothing says which side of that
//     market it sits on. Fixed by loading the utility rates file (zip →
//     utility) or mapping the upload's utility / supplier column.
//   * no place — no US/CA state and no recognized country, so there is no
//     market reference to read at all. Fixed in the geography columns.

// The commodities a site list is classified for, in the order the warning
// reads them out.
const COMMODITIES = [
  { key: 'electric', label: 'Electric' },
  { key: 'gas', label: 'Gas' },
];

// A gap has to be able to change the conclusion before it's worth a
// banner. Two conditions, both about materiality rather than perfection:
//
//   * at least as many unclassified sites as classified-deregulated ones
//     — below that the deregulated count is the story and the gap is a
//     footnote, and
//   * at least this share of the portfolio, so a handful of stragglers on
//     an otherwise clean upload doesn't train the user to dismiss it.
//
// A portfolio with no utility data at all — the case this was written for
// — clears both by a mile: 715 unknown against 1 deregulated.
export const MARKET_GAP_MIN_SHARE = 0.05;

// The per-commodity gap, or null when this commodity has nothing to warn
// about. `bucket` is one commodity's { deregulated, regulated, unknown,
// unknownNoUtility, unknownNoPlace } tally from the page's marketSummary.
export function commodityGap(bucket, total) {
  if (!bucket || !total) return null;
  const unknown = Number(bucket.unknown) || 0;
  if (unknown <= 0) return null;
  const deregulated = Number(bucket.deregulated) || 0;
  if (unknown < deregulated) return null;
  if (unknown / total < MARKET_GAP_MIN_SHARE) return null;
  return {
    unknown,
    deregulated,
    // The two shapes, defaulted so a caller that hasn't split them yet
    // still gets a total it can print.
    noUtility: Number(bucket.unknownNoUtility) || 0,
    noPlace: Number(bucket.unknownNoPlace) || 0,
    // Rounded, but never up to 100 while a single site is still
    // classified — "100%" beside a Deregulated Sites count of 1 reads as
    // a contradiction rather than a rounding.
    pct: unknown === total ? 100 : Math.min(99, Math.round((unknown / total) * 100)),
    all: unknown === total,
  };
}

/**
 * The whole warning, or null when neither commodity has a material gap.
 *
 *   { total, gaps: [{ key, label, unknown, deregulated, noUtility,
 *                     noPlace, pct, all }] }
 *
 * `total` is the loaded site count both commodities are measured against.
 */
export function marketCoverageWarning(summary) {
  const total = Number(summary?.total) || 0;
  if (!total) return null;
  const gaps = [];
  for (const c of COMMODITIES) {
    const gap = commodityGap(summary?.[c.key], total);
    if (gap) gaps.push({ ...c, ...gap });
  }
  return gaps.length ? { total, gaps } : null;
}

// A stable key for "this is the same gap as last time", so dismissing the
// banner hides it until the shape of the gap actually changes — a new
// upload, a utility file loaded, a re-mapped column.
export function marketWarningKey(warning) {
  if (!warning) return '';
  return `${warning.total}:${warning.gaps.map(g => `${g.key}=${g.unknown}/${g.noUtility}`).join(',')}`;
}

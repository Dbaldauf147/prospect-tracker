// Does what a service costs on the SIA, marked up, land inside the price
// range the Dropdowns › Services Pricing rate card quotes for it?
//
// Both sides are put on the same footing, the first year:
//   cost side   the service's cost lines on the option. A recurring CTS is
//               monthly (the same reading the rest of the Pricing page
//               gives it), so it counts twelve times; anything else is
//               one-time money and counts once. Pass-through lines are
//               billed at cost, never marked up, so they stay out.
//   card side   estimateServiceRange's first-year fee plus setup, low and
//               high, priced on the option's own site and account counts.
//
// Pure, so scripts/serviceRateCheck.test.mjs can hold it still.

import { estimateServiceRange, PRICING_BASES } from './servicePricing.js';

export const DEFAULT_MARKUP = 0.5;

export const RATE_CHECK = {
  WITHIN: 'within',
  BELOW: 'below',
  ABOVE: 'above',
  UNPRICED: 'unpriced',
  // Part of the rate card prices on a count the SIA doesn't carry (sites
  // w/ mandate, meters, a deal size), so the range reads low and can't be
  // judged against.
  INCOMPLETE: 'incomplete',
  NO_COST: 'noCost',
};

const isRecurringType = (t) => /^recurring/i.test(String(t || '').trim());

// The first-year cost of a set of cost lines, pass-through left out.
export function year1CostOf(items = []) {
  let cost = 0;
  let counted = 0;
  let passThrough = 0;
  for (const it of items) {
    if (typeof it?.cts !== 'number' || !Number.isFinite(it.cts)) continue;
    if (it.passThrough) { passThrough += 1; continue; }
    cost += isRecurringType(it.type) ? it.cts * 12 : it.cts;
    counted += 1;
  }
  return { cost, counted, passThrough };
}

/**
 * items    serviceDetailFor's cost lines ({ cts, type, passThrough })
 * entry    the service's rate card entry (pricingFor)
 * meta     the service's catalog metadata (Type, Years)
 * counts   { sites, accounts, ... } off the SIA option
 * markup   0.5 means cost × 1.5
 */
export function rateCardCheck({ items = [], entry = null, meta = null, counts = {}, markup = DEFAULT_MARKUP, bases = PRICING_BASES } = {}) {
  const { cost, counted, passThrough } = year1CostOf(items);
  const price = cost * (1 + markup);
  const est = entry ? estimateServiceRange({ entry, meta, counts, bases }) : null;
  const priced = !!est?.priced && !est.noFee;
  const low = priced ? (est.fee || 0) + (est.setup || 0) : null;
  const high = priced ? (est.feeHigh ?? est.fee ?? 0) + (est.setupHigh ?? est.setup ?? 0) : null;
  // Why the card came out at nothing, when it did: a count the SIA doesn't
  // carry, or a percentage with no deal to take it of.
  const notes = priced
    ? [...new Set([...(est.breakdown || []), ...(est.setupBreakdown || [])].map(b => b.note).filter(Boolean))]
    : [];

  const lines = priced ? [...(est.breakdown || []), ...(est.setupBreakdown || [])] : [];
  const missing = [...new Set(lines.filter(b => b.gap).map(b => (
    b.gap.kind === 'deal' ? 'deal size' : (b.gap.unitLabel || b.unitLabel || 'a count').toLowerCase()
  )))];

  let status;
  if (!priced) status = RATE_CHECK.UNPRICED;
  else if (missing.length) status = RATE_CHECK.INCOMPLETE;
  else if (counted === 0 || cost <= 0) status = RATE_CHECK.NO_COST;
  else if (price < Math.min(low, high)) status = RATE_CHECK.BELOW;
  else if (price > Math.max(low, high)) status = RATE_CHECK.ABOVE;
  else status = RATE_CHECK.WITHIN;

  return {
    status, cost, price, markup, low, high, notes, passThrough, missing,
    noFee: !!est?.noFee,
  };
}

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
  // The SIA carries a cost for a part of the fee model (a setup, say) that
  // the rate card doesn't charge for at all.
  NOT_ON_CARD: 'notOnCard',
};

const isRecurringType = (t) => /^recurring/i.test(String(t || '').trim());
// "Setup" and "Setup Rolled": standing the service up, whichever way the
// SIA spreads it.
const isSetupType = (t) => /^setup\b/i.test(String(t || '').trim());

// The parts a fee model has, in the order they read on a quote.
export const FEE_PARTS = [
  { key: 'setup', label: 'Setup' },
  { key: 'recurring', label: 'Ongoing' },
  { key: 'oneTime', label: 'One-time' },
];

const startOf = (it) => (Number(it?.startMonth) >= 1 ? Math.floor(Number(it.startMonth)) : 1);

// Which part of the fee model a cost line pays for.
function partOfCost(it) {
  if (isSetupType(it.type)) return 'setup';
  if (isRecurringType(it.type)) return 'recurring';
  return 'oneTime';
}

// The first-year cost of a set of cost lines, pass-through left out, split
// by part. Only months 1 to 12 count: a recurring line starting in month 4
// pays nine of them, and a cost landing in month 13 or later is a year 2
// cost. `runRate` is the recurring lines' full year (monthly × 12), which
// is how an annual per-unit rate is quoted.
export function year1CostOf(items = []) {
  const parts = { setup: 0, recurring: 0, oneTime: 0 };
  const lines = { setup: 0, recurring: 0, oneTime: 0 };
  let runRate = 0;
  let passThrough = 0;
  let later = 0;
  for (const it of items) {
    if (typeof it?.cts !== 'number' || !Number.isFinite(it.cts)) continue;
    if (it.passThrough) { passThrough += 1; continue; }
    const start = startOf(it);
    if (start > 12) { later += 1; continue; }
    const part = partOfCost(it);
    if (part === 'recurring') {
      parts.recurring += it.cts * (13 - start);
      runRate += it.cts * 12;
    } else {
      parts[part] += it.cts;
    }
    lines[part] += 1;
  }
  const cost = parts.setup + parts.recurring + parts.oneTime;
  const counted = lines.setup + lines.recurring + lines.oneTime;
  return { cost, counted, passThrough, later, parts, lines, runRate };
}

const statusOf = (price, low, high) => {
  if (price < Math.min(low, high)) return RATE_CHECK.BELOW;
  if (price > Math.max(low, high)) return RATE_CHECK.ABOVE;
  return RATE_CHECK.WITHIN;
};

// One part of the fee model, both sides. `perUnit` is set when the card
// quotes the part on a single count (per site, per account): the cost per
// unit, marked up, against the rate itself.
//
// Ongoing is taken over a full year (monthly × 12), not year 1's months:
// the card's recurring fee is an annual one, so that is the like for like.
function feePart({ key, label, cost: year1Cost, lineCount, runRate, cardLines, markup }) {
  const cost = key === 'recurring' ? runRate : year1Cost;
  const price = cost * (1 + markup);
  const onCard = cardLines.length > 0;
  const low = cardLines.reduce((t, b) => t + (b.fee || 0), 0);
  const high = cardLines.reduce((t, b) => t + (b.feeHigh ?? b.fee ?? 0), 0);
  const gaps = cardLines.filter(b => b.gap);

  let perUnit = null;
  if (cardLines.length === 1 && cardLines[0].kind === 'unit' && cardLines[0].units > 0 && lineCount > 0) {
    const b = cardLines[0];
    perUnit = {
      unitLabel: b.unitLabel,
      units: b.units,
      price: price / b.units,
      rateLow: Math.min(b.rate, b.rateHigh ?? b.rate),
      rateHigh: Math.max(b.rate, b.rateHigh ?? b.rate),
    };
  }

  let status;
  if (lineCount === 0 && !onCard) status = null; // neither side has it
  else if (!onCard) status = RATE_CHECK.NOT_ON_CARD;
  else if (gaps.length) status = RATE_CHECK.INCOMPLETE;
  else if (lineCount === 0 || cost <= 0) status = RATE_CHECK.NO_COST;
  else if (perUnit) status = statusOf(perUnit.price, perUnit.rateLow, perUnit.rateHigh);
  else status = statusOf(price, low, high);

  return {
    key, label, status, cost, price, monthly: key === 'recurring', low: onCard ? low : null, high: onCard ? high : null,
    perUnit,
    cardLines: cardLines.map(b => ({
      basisLabel: b.basisLabel, kind: b.kind, unitLabel: b.unitLabel,
      rate: b.rate, rateHigh: b.rateHigh, units: b.units, fee: b.fee, feeHigh: b.feeHigh,
    })),
  };
}

/**
 * items    serviceDetailFor's cost lines ({ cts, type, startMonth, passThrough })
 * entry    the service's rate card entry (pricingFor)
 * meta     the service's catalog metadata (Type, Years)
 * counts   { sites, accounts, ... } off the SIA option, plus any typed in
 *          for the check; `dealSize` is what a percentage fee is a cut of
 * markup   0.5 means cost × 1.5
 */
export function rateCardCheck({ items = [], entry = null, meta = null, counts = {}, markup = DEFAULT_MARKUP, bases = PRICING_BASES } = {}) {
  const year1 = year1CostOf(items);
  const { cost, counted, passThrough, later } = year1;
  const price = cost * (1 + markup);
  const est = entry ? estimateServiceRange({ entry, meta, counts, dealSize: counts?.dealSize ?? null, bases }) : null;
  const priced = !!est?.priced && !est.noFee;
  const low = priced ? (est.fee || 0) + (est.setup || 0) : null;
  const high = priced ? (est.feeHigh ?? est.fee ?? 0) + (est.setupHigh ?? est.setup ?? 0) : null;
  const lines = priced ? [...(est.breakdown || []), ...(est.setupBreakdown || [])] : [];
  // Why the card came out at nothing, when it did: a count the SIA doesn't
  // carry, or a percentage with no deal to take it of.
  const notes = [...new Set(lines.map(b => b.note).filter(Boolean))];

  // What to ask for, one entry per input: { key, label }, key being the
  // counts key the estimate reads ('dealSize' for a percentage fee).
  const missing = [];
  for (const b of lines) {
    if (!b.gap) continue;
    const m = b.gap.kind === 'deal'
      ? { key: 'dealSize', label: 'Deal size' }
      : { key: b.gap.unit || b.unit, label: b.gap.unitLabel || b.unitLabel || b.gap.unit || 'Count' };
    if (m.key && !missing.some(x => x.key === m.key)) missing.push(m);
  }

  // The card's lines, sorted into the same parts as the cost lines: setup
  // lines are setup, a line that bills every year is ongoing, the rest is
  // one-time money.
  const cardFor = {
    setup: priced ? (est.setupBreakdown || []) : [],
    recurring: priced ? (est.breakdown || []).filter(b => b.recurs) : [],
    oneTime: priced ? (est.breakdown || []).filter(b => !b.recurs) : [],
  };
  const parts = priced
    ? FEE_PARTS.map(({ key, label }) => feePart({
      key, label,
      cost: year1.parts[key],
      lineCount: year1.lines[key],
      runRate: year1.runRate,
      cardLines: cardFor[key],
      markup,
    })).filter(p => p.status)
    : [];

  let status;
  if (!priced) status = RATE_CHECK.UNPRICED;
  else if (missing.length) status = RATE_CHECK.INCOMPLETE;
  else if (counted === 0 || cost <= 0) status = RATE_CHECK.NO_COST;
  else status = statusOf(price, low, high);

  return {
    status, cost, price, markup, low, high, notes, passThrough, later, missing, parts,
    noFee: !!est?.noFee,
  };
}

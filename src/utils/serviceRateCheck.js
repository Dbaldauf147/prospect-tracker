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
// Each cost line is marked up at its own `markup` when it carries one, else
// at the default.
//
// When the card prices the service on one per-unit rate and nothing else
// (BBS at $625 to $825 per site w/ mandate), that rate is what the check
// reads: the marked-up cost is divided by the same count and set against
// the rate, rather than against the rate times the count.
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
//
// `priced`, `pricedRunRate` and `price` are the same figures marked up,
// each line at its own `markup` when it has one, else at `markup`.
// `markups` lists the distinct markups the counted lines were priced at.
export function year1CostOf(items = [], markup = DEFAULT_MARKUP) {
  const parts = { setup: 0, recurring: 0, oneTime: 0 };
  const priced = { setup: 0, recurring: 0, oneTime: 0 };
  const lines = { setup: 0, recurring: 0, oneTime: 0 };
  let runRate = 0;
  let pricedRunRate = 0;
  let passThrough = 0;
  let later = 0;
  const markups = new Set();
  for (const it of items) {
    if (typeof it?.cts !== 'number' || !Number.isFinite(it.cts)) continue;
    if (it.passThrough) { passThrough += 1; continue; }
    const start = startOf(it);
    if (start > 12) { later += 1; continue; }
    const m = typeof it.markup === 'number' && Number.isFinite(it.markup) ? it.markup : markup;
    markups.add(m);
    const part = partOfCost(it);
    if (part === 'recurring') {
      parts.recurring += it.cts * (13 - start);
      priced.recurring += it.cts * (13 - start) * (1 + m);
      runRate += it.cts * 12;
      pricedRunRate += it.cts * 12 * (1 + m);
    } else {
      parts[part] += it.cts;
      priced[part] += it.cts * (1 + m);
    }
    lines[part] += 1;
  }
  const cost = parts.setup + parts.recurring + parts.oneTime;
  const price = priced.setup + priced.recurring + priced.oneTime;
  const counted = lines.setup + lines.recurring + lines.oneTime;
  return { cost, price, counted, passThrough, later, parts, priced, lines, runRate, pricedRunRate, markups: [...markups] };
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
function feePart({ key, label, cost: year1Cost, price: year1Price, lineCount, runRate, pricedRunRate, cardLines }) {
  const cost = key === 'recurring' ? runRate : year1Cost;
  const price = key === 'recurring' ? pricedRunRate : year1Price;
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
  const year1 = year1CostOf(items, markup);
  const { cost, price, counted, passThrough, later } = year1;
  // The one markup every counted line was priced at, or null when the fee
  // structure marks its fees up differently.
  const appliedMarkup = year1.markups.length === 0 ? markup : (year1.markups.length === 1 ? year1.markups[0] : null);
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
      price: year1.priced[key],
      lineCount: year1.lines[key],
      runRate: year1.runRate,
      pricedRunRate: year1.pricedRunRate,
      cardLines: cardFor[key],
    })).filter(p => p.status)
    : [];

  // A card that is one per-unit rate is checked at that rate: the year's
  // marked-up cost over the same count, against the rate's own range.
  const only = lines.length === 1 ? lines[0] : null;
  const perUnit = only && only.kind === 'unit' && only.units > 0 && !only.gap
    ? {
      unitLabel: only.unitLabel,
      basisLabel: only.basisLabel || null,
      units: only.units,
      cost: cost / only.units,
      price: price / only.units,
      rateLow: Math.min(only.rate, only.rateHigh ?? only.rate),
      rateHigh: Math.max(only.rate, only.rateHigh ?? only.rate),
    }
    : null;

  let status;
  if (!priced) status = RATE_CHECK.UNPRICED;
  else if (missing.length) status = RATE_CHECK.INCOMPLETE;
  else if (counted === 0 || cost <= 0) status = RATE_CHECK.NO_COST;
  else if (perUnit) status = statusOf(perUnit.price, perUnit.rateLow, perUnit.rateHigh);
  else status = statusOf(price, low, high);

  // The counts the card multiplies by (sites, accounts, ...), so the page
  // can show each one and where it came from.
  const unitsUsed = [...new Set(lines.filter(b => b.kind === 'unit' && b.unit).map(b => b.unit))];

  return {
    status, cost, price, markup: appliedMarkup, low, high, notes, passThrough, later, missing, parts, unitsUsed, perUnit,
    noFee: !!est?.noFee,
  };
}

// The SIA's site and account counts for one option. The counts sit in
// each option sheet's header block, and an SIA often fills them in on one
// sheet only, so an option without its own takes the first other option
// sheet's. `sitesFrom` / `accountsFrom` name that sheet, or are null when
// the option carries the count itself.
export function siaCountsFor(workbook, opt) {
  const pick = (k) => {
    if (typeof opt?.[k] === 'number' && opt[k] > 0) return { value: opt[k], from: null };
    const other = (workbook?.options || []).find(o => o !== opt && typeof o?.[k] === 'number' && o[k] > 0);
    return other ? { value: other[k], from: other.sheetName || null } : { value: null, from: null };
  };
  const s = pick('siteCount');
  const a = pick('accountCount');
  return { sites: s.value, accounts: a.value, sitesFrom: s.from, accountsFrom: a.from };
}

// The counts the price check prices on: the SIA's, with any typed on the
// Services subtab on top. The SIA's sites also stand in for sites w/
// mandate: the SIA is priced on the sites in its scope, which for a
// compliance service are the mandated ones. `fromSia` is what came off the
// SIA, per counts key, so the page can say so and offer it back after a
// typed override.
export function priceCheckCounts(sia = {}, entered = {}) {
  const counts = {};
  const fromSia = {};
  if (typeof sia.sites === 'number') {
    counts.sites = fromSia.sites = sia.sites;
    counts.sites_mandate = fromSia.sites_mandate = sia.sites;
  }
  if (typeof sia.accounts === 'number') counts.accounts = fromSia.accounts = sia.accounts;
  for (const [k, v] of Object.entries(entered || {})) {
    if (typeof v === 'number' && Number.isFinite(v)) counts[k] = v;
  }
  return { counts, fromSia };
}

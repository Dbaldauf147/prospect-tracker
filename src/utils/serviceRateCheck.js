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
// Each cost line is priced at its own `margin` when it carries one, else at
// the default, after tech depreciation is added to it the way the rest of
// the Pricing page costs a line: price = CTS x (1 + tech depr) / (1 - margin).
// A $268 cost at 50% margin with 4% tech depreciation prices at $557.44.
//
// A card quoted per month (see `period` in servicePricing) is compared per
// month, where it is quoted per unit: the recurring cost lines' monthly run
// rate, marked up, per unit, against the monthly rate itself. The totals
// stay annual, the estimate having already multiplied the rate up.
//
// When the card prices the service on one per-unit rate and nothing else
// (BBS at $625 to $825 per site w/ mandate), that rate is what the check
// reads: the marked-up cost is divided by the same count and set against
// the rate, rather than against the rate times the count.
//
// Pure, so scripts/serviceRateCheck.test.mjs can hold it still.

import { estimateServiceRange, PRICING_BASES } from './servicePricing.js';

export const DEFAULT_MARGIN = 0.5;

// What one dollar of CTS is priced at.
const priceFactor = (margin, techDeprPct) => (1 + (Number(techDeprPct) || 0)) / (1 - Math.min(margin, 0.99));

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
// `priced`, `pricedRunRate` and `price` are the same figures priced, each
// line at its own `margin` when it has one, else at `margin`, with tech
// depreciation added. `margins` lists the distinct margins the counted
// lines were priced at.
export function year1CostOf(items = [], margin = DEFAULT_MARGIN, techDeprPct = 0) {
  const parts = { setup: 0, recurring: 0, oneTime: 0 };
  const priced = { setup: 0, recurring: 0, oneTime: 0 };
  const lines = { setup: 0, recurring: 0, oneTime: 0 };
  let runRate = 0;
  let pricedRunRate = 0;
  let passThrough = 0;
  let later = 0;
  const margins = new Set();
  for (const it of items) {
    if (typeof it?.cts !== 'number' || !Number.isFinite(it.cts)) continue;
    if (it.passThrough) { passThrough += 1; continue; }
    const start = startOf(it);
    if (start > 12) { later += 1; continue; }
    const m = typeof it.margin === 'number' && Number.isFinite(it.margin) ? it.margin : margin;
    margins.add(m);
    const f = priceFactor(m, techDeprPct);
    const part = partOfCost(it);
    if (part === 'recurring') {
      parts.recurring += it.cts * (13 - start);
      priced.recurring += it.cts * (13 - start) * f;
      runRate += it.cts * 12;
      pricedRunRate += it.cts * 12 * f;
    } else {
      parts[part] += it.cts;
      priced[part] += it.cts * f;
    }
    lines[part] += 1;
  }
  const cost = parts.setup + parts.recurring + parts.oneTime;
  const price = priced.setup + priced.recurring + priced.oneTime;
  const counted = lines.setup + lines.recurring + lines.oneTime;
  return { cost, price, counted, passThrough, later, parts, priced, lines, runRate, pricedRunRate, margins: [...margins] };
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
    const perMonth = !!b.monthly && key === 'recurring';
    perUnit = {
      unitLabel: b.unitLabel,
      units: b.units,
      perMonth,
      price: price / b.units / (perMonth ? 12 : 1),
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
      basisLabel: b.basisLabel, kind: b.kind, unitLabel: b.unitLabel, monthly: !!b.monthly,
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
 * margin       0.5 means half the price is margin: cost ÷ 0.5
 * techDeprPct  added to each cost first, as the Pricing page does
 */
export function rateCardCheck({ items = [], entry = null, meta = null, counts = {}, margin = DEFAULT_MARGIN, techDeprPct = 0, bases = PRICING_BASES } = {}) {
  const year1 = year1CostOf(items, margin, techDeprPct);
  const { cost, price, counted, passThrough, later } = year1;
  // The one margin every counted line was priced at, or null when they
  // differ.
  const appliedMargin = year1.margins.length === 0 ? margin : (year1.margins.length === 1 ? year1.margins[0] : null);
  const est = entry ? estimateServiceRange({ entry, meta, counts, dealSize: counts?.dealSize ?? null, bases }) : null;
  const priced = !!est?.priced && !est.noFee;
  const low = priced ? (est.fee || 0) + (est.setup || 0) : null;
  const high = priced ? (est.feeHigh ?? est.fee ?? 0) + (est.setupHigh ?? est.setup ?? 0) : null;
  // A line the card charges nothing for (a $0 setup left in the grid) is
  // not part of the fee model: it can't be priced against, and counting it
  // would stop a one-rate card (per account at $4.80 to $5) from being
  // checked at that rate.
  const charged = (list) => (list || []).filter(b => (Number(b.rate) || 0) > 0 || (Number(b.rateHigh) || 0) > 0);
  const lines = priced ? [...charged(est.breakdown), ...charged(est.setupBreakdown)] : [];
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
    setup: priced ? charged(est.setupBreakdown) : [],
    recurring: priced ? charged(est.breakdown).filter(b => b.recurs) : [],
    oneTime: priced ? charged(est.breakdown).filter(b => !b.recurs) : [],
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
  //
  // So is a card with more on it, when only one of its fee components is
  // one the SIA's costs pay for: ESPM link at so much per site a year, with
  // a setup line on the card and no setup cost on the SIA, is checked per
  // site against the recurring costs. The components left out are listed
  // (`leftOut`), not silently dropped.
  const partsWithCost = FEE_PARTS.map(x => x.key).filter(k => year1.lines[k] > 0);
  const cardWithCost = partsWithCost.flatMap(k => cardFor[k]);
  let only = null;
  let onlyPart = null;
  if (lines.length === 1) only = lines[0];
  else if (partsWithCost.length === 1 && cardWithCost.length === 1) { only = cardWithCost[0]; onlyPart = partsWithCost[0]; }
  const leftOut = onlyPart
    ? lines.filter(b => b !== only).map(b => ({ basisLabel: b.basisLabel, fee: b.fee, feeHigh: b.feeHigh ?? b.fee, rate: b.rate, rateHigh: b.rateHigh }))
    : [];
  // A monthly rate is read against a month: the recurring lines' run rate
  // over twelve. Anything else is read against the first year, or, for a
  // single component, that component's year the way feePart reads it.
  const perMonth = !!only?.monthly && year1.runRate > 0;
  let baseCost = perMonth ? year1.runRate / 12 : cost;
  let basePrice = perMonth ? year1.pricedRunRate / 12 : price;
  if (onlyPart && !perMonth) {
    baseCost = onlyPart === 'recurring' ? year1.runRate : year1.parts[onlyPart];
    basePrice = onlyPart === 'recurring' ? year1.pricedRunRate : year1.priced[onlyPart];
  }
  const perUnit = only && only.kind === 'unit' && only.units > 0 && !only.gap
    ? {
      unitLabel: only.unitLabel,
      basisLabel: only.basisLabel || null,
      units: only.units,
      perMonth,
      // The part of the fee model the rate prices, when the card carries
      // others the SIA has no cost for; null when it is the whole card.
      part: onlyPart ? FEE_PARTS.find(x => x.key === onlyPart).label : null,
      // The figure the per-unit one is cut from: a month's when perMonth,
      // else year 1's (a year's run rate for an ongoing component).
      totalCost: baseCost,
      totalPrice: basePrice,
      cost: baseCost / only.units,
      price: basePrice / only.units,
      rateLow: Math.min(only.rate, only.rateHigh ?? only.rate),
      rateHigh: Math.max(only.rate, only.rateHigh ?? only.rate),
    }
    : null;

  // Checked on one component, only that component's missing count holds
  // the check up.
  const blocking = perUnit && onlyPart ? [] : missing;

  let status;
  if (!priced) status = RATE_CHECK.UNPRICED;
  else if (blocking.length) status = RATE_CHECK.INCOMPLETE;
  else if (counted === 0 || cost <= 0) status = RATE_CHECK.NO_COST;
  else if (perUnit) status = statusOf(perUnit.price, perUnit.rateLow, perUnit.rateHigh);
  else status = statusOf(price, low, high);

  // The counts the card multiplies by (sites, accounts, ...), so the page
  // can show each one and where it came from.
  const unitsUsed = [...new Set(lines.filter(b => b.kind === 'unit' && b.unit).map(b => b.unit))];

  return {
    status, cost, price, margin: appliedMargin, techDeprPct: Number(techDeprPct) || 0, low, high, notes, passThrough, later, missing, parts, unitsUsed, perUnit, leftOut,
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

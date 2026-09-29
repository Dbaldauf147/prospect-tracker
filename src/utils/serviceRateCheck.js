// Does what a service costs on the SIA, marked up, land inside the price
// range the Dropdowns › Services Pricing rate card quotes for it?
//
// Both sides are put on the same footing, the first year:
//   cost side   the service's cost lines on the option. A recurring CTS is
//               monthly (the same reading the rest of the Pricing page
//               gives it), so it counts twelve times; a Rolled one (Setup
//               Rolled) is spread over the term and counts as ongoing;
//               anything else is one-time money and counts once. Pass-through lines are
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
export const DEFAULT_TERM_MONTHS = 36;

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
// "Setup Rolled" and "One Time Rolled": an upfront cost billed monthly,
// spread across the term, so the ongoing fee is what recovers it.
const isRolledType = (t) => /\brolled\b/i.test(String(t || '').trim());
// "Setup": standing the service up, billed once.
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
  if (isRolledType(it.type) || isRecurringType(it.type)) return 'recurring';
  if (isSetupType(it.type)) return 'setup';
  if (isRecurringType(it.type)) return 'recurring';
  return 'oneTime';
}

// The first-year cost of a set of cost lines, split by part. Pass-through
// lines are left out of the parts: the rate card never priced them, so
// they are listed on their own instead (see passThroughLinesOf).
// `passThrough` counts them.
//
// Only months 1 to 12 count: a recurring line starting in month 4
// pays nine of them, and a cost landing in month 13 or later is a year 2
// cost. `runRate` is the recurring lines' full year (monthly × 12), which
// is how an annual per-unit rate is quoted.
//
// `priced`, `pricedRunRate` and `price` are the same figures priced, each
// line at its own `margin` when it has one, else at `margin`, with tech
// depreciation added. `margins` lists the distinct margins the counted
// lines were priced at.
//
// A Rolled line is ongoing money: its CTS spread evenly over `termMonths`,
// so year 1 carries twelve of those months (fewer on a shorter term).
export function year1CostOf(items = [], margin = DEFAULT_MARGIN, techDeprPct = 0, termMonths = DEFAULT_TERM_MONTHS) {
  const parts = { setup: 0, recurring: 0, oneTime: 0 };
  const priced = { setup: 0, recurring: 0, oneTime: 0 };
  const lines = { setup: 0, recurring: 0, oneTime: 0 };
  let runRate = 0;
  let pricedRunRate = 0;
  let passThrough = 0;
  let later = 0;
  const margins = new Set();
  for (const it of items) {
    const y = lineYear(it, margin, techDeprPct, termMonths);
    if (!y) continue;
    if (y.skip === 'later') { later += 1; continue; }
    if (y.passThrough) { passThrough += 1; continue; }
    margins.add(y.margin);
    parts[y.part] += y.cost;
    priced[y.part] += y.price;
    runRate += y.runRate;
    pricedRunRate += y.pricedRunRate;
    lines[y.part] += 1;
  }
  const cost = parts.setup + parts.recurring + parts.oneTime;
  const price = priced.setup + priced.recurring + priced.oneTime;
  const counted = lines.setup + lines.recurring + lines.oneTime;
  return { cost, price, counted, passThrough, later, parts, priced, lines, runRate, pricedRunRate, margins: [...margins] };
}

// One cost line's share of year 1, the arithmetic year1CostOf sums: null
// with no CTS, `skip` set for a line landing after month 12. A pass-through
// line is priced at cost and flagged `passThrough`.
function lineYear(it, margin, techDeprPct, termMonths = DEFAULT_TERM_MONTHS) {
  if (typeof it?.cts !== 'number' || !Number.isFinite(it.cts)) return null;
  const start = startOf(it);
  if (start > 12) return { skip: 'later' };
  const passThrough = !!it.passThrough;
  const m = passThrough ? 0 : (typeof it.margin === 'number' && Number.isFinite(it.margin) ? it.margin : margin);
  const f = passThrough ? 1 : priceFactor(m, techDeprPct);
  const part = partOfCost(it);
  const y = lineYearAt(it, part, m, f, start, termMonths);
  return passThrough ? { ...y, passThrough } : y;
}

function lineYearAt(it, part, m, f, start, termMonths) {
  if (part === 'recurring' && isRolledType(it.type)) {
    const term = Number(termMonths) > 0 ? Number(termMonths) : DEFAULT_TERM_MONTHS;
    const monthly = it.cts / term;
    const months = Math.max(0, Math.min(13 - start, term - start + 1));
    const yearMonths = Math.min(12, term);
    return {
      part, margin: m,
      cost: monthly * months, price: monthly * months * f,
      runRate: monthly * yearMonths, pricedRunRate: monthly * yearMonths * f,
    };
  }
  if (part === 'recurring') {
    return {
      part, margin: m,
      cost: it.cts * (13 - start), price: it.cts * (13 - start) * f,
      runRate: it.cts * 12, pricedRunRate: it.cts * 12 * f,
    };
  }
  return { part, margin: m, cost: it.cts, price: it.cts * f, runRate: 0, pricedRunRate: 0 };
}

// The part of the fee model a cost line would be checked in (setup,
// recurring, oneTime), or null when the check leaves it out altogether.
export function checkPartOf(it) {
  const y = lineYear(it, DEFAULT_MARGIN, 0);
  return y && !y.skip ? y.part : null;
}

// How a pass-through line is shown below the rate card's components: the
// cost as one fixed fee, or cut per account. The id is what the line's
// `feeComponent` holds.
export const PASS_THROUGH_MODELS = [
  { id: 'pass:fixed', label: 'Fixed fee' },
  { id: 'pass:per_account', label: 'Per account' },
];

// A pick made while pass-through lines still sat in the rate card's
// components ('recurring:per_account') reads as the per-account model.
export function passThroughModelOf(it) {
  return /per_account/.test(String(it?.feeComponent || '')) ? 'pass:per_account' : 'pass:fixed';
}

// Each pass-through line on its own, billed at cost: no margin, no tech
// depreciation. An ongoing line is read over a full year (monthly × 12),
// the rest as the amount it is. Per account divides that by the account
// count; `needsAccounts` when there is none to divide by. Lines landing
// after month 12 are left out, as they are from the check.
export function passThroughLinesOf(items = [], counts = {}, termMonths = DEFAULT_TERM_MONTHS) {
  const accounts = Number(counts?.accounts) > 0 ? Number(counts.accounts) : null;
  const out = [];
  for (const it of items) {
    if (!it?.passThrough) continue;
    const y = lineYear(it, 0, 0, termMonths);
    if (!y || y.skip) continue;
    const annual = y.part === 'recurring';
    const amount = annual ? y.runRate : y.cost;
    const model = passThroughModelOf(it);
    const perAccount = model === 'pass:per_account';
    out.push({
      id: it.id ?? null,
      description: it.description || '',
      part: y.part,
      partLabel: FEE_PARTS.find(x => x.key === y.part).label,
      model,
      annual,
      amount,
      accounts: perAccount ? accounts : null,
      perUnit: perAccount && accounts ? amount / accounts : null,
      needsAccounts: perAccount && !accounts,
    });
  }
  return out;
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
function feePart({ key, label, cost: year1Cost, price: year1Price, lineCount, runRate, pricedRunRate, cardLines, costLines = [] }) {
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
    cardLines: cardLines.map(cardLineOut),
    components: cardLines.length > 1 ? splitPart(key, cardLines, costLines) : null,
  };
}

const cardLineOut = (b) => ({
  id: b.id, basisLabel: b.basisLabel, kind: b.kind, unitLabel: b.unitLabel, monthly: !!b.monthly,
  rate: b.rate, rateHigh: b.rateHigh, units: b.units, fee: b.fee, feeHigh: b.feeHigh,
});

// A part the card prices on more than one component (Ongoing at $42,000 to
// $84,000 a year plus $32 to $46 per account a year), checked a component
// at a time. Each cost line picked for a component (`feeComponent`, set on
// the Services subtab) is priced against that component alone. Lines left
// on Auto go to the one component nothing was picked for; when several
// are open they are checked together, against those components' combined
// range, in one `shared` row. `loose` is cost left on Auto when every
// component already has lines of its own.
//
// Ongoing is read over a full year, as feePart reads it.
function splitPart(key, cardLines, costLines) {
  const ids = new Set(cardLines.map(b => b.id));
  const costOf = (list) => list.reduce((t, c) => t + (key === 'recurring' ? c.runRate : c.cost), 0);
  const priceOf = (list) => list.reduce((t, c) => t + (key === 'recurring' ? c.pricedRunRate : c.price), 0);
  const picked = (b) => costLines.filter(c => c.component === b.id);
  const auto = costLines.filter(c => !ids.has(c.component));
  const open = cardLines.filter(b => picked(b).length === 0);

  const judge = (lines, card) => {
    const cost = costOf(lines);
    const price = priceOf(lines);
    const low = card.reduce((t, b) => t + (b.fee || 0), 0);
    const high = card.reduce((t, b) => t + (b.feeHigh ?? b.fee ?? 0), 0);
    const b = card[0];
    let perUnit = null;
    if (card.length === 1 && b.kind === 'unit' && b.units > 0 && lines.length > 0) {
      const perMonth = !!b.monthly && key === 'recurring';
      perUnit = {
        units: b.units, perMonth,
        price: price / b.units / (perMonth ? 12 : 1),
        rateLow: Math.min(b.rate, b.rateHigh ?? b.rate),
        rateHigh: Math.max(b.rate, b.rateHigh ?? b.rate),
      };
    }
    let status;
    if (card.some(x => x.gap)) status = RATE_CHECK.INCOMPLETE;
    else if (lines.length === 0 || cost <= 0) status = RATE_CHECK.NO_COST;
    else if (perUnit) status = statusOf(perUnit.price, perUnit.rateLow, perUnit.rateHigh);
    else status = statusOf(price, low, high);
    return { cost, price, low, high, perUnit, status, lineCount: lines.length };
  };

  const shareAuto = open.length > 1 && auto.length > 0;
  const rows = cardLines.map(b => {
    const mine = picked(b);
    const takesAuto = mine.length === 0 && open.length === 1;
    const lines = takesAuto ? auto : mine;
    return {
      id: b.id, card: cardLineOut(b),
      picked: mine.length, auto: takesAuto ? auto.length : 0,
      shared: shareAuto && mine.length === 0,
      ...judge(lines, [b]),
    };
  });
  const shared = shareAuto
    ? { ids: open.map(b => b.id), labels: open.map(b => b.basisLabel), ...judge(auto, open) }
    : null;
  const loose = open.length === 0 && auto.length > 0
    ? { lineCount: auto.length, cost: costOf(auto), price: priceOf(auto) }
    : null;
  return { rows, shared, loose };
}

/**
 * items    serviceDetailFor's cost lines ({ cts, type, startMonth, passThrough })
 * entry    the service's rate card entry (pricingFor)
 * meta     the service's catalog metadata (Type, Years)
 * counts   { sites, accounts, ... } off the SIA option, plus any typed in
 *          for the check; `dealSize` is what a percentage fee is a cut of
 * margin       0.5 means half the price is margin: cost ÷ 0.5
 * techDeprPct  added to each cost first, as the Pricing page does
 * termMonths   the deal term a Rolled cost is spread over
 */
export function rateCardCheck({ items = [], entry = null, meta = null, counts = {}, margin = DEFAULT_MARGIN, techDeprPct = 0, termMonths = DEFAULT_TERM_MONTHS, bases = PRICING_BASES } = {}) {
  const year1 = year1CostOf(items, margin, techDeprPct, termMonths);
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
  // Each component named for the part and the basis it prices on
  // ('recurring:per_account'), which is what a cost line's `feeComponent`
  // points at. Stable across loads, so a pick survives a new SIA. Set on
  // the estimate's own lines (fresh each call), so `lines` above and the
  // parts below keep reading the same objects.
  for (const [k, list] of Object.entries(cardFor)) {
    const seen = new Map();
    for (const b of list) {
      const base = `${k}:${b.basis || 'line'}`;
      const n = seen.get(base) || 0;
      seen.set(base, n + 1);
      b.id = n ? `${base}#${n + 1}` : base;
    }
  }
  // Every counted cost line's own share, for splitting a part across its
  // components.
  const costLines = items
    .map(it => ({ it, y: lineYear(it, margin, techDeprPct, termMonths) }))
    .filter(({ y }) => y && !y.skip && !y.passThrough)
    .map(({ it, y }) => ({ ...y, id: it.id ?? null, component: it.feeComponent || null }));
  const parts = priced
    ? FEE_PARTS.map(({ key, label }) => feePart({
      key, label,
      cost: year1.parts[key],
      price: year1.priced[key],
      lineCount: year1.lines[key],
      runRate: year1.runRate,
      pricedRunRate: year1.pricedRunRate,
      cardLines: cardFor[key],
      costLines: costLines.filter(c => c.part === key),
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

  // The components a cost line can be pointed at, per part, for a part the
  // card prices on more than one.
  const componentChoices = {};
  for (const [k, list] of Object.entries(cardFor)) {
    if (list.length > 1) componentChoices[k] = list.map(b => ({ id: b.id, label: b.basisLabel }));
  }

  return {
    componentChoices,
    passThroughLines: passThroughLinesOf(items, counts, termMonths),
    // The card is priced and charges no setup: a Setup cost has no setup
    // fee to recover it, so it belongs rolled into the ongoing fee.
    setupOffCard: priced && cardFor.setup.length === 0,
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

// A deal estimate, frozen onto the opp it was built for.
//
// The estimator on Dropdowns › Services Pricing works out what a scope is
// worth against the rate card as it stands today. Save it to an opp and it
// stops being a live calculation: the rows, the rates, the counts they were
// priced against and what each came to are copied out whole. A rate edited
// next week doesn't rewrite what was quoted this week, and a service
// retired from the Solutions list doesn't take its line out of a deal that
// was priced with it — which is the whole point of saving one.
//
// Stored on the opp record as `_pricingAnalysis`, with the year-one figure
// mirrored into the visible "Estimated Fee" column so the table can show it
// and the Excel export carries it. Opps 2 renders it back through
// normalizePricingAnalysis, so a record written by an older version — or
// half-written by a save that lost its connection — comes back as no
// analysis rather than a broken popup.
//
// Pure — totals in, a record out — so a test can pin it without React.

// Explicit .js extension: pinned by a plain-Node test (scripts/…test.mjs),
// which resolves specifiers the way Node does rather than the way Vite does.
import { basisFor, parseMoney, PRICING_BASES } from './servicePricing.js';

export const ANALYSIS_FIELD = '_pricingAnalysis';
export const ESTIMATED_FEE_COLUMN = 'Estimated Fee';

const str = (v) => (typeof v === 'string' ? v : '');
const num = (v) => {
  const n = parseMoney(v);
  return n === null ? null : n;
};

/**
 * The record to save, built from what the estimator is showing.
 *
 * `totals` is an estimateScope result; `lines` come off it with the basis
 * spelled out, because a line that says "Per site" and "$450 × 819" is
 * readable a year later and a bare fee isn't.
 */
export function buildPricingAnalysis({
  totals, counts, dealSize, bases = PRICING_BASES, account = '', savedAt = Date.now(),
}) {
  const lines = (totals?.lines || []).map(line => {
    // The basis is spelled out rather than referenced: the list is
    // editable, and a basis renamed or deleted next month mustn't change
    // what this deal says it was priced on.
    const basis = basisFor(line.entry?.basis, bases);
    return {
    name: str(line.name),
    basis: str(line.entry?.basis),
    basisLabel: str(basis?.label || ''),
    kind: str(basis?.kind || ''),
    rate: num(line.entry?.rate),
    rateHigh: num(line.entry?.rateHigh),
    minFee: num(line.entry?.minFee),
    unit: str(line.unit || ''),
    unitLabel: str(basis?.unitLabel || ''),
    units: num(line.units),
    // Where the units came from matters as much as the number: a figure
    // typed against the row is a decision, the shared count is an
    // assumption, and only one of them is worth arguing with later.
    unitsTyped: !!line.unitsTyped,
    typed: !!line.typed,
    recurring: !!line.recurring,
    years: num(line.years) ?? 1,
    fee: num(line.fee),
    // The top of the range, when the service carries one. Equal to `fee`
    // otherwise, so a reader adding the ends up doesn't have to know which
    // lines were ranged.
    feeHigh: num(line.feeHigh) ?? num(line.fee),
    value: num(line.value),
    valueHigh: num(line.valueHigh) ?? num(line.value),
    // The one-time setup fee this line carried, already inside the totals
    // below. Recorded per line because a first year that runs ahead of the
    // annual fee has a reason, and the reason is on the row.
    setup: num(line.setup) ?? 0,
    note: str(line.note),
    };
  });
  return {
    savedAt: Number(savedAt) || Date.now(),
    account: str(account),
    counts: normalizeCounts(counts),
    dealSize: num(dealSize) ?? null,
    lines,
    recurringAnnual: num(totals?.recurringAnnual) ?? 0,
    oneTime: num(totals?.oneTime) ?? 0,
    // The setup slice of oneTime, so a saved analysis can say what the
    // standing-up cost was without re-deriving it from the lines.
    setup: num(totals?.setup) ?? 0,
    year1Total: num(totals?.year1Total) ?? 0,
    contractValue: num(totals?.contractValue) ?? 0,
    recurringAnnualHigh: num(totals?.recurringAnnualHigh) ?? num(totals?.recurringAnnual) ?? 0,
    oneTimeHigh: num(totals?.oneTimeHigh) ?? num(totals?.oneTime) ?? 0,
    year1TotalHigh: num(totals?.year1TotalHigh) ?? num(totals?.year1Total) ?? 0,
    contractValueHigh: num(totals?.contractValueHigh) ?? num(totals?.contractValue) ?? 0,
    // Services in scope that nothing priced. Kept because a $60,000
    // estimate with four unpriced services in it is a different number
    // from a $60,000 estimate with none, and the popup has to be able to
    // say so rather than quietly reading as complete.
    unpriced: (totals?.unpriced || []).filter(n => typeof n === 'string' && n.trim()),
  };
}

function normalizeCounts(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [unit, value] of Object.entries(raw)) {
    const n = num(value);
    if (n !== null && n >= 0) out[unit] = n;
  }
  return out;
}

/**
 * A saved analysis read back, or null when there's nothing usable. An
 * analysis with no lines is nothing usable: the popup exists to show them.
 */
export function normalizePricingAnalysis(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const lines = (Array.isArray(raw.lines) ? raw.lines : [])
    .filter(l => l && typeof l === 'object' && str(l.name).trim())
    .map(l => ({
      name: str(l.name),
      basis: str(l.basis),
      basisLabel: str(l.basisLabel),
      kind: str(l.kind),
      rate: num(l.rate),
      rateHigh: num(l.rateHigh),
      minFee: num(l.minFee),
      unit: str(l.unit),
      unitLabel: str(l.unitLabel),
      units: num(l.units),
      unitsTyped: !!l.unitsTyped,
      typed: !!l.typed,
      recurring: !!l.recurring,
      years: num(l.years) ?? 1,
      fee: num(l.fee),
      // An analysis saved before ranges existed has no high end: it reads
      // as the single figure it was, rather than as a range from something
      // to nothing.
      feeHigh: num(l.feeHigh) ?? num(l.fee),
      value: num(l.value),
      valueHigh: num(l.valueHigh) ?? num(l.value),
      // An analysis saved before setup fees existed carries none, which is
      // what it was: nothing.
      setup: num(l.setup) ?? 0,
      note: str(l.note),
    }));
  if (lines.length === 0) return null;
  return {
    savedAt: Number(raw.savedAt) || 0,
    account: str(raw.account),
    counts: normalizeCounts(raw.counts),
    dealSize: num(raw.dealSize),
    lines,
    recurringAnnual: num(raw.recurringAnnual) ?? 0,
    oneTime: num(raw.oneTime) ?? 0,
    setup: num(raw.setup) ?? 0,
    year1Total: num(raw.year1Total) ?? 0,
    contractValue: num(raw.contractValue) ?? 0,
    recurringAnnualHigh: num(raw.recurringAnnualHigh) ?? num(raw.recurringAnnual) ?? 0,
    oneTimeHigh: num(raw.oneTimeHigh) ?? num(raw.oneTime) ?? 0,
    year1TotalHigh: num(raw.year1TotalHigh) ?? num(raw.year1Total) ?? 0,
    contractValueHigh: num(raw.contractValueHigh) ?? num(raw.contractValue) ?? 0,
    unpriced: (Array.isArray(raw.unpriced) ? raw.unpriced : []).filter(n => typeof n === 'string' && n.trim()),
  };
}

/** How a line's fee was arrived at, in one phrase: "Per site · $450 × 819". */
export function lineBasisText(line) {
  if (!line) return '';
  // A typed fee prices one of whatever the service is, so a line that
  // carried several says so — otherwise "Typed fee" against $15,000 on a
  // $5,000 service reads as an arithmetic error.
  if (line.typed) return line.units > 1 ? `Typed fee × ${line.units.toLocaleString('en-US')}` : 'Typed fee';
  if (!line.basisLabel) return '';
  if (line.rate === null) return line.basisLabel;
  const one = (n) => (line.kind === 'percent' ? `${n}%` : `$${n.toLocaleString('en-US')}`);
  const rate = (line.rateHigh === null || line.rateHigh === undefined || line.rateHigh === line.rate)
    ? one(line.rate)
    : `${one(Math.min(line.rate, line.rateHigh))}–${one(Math.max(line.rate, line.rateHigh))}`;
  if (line.kind === 'percent') return `${line.basisLabel} · ${rate}`;
  if (line.unit) {
    const units = line.units === null ? '?' : line.units.toLocaleString('en-US');
    return `${line.basisLabel} · ${rate} × ${units}`;
  }
  return `${line.basisLabel} · ${rate}`;
}

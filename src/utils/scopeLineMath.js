// How one service in a deal got to its price.
//
// The scope breakdown under the estimator bar says what each service bills
// in year one. It does not say why — and a range is exactly the figure
// somebody wants to argue with. "$45,904 – $89,612" is a rate, a count, and
// sometimes a floor under the pair of them, and none of the three is
// anywhere on that panel: the rates live on the Services Pricing subtab, the
// count lives in a box above the table, and the deal a percentage takes its
// cut of is very often not the deal on the bar at all.
//
// So: one estimate line turned back into the arithmetic that made it, in the
// order the money was worked out.
//
// The contract is that the steps ADD UP to year one. A panel that itemises a
// figure and doesn't foot to it is worse than no panel, because it invites a
// reader to check and then tells them the check failed. Money the rate lines
// don't account for therefore gets a step of its own — a minimum fee holding
// a thin deal up, a setup fee billed once — rather than being folded into a
// rate nobody typed.
import {
  PRICING_BASES,
  formatMoney,
  formatMoneyRange,
  formatRate,
  formatSetupSummary,
  rateSentence,
  unitNoun,
} from './servicePricing.js';

// Rates times counts are floating-point multiplication, and money is not:
// 0.25% of $819,000 lands a hair off $2,047.50 and a panel that compares
// the hair to zero grows a step nobody can see. Everything summed or tested
// here goes through this first.
const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;

const count = (n) => (Number(n) || 0).toLocaleString('en-US');

// The rate as its own column on the rate card prints it: "$450",
// "$450–$600", "3%". Built off the part rather than the card so a line that
// was priced on a basis somebody has since renamed still reads back the
// figure the estimate actually used.
function rateText(part) {
  return formatRate(
    { basis: 'x', rate: part?.rate, rateHigh: part?.rateHigh },
    [{ key: 'x', kind: part?.kind }],
  );
}

/**
 * What a percentage line took its cut OF.
 *
 * Recovered by dividing the fee back out rather than passed down from the
 * estimator. The deal a percentage bites on is the bundle the service rides
 * in — Client management is a cut of the bill payment it comes with, ticked
 * or not — so it is neither the figure on the bar nor anything else on this
 * panel, and a number derived from the fee cannot disagree with the fee.
 * That is the only property a panel that has to foot can afford.
 *
 * Returns '' for a line that priced to nothing: there is no base to report,
 * and "0% of $0" reads as arithmetic when it is really a missing input.
 */
function percentBase(part) {
  if (part?.note) return '';
  const rate = Number(part?.rate) || 0;
  const rateHigh = part?.rateHigh === null || part?.rateHigh === undefined
    ? rate
    : Number(part.rateHigh) || 0;
  const lo = Math.min(rate, rateHigh);
  const hi = Math.max(rate, rateHigh);
  if (lo <= 0 && hi <= 0) return '';
  const low = lo > 0 ? cents((Number(part.fee) || 0) / (lo / 100)) : null;
  const high = hi > 0 ? cents((Number(part.feeHigh) || 0) / (hi / 100)) : null;
  return formatMoneyRange(low === null ? high : low, high === null ? low : high);
}

// One line of the working, in words: "$56 per site × 819", "3% of
// $1,200,000", "$42,000 a year". The sentence a reader checks the figure
// beside it against, which is the whole reason this panel exists.
function mathPhrase(part) {
  const rate = rateText(part);
  if (!rate) return '';
  if (part.kind === 'unit') {
    const noun = unitNoun(part.unitLabel || part.unit || 'unit');
    const units = Number(part.units) || 0;
    return units > 0 ? `${rate} per ${noun} × ${count(units)}` : `${rate} per ${noun}`;
  }
  if (part.kind === 'percent') {
    const base = percentBase(part);
    return base ? `${rate} of ${base}` : `${rate} of the deal`;
  }
  return part.recurs ? `${rate} a year` : `${rate} flat`;
}

// Where the count in a per-unit step came from. Worth one line on the step
// because the two are different claims: a figure typed against the service
// is this deal's answer, and the shared box is the account's, and a reader
// wanting to move the number needs to know which one to go and edit.
function countSource(part) {
  if (part?.kind !== 'unit') return '';
  if (part.unitsTyped) return 'Count typed against this service for this deal';
  return `${part.unitLabel || 'Count'} taken from the shared count above the table`;
}

// The whole standing price of a service, recurring and setup together.
// rateSentence answers for the fee alone, which is right where it is used -
// a rate card column - and short by a charge here.
function rateCardSentence(entry, bases) {
  const fee = rateSentence(entry, bases);
  const setup = formatSetupSummary(entry?.setupLines, bases);
  if (!setup) return fee;
  return fee ? `${fee}, plus ${setup} to set up` : `${setup} to set up`;
}

/**
 * One scope line as the steps that produced it.
 *
 * `line` is an estimateScope() line — the estimate with its `breakdown` and
 * `setupBreakdown` still on it, not the trimmed shape scopeYear1Lines()
 * prints. `dealTotal` is the estimate's Year 1 deal size, used for the
 * share, and is the LOW end, the same end everything else on the page ranks
 * and reads at.
 *
 * Returns null for anything that isn't a line, so a caller can render the
 * result or not and never has to guard twice.
 */
export function scopeLineMath(line, { bases = PRICING_BASES, dealTotal = 0 } = {}) {
  if (!line || !line.name) return null;

  const steps = [];
  const parts = Array.isArray(line.breakdown) ? line.breakdown : [];
  let feeLow = 0;
  let feeHigh = 0;

  for (const part of parts) {
    steps.push({
      key: `fee:${part.basis}`,
      label: part.basisLabel || '',
      math: mathPhrase(part),
      source: countSource(part),
      low: Number(part.fee) || 0,
      high: Number(part.feeHigh) || 0,
      when: part.recurs ? 'Every year' : 'Once',
      note: part.note || '',
    });
    feeLow = cents(feeLow + (Number(part.fee) || 0));
    feeHigh = cents(feeHigh + (Number(part.feeHigh) || 0));
  }

  // A fee typed straight onto the rate card outranks every line under it, so
  // there is no breakdown to print and the figure is the whole of the
  // working. Said out loud rather than left as a number with no reason
  // beside it: "typed" is why it doesn't move when the counts do.
  if (line.typed && parts.length === 0 && line.priced) {
    const many = Number(line.units) > 1 ? Number(line.units) : 1;
    const each = many > 1 ? cents((Number(line.fee) || 0) / many) : Number(line.fee) || 0;
    steps.push({
      key: 'typed',
      label: 'Typed fee',
      math: many > 1
        ? `${formatMoney(each)} typed on the rate card × ${count(many)}`
        : `${formatMoney(each)} typed on the rate card`,
      source: 'Typed fees are stated, not worked out, so no count moves them',
      low: Number(line.fee) || 0,
      high: Number(line.feeHigh) || 0,
      when: line.recurring ? 'Every year' : 'Once',
      note: '',
    });
    feeLow = cents(Number(line.fee) || 0);
    feeHigh = cents(Number(line.feeHigh) || 0);
  }

  // The floor, when the lines came out under it. Read off the gap rather
  // than off the card's minimum-fee box: the gap is what was actually added
  // to the fee, so the steps still foot even where the two disagree.
  const gapLow = cents((Number(line.fee) || 0) - feeLow);
  const gapHigh = cents((Number(line.feeHigh) || 0) - feeHigh);
  if (line.priced && (gapLow > 0 || gapHigh > 0)) {
    const floor = gapLow > 0 ? Number(line.fee) || 0 : Number(line.feeHigh) || 0;
    steps.push({
      key: 'minimum',
      label: 'Minimum fee',
      math: `Tops the lines above up to the ${formatMoney(floor)} this service is sold at`,
      source: '',
      low: gapLow > 0 ? gapLow : 0,
      high: gapHigh > 0 ? gapHigh : 0,
      when: line.recurring ? 'Every year' : 'Once',
      note: '',
    });
  }

  // Setup last, because that is where it lands on the invoice: the fee is
  // what the service costs to run and this is what it cost to stand up, and
  // year one pays both.
  for (const part of line.setupBreakdown || []) {
    steps.push({
      key: `setup:${part.basis}`,
      label: part.basisLabel || '',
      math: mathPhrase(part),
      source: countSource(part),
      low: Number(part.fee) || 0,
      high: Number(part.feeHigh) || 0,
      when: 'Once, to set up',
      setup: true,
      note: part.note || '',
    });
  }

  const setup = Number(line.setup) || 0;
  const setupHigh = Number(line.setupHigh) || 0;
  const year1 = line.priced ? cents((Number(line.fee) || 0) + setup) : null;
  const year1High = line.priced ? cents((Number(line.feeHigh) || 0) + setupHigh) : null;
  const years = Number(line.years) > 0 ? Number(line.years) : 1;

  return {
    name: line.name,
    priced: !!line.priced,
    noFee: !!line.noFee,
    typed: !!line.typed,
    note: line.note || '',
    // What the rate card says this service costs, before any count touches
    // it: "$56 to $70 per site, plus $3,000 to set up". The standing price
    // the steps below are one account's reading of - and the setup half
    // belongs in it, because a line headed "on the rate card" that quietly
    // leaves out a charge on the rate card is the one sentence on this
    // panel a reader would take at face value and be wrong about.
    rateCard: rateCardSentence(line.entry, bases),
    steps,
    year1,
    year1High,
    // The two halves of year one, for the sentence under the total: one of
    // them bills again next year and the other doesn't, and a first year
    // that is mostly setup is a very different deal from one that isn't.
    recurring: Number(line.recurringFee) || 0,
    recurringHigh: Number(line.recurringFeeHigh) || 0,
    once: cents((Number(line.oneOffFee) || 0) + setup),
    onceHigh: cents((Number(line.oneOffFeeHigh) || 0) + setupHigh),
    setup,
    setupHigh,
    years,
    // Across the term: the recurring slice every year, the one-off money
    // once. Setup is one-time whatever the service is, so it is added in
    // rather than multiplied — the same reading estimateScope gives it.
    contract: line.priced ? cents((Number(line.value) || 0) + setup) : null,
    contractHigh: line.priced ? cents((Number(line.valueHigh) || 0) + setupHigh) : null,
    // The share of the deal, rounded the way the panel behind this one
    // rounds it, so the popup and the row it opened from agree.
    share: dealTotal > 0 && year1 > 0 ? Math.round((year1 / dealTotal) * 100) : 0,
  };
}

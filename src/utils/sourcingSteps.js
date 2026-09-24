// What Step by step on the Sourcing subtab shows ABOUT the choices made so
// far, as opposed to the inputs for them: a line per step for the summary
// strip, and what each option on a picker step would come to for this site.
//
// Kept out of the component so the wording and the what-ifs are pinned by a
// test rather than only by looking at the page.

import {
  CONTRACT_TYPES, SAVINGS_BASES, VOLUME_SHAPES, addMonths, buildSavings,
} from './nymexSavings.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtPrice = (n) => (Number.isFinite(n) ? `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(3)}` : '-');
const fmtUsd = (n) => (Number.isFinite(n) ? `${n < 0 ? '-' : ''}$${Math.round(Math.abs(n)).toLocaleString('en-US')}` : '-');
const fmtVol = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '-');

/**
 * The term's totals for each value of one scenario field, everything else
 * held as it is: what the site would save on each contract type, or measured
 * each way. Term only, no look-back, which leaves the term's totals
 * untouched and keeps the what-ifs cheap.
 */
export function compareOption(scenario, series, forward, field, keys) {
  const out = {};
  for (const key of keys) {
    out[key] = buildSavings({ ...scenario, [field]: key, lookback: 0 }, series, forward).totals;
  }
  return out;
}

/** What the contract type locks, in a few words. */
export function contractTypeSummary(s, hedge) {
  if (s.contractType === 'fixed') return `${CONTRACT_TYPES.fixed.label}, ${fmtPrice(s.fixedRate)} all-in`;
  if (s.contractType === 'index') return `${CONTRACT_TYPES.index.label}, nothing locked`;
  return `${CONTRACT_TYPES.layered.label}, ${Math.round(hedge?.pct ?? 0)}% locked`
    + (hedge?.price != null ? ` at ${fmtPrice(hedge.price)}` : '');
}

/** What the saving is measured against, with the number that sets it. */
export function savingsBasisSummary(s) {
  if (s.savingsBasis === 'contract') return `${SAVINGS_BASES.contract.label}, vs ${fmtPrice(s.currentRate)} today`;
  if (s.savingsBasis === 'avoided') {
    return `${SAVINGS_BASES.avoided.label}, ${(s.noActionPct - s.strategyPct).toFixed(1)}% avoided`;
  }
  return SAVINGS_BASES.index.label;
}

/** How much it burns, and where that number came from. */
export function consumptionSummary(s, totals) {
  const entered = totals?.enteredVolumeMonths || 0;
  const shape = (VOLUME_SHAPES[s.volumeShape] || VOLUME_SHAPES.even).label.toLowerCase();
  return entered
    ? `${fmtVol(totals.volume)} Dth over the term, ${entered} month${entered === 1 ? '' : 's'} entered`
    : `${fmtVol(s.annualVolumeDth)} Dth a year, ${shape}`;
}

/** The term, first month to last. */
export function termSummary(s) {
  const end = addMonths(s.startYear, s.startMonth, s.termMonths - 1);
  return `${MONTHS[s.startMonth - 1]} ${s.startYear} to ${MONTHS[end.month - 1]} ${end.year}, ${s.termMonths} mo`;
}

/**
 * The saving under every category at once, short enough for one line:
 * "Index $143,445 · Contract $9,299 · Avoided $52,371". `byBasis` is
 * compareOption's result over the savings bases.
 */
export function savingsCategoriesSummary(byBasis) {
  if (!byBasis) return '-';
  const short = { index: 'Index', contract: 'Contract', avoided: 'Avoided' };
  return Object.keys(SAVINGS_BASES)
    .filter(k => byBasis[k])
    .map(k => `${short[k]} ${fmtUsd(byBasis[k].saving)}`)
    .join(' · ');
}

/**
 * One line per step, in step order, for the summary strip: { n, label, value }.
 * `run` is buildSavings' result for the same scenario, and `byBasis` the
 * saving under each category (see savingsCategoriesSummary).
 */
export function stepSummaries(s, run, byBasis = null) {
  return [
    { n: 1, label: 'Site', value: String(s.name || '').trim() || 'Not named yet' },
    { n: 2, label: 'Contract type', value: contractTypeSummary(s, run?.hedge) },
    { n: 3, label: 'Consumption', value: consumptionSummary(s, run?.totals) },
    { n: 4, label: 'Contract details', value: termSummary(s) },
    { n: 5, label: 'Savings', value: savingsCategoriesSummary(byBasis) },
  ];
}

/** The headline the strip ends on: the saving over the term, and per Dth. */
export function resultSummary(run) {
  const t = run?.totals || {};
  return {
    saving: fmtUsd(t.saving),
    perDth: fmtPrice(t.savingPerDth),
    good: (t.saving ?? 0) >= 0,
  };
}

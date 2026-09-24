// The margin to suggest in the Final Margin box of the close-out popups
// (Sold and Not Sold), read off the SIA pricing option attached to the opp.
//
// Saving an SIA option to an opp freezes its deal margin onto the record
// (`_pricingOption`, see buildPricingOptionSnapshot). The margin over the
// full term is `finalMargin`; older or partial snapshots may only carry the
// year-by-year margins or the term totals behind them, so those are read too,
// in that order, rather than showing nothing.
//
// When an option IS attached but no margin can be read off it, the popup
// says why instead of staying silent, since a missing suggestion otherwise
// looks like the feature is broken:
//   - 'handBuilt': the option came from the hand-built Options subtab, which
//     has no cost side, so there is no margin to have.
//   - 'noMargin':  an SIA option with no margin saved (no cost linked, or it
//     was saved before margins were tracked). Re-saving it fixes that.

import { fmtMarginPct } from './pricingOptionCalc.js';

// The Pricing-option link's name and surface. Same reading as
// pricingOptionLinks.js's optionLinkName / optionLinkSource (a plain string
// is the legacy name-only shape), kept here so this stays free of the
// IndexedDB layer that module pulls in.
const linkName = (link) => (typeof link === 'string' ? link.trim() : String(link?.name || '').trim());
const linkSource = (link) => (link && typeof link === 'object' ? String(link.source || '').trim() : '');

const finite = (n) => typeof n === 'number' && Number.isFinite(n);

/** The term margin a pricing snapshot carries, as a fraction, or null. */
export function snapshotMargin(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  if (finite(snapshot.finalMargin)) return { pct: snapshot.finalMargin, from: 'final' };
  const years = Array.isArray(snapshot.marginByYear) ? snapshot.marginByYear.filter(finite) : [];
  // Cumulative margins: the last year's is the margin over the term.
  if (years.length) return { pct: years[years.length - 1], from: 'years' };
  if (finite(snapshot.termRevenue) && finite(snapshot.termCost) && snapshot.termRevenue > 0) {
    return { pct: (snapshot.termRevenue - snapshot.termCost) / snapshot.termRevenue, from: 'totals' };
  }
  return null;
}

/**
 * What to suggest for an opp: `{ text, pct, optionName, from }` when there is
 * a margin, `{ text: '', optionName, reason }` when an option is attached but
 * has none, or null when nothing is attached. `link` is the opp's entry in
 * the Pricing-option links map (optional).
 */
export function suggestedFinalMargin(opp, link = null) {
  const snapshot = opp?._pricingOption;
  const optionName = String(snapshot?.name || linkName(link) || '').trim();
  const found = snapshotMargin(snapshot);
  if (found) {
    return { text: fmtMarginPct(found.pct), pct: found.pct, optionName, from: found.from };
  }
  if (!snapshot && !optionName) return null;
  return {
    text: '',
    pct: null,
    optionName,
    reason: linkSource(link) === 'options' ? 'handBuilt' : 'noMargin',
  };
}

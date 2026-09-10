// The counts a deal is priced against, and where each of them came from.
//
// Pricing a scope needs numbers about the account: a per-site service wants
// the site count, a per-account service wants the account count. Two records
// hold them and neither holds them all — the opp carries its own Sites (what
// THIS deal covers), and the company card carries the portfolio's Sites,
// Sites w/ Mandate and Accounts (what the account HAS).
//
// So the deal-size prompt reads both, and says which of the two answered.
// That is the whole point of showing them: a fee worked out against 6,176
// sites when the deal covers 40 of them is wrong in a way no total will
// reveal, and a fee of $0 because nobody has ever recorded a meter count
// reads identically to a service that is genuinely free.
//
// The opp wins where both answer. A portfolio count is what the account has;
// a count typed against the opp is what the deal covers, and the second is
// the more specific claim — the same rule clientCounts follows on the Deal
// Sizing page.
//
// Pure — records in, plain numbers out — so the rules can be tested without
// a browser.

import { parseMoney } from './servicePricing.js';
import { CLIENT_COUNT_FIELDS } from './clientDealSizing.js';

// Where a count can come from, in the order the answer is taken.
export const COUNT_SOURCE_OPP = 'opp';
export const COUNT_SOURCE_COMPANY = 'company';

// The opp's own count columns, by the unit they answer. Sites is the only
// one the Opps sheet carries; the rest of the vocabulary lives on the
// company card or nowhere at all.
const OPP_COUNT_COLUMNS = [
  { unit: 'sites', column: 'Sites' },
];

/**
 * Every count known for a deal, as { counts, chips }.
 *
 *   counts  { unit: number } — what the estimator prices against
 *   chips   [{ unit, label, value, source, from }] — the same numbers with
 *           the record each came from, for the line above the table
 *
 * Only the counts that ARE known. What is missing depends on what the scope
 * charges on, which depends on the estimate, which prices against these — so
 * the missing ones are a second pass (see missingUnitChips).
 */
export function oppDealCounts({ opp, company, units = null } = {}) {
  const labels = new Map((units || []).map(u => [u.unit, u.label]));
  const labelFor = (unit) => labels.get(unit) || unit;
  const counts = {};
  const chips = [];
  const companyName = String(company?.company || '').trim();

  for (const { unit, column } of OPP_COUNT_COLUMNS) {
    const n = parseMoney(opp?.[column]);
    if (n === null || n <= 0) continue;
    counts[unit] = n;
    chips.push({ unit, label: labelFor(unit), value: n, source: COUNT_SOURCE_OPP, from: 'this opp' });
  }

  for (const { unit, field } of CLIENT_COUNT_FIELDS) {
    if (counts[unit] !== undefined) continue;
    const n = parseMoney(company?.[field]);
    if (n === null || n <= 0) continue;
    counts[unit] = n;
    chips.push({
      unit,
      label: labelFor(unit),
      value: n,
      source: COUNT_SOURCE_COMPANY,
      from: companyName ? `${companyName}’s company card` : 'the company card',
    });
  }

  return { counts, chips };
}

/**
 * The counts a scope charges on that nothing has recorded, as chips with no
 * value — appended after the known ones.
 *
 * A separate pass because of the order things are known in: what the scope
 * charges on comes out of the estimate, and the estimate prices against the
 * counts above. It is also the right rule on its own — a missing meter count
 * matters on a deal with a per-meter service in it, and is noise on every
 * other deal, so nothing is reported as missing until something asks for it.
 */
export function missingUnitChips({ counts = {}, needed = null, units = null } = {}) {
  const labels = new Map((units || []).map(u => [u.unit, u.label]));
  const out = [];
  for (const unit of (needed || [])) {
    if (counts[unit] !== undefined) continue;
    out.push({ unit, label: labels.get(unit) || unit, value: null, source: null, from: null });
  }
  return out;
}

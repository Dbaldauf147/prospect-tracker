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

import { parseMoney, PROJECT_UNIT } from './servicePricing.js';
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

const OPP_COLUMN_BY_UNIT = new Map(OPP_COUNT_COLUMNS.map(c => [c.unit, c.column]));
const COMPANY_FIELD_BY_UNIT = new Map(CLIENT_COUNT_FIELDS.map(f => [f.unit, f.field]));

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

/**
 * The counts a deal is priced against, as rows that can be TYPED INTO.
 *
 * Reading them is one job and answering them is another. The chips above say
 * what is known and what is missing; this says, for each of those, which box
 * the number goes in and which record that box writes to — because a count
 * nobody has recorded is the reason a fee below reads $0, and the errand of
 * going to find the right record to put it in is the reason it stays that
 * way.
 *
 * Returns one row per unit worth answering, in `units` order:
 *
 *   { unit, label, value, source, from, needed,
 *     target, column, field, blocked }
 *
 *   value    what prices the deal today, or null
 *   source   which record that came from ('opp' | 'company' | null)
 *   needed   some service in this scope charges on it
 *   target   which record typing here writes to, or null when nowhere can
 *   column   the opp column to write, when target is 'opp'
 *   field    the company-card field to write, when target is 'company'
 *   blocked  why there is nowhere to write: 'no-company' (nothing on the
 *            Table View matches this Account) or 'no-field' (no record
 *            carries this unit at all)
 *
 * You edit the record the number CAME FROM, and where there is no number,
 * the record that owns that fact — the opp for what this deal covers, the
 * company card for what the account has. That keeps the box you type in and
 * the number that prices the deal the same number: routing a site count to
 * the opp column while the card's 6,176 goes on pricing it would show an
 * empty box above a fee worked against a figure the box never held.
 *
 * `projects` is left out. It is a fact about the SERVICE rather than the
 * account — three lighting retrofits and a chiller replacement is four
 * projects and neither service is priced on four — so it is asked per
 * service on the rate card and there is no single account number to type.
 */
export function dealCountRows({ opp, company, units = null, needed = null } = {}) {
  const { counts, chips } = oppDealCounts({ opp, company, units });
  const chipByUnit = new Map(chips.map(c => [c.unit, c]));
  const labels = new Map((units || []).map(u => [u.unit, u.label]));
  const want = new Set(needed || []);
  const rows = [];
  const seen = new Set();

  const push = (unit) => {
    if (!unit || seen.has(unit) || unit === PROJECT_UNIT) return;
    const known = counts[unit];
    // A unit is worth a box when it already answers something or when some
    // service in this scope charges on it. Every other unit in the
    // vocabulary is noise on this deal.
    if (known === undefined && !want.has(unit)) return;
    seen.add(unit);
    const chip = chipByUnit.get(unit) || null;
    const source = chip?.source || null;
    const owner = OPP_COLUMN_BY_UNIT.has(unit)
      ? COUNT_SOURCE_OPP
      : (COMPANY_FIELD_BY_UNIT.has(unit) ? COUNT_SOURCE_COMPANY : null);
    let target = source || owner;
    let blocked = null;
    // A company field with no company behind it is not a place to write. The
    // row still shows - the count is still why a fee reads $0 - it just says
    // the Account matches no card rather than offering a box that drops what
    // is typed into it.
    if (target === COUNT_SOURCE_COMPANY && !company) { target = null; blocked = 'no-company'; }
    else if (!target) blocked = 'no-field';
    rows.push({
      unit,
      label: labels.get(unit) || chip?.label || unit,
      value: known === undefined ? null : known,
      source,
      from: chip?.from || null,
      needed: want.has(unit),
      target,
      column: target === COUNT_SOURCE_OPP ? (OPP_COLUMN_BY_UNIT.get(unit) || null) : null,
      field: target === COUNT_SOURCE_COMPANY ? (COMPANY_FIELD_BY_UNIT.get(unit) || null) : null,
      blocked,
    });
  };

  for (const u of (units || [])) push(u.unit);
  for (const unit of Object.keys(counts)) push(unit);
  for (const unit of want) push(unit);
  return rows;
}

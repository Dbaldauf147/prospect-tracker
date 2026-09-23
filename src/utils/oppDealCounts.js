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

import { parseMoney, PROJECT_UNIT, projectServiceLines, basisFor, PRICING_BASES } from './servicePricing.js';
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
 * `offer` widens that: units listed there get a row even when this scope
 * charges on none of them and no record answers them, and are NOT marked
 * needed — nothing below is waiting on them. That is for the "show every
 * count" case: the account's meters are worth recording while the card is
 * open whether or not today's deal happens to price on them. An offered
 * unit with nowhere to write is dropped rather than shown blocked, because
 * an offer is only an offer where the number can be saved; a unit this
 * scope actually needs still shows its blocker.
 *
 * `projects` is left out. It is a fact about the SERVICE rather than the
 * account — three lighting retrofits and a chiller replacement is four
 * projects and neither service is priced on four — so it is asked per
 * service on the rate card and there is no single account number to type.
 */
export function dealCountRows({ opp, company, units = null, needed = null, offer = null } = {}) {
  const { counts, chips } = oppDealCounts({ opp, company, units });
  const chipByUnit = new Map(chips.map(c => [c.unit, c]));
  const labels = new Map((units || []).map(u => [u.unit, u.label]));
  const want = new Set(needed || []);
  const offered = new Set(offer || []);
  const rows = [];
  const seen = new Set();

  const push = (unit) => {
    if (!unit || seen.has(unit) || unit === PROJECT_UNIT) return;
    const known = counts[unit];
    // A unit is worth a box when it already answers something, when some
    // service in this scope charges on it, or when the caller asked for the
    // whole vocabulary. Every other unit is noise on this deal.
    if (known === undefined && !want.has(unit) && !offered.has(unit)) return;
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
    // A row nothing is waiting on, that nothing has answered, and that there
    // is nowhere to answer, is a box that would swallow what is typed into
    // it. Offering that is worse than offering nothing.
    if (!target && known === undefined && !want.has(unit)) { seen.delete(unit); return; }
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
  for (const unit of offered) push(unit);
  return rows;
}

// ── Per-service counts ───────────────────────────────────────────────────
//
// One unit is not a fact about the account at all. Sites, accounts and
// meters answer the same number whichever service reads them; PROJECTS do
// not - a scope of three lighting retrofits and one chiller replacement is
// four projects, and neither service is priced on four. So a project count
// is asked per service, and kept on the opp beside the other answers this
// deal carries: it is a fact about the work being sold, not about the
// portfolio, and writing it to the company card would price every other
// deal on the account off this one's retrofit.
//
// Stored as a JSON object of service name -> count on the opp. Names are
// matched without case, so a service that comes back capitalised
// differently still finds the number somebody typed for it.
export const COUNT_SOURCE_SERVICE = 'service';
export const SERVICE_UNITS_FIELD = '_serviceUnits';

/** The raw stored map, keyed lowercase. Anything unparseable reads empty. */
export function serviceUnitsMap(opp) {
  const raw = opp?.[SERVICE_UNITS_FIELD];
  if (!raw) return {};
  let obj = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { return {}; }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out = {};
  for (const [name, value] of Object.entries(obj)) {
    const key = String(name || '').trim().toLowerCase();
    const n = parseMoney(value);
    // A typed zero is an answer ("this deal carries none"), so it is kept;
    // anything that isn't a number at all never was one.
    if (!key || n === null || n < 0) continue;
    out[key] = n;
  }
  return out;
}

/**
 * The same counts spelled the way the scope spells its services, which is
 * the shape estimateScope's `serviceUnits` is read in (it looks a name up
 * exactly). A scope that has since re-cased a name still prices off the
 * number typed against it.
 */
export function serviceUnitsForScope(opp, names) {
  const stored = serviceUnitsMap(opp);
  if (Object.keys(stored).length === 0) return null;
  const out = {};
  for (const name of names || []) {
    const n = stored[String(name || '').trim().toLowerCase()];
    if (n !== undefined) out[name] = n;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * The stored map with one service's count set or cleared, as the string the
 * opp field holds. `n` of null clears it - "nobody has said", which is what
 * a blank box means, and which prices the service on its fallback again.
 *
 * Returns '' when nothing is left, so an opp that carries no answers carries
 * no field either rather than an empty object nobody can see.
 */
export function setServiceUnitValue(opp, name, n) {
  const key = String(name || '').trim();
  if (!key) return opp?.[SERVICE_UNITS_FIELD] ?? '';
  const lower = key.toLowerCase();
  const raw = opp?.[SERVICE_UNITS_FIELD];
  let current = raw;
  if (typeof raw === 'string') {
    try { current = JSON.parse(raw); } catch { current = {}; }
  }
  const next = {};
  for (const [k, v] of Object.entries((current && typeof current === 'object' && !Array.isArray(current)) ? current : {})) {
    // Drop whatever spelling this service was stored under, so setting a
    // count can't leave a second copy of it behind under the old casing.
    if (String(k || '').trim().toLowerCase() === lower) continue;
    next[k] = v;
  }
  if (n !== null && n !== undefined && Number.isFinite(n) && n >= 0) next[key] = n;
  return Object.keys(next).length ? JSON.stringify(next) : '';
}

/**
 * A box per service in the scope that is priced per project.
 *
 * `lines` is the estimate's own lines, so the list is whatever the rate card
 * actually charges per project today - a service that stops being project
 * work stops being asked about, and one that starts being it appears without
 * anybody listing it anywhere.
 *
 * Rows are the shape dealCountRows returns, so the same box renders them:
 *
 *   { unit, service, label, value, placeholder, needed, target, blocked }
 *
 *   value       what somebody typed for this deal, or null
 *   placeholder the count the estimate is using while the box is blank,
 *               which is the shared Projects count where there is one and
 *               otherwise a single project
 *   needed      the line priced to nothing for want of this count
 *
 * `canWrite` false means the caller has nowhere to save an answer, and the
 * row says so rather than offering a box that swallows what is typed in it.
 */
export function projectCountRows({ lines, opp = null, bases = undefined, canWrite = true } = {}) {
  const stored = serviceUnitsMap(opp);
  return projectServiceLines(lines, bases).map((line) => {
    const typed = stored[String(line.name || '').trim().toLowerCase()];
    return {
      unit: PROJECT_UNIT,
      service: line.name,
      label: line.name,
      value: typed === undefined ? null : typed,
      // What the estimate is pricing on right now. `units` is the count the
      // line actually used, so a blank box says what it is falling back to
      // rather than making the reader guess at it.
      placeholder: line.units === null || line.units === undefined ? '1' : String(line.units),
      source: typed === undefined ? null : COUNT_SOURCE_SERVICE,
      from: 'this opp',
      needed: !!line.gap && line.gap.kind === 'units',
      target: canWrite ? COUNT_SOURCE_SERVICE : null,
      column: null,
      field: null,
      blocked: canWrite ? null : 'no-field',
    };
  });
}

/**
 * The count box on one row of the Scope services table, or null where the
 * service isn't charged on a count of its own.
 *
 * Projects are not the only count worth giving per service. A deal selling
 * bill pay across 207 sites and BPS reporting across the 70 of them under a
 * mandate is two different numbers, and the shared Sites box can only hold
 * one. So any service charged per unit can carry its own count for this
 * deal, kept in the same per-service map the project counts use, which
 * estimateScope already prices against (`serviceUnits`).
 *
 * The count follows the service's own basis unit, because that is the unit
 * the estimator lays a typed count over (see lineContext): a service billed
 * per site takes a site count, one billed per site w/ mandate takes that.
 * A service whose headline basis is not a count (flat, a percentage) has no
 * box, even when a setup line under it is per site: the estimator would
 * ignore the number, and a box that changes nothing is worse than none.
 *
 *   { unit, unitLabel, used }
 *
 *   used   the count the line is priced on right now, whichever answered it
 *          (a count typed here, the rate card's own, or the shared box), or
 *          null when nothing has. It is the box's placeholder while blank.
 */
export function serviceCountCell(line, bases = PRICING_BASES) {
  const basis = basisFor(line?.entry?.basis, bases || PRICING_BASES);
  if (!basis || basis.kind !== 'unit' || !basis.unit) return null;
  // Every priced part of the service that is charged on this unit reads the
  // same count, so the first one found says what it is.
  const parts = [
    ...(Array.isArray(line?.breakdown) ? line.breakdown : []),
    ...(Array.isArray(line?.setupBreakdown) ? line.setupBreakdown : []),
  ];
  const part = parts.find(p => p?.unit === basis.unit && p.units !== undefined);
  let used = null;
  let typed = false;
  if (part) { used = part.units; typed = !!part.unitsTyped; }
  else if (line?.unit === basis.unit) { used = line.units; typed = !!line.unitsTyped; }
  // An unanswered count prices at 0, which is "none yet", not a count: only
  // a zero somebody typed is one.
  if (!typed && Number(used) <= 0) used = null;
  return {
    unit: basis.unit,
    unitLabel: basis.unitLabel || basis.unit,
    used: used === null || used === undefined || !Number.isFinite(Number(used)) ? null : Number(used),
  };
}

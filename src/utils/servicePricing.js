// The rate card behind Dropdowns › Services Pricing.
//
// One entry per service, keyed by the service's name on the Solutions list —
// the same key serviceOverrides and serviceLinks use, so a service added or
// renamed on the Services subtab is the same service here. Nothing is seeded:
// a service with no entry is simply unpriced, and the estimator says so rather
// than guessing a number for it.
//
// An entry is { basis, rate, minFee, units, avgFee, notes }:
//   basis  — which pricing basis key the fee is worked out from
//   rate   — dollars per unit, a flat dollar figure, or a percentage,
//            depending on the basis. The LOW end of the range when a
//            rateHigh is set, and the whole of it when one isn't.
//   rateHigh — the top of the rate range, when a service is quoted as a
//            spread rather than a figure ("$450 to $600 a site"). Optional:
//            without it every estimate is a single number, exactly as it
//            was before ranges existed. With it, every fee, every total
//            and every saved analysis reads as a range, because a range
//            that collapses to its bottom end the moment it's added up
//            would be worse than not having one.
//   minFee — dollar floor applied to unit- and percentage-based fees
//   units  — how many units THIS service is charged on. Overrides the
//            estimator's count for that unit, because a service is often
//            sold on a slice of the account rather than all of it: 819
//            sites on file, invoice processing at 40 of them. Blank hands
//            the row back to the shared count.
//            This one is the STANDING default, the same on every deal. The
//            figure typed into the Units column belongs to the estimate
//            being built instead (scenario.serviceUnits, passed to
//            estimateScope), because 40 of 819 sites is a fact about one
//            deal and typing it shouldn't re-price every other one.
//   avgFee — a fee typed straight into the Estimated Year 1 Fee column:
//            what this service usually sells for. It OVERRIDES the basis
//            and rate would work out to, because it is the more direct
//            statement — someone who types "$40,000" into the fee column
//            is answering the question the rate card exists to answer, and
//            a model that quietly outvoted them would be useless. Clearing
//            it hands the row back to the basis. A service can carry only
//            an avgFee and no basis at all, which is the quick way to
//            price one: a number, no model behind it.
//   setup  — the one-time cost of standing the service up, as a list of
//            components rather than a single figure: a setup fee is
//            usually an implementation charge plus a per-something
//            onboarding cost, and a lone number can't be argued with a
//            year later. Each component is
//            { label, kind: 'fixed' | 'unit', amount, basis }:
//            a fixed one is dollars flat, a per-unit one is dollars times
//            the count its basis names (the same counts the recurring
//            side multiplies, so an onboarding charge per site follows
//            the site count without anyone retyping it). Optional and
//            empty by default, so a service without one prices exactly as
//            it did before setup fees existed.
//   notes  — free text, for the assumptions a number can't carry
//
// Stored under settings.servicePricing so it syncs across devices with the
// rest of the dropdown vocabulary.

// The three shapes a fee can take. A basis is one of these plus, for a
// per-unit one, the count it multiplies.
export const BASIS_KINDS = [
  { kind: 'flat',    label: 'Flat fee',       hint: 'One figure, whatever the account looks like' },
  { kind: 'unit',    label: 'Per unit',       hint: 'Rate × a count — sites, meters, invoices, anything you name' },
  { kind: 'percent', label: '% of deal size', hint: 'A cut of the deal size typed into the estimator' },
];

const KIND_KEYS = new Set(BASIS_KINDS.map(k => k.kind));

// How a service's fee is worked out, as it ships. `unit` names the count the
// fee multiplies — the estimator asks for one input per distinct unit that
// the services in scope actually use, so a basis carrying a unit brings its
// box to the estimator without any further wiring.
//
// This is the starting vocabulary, not the whole of it: the Pricing bases
// editor on the Services Pricing tab saves an edited list to
// settings.pricingBases, and resolvePricingBases prefers that when it's
// there. Everything downstream takes the resolved list as an argument, so a
// basis someone added prices exactly like one that shipped.
export const PRICING_BASES = [
  { key: 'flat',        label: 'Flat fee',       kind: 'flat',    unit: null,       unitLabel: null },
  { key: 'per_site',    label: 'Per site',       kind: 'unit',    unit: 'sites',    unitLabel: 'Sites' },
  { key: 'per_account', label: 'Per account',    kind: 'unit',    unit: 'accounts', unitLabel: 'Accounts' },
  { key: 'per_meter',   label: 'Per meter',      kind: 'unit',    unit: 'meters',   unitLabel: 'Meters' },
  { key: 'per_invoice', label: 'Per invoice',    kind: 'unit',    unit: 'invoices', unitLabel: 'Invoices' },
  { key: 'per_mwh',     label: 'Per MWh',        kind: 'unit',    unit: 'mwh',      unitLabel: 'MWh' },
  { key: 'per_user',    label: 'Per user',       kind: 'unit',    unit: 'users',    unitLabel: 'Users' },
  // A job done a number of times over — three retrofits at a figure each —
  // rather than one flat fee for the lot, which is what Flat fee already
  // says. The count box asks how many.
  { key: 'per_project',   label: 'Per project',   kind: 'unit',  unit: 'projects',  unitLabel: 'Projects' },
  // Priced against the kit itself: chillers, boilers, EV chargers. Its own
  // count rather than a share of the meter count, because a site's meters
  // and its equipment aren't the same number and never were.
  { key: 'per_equipment', label: 'Per equipment', kind: 'unit',  unit: 'equipment', unitLabel: 'Equipment' },
  { key: 'pct_deal',    label: '% of deal size', kind: 'percent', unit: null,       unitLabel: null },
];

// The built-in list has a version, and each basis knows which version added
// it. A saved list is the user's own vocabulary, so nothing is ever quietly
// put back into it — but a basis that didn't exist when they saved is one
// they never chose to leave out, and without this the only way to see a new
// default would be Reset to defaults, which throws their own bases away.
// See pricingBasesTopUp.
export const PRICING_BASES_VERSION = 2;
const BASIS_ADDED_IN = { per_project: 2, per_equipment: 2 };

// A key out of a label: lowercase, words joined by underscores, and a
// numeric suffix when that key is already taken. Keys are what the saved
// rate card points at, so they're generated once and then left alone —
// renaming a basis keeps every service priced on it.
//
// Derived from the label rather than minted fresh, which is what makes a
// deleted basis recoverable: the services priced on "Per site" still say
// `per_site`, so adding "Per site" back under that name picks their rates
// straight back up. Same for a unit and the counts typed against it.
function keyFrom(label, taken) {
  const root = String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'custom';
  if (!taken?.has(root)) return root;
  let n = 2;
  while (taken.has(`${root}_${n}`)) n += 1;
  return `${root}_${n}`;
}

export function makeBasisKey(label, taken) { return keyFrom(label, taken); }
export function makeUnitKey(label, taken) { return keyFrom(label, taken); }

// A saved bases list, cleaned up: kinds it doesn't recognise, entries with
// no label, per-unit entries with no unit and duplicate keys all drop out.
// Returns null when there's nothing usable left, which is the caller's cue
// to fall back to the built-in list rather than show an empty picklist.
export function normalizePricingBases(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const key = String(item?.key || '').trim();
    const label = String(item?.label || '').trim();
    const kind = String(item?.kind || '').trim();
    if (!key || !label || !KIND_KEYS.has(kind) || seen.has(key)) continue;
    const unit = kind === 'unit' ? String(item?.unit || '').trim() : '';
    const unitLabel = kind === 'unit' ? String(item?.unitLabel || '').trim() : '';
    if (kind === 'unit' && (!unit || !unitLabel)) continue;
    seen.add(key);
    out.push({ key, label, kind, unit: unit || null, unitLabel: unitLabel || null });
  }
  return out.length > 0 ? out : null;
}

// The bases in force: the user's edited list when they have one, the
// built-in list otherwise.
export function resolvePricingBases(settings) {
  return normalizePricingBases(settings?.pricingBases) || PRICING_BASES;
}

/**
 * The settings patch that brings a saved bases list up to the current
 * built-in version, or null when there's nothing to do — no saved list (the
 * built-ins are already in force), or one that's already current.
 *
 * Only bases introduced since the version the list was saved at are added,
 * so a basis the user deleted stays deleted. New ones go on the end: their
 * own ordering is theirs.
 */
export function pricingBasesTopUp(settings) {
  const saved = normalizePricingBases(settings?.pricingBases);
  if (!saved) return null;
  const from = Number(settings?.pricingBasesVersion) || 1;
  if (from >= PRICING_BASES_VERSION) return null;
  const have = new Set(saved.map(b => b.key));
  const added = PRICING_BASES.filter(b => (BASIS_ADDED_IN[b.key] || 1) > from && !have.has(b.key));
  const patch = { pricingBasesVersion: PRICING_BASES_VERSION };
  if (added.length > 0) patch.pricingBases = [...saved, ...added];
  return patch;
}

export function basisFor(key, bases = PRICING_BASES) {
  const k = String(key || '');
  if (!k) return null;
  return (bases || PRICING_BASES).find(b => b.key === k) || null;
}

// Every unit the bases can multiply, in the order they declare them — the
// estimator lays its count boxes out in this order so they don't jump around
// as services come in and out of scope. Two bases sharing a unit (per site
// and per site-visit, say) share the one count box.
export function pricingUnits(bases = PRICING_BASES) {
  const seen = new Set();
  const out = [];
  for (const b of bases || []) {
    if (!b.unit || seen.has(b.unit)) continue;
    seen.add(b.unit);
    out.push({ unit: b.unit, label: b.unitLabel });
  }
  return out;
}

export const PRICING_UNITS = pricingUnits(PRICING_BASES);

// The unit the built-in "Per project" basis counts.
//
// Projects are the one unit a single shared count can't answer. Sites,
// accounts and meters are facts about the ACCOUNT — 819 sites is 819 sites,
// whichever service is reading it. A project count is a fact about the
// SERVICE: a scope of three lighting retrofits and one chiller replacement
// is four projects, and neither service is priced on four. So the estimator
// asks per service for these — see projectServiceLines, and the panel it
// feeds on the Services Pricing tab.
export const PROJECT_UNIT = 'projects';

/**
 * The lines of an estimate that are priced per project, in the order they
 * came. `lines` is estimateScope()'s output for the services in scope.
 *
 * A line whose fee was typed straight into the rate card is still one of
 * them: it belongs in the panel because it is part of the project work,
 * even though its count no longer moves its fee. The caller says so on the
 * row rather than dropping it, which would read as the service having
 * fallen out of scope.
 */
export function projectServiceLines(lines, bases = PRICING_BASES) {
  return (lines || []).filter(
    line => basisFor(line?.entry?.basis, bases)?.unit === PROJECT_UNIT,
  );
}

// How many services are priced on each basis, keyed by basis key. What the
// editor needs before it lets someone delete one: a basis with rows behind
// it takes their pricing with it.
export function basisUsage(pricing) {
  const counts = new Map();
  for (const row of Object.values(pricing || {})) {
    const key = String(row?.basis || '');
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

// A number out of whatever the user typed: "$1,200" and "1200" both read as
// 1200, anything that isn't a finite number reads as null. Used for both the
// stored rates and the estimator's own inputs, so the two can't disagree
// about what counts as a number.
export function parseMoney(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value ?? '').replace(/[$,\s%]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Whole dollars. Deal figures here run to six and seven digits, where cents
// are noise — a rate of $12.50 per meter is the exception, so fractional
// rates keep their cents and totals don't.
export function formatMoney(value, { cents = false } = {}) {
  const n = parseMoney(value);
  if (n === null) return '';
  const decimals = cents || (Math.abs(n) < 1000 && !Number.isInteger(n)) ? 2 : 0;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

// A rate as it reads in its own column: "$450" per unit, "3.5%" of the
// deal, "$450–$600" when it's quoted as a range.
export function formatRate(entry, bases = PRICING_BASES) {
  const basis = basisFor(entry?.basis, bases);
  const rate = parseMoney(entry?.rate);
  if (!basis || rate === null) return '';
  const high = parseMoney(entry?.rateHigh);
  const one = (n) => (basis.kind === 'percent' ? `${n}%` : formatMoney(n));
  if (high === null || high === rate) return one(rate);
  return `${one(Math.min(rate, high))}–${one(Math.max(rate, high))}`;
}

// A money figure, or a range of them: "$45,000" when both ends agree,
// "$45,000 – $60,000" when they don't. One place, because a range that
// formats differently in the table, the bar and the saved analysis reads
// as three different numbers.
export function formatMoneyRange(low, high) {
  const lo = parseMoney(low);
  const hi = parseMoney(high);
  if (lo === null && hi === null) return '';
  if (lo === null) return formatMoney(hi);
  if (hi === null || hi === lo) return formatMoney(lo);
  return `${formatMoney(Math.min(lo, hi))} – ${formatMoney(Math.max(lo, hi))}`;
}

// ---- Setup fees ----------------------------------------------------------
//
// The one-time cost of standing a service up, kept apart from the recurring
// fee it sits beside: the two are billed differently, land in different
// years and get negotiated separately, and a single "fee" column that
// quietly mixed them would misstate both. A setup fee is a list of
// components so it can be taken apart — an implementation charge plus a
// per-site onboarding cost is the normal shape of one, and "$18,850" on its
// own is a number nobody can check.

// The two shapes a component takes. Per-unit ones borrow the pricing bases,
// so a setup charged per site multiplies the same count the recurring side
// does and the estimator asks for it exactly once.
export const SETUP_KINDS = [
  { kind: 'fixed', label: 'Fixed', hint: 'A flat figure, whatever the account looks like' },
  { kind: 'unit',  label: 'Per unit', hint: 'A rate times a count — sites, meters, users' },
];

// A stored setup list, cleaned up: components with no amount, per-unit ones
// naming a basis that isn't per-unit (or is gone from an edited bases list),
// and anything that isn't an object all drop out. Always an array, so a
// caller never has to guard, and an entry whose list cleans up to nothing
// reads as having no setup fee at all.
export function normalizeSetup(raw, bases = PRICING_BASES) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const amount = parseMoney(item.amount);
    if (amount === null || amount < 0) continue;
    const kind = item.kind === 'unit' ? 'unit' : 'fixed';
    const label = String(item.label || '').trim();
    if (kind === 'fixed') { out.push({ label, kind, amount, basis: '' }); continue; }
    const basis = basisFor(item.basis, bases);
    // A per-unit component with no unit behind it can't be multiplied by
    // anything. Dropping it rather than treating it as flat keeps a
    // renamed-away basis from silently becoming a fixed charge.
    if (!basis || basis.kind !== 'unit') continue;
    out.push({ label, kind, amount, basis: basis.key });
  }
  return out;
}

// The count one per-unit component multiplies. The service's own unit count
// wins when the component is charged on the same unit the service is — a
// service sold on 40 of 819 sites is onboarded at 40 of them too — and the
// shared count from the estimator answers for everything else.
function setupUnitsFor(component, { counts, ownUnit, ownUnits, bases }) {
  const basis = basisFor(component?.basis, bases);
  if (!basis?.unit) return 0;
  if (ownUnit && basis.unit === ownUnit && ownUnits !== null && ownUnits !== undefined) {
    return parseMoney(ownUnits) ?? 0;
  }
  return parseMoney(counts?.[basis.unit]) ?? 0;
}

/**
 * What a setup list comes to under one scenario.
 *
 * `counts` is the estimator's unit counts; `ownUnit` / `ownUnits` are the
 * service's own basis unit and the count typed against it, which a
 * component charged on that same unit follows. Returns 0 for an empty list,
 * so the figure is always addable.
 */
export function setupTotal(setup, { counts = null, ownUnit = null, ownUnits = null, bases = PRICING_BASES } = {}) {
  let total = 0;
  for (const c of normalizeSetup(setup, bases)) {
    if (c.kind === 'fixed') { total += c.amount; continue; }
    total += c.amount * setupUnitsFor(c, { counts, ownUnit, ownUnits, bases });
  }
  return total;
}

// The noun a unit reads as in running text: "Sites" → "site", singular and
// lowercased. An acronym or a label that isn't plain title case keeps the
// case it was typed in — "MWh" is not "mwh", and a user who named a unit
// "EV Chargers" meant those capitals.
export function unitNoun(unitLabel) {
  const label = String(unitLabel || '').trim();
  if (!label) return 'unit';
  const singular = label.replace(/s$/, '');
  return /^[A-Z][a-z]+$/.test(singular) ? singular.toLowerCase() : singular;
}

// The setup fee as it reads on the rate card, before any count is applied:
// "$5,000 + $150/site". The per-unit half stays a rate rather than a total
// because that is what was agreed — the total moves with the deal, the rate
// doesn't. Returns '' when there is no setup fee.
export function formatSetupSummary(setup, bases = PRICING_BASES) {
  const parts = [];
  for (const c of normalizeSetup(setup, bases)) {
    if (c.kind === 'fixed') { parts.push(formatMoney(c.amount)); continue; }
    const basis = basisFor(c.basis, bases);
    parts.push(`${formatMoney(c.amount)}/${unitNoun(basis?.unitLabel || basis?.unit)}`);
  }
  return parts.join(' + ');
}

// Write a service's setup list. An empty list clears the field outright
// rather than storing [], and an entry with nothing left in it is deleted,
// matching setPricingField.
export function setPricingSetup(pricing, name, setup, bases = PRICING_BASES) {
  const next = { ...pricing };
  const row = { ...(next[name] || {}) };
  const clean = normalizeSetup(setup, bases);
  if (clean.length === 0) delete row.setup;
  else row.setup = clean;
  if (Object.keys(row).length === 0) delete next[name];
  else next[name] = row;
  return next;
}

export function getServicePricing(settings) {
  const raw = settings?.servicePricing;
  return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
}

// One service's entry, normalized: numbers as numbers, an unknown basis
// dropped. Always returns an object, so a caller never has to guard.
export function pricingFor(pricing, name, bases = PRICING_BASES) {
  const row = pricing?.[name];
  const basis = basisFor(row?.basis, bases);
  return {
    basis: basis ? basis.key : '',
    rate: parseMoney(row?.rate),
    rateHigh: parseMoney(row?.rateHigh),
    minFee: parseMoney(row?.minFee),
    units: parseMoney(row?.units),
    avgFee: parseMoney(row?.avgFee),
    setup: normalizeSetup(row?.setup, bases),
    notes: String(row?.notes || ''),
  };
}

// Write one field of one service's entry. An empty value clears the field,
// and an entry with nothing left in it is deleted outright rather than left
// behind as an empty object. Returns the next map for updateSettings.
export function setPricingField(pricing, name, field, value) {
  const next = { ...pricing };
  const row = { ...(next[name] || {}) };
  const blank = value == null || value === '';
  if (blank) delete row[field];
  else row[field] = (field === 'basis' || field === 'notes') ? value : parseMoney(value);
  // A rate is meaningless without a basis to read it against, so clearing
  // the basis takes the numbers that belonged to it rather than leaving a
  // stranded "$450 per nothing". A typed fee is not one of them — it
  // stands on its own, and a service priced only that way would otherwise
  // lose its price the moment someone cleared a basis it never had.
  if (field === 'basis' && blank) { delete row.rate; delete row.rateHigh; delete row.minFee; delete row.units; }
  if (Object.keys(row).length === 0) delete next[name];
  else next[name] = row;
  return next;
}

// Follow a service rename on the Solutions list. Returns the next map, or
// null when there was nothing keyed under the old name.
export function renameServicePricing(pricing, from, to) {
  if (!from || !to || from === to) return null;
  if (!pricing || !Object.prototype.hasOwnProperty.call(pricing, from)) return null;
  const next = { ...pricing };
  // A price already set under the new name wins — the user set it there
  // more recently than they set the one they're renaming into it.
  if (!Object.prototype.hasOwnProperty.call(next, to)) next[to] = next[from];
  delete next[from];
  return next;
}

// How many years of a recurring service the deal carries, read off the
// service's own Years metadata ("3 years" → 3). A one-off project is one
// year's work whatever that field says, and anything unparseable is one year
// rather than zero — under-counting a deal is better than erasing it.
export function contractYears(meta) {
  const n = Number(String(meta?.years || '').match(/\d+(\.\d+)?/)?.[0]);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function isRecurring(meta) {
  return String(meta?.serviceType || '').trim().toLowerCase() === 'recurring';
}

// What one service is worth under a given scenario.
//
// `counts` maps a unit ('sites', 'meters', …) to a number; `dealSize` is the
// figure percentage-based services take their cut of. Returns:
//   priced   — is there enough on the rate card to work a fee out at all
//   fee      — the fee itself: annual for a recurring service, the whole job
//              for a project. null when unpriced. The bottom of the range
//              when the service carries one, which is what it has always
//              been for a service that doesn't.
//   feeHigh  — the top of it. Equal to `fee` unless a high rate is set, so
//              a caller can add the two ends up without asking whether this
//              particular service happens to have a range.
//   value    — fee across the contract (fee × years when recurring)
//   valueHigh— the same for the top of the range
//   note     — why a priced service still came out at nothing, when it did
export function estimateService({ entry, meta, counts, dealSize, bases = PRICING_BASES }) {
  const est = estimateRecurring({ entry, meta, counts, dealSize, bases });
  const basis = basisFor(entry?.basis, bases);
  // The setup fee is one-time money on a service whose fee may not be, so
  // it rides alongside the recurring figure rather than inside it: the
  // caller adds it to the first year and to the contract value, and never
  // to the annual. A per-unit component follows the same count the service
  // itself is charged on when they share a unit — see setupTotal.
  const setup = setupTotal(entry?.setup, {
    counts, bases, ownUnit: basis?.unit || null, ownUnits: parseMoney(entry?.units),
  });
  // A service with nothing but a setup fee is priced: there is a figure to
  // put on the deal, and reporting it as unpriced would hide real money
  // behind "no rate set".
  if (!est.priced && setup > 0) {
    return { ...est, priced: true, fee: 0, feeHigh: 0, value: 0, valueHigh: 0, setup, setupOnly: true };
  }
  return { ...est, setup, setupOnly: false };
}

function estimateRecurring({ entry, meta, counts, dealSize, bases = PRICING_BASES }) {
  const basis = basisFor(entry?.basis, bases);
  const rate = parseMoney(entry?.rate);
  const rateHigh = parseMoney(entry?.rateHigh);
  const minFee = parseMoney(entry?.minFee);
  const avgFee = parseMoney(entry?.avgFee);
  // Units typed against this row beat the shared count — see the entry
  // notes at the top of the file.
  const ownUnits = parseMoney(entry?.units);
  const recurring = isRecurring(meta);
  const years = recurring ? contractYears(meta) : 1;
  const base = {
    priced: false, fee: null, feeHigh: null, value: null, valueHigh: null, recurring, years,
    unit: basis?.unit || null, units: null, unitsTyped: false, note: '', typed: false,
    // Filled in by estimateService, which wraps this — kept in the shape so
    // a caller reading a line never has to check whether the field is there.
    setup: 0, setupOnly: false,
  };

  // A fee typed into the Year 1 Fee column is the answer, whatever the basis
  // would have made of the counts — and it's one figure, not a range: the
  // person typing it is stating the fee, not the spread it might land in.
  //
  // It prices ONE of whatever the service is: one rollout, one retrofit. A
  // deal carrying three of them says so against the row, and it's three
  // times that. Only a figure typed for THIS deal multiplies it — never the
  // shared count, which is an account-wide number (819 sites) that would
  // turn a lump sum into a fantasy. So a row nobody has counted is worth
  // exactly what was typed, as it always has been.
  if (avgFee !== null) {
    const many = ownUnits === null ? 1 : ownUnits;
    if (many <= 0) {
      return {
        ...base, priced: true, typed: true, units: 0, unitsTyped: true,
        fee: 0, feeHigh: 0, value: 0, valueHigh: 0,
        note: `Set to no ${basis?.unitLabel ? basis.unitLabel.toLowerCase() : 'work'}`,
      };
    }
    const fee = avgFee * many;
    return {
      ...base, priced: true, typed: true,
      units: ownUnits, unitsTyped: ownUnits !== null,
      fee, feeHigh: fee, value: fee * years, valueHigh: fee * years,
    };
  }

  if (!basis) return { ...base, note: 'No pricing basis set' };
  if (rate === null) return { ...base, note: 'No rate set' };

  // A high rate typed below the low one is a typo, not an inverted range,
  // so the pair is read low-to-high rather than rendered backwards.
  const lo = rateHigh === null ? rate : Math.min(rate, rateHigh);
  const hi = rateHigh === null ? rate : Math.max(rate, rateHigh);

  const nothing = (note, extra) => ({ ...base, priced: true, fee: 0, feeHigh: 0, value: 0, valueHigh: 0, note, ...extra });

  let units = null;
  let unitsTyped = false;
  let deal = 0;
  if (basis.kind === 'unit') {
    unitsTyped = ownUnits !== null;
    units = unitsTyped ? ownUnits : (parseMoney(counts?.[basis.unit]) ?? 0);
    if (units <= 0) {
      return nothing(
        unitsTyped ? `Set to no ${basis.unitLabel.toLowerCase()}` : `No ${basis.unitLabel.toLowerCase()} entered`,
        { units: 0, unitsTyped },
      );
    }
  } else if (basis.kind === 'percent') {
    deal = parseMoney(dealSize) ?? 0;
    if (deal <= 0) return nothing('No deal size entered');
  }

  // Both ends run the same arithmetic, floor included — the minimum is what
  // the service costs to run at all, so it holds up the bottom of a range
  // the same way it holds up a single fee, and a range whose ends are both
  // under it is simply the floor.
  const feeAt = (r) => {
    let fee;
    if (basis.kind === 'unit') fee = r * units;
    else if (basis.kind === 'percent') fee = deal * (r / 100);
    else fee = r;
    return minFee !== null && fee < minFee ? minFee : fee;
  };
  const fee = feeAt(lo);
  const feeHigh = feeAt(hi);

  return {
    ...base, priced: true,
    fee, feeHigh, value: fee * years, valueHigh: feeHigh * years,
    units, unitsTyped,
  };
}

// How a line's fee was arrived at, in a few words: the phrase that goes
// under the service name wherever an estimate is shown, so a number that
// moves has a reason on the row. A typed Est. Fee doesn't move; a per-unit
// fee moves with the count it multiplies; a percentage moves with the deal
// size it's a percentage of.
//
// Takes a line from estimateScope (or anything with `entry`, `typed` and
// `units`). Returns '' for a service with nothing to say — an unpriced one,
// whose own `note` says that instead.
export function feeBasisLabel(line, bases = PRICING_BASES) {
  if (line?.typed) return line.units > 1 ? `Est. Fee × ${line.units}` : 'Est. Fee';
  const basis = basisFor(line?.entry?.basis, bases);
  if (!basis) return '';
  if (basis.kind === 'unit') {
    const unit = basis.unitLabel.toLowerCase().replace(/s$/, '');
    return `${formatRate(line.entry, bases)} per ${unit}${line.units ? ` \u00d7 ${line.units}` : ''}`;
  }
  if (basis.kind === 'percent') return `${formatRate(line.entry, bases)} of deal size`;
  return basis.label;
}

// Roll a set of services up into a deal estimate.
//
// `rows` are { name, meta } — the same shape the Services subtab builds — and
// `services` is the subset in scope. Recurring and one-off money are kept
// apart on the way through: a $60k/yr service over three years and a $180k
// project are the same contract value but not the same deal — and they are
// very different first years, which is why both totals come back.
export function estimateScope({ rows, services, pricing, counts, dealSize, bases = PRICING_BASES, serviceUnits = null }) {
  const inScope = new Set(services || []);
  const lines = [];
  let recurringAnnual = 0;
  let oneTime = 0;
  let contractValue = 0;
  // Setup money, tracked on its own as well as inside the one-time total:
  // "what does standing this up cost?" is a question the estimator gets
  // asked directly, and digging it back out of a total that also holds the
  // project work wouldn't answer it.
  let setupTotalAll = 0;
  // The top of each total, run alongside rather than derived: a scope where
  // three services carry a range and five don't is not the low total times
  // anything, it's the low ends of five added to the high ends of three.
  let recurringAnnualHigh = 0;
  let oneTimeHigh = 0;
  let contractValueHigh = 0;
  const unpriced = [];
  const unitsUsed = new Set();

  for (const row of rows || []) {
    if (!inScope.has(row.name)) continue;
    const card = pricingFor(pricing, row.name, bases);
    // Units typed against this row for THIS estimate beat the rate card's,
    // which is a standing default across every deal — see the entry notes
    // at the top of the file. A blank here isn't "use the shared count",
    // it's "no answer for this deal", so the card still gets its say.
    const own = parseMoney(serviceUnits?.[row.name]);
    const entry = own === null ? card : { ...card, units: own };
    const est = estimateService({ entry, meta: row.meta, counts, dealSize, bases });
    // A row carrying its own unit count doesn't need the shared one, so it
    // doesn't put a box on the estimator asking for it. Neither does a row
    // whose fee was typed straight in: that fee is multiplied by a count
    // typed against the row, if there is one, but never by the shared one —
    // so asking for a shared figure would be asking for a number that
    // changes nothing.
    if (est.unit && !est.unitsTyped && !est.typed) unitsUsed.add(est.unit);
    if (!est.priced) { unpriced.push(row.name); }
    else {
      if (est.recurring) {
        recurringAnnual += est.fee; contractValue += est.value;
        recurringAnnualHigh += est.feeHigh; contractValueHigh += est.valueHigh;
      } else {
        oneTime += est.fee; contractValue += est.value;
        oneTimeHigh += est.feeHigh; contractValueHigh += est.valueHigh;
      }
      // Setup is one-time whatever the service is, so it lands in the
      // one-time total on both sides of a recurring service's range and is
      // billed once into the contract value — never multiplied by the term
      // the way the annual fee is.
      if (est.setup) {
        setupTotalAll += est.setup;
        oneTime += est.setup; oneTimeHigh += est.setup;
        contractValue += est.setup; contractValueHigh += est.setup;
      }
    }
    lines.push({ name: row.name, entry, ...est });
  }

  // What the scope costs in its FIRST year: a recurring service bills its
  // annual fee, a project bills the job, and anything with a setup fee bills
  // that once. Which is the two halves added — the same two the contract
  // value keeps apart, because after year one they stop agreeing. It is the
  // sum of the Estimated Year 1 Fee column plus the Setup Fee column beside
  // it: setup stays out of the fee column because that cell is editable and
  // typing into it states the service's fee, not its fee plus its setup.
  const year1Total = recurringAnnual + oneTime;
  const year1TotalHigh = recurringAnnualHigh + oneTimeHigh;
  return {
    lines, recurringAnnual, oneTime, year1Total, contractValue,
    // The setup slice of `oneTime`, for a caller that wants to name it.
    setup: setupTotalAll,
    recurringAnnualHigh, oneTimeHigh, year1TotalHigh, contractValueHigh,
    // Whether any of this is a range at all, so a caller can say "$45,000"
    // without checking eight figures against each other.
    ranged: year1TotalHigh > year1Total || contractValueHigh > contractValue,
    unpriced, unitsUsed,
  };
}

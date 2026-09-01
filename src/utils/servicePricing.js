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
//            depending on the basis
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

// A rate as it reads in its own column: "$450" per unit, "3.5%" of the deal.
export function formatRate(entry, bases = PRICING_BASES) {
  const basis = basisFor(entry?.basis, bases);
  const rate = parseMoney(entry?.rate);
  if (!basis || rate === null) return '';
  if (basis.kind === 'percent') return `${rate}%`;
  return formatMoney(rate);
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
    minFee: parseMoney(row?.minFee),
    units: parseMoney(row?.units),
    avgFee: parseMoney(row?.avgFee),
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
  if (field === 'basis' && blank) { delete row.rate; delete row.minFee; delete row.units; }
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
//              for a project. null when unpriced.
//   value    — fee across the contract (fee × years when recurring)
//   note     — why a priced service still came out at nothing, when it did
export function estimateService({ entry, meta, counts, dealSize, bases = PRICING_BASES }) {
  const basis = basisFor(entry?.basis, bases);
  const rate = parseMoney(entry?.rate);
  const minFee = parseMoney(entry?.minFee);
  const avgFee = parseMoney(entry?.avgFee);
  // Units typed against this row beat the shared count — see the entry
  // notes at the top of the file.
  const ownUnits = parseMoney(entry?.units);
  const recurring = isRecurring(meta);
  const years = recurring ? contractYears(meta) : 1;
  const base = {
    priced: false, fee: null, value: null, recurring, years,
    unit: basis?.unit || null, units: null, unitsTyped: false, note: '', typed: false,
  };

  // A fee typed into the Year 1 Fee column is the answer, whatever the basis
  // would have made of the counts. It still runs across the term, so a
  // recurring service priced at an average year is still worth that year
  // times its years.
  if (avgFee !== null) {
    return { ...base, priced: true, typed: true, fee: avgFee, value: avgFee * years };
  }

  if (!basis) return { ...base, note: 'No pricing basis set' };
  if (rate === null) return { ...base, note: 'No rate set' };

  let fee;
  let units = null;
  let unitsTyped = false;
  if (basis.kind === 'unit') {
    unitsTyped = ownUnits !== null;
    units = unitsTyped ? ownUnits : (parseMoney(counts?.[basis.unit]) ?? 0);
    fee = rate * units;
    if (units <= 0) {
      return {
        ...base, priced: true, fee: 0, value: 0, units: 0, unitsTyped,
        note: unitsTyped ? `Set to no ${basis.unitLabel.toLowerCase()}` : `No ${basis.unitLabel.toLowerCase()} entered`,
      };
    }
    // The floor is what the service costs to run at all, so it applies
    // once there is something to run — not to an empty scope.
    if (minFee !== null && fee < minFee) fee = minFee;
  } else if (basis.kind === 'percent') {
    const deal = parseMoney(dealSize) ?? 0;
    fee = deal * (rate / 100);
    if (deal <= 0) {
      return { ...base, priced: true, fee: 0, value: 0, note: 'No deal size entered' };
    }
    if (minFee !== null && fee < minFee) fee = minFee;
  } else {
    fee = rate;
  }

  return { ...base, priced: true, fee, value: fee * years, units, unitsTyped };
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
  if (line?.typed) return 'Est. Fee';
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
    // whose fee was typed straight in: its basis still names a unit, but
    // the fee stopped depending on the count, so asking for one would be
    // asking for a number that changes nothing.
    if (est.unit && !est.unitsTyped && !est.typed) unitsUsed.add(est.unit);
    if (!est.priced) { unpriced.push(row.name); }
    else if (est.recurring) { recurringAnnual += est.fee; contractValue += est.value; }
    else { oneTime += est.fee; contractValue += est.value; }
    lines.push({ name: row.name, entry, ...est });
  }

  // What the scope costs in its FIRST year: a recurring service bills its
  // annual fee, a project bills the job. Which is the two halves added — the
  // same two the contract value keeps apart, because after year one they stop
  // agreeing. It is also the sum of the Estimated Year 1 Fee column, which is
  // why that column and the headline figure on the estimator always tie out.
  const year1Total = recurringAnnual + oneTime;
  return { lines, recurringAnnual, oneTime, year1Total, contractValue, unpriced, unitsUsed };
}

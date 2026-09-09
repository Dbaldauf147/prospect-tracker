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
//   avgFee — a fee typed straight into the service's Typed fee box on the
//            rate card: what this service usually sells for. It OVERRIDES
//            what the basis and rate would work out to, because it is the
//            more direct statement — someone who types "$40,000" there is
//            answering the question the rate card exists to answer, and a
//            model that quietly outvoted them would be useless. Clearing
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
//   lines  — the EXTRA recurring lines the service is priced on, beyond the
//            one `basis`/`rate`/`rateHigh` already state. Each is
//            { basis, rate, rateHigh }, at most one per basis, and none of
//            them repeats the primary basis. A service is very often priced
//            on more than one thing at once — a per-site fee plus a cut of
//            the deal, a retrofit plus the annual that keeps it running —
//            and before this the rate card could only hold the first of
//            them. Optional and empty by default: a service priced on one
//            basis stores nothing here and prices exactly as it always did.
//
//            The FIRST line is kept in `basis`/`rate`/`rateHigh` rather
//            than in this array so that every reader that predates it — the
//            rate card's Pricing Basis and rate columns, a saved analysis,
//            the deal-sizing roll-up — still finds a service's headline
//            price where it has always been. Clearing it promotes the next
//            line into its place; see writePricingLines.
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
  // A flat figure that recurs every year whatever the service's Type says.
  //
  // Flat fee already covers "one number": on a recurring service that number
  // is the annual, and on a project it's the job. What it can't say is
  // "$180k for the retrofit AND $12k a year to keep it running" — which is
  // one service, priced on two lines, and the reason `recurs` exists. A
  // basis carrying it always bills annually and always runs for the term.
  { key: 'recurring_annual', label: 'Recurring annual', kind: 'flat', unit: null, unitLabel: null, recurs: true },
  { key: 'per_site',    label: 'Per site',       kind: 'unit',    unit: 'sites',    unitLabel: 'Sites' },
  // The subset of the portfolio a regulation actually bites on. Its own
  // count rather than a share of the site count: a service sold because a
  // mandate exists is charged on the sites that carry one, and on a book
  // where 300 of 6,176 sites are mandated those two numbers price two
  // completely different deals. The company card already collects it
  // ("Sites w/ Mandate" — typed there, or stamped from the site list's
  // compliance screening), so Deal Sizing fills this count on its own.
  { key: 'per_site_mandate', label: 'Per site w/ mandate', kind: 'unit', unit: 'sites_mandate', unitLabel: 'Sites w/ Mandate' },
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
export const PRICING_BASES_VERSION = 4;
const BASIS_ADDED_IN = {
  per_project: 2, per_equipment: 2, recurring_annual: 3, per_site_mandate: 4,
};

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
    // `recurs` is a property of the basis, not of the service, so it has to
    // survive a round-trip through the user's saved list — otherwise a
    // Recurring annual line would stop recurring the moment someone opened
    // the bases editor.
    out.push({ key, label, kind, unit: unit || null, unitLabel: unitLabel || null, recurs: !!item?.recurs });
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
  return (lines || []).filter((line) => {
    // Any line of the service, not only its headline one: a retrofit
    // charged per project alongside an annual is still project work, and
    // the panel that asks how many of them there are has to ask about it.
    if (line?.breakdown?.length) {
      return line.breakdown.some(part => basisFor(part.basis, bases)?.unit === PROJECT_UNIT);
    }
    return basisFor(line?.entry?.basis, bases)?.unit === PROJECT_UNIT;
  });
}

// How many services are priced on each basis, keyed by basis key. What the
// editor needs before it lets someone delete one: a basis with rows behind
// it takes their pricing with it.
export function basisUsage(pricing) {
  const counts = new Map();
  const bump = (key) => { if (key) counts.set(key, (counts.get(key) || 0) + 1); };
  for (const row of Object.values(pricing || {})) {
    bump(String(row?.basis || ''));
    // An extra line is pricing behind a basis exactly as the primary one
    // is, so deleting that basis would take it with it. Counting only the
    // primary would let the editor say "used by no services" about a basis
    // three services are charging on.
    for (const line of Array.isArray(row?.lines) ? row.lines : []) bump(String(line?.basis || ''));
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
  // A plain capitalized English word is a name for a thing and reads better
  // mid-sentence in lower case; anything else — MWh, "w/", an acronym
  // somebody named a unit after — is left exactly as it was typed.
  const soften = (w) => (/^[A-Z][a-z]+$/.test(w) ? w.toLowerCase() : w);
  // Only the first word loses its plural: a multi-word label is a noun with
  // qualifiers after it, so "Sites w/ Mandate" is charged per SITE with a
  // mandate — "per Sites w/ Mandate" was the whole label read as one lump.
  const words = label.split(/\s+/);
  words[0] = words[0].replace(/s$/, '');
  return words.map(soften).join(' ');
}

// How a service is charged, in words: "$625 to $825 per site", "3% of the
// deal", "$45,000 flat fee, plus $12,000 recurring annual".
//
// Every line the service is priced on, not just the headline one — a fee
// built out of three bases is misdescribed by any one of them alone. This is
// the rate card as a sentence, which is the form the number is argued in and
// the one a bare rate column never shows.
//
// Independent of any estimate: it says what the service costs per unit, not
// what it comes to for one client. Returns '' for a service with no rate
// behind it, which callers render as "no rate set" rather than as a price.
export function rateSentence(entry, bases = PRICING_BASES) {
  const parts = [];
  for (const line of pricingLines(entry)) {
    const basis = basisFor(line.basis, bases);
    if (!basis) continue;
    const low = formatRate({ basis: line.basis, rate: line.rate }, bases);
    if (!low) continue;
    const high = line.rateHigh !== null && line.rateHigh > line.rate
      ? formatRate({ basis: line.basis, rate: line.rateHigh }, bases)
      : '';
    const spread = high ? `${low} to ${high}` : low;
    if (basis.kind === 'unit') parts.push(`${spread} per ${unitNoun(basis.unitLabel || basis.unit)}`);
    else if (basis.kind === 'percent') parts.push(`${spread} of the deal`);
    else parts.push(`${spread} ${basis.label.toLowerCase()}`);
  }
  return parts.join(', plus ');
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
    lines: normalizePricingLines(row?.lines, bases, basis ? basis.key : ''),
    notes: String(row?.notes || ''),
  };
}

/**
 * The extra lines, cleaned up: an unknown basis, a missing rate, a repeat of
 * a basis already on the list and a repeat of the PRIMARY basis all drop
 * out. One line per basis is the whole rule — the fee breakdown is a grid
 * with one row per basis, so two lines on the same one would have nowhere
 * to show and no way to be told apart.
 */
export function normalizePricingLines(raw, bases = PRICING_BASES, primaryKey = '') {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set(primaryKey ? [primaryKey] : []);
  for (const item of raw) {
    const basis = basisFor(item?.basis, bases);
    if (!basis || seen.has(basis.key)) continue;
    const rate = parseMoney(item?.rate);
    if (rate === null) continue;
    seen.add(basis.key);
    out.push({ basis: basis.key, rate, rateHigh: parseMoney(item?.rateHigh) });
  }
  return out;
}

/**
 * Every recurring line a service carries, primary first — the shape the fee
 * breakdown reads and the estimate prices. A primary basis with no rate
 * behind it is left out: it prices nothing, and the estimate says "No rate
 * set" about it instead.
 */
export function pricingLines(entry) {
  const out = [];
  const rate = parseMoney(entry?.rate);
  if (entry?.basis && rate !== null) {
    out.push({ basis: entry.basis, rate, rateHigh: parseMoney(entry?.rateHigh) });
  }
  for (const line of entry?.lines || []) {
    out.push({ basis: line.basis, rate: parseMoney(line.rate), rateHigh: parseMoney(line.rateHigh) });
  }
  return out;
}

/**
 * Write an ordered list of recurring lines back onto a stored row.
 *
 * The first line becomes the row's `basis`/`rate`/`rateHigh` — its headline
 * price, where every reader that predates multi-line pricing looks — and the
 * rest go to `lines`. An empty list clears all three, leaving `avgFee`,
 * `setup` and `notes` alone: those don't belong to a basis.
 *
 * `units` is the count the service charges its OWN basis on, so it follows
 * that basis and no other. When the promotion changes what the primary
 * counts — clearing a per-site line under a per-meter one — the figure is
 * dropped rather than silently re-read as 40 meters, which is a different
 * claim about the deal than the one anybody made.
 */
function writePricingLines(row, lines, bases = PRICING_BASES) {
  const next = { ...row };
  const wasUnit = basisFor(next.basis, bases)?.unit || null;
  const [first, ...rest] = lines;
  if (!first) {
    delete next.basis; delete next.rate; delete next.rateHigh; delete next.lines; delete next.units;
  } else {
    next.basis = first.basis;
    next.rate = first.rate;
    if (first.rateHigh === null || first.rateHigh === undefined) delete next.rateHigh;
    else next.rateHigh = first.rateHigh;
    if (rest.length === 0) delete next.lines;
    else next.lines = rest.map(l => (l.rateHigh === null || l.rateHigh === undefined
      ? { basis: l.basis, rate: l.rate }
      : { basis: l.basis, rate: l.rate, rateHigh: l.rateHigh }));
  }
  const nowUnit = basisFor(next.basis, bases)?.unit || null;
  if (wasUnit !== nowUnit) delete next.units;
  return next;
}

/**
 * Set one row of the fee breakdown: the low and/or high rate charged on one
 * basis. `patch` is { rate?, rateHigh? }, where '' or null clears.
 *
 * Clearing a line's low rate removes the line outright — a high end with no
 * low end is half a range, and a basis with no rate on it is not a line the
 * service is priced on. Everything else about the service (its floor, its
 * setup fee, a typed fee, the notes) is untouched.
 */
export function setPricingLine(pricing, name, basisKey, patch, bases = PRICING_BASES) {
  const basis = basisFor(basisKey, bases);
  if (!basis) return pricing;
  const next = { ...pricing };
  const row = { ...(next[name] || {}) };
  const lines = pricingLines(pricingFor(next, name, bases));
  const at = lines.findIndex(l => l.basis === basis.key);
  const current = at === -1 ? { basis: basis.key, rate: null, rateHigh: null } : lines[at];

  const read = (v) => (v === '' || v === null || v === undefined ? null : parseMoney(v));
  const rate = 'rate' in patch ? read(patch.rate) : current.rate;
  const rateHigh = 'rateHigh' in patch ? read(patch.rateHigh) : current.rateHigh;

  let out;
  if (rate === null || rate < 0) out = lines.filter((_, i) => i !== at);
  else {
    const line = { basis: basis.key, rate, rateHigh: rateHigh !== null && rateHigh >= 0 ? rateHigh : null };
    // A basis that wasn't priced yet joins the end of the list rather than
    // the front: filling in a second line shouldn't quietly demote the
    // price the service already led with.
    out = at === -1 ? [...lines, line] : lines.map((l, i) => (i === at ? line : l));
  }

  const written = writePricingLines(row, out, bases);
  if (Object.keys(written).length === 0) delete next[name];
  else next[name] = written;
  return next;
}

// Write one field of one service's entry. An empty value clears the field,
// and an entry with nothing left in it is deleted outright rather than left
// behind as an empty object. Returns the next map for updateSettings.
export function setPricingField(pricing, name, field, value, bases = PRICING_BASES) {
  const next = { ...pricing };
  let row = { ...(next[name] || {}) };
  const blank = value == null || value === '';
  if (blank) delete row[field];
  else row[field] = (field === 'basis' || field === 'notes') ? value : parseMoney(value);
  // A rate is meaningless without a basis to read it against, so clearing
  // the basis takes the numbers that belonged to it rather than leaving a
  // stranded "$450 per nothing". A typed fee is not one of them — it
  // stands on its own, and a service priced only that way would otherwise
  // lose its price the moment someone cleared a basis it never had.
  if (field === 'basis' && blank) { delete row.rate; delete row.rateHigh; delete row.minFee; }
  // Changing the headline basis has to keep the line list coherent: it must
  // not end up naming a basis an extra line already covers, and clearing it
  // on a service priced on several lines has to promote one of them rather
  // than strand real money behind a blank basis cell.
  if (field === 'basis') {
    const primaryRate = parseMoney(row.rate);
    const primary = blank || primaryRate === null
      ? []
      : [{ basis: value, rate: primaryRate, rateHigh: parseMoney(row.rateHigh) }];
    const extras = normalizePricingLines(row.lines, bases, blank ? '' : value);
    row = writePricingLines(row, [...primary, ...extras], bases);
  }
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
//   fee      — what the service bills in its FIRST year, setup aside: its
//              annual on a recurring service, the job on a project, and the
//              two added together on one priced on both. null when unpriced.
//              The bottom of the range when the service carries one, which
//              is what it has always been for a service that doesn't.
//   feeHigh  — the top of it. Equal to `fee` unless a high rate is set, so
//              a caller can add the two ends up without asking whether this
//              particular service happens to have a range.
//   recurringFee / recurringFeeHigh — the slice of `fee` that bills again
//              every year, and so runs for the term.
//   oneOffFee / oneOffFeeHigh — the slice that bills once. The two add up
//              to `fee`, and a caller that keeps recurring and one-time
//              money apart adds these rather than reading `recurring`: a
//              service can now carry both at once.
//   value    — fee across the contract: the recurring slice times the term,
//              plus the one-off slice once
//   valueHigh— the same for the top of the range
//   breakdown— one entry per priced line, in the order the rate card holds
//              them, so the fee can be shown as the sum it is
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
    return {
      ...est, priced: true, fee: 0, feeHigh: 0, value: 0, valueHigh: 0,
      recurringFee: 0, recurringFeeHigh: 0, oneOffFee: 0, oneOffFeeHigh: 0,
      setup, setupOnly: true,
    };
  }
  return { ...est, setup, setupOnly: false };
}

// Whether one line bills again next year. A basis carrying `recurs` always
// does — that is what Recurring annual is for, and it holds on a project
// service too. Everything else follows the service's own Type, exactly as
// the whole service used to.
function lineRecurs(basis, recurring) {
  return basis?.recurs ? true : recurring;
}

function estimateRecurring({ entry, meta, counts, dealSize, bases = PRICING_BASES }) {
  const basis = basisFor(entry?.basis, bases);
  const minFee = parseMoney(entry?.minFee);
  const avgFee = parseMoney(entry?.avgFee);
  // Units typed against this row beat the shared count — see the entry
  // notes at the top of the file.
  const ownUnits = parseMoney(entry?.units);
  const recurring = isRecurring(meta);
  // The term the contract runs for. Read off the service's Years whatever
  // its Type says, because a project can now carry a Recurring annual line
  // and that line runs for the term even though the job doesn't. One-off
  // money is never multiplied by it, so a project with no recurring line
  // values exactly as it did when this was pinned to 1.
  const years = contractYears(meta);
  const base = {
    priced: false, fee: null, feeHigh: null, value: null, valueHigh: null, recurring, years,
    recurringFee: 0, recurringFeeHigh: 0, oneOffFee: 0, oneOffFeeHigh: 0,
    unit: basis?.unit || null, units: null, unitsTyped: false, note: '', typed: false,
    // Every unit whose count this service reads out of the estimator's
    // shared boxes, so the estimator knows which boxes to put up. A line
    // charged on a count typed against the service isn't one of them.
    unitsNeeded: [],
    breakdown: [],
    // Filled in by estimateService, which wraps this — kept in the shape so
    // a caller reading a line never has to check whether the field is there.
    setup: 0, setupOnly: false,
  };

  // A fee typed into the Year 1 Fee column is the answer, whatever the rate
  // card would have made of the counts — and it's one figure, not a range:
  // the person typing it is stating the fee, not the spread it might land
  // in. It outranks every line in the breakdown, not just the first.
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
      fee, feeHigh: fee,
      recurringFee: recurring ? fee : 0, recurringFeeHigh: recurring ? fee : 0,
      oneOffFee: recurring ? 0 : fee, oneOffFeeHigh: recurring ? 0 : fee,
      value: recurring ? fee * years : fee,
      valueHigh: recurring ? fee * years : fee,
    };
  }

  const lines = pricingLines(entry);
  if (lines.length === 0) {
    return { ...base, note: basis ? 'No rate set' : 'No pricing basis set' };
  }

  // The count the service was told to charge its own basis on follows that
  // unit wherever it turns up, exactly as a setup component sharing it does
  // — so a service sold at 40 of 819 sites charges 40 on every per-site
  // line it carries, not only the headline one.
  const ownUnit = basis?.unit || null;

  const breakdown = [];
  const unitsNeeded = new Set();
  let recurLo = 0; let recurHi = 0;
  let onceLo = 0; let onceHi = 0;
  // A line that priced to nothing for a reason — no count entered, no deal
  // size — says why. When every line came out that way the service as a
  // whole says the first reason, which is the message a single-line service
  // has always given.
  let allNothing = true;
  let firstNote = '';

  for (const line of lines) {
    const lineBasis = basisFor(line.basis, bases);
    if (!lineBasis || line.rate === null) continue;
    // A high rate typed below the low one is a typo, not an inverted range,
    // so the pair is read low-to-high rather than rendered backwards.
    const lo = line.rateHigh === null ? line.rate : Math.min(line.rate, line.rateHigh);
    const hi = line.rateHigh === null ? line.rate : Math.max(line.rate, line.rateHigh);

    let units = null;
    let unitsTyped = false;
    let deal = 0;
    let note = '';
    if (lineBasis.kind === 'unit') {
      unitsTyped = ownUnits !== null && lineBasis.unit === ownUnit;
      units = unitsTyped ? ownUnits : (parseMoney(counts?.[lineBasis.unit]) ?? 0);
      if (!unitsTyped) unitsNeeded.add(lineBasis.unit);
      if (units <= 0) {
        note = unitsTyped
          ? `Set to no ${lineBasis.unitLabel.toLowerCase()}`
          : `No ${lineBasis.unitLabel.toLowerCase()} entered`;
      }
    } else if (lineBasis.kind === 'percent') {
      deal = parseMoney(dealSize) ?? 0;
      if (deal <= 0) note = 'No deal size entered';
    }

    const feeAt = (r) => {
      if (note) return 0;
      if (lineBasis.kind === 'unit') return r * units;
      if (lineBasis.kind === 'percent') return deal * (r / 100);
      return r;
    };
    const feeLo = feeAt(lo);
    const feeHi = feeAt(hi);
    if (!note) allNothing = false;
    else if (!firstNote) firstNote = note;

    const recurs = lineRecurs(lineBasis, recurring);
    if (recurs) { recurLo += feeLo; recurHi += feeHi; }
    else { onceLo += feeLo; onceHi += feeHi; }

    breakdown.push({
      basis: lineBasis.key, basisLabel: lineBasis.label, kind: lineBasis.kind,
      unit: lineBasis.unit || null, unitLabel: lineBasis.unitLabel || '',
      rate: line.rate, rateHigh: line.rateHigh,
      units, unitsTyped, recurs, fee: feeLo, feeHigh: feeHi, note,
    });
  }

  if (breakdown.length === 0) {
    return { ...base, note: basis ? 'No rate set' : 'No pricing basis set' };
  }

  // The primary line's count is what the Units column and the saved
  // analysis have always reported, so it stays the one the estimate names.
  const head = breakdown.find(b => b.basis === basis?.key) || breakdown[0];

  const shape = {
    ...base, priced: true,
    unit: head.unit, units: head.units, unitsTyped: head.unitsTyped,
    unitsNeeded: [...unitsNeeded], breakdown,
  };

  // Every line came to nothing: report the first reason and don't let the
  // floor invent money for work nobody counted, exactly as a single unit-
  // priced service with no count has always behaved.
  if (allNothing) {
    return { ...shape, fee: 0, feeHigh: 0, value: 0, valueHigh: 0, note: firstNote };
  }

  // The floor is what the SERVICE costs to run at all, so it holds up the
  // total of its lines rather than each one — and it holds up both ends of
  // a range the same way, so a spread that sits entirely under the minimum
  // is simply the minimum. The top-up lands in whichever half of the bill
  // the service's own Type says it belongs to.
  const topUp = (total) => (minFee !== null && total < minFee ? minFee - total : 0);
  const upLo = topUp(recurLo + onceLo);
  const upHi = topUp(recurHi + onceHi);
  if (recurring) { recurLo += upLo; recurHi += upHi; } else { onceLo += upLo; onceHi += upHi; }

  return {
    ...shape,
    recurringFee: recurLo, recurringFeeHigh: recurHi,
    oneOffFee: onceLo, oneOffFeeHigh: onceHi,
    fee: recurLo + onceLo, feeHigh: recurHi + onceHi,
    value: recurLo * years + onceLo, valueHigh: recurHi * years + onceHi,
    note: firstNote,
  };
}

// How a line's fee was arrived at, in a few words: the phrase that goes
// under the service name wherever an estimate is shown, so a number that
// moves has a reason on the row. A typed fee doesn't move; a per-unit
// fee moves with the count it multiplies; a percentage moves with the deal
// size it's a percentage of.
//
// Takes a line from estimateScope (or anything with `entry`, `typed` and
// `units`). Returns '' for a service with nothing to say — an unpriced one,
// whose own `note` says that instead.
export function feeBasisLabel(line, bases = PRICING_BASES) {
  // Named for the box the figure was typed into on the rate card, so a
  // reader who wants to change it knows what they are looking for.
  if (line?.typed) return line.units > 1 ? `Typed fee × ${line.units}` : 'Typed fee';
  // The breakdown when the estimate carried one, and the single basis on
  // the entry when the caller handed over something that predates it — a
  // saved analysis line, say, which is an entry and a fee and nothing else.
  const parts = line?.breakdown?.length ? line.breakdown : legacyParts(line, bases);
  if (parts.length === 0) return '';
  // A flat line says only its name when it's the whole price — the fee is
  // sitting right beside it, so "Flat fee" is the useful half. Alongside
  // other lines it has to carry its amount too, or "Flat fee + Recurring
  // annual" describes a total nobody can take apart.
  const many = parts.length > 1;
  // Two lines read out in full; past that the phrase runs longer than the
  // row it sits under, so the rest are counted rather than listed and the
  // fee breakdown in the pricing panel carries the detail.
  if (parts.length <= 2) return parts.map(p => partPhrase(p, many)).join(' + ');
  return `${partPhrase(parts[0], many)} + ${parts.length - 1} more lines`;
}

// One line of a breakdown as a phrase: "$450 per site × 819", "3% of deal
// size", "Recurring annual".
function partPhrase(part, withAmount = false) {
  const rate = formatRate(
    { basis: 'x', rate: part.rate, rateHigh: part.rateHigh },
    [{ key: 'x', kind: part.kind }],
  );
  if (part.kind === 'unit') {
    const unit = String(part.unitLabel || 'unit').toLowerCase().replace(/s$/, '');
    return `${rate} per ${unit}${part.units ? ` × ${part.units}` : ''}`;
  }
  if (part.kind === 'percent') return `${rate} of deal size`;
  return withAmount ? `${part.basisLabel} ${rate}` : part.basisLabel;
}

function legacyParts(line, bases) {
  const basis = basisFor(line?.entry?.basis, bases);
  if (!basis) return [];
  return [{
    kind: basis.kind, unitLabel: basis.unitLabel, basisLabel: basis.label,
    rate: line.entry.rate, rateHigh: line.entry.rateHigh, units: line.units,
  }];
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
    if (!est.typed) for (const unit of est.unitsNeeded || []) unitsUsed.add(unit);
    if (!est.priced) { unpriced.push(row.name); }
    else {
      // Recurring and one-time money are split by the LINE, not by the
      // service: a retrofit that carries an annual alongside it is both, and
      // bucketing the whole service by its Type would file half of it under
      // the wrong heading. A service priced on one line lands where it
      // always did, because one of the two halves is then zero.
      recurringAnnual += est.recurringFee; recurringAnnualHigh += est.recurringFeeHigh;
      oneTime += est.oneOffFee; oneTimeHigh += est.oneOffFeeHigh;
      contractValue += est.value; contractValueHigh += est.valueHigh;
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
  // sum of the Estimated Year 1 Fee column plus the setup beside it: setup
  // is kept out of the fee itself because a fee typed on the rate card
  // states what the service costs to run, not what it costs to run plus
  // what it cost to stand up.
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

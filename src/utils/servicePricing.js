// The rate card behind Dropdowns › Services Pricing.
//
// One entry per service, keyed by the service's name on the Solutions list —
// the same key serviceOverrides and serviceLinks use, so a service added or
// renamed on the Services subtab is the same service here. Nothing is seeded:
// a service with no entry is simply unpriced, and the estimator says so rather
// than guessing a number for it.
//
// An entry is { basis, rate, minFee, avgFee, notes }:
//   basis  — which PRICING_BASES key the fee is worked out from
//   rate   — dollars per unit, a flat dollar figure, or a percentage,
//            depending on the basis
//   minFee — dollar floor applied to unit- and percentage-based fees
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

// How a service's fee is worked out. `unit` names the count the fee
// multiplies — the estimator asks for one input per distinct unit that the
// services in scope actually use, so adding a basis here adds its box to the
// estimator without any further wiring.
export const PRICING_BASES = [
  { key: 'flat',        label: 'Flat fee',       kind: 'flat',    unit: null,       unitLabel: null },
  { key: 'per_site',    label: 'Per site',       kind: 'unit',    unit: 'sites',    unitLabel: 'Sites' },
  { key: 'per_account', label: 'Per account',    kind: 'unit',    unit: 'accounts', unitLabel: 'Accounts' },
  { key: 'per_meter',   label: 'Per meter',      kind: 'unit',    unit: 'meters',   unitLabel: 'Meters' },
  { key: 'per_invoice', label: 'Per invoice',    kind: 'unit',    unit: 'invoices', unitLabel: 'Invoices' },
  { key: 'per_mwh',     label: 'Per MWh',        kind: 'unit',    unit: 'mwh',      unitLabel: 'MWh' },
  { key: 'per_user',    label: 'Per user',       kind: 'unit',    unit: 'users',    unitLabel: 'Users' },
  { key: 'pct_deal',    label: '% of deal size', kind: 'percent', unit: null,       unitLabel: null },
];

const BASIS_BY_KEY = new Map(PRICING_BASES.map(b => [b.key, b]));

export function basisFor(key) {
  return BASIS_BY_KEY.get(String(key || '')) || null;
}

// Every unit a basis can multiply, in the order the bases declare them —
// the estimator lays its count boxes out in this order so they don't jump
// around as services come in and out of scope.
export const PRICING_UNITS = PRICING_BASES
  .filter(b => b.unit)
  .map(b => ({ unit: b.unit, label: b.unitLabel }));

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
export function formatRate(entry) {
  const basis = basisFor(entry?.basis);
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
export function pricingFor(pricing, name) {
  const row = pricing?.[name];
  const basis = basisFor(row?.basis);
  return {
    basis: basis ? basis.key : '',
    rate: parseMoney(row?.rate),
    minFee: parseMoney(row?.minFee),
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
  if (field === 'basis' && blank) { delete row.rate; delete row.minFee; }
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
export function estimateService({ entry, meta, counts, dealSize }) {
  const basis = basisFor(entry?.basis);
  const rate = parseMoney(entry?.rate);
  const minFee = parseMoney(entry?.minFee);
  const avgFee = parseMoney(entry?.avgFee);
  const recurring = isRecurring(meta);
  const years = recurring ? contractYears(meta) : 1;
  const base = {
    priced: false, fee: null, value: null, recurring, years,
    unit: basis?.unit || null, units: null, note: '', typed: false,
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
  if (basis.kind === 'unit') {
    units = parseMoney(counts?.[basis.unit]) ?? 0;
    fee = rate * units;
    if (units <= 0) {
      return { ...base, priced: true, fee: 0, value: 0, units: 0, note: `No ${basis.unitLabel.toLowerCase()} entered` };
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

  return { ...base, priced: true, fee, value: fee * years, units };
}

// Roll a set of services up into a deal estimate.
//
// `rows` are { name, meta } — the same shape the Services subtab builds — and
// `services` is the subset in scope. Recurring and one-off money are kept
// apart on the way through: a $60k/yr service over three years and a $180k
// project are the same contract value but not the same deal — and they are
// very different first years, which is why both totals come back.
export function estimateScope({ rows, services, pricing, counts, dealSize }) {
  const inScope = new Set(services || []);
  const lines = [];
  let recurringAnnual = 0;
  let oneTime = 0;
  let contractValue = 0;
  const unpriced = [];
  const unitsUsed = new Set();

  for (const row of rows || []) {
    if (!inScope.has(row.name)) continue;
    const entry = pricingFor(pricing, row.name);
    const est = estimateService({ entry, meta: row.meta, counts, dealSize });
    if (est.unit) unitsUsed.add(est.unit);
    if (!est.priced) { unpriced.push(row.name); }
    else if (est.recurring) { recurringAnnual += est.fee; contractValue += est.value; }
    else { oneTime += est.fee; contractValue += est.value; }
    lines.push({ name: row.name, entry, ...est });
  }

  // Year one is what the client actually signs up to spend in the first
  // twelve months: every recurring service's annual fee plus every one-off
  // project in full. It is the sum of the Estimated Year 1 Fee column, which
  // is why that column and the headline figure always tie out — contractValue
  // runs the recurring lines across their whole term and does not.
  return {
    lines,
    recurringAnnual,
    oneTime,
    yearOne: recurringAnnual + oneTime,
    contractValue,
    unpriced,
    unitsUsed,
  };
}

// What a LEASED site is worth estimating, as against an owned one.
//
// The four estimators on the Utility Lookup page — square footage,
// consumption, utility accounts and equipment — all read the property type
// and the size on the row, and nothing else. That is the right answer for a
// building somebody owns. It is the wrong answer for one they rent: a
// 40,000 ft² suite inside a high-rise was being modelled as a 500,000 ft²
// office tower, with the tower's base-building load, its five utility
// accounts and its eighty-five pieces of equipment. Every one of those
// belongs to the landlord, and none of them is scope anyone can sell to the
// tenant on the row.
//
// The rule the whole file follows is one sentence: an owner is sized on the
// BUILDING, a tenant is sized on the PREMISES AND THE METERS IT HOLDS.
//
// ---- Two kinds of leased -------------------------------------------------
//
// "Leased" covers two situations that behave nothing alike, and collapsing
// them into one rule gets both wrong:
//
//   SUITE — the tenant takes part of a building. The landlord runs the
//     central plant, the common areas, the lifts and the exterior, and holds
//     every account except the tenant's own electric. A leased office floor.
//
//   WHOLE BUILDING (net lease) — the tenant takes the entire building, holds
//     its own meters and runs its own kit. A leased QSR, a leased warehouse,
//     a hotel on an operating lease. Operationally this is close to owned.
//
// One rule for both would either strip a net-lease site of accounts and
// equipment it really has, or leave a suite carrying a tower's worth of both.
//
// ---- Unknown tenure ------------------------------------------------------
//
// A blank or unplaceable ownership value estimates as OWNED — the full
// figure. This matches the rule the compliance scope already runs on (see
// ownershipScope.js): an unknown status is a gap in the upload, not evidence
// the building is somebody else's. Leased is the only value that shrinks an
// estimate, so a portfolio that never mapped the column is never quietly
// reduced.
//
// ---- Where the factors came from ----------------------------------------
//
// The factors below are reasoned from how commercial leases apportion base
// building against tenant load — they are not measured against any
// particular book, and they are meant to be argued with and moved. The
// reference tables they multiply (CONSUMPTION_ESTIMATES, ACCOUNT_ESTIMATES,
// EQUIPMENT_ESTIMATES in ../data/propertyTypeEstimates.js) are unchanged:
// this file scales them, it does not restate them.

import {
  estimateConsumption,
  propertyTypeAccounts,
  propertyTypeConsumption,
  propertyTypeEquipment,
} from '../data/propertyTypeEstimates.js';

// The canonical tenure values an uploaded Ownership column normalizes to.
//
// LEASED is kept alongside the two specific ones on purpose: "Leased" with
// no further qualifier is what most site lists actually say, and rewriting
// it to one of the two at import would be putting words in the upload's
// mouth. It carries through as typed and picks up a class from the property
// type at estimate time, where the choice is visible and overridable.
export const TENURE = {
  OWNED: 'Owned',
  LEASED: 'Leased',
  SUITE: 'Leased – Suite',
  WHOLE: 'Leased – Whole Building',
};

// Every canonical value, in the order a picklist should offer them.
export const TENURE_OPTIONS = [TENURE.OWNED, TENURE.LEASED, TENURE.SUITE, TENURE.WHOLE];

// The two lease classes the estimators actually branch on. A row's tenure
// resolves to one of these three.
export const CLASS = { OWNED: 'OWNED', SUITE: 'SUITE', WHOLE: 'WHOLE' };

// Is this tenure value a lease of any kind? Every leased variant starts with
// "Leased", which is what makes the test hold as more are added — and what
// keeps a raw upload value the normalizer could not place ("Owned/Leased",
// "TBD") out of it, since those never reach this shape.
export function isLeasedTenure(value) {
  return value === TENURE.LEASED || value === TENURE.SUITE || value === TENURE.WHOLE;
}

// Which class a plain "Leased" falls into, by property type.
//
// A default, not a fact: a corporate tenant CAN take a whole office tower and
// CAN take a suite in a warehouse. It is the way round that is right far more
// often than not, and a row that knows better says so by carrying one of the
// two specific tenure values instead.
//
// The split is about whether the tenant occupies part of a building or all of
// it. Office, lab, medical and inline retail are taken by the floor or the
// unit. Industrial, standalone retail, restaurants, storage and every
// operator-run asset (hotel, hospital, school, campus, residential) are taken
// whole, on a net or operating lease, with the tenant behind its own meters.
export const DEFAULT_LEASE_CLASS = {
  'Office - High-Rise': CLASS.SUITE,
  'Office - Mid-Rise': CLASS.SUITE,
  'Office - Small (Low-Rise)': CLASS.SUITE,
  'Office Occupier': CLASS.SUITE,
  'Medical Office': CLASS.SUITE,
  'Laboratory / R&D': CLASS.SUITE,
  'Industrial Flex / R&D': CLASS.SUITE,
  'Mixed Use': CLASS.SUITE,
  'Shopping Mall / Retail Center': CLASS.SUITE,
  'Retail - Neighborhood Retail': CLASS.SUITE,
};

// Everything not named above is taken whole. Stated as a fallback rather than
// a second list so a property type added to the bases table gets a sensible
// answer without an edit here — and whole-building is the safer default,
// because it changes the estimate least.
export function defaultLeaseClass(propertyType) {
  const base = propertyTypeConsumption(propertyType);
  if (!base) return CLASS.WHOLE;
  return DEFAULT_LEASE_CLASS[canonicalTypeName(propertyType)] || CLASS.WHOLE;
}

// propertyTypeConsumption resolves aliases and casing, but returns the
// profile rather than the name it matched. The class map is keyed by
// canonical name, so find it by identity against the table.
function canonicalTypeName(rawType) {
  const base = propertyTypeConsumption(rawType);
  if (!base) return '';
  const name = String(rawType || '').trim();
  if (DEFAULT_LEASE_CLASS[name] !== undefined) return name;
  for (const key of Object.keys(DEFAULT_LEASE_CLASS)) {
    if (propertyTypeConsumption(key) === base) return key;
  }
  return name;
}

/**
 * The class a row estimates under: its tenure, with a plain "Leased"
 * resolved by property type. Anything that isn't a lease — Owned, blank, a
 * value the upload couldn't place — is OWNED, per the unknown-tenure rule.
 */
export function leaseClassFor(tenure, propertyType) {
  if (tenure === TENURE.SUITE) return CLASS.SUITE;
  if (tenure === TENURE.WHOLE) return CLASS.WHOLE;
  if (tenure === TENURE.LEASED) return defaultLeaseClass(propertyType);
  return CLASS.OWNED;
}

// The levers. One entry per class; OWNED is all 1 by definition — it is the
// baseline the other two are expressed against, and it is what the page did
// before this file existed.
export const OWNERSHIP_FACTORS = {
  [CLASS.OWNED]: {
    // Share of the reference building used when the row supplies no size.
    sizeFallback: 1,
    // Share of a whole-building intensity the party on the row pays for.
    electric: 1,
    gas: 1,
    // Share of the per-type account table the party on the row holds.
    accounts: { electric: 1, gas: 1, water: 1, steam: 1, waste: 1 },
    // Share of the building's equipment they are responsible for.
    equipment: 1,
  },
  [CLASS.SUITE]: {
    // A suite that supplies no size must not fall back to a whole tower.
    // A floor or two is what a corporate tenant usually takes.
    sizeFallback: 0.12,
    // Plug load, lighting and in-suite HVAC — not the central plant, the
    // lobby, the garage or the lifts.
    electric: 0.55,
    // Heating in a multi-tenant building is central and landlord-billed
    // almost without exception. What is left is cooking or a supplemental
    // unit.
    gas: 0.10,
    // The one account a suite tenant holds in its own name. Gas, water,
    // steam and waste are base-building services billed through CAM.
    accounts: { electric: 1, gas: 0, water: 0, steam: 0, waste: 0 },
    // Supplemental cooling and in-suite units. The chillers, boilers, lifts
    // and switchgear are the landlord's.
    equipment: 0.08,
  },
  [CLASS.WHOLE]: {
    // The tenant has the whole building, so the reference size is right.
    sizeFallback: 1,
    electric: 1,
    // All of it, less a sliver the landlord keeps.
    gas: 0.95,
    // Electric, gas and waste in the tenant's name; water often still on the
    // landlord's master meter; district steam never the tenant's.
    accounts: { electric: 1, gas: 1, water: 0.5, steam: 0, waste: 1 },
    // The tenant runs HVAC, lighting and process kit. Roof and structure
    // stay with the landlord.
    equipment: 0.85,
  },
};

export function factorsFor(tenure, propertyType) {
  return OWNERSHIP_FACTORS[leaseClassFor(tenure, propertyType)] || OWNERSHIP_FACTORS[CLASS.OWNED];
}

/**
 * The size an estimate should run on.
 *
 * A size the row actually supplies is used as typed under every tenure —
 * on a suite row it is already the leased premises, so there is nothing to
 * apportion off it, and second-guessing a figure somebody typed is how an
 * estimator stops being checkable. The tenure only decides the FALLBACK,
 * which is the case where the alternative is a whole reference building
 * standing in for a floor.
 *
 * Returns null when the property type has no reference profile to fall back
 * to (Land, Debt, an unrecognized name), which callers already treat as "no
 * size" rather than as zero.
 */
export function estimateSizeFt2(tenure, propertyType, statedSizeFt2) {
  const stated = Number(statedSizeFt2);
  if (Number.isFinite(stated) && stated > 0) return stated;
  const base = propertyTypeConsumption(propertyType);
  const ref = Number(base?.sizeFt2);
  if (!Number.isFinite(ref) || ref <= 0) return null;
  return ref * factorsFor(tenure, propertyType).sizeFallback;
}

/**
 * Annual consumption under this row's tenure.
 *
 * Same shape estimateConsumption returns, so a caller reading `.electricKwh`
 * needs no branch of its own. Two things happen on a leased row: the fallback
 * size shrinks to the premises (above), and the intensity is cut to the share
 * the tenant actually pays for. Both are needed — the size alone would still
 * charge a suite for its share of the central plant.
 *
 * `tenure` null / 'Owned' / anything unplaceable returns exactly what
 * estimateConsumption returned before this existed.
 */
export function estimateConsumptionForTenure(tenure, propertyType, statedSizeFt2) {
  const size = estimateSizeFt2(tenure, propertyType, statedSizeFt2);
  const est = estimateConsumption(propertyType, size);
  if (!est) return null;
  const fx = factorsFor(tenure, propertyType);
  if (fx.electric === 1 && fx.gas === 1) return est;
  const electricKwh = Math.round(est.electricKwh * fx.electric);
  const gasDth = Math.round(est.gasDth * fx.gas);
  const gasKwh = Math.round(est.gasKwh * fx.gas);
  return {
    ...est,
    electricKwh,
    gasDth,
    gasKwh,
    totalKwh: electricKwh + gasKwh,
    // What was scaled away, so a reader can see the estimate is a share
    // rather than wondering why it undershoots the building.
    tenureFactors: { electric: fx.electric, gas: fx.gas },
  };
}

/**
 * The utility accounts this row's party holds.
 *
 * Same { water, steam, gas, electric, waste } shape propertyTypeAccounts
 * returns, each entry keeping its `count` and `label`. A commodity factored
 * to nothing reports a real zero with a label saying whose it is instead —
 * "Landlord" reads as an answer, where a bare 0 reads as missing data.
 */
export function accountsForTenure(tenure, propertyType) {
  const base = propertyTypeAccounts(propertyType);
  if (!base) return null;
  const fx = factorsFor(tenure, propertyType);
  if (leaseClassFor(tenure, propertyType) === CLASS.OWNED) return base;
  const out = {};
  for (const [commodity, entry] of Object.entries(base)) {
    const factor = fx.accounts[commodity] ?? 1;
    const count = (entry?.count || 0) * factor;
    if (factor === 1) { out[commodity] = entry; continue; }
    out[commodity] = {
      count,
      // A commodity the tenant never holds says so. One it holds a share of
      // shows the share, since half a master meter is a real expectation
      // across a portfolio even though no single site has half an account.
      label: factor === 0
        ? (entry?.count ? 'Landlord' : (entry?.label || '0'))
        : formatCount(count),
    };
  }
  return out;
}

// Account counts are already fractional in the reference table (a "0 – 1"
// midpoint is 0.5), and factoring makes more of them so. Whole numbers stay
// whole; anything else keeps one decimal.
function formatCount(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

/** Total expected accounts across every commodity, under this tenure. */
export function accountTotalForTenure(tenure, propertyType) {
  const acc = accountsForTenure(tenure, propertyType);
  if (!acc) return null;
  return Object.values(acc).reduce((sum, e) => sum + (e?.count || 0), 0);
}

/**
 * Equipment this row's party is responsible for.
 *
 * Null for a type with no profile, exactly as propertyTypeEquipment is —
 * "no answer", which callers render as an empty cell rather than as a zero
 * that would read as "no equipment".
 */
export function equipmentForTenure(tenure, propertyType) {
  const n = propertyTypeEquipment(propertyType);
  if (n === null || n === undefined) return n;
  const fx = factorsFor(tenure, propertyType);
  if (fx.equipment === 1) return n;
  // Rounded to a whole asset: a count is a thing you can walk up to, and
  // "6.8 rooftop units" is not a number anyone can act on. A type with real
  // equipment never rounds to zero, so a leased site keeps at least the one
  // asset that says it has any.
  const scaled = n * fx.equipment;
  return scaled > 0 ? Math.max(1, Math.round(scaled)) : 0;
}

/**
 * How a row's estimate was scoped, in a few words — for the tooltip on a
 * figure that is deliberately smaller than the building it sits in. Returns
 * '' for an owned row, which needs no explanation.
 */
export function tenureEstimateNote(tenure, propertyType) {
  const klass = leaseClassFor(tenure, propertyType);
  if (klass === CLASS.OWNED) return '';
  const resolved = tenure === TENURE.LEASED
    ? ` Tenure says "Leased" without saying which, so ${propertyType || 'this property type'} defaults to ${klass === CLASS.SUITE ? 'a suite' : 'a whole building'}.`
    : '';
  if (klass === CLASS.SUITE) {
    return 'Leased suite: sized on the tenant\'s premises and the meters it holds, not on the building. '
      + 'Base-building load, landlord accounts and central plant are excluded.' + resolved;
  }
  return 'Leased whole building: the tenant is behind its own meters, so this is close to the owned figure — '
    + 'less the water account and the structure the landlord keeps.' + resolved;
}

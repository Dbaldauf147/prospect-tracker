import { TENURE, isLeasedTenure } from '../../utils/ownershipEstimates.js';

// Ownership scoping shared by the two building-compliance subtabs
// (Building Compliance Screening and Compliance Roadmap). Both analyses
// are about obligations that fall on the building owner, so they default
// to leaving out the buildings the portfolio leases. The Ownership value
// comes from the Utility Lookup upload's mapped Ownership column.
//
// The rule is "drop what's known to be leased", NOT "keep only what's
// known to be owned". Those differ on the sites whose ownership status is
// missing or unrecognized, and they differ a lot: a portfolio that mapped
// the column for half its list would have had the other half silently
// screened out of its own compliance report. An unknown status is a gap in
// the upload, not evidence the building is somebody else's — so it screens,
// and the site is at worst reviewed unnecessarily rather than missed
// entirely. Leased is the only status that removes a site.
//
// The scope is also inert when nothing in the list is leased: there's
// nothing to exclude, so the control says so rather than pretending to
// filter.

// Sites whose ownership is known to be leased. Any of the canonical leased
// values the upload normalizes to — a bare "Leased", or one of the two that
// name the kind of lease (see TENURE in ownershipEstimates.js). The kind
// changes what a site is worth ESTIMATING; it changes nothing about whose
// obligation the building is, so every one of them is leased here.
//
// A value the upload couldn't place ("Owned/Leased", "TBD", …) travels
// through as typed and counts as unknown, which screens.
const isLeased = (s) => isLeasedTenure(s?.ownership);

// Counts by ownership status across a compliance site list.
export function ownershipScopeStats(sites = []) {
  let owned = 0;
  let leased = 0;
  for (const s of sites) {
    if (s?.ownership === TENURE.OWNED) owned++;
    else if (isLeased(s)) leased++;
  }
  const total = sites.length;
  return {
    total,
    owned,
    leased,
    // Neither Owned nor Leased: blank, or a value the import couldn't
    // place ("Owned/Leased", "TBD", …).
    unspecified: total - owned - leased,
    known: owned + leased,
    // What the owner-obligation scope actually screens: everything that
    // isn't known to be leased.
    screened: total - leased,
  };
}

// Whether the scope can actually change anything for this list. Nothing
// leased means nothing to drop, so the toggle is inert.
export function ownershipScopeActive(sites, excludeLeased) {
  return !!excludeLeased && ownershipScopeStats(sites).leased > 0;
}

// The site list the compliance analyses should run on.
export function scopeSitesByOwnership(sites = [], excludeLeased) {
  return ownershipScopeActive(sites, excludeLeased)
    ? sites.filter(s => !isLeased(s))
    : sites;
}

// The same "known to be leased" test, read off a Utility Lookup row rather
// than a compliance site. Those rows carry the canonical status the upload
// normalized to on `__ownership__`, so the rule — and everything said above
// about an unknown status not counting as somebody else's building — is
// identical; only the field name differs.
export const isLeasedUtilityRow = (r) => isLeasedTenure(r?.__ownership__);

// Savings scope for the Master Analysis. Indicative savings are a
// procurement motion on the supply contract behind the meter, and on a
// leased location that contract is usually the landlord's — so no savings
// are projected onto those sites. Unlike the compliance scope this isn't a
// toggle: a leased building never carries a savings number.
//
// The counts are what the export says out loud, so the reader can see the
// gap between the sites listed and the sites the money was projected on.
export function savingsOwnershipScope(rows = []) {
  let leased = 0;
  for (const r of rows) if (isLeasedUtilityRow(r)) leased += 1;
  const total = rows.length;
  return { total, leased, scoped: total - leased, active: leased > 0 };
}

// Tenure (Owned / Leased) coverage across the loaded Utility Lookup rows —
// what the page's missing-tenure warning is written from.
//
// Both scopes above read one column, and neither can tell an upload that
// never carried it from a portfolio that owns everything outright: no row
// is Leased either way, so the compliance subtabs screen every building and
// the Master Analysis projects savings on the whole footprint. That is a
// real number moving on a column nobody noticed was absent, which is why
// its absence gets said out loud rather than inferred from a silent zero.
//
// `withValue` counts the rows carrying any tenure answer at all, canonical
// or not: "Owned/Leased" and "TBD" are answers normalizeOwnership couldn't
// place, but they are not silence — the page shows them as typed — so they
// count as uploaded and only `missing` drives the warning.
export function tenureCoverage(rows = []) {
  let owned = 0;
  let leased = 0;
  // The leased rows that also say WHICH KIND of lease. Not part of the
  // warning — a bare "Leased" is a complete tenure answer and scopes
  // everything here the same way — but it decides how the site is ESTIMATED,
  // so the page can say how much of the book is resolving off a property-type
  // default rather than off something the upload actually stated.
  let leasedTyped = 0;
  let unplaceable = 0;
  for (const r of rows) {
    const canonical = r?.__ownership__;
    if (canonical === TENURE.OWNED) owned += 1;
    else if (isLeasedTenure(canonical)) {
      leased += 1;
      if (canonical !== TENURE.LEASED) leasedTyped += 1;
    } else if (String(r?.__ownershipRaw__ ?? '').trim()) unplaceable += 1;
  }
  const total = rows.length;
  const known = owned + leased;
  const withValue = known + unplaceable;
  return {
    total,
    owned,
    leased,
    // Leased rows naming the kind of lease, and the rest, which take the
    // property type's default class when they are estimated.
    leasedTyped,
    leasedUntyped: leased - leasedTyped,
    // A value the upload couldn't fold onto Owned or Leased. Uploaded, so
    // not part of the warning — but it doesn't scope anything either.
    unplaceable,
    known,
    withValue,
    // Rows with no tenure answer at all: the gap being warned about.
    missing: total - withValue,
  };
}

// Owned / Leased scoping shared by the two building-compliance subtabs
// (Building Compliance Screening and Compliance Roadmap). Both analyses
// are about obligations that fall on the building owner, so they default
// to the sites the portfolio actually owns and offer a toggle back to
// the full list. The Ownership value comes from the Utility Lookup
// upload's mapped Ownership column.
//
// The scope is deliberately inert when nothing in the list carries an
// ownership status: a portfolio that never mapped the column would
// otherwise screen zero sites and look broken.

// Counts by ownership status across a compliance site list.
export function ownershipScopeStats(sites = []) {
  let owned = 0;
  let leased = 0;
  for (const s of sites) {
    if (s?.ownership === 'Owned') owned++;
    else if (s?.ownership === 'Leased') leased++;
  }
  const total = sites.length;
  return {
    total,
    owned,
    leased,
    // Neither Owned nor Leased: blank, or a value the import couldn't
    // place ("TBD", "Owned/Leased", …).
    unspecified: total - owned - leased,
    known: owned + leased,
  };
}

// Whether the owned-only preference can actually apply to this list.
export function ownershipScopeActive(sites, ownedOnly) {
  return !!ownedOnly && ownershipScopeStats(sites).known > 0;
}

// The site list the compliance analyses should run on.
export function scopeSitesByOwnership(sites = [], ownedOnly) {
  return ownershipScopeActive(sites, ownedOnly)
    ? sites.filter(s => s?.ownership === 'Owned')
    : sites;
}

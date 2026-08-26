// Where a record's tier came from, and who outranks whom.
//
// My Accounts prefers a record's own `tier` over the Target Accounts
// list, on the reasoning that an explicitly-chosen tier should stick —
// setting an account to Tier 3 must not be silently re-upgraded by a
// lookup. That reasoning is right, but nothing distinguished a tier the
// user picked from a tier that arrived in a spreadsheet column: an
// import wrote the sheet's Tier straight onto the record, the record
// then outranked the Targets list, and the disagreement surfaced as a
// tier-mismatch warning on a company nobody had ever tiered by hand.
//
// So imports mark what they wrote. A tier the user set still wins; a
// tier an import supplied defers to the Targets list, which is where
// tiering is actually maintained.

export const IMPORTED_TIER = 'import';

// Stamped by the importers onto records they CREATE. Deliberately not
// onto records they update: a company already on the roster may have a
// tier someone chose, and a bulk file is no reason to demote it.
export function markImportedTier(record) {
  if (!record || typeof record !== 'object') return record;
  if (!record.tier) return record;
  return { ...record, tierSource: IMPORTED_TIER };
}

// The tier to show. `targetTier` is what the Target Accounts list says,
// or '' when it has no opinion.
//
// Returns `tier` unchanged unless the record's tier came from an import
// AND the Targets list disagrees — in which case the Targets list wins,
// and there is no longer a disagreement to warn about.
export function tierPreferringTargetsList({ tier, targetTier, tierSource }) {
  if (!targetTier || targetTier === tier) return tier;
  return tierSource === IMPORTED_TIER ? targetTier : tier;
}

// Once the user sets a tier through the app it is theirs, whatever an
// import wrote before. Returns the patch to save, clearing the marker
// unless the caller is itself an import.
export function clearImportedTierOnEdit(patch) {
  if (!patch || typeof patch !== 'object') return patch;
  if (!Object.prototype.hasOwnProperty.call(patch, 'tier')) return patch;
  if (Object.prototype.hasOwnProperty.call(patch, 'tierSource')) return patch;
  return { ...patch, tierSource: '' };
}

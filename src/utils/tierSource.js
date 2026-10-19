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

import { matchesCdm } from './cdmMatch.js';

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

// A company marked "Not on tier list, but Dan target" (the checkbox under
// Tier on the company card, `tierOwnTarget`) is one Dan works whatever the
// tier list or its CDM says. Everything that reports on tiered accounts
// (My Accounts, the Tiered tab, decision-maker coverage, Progress) counts
// it, under any CDM. The flag is what counts, not the tier beside it: the
// card's "Targets list says Tier 3" fix sets the tier and leaves the box
// ticked (Amherst Group), and that is still a Dan target.
export const OWN_TARGET_REPORTING_TIER = 'Tier 3';
const REAL_TIERS = ['Tier 1', 'Tier 2', 'Tier 3'];

export function isOwnTarget(record) {
  return record?.tierOwnTarget === true;
}

// The tier a record counts under in tier reporting, trimmed, '' when there
// is none. An own target keeps a real tier (Tier 1, 2 or 3) and otherwise
// (Not on tier list, blank) counts as Tier 3.
export function reportingTier(record) {
  const tier = String(record?.tier || '').trim();
  if (isOwnTarget(record) && !REAL_TIERS.includes(tier)) return OWN_TARGET_REPORTING_TIER;
  return tier;
}

// Whether a record is on this CDM's book for tier reporting: its CDM is
// them, or it is an own target, which counts whoever its CDM is.
export function onMyBook(record, cdmName) {
  return matchesCdm(record?.cdm, cdmName) || isOwnTarget(record);
}

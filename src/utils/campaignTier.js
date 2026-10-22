// The account tier a campaign recipient's company carries, for the Tier
// column on an email campaign's roster.
//
// Read the way the Agenda page reads it: the prospect's own Tier 1 or
// Tier 2 when it has one, else Tier 3 for any other account this CDM
// covers, else nothing (a company that isn't one of the accounts, or one
// somebody else covers). An account with the popup's "Not on tier list,
// but Dan target" box ticked (tierOwnTarget) reads Strategic target instead
// of Tier 3 or blank, whoever its CDM is; a real Tier 1 or 2 still wins. The company is matched on its normalized name, so
// "Invitation Homes, Inc." on the HubSpot contact finds "Invitation Homes"
// on the account list.
//
// Pure, so scripts/campaignTier.test.mjs can hold it still.

import { matchesCdm } from './cdmMatch.js';
import { normalizeCompanyName } from './companyKey.js';

export const STRATEGIC_TARGET = 'Strategic target';

// Strategic target sits between Tier 2 and Tier 3: it is worked like a
// Tier 3 elsewhere, but it is an account somebody picked on purpose.
const RANK = { 'Tier 1': 1, 'Tier 2': 2, [STRATEGIC_TARGET]: 2.5, 'Tier 3': 3 };

// A prospect's tier as the Agenda page shows it, '' for none.
export function prospectTier(prospect, cdmName) {
  const explicit = String(prospect?.tier || '').trim();
  if (explicit === 'Tier 1' || explicit === 'Tier 2') return explicit;
  if (prospect?.tierOwnTarget === true) return STRATEGIC_TARGET;
  return matchesCdm(prospect?.cdm, cdmName) ? 'Tier 3' : '';
}

// company name -> tier. Two accounts that normalize to the same name keep
// the higher tier.
export function buildCampaignTierLookup(prospects = [], cdmName = '') {
  const byKey = new Map();
  for (const p of prospects || []) {
    const key = normalizeCompanyName(p?.company);
    const tier = prospectTier(p, cdmName);
    if (!key || !tier) continue;
    const prev = byKey.get(key);
    if (!prev || RANK[tier] < RANK[prev]) byKey.set(key, tier);
  }
  return (company) => {
    const key = normalizeCompanyName(company);
    return (key && byKey.get(key)) || '';
  };
}

// Sort rank: Tier 1 first ascending, no tier last.
export function tierRank(tier) {
  return RANK[tier] ?? 9;
}

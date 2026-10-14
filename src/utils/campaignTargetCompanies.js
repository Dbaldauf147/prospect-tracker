// Companies a campaign should reach somebody at, before anybody there has
// been picked.
//
// Adding a company to a campaign does NOT put its contacts on the roster.
// It leaves a placeholder on the campaign (campaign.targetCompanies) that
// reads "someone from Acme should be added", and the placeholder is filled
// the moment a contact at that company is on the roster, however they got
// there: added by hand, from the contact popup, or pulled in by a send.
// Nothing is written when it fills; it is worked out from the roster each
// time, so taking that contact off again opens the placeholder back up.
//
//   campaign.targetCompanies = [{ company: 'Acme', addedAt: ISO string }]
//
// Pure (scripts/campaignTargetCompanies.test.mjs).
import { companiesMatch } from './listFlags.js';

export function campaignTargetCompanies(campaign) {
  return (Array.isArray(campaign?.targetCompanies) ? campaign.targetCompanies : [])
    .filter(t => String(t?.company || '').trim());
}

/** Is this company already a target on the campaign? */
export function campaignHasTargetCompany(campaign, company) {
  const name = String(company || '').trim();
  return !!name && campaignTargetCompanies(campaign).some(t => companiesMatch(t.company, name));
}

/**
 * status: 'added' | 'already' | 'blank'. `campaign` is the updated campaign
 * when added, else the one passed in. The roster is left alone.
 */
export function addTargetCompany(campaign, company, now = new Date().toISOString()) {
  const name = String(company || '').trim();
  if (!name) return { status: 'blank', campaign };
  if (campaignHasTargetCompany(campaign, name)) return { status: 'already', campaign };
  return {
    status: 'added',
    campaign: { ...campaign, targetCompanies: [...campaignTargetCompanies(campaign), { company: name, addedAt: now }] },
  };
}

/** Take a company off the campaign's targets (exact name, case-insensitive). */
export function removeTargetCompany(campaign, company) {
  const key = String(company || '').trim().toLowerCase();
  return {
    ...campaign,
    targetCompanies: campaignTargetCompanies(campaign).filter(t => String(t.company).trim().toLowerCase() !== key),
  };
}

/**
 * Each target with the roster rows at that company. `companyOf(row)` names a
 * row's employer; it defaults to the row's own `company`, and the campaign
 * page passes the one its Company column shows (which also reads HubSpot and
 * the email domain). A target with no rows is still open.
 */
export function targetCompanyStatus(campaign, companyOf = (c) => c?.company) {
  const contacts = Array.isArray(campaign?.contacts) ? campaign.contacts : [];
  return campaignTargetCompanies(campaign).map(t => {
    const matches = contacts.filter(c => companiesMatch(String(companyOf(c) || ''), t.company));
    return { ...t, contacts: matches, open: matches.length === 0 };
  });
}

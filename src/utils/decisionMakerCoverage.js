// Decision-maker mapping, tier by tier — the list under step 8 of the
// Prospecting ladder ("Cold prospect outreach").
//
// Cold outreach starts with a name, and an account nobody at it is tagged
// Decision Maker is an account with no name to ring. So the step's work is
// really two jobs in order: find the decision maker, then write to them.
// This module answers the first one — which of your accounts still owe a
// decision maker, and how far through each tier that mapping has got.
//
// Worked in tier order and one tier at a time. Tier 1 is the book worth
// finishing before Tier 2 is started, so a list that mixed all three would
// invite the user to work whichever name they liked the look of. Only the
// first tier still short of fully mapped hands over rows; the tiers behind
// it report their percentage and wait their turn (see `focusTier`).
//
// "Has a decision maker" is exactly the rule the Key Prospects page's
// missing-DM banner runs — the same tag, the same Hide / Left / Schneider
// exclusions, the same fuzzy company match — because the two readouts
// answer the same question about the same accounts, and two rules would
// eventually give two numbers. That page reads these helpers too.

import { applyCompanyOverride, isSchneiderContact, rosterCompaniesMatch } from './contactRosters.js';
import { matchesCdm } from './cdmMatch.js';
import { TIERS } from '../data/enums.js';

const tagsOf = (c) => String(c?.dans_tags || c?.dan_s_tags || c?.dans_tag || '').toLowerCase();

/**
 * Is this contact one the rosters would show at all? Hidden and departed
 * contacts are off every other page, and a "Left" contact is the opposite
 * of a decision maker who can be rung — counting one would mark an account
 * mapped on somebody who has gone.
 */
export function isMappableContact(c) {
  const tags = tagsOf(c);
  if (tags.includes('hide') || tags.includes('left')) return false;
  return !isSchneiderContact(c);
}

/** Is this contact tagged Decision Maker, and still someone to ring? */
export function isDecisionMakerContact(c) {
  return isMappableContact(c) && tagsOf(c).includes('decision maker');
}

/**
 * The companies that have someone tagged Decision Maker, as
 * `{ company, lc }` rows ready for `accountHasDecisionMaker`.
 *
 * `localFields` is settings.contactLocalFields — a contact whose company
 * the user has corrected by hand counts against the corrected name, the
 * same way the contacts pages read it.
 */
export function decisionMakerCompanies(contacts, localFields = null) {
  // De-duped by name: the answer is "does this company have one", so a
  // company with nine tagged decision makers is one entry, not nine fuzzy
  // comparisons per account it is checked against.
  const seen = new Map();
  for (const raw of (contacts || [])) {
    const c = applyCompanyOverride(raw, localFields);
    if (!isDecisionMakerContact(c)) continue;
    const company = String(c.company || '').trim();
    // A decision maker with no company can't be attached to an account.
    if (!company) continue;
    const lc = company.toLowerCase();
    if (!seen.has(lc)) seen.set(lc, { company, lc });
  }
  return [...seen.values()];
}

/** Does this account have one of those decision makers at it? */
export function accountHasDecisionMaker(prospect, dmCompanies) {
  const lc = String(prospect?.company || '').toLowerCase().trim();
  if (!lc) return false;
  for (const c of (dmCompanies || [])) {
    if (c.lc === lc) return true;
    // The contact's HubSpot Company text and the account name drift apart
    // (suffixes, abbreviations), so an exact miss isn't an answer.
    if (rosterCompaniesMatch(prospect.company, c.company)) return true;
  }
  return false;
}

/**
 * The accounts one tier's percentage is counted over: this CDM's, in that
 * tier. Clients are left out — a client is not a cold prospect, and the
 * Key Prospect roster draws its Tier 1 / 2 universe the same way, so the
 * two pages count the same accounts.
 */
export function tierAccounts(prospects, cdmName, tier) {
  const want = String(tier || '').toLowerCase();
  return (prospects || []).filter(p => {
    if (!matchesCdm(p?.cdm, cdmName)) return false;
    if (p.status === 'Client') return false;
    return String(p.tier || '').toLowerCase().trim() === want;
  });
}

// A tier is only finished when nothing is left on it, so the percentage
// must never round up to 100 while a row is still listed underneath it.
function pctMapped(mapped, total) {
  if (!total) return null;
  if (mapped >= total) return 100;
  return Math.min(99, Math.round((mapped / total) * 100));
}

/**
 * Decision-maker mapping per tier.
 *
 * Returns null until both inputs have landed — an empty contact list would
 * otherwise read as "nothing is mapped anywhere" and print the whole book
 * as work owed.
 *
 * Shape:
 *   {
 *     tiers: [{ tier, total, mapped, pct, missing: [row] }],  // Tier 1..3
 *     focusTier,   // the first tier with rows still to map, or ''
 *     missingTotal,
 *     allMapped,   // every tier that has accounts is fully mapped
 *   }
 *
 * Each `missing` row is the prospect record itself plus `contactCount` —
 * how many contacts are already at that company. Nought means the name has
 * to be found; some means it only has to be tagged, which is a different
 * morning's work and the reason the column exists.
 */
export function decisionMakerCoverage({ prospects, contacts, cdmName, localFields = null } = {}) {
  if (!Array.isArray(prospects) || !Array.isArray(contacts)) return null;
  const dmCompanies = decisionMakerCompanies(contacts, localFields);
  // Every contact worth counting against an account, decision maker or
  // not — the "someone is there, nobody is tagged" case. Grouped by
  // company for the same reason the decision makers are: the fuzzy
  // compare below runs once per distinct company rather than once per
  // contact, which on a full book is the difference between a table that
  // paints with the page and one that doesn't.
  const byCompany = new Map();
  for (const raw of contacts) {
    const c = applyCompanyOverride(raw, localFields);
    if (!isMappableContact(c)) continue;
    const company = String(c.company || '').trim();
    if (!company) continue;
    const lc = company.toLowerCase();
    const at = byCompany.get(lc);
    if (at) at.count += 1;
    else byCompany.set(lc, { company, lc, count: 1 });
  }
  const companyCounts = [...byCompany.values()];

  const countContactsAt = (prospect) => {
    const lc = String(prospect?.company || '').toLowerCase().trim();
    if (!lc) return 0;
    let n = 0;
    for (const c of companyCounts) {
      if (c.lc === lc || rosterCompaniesMatch(prospect.company, c.company)) n += c.count;
    }
    return n;
  };

  const tiers = TIERS.map((tier) => {
    const accounts = tierAccounts(prospects, cdmName, tier);
    const missing = [];
    for (const p of accounts) {
      if (accountHasDecisionMaker(p, dmCompanies)) continue;
      missing.push({ ...p, contactCount: countContactsAt(p) });
    }
    missing.sort((a, b) => String(a.company || '').localeCompare(String(b.company || '')));
    const total = accounts.length;
    return { tier, total, mapped: total - missing.length, pct: pctMapped(total - missing.length, total), missing };
  });

  // An empty tier is skipped rather than blocking the ones below it: a
  // book with no Tier 1 accounts has nothing to finish there, and holding
  // Tier 2 back for it would leave the step permanently empty.
  const focus = tiers.find(t => t.missing.length > 0);
  return {
    tiers,
    focusTier: focus ? focus.tier : '',
    missingTotal: tiers.reduce((n, t) => n + t.missing.length, 0),
    allMapped: tiers.every(t => t.missing.length === 0),
  };
}

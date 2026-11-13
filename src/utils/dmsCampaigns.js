// Who on Prospecting > DMs Without Activity is already on an email
// campaign. Those people are spoken for (the campaign is the activity on
// its way), so the page still lists them, with the campaign in its Email
// Campaign column, but the Prospecting badge and the ladder's "Decision
// makers with no activity" step don't count them as work left to do.
import { campaignAddresses } from './campaignAddContact.js';
import { normEmail } from './campaignRoster.js';

/** Every address on any of the campaigns, normalised. */
export function campaignAddressSet(campaigns) {
  const out = new Set();
  for (const c of campaigns || []) for (const a of campaignAddresses(c)) out.add(a);
  return out;
}

/** Is this DMs Without Activity entry ({ contact }) on a campaign? Any of its addresses counts. */
export function onACampaign(entry, addresses) {
  return String(entry?.contact?.email || '').split(/[;,]/).map(normEmail).some(a => a && addresses.has(a));
}

/** The entries left to work: the list less those on a campaign. */
export function dmsNotOnCampaign(list, campaigns) {
  const addresses = campaignAddressSet(campaigns);
  if (!addresses.size) return list || [];
  return (list || []).filter(e => !onACampaign(e, addresses));
}

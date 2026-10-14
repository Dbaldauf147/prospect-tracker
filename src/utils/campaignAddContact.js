// Putting one contact on a saved email campaign from outside the campaign
// page (the Edit HubSpot Contact popup). The same row and the same rules as
// the campaign's own "Add an email to this campaign" box, so a contact added
// from either place is indistinguishable:
//
//   - not added twice: an address already on the roster, alone or inside a
//     grouped send ("a@x.com; b@y.com"), is reported as already there
//   - colleagues (@se.com) are never campaign contacts
//   - an address taken off the campaign before is un-tombstoned, so the
//     next refresh doesn't drop it again
//   - the campaign's counts are re-derived over the new roster
//
// Pure: a campaign in, { status, campaign } out
// (scripts/campaignAddContact.test.mjs).
import { normEmail, isInternalAddress } from './campaignRoster.js';
import { responseRateOf } from './campaignContactHold.js';

// Every address a campaign already carries, group rows split out.
export function campaignAddresses(campaign) {
  return new Set((campaign?.contacts || [])
    .flatMap(c => String(c?.email || '').split(/[;,]/).map(normEmail))
    .filter(Boolean));
}

/** Is this contact (by email) already on the campaign? */
export function campaignHasContact(campaign, email) {
  const key = normEmail(email);
  return !!key && campaignAddresses(campaign).has(key);
}

function deriveCounts(contacts) {
  const sent = contacts.filter(c => !!c?.sentDate).length;
  const replies = contacts.filter(c => c?.replied).length;
  return {
    totalContacts: contacts.length, sent, replies,
    uniqueRecipients: sent, uniqueRepliers: replies,
    responseRate: responseRateOf(contacts),
  };
}

/**
 * contact: { email, name, company }.
 * status: 'added' | 'already' | 'no-email' | 'internal'. `campaign` is the
 * updated campaign when added, else the one passed in.
 */
export function addContactToCampaign(campaign, contact) {
  const email = String(contact?.email || '').trim();
  const key = normEmail(email);
  if (!key || !/.+@.+\..+/.test(key)) return { status: 'no-email', campaign };
  if (isInternalAddress(key)) return { status: 'internal', campaign };
  if (campaignAddresses(campaign).has(key)) return { status: 'already', campaign };
  const row = {
    email,
    name: String(contact?.name || '').trim(),
    company: String(contact?.company || '').trim(),
    sentDate: '', replied: false, eventStatus: '', recipientCount: 1,
    outreach: '', holdUntil: '', notes: '',
  };
  const contacts = [...(campaign?.contacts || []), row];
  const removedEmails = (campaign?.removedEmails || []).filter(e => normEmail(e) !== key);
  return {
    status: 'added',
    campaign: { ...campaign, contacts, removedEmails, ...deriveCounts(contacts) },
  };
}

/**
 * Several contacts at once (the company popup's bulk add), one at a time
 * through addContactToCampaign so each is held to the same rules and two
 * selected people sharing an address go on once.
 * Returns { campaign, added, already, skipped }: the updated campaign and
 * the contacts that went into each outcome (skipped = no email, or a
 * colleague).
 */
export function addContactsToCampaign(campaign, contacts) {
  let current = campaign;
  const added = [], already = [], skipped = [];
  for (const contact of contacts || []) {
    const r = addContactToCampaign(current, contact);
    if (r.status === 'added') { current = r.campaign; added.push(contact); }
    else if (r.status === 'already') already.push(contact);
    else skipped.push(contact);
  }
  return { campaign: current, added, already, skipped };
}

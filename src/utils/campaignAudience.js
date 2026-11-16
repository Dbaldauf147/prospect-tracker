// "Sent To" on a saved email campaign: which of the three audiences it went
// to (Clients, Key Contacts, Prospects), ticked by hand. Stored on the
// campaign as `sentTo: { clients, keyContacts, prospects }` (true only), in
// the same emailCampaigns/{uid} list the Saved Campaigns table writes.
// Shown and ticked on Email Campaigns > Saved Campaigns and on the
// Prospecting ladder's "Reach out to contacts with market updates" step.
import { primarySubject } from './campaignSubjects.js';

export const CAMPAIGN_AUDIENCES = [
  { key: 'clients', label: 'Clients' },
  { key: 'keyContacts', label: 'Key Contacts' },
  { key: 'prospects', label: 'Prospects' },
];

/** { clients, keyContacts, prospects } as booleans. */
export function campaignAudience(c) {
  const s = c?.sentTo && typeof c.sentTo === 'object' ? c.sentTo : {};
  return Object.fromEntries(CAMPAIGN_AUDIENCES.map(a => [a.key, !!s[a.key]]));
}

/** The campaign with one audience ticked or unticked (no `false` stored). */
export function withAudience(c, key, on) {
  const next = { ...(c?.sentTo && typeof c.sentTo === 'object' ? c.sentTo : {}) };
  if (on) next[key] = true; else delete next[key];
  const out = { ...c };
  if (Object.keys(next).length) out.sentTo = next; else delete out.sentTo;
  return out;
}

/** Which saved campaign this is, by its title and lead subject. */
export function campaignIdentity(c) {
  return `${String(c?.title || '').trim().toLowerCase()}|${String(primarySubject(c) || '').trim().toLowerCase()}`;
}

/**
 * The stored list with `target`'s audience changed, found by identity in
 * `campaigns` (the list as stored now). Throws when it isn't there.
 */
export function listWithAudience(campaigns, target, key, on) {
  const id = campaignIdentity(target);
  const i = (campaigns || []).findIndex(c => campaignIdentity(c) === id);
  if (i < 0) throw new Error('That campaign is no longer in the saved list. Reload and try again.');
  return campaigns.map((c, j) => (j === i ? withAudience(c, key, on) : c));
}

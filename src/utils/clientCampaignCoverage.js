// Draft Emails > Client Campaigns: pick a saved email campaign and see, for
// every one of the user's current clients, who at that company is on it.
//
// "Current clients" are the Table View records with status Client and the
// user as CDM (every Client when no CDM name is set up). A campaign
// contact belongs to a client the way the Client roster decides it
// (makeClientAccountLookup): a near-name match on the contact's company,
// then an email domain the client's record claims. A grouped send
// ("a@x.com; b@y.com") is checked address by address, so a send that
// reached two clients shows under both.
//
// Pure: prospects and a campaign in, rows out
// (scripts/clientCampaignCoverage.test.mjs).

import { makeClientAccountLookup } from './contactRosters.js';
import { matchesCdm } from './cdmMatch.js';
import { contactStatusLabel } from './campaignExport.js';
import { withoutInternalRows, rowAddresses } from './campaignRoster.js';
import { campaignOutreachLabel } from './campaignOutreach.js';

const nameKey = (s) => String(s || '').trim().toLowerCase();

/** The user's current clients, one record per company name. */
export function currentClients(prospects, cdmName) {
  const out = [];
  const seen = new Set();
  for (const p of prospects || []) {
    if (!p || p.status !== 'Client') continue;
    if (cdmName && !matchesCdm(p.cdm, cdmName)) continue;
    const k = nameKey(p.company);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

/** Campaigns for the picker: newest first, each with a label and id. */
export function campaignChoices(campaigns) {
  return (Array.isArray(campaigns) ? campaigns : [])
    .filter(c => c && typeof c === 'object')
    .map((c, i) => ({
      key: `${campaignOutreachLabel(c)}::${i}`,
      label: campaignOutreachLabel(c),
      campaign: c,
      when: Date.parse(c.savedAt || c.refreshedAt || '') || 0,
    }))
    .sort((a, b) => b.when - a.when || a.label.localeCompare(b.label));
}

// The date a person was last sent the campaign, as a sortable string.
const dateOf = (v) => {
  if (!v) return '';
  const t = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : '';
};

/**
 * One row per current client:
 *   { id, company, client, people: [{ name, email, status, sentDate }],
 *     onCampaign, sent, replied, lastSent }
 * `people` is everyone on the campaign at that client, Replied first.
 */
export function clientCampaignRows({ prospects, cdmName, campaign }) {
  const clients = currentClients(prospects, cdmName);
  // The lookup only knows Client records, and only these ones.
  const lookup = makeClientAccountLookup(clients);
  const byName = new Map(clients.map(p => [nameKey(p.company), p]));
  const people = new Map(clients.map(p => [nameKey(p.company), []]));

  for (const c of withoutInternalRows(campaign?.contacts)) {
    const addresses = rowAddresses(c);
    const hits = new Set();
    // The contact's own company first, then each address's domain.
    const first = lookup({ company: c.company, email: addresses[0] || '' });
    if (first) hits.add(nameKey(first));
    for (const email of addresses.slice(1)) {
      const hit = lookup({ company: '', email });
      if (hit) hits.add(nameKey(hit));
    }
    for (const k of hits) {
      const list = people.get(k);
      if (!list) continue;
      list.push({
        name: String(c.name || '').trim(),
        email: String(c.email || '').trim(),
        status: contactStatusLabel(c),
        sentDate: dateOf(c.sentDate),
      });
    }
  }

  const statusRank = { Replied: 0, 'No Reply': 1, 'Out of Office': 2, Bounced: 3, 'Not Sent': 4 };
  return clients.map(p => {
    const k = nameKey(p.company);
    const list = (people.get(k) || []).slice().sort((a, b) =>
      (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9)
      || (a.name || a.email).localeCompare(b.name || b.email));
    const sentDates = list.map(x => x.sentDate).filter(Boolean).sort();
    return {
      id: p.id != null ? String(p.id) : k,
      company: String(p.company || '').trim(),
      client: byName.get(k),
      people: list,
      onCampaign: list.length,
      sent: list.filter(x => x.status !== 'Not Sent').length,
      replied: list.filter(x => x.status === 'Replied').length,
      lastSent: sentDates.at(-1) || '',
    };
  });
}

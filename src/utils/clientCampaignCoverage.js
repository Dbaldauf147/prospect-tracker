// Draft Emails > Client Campaigns: pick a saved email campaign and see, for
// every one of the user's current clients, who at that company is on it.
//
// "Current clients" are the Table View records with status Client and the
// user as CDM (every Client when no CDM name is set up), less any ticked
// "Don't Track" on the Clients tab (untrackedMap, keyed by lowercased
// company name). A campaign
// contact belongs to a client the way the Client roster decides it
// (makeClientAccountLookup): a near-name match on the contact's company,
// then an email domain the client's record claims. A grouped send
// ("a@x.com; b@y.com") is checked address by address, so a send that
// reached two clients shows under both.
//
// Pure: prospects and a campaign in, rows out
// (scripts/clientCampaignCoverage.test.mjs).

import { makeAccountRecordLookup, contactDisplayName } from './contactRosters.js';
import { tagKey, findTagRecord, tagStateFrom } from './contactTagReview.js';
import { matchesCdm } from './cdmMatch.js';
import { contactStatusLabel } from './campaignExport.js';
import { withoutInternalRows, rowAddresses } from './campaignRoster.js';
import { campaignOutreachLabel } from './campaignOutreach.js';
import { SERVICE_BUCKETS, serviceStatusBucket } from './serviceStatusColors.js';

const nameKey = (s) => String(s || '').trim().toLowerCase();

/** The user's current clients, one record per company name. */
export function currentClients(prospects, cdmName, untrackedMap = null) {
  const out = [];
  const seen = new Set();
  for (const p of prospects || []) {
    if (!p || p.status !== 'Client') continue;
    if (cdmName && !matchesCdm(p.cdm, cdmName)) continue;
    const k = nameKey(p.company);
    if (!k || seen.has(k)) continue;
    if (untrackedMap && untrackedMap[k]) continue;
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

// Which companies the page lists. Clients are the current-client roll
// (currentClients). Key Contacts and Prospects are the companies of the
// people on those contact rosters (contactRosters.makeRosterGates: isKey,
// the Key Contacts page; isKeyProspect, the Key Prospects page), each
// resolved to its Table View record, so the service statuses still read.
export const CAMPAIGN_AUDIENCE_VIEWS = [
  { key: 'clients', label: 'Clients', noun: 'current clients', one: 'client' },
  { key: 'keyContacts', label: 'Key Contacts', noun: 'Key Contact companies', one: 'company' },
  { key: 'prospects', label: 'Prospects', noun: 'DM at Tier 1-3 companies', one: 'company' },
];

/**
 * The Table View records behind the people on one contact roster: each
 * contact passing `gate` is resolved to its company record (near-name, then
 * email domain), one record per company. `accountOf(contact)` can name the
 * record to use instead (Key Prospects come in through their Tier account).
 * Don't Track companies are left off, as on the client list. Pass a Map as
 * `people` to also get each company's roster contacts (company key ->
 * contacts), for the Key Contacts column.
 */
export function rosterAccounts({ prospects, contacts, gate, accountOf = null, untrackedMap = null, people = null }) {
  const lookup = makeAccountRecordLookup(prospects);
  const byName = new Map((prospects || []).map(p => [nameKey(p?.company), p]));
  const out = new Map();
  for (const c of contacts || []) {
    if (!gate(c)) continue;
    const named = accountOf ? accountOf(c) : '';
    const rec = (named && byName.get(nameKey(named))) || lookup(c);
    const k = nameKey(rec?.company);
    if (!k) continue;
    if (untrackedMap && untrackedMap[k]) continue;
    if (people) {
      if (!people.has(k)) people.set(k, []);
      people.get(k).push(c);
    }
    if (!out.has(k)) out.set(k, rec);
  }
  return [...out.values()];
}

// The area tags a contact can carry (utils/contactTagReview TAG_OPTIONS
// less the roster / housekeeping ones), shown when a campaign's services
// have no Contact Tags set to pick the relevant ones out.
const AREA_TAGS = ['ESG', 'Procurement', 'Utilities', 'Climate Risk', 'Private Equity', 'Real Estate', 'Capital Planning'];

const contactTagList = (c) => String(c?.dans_tags || c?.dan_s_tags || c?.dans_tag || '')
  .split(';').map(t => t.trim()).filter(Boolean);

/**
 * Does the contact carry at least one of `tags` (the campaign services'
 * Contact Tags)? True when `tags` is empty: with nothing set on the
 * services there is nothing to narrow by.
 */
export function contactHasAnyTag(contact, tags = []) {
  if (!tags.length) return true;
  const want = new Set(tags.map(tagKey));
  return contactTagList(contact).some(t => want.has(tagKey(t)));
}

/**
 * Is this contact closed on the campaign's service: their own tag status
 * (the contact popup's Sold / Not sold / N/A, settings.contactTagReview) is
 * Not sold or N/A for one of the services' Contact Tags, and no other of
 * those tags is still open for them? Dan has already settled the service
 * with this person, so they come off the Key Contacts / Prospects lists.
 *
 * "Still open" is a service tag they carry with no Not sold / N/A on it,
 * so somebody who owns Procurement (Not sold) and ESG (open) on a campaign
 * covering both stays. With no service tags there is nothing to judge by.
 */
const CLOSED_TAG_STATUSES = new Set(['notsold', 'na']);
export function contactClosedOnService(contact, reviewMap, tags = []) {
  if (!tags.length) return false;
  const cid = contact?.id ?? contact?.vid;
  const answers = cid == null ? null : reviewMap?.[cid];
  if (!answers || typeof answers !== 'object') return false;
  const carried = new Set(contactTagList(contact).map(tagKey));
  let closed = false;
  for (const tag of tags) {
    // Resolved the way the contact popup shows the row, so a stale Not sold
    // under a tag that has since gone back on doesn't count.
    const tagged = carried.has(tagKey(tag));
    const { status } = tagStateFrom(tagged, findTagRecord(answers, tag));
    if (CLOSED_TAG_STATUSES.has(status)) closed = true;
    else if (tagged) return false;
  }
  return closed;
}

/**
 * How one Key Contact reads in the Key Contacts column:
 *   { name, email, tags, dm }
 * `tags` are the contact's own tags among `serviceTags` (the campaign
 * services' Contact Tags), or among the area tags when no service has any
 * set. `dm` is the Decision Maker tag.
 */
export function keyContactSummary(contact, serviceTags = []) {
  const want = new Set((serviceTags.length ? serviceTags : AREA_TAGS).map(tagKey));
  const own = contactTagList(contact);
  const tags = [];
  const seen = new Set();
  for (const t of own) {
    const k = tagKey(t);
    if (!want.has(k) || seen.has(k)) continue;
    seen.add(k);
    tags.push(t);
  }
  return {
    name: contactDisplayName(contact),
    email: String(contact?.email || '').trim(),
    tags,
    dm: own.some(t => tagKey(t) === tagKey('Decision Maker')),
  };
}

/**
 * One row per current client:
 *   { id, company, client, people: [{ name, email, status, sentDate }],
 *     onCampaign, sent, replied, lastSent }
 * `people` is everyone on the campaign at that client, Replied first.
 */
export function clientCampaignRows({ prospects, cdmName, campaign, untrackedMap = null, accounts = null }) {
  // `accounts` swaps the client list for another set of companies (the Key
  // Contacts / Prospects views); otherwise it is the current clients.
  const clients = accounts || currentClients(prospects, cdmName, untrackedMap);
  // The lookup only knows these records, so a contact lands on one of them
  // or on none.
  const lookup = makeAccountRecordLookup(clients);
  const byName = new Map(clients.map(p => [nameKey(p.company), p]));
  const people = new Map(clients.map(p => [nameKey(p.company), []]));

  for (const c of withoutInternalRows(campaign?.contacts)) {
    const addresses = rowAddresses(c);
    const hits = new Set();
    // The contact's own company first, then each address's domain.
    const first = lookup({ company: c.company, email: addresses[0] || '' });
    if (first) hits.add(nameKey(first.company));
    for (const email of addresses.slice(1)) {
      const hit = lookup({ company: '', email });
      if (hit) hits.add(nameKey(hit.company));
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

/**
 * The bucket a service status lands in on this board. Same as everywhere
 * else (serviceStatusBucket), except Renewal: the client already has the
 * service and is only up for renewal, so for a campaign pitching it there
 * is nothing being explored and it reads as Not explored. Kept to this
 * board; the PE Overview report still counts Renewal as in progress.
 */
export function campaignServiceBucket(status) {
  if (String(status || '').trim().toLowerCase() === 'renewal') return 'none';
  return serviceStatusBucket(status);
}

/**
 * The campaign's services, each with the current clients split by where
 * that service stands at them (utils/serviceStatusColors SERVICE_BUCKETS:
 * Sold, In progress, Not sold, N/A, Not explored). Every bucket is listed,
 * empty ones too, so "nobody is N/A" reads as an answer.
 *
 * `statusOf(client, service)` is the status the company popup would show
 * (serviceCoverage.effectiveServiceStatus). Clients A to Z in each bucket.
 *   [{ service, buckets: [{ key, label, color, bg, clients: [{ row, status }] }] }]
 */
export function clientServiceBuckets({ rows, services, statusOf }) {
  const buckets = SERVICE_BUCKETS.map(({ key, label, color, bg }) => ({ key, label, color, bg }));
  return (services || []).map(service => {
    const by = new Map(buckets.map(b => [b.key, []]));
    for (const row of rows || []) {
      const status = String((row.client && statusOf(row.client, service)) || '').trim();
      const key = campaignServiceBucket(status);
      (by.get(key) || by.get('none'))?.push({ row, status });
    }
    return {
      service,
      buckets: buckets.map(b => ({
        ...b,
        clients: by.get(b.key).sort((x, y) => x.row.company.localeCompare(y.row.company)),
      })),
    };
  });
}

// Where has this person shown up?
//
// A campaign answers "who did this go to". The question this file answers is
// the other way round: somebody rings back, or a name comes up on a call, and
// what you want is every campaign that address is on — when each went out,
// whether it was chased, whether they replied, whether they are on hold —
// without opening eleven saved campaigns one at a time to find out.
//
// Everything here is pure: saved campaigns in, rows out
// (scripts/campaignContactLookup.test.mjs). The rows carry the campaign's
// index in the saved list so the view can open the one that is clicked.

/**
 * An address, normalized the way a campaign roster normalizes one.
 *
 * "Sam Doe <sam@acme.com>" comes back as "sam@acme.com": an address pasted
 * out of a mail client carries its display name, and a lookup that misses
 * because of the angle brackets is a lookup that looks broken.
 */
export function normLookupEmail(value) {
  const raw = String(value ?? '').trim();
  const angled = raw.match(/<([^>]+)>/);
  return (angled ? angled[1] : raw).toLowerCase().trim();
}

/**
 * Every address on one roster row.
 *
 * A row can name several ("a@x.com; b@y.com") when one email went to a
 * group, and each of them is a person who can be looked up.
 */
export function contactAddresses(contact) {
  return String(contact?.email || '')
    .split(/[;,]/)
    .map(normLookupEmail)
    .filter(Boolean);
}

// Does one roster row answer to what was typed, and how well? 0 no, 1 the
// query is part of an address, 2 an address IS the query.
function scoreRow(addresses, q) {
  let best = 0;
  for (const a of addresses) {
    if (a === q) return 2;
    if (a.includes(q)) best = 1;
  }
  return best;
}

/** The lookup box only searches once there is something to search on. */
export const LOOKUP_MIN_CHARS = 2;

/**
 * Every campaign row this address appears on.
 *
 * Exact matches win outright: typing a full address that also happens to be
 * the start of a longer one ("sam@acme.com", "sam@acme.com.au") asks about
 * the person, not about everyone whose address contains theirs. With no
 * exact match anywhere the search falls back to substring, which is what
 * makes a half-remembered local part or a bare "@acme.com" work.
 *
 * A campaign that lists the same address twice (the duplicate rows the
 * campaign view flags) yields a row each: hiding one of them here would hide
 * the very thing the duplicate warning exists to surface.
 *
 * Rows come back most recently sent first, so the last thing this person was
 * sent leads; never-sent rows sit at the end in campaign order.
 */
export function findContactRows(campaigns, query) {
  const q = normLookupEmail(query);
  if (q.length < LOOKUP_MIN_CHARS) return [];
  const exact = [];
  const partial = [];
  (campaigns || []).forEach((campaign, campaignIndex) => {
    (campaign?.contacts || []).forEach((contact, contactIndex) => {
      const addresses = contactAddresses(contact);
      const score = scoreRow(addresses, q);
      if (!score) return;
      const row = { campaignIndex, campaign, contact, contactIndex, addresses };
      (score === 2 ? exact : partial).push(row);
    });
  });
  const rows = exact.length ? exact : partial;
  return rows.sort((a, b) => {
    const at = a.contact?.sentDate ? new Date(a.contact.sentDate).getTime() || 0 : 0;
    const bt = b.contact?.sentDate ? new Date(b.contact.sentDate).getTime() || 0 : 0;
    if (at !== bt) return bt - at;
    return a.campaignIndex - b.campaignIndex || a.contactIndex - b.contactIndex;
  });
}

/**
 * The line above the results: what these rows add up to.
 *
 * Campaigns are counted distinctly (a duplicated address is still one
 * campaign) while sends and replies are counted per row, because two sends
 * to the same person under one campaign really are two emails they got.
 */
export function lookupSummary(rows) {
  const campaigns = new Set();
  const addresses = new Set();
  let sent = 0;
  let replies = 0;
  for (const r of (rows || [])) {
    campaigns.add(r.campaignIndex);
    for (const a of (r.addresses || [])) addresses.add(a);
    if (r.contact?.sentDate) sent += 1;
    if (r.contact?.replied) replies += 1;
  }
  return {
    rows: (rows || []).length,
    campaigns: campaigns.size,
    sent,
    replies,
    addresses: [...addresses],
  };
}

/**
 * The people the lookup box can offer, one per address across every saved
 * campaign.
 *
 * Shaped like the HubSpot contacts the suggestion box already takes (id,
 * email, name, company) so it can be handed straight to matchContacts. Names
 * and employers are not on a roster row, so `nameFor` fills them in from
 * whatever the caller knows — the HubSpot cache, in the view.
 *
 * Only addresses that are actually on a campaign are offered: this box
 * searches campaigns, and suggesting somebody who is on none of them offers
 * a search whose only answer is "no rows".
 */
export function lookupSuggestions(campaigns, nameFor) {
  const byEmail = new Map();
  // Which campaigns each address is on, by index: a campaign that lists the
  // same person twice is still one campaign to tell them about.
  const seenOn = new Map();
  (campaigns || []).forEach((campaign, campaignIndex) => {
    for (const contact of (campaign?.contacts || [])) {
      for (const email of contactAddresses(contact)) {
        if (!byEmail.has(email)) {
          const extra = nameFor?.(email) || {};
          byEmail.set(email, {
            id: email,
            email,
            name: String(extra.name || '').trim(),
            company: String(extra.company || contact?.company || '').trim(),
            campaigns: 0,
          });
          seenOn.set(email, new Set());
        }
        seenOn.get(email).add(campaignIndex);
      }
    }
  });
  for (const [email, entry] of byEmail) entry.campaigns = seenOn.get(email).size;
  return [...byEmail.values()].sort((a, b) => a.email.localeCompare(b.email));
}

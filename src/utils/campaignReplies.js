// When each contact last replied to a saved email campaign.
//
// Drives the All Contacts "Campaign Reply" column. The campaign refresh
// (api/email-campaign) already records, per recipient row, whether anyone
// replied, when, and who (`replied`, `replyDate`, `repliedBy`); this folds
// every saved campaign into one newest-reply-per-person lookup.
//
// A row can be a group send ("a@x.com; b@x.com"), and a reply from one of
// them marks the whole row. So a group row only credits the person who
// actually wrote back, matched on `repliedBy` (the sender's name, or their
// address when HubSpot had no name). A one-person row needs no matching.

import { primarySubject } from './campaignSubjects.js';

function splitAddresses(raw) {
  return String(raw || '')
    .toLowerCase()
    .split(/[;,]/)
    .map(s => s.trim())
    .filter(Boolean);
}

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

export function fmtReplyDate(ms) {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// savedCampaigns -> Map(lowercased address -> [{ tsMs, subject, repliedBy, group }])
export function latestCampaignReplies(savedCampaigns) {
  const map = new Map();
  for (const camp of (savedCampaigns || [])) {
    const subject = primarySubject(camp);
    for (const ct of (camp?.contacts || [])) {
      if (!ct?.replied) continue;
      const tsMs = new Date(ct.replyDate).getTime();
      if (!Number.isFinite(tsMs)) continue;
      const addrs = [...new Set(splitAddresses(ct.email))];
      for (const a of addrs) {
        if (!map.has(a)) map.set(a, []);
        map.get(a).push({ tsMs, subject, repliedBy: ct.repliedBy || '', group: addrs.length > 1 });
      }
    }
  }
  return map;
}

// The newest reply this contact sent: { tsMs, subject, repliedBy, label,
// count } or null. `count` is how many campaign replies are theirs.
export function campaignReplyForContact(replies, contact) {
  const email = norm(contact?.email);
  if (!email || !replies) return null;
  const name = norm(contact?.name || [contact?.firstname, contact?.lastname].filter(Boolean).join(' '));
  const mine = (replies.get(email) || []).filter((r) => {
    if (!r.group) return true;
    const by = norm(r.repliedBy);
    return !!by && (by === email || (!!name && by === name));
  });
  if (mine.length === 0) return null;
  const best = mine.reduce((a, b) => (b.tsMs > a.tsMs ? b : a));
  return { ...best, label: fmtReplyDate(best.tsMs), count: mine.length };
}

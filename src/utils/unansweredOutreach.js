// How many times you've emailed someone without hearing back.
//
// Drives the All Contacts "No Reply" column and the list that opens when the
// count is clicked. For every person, it counts the emails you sent them
// after the last email they sent you. A reply resets the count to 0, so the
// number is "unanswered in a row", not a lifetime tally.
//
// Two sources, merged per contact:
//
// 1. The HubSpot email feed (the Activity tab's, or loaded by the page
//    itself). HubSpot logs mail two ways: a 1:1 email carries the addresses
//    in hs_email_to_email / hs_email_from_email, while a one-to-many or
//    sequence send logs with those blank and names its recipients only
//    through the associated contact IDs (`_contactIds`, added by
//    /api/hubspot?action=activity). So that index is kept both by address
//    and by contact ID.
// 2. The saved email campaigns, which are on the page already and record
//    each recipient's sends (`sendHistory`) and reply (`replyDate`). They
//    are there the moment the page opens, where the feed can take a minute
//    to page through, so a contact you've campaigned shows up straight away.
//
// The same email can reach both sources (a campaign send is a HubSpot email
// too), so sends are de-duplicated by timestamp.
//
// Direction follows the Activity tab's rule: a sender at @se.com (or the
// user's own work email) is you; any other sender is them; a blank sender
// falls back to HubSpot's hs_email_direction (INCOMING_EMAIL = received).
// Only the To line (or the association) counts as reaching out. Being cc'd
// on someone else's thread isn't an ask of that person.

import { followUpInfo } from './campaignFollowUp.js';
import { primarySubject } from './campaignSubjects.js';
import { campaignRepliesForContact } from './campaignReplies.js';

// Bumped whenever the stored shape changes, so a page holding an index
// built by older code knows to rebuild it instead of reading it wrongly.
// 3: sends carry their subject, for the click-through list.
export const UNANSWERED_VERSION = 3;

function splitAddresses(raw) {
  return String(raw || '')
    .toLowerCase()
    .split(/[;,]/)
    .map(a => {
      const m = a.match(/<([^>]+)>/);
      return (m ? m[1] : a).trim();
    })
    .filter(Boolean);
}

export function emailDirection(e, workEmail = '') {
  const from = splitAddresses(e?.hs_email_from_email)[0] || '';
  const own = String(workEmail || '').toLowerCase().trim();
  if (from) return from.includes('@se.com') || (own && from === own) ? 'out' : 'in';
  const rawDir = String(e?.hs_email_direction || '').toUpperCase();
  if (rawDir === 'INCOMING_EMAIL') return 'in';
  return rawDir ? 'out' : '';
}

// emails: raw HubSpot email records. Returns
//   { v, byEmail: { addr: entry }, byId: { contactId: entry } }
// where entry = { sends: [{ ms, subject }], lastReplyMs }. `sends` holds only
// the sends after that key's own last reply, so the index stays small; a key
// with a reply and nothing since keeps just its lastReplyMs, which the merge
// needs (an address reply can answer an association send).
export function buildUnansweredIndex(emails, workEmail = '') {
  const byEmail = {};
  const byId = {};
  const slot = (bucket, key) => (bucket[key] ||= { sends: [], lastReplyMs: 0 });
  for (const e of (emails || [])) {
    const subject = String(e?.hs_email_subject || '');
    if (subject.toLowerCase().includes('(sample email)')) continue;
    const ms = new Date(e?.hs_timestamp).getTime();
    if (!Number.isFinite(ms)) continue;
    const dir = emailDirection(e, workEmail);
    if (!dir) continue;
    const addrs = dir === 'out' ? splitAddresses(e.hs_email_to_email) : splitAddresses(e.hs_email_from_email).slice(0, 1);
    // Associations on an inbound mail can include everyone on the thread,
    // so only the sender's own address counts as the reply.
    const ids = dir === 'out' ? (e._contactIds || []).map(String) : [];
    const touch = (s) => {
      if (dir === 'out') s.sends.push({ ms, subject });
      else if (ms > s.lastReplyMs) s.lastReplyMs = ms;
    };
    for (const a of new Set(addrs)) touch(slot(byEmail, a));
    for (const id of new Set(ids)) touch(slot(byId, id));
  }
  const prune = (bucket) => {
    for (const [k, s] of Object.entries(bucket)) {
      s.sends = s.sends.filter(x => x.ms > s.lastReplyMs);
      if (s.sends.length === 0 && !s.lastReplyMs) delete bucket[k];
    }
    return bucket;
  };
  return { v: UNANSWERED_VERSION, byEmail: prune(byEmail), byId: prune(byId) };
}

// savedCampaigns -> Map(lowercased address -> [{ ms, subject, campaign }]).
// Each roster row's own sends: the stored history where there is one,
// otherwise its single sentDate. `hidden` counts sends the capped history
// no longer details (sendCount beyond the history), dated before its oldest
// entry, so an unreplied contact's count stays exact.
export function campaignSendsByAddress(savedCampaigns) {
  const map = new Map();
  for (const camp of (savedCampaigns || [])) {
    const campaign = camp?.title || primarySubject(camp) || '(untitled campaign)';
    for (const ct of (camp?.contacts || [])) {
      const info = followUpInfo(ct);
      if (!info.sent) continue;
      const sends = info.history.length
        ? info.history.map(h => ({ ms: new Date(h?.date).getTime(), subject: h?.subject || primarySubject(camp) }))
        : [{ ms: new Date(ct.sentDate).getTime(), subject: primarySubject(camp) }];
      const dated = sends.filter(x => Number.isFinite(x.ms));
      const hidden = info.known ? Math.max(0, info.sendCount - info.history.length) : 0;
      const oldestMs = dated.length ? Math.min(...dated.map(x => x.ms)) : 0;
      for (const a of new Set(splitAddresses(ct.email))) {
        if (!map.has(a)) map.set(a, []);
        const list = map.get(a);
        for (const x of dated) list.push({ ...x, campaign });
        if (hidden && oldestMs) list.push({ ms: oldestMs - 1, subject: '', campaign, hidden });
      }
    }
  }
  return map;
}

// One contact's figure: { count, lastSentMs, lastReplyMs, emails } where
// `emails` is the unanswered sends, newest first: { ms, subject, source }.
// A summary row for sends a campaign no longer details carries `hidden`
// (how many) instead of a date. Returns null when neither source is loaded.
export function unansweredFor({ index, campaignSends, campaignReplies } = {}, contact = {}) {
  if (!index && !campaignSends) return null;
  const email = String(contact.email || '').toLowerCase().trim();
  const id = contact.id != null ? String(contact.id) : '';
  const feedParts = index ? [
    email ? index.byEmail?.[email] : null,
    id ? index.byId?.[id] : null,
  ].filter(Boolean) : [];
  const campaignRows = email && campaignSends ? (campaignSends.get(email) || []) : [];
  const replyTimes = [
    ...feedParts.map(p => p.lastReplyMs || 0),
    ...campaignRepliesForContact(campaignReplies, contact).map(r => r.tsMs),
  ];
  const lastReplyMs = Math.max(0, ...replyTimes);

  // Same email from both sources: keep one, preferring the campaign's row
  // because it names the campaign.
  const byMs = new Map();
  for (const p of feedParts) {
    for (const s of p.sends || []) if (s.ms > lastReplyMs && !byMs.has(s.ms)) byMs.set(s.ms, { ms: s.ms, subject: s.subject || '', source: 'HubSpot' });
  }
  let hidden = 0;
  for (const s of campaignRows) {
    if (s.ms <= lastReplyMs) continue;
    if (s.hidden) { hidden += s.hidden; continue; }
    byMs.set(s.ms, { ms: s.ms, subject: s.subject || '', source: s.campaign });
  }
  const emails = [...byMs.values()].sort((a, b) => b.ms - a.ms);
  if (hidden) emails.push({ ms: null, subject: '', source: 'Campaign', hidden });
  const dated = emails.filter(e => e.ms != null);
  return {
    count: dated.length + hidden,
    lastSentMs: dated.length ? dated[0].ms : null,
    lastReplyMs: lastReplyMs || null,
    emails,
  };
}

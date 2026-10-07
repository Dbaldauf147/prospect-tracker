// Did this contact get a second email?
//
// A campaign is defined by its subject lines, and the campaign report has
// always collapsed every send to one address into a single row carrying the
// most recent date — so a follow-up ("RE: …", a re-send a fortnight later, a
// second wave under the campaign's other subject line) was indistinguishable
// from a first touch that happened to be recent. That is exactly the question
// somebody working a list asks: have I already chased this one?
//
// The counting lives here, shared by the API that reads HubSpot
// (api/email-campaign.js) and by the table and CSV that print the answer, so
// the number on screen, the number in the file and the number the server
// worked out can't drift apart. Everything in this file is pure.
//
// Sends are counted PER ADDRESS rather than per recipient set: a first mail
// that went to a contact plus their colleague and a follow-up that went to
// them alone are two different recipient sets, and to the person reading the
// row it is still one contact who has been emailed twice.

import { primarySubject } from './campaignSubjects.js';

// How many of a contact's sends travel with them. The count is always exact;
// only the per-send detail behind the tooltip is capped, because a campaign
// roster is stored in Firestore and a long history on every row is weight
// nobody reads.
export const SEND_HISTORY_CAP = 6;

// Index every campaign send by each address it reached.
//
// `sends` is one entry per email HubSpot returned:
//   { id, timestamp, subject, recipients: ['a@x.com', ...] }
// The id is what deduplicates — the same email can be reached through more
// than one of a campaign's subject-line searches, and it is still one send.
export function sendHistoryByAddress(sends) {
  const byAddress = new Map();
  for (const s of (sends || [])) {
    for (const address of (s?.recipients || [])) {
      if (!address) continue;
      let seen = byAddress.get(address);
      if (!seen) { seen = new Map(); byAddress.set(address, seen); }
      seen.set(s.id, { date: s.timestamp || '', subject: s.subject || '' });
    }
  }
  return byAddress;
}

// Every send that reached ANY of these addresses, oldest first, deduplicated
// by email id (a send to two of them is one send). Returns the true count and
// the first send's date alongside the capped detail.
export function sendHistoryFor(byAddress, recipients, cap = SEND_HISTORY_CAP) {
  const byId = new Map();
  for (const address of (recipients || [])) {
    for (const [id, entry] of (byAddress?.get(address) || [])) byId.set(id, entry);
  }
  // HubSpot timestamps are ISO strings, which sort correctly as text; a send
  // with no timestamp at all sorts first rather than being dropped.
  const all = [...byId.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  // The first send is reported separately because the detail is capped from
  // the newest end: on a contact chased more times than the cap, the oldest
  // entry in `history` is no longer the one the campaign started with.
  return {
    sendCount: all.length,
    firstSentDate: all[0]?.date || null,
    history: all.slice(-cap),
  };
}

/**
 * What the Follow-up column knows about one contact.
 *
 * `known` is the one that matters for display: a campaign saved before this
 * existed has contacts with a send date and no send count, and "no follow-up"
 * would be a lie there — the answer is simply not in the snapshot yet. It
 * fills in on the next refresh, which happens on its own when the campaign is
 * opened.
 */
export function followUpInfo(contact) {
  const sent = !!contact?.sentDate;
  // A count only counts when it is a real number: a roster entry added by
  // hand, or one saved before this existed, carries none.
  const raw = Number(contact?.sendCount);
  const counted = typeof contact?.sendCount === 'number' && Number.isFinite(raw) && raw > 0;
  const sendCount = counted ? raw : 0;
  const history = Array.isArray(contact?.sendHistory) ? contact.sendHistory : [];
  return {
    sent,
    known: sent && counted,
    sendCount,
    followUp: sent && counted && sendCount > 1,
    // How many chases went out after the first email.
    followUpCount: sent && counted && sendCount > 1 ? sendCount - 1 : 0,
    firstSentDate: contact?.firstSentDate || history[0]?.date || contact?.sentDate || null,
    lastSentDate: contact?.sentDate || history[history.length - 1]?.date || null,
    history,
  };
}

// The answer in one word, for the CSV and anywhere else that can't draw a
// badge. Blank where there is no answer to give: never emailed, or a snapshot
// that predates the count.
export function followUpLabel(contact) {
  const info = followUpInfo(contact);
  if (!info.sent || !info.known) return '';
  return info.followUp ? 'Yes' : 'No';
}

// Which saved campaigns emailed each address in the last `days` days, and
// how many times — the All Contacts "Campaigns (60d)" column and the list
// that opens when you click it.
//
// Each roster row knows its own sends: `sendHistory` (capped, newest end),
// `sendCount` (exact) and `firstSentDate`. When the first send is inside the
// window every send is, so the exact count stands; otherwise the capped
// history is counted date by date. A row from before send counts existed
// has only `sentDate`, which is worth one send if it falls in the window.
//
// A roster row's `email` can be a '; '-joined group send, so each address
// in it is credited. Returns Map<lowercased email, { count, campaigns }>,
// only for addresses with at least one send in the window. `campaigns` is
// one entry per campaign — { index, label, count, lastSentDate } — newest
// send first; `index` is the campaign's position in the saved list, which
// is what identifies it (subjects need not be unique).
export function campaignSendDetailWithin(campaigns, days, nowMs = Date.now()) {
  const cutoff = nowMs - days * 24 * 60 * 60 * 1000;
  const inWindow = (d) => {
    const t = d ? new Date(d).getTime() : NaN;
    return Number.isFinite(t) && t >= cutoff && t <= nowMs;
  };
  const byEmail = new Map();
  (campaigns || []).forEach((camp, index) => {
    const label = camp?.title || primarySubject(camp) || '(untitled campaign)';
    for (const ct of (camp?.contacts || [])) {
      const info = followUpInfo(ct);
      if (!info.sent) continue;
      let n;
      if (info.known && inWindow(info.firstSentDate)) n = info.sendCount;
      else if (info.history.length) n = info.history.filter(h => inWindow(h?.date)).length;
      else n = inWindow(ct.sentDate) ? 1 : 0;
      if (!n) continue;
      const last = info.lastSentDate || '';
      for (const part of String(ct.email || '').split(/[;,]/)) {
        const em = part.trim().toLowerCase();
        if (!em) continue;
        let entry = byEmail.get(em);
        if (!entry) { entry = { count: 0, campaigns: [] }; byEmail.set(em, entry); }
        entry.count += n;
        // One address on two rows of the same campaign is still one campaign.
        const prev = entry.campaigns.find(x => x.index === index);
        if (prev) {
          prev.count += n;
          if (String(last) > String(prev.lastSentDate)) prev.lastSentDate = last;
        } else {
          entry.campaigns.push({ index, label, count: n, lastSentDate: last });
        }
      }
    }
  });
  for (const entry of byEmail.values()) {
    entry.campaigns.sort((a, b) => String(b.lastSentDate).localeCompare(String(a.lastSentDate)));
  }
  return byEmail;
}

// Just the totals: Map<lowercased email, count>.
export function campaignSendsWithin(campaigns, days, nowMs = Date.now()) {
  const counts = new Map();
  for (const [em, entry] of campaignSendDetailWithin(campaigns, days, nowMs)) counts.set(em, entry.count);
  return counts;
}

// Draft Emails > Recent Sends: how much campaign email each contact group
// has had from Dan in the last three weeks, so a new campaign can go to the
// people who have heard the least.
//
// The groups are the contact rosters (contactRosters.makeRosterGates):
// Clients (isClient), Key Contacts (isKey) and Prospects (isKeyProspect,
// the DMs at Tier 1-3, as Client Campaigns calls them). A send counts
// exactly when the Drafts page's "emailed by another campaign in the last
// 3 weeks" warning counts it (campaignSendDetailWithin, RECENT_CAMPAIGN_DAYS),
// so the two can't disagree. Schneider addresses are never counted.
//
// Pure, so scripts/recentSends.test.mjs checks it.

import { campaignSendDetailWithin } from './campaignFollowUp.js';
import { isCampaignActive } from './campaignOutreach.js';
import { isContactMarkedHold } from './campaignContactHold.js';
import { primarySubject } from './campaignSubjects.js';
import { contactDisplayName, applyCompanyOverride } from './contactRosters.js';
import { RECENT_CAMPAIGN_DAYS } from './recentCampaignWarning.js';

export const RECENT_SENDS_GROUPS = [
  { key: 'client', label: 'Clients', gate: 'isClient' },
  { key: 'key', label: 'Key Contacts', gate: 'isKey' },
  // Prospects are only the Decision Makers the other two groups don't
  // already hold: nobody on Key Contacts and nobody at a client.
  { key: 'prospect', label: 'Prospects', gate: 'isKeyProspect', unless: ['isKey', 'isClient'] },
];

// Is contact `c` in group `g`: its gate passes and none of its `unless` do.
const inGroup = (g, gates, c) => gates[g.gate](c)
  && !(g.unless || []).some(u => typeof gates[u] === 'function' && gates[u](c));

const norm = (s) => String(s || '').trim().toLowerCase();

/**
 * Campaigns each address is queued on but hasn't been sent yet: lowercased
 * email -> [{ index, label }]. A row is queued when it has no sentDate and
 * isn't on Hold off, on a campaign that is Active (not paused, not gone
 * quiet past the 60-day rule), so an abandoned old campaign doesn't sit on
 * somebody's count for ever. A grouped row ("a@x; b@x") queues each
 * address; one campaign counts once per address.
 */
export function pendingCampaignsByEmail(campaigns, nowMs = Date.now()) {
  const out = new Map();
  (Array.isArray(campaigns) ? campaigns : []).forEach((camp, index) => {
    if (!camp || !isCampaignActive(camp, nowMs)) return;
    const label = camp.title || primarySubject(camp) || '(untitled campaign)';
    for (const ct of Array.isArray(camp.contacts) ? camp.contacts : []) {
      if (!ct || ct.sentDate || isContactMarkedHold(ct)) continue;
      for (const part of String(ct.email || '').split(/[;,]/)) {
        const em = norm(part);
        if (!em) continue;
        if (!out.has(em)) out.set(em, []);
        const list = out.get(em);
        if (!list.some(x => x.index === index)) list.push({ index, label });
      }
    }
  });
  return out;
}

/** 1 campaign: green, 2: yellow, 3 or more: red (the Drafts warning's tones). */
export function sendTone(campaignCount) {
  if (campaignCount >= 3) return 'red';
  if (campaignCount === 2) return 'yellow';
  return 'green';
}

/**
 * {
 *   rows:   [{ email, name, company, contact, groups: [label], emails, pending,
 *              campaigns: [{ label, lastSentDate, count, pending }] }]
 *           for the people in the picked groups who were emailed in the
 *           window or are queued on a campaign not sent yet (pending: true,
 *           no lastSentDate; see pendingCampaignsByEmail), most campaigns
 *           first, then most emails, then name. A queued campaign counts
 *           toward the person's total and tone like a sent one: it is about
 *           to land on them.
 *   counts: { [groupKey]: { total, none, one, two, three } } per picked
 *           group, by how many campaigns reached each person.
 * }
 * `gates` is a makeRosterGates result; `groupKeys` the picked groups.
 * `localFields` (settings.contactLocalFields) supplies a Company typed in
 * the app, which wins over HubSpot's, as on every contacts page.
 */
export function recentSendsByGroup({
  contacts, gates, groupKeys, campaigns, days = RECENT_CAMPAIGN_DAYS, nowMs = Date.now(), localFields = null,
}) {
  const groups = RECENT_SENDS_GROUPS.filter(g => (groupKeys || []).includes(g.key) && typeof gates?.[g.gate] === 'function');
  const detail = campaignSendDetailWithin(Array.isArray(campaigns) ? campaigns : [], days, nowMs);
  const queued = pendingCampaignsByEmail(campaigns, nowMs);
  const counts = {};
  for (const g of groups) counts[g.key] = { total: 0, none: 0, one: 0, two: 0, three: 0 };
  const rows = [];
  const seen = new Set();
  for (const c of contacts || []) {
    const email = norm(c?.email);
    if (!email || seen.has(email) || email.endsWith('@se.com')) continue;
    const inGroups = groups.filter(g => inGroup(g, gates, c));
    if (!inGroups.length) continue;
    seen.add(email);
    const entry = detail.get(email);
    const sent = (entry?.campaigns || []).map(x => ({ index: x.index, label: x.label, lastSentDate: x.lastSentDate || '', count: x.count, pending: false }));
    // A campaign already sent to them in the window isn't also pending.
    const pending = (queued.get(email) || [])
      .filter(q => !sent.some(x => x.index === q.index))
      .map(q => ({ index: q.index, label: q.label, lastSentDate: '', count: 0, pending: true }));
    const list = [...sent, ...pending];
    const n = list.length;
    for (const g of inGroups) {
      const k = counts[g.key];
      k.total += 1;
      if (n === 0) k.none += 1;
      else if (n === 1) k.one += 1;
      else if (n === 2) k.two += 1;
      else k.three += 1;
    }
    if (!n) continue;
    rows.push({
      email: String(c.email).trim(),
      name: contactDisplayName(c),
      company: String(applyCompanyOverride(c, localFields)?.company || '').trim(),
      contact: c,
      groups: inGroups.map(g => g.label),
      emails: entry?.count || 0,
      pending: pending.length,
      campaigns: list.map(x => ({ label: x.label, lastSentDate: x.lastSentDate, count: x.count, pending: x.pending })),
    });
  }
  rows.sort((a, b) => b.campaigns.length - a.campaigns.length || b.emails - a.emails || a.name.localeCompare(b.name));
  return { rows, counts };
}

const DAY_MS = 86400000;

/**
 * When a person stops reading as 3+: a campaign counts while one of its
 * sends to them is inside the window, so it drops out `days` after its last
 * send, and they fall below three once their third-newest campaign does.
 * Epoch ms, or null for fewer than three campaigns. A campaign with no send
 * date on record, and a queued one not sent yet, is treated as sent today:
 * the soonest it could go out, so the earliest it could drop off is 3 weeks
 * from now.
 */
export function belowThreeAt(row, { days = RECENT_CAMPAIGN_DAYS, nowMs = Date.now() } = {}) {
  const sends = (row?.campaigns || [])
    .map(c => { const t = Date.parse(c?.lastSentDate || ''); return Number.isFinite(t) ? t : nowMs; })
    .sort((a, b) => b - a);
  if (sends.length < 3) return null;
  return sends[2] + days * DAY_MS;
}

/**
 * If no more campaigns go out, when do most of these people stop being at
 * 3+? Over `rows` (the people listed):
 *   { total, threePlus, majorityAt, allClearAt }
 * `majorityAt` is when more than half of them are below three (null when
 * they already are), `allClearAt` when nobody is at 3+ any more (null when
 * nobody is now). Both are the end of that day's window, epoch ms.
 */
export function threePlusClearDates(rows, { days = RECENT_CAMPAIGN_DAYS, nowMs = Date.now() } = {}) {
  const list = rows || [];
  const drops = list.map(r => belowThreeAt(r, { days, nowMs })).filter(t => t != null).sort((a, b) => a - b);
  const total = list.length;
  const under = total - drops.length;
  const majority = Math.floor(total / 2) + 1;
  const needed = majority - under;
  return {
    total,
    threePlus: drops.length,
    majorityAt: needed > 0 ? (drops[needed - 1] ?? null) : null,
    allClearAt: drops.length ? drops[drops.length - 1] : null,
  };
}

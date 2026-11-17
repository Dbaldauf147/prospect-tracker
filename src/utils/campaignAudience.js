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

// Planned dates: when the campaign is meant to go to each audience. Stored
// as `scheduledFor: { clients: 'YYYY-MM-DD', ... }` (set dates only), next
// to `sentTo`, so the plan and the tick that says it happened sit together.
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** { clients, keyContacts, prospects } as 'YYYY-MM-DD' or ''. */
export function campaignSchedule(c) {
  const s = c?.scheduledFor && typeof c.scheduledFor === 'object' ? c.scheduledFor : {};
  return Object.fromEntries(CAMPAIGN_AUDIENCES.map(a => [a.key, ISO_DAY.test(String(s[a.key] || '')) ? s[a.key] : '']));
}

/** The campaign with one audience's date set, or cleared with ''. */
export function withSchedule(c, key, day) {
  const next = { ...(c?.scheduledFor && typeof c.scheduledFor === 'object' ? c.scheduledFor : {}) };
  if (ISO_DAY.test(String(day || ''))) next[key] = day; else delete next[key];
  const out = { ...c };
  if (Object.keys(next).length) out.scheduledFor = next; else delete out.scheduledFor;
  return out;
}

/** The stored list with `target`'s date for `key` changed (see listWithAudience). */
export function listWithSchedule(campaigns, target, key, day) {
  const id = campaignIdentity(target);
  const i = (campaigns || []).findIndex(c => campaignIdentity(c) === id);
  if (i < 0) throw new Error('That campaign is no longer in the saved list. Reload and try again.');
  return campaigns.map((c, j) => (j === i ? withSchedule(c, key, day) : c));
}

/**
 * Where a planned date stands against today ('YYYY-MM-DD', local):
 * 'overdue', 'today', 'soon' (within 7 days) or 'later'; '' with no date.
 */
export function scheduleState(day, today) {
  if (!day) return '';
  if (day < today) return 'overdue';
  if (day === today) return 'today';
  const ms = Date.parse(`${day}T00:00:00`) - Date.parse(`${today}T00:00:00`);
  return ms <= 7 * 86400000 ? 'soon' : 'later';
}

/**
 * How a saved campaign's row is coloured on Saved Campaigns:
 *   'complete' (green)  every audience is ticked Sent To;
 *   'waiting'  (yellow) paused, or every audience is either ticked or has
 *                       a date still to come (today or later);
 *   ''                  anything else: some audience has neither, or only
 *                       an overdue date.
 * `paused` is passed in (utils/campaignOutreach isCampaignPaused) so this
 * file stays free of the status rules.
 */
export function campaignRowTone(c, today, paused = false) {
  const sent = campaignAudience(c);
  if (CAMPAIGN_AUDIENCES.every(a => sent[a.key])) return 'complete';
  if (paused) return 'waiting';
  const dates = campaignSchedule(c);
  if (CAMPAIGN_AUDIENCES.every(a => sent[a.key] || (dates[a.key] && dates[a.key] >= today))) return 'waiting';
  return '';
}

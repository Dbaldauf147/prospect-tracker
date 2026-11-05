// The Draft Emails warning: recipients who were sent a campaign email in
// the last three weeks, so a new campaign doesn't land on someone who just
// heard from another one.
//
// Built on campaignSendDetailWithin (the Key Contacts "Campaigns 60d"
// column's source), so a send counts here exactly when it counts there.
// A campaign carrying the draft's own subject is this campaign (a
// follow-up), not "another" one, so it is left out. Schneider addresses
// (test sends to yourself) are never warned about.
// Pure, so scripts/recentCampaignWarning.test.mjs checks it.

import { campaignSendDetailWithin } from './campaignFollowUp.js';
import { campaignSubjects } from './campaignSubjects.js';

export const RECENT_CAMPAIGN_DAYS = 21;

const norm = (s) => String(s || '').trim().toLowerCase();

/**
 * [{ email, name, campaigns: [{ label, lastSentDate }] }] for each recipient
 * with another campaign's email inside the window, in recipient order.
 */
export function recentCampaignWarnings(campaigns, recipients, {
  days = RECENT_CAMPAIGN_DAYS, currentSubject = '', nowMs = Date.now(),
} = {}) {
  const subject = norm(currentSubject);
  const list = Array.isArray(campaigns) ? campaigns : [];
  const isCurrent = (index) => !!subject && campaignSubjects(list[index]).some(s => norm(s) === subject);
  const detail = campaignSendDetailWithin(list, days, nowMs);
  const out = [];
  const seen = new Set();
  for (const r of recipients || []) {
    const email = norm(r?.email);
    if (!email || seen.has(email) || email.endsWith('@se.com')) continue;
    seen.add(email);
    const hits = (detail.get(email)?.campaigns || []).filter(c => !isCurrent(c.index));
    if (!hits.length) continue;
    out.push({
      email: String(r.email).trim(),
      name: String(r?.name || '').trim(),
      campaigns: hits.map(c => ({ label: c.label, lastSentDate: c.lastSentDate || '' })),
    });
  }
  return out;
}

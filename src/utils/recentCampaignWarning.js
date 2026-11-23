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

/**
 * Map of lowercased email -> latest sentDate for the recipients this draft's
 * own campaign (the one carrying `currentSubject`) has already emailed. The
 * Draft Emails To pills turn green from it, so a contact you've already sent
 * this email to stands out before you send it again. Group sends ("a@x; b@x")
 * count for every address in them.
 */
export function sentThisCampaign(campaigns, currentSubject) {
  const subject = norm(currentSubject);
  const out = new Map();
  if (!subject) return out;
  for (const c of Array.isArray(campaigns) ? campaigns : []) {
    if (!campaignSubjects(c).some(s => norm(s) === subject)) continue;
    for (const row of Array.isArray(c?.contacts) ? c.contacts : []) {
      const sent = String(row?.sentDate || '').trim();
      if (!sent) continue;
      for (const part of String(row?.email || '').split(/[;,]/)) {
        const email = norm(part);
        if (!email) continue;
        const prev = out.get(email);
        if (!prev || Date.parse(sent) > Date.parse(prev)) out.set(email, sent);
      }
    }
  }
  return out;
}

// ---- Sent, per the activity feed -------------------------------------------
//
// sentThisCampaign reads the saved campaign's rows, and a row only gets its
// sentDate when the campaign is refreshed on the Email Campaigns tab. So a
// send that the Activity tab already listed left the To pill white until
// somebody went and refreshed the campaign. The feed the Activity tab keeps
// (the `hubspot-activity-cache`) has the same send, so the pills read it too.

// The draft's subject as a test of a sent subject. A `{variable}` in the
// draft stands for whatever the send filled in, so the fixed text either
// side of it has to appear, in order. A subject that is nothing but
// variables matches nothing.
function subjectTest(draftSubject) {
  const parts = String(draftSubject || '').split(/\{[^{}]*\}/).map(norm).filter(Boolean);
  if (!parts.length || parts.join('').length < 3) return null;
  return (sentSubject) => {
    const sent = norm(sentSubject);
    let from = 0;
    for (const p of parts) {
      const at = sent.indexOf(p, from);
      if (at < 0) return false;
      from = at + p.length;
    }
    return true;
  };
}

// An email the user sent, by the Activity tab's own rule: from an @se.com
// address or the configured work email, or, with no sender on the record
// (HubSpot leaves it blank on some sends), anything not logged as incoming.
function isOutbound(e, workEmail) {
  const from = norm(e?.hs_email_from_email);
  if (from) return from.includes('@se.com') || (!!workEmail && from === workEmail);
  return String(e?.hs_email_direction || '').toUpperCase() !== 'INCOMING_EMAIL';
}

/**
 * Map of lowercased email -> latest send (ISO string) for outbound emails in
 * the activity feed whose subject matches this draft's.
 *
 *   feed       the Activity tab's cache ({ emails: [...] })
 *   subject    the draft's subject line
 *   workEmail  settings.workEmail
 */
export function sentPerActivity(feed, subject, workEmail = '') {
  const out = new Map();
  const matches = subjectTest(subject);
  if (!matches) return out;
  const me = norm(workEmail);
  for (const e of Array.isArray(feed?.emails) ? feed.emails : []) {
    if (!matches(e?.hs_email_subject) || !isOutbound(e, me)) continue;
    const t = new Date(e?.hs_timestamp).getTime();
    if (!Number.isFinite(t)) continue;
    for (const part of String(e?.hs_email_to_email || '').split(/[;,]/)) {
      const email = norm(part);
      if (!email || email.endsWith('@se.com')) continue;
      const prev = out.get(email);
      if (!prev || t > Date.parse(prev)) out.set(email, new Date(t).toISOString());
    }
  }
  return out;
}

/** Two sent maps as one, the later send winning for an address on both. */
export function mergeSent(a, b) {
  const out = new Map(a);
  for (const [email, sent] of b) {
    const prev = out.get(email);
    if (!prev || Date.parse(sent) > Date.parse(prev) || Number.isNaN(Date.parse(prev))) out.set(email, sent);
  }
  return out;
}

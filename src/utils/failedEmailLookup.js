// Which addresses have failed, by email, for pages that only need to mark
// a recipient red (Draft Emails' To line and Variable Coverage).
//
// Built on the Failed Emails tab's own rows (failedCampaignEmails), so an
// address is red here exactly when that tab still lists it as a bad email:
// a bounce the campaign lookup caught, or a forwarded failure notice that
// has not been marked fixed.
import { failedCampaignEmailRows, FAILED_STATE } from './failedCampaignEmails.js';

/**
 * Map of lowercased email -> { failedAt, reason, campaign, source } for every
 * address still flagged bad. Where an address failed more than once, the
 * newest failure is kept (the rows come newest first).
 */
export function failedEmailMap(campaigns, badEmailMap) {
  const out = new Map();
  for (const r of failedCampaignEmailRows(campaigns, badEmailMap)) {
    if (r.state !== FAILED_STATE.BAD || out.has(r.email)) continue;
    out.set(r.email, { failedAt: r.failedAt, reason: r.reason, campaign: r.campaign, source: r.source });
  }
  return out;
}

/** The hover text for a failed address. */
export function failedEmailTitle(info) {
  if (!info) return '';
  const ms = Date.parse(info.failedAt);
  const when = Number.isFinite(ms) ? ` on ${new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : '';
  const where = info.campaign ? ` (${info.campaign})` : '';
  const why = info.reason ? ` Reason: ${String(info.reason).replace(/\.+$/, '')}.` : '';
  return `Email to this address failed${when}${where}.${why} See Email Campaigns, Failed Emails.`;
}

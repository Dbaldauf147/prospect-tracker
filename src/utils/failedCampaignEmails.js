// The Failed Emails sub-tab of Email Campaigns: every campaign contact whose
// email didn't arrive, one row per address per campaign.
//
// Two sources, the same two the campaign table reads for its Delivery
// "Failed" cell:
//   - "Forwarded notice": the address is in settings.badEmails because Dan
//     forwarded its delivery-failure notice to the app mailbox's +bounces
//     alias (utils/badEmails.js, api/bounce-inbox.js). Kept here after Mark
//     fixed too, so the tab is a record of what failed, with the row reading
//     Fixed rather than vanishing.
//   - "Campaign match": the campaign's own lookup caught a bounce on the
//     send (contact.bounced / bounceDate).
// A row can carry both; the forwarded notice's reason and date lead, since
// that is the one with the server's own words in it.
import { normEmail } from './badEmails';
import { primarySubject } from './campaignSubjects';

export const FAILED_SOURCE = { NOTICE: 'Forwarded notice', CAMPAIGN: 'Campaign match', BOTH: 'Notice + campaign' };
export const FAILED_STATE = { BAD: 'Bad email', FIXED: 'Marked fixed' };

function splitEmails(raw) {
  return String(raw || '').split(';').map(x => x.trim()).filter(Boolean);
}

/** A badEmails entry as it stands, with whether Mark fixed has cleared it. */
function noticeFor(map, email) {
  const e = map && typeof map === 'object' ? map[normEmail(email)] : null;
  if (!e || !e.at) return null;
  const fixed = !!(e.clearedAt && Date.parse(e.clearedAt) >= Date.parse(e.at));
  return { ...e, fixed };
}

/**
 * Rows for the Failed Emails table.
 *
 * @param campaigns   saved campaigns ({ title, subjects, contacts })
 * @param badEmailMap settings.badEmails
 * @returns [{ id, email, name, company, campaignIndex, campaign, sentDate,
 *            failedAt, source, state, reason, noticeSubject, replied }]
 *          newest failure first
 */
export function failedCampaignEmailRows(campaigns, badEmailMap) {
  const rows = [];
  (campaigns || []).forEach((camp, campaignIndex) => {
    const campaign = String(camp?.title || primarySubject(camp) || '(untitled)');
    const seen = new Set();
    for (const c of camp?.contacts || []) {
      const emails = splitEmails(c?.email);
      // A group send (several addresses on one row) names each address that
      // failed on its own row; a campaign-caught bounce on such a row can't
      // say which address it was, so it lands on the row's first address
      // unless a forwarded notice names one.
      const noticed = emails.map(e => ({ e, n: noticeFor(badEmailMap, e) })).filter(x => x.n);
      const targets = noticed.length
        ? noticed
        : (c?.bounced && emails.length ? [{ e: emails[0], n: null }] : []);
      for (const { e, n } of targets) {
        const key = normEmail(e);
        if (seen.has(key)) continue;
        seen.add(key);
        const campaignHit = !!c?.bounced;
        const source = n && campaignHit ? FAILED_SOURCE.BOTH : n ? FAILED_SOURCE.NOTICE : FAILED_SOURCE.CAMPAIGN;
        rows.push({
          id: `${campaignIndex}|${key}`,
          email: key,
          name: emails.length === 1 ? String(c?.name || '').trim() : '',
          company: String(c?.company || '').trim(),
          campaignIndex,
          campaign,
          sentDate: c?.sentDate || '',
          failedAt: n?.at || c?.bounceDate || '',
          source,
          // Only a forwarded notice can be marked fixed; a campaign-caught
          // bounce stands until the roster is refreshed without it.
          state: n?.fixed && !campaignHit ? FAILED_STATE.FIXED : FAILED_STATE.BAD,
          reason: n?.reason || '',
          noticeSubject: n?.subject || '',
          replied: !!c?.replied,
        });
      }
    }
  });
  const t = (iso) => { const v = Date.parse(iso); return Number.isFinite(v) ? v : 0; };
  return rows.sort((a, b) => t(b.failedAt) - t(a.failedAt) || a.email.localeCompare(b.email));
}

/** Distinct addresses still flagged as bad across the rows (the tab's badge). */
export function failedEmailCount(rows) {
  return new Set((rows || []).filter(r => r.state === FAILED_STATE.BAD).map(r => r.email)).size;
}

/**
 * Search HubSpot emails by subject line and calculate campaign metrics.
 * Groups multi-recipient emails as single sends.
 * POST /api/email-campaign
 * Body: { subject: "Your subject line" }
 */

import { withAuth } from './_lib/http.js';
import { enforceRateLimit } from './_lib/rateLimit.js';
import { classifyAutoReply, attributeBounce } from './_lib/autoReply.js';

const BASE = 'https://api.hubapi.com';

// Email properties we read for every send/reply. Shared by both fetch paths.
const EMAIL_PROPERTIES = 'hs_email_subject,hs_email_status,hs_email_direction,hs_timestamp,hs_email_to_email,hs_email_cc_email,hs_email_from_email,hs_email_to_firstname,hs_email_to_lastname,hs_email_from_firstname,hs_email_from_lastname';

// Safety cap shared by both fetch paths — mirrors the previous behavior.
const MAX_EMAILS = 10000;

// HubSpot caps requests per second per portal (the SECONDLY policy; the
// search API is the tightest of them). Paging a campaign fires those
// requests back to back, and a portal that's also being used elsewhere —
// another refresh, a sync, the Activity views — pushes it over. The limit
// clears in under a second, so a 429 is a "wait a moment", not a failure:
// pace the pages, and retry the ones that come back rate-limited instead
// of abandoning the refresh mid-page.
const RETRYABLE = new Set([429, 502, 503, 504]);
const MAX_ATTEMPTS = 5;
const PAGE_PACING_MS = 250;   // ~4 req/s, HubSpot's search allowance
const MAX_BACKOFF_MS = 8000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// What the user should be told when HubSpot refuses. Raw HubSpot JSON in a
// UI banner reads as a crash; a rate limit is worth naming as the transient
// thing it is.
function describeFailure(status, body) {
  if (status === 429) {
    return 'HubSpot is rate-limiting this portal right now. Wait a few seconds and refresh again.';
  }
  if (status === 401 || status === 403) {
    return `HubSpot rejected the request (${status}): check the access token's scopes.`;
  }
  return `HubSpot ${status}: ${String(body || '').slice(0, 200)}`;
}

// One HubSpot call, retried through the transient statuses with exponential
// backoff. Honours Retry-After when HubSpot sends one (it's in seconds).
async function hubspotFetch(url, init) {
  let backoff = 500;
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, init);
    if (response.ok) return response;

    const body = await response.text().catch(() => '');
    if (!RETRYABLE.has(response.status) || attempt >= MAX_ATTEMPTS) {
      throw new Error(describeFailure(response.status, body));
    }
    const retryAfter = Number(response.headers.get('retry-after'));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, MAX_BACKOFF_MS)
      : backoff;
    await sleep(wait);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  }
}

// The single most distinctive word in the subject, used to pre-filter emails
// server-side with the CRM search API instead of listing the whole mailbox.
// The longest alphanumeric token (>= 3 chars) is the most selective, and any
// email whose subject contains the full campaign subject necessarily contains
// this whole word — so CONTAINS_TOKEN on it returns a superset of the exact
// substring match, which is then re-applied in memory. Returns '' when the
// subject has no such token (e.g. very short), in which case the caller lists
// all emails as before.
function distinctiveSubjectToken(subjectLower) {
  const tokens = subjectLower.replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(Boolean);
  let best = '';
  for (const t of tokens) if (t.length > best.length) best = t;
  return best.length >= 3 ? best : '';
}

// Page through emails whose subject contains a token, via the CRM search API.
// Far cheaper than scanning the whole emails object on a large portal.
async function searchEmailsBySubjectToken(token, searchToken) {
  const collected = [];
  let after;
  while (true) {
    const body = {
      filterGroups: [{ filters: [{ propertyName: 'hs_email_subject', operator: 'CONTAINS_TOKEN', value: searchToken }] }],
      properties: EMAIL_PROPERTIES.split(','),
      sorts: [{ propertyName: 'hs_timestamp', direction: 'DESCENDING' }],
      limit: 100,
    };
    if (after) { body.after = after; await sleep(PAGE_PACING_MS); }
    const response = await hubspotFetch(`${BASE}/crm/v3/objects/emails/search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    collected.push(...(data.results || []).map(e => ({ id: e.id, ...e.properties })));
    if (data.paging?.next?.after && collected.length < MAX_EMAILS) { after = data.paging.next.after; } else break;
  }
  return collected;
}

// Page through the entire emails object. Fallback for subjects with no
// distinctive token (the old behavior, kept for correctness on edge cases).
async function listAllEmails(token) {
  const collected = [];
  let after;
  while (true) {
    const params = new URLSearchParams({ limit: '100', properties: EMAIL_PROPERTIES, sort: '-hs_timestamp' });
    if (after) { params.set('after', after); await sleep(PAGE_PACING_MS); }
    const response = await hubspotFetch(`${BASE}/crm/v3/objects/emails?${params}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const data = await response.json();
    collected.push(...(data.results || []).map(e => ({ id: e.id, ...e.properties })));
    if (data.paging?.next?.after && collected.length < MAX_EMAILS) { after = data.paging.next.after; } else break;
  }
  return collected;
}

// Candidate emails whose subject may match the campaign subject. Narrow
// server-side when we have a distinctive token; otherwise list everything.
async function fetchCandidateEmails(token, subjectLower) {
  const searchToken = distinctiveSubjectToken(subjectLower);
  return searchToken
    ? searchEmailsBySubjectToken(token, searchToken)
    : listAllEmails(token);
}

async function handler(req, res, auth) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await enforceRateLimit(res, auth.uid, 'email-campaign', 30, 5 * 60 * 1000))) return;

  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ error: 'HubSpot token not configured' });

  const { subject } = req.body;
  if (!subject) return res.status(400).json({ error: 'subject is required' });

  const subjectLower = subject.toLowerCase().trim();

  try {
    // Pull candidate emails — narrowed server-side by a distinctive subject
    // token so we no longer scan the whole mailbox (which timed out on large
    // portals). The exact case-insensitive substring match below is unchanged,
    // so the result set is identical to the old list-everything approach.
    const allEmails = await fetchCandidateEmails(token, subjectLower);

    // Filter emails matching the subject
    const matching = allEmails.filter(e => (e.hs_email_subject || '').toLowerCase().includes(subjectLower));

    // Separate sent vs replies
    const sentEmails = matching.filter(e => e.hs_email_direction === 'EMAIL' || e.hs_email_direction === 'FORWARDED_EMAIL');
    const replyEmails = matching.filter(e => e.hs_email_direction === 'INCOMING_EMAIL');

    // Machine-generated incoming mail is classified rather than merely
    // detected — see api/_lib/autoReply.js. A bounce is an address to fix and
    // an out-of-office is a date to try again on; both used to vanish into one
    // suppressed counter. The set of mail suppressed from the reply count is
    // unchanged, so no campaign's response rate moves.

    // Group sent emails — deduplicate by recipient(s)
    // If the same person is emailed multiple times, keep only the most recent.
    // Recipients include both the To and CC addresses, so a contact who was
    // CC'd on the send is tracked as "sent" just like a To recipient.
    // HubSpot separates addresses in the To/CC fields with either a
    // semicolon or a comma (and may wrap them as "Name <email>"), so split
    // on both and pull the bare address out of any angle brackets — same
    // parsing the Activity views use. Without this, a comma-separated CC
    // list collapses into one token and a CC'd contact never matches.
    const splitAddrs = (raw) => (raw || '')
      .toLowerCase()
      .split(/[;,]/)
      .map(a => {
        const m = a.match(/<([^>]+)>/);
        return (m ? m[1] : a).trim();
      })
      .filter(Boolean);
    const sendsByRecipients = {};
    for (const e of sentEmails) {
      const recipients = [...new Set([
        ...splitAddrs(e.hs_email_to_email),
        ...splitAddrs(e.hs_email_cc_email),
      ])];
      if (recipients.length === 0) continue;
      const key = recipients.sort().join(',');
      // Keep most recent send per unique recipient set
      if (!sendsByRecipients[key] || (e.hs_timestamp && e.hs_timestamp > sendsByRecipients[key].timestamp)) {
        sendsByRecipients[key] = {
          id: e.id,
          timestamp: e.hs_timestamp,
          recipients,
          recipientNames: [e.hs_email_to_firstname, e.hs_email_to_lastname].filter(Boolean).join(' ') || recipients[0] || '-',
          replied: false,
          replyDate: null,
          repliedBy: null,
          bounced: false,
          bounceDate: null,
          outOfOffice: false,
          oooDate: null,
          oooSubject: '',
        };
      }
    }
    const sends = Object.values(sendsByRecipients);

    // Check which sends got a reply (any recipient replying counts).
    // Out-of-office / auto-reply / bounce notifications are excluded
    // from the response count but tallied separately so the UI can show
    // them as a footnote.
    const allRecipientEmails = new Set();
    for (const s of sends) s.recipients.forEach(r => allRecipientEmails.add(r));

    let autoReplyCount = 0;
    const suppressed = { bounce: 0, ooo: 0, other: 0, unattributed: 0 };
    for (const reply of replyEmails) {
      const from = (reply.hs_email_from_email || '').toLowerCase().trim();
      const kind = classifyAutoReply(reply);
      if (kind) {
        autoReplyCount++;
        suppressed[kind === 'auto' ? 'other' : kind] += 1;
        // An out-of-office comes from the recipient's own auto-responder, so
        // it matches a send by address exactly. A bounce comes from a system
        // mailbox and can only be matched by domain, and only when that domain
        // names one send — see attributeBounce.
        if (kind === 'ooo' && from) {
          const hit = sends.find(s => s.recipients.includes(from));
          if (hit) {
            // Keep the LATEST auto-response: an OOO refreshed on the way back
            // carries the more useful return date.
            if (!hit.oooDate || (reply.hs_timestamp && reply.hs_timestamp > hit.oooDate)) {
              hit.outOfOffice = true;
              hit.oooDate = reply.hs_timestamp;
              hit.oooSubject = reply.hs_email_subject || '';
            }
          } else {
            suppressed.unattributed += 1;
          }
        } else if (kind === 'bounce') {
          const i = attributeBounce(from, sends);
          if (i >= 0) {
            sends[i].bounced = true;
            sends[i].bounceDate = sends[i].bounceDate || reply.hs_timestamp;
          } else {
            suppressed.unattributed += 1;
          }
        }
        continue;
      }
      if (!from) continue;
      // Find the send this reply belongs to
      for (const s of sends) {
        if (s.recipients.includes(from) && !s.replied) {
          s.replied = true;
          s.replyDate = reply.hs_timestamp;
          s.repliedBy = [reply.hs_email_from_firstname, reply.hs_email_from_lastname].filter(Boolean).join(' ') || from;
          break;
        }
      }
    }

    const totalSends = sends.length;
    const totalReplied = sends.filter(s => s.replied).length;
    const responseRate = totalSends > 0 ? ((totalReplied / totalSends) * 100).toFixed(1) : '0.0';

    // Build contact-level detail for the table
    const contacts = sends.map(s => ({
      email: s.recipients.join('; '),
      name: s.recipientNames,
      sentDate: s.timestamp,
      replied: s.replied,
      replyDate: s.replyDate,
      repliedBy: s.repliedBy,
      // A delivery failure for this address, and the recipient's own
      // auto-responder. Both are non-answers, and neither is a "no": a bounce
      // means nobody ever saw it, an OOO means not yet.
      bounced: !!s.bounced,
      bounceDate: s.bounceDate || null,
      outOfOffice: !!s.outOfOffice,
      oooDate: s.oooDate || null,
      oooSubject: s.oooSubject || '',
      recipientCount: s.recipients.length,
    })).sort((a, b) => {
      if (a.replied !== b.replied) return a.replied ? -1 : 1;
      return (a.sentDate || '').localeCompare(b.sentDate || '');
    });

    return res.json({
      subject,
      totalEmails: matching.length,
      sent: totalSends,
      replies: totalReplied,
      // Kept as the total across all three kinds — saved campaigns store it
      // and the badge that reads it predates the breakdown.
      autoRepliesSuppressed: autoReplyCount,
      suppressed,
      bounced: sends.filter(s => s.bounced).length,
      outOfOffice: sends.filter(s => s.outOfOffice).length,
      uniqueRecipients: totalSends,
      uniqueRepliers: totalReplied,
      responseRate: parseFloat(responseRate),
      contacts,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export default withAuth(handler);

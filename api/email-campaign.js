/**
 * Search HubSpot emails by subject line and calculate campaign metrics.
 * Groups multi-recipient emails as single sends.
 * POST /api/email-campaign
 * Body: { subject: "Your subject line" }
 */

import { withAuth } from './_lib/http.js';
import { enforceRateLimit } from './_lib/rateLimit.js';

const BASE = 'https://api.hubapi.com';

// Email properties we read for every send/reply. Shared by both fetch paths.
const EMAIL_PROPERTIES = 'hs_email_subject,hs_email_status,hs_email_direction,hs_timestamp,hs_email_to_email,hs_email_cc_email,hs_email_from_email,hs_email_to_firstname,hs_email_to_lastname,hs_email_from_firstname,hs_email_from_lastname';

// Safety cap shared by both fetch paths — mirrors the previous behavior.
const MAX_EMAILS = 10000;

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
    if (after) body.after = after;
    const response = await fetch(`${BASE}/crm/v3/objects/emails/search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HubSpot search ${response.status}: ${text.slice(0, 200)}`);
    }
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
    if (after) params.set('after', after);
    const response = await fetch(`${BASE}/crm/v3/objects/emails?${params}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HubSpot API ${response.status}: ${text.slice(0, 200)}`);
    }
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

    // Auto-reply detection. HubSpot doesn't surface RFC 'Auto-Submitted'
    // headers, so we lean on the two signals available on the email
    // object: the subject line (where every major mail server stamps an
    // OOO / vacation / auto-reply prefix) and the from address (where
    // bounce / delivery notifications come from system mailboxes).
    const AUTO_REPLY_SUBJECT_PATTERNS = [
      /^\s*(?:re:\s*)?automatic reply\b/i,
      /^\s*(?:re:\s*)?auto[\s-]?reply\b/i,
      /^\s*(?:re:\s*)?auto[\s-]?response\b/i,
      /^\s*(?:re:\s*)?out of (?:the )?office\b/i,
      /^\s*(?:re:\s*)?ooo\b/i,
      /^\s*(?:re:\s*)?(?:i am |i'm )?away from (?:the )?office\b/i,
      /^\s*(?:re:\s*)?(?:i am |i'm )?on (?:vacation|leave|holiday|pto|parental leave|maternity leave|paternity leave|sabbatical)\b/i,
      /^\s*(?:re:\s*)?vacation (?:reply|notification|message)\b/i,
      /^\s*undeliverable:?\b/i,
      /^\s*delivery (?:status notification|failure|notification|has failed)/i,
      /^\s*returned mail\b/i,
      /^\s*mail delivery (?:failed|subsystem|failure)/i,
      /^\s*postmaster\b/i,
      /\b(automatic|auto)[\s-]?reply\b/i,
      /\bbounce notification\b/i,
    ];
    const AUTO_REPLY_FROM_PATTERNS = [
      /^postmaster@/i,
      /^mailer-daemon@/i,
      /^no-?reply@/i,
      /^do-?not-?reply@/i,
      /^bounce[s]?@/i,
    ];
    function isAutoReply(e) {
      const subject = e.hs_email_subject || '';
      for (const re of AUTO_REPLY_SUBJECT_PATTERNS) if (re.test(subject)) return true;
      const from = e.hs_email_from_email || '';
      for (const re of AUTO_REPLY_FROM_PATTERNS) if (re.test(from)) return true;
      return false;
    }

    // Group sent emails — deduplicate by recipient(s)
    // If the same person is emailed multiple times, keep only the most recent.
    // Recipients include both the To and CC addresses, so a contact who was
    // CC'd on the send is tracked as "sent" just like a To recipient.
    const splitAddrs = (raw) => (raw || '')
      .toLowerCase().trim()
      .split(';').map(a => a.trim()).filter(Boolean);
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
          recipientNames: [e.hs_email_to_firstname, e.hs_email_to_lastname].filter(Boolean).join(' ') || recipients[0] || '—',
          replied: false,
          replyDate: null,
          repliedBy: null,
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
    for (const reply of replyEmails) {
      if (isAutoReply(reply)) { autoReplyCount++; continue; }
      const from = (reply.hs_email_from_email || '').toLowerCase().trim();
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
      autoRepliesSuppressed: autoReplyCount,
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

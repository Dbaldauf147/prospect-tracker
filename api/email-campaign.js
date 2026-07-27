/**
 * Search HubSpot emails by subject line and calculate campaign metrics.
 * Groups multi-recipient emails as single sends.
 * POST /api/email-campaign
 * Body: { subject: "Your subject line" }
 */

import { withAuth } from './_lib/http.js';
import { enforceRateLimit } from './_lib/rateLimit.js';

const BASE = 'https://api.hubapi.com';

async function handler(req, res, auth) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await enforceRateLimit(res, auth.uid, 'email-campaign', 30, 5 * 60 * 1000))) return;

  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ error: 'HubSpot token not configured' });

  const { subject } = req.body;
  if (!subject) return res.status(400).json({ error: 'subject is required' });

  const subjectLower = subject.toLowerCase().trim();

  try {
    // Fetch all emails — paginate through
    let allEmails = [];
    let after;
    const properties = 'hs_email_subject,hs_email_status,hs_email_direction,hs_timestamp,hs_email_to_email,hs_email_cc_email,hs_email_from_email,hs_email_to_firstname,hs_email_to_lastname,hs_email_from_firstname,hs_email_from_lastname';

    while (true) {
      const params = new URLSearchParams({ limit: '100', properties, sort: '-hs_timestamp' });
      if (after) params.set('after', after);

      const response = await fetch(`${BASE}/crm/v3/objects/emails?${params}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HubSpot API ${response.status}: ${text.slice(0, 200)}`);
      }

      const data = await response.json();
      allEmails.push(...(data.results || []).map(e => ({ id: e.id, ...e.properties })));
      if (data.paging?.next?.after) { after = data.paging.next.after; } else break;
      if (allEmails.length > 10000) break;
    }

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
    // HubSpot separates addresses in the To/CC fields with either a
    // semicolon or a comma (and may wrap them as "Name <email>"), so split
    // on both and pull the bare address out of any angle brackets — same
    // parsing the Activity views use.
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

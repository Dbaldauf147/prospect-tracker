/**
 * Search HubSpot emails by subject line and calculate campaign metrics.
 * POST /api/email-campaign
 * Body: { subject: "Your subject line" }
 */

const BASE = 'https://api.hubapi.com';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ error: 'HubSpot token not configured' });

  const { subject } = req.body;
  if (!subject) return res.status(400).json({ error: 'subject is required' });

  const subjectLower = subject.toLowerCase().trim();

  try {
    // Fetch all emails — paginate through
    let allEmails = [];
    let after;
    const properties = 'hs_email_subject,hs_email_status,hs_email_direction,hs_timestamp,hs_email_to_email,hs_email_from_email,hs_email_to_firstname,hs_email_to_lastname,hs_email_from_firstname,hs_email_from_lastname';

    while (true) {
      const params = new URLSearchParams({
        limit: '100',
        properties,
        sort: '-hs_timestamp',
      });
      if (after) params.set('after', after);

      const response = await fetch(`${BASE}/crm/v3/objects/emails?${params}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HubSpot API ${response.status}: ${text.slice(0, 200)}`);
      }

      const data = await response.json();
      const emails = (data.results || []).map(e => ({ id: e.id, ...e.properties }));
      allEmails.push(...emails);

      if (data.paging?.next?.after) {
        after = data.paging.next.after;
      } else break;

      // Safety limit
      if (allEmails.length > 10000) break;
    }

    // Filter emails matching the subject
    const matching = allEmails.filter(e => {
      const s = (e.hs_email_subject || '').toLowerCase();
      return s.includes(subjectLower);
    });

    // Separate sent (outbound) vs received (inbound/replies)
    const sent = matching.filter(e => e.hs_email_direction === 'EMAIL' || e.hs_email_direction === 'FORWARDED_EMAIL');
    const replies = matching.filter(e => e.hs_email_direction === 'INCOMING_EMAIL');

    // Unique recipients from sent emails
    const recipients = new Set();
    for (const e of sent) {
      const to = (e.hs_email_to_email || '').toLowerCase().trim();
      if (to) to.split(';').forEach(addr => recipients.add(addr.trim()));
    }

    // Unique repliers
    const repliers = new Set();
    for (const e of replies) {
      const from = (e.hs_email_from_email || '').toLowerCase().trim();
      if (from) repliers.add(from);
    }

    // Build contact-level detail
    const contactMap = {};
    for (const e of sent) {
      const to = (e.hs_email_to_email || '').toLowerCase().trim();
      const toAddrs = to ? to.split(';').map(a => a.trim()) : [];
      for (const addr of toAddrs) {
        if (!contactMap[addr]) {
          contactMap[addr] = {
            email: addr,
            name: [e.hs_email_to_firstname, e.hs_email_to_lastname].filter(Boolean).join(' ') || addr,
            sentDate: e.hs_timestamp,
            replied: false,
            replyDate: null,
          };
        }
      }
    }
    for (const e of replies) {
      const from = (e.hs_email_from_email || '').toLowerCase().trim();
      if (contactMap[from]) {
        contactMap[from].replied = true;
        contactMap[from].replyDate = e.hs_timestamp;
      }
    }

    const contacts = Object.values(contactMap).sort((a, b) => {
      if (a.replied !== b.replied) return a.replied ? -1 : 1;
      return (a.sentDate || '').localeCompare(b.sentDate || '');
    });

    const responseRate = recipients.size > 0 ? ((repliers.size / recipients.size) * 100).toFixed(1) : '0.0';

    return res.json({
      subject,
      totalEmails: matching.length,
      sent: sent.length,
      replies: replies.length,
      uniqueRecipients: recipients.size,
      uniqueRepliers: repliers.size,
      responseRate: parseFloat(responseRate),
      contacts,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * Search HubSpot emails by subject line and calculate campaign metrics.
 * Groups multi-recipient emails as single sends.
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

    // Group sent emails — deduplicate by recipient(s)
    // If the same person is emailed multiple times, keep only the most recent
    const sendsByRecipients = {};
    for (const e of sentEmails) {
      const toRaw = (e.hs_email_to_email || '').toLowerCase().trim();
      const recipients = toRaw ? toRaw.split(';').map(a => a.trim()).filter(Boolean) : [];
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

    // Check which sends got a reply (any recipient replying counts)
    const allRecipientEmails = new Set();
    for (const s of sends) s.recipients.forEach(r => allRecipientEmails.add(r));

    for (const reply of replyEmails) {
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
      uniqueRecipients: totalSends,
      uniqueRepliers: totalReplied,
      responseRate: parseFloat(responseRate),
      contacts,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

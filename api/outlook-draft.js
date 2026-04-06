// Creates draft emails in the user's Outlook via Microsoft Graph API
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { accessToken, drafts } = req.body;
  if (!accessToken || !drafts || !Array.isArray(drafts)) {
    return res.status(400).json({ error: 'Missing accessToken or drafts array' });
  }

  const results = [];
  for (const draft of drafts) {
    try {
      const response = await fetch('https://graph.microsoft.com/v1.0/me/messages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subject: draft.subject,
          body: {
            contentType: 'HTML',
            content: draft.body,
          },
          toRecipients: (draft.to || '').split(';').filter(Boolean).map((addr, i) => ({
            emailAddress: {
              address: addr.trim(),
              name: i === 0 ? (draft.name || '') : '',
            },
          })),
          ccRecipients: (draft.cc || []).map(addr => ({
            emailAddress: { address: addr.trim() },
          })),
          isDraft: true,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        results.push({ to: draft.to, success: true, id: data.id });
      } else {
        const err = await response.json().catch(() => ({}));
        if (response.status === 401) {
          return res.status(200).json({ success: false, needsAuth: true, error: 'Token expired. Please reconnect Outlook.' });
        }
        results.push({ to: draft.to, success: false, error: err.error?.message || `HTTP ${response.status}` });
      }
    } catch (err) {
      results.push({ to: draft.to, success: false, error: err.message });
    }
  }

  const created = results.filter(r => r.success).length;
  return res.status(200).json({ success: created > 0, created, total: drafts.length, results });
}

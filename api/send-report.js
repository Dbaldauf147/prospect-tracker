export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Email service not configured' });

  const { to, subject, errors, totalUploaded, totalCreated, totalUpdated, totalErrors } = req.body;
  if (!to || !errors) return res.status(400).json({ error: 'Missing required fields' });

  // Build HTML table from errors
  const allKeys = new Set();
  for (const e of errors) {
    for (const key of Object.keys(e)) {
      if (key !== '_id') allKeys.add(key);
    }
  }
  const columns = ['category', 'firstname', 'lastname', 'email', 'phone', 'company', 'jobtitle', 'hs_linkedin_url', 'city', 'state', 'country', 'reason'];
  // Add any extra columns from the data that aren't in the standard list
  for (const key of allKeys) {
    if (!columns.includes(key)) columns.push(key);
  }

  const headerLabels = {
    category: 'Error Category',
    firstname: 'First Name',
    lastname: 'Last Name',
    email: 'Email',
    phone: 'Phone',
    company: 'Company',
    jobtitle: 'Job Title',
    hs_linkedin_url: 'LinkedIn URL',
    city: 'City',
    state: 'State',
    country: 'Country',
    reason: 'Error Reason',
  };

  const headerRow = columns.map(c => `<th style="padding:6px 10px;background:#f3f4f6;border:1px solid #e5e7eb;font-size:12px;text-align:left;white-space:nowrap">${headerLabels[c] || c}</th>`).join('');
  const dataRows = errors.map(e => {
    return '<tr>' + columns.map(c => `<td style="padding:4px 10px;border:1px solid #e5e7eb;font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis">${e[c] || ''}</td>`).join('') + '</tr>';
  }).join('');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:900px;margin:0 auto">
      <h2 style="color:#1E2A36">Bulk Upload Report — Failed Contacts</h2>
      <p style="color:#5A6B7E;font-size:14px">
        <strong>${totalUploaded}</strong> contacts attempted &middot;
        <strong style="color:#10B981">${totalCreated}</strong> created &middot;
        <strong style="color:#3B82F6">${totalUpdated}</strong> updated &middot;
        <strong style="color:#EF4444">${totalErrors}</strong> failed
      </p>
      <table style="border-collapse:collapse;width:100%;margin-top:16px">
        <thead><tr>${headerRow}</tr></thead>
        <tbody>${dataRows}</tbody>
      </table>
      <p style="color:#8896A6;font-size:11px;margin-top:24px">Sent from Prospect Tracker</p>
    </div>
  `;

  try {
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Prospect Tracker <onboarding@resend.dev>',
        to: [to],
        subject: subject || `Bulk Upload Report — ${totalErrors} Failed Contacts`,
        html,
      }),
    });
    const result = await emailRes.json();
    if (!emailRes.ok) throw new Error(result.message || JSON.stringify(result));
    return res.json({ success: true, id: result.id });
  } catch (err) {
    console.error('Email send error:', err);
    return res.status(500).json({ error: err.message });
  }
}

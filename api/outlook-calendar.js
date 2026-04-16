// Fetches today's calendar events + attendees from Microsoft Graph.
// Requires a valid Outlook access token passed via the Authorization header.

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const accessToken = authHeader.slice(7);

  // Build today's range in UTC (the API normalizes to the user's mailbox timezone)
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
  const startISO = startOfDay.toISOString();
  const endISO = endOfDay.toISOString();

  const graphUrl =
    `https://graph.microsoft.com/v1.0/me/calendarview` +
    `?startdatetime=${encodeURIComponent(startISO)}` +
    `&enddatetime=${encodeURIComponent(endISO)}` +
    `&$select=subject,start,end,attendees,organizer,isAllDay,isCancelled,showAs,location` +
    `&$orderby=start/dateTime` +
    `&$top=50`;

  try {
    const resp = await fetch(graphUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (resp.status === 401) {
      return res.status(401).json({ error: 'Token expired or invalid — re-authenticate with Outlook.' });
    }
    if (!resp.ok) {
      const errBody = await resp.text();
      return res.status(resp.status).json({ error: `Microsoft Graph error: ${errBody}` });
    }

    const data = await resp.json();
    const events = (data.value || [])
      .filter(e => !e.isCancelled)
      .map(e => ({
        id: e.id,
        subject: e.subject || '(No subject)',
        start: e.start?.dateTime ? e.start.dateTime + 'Z' : null,
        end: e.end?.dateTime ? e.end.dateTime + 'Z' : null,
        isAllDay: !!e.isAllDay,
        showAs: e.showAs || '',
        location: e.location?.displayName || '',
        organizer: e.organizer?.emailAddress
          ? { name: e.organizer.emailAddress.name || '', email: e.organizer.emailAddress.address || '' }
          : null,
        attendees: (e.attendees || []).map(a => ({
          name: a.emailAddress?.name || '',
          email: a.emailAddress?.address || '',
          type: a.type || '',
          response: a.status?.response || '',
        })),
      }));

    return res.status(200).json({ events, count: events.length, date: startISO.slice(0, 10) });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

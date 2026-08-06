// Fetches today's calendar events + attendees from Microsoft Graph.
// The caller's Firebase ID token goes in Authorization (verified by
// withAuth); the user's own Microsoft Graph token goes in X-MS-Token.
import { withAuth } from './_lib/http.js';

// Pages of 200 events. Five covers a month of even a heavily-booked
// calendar; past that the window is the problem, not the paging.
const MAX_PAGES = 5;

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const accessToken = req.headers['x-ms-token'];
  if (!accessToken) {
    return res.status(401).json({ error: 'Missing X-MS-Token (Outlook access token)' });
  }

  // Optional ?startDays=-7&endDays=7 to widen the window. Defaults to today only.
  const startDays = Number(req.query?.startDays || 0);
  const endDays = Number(req.query?.endDays || 0);
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const rangeStart = new Date(startOfDay.getTime() + startDays * 24 * 60 * 60 * 1000);
  const rangeEnd = new Date(startOfDay.getTime() + (endDays + 1) * 24 * 60 * 60 * 1000);
  const startISO = rangeStart.toISOString();
  const endISO = rangeEnd.toISOString();

  const graphUrl =
    `https://graph.microsoft.com/v1.0/me/calendarview` +
    `?startdatetime=${encodeURIComponent(startISO)}` +
    `&enddatetime=${encodeURIComponent(endISO)}` +
    `&$select=subject,start,end,attendees,organizer,isAllDay,isCancelled,showAs,location` +
    `&$orderby=start/dateTime` +
    `&$top=200`;

  try {
    // Graph pages a calendar view, and it orders this one oldest-first —
    // so a window wide enough to overflow one page drops the meetings at
    // the END of it. That is the half a "what's coming up" view is made
    // of, and losing it silently reads as an empty afternoon. Follow
    // @odata.nextLink instead, with a cap so a pathological calendar
    // can't hold the function open indefinitely.
    const raw = [];
    let next = graphUrl;
    let pages = 0;
    let truncated = false;
    while (next && pages < MAX_PAGES) {
      const resp = await fetch(next, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (resp.status === 401) {
        return res.status(401).json({ error: 'Token expired or invalid: re-authenticate with Outlook.' });
      }
      if (!resp.ok) {
        const errBody = await resp.text();
        return res.status(resp.status).json({ error: `Microsoft Graph error: ${errBody}` });
      }

      const data = await resp.json();
      raw.push(...(data.value || []));
      pages += 1;
      next = data['@odata.nextLink'] || '';
      if (next && pages >= MAX_PAGES) truncated = true;
    }

    const events = raw
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

    return res.status(200).json({
      events,
      count: events.length,
      rangeStart: startISO,
      rangeEnd: endISO,
      // Set when the calendar had more than MAX_PAGES pages of events in
      // this window, so a caller can say the far end is missing rather
      // than present a short list as the whole story.
      truncated,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

export default withAuth(handler);

// Fetches an Outlook ICS calendar feed, parses today's events + attendees.
// No OAuth needed — just the private ICS URL the user gets from Outlook Web.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { icsUrl } = req.body || {};
  if (!icsUrl || typeof icsUrl !== 'string' || !icsUrl.startsWith('https://')) {
    return res.status(400).json({ error: 'Missing or invalid icsUrl — must be an https:// link to an ICS feed.' });
  }

  try {
    const resp = await fetch(icsUrl, {
      headers: { 'User-Agent': 'ProspectTracker/1.0' },
    });
    if (!resp.ok) {
      return res.status(resp.status).json({ error: `Failed to fetch ICS feed: HTTP ${resp.status}` });
    }
    const icsText = await resp.text();

    // Parse the ICS text into today's events
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    const events = [];
    const blocks = icsText.split('BEGIN:VEVENT');

    for (let i = 1; i < blocks.length; i++) {
      const block = blocks[i].split('END:VEVENT')[0] || '';

      // Unfold lines (RFC 5545: continuation lines start with space/tab)
      const unfolded = block.replace(/\r?\n[ \t]/g, '');

      function getProp(name) {
        // Match property with optional params like DTSTART;TZID=...:value
        const re = new RegExp(`^${name}[;:](.*)$`, 'im');
        const m = unfolded.match(re);
        if (!m) return '';
        // Strip parameters before the actual value for properties with params
        const raw = m[1];
        // For date/time props, value is after the last colon in params
        if (name.startsWith('DT') || name === 'DURATION') {
          const colonIdx = raw.lastIndexOf(':');
          return colonIdx >= 0 ? raw.slice(colonIdx + 1).trim() : raw.trim();
        }
        return raw.trim();
      }

      function parseIcsDate(s) {
        if (!s) return null;
        // Format: 20260416T140000Z or 20260416T140000 or 20260416
        const clean = s.replace(/[^0-9TZ]/g, '');
        if (clean.length >= 15) {
          // Has time: YYYYMMDDTHHmmss[Z]
          const year = clean.slice(0, 4);
          const month = clean.slice(4, 6);
          const day = clean.slice(6, 8);
          const hour = clean.slice(9, 11);
          const min = clean.slice(11, 13);
          const sec = clean.slice(13, 15);
          const isUtc = clean.endsWith('Z');
          const isoStr = `${year}-${month}-${day}T${hour}:${min}:${sec}${isUtc ? 'Z' : ''}`;
          return new Date(isoStr);
        }
        if (clean.length >= 8) {
          // Date only: YYYYMMDD
          const year = clean.slice(0, 4);
          const month = clean.slice(4, 6);
          const day = clean.slice(6, 8);
          return new Date(`${year}-${month}-${day}T00:00:00`);
        }
        return null;
      }

      const dtStart = parseIcsDate(getProp('DTSTART'));
      const dtEnd = parseIcsDate(getProp('DTEND'));
      if (!dtStart) continue;

      // Filter to today only
      if (dtStart >= todayEnd || (dtEnd && dtEnd <= todayStart)) continue;
      if (!dtEnd && dtStart < todayStart) continue;

      // Check STATUS — skip cancelled
      const status = getProp('STATUS');
      if (status && status.toUpperCase() === 'CANCELLED') continue;

      const subject = (getProp('SUMMARY') || '(No subject)')
        .replace(/\\n/g, ' ').replace(/\\,/g, ',').replace(/\\\\/g, '\\');
      const location = (getProp('LOCATION') || '')
        .replace(/\\n/g, ' ').replace(/\\,/g, ',').replace(/\\\\/g, '\\');

      // Parse attendees
      const attendees = [];
      const attendeeRegex = /^ATTENDEE[^:]*(?:CN=([^;:]*)[^:]*)?:MAILTO:(.+)$/gim;
      let am;
      while ((am = attendeeRegex.exec(unfolded)) !== null) {
        const name = (am[1] || '').replace(/"/g, '').trim();
        const email = (am[2] || '').trim();
        if (email) attendees.push({ name: name || email, email });
      }

      // Also try to get organizer
      const orgMatch = unfolded.match(/^ORGANIZER[^:]*(?:CN=([^;:]*)[^:]*)?:MAILTO:(.+)$/im);
      let organizer = null;
      if (orgMatch) {
        organizer = {
          name: (orgMatch[1] || '').replace(/"/g, '').trim(),
          email: (orgMatch[2] || '').trim(),
        };
      }

      events.push({
        id: getProp('UID') || `ics-${i}`,
        subject,
        start: dtStart.toISOString(),
        end: dtEnd ? dtEnd.toISOString() : null,
        location,
        organizer,
        attendees,
        isAllDay: !getProp('DTSTART').includes('T'),
      });
    }

    // Sort by start time
    events.sort((a, b) => new Date(a.start) - new Date(b.start));

    return res.status(200).json({ events, count: events.length, date: todayStart.toISOString().slice(0, 10) });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Unknown error' });
  }
}

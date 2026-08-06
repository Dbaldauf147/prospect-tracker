// Outlook calendar → meetings on the Activity page.
//
// The Activity page's meeting panel had two ways to learn about the
// user's calendar, and neither of them is the calendar:
//
//   - Granola, which only knows the meetings it sat in and took notes
//     on. Its public API serves notes that have finished summarising, so
//     nothing that has yet to happen — the whole "coming up" half of a
//     day — can ever arrive that way.
//   - a Power Automate flow POSTing to /api/calendar-webhook, which is
//     the real calendar but costs the user a flow to build and maintain
//     before a single meeting shows up.
//
// This module is the third way, and it reuses a connection the app
// already has: the Microsoft Graph sign-in behind the Draft Emails page
// and the opportunity meeting picker, whose scope already includes
// Calendars.Read. /api/outlook-calendar serves the events; everything
// here turns one of those into the row the panel renders.
//
// Pure mapping — no fetch, no React — so the rules that decide what
// lands on somebody's calendar view stay testable
// (scripts/outlookCalendar.test.mjs).

// The user's own company. Attendees here are colleagues, not who the
// meeting is with — the same rule the rest of the Activity page, the
// Agenda page and the HubSpot contacts list already apply.
export const INTERNAL_EMAIL_DOMAIN = 'se.com';

function domainOf(email) {
  const at = String(email || '').lastIndexOf('@');
  return at >= 0 ? String(email).slice(at + 1).toLowerCase().trim() : '';
}

function isInternal(email, internalDomain) {
  const domain = domainOf(email);
  if (!domain || !internalDomain) return false;
  return domain === internalDomain || domain.endsWith(`.${internalDomain}`);
}

/** An ISO instant, or null when the value isn't a real moment. */
function isoOf(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : null;
}

function personOf(entry) {
  const email = String(entry?.email || '').trim();
  const name = String(entry?.name || '').trim();
  if (!email && !name) return null;
  return { name, email, response: String(entry?.response || '').trim() };
}

/**
 * One Microsoft Graph event (as /api/outlook-calendar normalises it) →
 * an Activity meeting row, or null when it has no usable start.
 *
 * Nothing is filtered out here on the grounds of looking unimportant. A
 * block marked Free, an all-day event, a meeting with no attendees but
 * yourself — they are all on the calendar, and a panel that quietly drops
 * them is a panel that disagrees with Outlook. `showAs` and `_allDay` are
 * carried instead, so a caller that wants to draw them differently can.
 */
export function meetingFromOutlookEvent(event, { internalDomain = INTERNAL_EMAIL_DOMAIN } = {}) {
  if (!event) return null;
  const start = isoOf(event.start);
  if (!start) return null;

  const end = isoOf(event.end);
  const attendees = (Array.isArray(event.attendees) ? event.attendees : [])
    .map(personOf)
    .filter(Boolean);
  const external = attendees.filter(a => !isInternal(a.email, internalDomain));

  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : null;

  return {
    // Graph ids are long and opaque but stable, which is what a React key
    // and the dedupe below both want. The prefix keeps them from ever
    // colliding with a Granola note id or a webhook row.
    id: event.id ? `outlook:${event.id}` : '',
    _type: 'meeting',
    _source: 'outlook',
    _subject: String(event.subject || '').trim() || '(No subject)',
    _timestamp: start,
    _meetingStart: start,
    _meetingEnd: end,
    _allDay: !!event.isAllDay,
    // 'free' / 'busy' / 'tentative' / 'oof'. A focus block shows as free,
    // and reads differently from a meeting even though both are on the
    // calendar.
    _showAs: String(event.showAs || '').trim(),
    _location: String(event.location || '').trim(),
    _attendees: external.map(a => a.name || a.email).filter(Boolean).join(', '),
    _attendeeDetails: external,
    _attendeeCount: external.length,
    // A meeting with colleagues, not a meeting nobody is in. The panel
    // says so rather than showing "No attendees" over a full room.
    _internalOnly: attendees.length > 0 && external.length === 0,
    _externalEmails: external.map(a => String(a.email || '').toLowerCase()).filter(Boolean),
    // Filled in by the page from its own domain → company index, the
    // same way Granola rows are.
    _company: '',
    _organizer: event.organizer || null,
    _duration: (endMs != null && endMs > startMs) ? endMs - startMs : null,
    _direction: '',
    _status: '',
    _to: external.map(a => a.email).filter(Boolean).join(', '),
    _toName: '',
    _from: '',
    _fromName: '',
    _cc: '',
  };
}

/**
 * Every Graph event that describes a meeting, in the order the day runs.
 *
 * Graph returns a recurring series as one event per occurrence, and a
 * calendar the user has open twice can hand back the same occurrence
 * twice; both collapse on the event id, which is per-occurrence.
 */
export function outlookMeetingsFromEvents(events) {
  const rows = [];
  const seen = new Set();
  for (const event of (Array.isArray(events) ? events : [])) {
    const row = meetingFromOutlookEvent(event);
    if (!row) continue;
    const key = row.id || `${row._meetingStart}|${row._subject}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  return rows.sort(
    (a, b) => new Date(a._meetingStart).getTime() - new Date(b._meetingStart).getTime(),
  );
}

/**
 * What the panel says about its Outlook connection, as one sentence, or
 * '' when the connection needs no explaining.
 *
 * The states below all render as an empty meeting list, and telling them
 * apart is the difference between "sign in" and "your day is clear":
 *
 *   - never connected: nothing has ever been fetched;
 *   - token expired: Graph tokens last an hour, so a page left open
 *     overnight is the normal case, not an error;
 *   - connected and fetched, but the window is empty.
 */
export function describeOutlookCalendar({
  connected = false, expired = false, loaded = false,
  events = 0, inRange = 0, rangeLabel = 'today',
} = {}) {
  if (!connected) return 'Outlook isn’t connected, so nothing on your calendar can show here yet. Use Connect Outlook to sign in.';
  if (expired) return 'Your Outlook sign-in has expired. Use Reconnect Outlook to sign in again — it lasts about an hour.';
  if (!loaded) return '';
  if (events === 0) return `Outlook returned no calendar events for this window (${rangeLabel}).`;
  if (inRange === 0) return `Outlook has ${events} event${events === 1 ? '' : 's'} in the fetched window, none ${rangeLabel}.`;
  return '';
}

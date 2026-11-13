// Shared helpers for the Events feature (Contacts → Events subtab and
// the "Add to event" section in the contact popup). Events live in
// Firestore settings under `settings.events`:
//
//   events: [{ id, name, date, location, notes, attendees: [
//     { contactId, name, email, company, title }
//   ] }]
//
// HubSpot contacts are stored with their contactId so the same person
// can be added from the contact popup or the Events subtab and de-dupe
// against each other. Manual (non-HubSpot) attendees have an empty
// contactId.

// Drop U+FFFD replacement characters (emoji or accents that were mangled
// on the way into HubSpot show up as a run of them) and tidy spacing.
export function cleanText(value) {
  return String(value || '').replace(/\uFFFD+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function contactDisplayName(contact) {
  const name = [contact?.firstname, contact?.lastname].map(cleanText).filter(Boolean).join(' ').trim();
  return name || contact?.email || contact?.company || 'Unnamed contact';
}

export function contactKey(contact) {
  return String(contact?.id || contact?.vid || '');
}

// Build the stored attendee shape from a HubSpot contact record.
export function attendeeFromContact(contact) {
  return {
    contactId: contactKey(contact),
    name: contactDisplayName(contact),
    email: contact?.email || '',
    company: contact?.company || '',
    title: contact?.jobtitle || '',
  };
}

// Is this contact already saved as an attendee on the event?
export function isContactInEvent(event, contactId) {
  const id = String(contactId || '');
  if (!id) return false;
  const list = Array.isArray(event?.attendees) ? event.attendees : [];
  return list.some(a => a.contactId && String(a.contactId) === id);
}

// Return a new events array with `contact` toggled on/off the event
// identified by `eventId`. Adds when absent, removes when present.
export function toggleContactInEvents(events, eventId, contact) {
  const id = contactKey(contact);
  if (!id) return Array.isArray(events) ? events : [];
  return (Array.isArray(events) ? events : []).map(ev => {
    if (ev.id !== eventId) return ev;
    const list = Array.isArray(ev.attendees) ? ev.attendees : [];
    const exists = list.some(a => a.contactId && String(a.contactId) === id);
    const attendees = exists
      ? list.filter(a => !(a.contactId && String(a.contactId) === id))
      : [...list, attendeeFromContact(contact)];
    return { ...ev, attendees };
  });
}

/**
 * The title-only attendees (saved on the Events page with no name or
 * email) at a company, for the company popup's Contacts tab: one entry per
 * title, with every event it attended, newest first. A record counts when
 * its company or the lookup row's company it was added from is one of
 * `names` (the company's name, goes-by and aliases), compared normalized.
 *   [{ key, title, company, decisionMaker, events: [{ id, name, date }] }]
 */
export function titleOnlyAttendeesForCompany(events, names, normalize) {
  const wanted = new Set((names || []).map(n => normalize(n)).filter(Boolean));
  if (!wanted.size) return [];
  const byKey = new Map();
  for (const ev of (Array.isArray(events) ? events : [])) {
    for (const a of (ev?.attendees || [])) {
      if (!a?.titleOnly) continue;
      const title = String(a.title || '').trim();
      if (!title) continue;
      if (![a.company, a.lookupCompany].some(c => wanted.has(normalize(c)))) continue;
      const key = title.toLowerCase();
      if (!byKey.has(key)) byKey.set(key, { key, title, company: a.company || a.lookupCompany || '', decisionMaker: false, events: [] });
      const entry = byKey.get(key);
      if (a.decisionMaker) entry.decisionMaker = true;
      if (!entry.events.some(e => e.id === ev.id)) entry.events.push({ id: ev.id, name: ev.name || 'Untitled event', date: ev.date || '' });
    }
  }
  const out = [...byKey.values()];
  for (const e of out) e.events.sort((x, y) => String(y.date).localeCompare(String(x.date)));
  return out.sort((x, y) => (x.decisionMaker === y.decisionMaker ? x.title.localeCompare(y.title) : x.decisionMaker ? -1 : 1));
}

// A new event with `contact` as its first attendee, added to the list. For
// tagging somebody with an event they went to that isn't on the Events page
// yet (the contact popup's "+ New event"). `date` is YYYY-MM-DD or blank.
export function newEventId() {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function addContactToNewEvent(events, { name, date = '' } = {}, contact) {
  const list = Array.isArray(events) ? events : [];
  const title = cleanText(name);
  if (!title || !contactKey(contact)) return list;
  return [...list, { id: newEventId(), name: title, date: String(date || ''), location: '', notes: '', attendees: [attendeeFromContact(contact)] }];
}

// Events newest first, undated ones last, for the contact popup's chips.
export function eventsNewestFirst(events) {
  return [...(Array.isArray(events) ? events : [])].sort((a, b) => {
    const da = String(a?.date || ''), db = String(b?.date || '');
    if (da && db) return db.localeCompare(da);
    if (da) return -1;
    if (db) return 1;
    return String(a?.name || '').localeCompare(String(b?.name || ''));
  });
}

// ---- Event series --------------------------------------------------------
// The same event recurs year after year, saved as one record per year
// ("Greenbuild 2024" on 2024-11-12, "Greenbuild" on 2025-11-04). The
// contact popup groups those into one series so it can show every year of
// an event and which of them this person went to. A series is the name
// with any year taken out, compared case- and spacing-blind.
const YEAR_IN_NAME = /\b(19|20)\d{2}\b/g;

export function eventSeriesLabel(name) {
  const label = cleanText(String(name || '').replace(YEAR_IN_NAME, ' '))
    .replace(/^[\s\-,:|]+|[\s\-,:|]+$/g, '').trim();
  return label || cleanText(name);
}

export function eventSeriesKey(name) {
  return eventSeriesLabel(name).toLowerCase();
}

// The year an event record is for: its date's, else one in its name, else ''.
export function eventYear(event) {
  const fromDate = /^(\d{4})-\d{2}-\d{2}/.exec(String(event?.date || ''));
  if (fromDate) return fromDate[1];
  const fromName = String(event?.name || '').match(YEAR_IN_NAME);
  return fromName ? fromName[fromName.length - 1] : '';
}

/**
 * Events grouped into series, each with its years newest first:
 *   [{ key, label, events: [event, ...] }]
 * Series come back in the order of their newest year, undated last.
 */
export function groupEventSeries(events) {
  const byKey = new Map();
  for (const ev of eventsNewestFirst(events)) {
    const key = eventSeriesKey(ev?.name) || `__untitled__${ev?.id}`;
    if (!byKey.has(key)) byKey.set(key, { key, label: eventSeriesLabel(ev?.name) || 'Untitled event', events: [] });
    byKey.get(key).events.push(ev);
  }
  for (const s of byKey.values()) {
    s.events.sort((a, b) => {
      const ya = eventYear(a), yb = eventYear(b);
      if (ya !== yb) return !ya ? 1 : !yb ? -1 : yb.localeCompare(ya);
      return String(b?.date || '').localeCompare(String(a?.date || ''));
    });
  }
  return [...byKey.values()];
}

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

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

export function contactDisplayName(contact) {
  const name = [contact?.firstname, contact?.lastname].filter(Boolean).join(' ').trim();
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

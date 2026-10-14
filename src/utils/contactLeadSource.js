// Where a contact came to us from: a Marketing Lead, an event, a referral...
//
// Set on the contact popup and stored per user, keyed by contact id:
//   settings.contactLeadSource[contactId] = 'Marketing Lead' | 'Event' | ...
//
// Blank is the absence of a key, same as the other local-only contact
// fields (sentiment, team name, ...). HubSpot's own source properties are
// analytics read-onlys, so this lives in settings rather than on the
// contact record.
//
// The Marketing Leads page stamps MARKETING_LEAD_SOURCE on every contact it
// creates, so leads from there are tracked from the moment they land.

export const MARKETING_LEAD_SOURCE = 'Marketing Lead';

export const LEAD_SOURCE_OPTIONS = [
  MARKETING_LEAD_SOURCE,
  'Event',
  'Referral',
  'Inbound',
  'Outbound',
  'LinkedIn',
  'Existing Client',
  'Partner',
  'Other',
];

export function leadSourceFor(map, contactId) {
  if (!map || contactId == null) return '';
  return String(map[String(contactId)] || '').trim();
}

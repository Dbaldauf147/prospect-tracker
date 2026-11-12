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
// creates, and Bulk Add Contacts stamps BULK_ADD_LEAD_SOURCE, so leads from
// either are tracked from the moment they land. Hubspot Mapping > Gap Fill
// stamps HUBSPOT_EXPORT_LEAD_SOURCE on the contacts it adds.

export const MARKETING_LEAD_SOURCE = 'Marketing Lead';
export const BULK_ADD_LEAD_SOURCE = 'Bulk Added';
// Stamped by Hubspot Mapping > Gap Fill on each contact it adds from the
// HubSpot contacts export.
export const HUBSPOT_EXPORT_LEAD_SOURCE = 'Added from HubSpot';

export const LEAD_SOURCE_OPTIONS = [
  MARKETING_LEAD_SOURCE,
  BULK_ADD_LEAD_SOURCE,
  HUBSPOT_EXPORT_LEAD_SOURCE,
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

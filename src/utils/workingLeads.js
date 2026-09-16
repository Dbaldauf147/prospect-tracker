// The Marketing Leads that are currently being worked, shaped for the
// Draft Emails composer.
//
// The Draft Emails page already has a "From Marketing Leads" queue, but
// that one only holds what somebody ticked and pushed over from the
// Marketing Leads page. This is the standing list: every saved lead whose
// Status is "Working" (the status vocabulary lives on the Dropdowns tab as
// "Marketing Lead Status"), so the composer can offer them without a trip
// to the other page and without anything having to be queued first.
//
// Both live in the same card on Draft Emails, and both hand the composer
// the same contact shape via leadToDraftContact, so a lead that arrives by
// either route collapses to one recipient rather than two.

// The lead status that counts as "being worked". Compared case- and
// whitespace-insensitively so a pasted "working" from Salesforce still
// matches the dropdown's "Working".
export const WORKING_STATUS = 'Working';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isWorkingLead(row) {
  return String(row?.status || '').trim().toLowerCase() === WORKING_STATUS.toLowerCase();
}

// Shape a saved lead row into the contact object the composer expects,
// splitting the "First Last" name into first / last for {firstName} and
// friends. The id is namespaced so a lead can never collide with a HubSpot
// contact id, and so the same lead added twice (from here and from the
// Marketing Leads page's own "send to drafts") dedupes to one recipient.
export function leadToDraftContact(row) {
  const name = String(row?.name || '').trim();
  const parts = name.split(/\s+/).filter(Boolean);
  return {
    id: `lead:${row?.id}`,
    name: name || String(row?.email || '').trim(),
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' '),
    email: String(row?.email || '').trim(),
    company: String(row?.company || '').trim(),
    title: String(row?.jobTitle || '').trim(),
  };
}

// Every Working lead that can actually be emailed, as draft contacts.
//
// Hidden leads are left out: hiding is how the Marketing Leads page parks
// a lead it does not want to see, and a parked lead showing up in the
// composer would be the page's own rule leaking. Leads without a usable
// email are dropped (nothing to send to), duplicates collapse on the
// lower-cased email, and the result is sorted by name so the list does not
// reshuffle as leads are edited.
export function workingLeadContacts(settings) {
  const rows = Array.isArray(settings?.marketingLeads) ? settings.marketingLeads : [];
  const hidden = new Set(Array.isArray(settings?.marketingLeadsHiddenLeads) ? settings.marketingLeadsHiddenLeads : []);
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    if (!row || hidden.has(row.id)) continue;
    if (!isWorkingLead(row)) continue;
    const email = String(row.email || '').trim();
    if (!EMAIL_RE.test(email)) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(leadToDraftContact(row));
  }
  out.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email, undefined, { sensitivity: 'base' }));
  return out;
}

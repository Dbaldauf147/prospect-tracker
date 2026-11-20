// A contact's two company names, kept apart.
//
// HubSpot Company Name is what HubSpot itself has on the contact. Nothing
// Prospect Tracker does to its own name for the company moves it.
//
// Prospect Tracker Company Name is the name the contact is filed under
// here (HubSpot's, or the local pin laid over it). It is meant to equal a
// Table View company name, so one that doesn't is flagged.

const keyOf = (name) => String(name || '').trim().toLowerCase();

// The contact's company as HubSpot has it, tidied. `hubspotCompany` must be
// the synced value from BEFORE the local Company pin is applied.
export function hubspotCompanyNameOf(hubspotCompany) {
  return String(hubspotCompany || '').trim();
}

// Every Table View company name, as a lookup set.
export function tableViewNameKeys(prospects) {
  const keys = new Set();
  for (const p of prospects || []) {
    const k = keyOf(p?.company);
    if (k) keys.add(k);
  }
  return keys;
}

// Whether `name` is exactly a Table View company name. Case and outer
// spaces are forgiven; a different spelling ("Acme Corp" for "Acme
// Corporation") is not, which is the point: the names are meant to be equal.
export function isTableViewName(name, keys) {
  const k = keyOf(name);
  return !!k && keys.has(k);
}

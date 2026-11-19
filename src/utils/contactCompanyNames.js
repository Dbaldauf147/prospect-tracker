// A contact's two company names: the one Prospect Tracker files it under,
// and the name(s) the same company goes by in HubSpot.
//
// The HubSpot names are the company record's own list (its popup's HubSpot
// Names field, hubspotCompanyNames): one company can carry several, and all
// of them are kept. A company with none recorded goes by its plain company
// name in HubSpot, so that is what the contact shows.
import { splitNameList } from './hubspotMapping.js';

const keyOf = (name) => String(name || '').trim().toLowerCase();

// Find the company record a contact's company name belongs to: the record
// called that, else the record that lists it as one of its HubSpot names.
// A record's own name always wins over another record's HubSpot name.
export function buildCompanyRecordLookup(prospects) {
  const byName = new Map();
  const byHubspotName = new Map();
  for (const p of prospects || []) {
    const k = keyOf(p?.company);
    if (k && !byName.has(k)) byName.set(k, p);
  }
  for (const p of prospects || []) {
    for (const n of splitNameList(p?.hubspotCompanyNames)) {
      const k = keyOf(n);
      if (k && !byHubspotName.has(k)) byHubspotName.set(k, p);
    }
  }
  return (name) => {
    const k = keyOf(name);
    return k ? (byName.get(k) || byHubspotName.get(k) || null) : null;
  };
}

// The HubSpot name(s) for a contact at `companyName`, given its company
// record (or none): the record's recorded names, one spelling each, else
// the company name on its own. Empty when there is no company at all.
export function hubspotCompanyNamesFor(companyName, record) {
  const seen = new Set();
  const out = [];
  for (const n of splitNameList(record?.hubspotCompanyNames)) {
    const k = keyOf(n);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  if (out.length) return out;
  const own = String(companyName || '').trim();
  return own ? [own] : [];
}

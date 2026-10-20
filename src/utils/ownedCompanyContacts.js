// The people at the companies a company owns: its divisions (the chart on
// the Contacts tab) and its holdings (the Sites & Holdings table). The
// company card lists them in a collapsed table under its own roster, each
// row naming which owned company the person is at.
//
// The match is the one the card uses for its own roster, applied per owned
// company: a fuzzy Company-text match that respects a division bracket
// ("Brookfield (Self Storage)" only takes contacts whose Company names Self
// Storage), plus the contacts linked to that company by hand, minus the
// ones removed from it. Pure, so scripts/ownedCompanyContacts.test.mjs can
// run it without a browser.

import { companiesMatch } from './listFlags.js';
import { carriesDivision } from './companyIndex.js';

// The owned companies as [{ name, kind }], deduped by name, with anything
// that is the company itself dropped. Divisions come first, so a company
// that is both a division and a holding is labelled a division.
export function ownedCompanyList(entries, selfName) {
  const out = [];
  const seen = new Set();
  for (const e of (entries || [])) {
    const name = String(e?.name || '').trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    if (selfName && companiesMatch(name, selfName)) continue;
    seen.add(key);
    out.push({ name, kind: e.kind || '' });
  }
  return out;
}

const idOf = (c) => String(c?.id || c?.vid || '');

// Returns [{ contact, company, kind }], in the order the contacts arrive.
//   owned       from ownedCompanyList
//   skipIds     ids already on the card's own roster, left out here
//   showHidden  the card's "Show hidden" toggle: hide-tagged and removed
//               contacts come back with it, as they do on the roster
//   isHidden    the Hide-tag test (contactTags.contactIsHidden)
//   links       settings.companyContactLinks  { companyLower: [id, …] }
//   exclusions  settings.companyContactExclusions, same shape
export function ownedCompanyContacts(contacts, owned, {
  skipIds = new Set(), showHidden = false, isHidden = () => false, links = {}, exclusions = {},
} = {}) {
  if (!owned?.length || !contacts?.length) return [];

  // Contacts share Company texts heavily, so each distinct text is matched
  // against the owned names once rather than once per contact.
  const byText = new Map();
  const ownerOfText = (text) => {
    const key = String(text || '').trim().toLowerCase();
    if (!key) return null;
    if (byText.has(key)) return byText.get(key);
    const hit = owned.find(o => companiesMatch(text, o.name) && carriesDivision(text, o.name)) || null;
    byText.set(key, hit);
    return hit;
  };

  const linkedTo = new Map();
  const excludedFrom = new Map();
  for (const o of owned) {
    const key = o.name.toLowerCase();
    for (const id of (links?.[key] || [])) if (!linkedTo.has(String(id))) linkedTo.set(String(id), o);
    excludedFrom.set(key, new Set((exclusions?.[key] || []).map(String)));
  }

  const out = [];
  for (const c of contacts) {
    const id = idOf(c);
    if (!id || skipIds.has(id)) continue;
    const o = linkedTo.get(id) || ownerOfText(c.company);
    if (!o) continue;
    if (!showHidden && (isHidden(c) || excludedFrom.get(o.name.toLowerCase())?.has(id))) continue;
    out.push({ contact: c, company: o.name, kind: o.kind });
  }
  return out;
}

// Resolve a company NAME to the Table View prospect record behind it.
//
// The contact popup's "Company" field is free text (HubSpot's spelling,
// which the user can retype), so every page that offers a way through to
// the company popup has to turn that string back into a prospect. Matched
// case- and whitespace-insensitively on the whole name — the same rule
// App.jsx's contact search uses, deliberately not the fuzzy
// companiesMatch(): opening the WRONG company's popup is worse than
// opening a blank one, and the popup's own header shows which company it
// landed on either way.
export function findProspectByCompany(prospects, name) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return null;
  for (const p of (prospects || [])) {
    if (String(p?.company || '').trim().toLowerCase() === key) return p;
  }
  return null;
}

// What to hand the company popup for a company name: the real prospect
// when there is one, otherwise a company-only stub so a contact at an
// account that isn't in Table View yet is still reachable — the popup
// opens on the name and can add it. Mirrors App.handleSelectContact,
// which already opens the popup this way when a contact's company has no
// prospect behind it.
export function companyPopupTarget(prospects, name) {
  const company = String(name || '').trim();
  if (!company) return null;
  return findProspectByCompany(prospects, company) || { company };
}

// The prospect whose CDM a Bulk Add row shows: the one its Company NAMES,
// not the one its email domain happened to match. A domain match can land
// on the wrong account ("Quantum Energy Partners" matched to "Quantum
// (Quantum Capital)"), and that account's CDM then reads as the owner of
// a company it has nothing to do with.
//
//   1. the exact name (findProspectByCompany's rule);
//   2. otherwise a close variant (companiesMatch, the fuzzy rule My
//      Accounts uses: "Mutual of Omaha Insurance" finds "Mutual of
//      Omaha"), preferring the domain-matched prospect when it is one of
//      them, and only when the variant is unambiguous;
//   3. a row with no Company falls back to the domain match.
// A Company the tracker doesn't hold resolves to null: no CDM shown is
// better than somebody else's.
export function prospectForRowCompany(prospects, company, matched, { fuzzy } = {}) {
  const name = String(company || '').trim();
  if (!name) return matched || null;
  const exact = findProspectByCompany(prospects, name);
  if (exact) return exact;
  if (!fuzzy) return null;
  if (matched && fuzzy(name, matched.company)) return matched;
  let hit = null;
  for (const p of (prospects || [])) {
    if (!p?.company || !fuzzy(name, p.company)) continue;
    if (hit && hit.id !== p.id) return null;
    hit = p;
  }
  return hit;
}

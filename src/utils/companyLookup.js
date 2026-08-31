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

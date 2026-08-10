// Format the "why it failed" clause of a companyAssignment failure notice.
//
// These notices read "HubSpot couldn't <what><detail> Prospect Tracker will
// keep your value through future syncs." The detail used to be joined with
// " · " and then a colon, which ran the API's explanation straight into the
// reassurance sentence — a scope error came out as "…scopes are required:
// Prospect Tracker will keep your value…", reading as though Prospect
// Tracker were the missing scope. Ending the explanation as its own sentence
// keeps the two apart.
export function hubspotFailureDetail(ca) {
  const status = ca?.status ? ` (HTTP ${ca.status})` : '';
  const text = String(ca?.errorText || '').trim();
  if (!text) return `${status}.`;
  return `${status}. ${/[.!?…]$/.test(text) ? text : `${text}.`}`;
}

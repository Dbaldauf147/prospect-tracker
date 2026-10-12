// The Scope column on the New Opps subtab shows a long scope (a list of
// a dozen services) as one short line written by /api/summarize-notes
// (kind 'scope'), and the New Opps email carries the same line. This file
// is the pure half: what text a scope is summarised from and which scopes
// are worth a call at all. The cache key and batching are the notes
// summary's own (notesSummary.js), and the fetching lives in
// hooks/useNotesSummaries.

// A scope this short already reads as a summary: two services, or one
// line that fits the cell. Sending it would spend a call to get the same
// words back.
export const SHORT_SCOPE_CHARS = 60;
export const SHORT_SCOPE_SERVICES = 2;

/** The opp's Scope as the summariser reads it: the stored list, tidied. */
export function oppScopeText(opp) {
  return String(opp?.['Scope'] ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Whether this scope is long enough to be worth summarising. The comma
 * count is only a rough count of services (a service name can hold a
 * comma), which is all this decision needs.
 */
export function needsScopeSummary(text) {
  const t = String(text ?? '').trim();
  if (!t) return false;
  return t.length > SHORT_SCOPE_CHARS || t.split(',').filter(s => s.trim()).length > SHORT_SCOPE_SERVICES;
}

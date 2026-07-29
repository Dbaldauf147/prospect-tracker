// Shared Salesforce-link helpers for Marketing Leads. The Marketing Leads
// table stores each lead's Salesforce record link (or bare record id) in
// its `sfUrl` field; both that table and the Agents Activity table (which
// logs activity against a matched lead) resolve those values the same way,
// so the logic lives here rather than being duplicated.

// The Salesforce Lightning instance these leads live on. Relative record
// links pulled off the clipboard HTML are resolved against this, and a
// bare Lead record id is expanded into a record URL here.
export const SF_INSTANCE_URL = 'https://se.lightning.force.com';

// Resolve a stored Salesforce Link cell value into a clickable URL, or
// null when it isn't linkable. Accepts a full http(s) URL as-is, and
// expands a bare 15- or 18-char Salesforce record id into a Lead record
// URL on the instance above.
export function resolveSfUrl(value) {
  const v = String(value || '').trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[a-zA-Z0-9]{15}$|^[a-zA-Z0-9]{18}$/.test(v)) {
    return `${SF_INSTANCE_URL}/lightning/r/Lead/${v}/view`;
  }
  return null;
}

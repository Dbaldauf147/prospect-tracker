// Match a prospect's CDM string against the configured user's CDM name.
// Mirrors the historical Baldauf-specific behavior in a generic way:
//   - last-name substring match (so "Baldauf" inside "Dan Baldauf" /
//     "Daniel Baldauf" / "D. Baldauf" / "Baldauf, Dan" all match)
//   - first-name + last-initial substring match (so "dan b" inside
//     abbreviated forms like "Dan B." or "Dan B Smith" still matches)
export function matchesCdm(prospectCdm, cdmName) {
  if (!prospectCdm || !cdmName) return false;
  const lower = String(prospectCdm).toLowerCase();
  const tokens = String(cdmName).toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  const firstName = tokens[0];
  const lastName = tokens[tokens.length - 1];

  if (lower.includes(lastName)) return true;
  if (lastName !== firstName && lastName[0] && lower.includes(firstName + ' ' + lastName[0])) return true;
  return false;
}

// Keyword fallback used to guess which Target Accounts column holds the
// salesperson/CDM when the user hasn't explicitly mapped one on the
// Target Accounts page. Order matters — the first matching column wins.
const CDM_COLUMN_KEYWORDS = ['CDM', 'Salesperson', 'Sales Rep', 'Account Owner', 'Owner', 'Rep', 'Assigned', 'Team Member'];

// Find which header key holds the salesperson/CDM for a Target Accounts
// sheet — the user-mapped column when present, else the first keyword
// match. Returns '' when the sheet has no CDM column at all, which callers
// use to decide whether CDM filtering is even possible on that sheet.
export function findCdmColumnKey(headers, cdmColumn) {
  const list = Array.isArray(headers) ? headers : [];
  const col = String(cdmColumn || '').trim();
  if (col && list.includes(col)) return col;
  for (const key of list) {
    const lower = String(key || '').toLowerCase();
    for (const kw of CDM_COLUMN_KEYWORDS) {
      if (lower.includes(kw.toLowerCase())) return key;
    }
  }
  return '';
}

// Resolve the salesperson/CDM value for a single Target Accounts record.
// Prefers the column the user explicitly mapped on the Target Accounts
// page (settings.targetCdmColumn, passed in as `cdmColumn`); falls back
// to a keyword scan so sheets that don't carry the mapped column — or
// users who never set one — still resolve a rep. Returns a trimmed
// string ('' when nothing matches). This is the single source of truth
// for "who owns this account" across My Accounts, the prospect modal,
// the bulk Agenda page, and anywhere else that reads the workbook.
export function resolveTargetAccountCdm(record, cdmColumn) {
  if (!record) return '';
  const col = String(cdmColumn || '').trim();
  if (col && Object.prototype.hasOwnProperty.call(record, col)) {
    return String(record[col] || '').trim();
  }
  for (const key of Object.keys(record)) {
    const lower = String(key).toLowerCase();
    for (const kw of CDM_COLUMN_KEYWORDS) {
      if (lower.includes(kw.toLowerCase())) return String(record[key] || '').trim();
    }
  }
  return '';
}

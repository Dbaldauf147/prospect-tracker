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

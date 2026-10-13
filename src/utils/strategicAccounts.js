// Which rows of the Strategic Accounts list (Lists → Strategic Accounts)
// are this company, and who owns them. Feeds the warning strip at the top
// of the company modal so nobody prospects a strategic account without
// knowing whose it is.
//
// A row is this company when its Table View mapping points here, or, with
// no mapping at all, when its name normalises to exactly this company's.
// A row mapped to some other company, or dismissed on the list page, is
// left alone: somebody already decided it is not this one. Fuzzy matches
// are deliberately not flagged; a strategic account is a hard stop, and a
// false one on every "Capital" in the CRM would teach people to ignore it.
import { normalizeCompany, pickNameKey } from './companyNorm.js';
import { listMatchKey, mapsToCompany } from './listAccountMapping.js';

export const STRATEGIC_STORAGE_KEY = 'strategic-accounts-override';

// Headers that carry an owner: "Account Owner", "Owner(s)", "Strategic
// Account Owner 2", "Account Lead", "Account Manager".
const OWNER_HEADER = /owner|account\s*(lead|manager|director)/i;

function headersOf(rows) {
  const headers = [];
  const seen = new Set();
  for (const r of rows) for (const k of Object.keys(r || {})) {
    if (k === 'id' || k.startsWith('__') || seen.has(k)) continue;
    seen.add(k);
    headers.push(k);
  }
  return headers;
}

export function ownerHeaders(rows) {
  return headersOf(rows).filter(h => OWNER_HEADER.test(h));
}

// The company-name column, never an owner one ("Owner Name" would
// otherwise win pickNameKey's /name/ test).
export function strategicNameKey(rows) {
  const headers = headersOf(rows).filter(h => !OWNER_HEADER.test(h));
  return headers.length ? pickNameKey(headers) : '';
}

/** Owner names on one row, split on ; / , / newline / " and " / &, deduped. */
export function rowOwners(row, headers) {
  const out = [];
  const seen = new Set();
  for (const h of headers) {
    const raw = row?.[h];
    if (raw == null) continue;
    for (const part of String(raw).split(/\s*(?:[;,\n/&]|\band\b)\s*/i)) {
      const name = part.trim();
      if (!name || name === '-') continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

/**
 * Strategic Accounts rows that are `company`.
 * Returns [{ name, owners: string[], mapped: boolean }], deduped by name.
 */
export function strategicMatches(rows, company, mapping = {}, dismissed = {}) {
  const target = normalizeCompany(company);
  if (!target || !Array.isArray(rows) || rows.length === 0) return [];
  const nameKey = strategicNameKey(rows);
  if (!nameKey) return [];
  const owners = ownerHeaders(rows);
  const byKey = new Map();
  for (const row of rows) {
    const name = String(row?.[nameKey] || '').trim();
    const key = listMatchKey(name);
    if (!key) continue;
    const mappedTo = mapping[key] || '';
    let mapped = false;
    if (mappedTo) {
      if (!mapsToCompany(mappedTo, company)) continue;
      mapped = true;
    } else if (dismissed[key] || normalizeCompany(name) !== target) {
      continue;
    }
    const prev = byKey.get(key);
    const rowOwnerList = rowOwners(row, owners);
    if (prev) {
      for (const o of rowOwnerList) {
        if (!prev.owners.some(p => p.toLowerCase() === o.toLowerCase())) prev.owners.push(o);
      }
    } else {
      byKey.set(key, { name, owners: rowOwnerList, mapped });
    }
  }
  return [...byKey.values()];
}

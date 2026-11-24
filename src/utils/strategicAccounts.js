// Which rows of the Strategic Accounts list (Lists → Strategic Accounts)
// are this company, and who owns them. Feeds the warning strip at the top
// of the company modal so nobody prospects a strategic account without
// knowing whose it is.
//
// A row is this company when a mapping made on the list page points here
// (Table View, or the My Accounts / Portfolio Companies columns), or, with
// no mapping at all, when its name normalises to exactly this company's.
// A row mapped to some other company, or dismissed on the list page, is
// left alone: somebody already decided it is not this one. Fuzzy matches
// are deliberately not flagged; a strategic account is a hard stop, and a
// false one on every "Capital" in the CRM would teach people to ignore it.
import { normalizeCompany, pickNameKey } from './companyNorm.js';
import { listMatchKey } from './listAccountMapping.js';

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

// The column that says which kind of strategic account a row is: "Global
// Strategic Account" or "NAM Strategic Account". A header that is exactly
// "Type" wins over one that merely contains it; never the name column or
// an owner one.
export function strategicTypeKey(rows) {
  const nameKey = strategicNameKey(rows);
  const headers = headersOf(rows).filter(h => h !== nameKey && !OWNER_HEADER.test(h));
  return headers.find(h => /^type$/i.test(h.trim())) || headers.find(h => /type/i.test(h)) || '';
}

/** Whether a Type cell says NAM Strategic Account ("NAM ...", "North America ..."). */
export function isNamStrategicType(type) {
  return /\bNAM\b|north\s*america/i.test(String(type || ''));
}

/**
 * The list without its NAM Strategic Account rows, for My Accounts >
 * Strategic Accounts, which leaves those off. A row with no Type, or any
 * other Type, stays.
 */
export function withoutNamStrategicRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const typeKey = strategicTypeKey(rows);
  return typeKey ? rows.filter(r => !isNamStrategicType(r?.[typeKey])) : rows;
}

/** The distinct Types across a company's matches, in list order. */
export function strategicTypes(matches) {
  const out = [];
  for (const m of matches || []) for (const t of m.types || []) {
    if (!out.some(x => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
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
 * The list read once, for asking about many companies: returns
 * `company => [{ name, owners: string[], types: string[], mapped: boolean }]`,
 * deduped by name; `types` are the row's Type cells (Global or NAM
 * Strategic Account), empty when the list has no Type column. A row answers to the company its Table View mapping names, and to
 * any it is mapped to in `otherMappings` (the list page's My Accounts and
 * Portfolio Companies columns); with none of those, and unless dismissed,
 * to the one its own name normalises to.
 */
export function strategicLookup(rows, mapping = {}, dismissed = {}, otherMappings = []) {
  const none = () => [];
  if (!Array.isArray(rows) || rows.length === 0) return none;
  const nameKey = strategicNameKey(rows);
  if (!nameKey) return none;
  const owners = ownerHeaders(rows);
  const typeKey = strategicTypeKey(rows);
  // normalised company -> (row matchKey -> match), in list order.
  const byCompany = new Map();
  for (const row of rows) {
    const name = String(row?.[nameKey] || '').trim();
    const key = listMatchKey(name);
    if (!key) continue;
    const mappedTo = [mapping, ...otherMappings]
      .map(m => m?.[key])
      .filter(v => typeof v === 'string' && v.trim());
    if (!mappedTo.length && dismissed[key]) continue;
    const targets = new Set((mappedTo.length ? mappedTo : [name]).map(normalizeCompany).filter(Boolean));
    const rowOwnerList = rowOwners(row, owners);
    const rowType = typeKey ? String(row?.[typeKey] ?? '').trim() : '';
    for (const target of targets) {
      if (!byCompany.has(target)) byCompany.set(target, new Map());
      const byKey = byCompany.get(target);
      const prev = byKey.get(key);
      if (prev) {
        for (const o of rowOwnerList) {
          if (!prev.owners.some(p => p.toLowerCase() === o.toLowerCase())) prev.owners.push(o);
        }
        if (rowType && !prev.types.some(t => t.toLowerCase() === rowType.toLowerCase())) prev.types.push(rowType);
      } else {
        byKey.set(key, { name, owners: [...rowOwnerList], types: rowType ? [rowType] : [], mapped: mappedTo.length > 0 });
      }
    }
  }
  return (company) => {
    const found = byCompany.get(normalizeCompany(company));
    return found ? [...found.values()] : [];
  };
}

/**
 * Strategic Accounts rows that are `company`.
 * Returns [{ name, owners: string[], types: string[], mapped: boolean }],
 * deduped by name.
 */
export function strategicMatches(rows, company, mapping = {}, dismissed = {}, otherMappings = []) {
  return strategicLookup(rows, mapping, dismissed, otherMappings)(company);
}

// Tier 1 on its own does not put an account on the subtab. A Tier 1 account
// the Strategic Accounts list names (Brookfield, say) is still here, as a
// listed company.
const STRATEGIC_TIERS = new Set(['Tier 2']);
export const ON_STRATEGIC_LIST = 'Strategic Accounts list';

/**
 * My Accounts > Strategic Accounts: every Tier 2 account on My Accounts,
 * plus every tracker company this CDM is on that the Strategic Accounts
 * list names (whether or not My Accounts carries it, and whatever its
 * tier). A Tier 1 account is here only when the list names it. The
 * subtab passes a `lookup` built without the list's NAM Strategic Account
 * rows (withoutNamStrategicRows), so those do not count as being listed.
 *
 * `accounts` are My Accounts rows (myTier / tierLabel set), `prospects` the
 * tracker records, `lookup` a strategicLookup, `isCdm` whether a CDM cell is
 * this CDM. Returns [{ id, company, tier, reasons, listNames, owners,
 * status, type, cdm, record }] A to Z, where `reasons` says why the row is
 * here and `record` is the tracker record to open ('' fields when none).
 */
export function strategicAccountRows({ accounts = [], prospects = [], lookup, isCdm }) {
  const byId = new Map(prospects.map(p => [p.id, p]));
  const out = new Map();
  const add = (source, tier, reason) => {
    const id = source.id || source.company;
    if (!id) return;
    let row = out.get(id);
    if (!row) {
      const matches = lookup ? lookup(source.company) : [];
      const owners = [];
      for (const m of matches) for (const o of m.owners) {
        if (!owners.some(x => x.toLowerCase() === o.toLowerCase())) owners.push(o);
      }
      row = {
        id,
        company: source.company || '',
        tier: tier || '',
        reasons: [],
        listNames: matches.map(m => m.name),
        owners,
        status: source.status || '',
        type: source.type || '',
        cdm: source.cdm || '',
        record: byId.get(source.id) || null,
        targetNames: Array.isArray(source.targetNames) ? source.targetNames : [],
      };
      out.set(id, row);
    }
    if (!row.reasons.includes(reason)) row.reasons.push(reason);
  };
  for (const a of accounts) {
    if (STRATEGIC_TIERS.has(a.myTier)) add(a, a.tierLabel || a.myTier, a.myTier);
  }
  const accountById = new Map(accounts.map(a => [a.id, a]));
  for (const p of prospects) {
    if (!p?.company || !isCdm?.(p.cdm)) continue;
    if (!lookup || lookup(p.company).length === 0) continue;
    const account = accountById.get(p.id);
    add(account || p, account ? (account.tierLabel || account.myTier) : String(p.tier || '').trim(), ON_STRATEGIC_LIST);
  }
  return [...out.values()].sort((a, b) => a.company.localeCompare(b.company));
}

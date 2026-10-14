// The "this list row is that company" mappings the Lists panels keep:
// settings.listMappings[storageKey].mapping as { [matchKey]: companyName }
// and .dismissed as { [matchKey]: true }, with a per-user localStorage copy
// from before they synced. A row's matchKey is its normalised name
// (`name::<normalizeCompany(name)>`), so a re-upload that reorders the rows
// keeps every mapping.
//
// Shared by the "Search lists..." panel and the RA Client warning in the
// company modal, so a client mapped from either one reads as mapped in
// both.
import { normalizeCompany } from './companyNorm.js';
import { userLsGet, userLsSet, userLsRemove } from './userLs.js';
import { companiesMatch } from './listFlags.js';
import { parenAliases } from './companyIndex.js';

// RA Clients has no uploaded-list storage key of its own; this is the one
// its mappings live under.
export const RA_CLIENTS_MAP_KEY = 'ra-clients-account-map';

export function listMatchKey(name) {
  const norm = normalizeCompany(name);
  return norm ? `name::${norm}` : '';
}

// The uploaded-list pages (Lists → SBT, CA SB, ...) keep a row's mapping
// in one of three fields, one per column it was mapped from:
//   mapping           Table View
//   myAccountMapping  My Accounts
//   portfolioMapping  Portfolio Companies
// Each has its own localStorage mirror under these suffixes.
const LS_SUFFIX = {
  mapping: 'account-mapping',
  dismissed: 'account-dismissed',
  myAccountMapping: 'my-accounts-mapping',
  portfolioMapping: 'portfolio-mapping',
};
export const MAPPING_FIELDS = ['mapping', 'myAccountMapping', 'portfolioMapping'];

function lsKeyFor(storageKey, field) {
  return `${storageKey}:${LS_SUFFIX[field] || field}`;
}

function loadLocal(key) {
  try {
    const raw = userLsGet(key);
    return raw ? (JSON.parse(raw) || {}) : {};
  } catch { return {}; }
}

/** One field ('mapping' | 'dismissed' | 'myAccountMapping' | 'portfolioMapping') of a list's mappings: the synced copy, else the local one. */
export function readListField(settings, storageKey, field) {
  const remote = settings?.listMappings?.[storageKey]?.[field];
  if (remote && typeof remote === 'object') return remote;
  return loadLocal(lsKeyFor(storageKey, field));
}

/** Rewrite one field through `mutate(copy) => next`, locally and to synced settings. */
export function writeListField(settings, updateSettingsPath, storageKey, field, mutate) {
  const next = mutate({ ...readListField(settings, storageKey, field) });
  const lsKey = lsKeyFor(storageKey, field);
  try {
    if (Object.keys(next).length === 0) userLsRemove(lsKey);
    else userLsSet(lsKey, JSON.stringify(next));
  } catch { /* the synced copy still lands */ }
  updateSettingsPath?.({ [`listMappings.${storageKey}.${field}`]: next });
  return next;
}

/** Map a list row to a company, clearing any earlier dismissal of it. */
export function mapListRow(settings, updateSettingsPath, storageKey, matchKey, company) {
  writeListField(settings, updateSettingsPath, storageKey, 'mapping', (m) => { m[matchKey] = company; return m; });
  writeListField(settings, updateSettingsPath, storageKey, 'dismissed', (d) => { delete d[matchKey]; return d; });
}

/**
 * Unmap a list row. With `company`, from every field that maps it to that
 * company (it may have been mapped from the My Accounts or Portfolio
 * column rather than Table View); without, the Table View mapping only.
 */
export function unmapListRow(settings, updateSettingsPath, storageKey, matchKey, company) {
  const fields = company
    ? MAPPING_FIELDS.filter(f => fieldMapsToCompany(f, readListField(settings, storageKey, f)[matchKey], company))
    : ['mapping'];
  for (const f of fields) {
    writeListField(settings, updateSettingsPath, storageKey, f, (m) => { delete m[matchKey]; return m; });
  }
}

/**
 * unmapListRow for several rows at once. One write per field, because each
 * write starts from `settings` as passed and calling unmapListRow in a loop
 * would have every later write restore the rows the earlier ones removed.
 */
export function unmapListRows(settings, updateSettingsPath, storageKey, matchKeys, company) {
  const fields = company ? MAPPING_FIELDS : ['mapping'];
  for (const f of fields) {
    const current = readListField(settings, storageKey, f);
    const keys = matchKeys.filter(k => !company || fieldMapsToCompany(f, current[k], company));
    if (keys.length === 0) continue;
    writeListField(settings, updateSettingsPath, storageKey, f, (m) => { for (const k of keys) delete m[k]; return m; });
  }
}

/** Whether `mappedTo` (a mapping's value) names `company`. */
export function mapsToCompany(mappedTo, company) {
  const a = normalizeCompany(mappedTo);
  return !!a && a === normalizeCompany(company);
}

/**
 * Whether a value in one of the MAPPING_FIELDS names `company`. Table View
 * mappings hold the card's own name, so they compare exactly. My Accounts
 * and Portfolio ones compare the way the List Flags column reads them
 * (listFlags.computeListFlags), so a row that flags a company there also
 * reads as mapped to it here.
 */
export function fieldMapsToCompany(field, mappedTo, company) {
  if (typeof mappedTo !== 'string' || !mappedTo) return false;
  if (mapsToCompany(mappedTo, company)) return true;
  if (field !== 'mapping' && companiesMatch(company, mappedTo)) return true;
  // A one-word bracket is the company's own short name: a row mapped to
  // "Jones Lang LaSalle (JLL)" is mapped to a card called "JLL", and the
  // other way round.
  return isAliasOf(mappedTo, company) || isAliasOf(company, mappedTo);
}

function isAliasOf(full, short) {
  const s = normalizeCompany(short);
  return !!s && !s.includes(' ') && parenAliases(full).includes(s);
}

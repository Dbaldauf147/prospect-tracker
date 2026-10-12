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

// RA Clients has no uploaded-list storage key of its own; this is the one
// its mappings live under.
export const RA_CLIENTS_MAP_KEY = 'ra-clients-account-map';

export function listMatchKey(name) {
  const norm = normalizeCompany(name);
  return norm ? `name::${norm}` : '';
}

function lsKeyFor(storageKey, field) {
  return `${storageKey}:${field === 'mapping' ? 'account-mapping' : 'account-dismissed'}`;
}

function loadLocal(key) {
  try {
    const raw = userLsGet(key);
    return raw ? (JSON.parse(raw) || {}) : {};
  } catch { return {}; }
}

/** One field ('mapping' | 'dismissed') of a list's mappings: the synced copy, else the local one. */
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

export function unmapListRow(settings, updateSettingsPath, storageKey, matchKey) {
  writeListField(settings, updateSettingsPath, storageKey, 'mapping', (m) => { delete m[matchKey]; return m; });
}

/** Whether `mappedTo` (a mapping's value) names `company`. */
export function mapsToCompany(mappedTo, company) {
  const a = normalizeCompany(mappedTo);
  return !!a && a === normalizeCompany(company);
}

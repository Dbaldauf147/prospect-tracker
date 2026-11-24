// The statuses a service can be set to on the company card (Services tab,
// the box popups, the org chart's service chips). They started as the fixed
// SERVICE_STATUSES list; they are now an editable list saved with the other
// dropdown lists (settings.dropdownLists.serviceStatuses), so a status can be
// added, renamed, reordered or removed from the company popup or from the
// Dropdowns page.
//
// Four statuses are locked: the app's logic reads them by name ("-" is "no
// manual status, use the automatic one", and Sold / Not Sold / N/A are what
// the reports and the % explored count roll up). They can be moved but not
// renamed or removed, and are put back if a saved list lacks them.
//
// Imported with extensions so this loads under plain Node for the tests.
import { SERVICE_STATUSES } from '../data/enums.js';

export const SERVICE_STATUS_LIST_KEY = 'serviceStatuses';
export const LOCKED_SERVICE_STATUSES = ['-', 'Sold', 'Not Sold', 'N/A'];

const lockedKey = new Map(LOCKED_SERVICE_STATUSES.map(s => [s.toLowerCase(), s]));
export const isLockedServiceStatus = s => lockedKey.has(String(s || '').trim().toLowerCase());

/**
 * `list` tidied into a usable status list: trimmed, blanks and repeats
 * (ignoring case) dropped, the locked statuses spelled as the app reads them,
 * "-" first, and any locked status that is missing added at the end.
 */
export function cleanServiceStatusList(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    let s = String(raw ?? '').trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    if (lockedKey.has(k)) s = lockedKey.get(k);
    out.push(s);
  }
  for (const s of LOCKED_SERVICE_STATUSES) if (!seen.has(s.toLowerCase())) out.push(s);
  return ['-', ...out.filter(s => s !== '-')];
}

/** The statuses to offer, in order: the saved list, else the built-in one. */
export function serviceStatusOptions(settings) {
  const saved = settings?.dropdownLists?.[SERVICE_STATUS_LIST_KEY];
  return cleanServiceStatusList(Array.isArray(saved) ? saved : SERVICE_STATUSES);
}

/** The settings patch that saves `list` as the service statuses. */
export function serviceStatusesPatch(settings, list) {
  return { dropdownLists: { ...(settings?.dropdownLists || {}), [SERVICE_STATUS_LIST_KEY]: cleanServiceStatusList(list) } };
}

// The value a status <select> uses for its "Edit statuses..." entry. Not a
// status anybody can save: onChange catches it and opens the editor instead.
export const EDIT_SERVICE_STATUSES = '__edit-service-statuses__';

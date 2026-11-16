// The contact popup's Job Description (settings.contactJobDescriptions,
// keyed by HubSpot contact id): a job description pasted in by hand, or
// JOB_DESCRIPTION_NA when the user has marked that there isn't one to find.
// Local-only, HubSpot has no field for it.
//
// One writer, a function of the settings as they are when the save runs
// (see utils/contactConnected.js for why not a copy of the map), so a save
// from a popup opened before another contact's save can't undo that one.

export const JOB_DESCRIPTION_NA = 'N/A';

/** The stored description (or JOB_DESCRIPTION_NA) for a contact, '' if none. */
export function jobDescriptionFor(map, contactId) {
  if (!map || typeof map !== 'object' || contactId == null) return '';
  const v = map[String(contactId)];
  return typeof v === 'string' ? v : '';
}

/** The updateSettings() function that sets (or, blank, clears) one contact's description. */
export function jobDescriptionUpdate(contactId, value) {
  return (settings) => {
    const id = String(contactId ?? '').trim();
    if (!id) return null;
    const cur = settings?.contactJobDescriptions;
    const map = (cur && typeof cur === 'object' && !Array.isArray(cur)) ? cur : {};
    const text = typeof value === 'string' && value.trim() ? value : '';
    if ((map[id] || '') === text) return null;
    const next = { ...map };
    if (text) next[id] = text; else delete next[id];
    return { contactJobDescriptions: next };
  };
}

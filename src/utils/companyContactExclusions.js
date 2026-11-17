// settings.companyContactExclusions: { [company name, lowercased]: [contact
// id, ...] }, the people taken off one company's contact list (the ⊘ on
// its Contacts tab) without touching HubSpot.

/**
 * An updateSettings() function that puts contact `id` back on the company
 * keyed `companyKey`, computed from the settings as they are when it runs.
 * A company left with nobody removed drops out of the map. Returns null
 * (no write) when the contact wasn't removed there.
 */
export function companyContactRestoreUpdate(companyKey, id) {
  return (settings) => {
    const key = String(companyKey || '').trim().toLowerCase();
    const cid = String(id ?? '').trim();
    const cur = settings?.companyContactExclusions;
    if (!key || !cid || !cur || typeof cur !== 'object') return null;
    const list = Array.isArray(cur[key]) ? cur[key].map(String) : [];
    if (!list.includes(cid)) return null;
    const nextList = list.filter(x => x !== cid);
    const next = { ...cur };
    if (nextList.length) next[key] = nextList; else delete next[key];
    return { companyContactExclusions: next };
  };
}

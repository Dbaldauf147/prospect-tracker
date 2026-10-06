// The per-contact Company pin, in one place.
//
// A typed Company name can't live in HubSpot alone. The sync rewrites
// every contact's `company` text from the name of the Company record it
// is associated with (see api/hubspot.js getAllContacts), so a name the
// user typed here is gone on the next refresh unless HubSpot's own
// record ended up carrying it — and it often doesn't: the rename needs
// permission the token may not have, a contact with no association gets
// linked to whatever record HubSpot matched, and either way the write
// races the sync.
//
// So the typed value is also pinned locally, as `_companyOverride` in
// settings.contactLocalFields keyed by HubSpot contact id. App.jsx and
// every contact page merge that pin over the synced text, which is what
// makes the edit stick. Every path that saves a Company — the inline
// cell on the contacts table, the Edit HubSpot Contact popup wherever
// it opens — has to write this pin, or the same edit sticks from one
// place and evaporates from another.

/**
 * The next `contactLocalFields` map with this contact's Company pin set
 * (a non-empty name) or cleared (null / '' / whitespace).
 *
 * Returns null when nothing would change — no contact id, or the pin is
 * already exactly this — so callers can skip a settings write rather
 * than churn Firestore on every save.
 */
export function withCompanyOverride(localFields, contactId, value) {
  const id = String(contactId ?? '').trim();
  if (!id) return null;
  const cur = (localFields && typeof localFields === 'object' && !Array.isArray(localFields)) ? localFields : {};
  const merged = { ...(cur[id] || {}) };
  const next = String(value ?? '').trim();
  if (next) {
    if (merged._companyOverride === next) return null;
    merged._companyOverride = next;
  } else {
    if (merged._companyOverride === undefined) return null;
    delete merged._companyOverride;
  }
  const out = { ...cur };
  // A contact whose only local field was the pin drops out of the map
  // entirely rather than leaving an empty object behind.
  if (Object.keys(merged).length === 0) delete out[id];
  else out[id] = merged;
  return out;
}

// The pin as an updateSettings() function, so it is computed from the
// settings as they are WHEN the save runs, not as the caller last
// rendered them.
//
// This is why mapped companies kept un-mapping themselves. Every writer
// used to hand updateSettings a whole contactLocalFields map built from
// its render-time copy, and the inline Company cell builds it only after
// waiting on HubSpot for a few seconds. Map contact A, then contact B
// before A's save has landed and re-rendered: B's map was copied from
// before A, so writing it erased A's pin. Nothing looked wrong until
// the next HubSpot refresh put A's old company name back, which is when
// the row went amber again. Built here, from the latest settings, each
// pin only touches its own contact.
export function companyOverrideUpdate(contactId, value) {
  return (settings) => {
    const next = withCompanyOverride(settings?.contactLocalFields, contactId, value);
    return next ? { contactLocalFields: next } : null;
  };
}

// Any other edit to one contact's local fields, the same way. `edit`
// gets a copy of that contact's entry to change in place; an entry left
// empty is dropped from the map.
export function contactLocalFieldsUpdate(contactId, edit) {
  return (settings) => {
    const id = String(contactId ?? '').trim();
    if (!id) return null;
    const cur = settings?.contactLocalFields;
    const map = (cur && typeof cur === 'object' && !Array.isArray(cur)) ? cur : {};
    const entry = { ...(map[id] || {}) };
    edit(entry);
    const out = { ...map };
    if (Object.keys(entry).length === 0) delete out[id];
    else out[id] = entry;
    return { contactLocalFields: out };
  };
}

// Pin the same Company on several contacts in one save.
export function companyOverridesUpdate(contactIds, value) {
  return (settings) => {
    let map = settings?.contactLocalFields;
    let changed = false;
    for (const id of contactIds) {
      const next = withCompanyOverride(map, id, value);
      if (next) { map = next; changed = true; }
    }
    return changed ? { contactLocalFields: map } : null;
  };
}

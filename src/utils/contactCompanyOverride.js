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

// Pin a different Company on each of several contacts in one save:
// `pins` maps contact id -> name. Gap Fill uses it for a run of fills.
export function companyOverridesByIdUpdate(pins) {
  return (settings) => {
    let map = settings?.contactLocalFields;
    let changed = false;
    for (const [id, value] of Object.entries(pins || {})) {
      const next = withCompanyOverride(map, id, value);
      if (next) { map = next; changed = true; }
    }
    return changed ? { contactLocalFields: map } : null;
  };
}

/**
 * The Company to show for one contact: its pin when it has one, else the
 * synced `company`. The Edit HubSpot Contact popup opens on this, because
 * several pages hand it the raw synced record, and without the pin the
 * popup showed HubSpot's name again right after a pick had been saved.
 */
export function companyWithPin(contact, localFields) {
  const pin = localFields?.[String(contact?.id ?? contact?.vid ?? '')]?._companyOverride;
  return (typeof pin === 'string' && pin.trim()) ? pin : String(contact?.company || '');
}

/**
 * `contacts` with each one's Company pin laid over the synced `company`,
 * the way App.jsx and the contact pages read them. A list with no pins
 * comes back as it is.
 */
export function withCompanyPins(contacts, localFields) {
  const lf = (localFields && typeof localFields === 'object') ? localFields : null;
  if (!lf || !Array.isArray(contacts)) return contacts;
  let touched = false;
  const out = contacts.map((c) => {
    const pin = lf[String(c?.id ?? c?.vid ?? '')]?._companyOverride;
    if (typeof pin !== 'string' || !pin.trim() || pin === c.company) return c;
    touched = true;
    return { ...c, company: pin };
  });
  return touched ? out : contacts;
}

/**
 * `contacts` with each one's whole settings.contactLocalFields entry laid
 * over it, the pin as its `company`: exactly what App.jsx hands every page
 * as its HubSpot contacts. A screen that reads the IndexedDB cache itself
 * (My Accounts) has to do this too, or it sees the raw sync, and a contact
 * pinned to the account (or carrying a field saved only locally) drops off
 * it. A list with nothing local comes back as it is.
 */
export function withContactLocalFields(contacts, localFields) {
  const lf = (localFields && typeof localFields === 'object' && !Array.isArray(localFields)) ? localFields : null;
  if (!lf || !Array.isArray(contacts) || Object.keys(lf).length === 0) return contacts;
  return contacts.map((c) => {
    const f = lf[String(c?.id ?? c?.vid ?? '')];
    if (!f) return c;
    const out = { ...c, ...f };
    if (typeof f._companyOverride === 'string' && f._companyOverride) out.company = f._companyOverride;
    return out;
  });
}

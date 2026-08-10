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

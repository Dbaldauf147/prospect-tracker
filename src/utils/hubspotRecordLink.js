// Links to a contact's own record in HubSpot.
//
// The portal id and the web address it lives at (app.hubspot.com, or a
// regional one such as app-na2.hubspot.com) come from HubSpot itself via
// /api/hubspot?action=account, read once per page load. Nothing is written
// into the app, so if the token moves to another portal the links follow.
//
// apiFetch is imported on first use, not at the top: it pulls in Firebase,
// and the URL builder has to load under plain Node for its test.

/** The record URL for a contact, or '' without the portal or an id. */
export function hubspotContactUrl(account, contactId) {
  const portalId = String(account?.portalId || '').trim();
  const id = String(contactId || '').trim();
  if (!portalId || !/^\d+$/.test(id)) return '';
  const domain = String(account?.uiDomain || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '') || 'app.hubspot.com';
  return `https://${domain}/contacts/${portalId}/record/0-1/${id}`;
}

let pending = null;

/** { portalId, uiDomain }, or null when it can't be read (links then stay off). */
export function loadHubspotAccount() {
  if (!pending) {
    pending = import('./apiFetch')
      .then(({ apiFetch }) => apiFetch('/api/hubspot?action=account'))
      .then(r => (r.ok ? r.json() : null))
      .then(d => (d?.portalId ? d : null))
      .catch(() => null)
      .then((d) => {
        // A failed read is asked again next time, not cached for good.
        if (!d) pending = null;
        return d;
      });
  }
  return pending;
}

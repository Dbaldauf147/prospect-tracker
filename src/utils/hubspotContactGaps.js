// Hubspot Mapping > Gap Fill: the contacts in the HubSpot contacts export
// (the Contacts subtab, utils/hubspotContacts.js) set against the contacts
// the app holds (the HubSpot contacts cache, utils/hubspotContactsCache.js,
// whose records carry HubSpot's own property names: firstname, jobtitle,
// mobilephone, hs_linkedin_url...).
//
// Only contacts with an email are looked at, and matched on it. Two kinds
// of row come out:
//
//   * Not in the app: nobody in the app has this email, not even as an old
//     email recorded on a contact (settings.contactOldEmails).
//   * Missing data:   the app has the contact, but the export has something
//     the app's record is blank on (phone, LinkedIn, job title, a name or
//     the company). Each such field is listed, so the export can fill it.
//
// A contact the app already has in full is left out: this page is the work
// list, not the roster.
//
// Pure: runs under plain Node in scripts/hubspotContactGaps.test.mjs.

export const GAP = { notInApp: 'Not in the app', missingData: 'Missing data' };

const s = (v) => String(v ?? '').trim();
const lower = (v) => s(v).toLowerCase();
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// The app record's value for each field, in whichever spelling it has.
export const appLinkedIn = (c) => s(c?.hs_linkedin_url || c?.linkedin_url || c?.hs_linkedinid);
export const appPhone = (c) => s(c?.phone || c?.mobilephone || c?.mobile_phone);

// The fields this page can fill: what the export calls it, what the app's
// record holds it under, and its label.
export const GAP_FIELDS = [
  { key: 'phone', label: 'Phone', has: (e) => s(e.phone), appHas: appPhone },
  { key: 'linkedIn', label: 'LinkedIn', has: (e) => s(e.linkedIn), appHas: appLinkedIn },
  { key: 'jobTitle', label: 'Job title', has: (e) => s(e.jobTitle), appHas: (c) => s(c?.jobtitle) },
  { key: 'firstName', label: 'First name', has: (e) => s(e.firstName), appHas: (c) => s(c?.firstname) },
  { key: 'lastName', label: 'Last name', has: (e) => s(e.lastName), appHas: (c) => s(c?.lastname) },
  { key: 'companyName', label: 'Company', has: (e) => s(e.companyName), appHas: (c) => s(c?.company) },
];

/**
 * The app's contacts by email: each contact's own email, and any old
 * emails recorded against it (settings.contactOldEmails, a free-text list
 * per contact id).
 */
export function appContactsByEmail(appContacts = [], oldEmails = {}) {
  const byEmail = new Map();
  const byId = new Map();
  for (const c of appContacts || []) {
    if (!c) continue;
    const e = lower(c.email);
    if (e && !byEmail.has(e)) byEmail.set(e, c);
    const id = s(c.id || c.vid);
    if (id) byId.set(id, c);
  }
  for (const [id, text] of Object.entries(oldEmails || {})) {
    const c = byId.get(s(id));
    if (!c) continue;
    for (const e of String(text || '').toLowerCase().split(/[\s,;]+/)) {
      if (emailOk(e) && !byEmail.has(e)) byEmail.set(e, c);
    }
  }
  return byEmail;
}

/**
 * The export's contacts that are a gap, as rows: the export contact's own
 * fields plus `gap` (GAP.*), `fill` (the GAP_FIELDS keys the export can
 * fill), `fillLabels`, and `app` (the app's record, when there is one).
 * One row per email; a contact with no email is skipped.
 */
export function contactGapRows(exportRows = [], byEmail = new Map()) {
  const out = [];
  const seen = new Set();
  for (const r of exportRows || []) {
    const emails = [lower(r?.email), lower(r?.workEmail)].filter(emailOk);
    if (!emails.length) continue;
    const key = emails[0];
    if (seen.has(key)) continue;
    seen.add(key);
    const app = emails.map(e => byEmail.get(e)).find(Boolean) || null;
    if (!app) {
      out.push({ ...r, gapEmail: key, gap: GAP.notInApp, fill: [], fillLabels: '', app: null });
      continue;
    }
    const fill = GAP_FIELDS.filter(f => f.has(r) && !f.appHas(app)).map(f => f.key);
    if (!fill.length) continue;
    out.push({
      ...r, gapEmail: key, gap: GAP.missingData, fill,
      fillLabels: fill.map(k => GAP_FIELDS.find(f => f.key === k).label).join(', '),
      app,
    });
  }
  return out;
}

/** The app's name for a contact record, for the "In the app as" column. */
export function appContactName(c) {
  return [s(c?.firstname), s(c?.lastname)].filter(Boolean).join(' ') || s(c?.email);
}

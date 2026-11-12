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

import { reportingStatus } from './reportingStatus.js';
import { DMS_HIDDEN_ACCOUNT_STATUSES, accountStatusOf } from './tieredAccountActivity.js';

export const GAP = { notInApp: 'Not in the app', missingData: 'Missing data' };

// Accounts out of active rotation, as on the rest of My Accounts.
export const GAP_FILL_INACTIVE = new Set(['Old Client', 'Hold Off', 'Lost - Not Sold']);

/**
 * Why Add / Fill is off for a row, '' when it's on. They only work on a
 * contact of an active My Accounts company: one the row maps to, whose
 * reported status (a substatus reads as Hold Off) isn't Old Client, Hold
 * Off or Lost - Not Sold. `substatusOf(account)` supplies the substatus
 * when it lives on the tracker record rather than the account row.
 */
export function gapFillBlocked(row, substatusOf = (a) => a?.substatus) {
  const a = row?.account;
  if (!a) return 'Not one of your My Accounts companies';
  const status = reportingStatus({ ...a, substatus: String(substatusOf(a) || '').trim() });
  return GAP_FILL_INACTIVE.has(status) ? `${a.company} is ${status}` : '';
}

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

// The app's (HubSpot) property each GAP_FIELDS key is written to.
export const GAP_PROPERTY = {
  phone: 'phone',
  linkedIn: 'hs_linkedin_url',
  jobTitle: 'jobtitle',
  firstName: 'firstname',
  lastName: 'lastname',
  companyName: 'company',
};

/**
 * What Gap Fill sends for a row, or null when there is nothing to do:
 *
 *   * Not in the app: { kind: 'add', properties } for create-contact. The
 *     company is the My Accounts company the row maps to (so the contact
 *     lands on that company's popup), else HubSpot's company name.
 *   * Missing data:   { kind: 'fill', contactId, properties } for
 *     update-contact, with only the fields blank on the app's contact
 *     (row.fill). A blank company is filled the same way as on add.
 */
export function gapFillPlan(row) {
  if (!row || !row.gapEmail) return null;
  const company = s(row.account?.company) || s(row.companyName);
  const valueOf = (key) => (key === 'companyName' ? company : s(GAP_FIELDS.find(f => f.key === key)?.has(row)));
  if (row.gap === GAP.notInApp) {
    const properties = { email: row.gapEmail };
    for (const f of GAP_FIELDS) {
      const v = valueOf(f.key);
      if (v) properties[GAP_PROPERTY[f.key]] = v;
    }
    return { kind: 'add', properties };
  }
  if (row.gap === GAP.missingData && row.app) {
    const contactId = s(row.app.id || row.app.vid);
    if (!contactId || String(contactId).startsWith('local-')) return null;
    const properties = {};
    for (const key of row.fill || []) {
      const v = valueOf(key);
      if (v) properties[GAP_PROPERTY[key]] = v;
    }
    return Object.keys(properties).length ? { kind: 'fill', contactId, properties } : null;
  }
  return null;
}

// Accounts nobody is working: Gap Fill leaves their contacts off, as DMs
// Without Activity does. A company with a Substatus counts as Hold Off.
export const GAP_FILL_HIDDEN_STATUSES = DMS_HIDDEN_ACCOUNT_STATUSES;

/**
 * `rows` without the ones whose My Account is Hold Off, Lost - Not Sold or
 * Old Client. The live prospect in `byId` is read over the row's copy, so
 * a status changed in the tracker takes effect at once. Rows with no
 * account are kept.
 *
 * Returns { rows, hidden } (hidden: how many were left out).
 */
export function withoutInactiveAccounts(rows = [], byId = null) {
  const hide = new Set(GAP_FILL_HIDDEN_STATUSES);
  const kept = (rows || []).filter(r => {
    if (!r?.account) return true;
    const p = byId?.get?.(r.account.id) || r.account;
    return !hide.has(accountStatusOf(p));
  });
  return { rows: kept, hidden: (rows || []).length - kept.length };
}

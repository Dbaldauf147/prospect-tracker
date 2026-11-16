// The contact fields a table can add as a column: the Edit HubSpot Contact
// popup's fields, the HubSpot ones and the ones the app keeps itself (Team
// Name, Goes By, Partner's / Kids' names, Old Company, Notes, ...), each
// read the way that popup reads it. Draft Emails > Variable Coverage's
// "+ Add column" offers them, so any of them can be checked across the
// recipients next to the variables the draft uses.
//
// `get(raw, ctx)` takes the raw HubSpot record and { settings } and returns
// the text to show ('' when blank).
import { applyCompanyOverride } from './contactRosters.js';
import { sentimentFor } from './contactSentiment.js';
import { leadSourceFor } from './contactLeadSource.js';
import { metInPersonState, MET_STATE_OPTIONS } from './metInPerson.js';

const s = (v) => String(v ?? '').trim();
const idOf = (raw) => String(raw?.id ?? raw?.vid ?? '');
const byId = (ctx, key, raw) => s(ctx?.settings?.[key]?.[idOf(raw)]);

export const CONTACT_FIELD_COLUMNS = [
  { key: 'firstname', label: 'First Name', get: (r) => s(r?.firstname) },
  { key: 'lastname', label: 'Last Name', get: (r) => s(r?.lastname) },
  { key: 'goesBy', label: 'Goes By', get: (r, ctx) => byId(ctx, 'contactNicknames', r) },
  { key: 'jobtitle', label: 'Job Title', get: (r) => s(r?.jobtitle) },
  { key: 'company', label: 'Company', get: (r, ctx) => s(applyCompanyOverride(r, ctx?.settings?.contactLocalFields).company) },
  { key: 'teamName', label: 'Team Name', get: (r, ctx) => byId(ctx, 'contactTeamNames', r) },
  { key: 'email', label: 'Email', get: (r) => s(r?.email) },
  { key: 'phone', label: 'Work Phone Number', get: (r) => s(r?.phone) },
  { key: 'mobilephone', label: 'Cell Phone Number', get: (r) => s(r?.mobilephone || r?.mobile_phone) },
  { key: 'city', label: 'City', get: (r) => s(r?.city) },
  { key: 'state', label: 'State', get: (r) => s(r?.state) },
  { key: 'country', label: 'Country', get: (r) => s(r?.country) },
  { key: 'linkedin', label: 'LinkedIn URL', get: (r) => s(r?.hs_linkedin_url || r?.linkedin_url) },
  { key: 'tags', label: 'Tags', get: (r) => s(r?.dans_tags || r?.dan_s_tags || r?.dans_tag).split(';').map(t => t.trim()).filter(Boolean).join(', ') },
  { key: 'partner', label: "Partner's Name", get: (r, ctx) => s(ctx?.settings?.contactFamilies?.[idOf(r)]?.partner) },
  { key: 'kids', label: "Kids' Names", get: (r, ctx) => s(ctx?.settings?.contactFamilies?.[idOf(r)]?.kids) },
  { key: 'oldCompany', label: 'Old Company', get: (r, ctx) => byId(ctx, 'contactOldCompany', r) },
  { key: 'oldEmails', label: 'Old Emails', get: (r, ctx) => byId(ctx, 'contactOldEmails', r) },
  { key: 'notes', label: 'Notes', get: (r, ctx) => byId(ctx, 'contactNotes', r) },
  { key: 'leadSource', label: 'Lead Source', get: (r, ctx) => s(leadSourceFor(ctx?.settings?.contactLeadSource, idOf(r))) },
  {
    key: 'standing', label: 'Standing',
    get: (r, ctx) => ({ champion: 'Champion', detractor: 'Detractor' })[sentimentFor(ctx?.settings?.contactSentiment, idOf(r))] || 'Neutral',
  },
  {
    key: 'metInPerson', label: 'Met In Person',
    get: (r, ctx) => MET_STATE_OPTIONS.find(o => o.value === metInPersonState(r, ctx?.settings?.contactMetInPerson))?.label || '',
  },
  { key: 'invitedToLouisville', label: 'Invited to Louisville', get: (r, ctx) => (ctx?.settings?.contactInvitedToLouisville?.[idOf(r)] ? 'Yes' : 'No') },
  { key: 'connected', label: 'Connected?', get: (r, ctx) => (ctx?.settings?.contactConnected?.[idOf(r)] ? 'Yes' : 'No') },
];

const BY_KEY = new Map(CONTACT_FIELD_COLUMNS.map(f => [f.key, f]));

/** The field for a key, or null. */
export function contactFieldColumn(key) {
  return BY_KEY.get(String(key || '')) || null;
}

/** A saved list of field keys, cleaned: known keys only, each once. */
export function cleanFieldColumnKeys(keys) {
  const out = [];
  for (const k of Array.isArray(keys) ? keys : []) {
    if (BY_KEY.has(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

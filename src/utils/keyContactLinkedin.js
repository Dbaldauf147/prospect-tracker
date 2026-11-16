// Issues: a Key Contact (HubSpot contact tagged "Dan Key Target", not hidden
// or left, the Job Descriptions agent's rule) with no LinkedIn URL. The agent
// lists them as "No LinkedIn URL" and leaves them out of its prompt, so their
// Job Description can't be filled until the URL is added.
//
// The Resolve popup saves the URL to the contact in HubSpot, or records that
// the person has no LinkedIn profile at all: settings.keyContactNoLinkedin
// = { [contactId]: ISO date }, which clears the row for good.
//
// Pure: scripts/keyContactLinkedin.test.mjs runs it under plain Node.
import { isKeyContact, linkedinUrlOf } from './jobDescriptionAgent.js';
import { findProspectByCompany } from './companyLookup.js';

export const KEY_CONTACT_NO_LINKEDIN_KEY = 'keyContactNoLinkedin';
export const KEY_CONTACT_LINKEDIN_ISSUE = 'Key Contact has no LinkedIn URL';

const contactIdOf = (c) => String(c?.id || c?.vid || '').trim();

/**
 * One issue row per Key Contact with no LinkedIn URL.
 * @param contacts   the HubSpot contacts cache
 * @param opts.localFields settings.contactLocalFields (a typed-in Company)
 * @param opts.noLinkedin  settings.keyContactNoLinkedin
 * @param opts.prospects   the Table View companies, to link the row to one
 */
export function keyContactLinkedinIssues(contacts, { localFields = {}, noLinkedin = {}, prospects = [] } = {}) {
  const out = [];
  for (const c of contacts || []) {
    if (!c || !isKeyContact(c) || linkedinUrlOf(c)) continue;
    const id = contactIdOf(c);
    if (!id || (noLinkedin && noLinkedin[id])) continue;
    const local = localFields?.[id];
    const company = String((local && typeof local._companyOverride === 'string' && local._companyOverride) || c.company || '').trim();
    const name = [c.firstname, c.lastname].filter(Boolean).join(' ').trim() || c.email || 'Unknown';
    const prospect = company ? findProspectByCompany(prospects, company) : null;
    const title = String(c.jobtitle || '').trim();
    out.push({
      id: `key-contact-no-linkedin:${id}`,
      source: 'Agents',
      type: KEY_CONTACT_LINKEDIN_ISSUE,
      company: company || '-',
      prospectId: prospect?.id ?? null,
      daysUntil: null,
      expirationDate: null,
      resolve: { kind: 'keyContactLinkedin', contactId: id, name, email: String(c.email || '').trim() },
      detail: `${name}${title ? ` (${title})` : ''} is a Key Contact with no LinkedIn URL, so the Job Descriptions agent leaves them out of its prompt`,
    });
  }
  out.sort((a, b) => a.company.localeCompare(b.company, undefined, { sensitivity: 'base' })
    || a.resolve.name.localeCompare(b.resolve.name, undefined, { sensitivity: 'base' }));
  return out;
}

/** A pasted LinkedIn URL tidied, or '' when it isn't one. */
export function cleanLinkedinUrl(raw) {
  let v = String(raw || '').trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = `https://${v.replace(/^\/+/, '')}`;
  try {
    const u = new URL(v);
    if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return '';
    return v;
  } catch {
    return '';
  }
}

/** updateSettings() function marking a contact as having no LinkedIn profile. */
export function markNoLinkedinUpdate(contactId, nowIso = new Date().toISOString()) {
  return (settings) => {
    const key = String(contactId || '').trim();
    if (!key) return null;
    const cur = settings?.[KEY_CONTACT_NO_LINKEDIN_KEY];
    const map = cur && typeof cur === 'object' && !Array.isArray(cur) ? cur : {};
    if (map[key]) return null;
    return { [KEY_CONTACT_NO_LINKEDIN_KEY]: { ...map, [key]: nowIso } };
  };
}

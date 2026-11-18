// Issues: a company with a Key Contact (HubSpot contact tagged "Dan Key
// Target", not hidden or left, jobDescriptionAgent.isKeyContact) whose
// company popup Targets tab has nothing filled in (companyTargets
// hasTargetValues). One row per company, naming its Key Contacts.
//
// Logging the targets, or the tab's "No Target Set" row when it has none,
// clears it; the Resolve popup is the same one the clients' "No targets"
// row uses (resolve.kind 'noTargets'). A company that row already lists is
// left to it (computeIssues drops the duplicate), so it shows once.
//
// A Key Contact whose company isn't on the Table has no Targets tab to
// fill, so it is left out.
//
// Pure: scripts/keyContactNoTargets.test.mjs runs it under plain Node.
import { isKeyContact } from './jobDescriptionAgent.js';
import { hasTargetValues } from './companyTargets.js';
import { normalizeCompany } from './companyNorm.js';

export const KEY_CONTACT_NO_TARGETS_ISSUE = 'Key Contact company has no targets';

const contactIdOf = (c) => String(c?.id || c?.vid || '').trim();
const splitList = (v) => (Array.isArray(v) ? v : String(v || '').split(/[\n;,]+/))
  .map(s => String(s || '').trim()).filter(Boolean);

// Table company by the names it answers to: its own name first (exact,
// then normalized), then Goes By / Also Known As / HubSpot company names.
function makeCompanyFinder(prospects) {
  const exact = new Map();
  const norm = new Map();
  const alias = new Map();
  for (const p of prospects || []) {
    const name = String(p?.company || '').trim();
    if (!name) continue;
    const low = name.toLowerCase();
    if (!exact.has(low)) exact.set(low, p);
    const n = normalizeCompany(name);
    if (n && !norm.has(n)) norm.set(n, p);
    for (const a of [p.goesBy, ...splitList(p.aliases), ...splitList(p.hubspotCompanyNames)]) {
      const k = normalizeCompany(a);
      if (k && !alias.has(k)) alias.set(k, p);
    }
  }
  return (company) => {
    const c = String(company || '').trim();
    if (!c) return null;
    const n = normalizeCompany(c);
    return exact.get(c.toLowerCase()) || (n && (norm.get(n) || alias.get(n))) || null;
  };
}

/**
 * One issue row per Table company with a Key Contact and no targets.
 * @param contacts          the HubSpot contacts cache
 * @param opts.localFields  settings.contactLocalFields (a typed-in Company)
 * @param opts.prospects    the Table View companies
 */
export function keyContactNoTargetsIssues(contacts, { localFields = {}, prospects = [] } = {}) {
  const find = makeCompanyFinder(prospects);
  const byCompany = new Map();
  for (const c of contacts || []) {
    if (!c || !isKeyContact(c)) continue;
    const local = localFields?.[contactIdOf(c)];
    const company = String((local && typeof local._companyOverride === 'string' && local._companyOverride) || c.company || '').trim();
    const p = find(company);
    if (!p || hasTargetValues(p.climateTargets)) continue;
    const name = [c.firstname, c.lastname].filter(Boolean).join(' ').trim() || String(c.email || '').trim() || 'Unknown';
    const entry = byCompany.get(p.id) || { p, names: [] };
    if (!entry.names.includes(name)) entry.names.push(name);
    byCompany.set(p.id, entry);
  }
  const out = [];
  for (const { p, names } of byCompany.values()) {
    names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const who = names.length === 1 ? `Key Contact ${names[0]}` : `Key Contacts ${names.join(', ')}`;
    out.push({
      id: `key-contact-no-targets:${p.id}`,
      source: 'Key Contacts',
      type: KEY_CONTACT_NO_TARGETS_ISSUE,
      company: p.company || '-',
      prospectId: p.id,
      daysUntil: null,
      expirationDate: null,
      resolve: { kind: 'noTargets' },
      detail: `${who} ${names.length === 1 ? 'is' : 'are'} here, but nothing is on the Targets tab of the company popup: add its sustainability targets, or log "No Target Set" if it has none`,
    });
  }
  out.sort((a, b) => a.company.localeCompare(b.company, undefined, { sensitivity: 'base' }));
  return out;
}

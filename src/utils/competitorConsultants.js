// Competitor consultants: people at ANOTHER firm (a rival consultancy, a
// broker, an advisor) who work with a company. Kept on the company's own
// record as `competitorConsultants`, in the tracker only: they are never
// created in HubSpot, and nothing that builds a roster, a campaign or an
// outreach list reads this field, so they cannot be mailed by accident.
//   [{ id, name, firm, title, email, phone, linkedin, service, notes, contactId? }]
// `contactId` is set when the entry was made by marking an existing HubSpot
// contact as a competitor on their card: the contact stays where it is, and
// the entry is what lists them here and badges them on the roster.
export const CONSULTANT_FIELDS = ['name', 'firm', 'title', 'email', 'phone', 'linkedin', 'service', 'notes'];

const text = v => String(v ?? '').trim();
let seq = 0;
export const newConsultantId = () => `cc-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export function blankConsultant() {
  return { id: newConsultantId(), ...Object.fromEntries(CONSULTANT_FIELDS.map(k => [k, ''])) };
}

// Somebody has to be named: a person, or at least the firm.
export const consultantIsEmpty = c => !text(c?.name) && !text(c?.firm);

export function normalizeConsultants(list) {
  const out = [];
  for (const c of Array.isArray(list) ? list : []) {
    if (!c || typeof c !== 'object' || consultantIsEmpty(c)) continue;
    const row = { id: text(c.id) || newConsultantId() };
    for (const k of CONSULTANT_FIELDS) row[k] = text(c[k]);
    if (text(c.contactId)) row.contactId = text(c.contactId);
    if (!out.some(o => o.id === row.id)) out.push(row);
  }
  return out;
}

// Add the entry, or replace the one with its id. An empty entry changes nothing.
export function saveConsultant(list, entry) {
  const cur = normalizeConsultants(list);
  const [row] = normalizeConsultants([entry]);
  if (!row) return cur;
  return cur.some(c => c.id === row.id) ? cur.map(c => (c.id === row.id ? row : c)) : [...cur, row];
}

const FREE_MAIL = new Set(['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'aol.com', 'me.com', 'proton.me', 'protonmail.com', 'live.com', 'msn.com']);

// A first guess at the firm from a work address: "jloeper@verdani.com" gives
// "Verdani". '' for free mail, or a domain the company itself uses.
export function firmFromEmail(email, ownDomains = []) {
  const at = String(email || '').lastIndexOf('@');
  const domain = at >= 0 ? String(email).slice(at + 1).trim().toLowerCase() : '';
  if (!domain || FREE_MAIL.has(domain) || ownDomains.map(d => String(d).toLowerCase()).includes(domain)) return '';
  const label = domain.split('.')[0];
  return label ? label[0].toUpperCase() + label.slice(1) : '';
}

// The entry for a HubSpot contact marked as a competitor.
export function consultantFromContact(contact, ownDomains = []) {
  const c = contact || {};
  return {
    ...blankConsultant(),
    contactId: text(c.id || c.vid),
    name: `${text(c.firstname)} ${text(c.lastname)}`.trim(),
    firm: firmFromEmail(c.email, ownDomains),
    title: text(c.jobtitle),
    email: text(c.email),
    phone: text(c.phone) || text(c.mobilephone),
    linkedin: text(c.hs_linkedin_url),
  };
}

export const contactIsCompetitor = (list, contactId) => !!text(contactId)
  && normalizeConsultants(list).some(c => c.contactId === text(contactId));

// Mark or unmark a contact. Marking one already marked changes nothing.
export function setContactCompetitor(list, contact, on, ownDomains = []) {
  const cur = normalizeConsultants(list);
  const id = text(contact?.id || contact?.vid);
  if (!id) return cur;
  if (!on) return cur.filter(c => c.contactId !== id);
  if (cur.some(c => c.contactId === id)) return cur;
  // Named by the address alone if HubSpot has no name for them.
  const entry = consultantFromContact(contact, ownDomains);
  return saveConsultant(cur, entry.name || entry.firm ? entry : { ...entry, name: entry.email });
}

export const removeConsultant = (list, id) => normalizeConsultants(list).filter(c => c.id !== id);

// The firms already named, across every company, for the Firm box's suggestions.
export function consultantFirms(prospects) {
  const seen = new Map();
  for (const p of prospects || []) {
    for (const c of normalizeConsultants(p?.competitorConsultants)) {
      if (c.firm && !seen.has(c.firm.toLowerCase())) seen.set(c.firm.toLowerCase(), c.firm);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

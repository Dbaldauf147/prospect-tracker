// Competitor consultants: people at ANOTHER firm (a rival consultancy, a
// broker, an advisor) who work with a company. Kept on the company's own
// record as `competitorConsultants`, in the tracker only: they are never
// created in HubSpot, and nothing that builds a roster, a campaign or an
// outreach list reads this field, so they cannot be mailed by accident.
//   [{ id, name, firm, title, email, phone, linkedin, service, notes }]
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

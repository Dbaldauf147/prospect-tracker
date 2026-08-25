// Shared rules for getting a pasted Salesforce Leads table into the
// Contacts → Marketing Leads store (settings.marketingLeads).
//
// Two pages paste that same table: the Marketing Leads page itself (with
// a column-mapping modal), and the BFO Activity → Leads subtab, which
// maps the new leads over as a side effect of its own paste. Both go
// through planLeadImport so a lead can't be accepted by one page and
// silently dropped by the other — the two had drifted before, which is
// how a lead ended up visible on the Leads subtab and missing from
// Marketing Leads.

// Every field a saved Marketing Lead row carries. Mirrors the editable
// columns of the Marketing Leads table; the read-only columns
// (Company Status, CDM, HubSpot Title, Table View) are derived at render
// time and are never stored on the row.
export const LEAD_FIELD_KEYS = [
  'name', 'sfUrl', 'linkedin', 'email', 'jobTitle', 'company', 'mappedCompany',
  'hubspotContact', 'status', 'createdDate', 'leadSource', 'owner', 'country',
  'qualificationDetail',
];

// Target fields a pasted column can fill. Aliases match common Salesforce
// / Excel header conventions case- and punctuation-insensitively, so
// "Job Title", "jobtitle", "Title" all hit jobTitle.
export const LEAD_PASTE_TARGETS = [
  { key: 'name',                label: 'Name',                       required: true,
    aliases: ['name', 'fullname', 'leadname', 'contactname', 'contact'] },
  { key: 'email',               label: 'Email',                      required: false,
    aliases: ['email', 'emailaddress', 'workemail', 'e-mail'] },
  { key: 'jobTitle',            label: 'Job Title',                  required: false,
    aliases: ['jobtitle', 'title', 'position', 'role'] },
  { key: 'company',             label: 'Company',                    required: false,
    aliases: ['company', 'companyname', 'account', 'accountname', 'organization'] },
  { key: 'status',              label: 'Status',                     required: false,
    aliases: ['status', 'leadstatus'] },
  { key: 'createdDate',         label: 'Created Date',               required: false,
    aliases: ['createddate', 'created', 'datecreated', 'createdon', 'createddatetime'] },
  { key: 'leadSource',          label: 'Last Lead Source',           required: false,
    aliases: ['lastleadsource', 'leadsource', 'source'] },
  { key: 'owner',               label: 'Owner',                      required: false,
    aliases: ['owner', 'leadowner', 'ownername', 'accountowner', 'ownerfullname'] },
  { key: 'country',             label: 'Country',                    required: false,
    aliases: ['country', 'countrycode', 'mailingcountry', 'billingcountry'] },
  { key: 'qualificationDetail', label: 'Qualification Source Detail', required: false,
    aliases: ['qualificationsourcedetail', 'qualificationdetail', 'qualificationsource', 'sourcedetail'] },
  { key: 'linkedin',            label: 'LinkedIn',                   required: false,
    aliases: ['linkedin', 'linkedinurl', 'linkedinprofile', 'linkedinprofileurl', 'linkedinlink', 'li', 'liurl'] },
  // Salesforce record link / id. Auto-filled from the clipboard's HTML
  // anchors when pasting a list view; a mapped URL / Lead-ID column takes
  // precedence. Listed last so its generic aliases (url / id / link)
  // don't claim a header a more specific field wants.
  { key: 'sfUrl',               label: 'Salesforce Link',            required: false,
    aliases: ['salesforcelink', 'salesforceurl', 'sfurl', 'sflink', 'leadurl', 'recordurl', 'url', 'link', 'leadid', 'recordid', 'id'] },
];

export function makeLeadId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// A blank lead row with every stored field present, so a freshly pasted
// lead has the same shape as one that's been edited on the page.
export function makeLeadRow(fields = {}) {
  const row = { id: makeLeadId() };
  for (const k of LEAD_FIELD_KEYS) row[k] = '';
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'id' || LEAD_FIELD_KEYS.includes(k)) row[k] = v;
  }
  return row;
}

export function normaliseLeadHeader(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Salesforce lists render person names "Last, First" (e.g. "Blancarte,
// Victor"). Flip a simple "Last, First" into "First Last" for display,
// HubSpot matching, and the create-contact name split. Names without a
// comma pass through untouched, and it's idempotent so re-running never
// re-flips an already-normalised name.
export function normalizeLeadName(raw) {
  const s = String(raw || '').trim();
  if (!s) return s;
  const ci = s.indexOf(',');
  if (ci === -1) return s;
  const last = s.slice(0, ci).trim();
  const first = s.slice(ci + 1).trim();
  // Only flip a clean two-part "Last, First" — bail on empty halves or a
  // multi-comma value so odd inputs aren't mangled.
  if (!last || !first || first.includes(',')) return s;
  return `${first} ${last}`;
}

// Order-insensitive name key, so the Marketing Leads page's "First Last"
// matches the Salesforce Leads printable view's "Last, First". Drops
// punctuation (the comma) and sorts the remaining tokens, so both
// orderings collapse to the same key ("Victor Blancarte" and
// "Blancarte, Victor" → "blancarte victor").
export function leadNameKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

// Normalized email used as the duplicate key: trimmed + lower-cased so
// "Chris.Kirk@CBRE.com " and "chris.kirk@cbre.com" collapse to one lead.
// Rows without an email return '' and are never treated as duplicates of
// each other.
export function leadEmailKey(row) {
  return String(row?.email || '').toLowerCase().trim();
}

// A lead Salesforce has moved to "Working" — someone is actively on it.
// Matched punctuation-blind and by prefix so the sub-statuses
// ("Working - Contacted") count too.
export function isWorkingLeadStatus(status) {
  return String(status || '').toLowerCase().replace(/[^a-z0-9]/g, '').startsWith('working');
}

// header → target key, best-effort, first alias match wins and a header
// can only be claimed once.
export function autoDetectLeadMapping(headers = []) {
  const mapping = {}; // targetKey → header
  const used = new Set();
  for (const t of LEAD_PASTE_TARGETS) {
    for (const h of headers) {
      if (used.has(h)) continue;
      if (t.aliases.includes(normaliseLeadHeader(h))) {
        mapping[t.key] = h;
        used.add(h);
        break;
      }
    }
  }
  return mapping;
}

// Turn a parsed table (rows as objects keyed by header, the shape
// utils/tsvTable parseTSV returns) into lead rows. Rows that fill none of
// the mapped columns are dropped.
export function leadRowsFromTable({ headers = [], rows = [], mapping } = {}) {
  const map = mapping || autoDetectLeadMapping(headers);
  const out = [];
  for (const r of rows) {
    const fields = {};
    let any = false;
    for (const t of LEAD_PASTE_TARGETS) {
      const h = map[t.key];
      if (!h) continue;
      const v = String(r?.[h] ?? '').trim();
      if (v) any = true;
      fields[t.key] = v;
    }
    if (!any) continue;
    out.push(makeLeadRow(fields));
  }
  return out;
}

// Index of already-known leads, by email and by name, used to decide
// whether an incoming lead is one of them.
function makeLeadIndex() {
  return { byEmail: new Map(), byName: new Map() };
}

function indexLead(index, row) {
  const e = leadEmailKey(row);
  const n = leadNameKey(row?.name);
  if (e && !index.byEmail.has(e)) index.byEmail.set(e, row);
  if (n) {
    const list = index.byName.get(n);
    if (list) list.push(row);
    else index.byName.set(n, [row]);
  }
}

// Does `row` name someone already in `index`?
//
// Email is the definitive key: same address, same lead. The name is only
// a fallback, because two different people can share a name while one
// address is one person — so a name match counts only when it can't be
// separating them: when the incoming lead has no email at all, or when
// the lead already stored under that name has none. Two same-named leads
// carrying different addresses stay two leads.
function matchesKnownLead(index, row, matchByName) {
  const e = leadEmailKey(row);
  if (e && index.byEmail.has(e)) return true;
  if (!matchByName) return false;
  const n = leadNameKey(row?.name);
  if (!n) return false;
  const sameName = index.byName.get(n);
  if (!sameName?.length) return false;
  return !e || sameName.some(r => !leadEmailKey(r));
}

// Decide what a pasted batch of leads does to the saved list.
//
// `incoming` are lead rows (from leadRowsFromTable, or built by the
// Marketing Leads paste modal), `saved` is settings.marketingLeads and
// `hiddenIds` is settings.marketingLeadsHiddenLeads. Nothing is mutated;
// the caller persists `[...savedAfter, ...additions]`.
//
// Rules, in order, per incoming lead:
//  1. A "Working" duplicate carries its status back onto the lead it
//     duplicates (promoteWorkingStatus) — a Salesforce list shows the
//     dead copy of a recycled-then-reworked lead beside the live one, and
//     the live one is the truth. Runs before the skips below, and for
//     hidden leads too, without unhiding them.
//  2. Matches a lead the user hid → blocked. Hiding is deliberate, so a
//     fresh paste must not resurrect it.
//  3. Matches a lead already saved, or one earlier in this same paste →
//     skipped as a duplicate.
//  4. Otherwise it's new: the name is normalised to "First Last" and the
//     row is added.
export function planLeadImport({
  incoming = [], saved = [], hiddenIds = [],
  matchByName = false, promoteWorkingStatus = false,
} = {}) {
  const hidden = new Set((hiddenIds || []).map(String));
  const savedIndex = makeLeadIndex();
  const hiddenIndex = makeLeadIndex();
  for (const r of saved) {
    indexLead(savedIndex, r);
    if (hidden.has(String(r?.id))) indexLead(hiddenIndex, r);
  }
  // Leads accepted so far in THIS paste, so a block that itself repeats a
  // lead only imports it once.
  const pasteIndex = makeLeadIndex();

  // id → the Working status to write onto a saved lead. Only Working is
  // promoted: the reverse (a stale Closed-Recycle copy overwriting a lead
  // you are actively working) is exactly what this must not do.
  const statusUpdates = new Map();
  const additions = [];
  const blockedHidden = [];
  const blockedDuplicate = [];
  let statusPromoted = 0;

  for (const raw of incoming) {
    const row = { ...raw, name: normalizeLeadName(raw?.name) };
    const email = leadEmailKey(row);
    if (promoteWorkingStatus && email && isWorkingLeadStatus(row.status)) {
      const target = savedIndex.byEmail.get(email);
      const earlier = pasteIndex.byEmail.get(email);
      if (target && !isWorkingLeadStatus(target.status) && !statusUpdates.has(target.id)) {
        statusUpdates.set(target.id, row.status);
        statusPromoted += 1;
      } else if (earlier && !isWorkingLeadStatus(earlier.status)) {
        earlier.status = row.status;
        statusPromoted += 1;
      }
    }
    if (matchesKnownLead(hiddenIndex, row, matchByName)) { blockedHidden.push(row); continue; }
    if (matchesKnownLead(savedIndex, row, matchByName)
      || matchesKnownLead(pasteIndex, row, matchByName)) { blockedDuplicate.push(row); continue; }
    indexLead(pasteIndex, row);
    additions.push(row);
  }

  const savedAfter = statusUpdates.size
    ? saved.map(r => (statusUpdates.has(r.id) ? { ...r, status: statusUpdates.get(r.id) } : r))
    : saved;

  return { additions, savedAfter, blockedHidden, blockedDuplicate, statusPromoted };
}

// "Ana Higueras, Colleen Reid and 3 more" — for reporting which leads a
// paste added or skipped without printing a wall of names.
export function summariseLeadNames(rows = [], max = 4) {
  const names = rows.map(r => String(r?.name || '').trim()).filter(Boolean);
  if (!names.length) return '';
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}

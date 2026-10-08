// Read-only groundwork for moving from one HubSpot portal to another.
//
// The app is pointed at one portal (HUBSPOT_ACCESS_TOKEN, the "source").
// The move is to a second one (HUBSPOT_TARGET_ACCESS_TOKEN, the "target"),
// which is a shared corporate portal rather than a personal one. Nothing in
// this file writes to either portal: every request is a GET, a search, or a
// batch READ. What it produces is an answer to "if the app were pointed at
// the target today, what would be missing or different?":
//
//   * what each portal is (id, domain) and how much it holds,
//   * whether the custom properties the app relies on exist in the target,
//     with the same type and the same dropdown options,
//   * for every source contact and company, whether the target has it, who
//     owns it there, and which values disagree.
//
// The classification is pure and exported, so it can be tested without a
// HubSpot round trip (scripts/hubspotMove.test.mjs).

const BASE = 'https://api.hubapi.com';
export const DAY_MS = 24 * 60 * 60 * 1000;

// HubSpot's search API is the tightest limit it has (a handful of requests a
// second per portal, shared with everything else using that portal). Paging
// a few thousand records through it back to back is exactly what earns a
// 429, so searches are spaced out.
const SEARCH_PACING_MS = 250;

// A small client for one portal. Retries the statuses HubSpot means as "in a
// moment" (429, 5xx), honouring Retry-After, the same climb the rest of the
// API uses. `fetchImpl` and `sleep` are injectable for the tests.
export function hubspotClient(token, { fetchImpl = fetch, sleep } = {}) {
  const wait = sleep || ((ms) => new Promise(r => setTimeout(r, ms)));
  async function request(method, path, body) {
    const opts = {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    let res = await fetchImpl(`${BASE}${path}`, opts);
    for (let i = 0; i < 3 && (res.status === 429 || res.status >= 500); i += 1) {
      const after = Number(res.headers?.get?.('retry-after'));
      await wait(Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 15000) : 500 * (2 ** i));
      res = await fetchImpl(`${BASE}${path}`, opts);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`HubSpot ${res.status} on ${path.split('?')[0]}: ${String(text).slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }
  return {
    get: (path) => request('GET', path),
    // Only used for search and batch READ endpoints. This module never
    // creates, updates or deletes anything.
    read: (path, body) => request('POST', path, body),
    pause: () => wait(SEARCH_PACING_MS),
  };
}

// ── Portal facts ──────────────────────────────────────────────────────────

export async function accountDetails(client) {
  const d = await client.get('/account-info/v3/details');
  return {
    portalId: d.portalId != null ? String(d.portalId) : '',
    accountType: d.accountType || '',
    uiDomain: d.uiDomain || '',
    timeZone: d.timeZone || '',
    dataHostingLocation: d.dataHostingLocation || '',
  };
}

// The HubSpot user (owner) with this email, or null. An owner has two ids:
// `id` is what records carry in hubspot_owner_id, `userId` is the login.
export async function findOwnerByEmail(client, email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return null;
  const data = await client.get(`/crm/v3/owners?email=${encodeURIComponent(e)}&limit=100`);
  const hit = (data.results || []).find(o => String(o.email || '').toLowerCase() === e);
  if (!hit) return null;
  return {
    id: String(hit.id),
    userId: hit.userId != null ? String(hit.userId) : '',
    email: hit.email || e,
    name: [hit.firstName, hit.lastName].filter(Boolean).join(' '),
  };
}

// How many records of a type the portal holds, optionally under filters.
// A search with limit 1 answers with `total` and costs one request.
export async function countObjects(client, objectType, filters = []) {
  const body = { limit: 1, properties: ['hs_object_id'] };
  if (filters.length) body.filterGroups = [{ filters }];
  const data = await client.read(`/crm/v3/objects/${objectType}/search`, body);
  return Number(data.total) || 0;
}

// Everything the plan has to move: records, and the history attached to
// them. Deals are counted so nothing is a surprise, even though the app
// itself doesn't read them.
export const INVENTORY_TYPES = ['contacts', 'companies', 'deals', 'emails', 'calls', 'meetings', 'notes', 'tasks'];

// Per type: the total, and (when an owner is given) how many that owner
// holds. A type the token can't read is reported as an error for that row,
// not a failure of the whole inventory: a missing scope is one of the
// things this is meant to surface.
export async function inventoryCounts(client, { ownerId = '', since = 0 } = {}) {
  const rows = [];
  for (const type of INVENTORY_TYPES) {
    const row = { type, total: null, owned: null, recent: null, error: '' };
    try {
      row.total = await countObjects(client, type);
      await client.pause();
      if (ownerId) {
        row.owned = await countObjects(client, type, [{ propertyName: 'hubspot_owner_id', operator: 'EQ', value: ownerId }]);
        await client.pause();
      }
      if (since && (type === 'contacts' || type === 'companies')) {
        row.recent = await countObjects(client, type, [{ propertyName: 'createdate', operator: 'GTE', value: String(since) }]);
        await client.pause();
      }
    } catch (err) {
      row.error = String(err?.message || err).slice(0, 300);
    }
    rows.push(row);
  }
  return rows;
}

// ── Custom properties ─────────────────────────────────────────────────────

// The properties someone created in the portal, as opposed to the ones
// HubSpot ships. These are the ones a new portal won't have unless they are
// rebuilt, and the ones a plain import silently drops.
export async function customProperties(client, objectType) {
  const data = await client.get(`/crm/v3/properties/${objectType}`);
  return (data.results || [])
    .filter(p => !p.hubspotDefined && !p.archived)
    .map(p => ({
      name: p.name,
      label: p.label || p.name,
      type: p.type || '',
      fieldType: p.fieldType || '',
      groupName: p.groupName || '',
      options: (p.options || []).map(o => String(o.value ?? '')).filter(Boolean),
    }));
}

const optKey = (v) => String(v || '').trim().toLowerCase();

/**
 * Compare the source portal's custom properties with the target's.
 * Returns one row per source property:
 *   status: 'ok' | 'missing' | 'type-differs' | 'options-missing'
 *   missingOptions: dropdown values the source has and the target lacks
 * Pure.
 */
export function compareCustomProperties(sourceProps, targetProps) {
  const byName = new Map((targetProps || []).map(p => [p.name, p]));
  return (sourceProps || []).map(src => {
    const tgt = byName.get(src.name);
    if (!tgt) return { name: src.name, label: src.label, type: src.type, status: 'missing', missingOptions: src.options };
    if (tgt.type !== src.type) {
      return { name: src.name, label: src.label, type: src.type, targetType: tgt.type, status: 'type-differs', missingOptions: [] };
    }
    const have = new Set(tgt.options.map(optKey));
    const missingOptions = src.options.filter(o => !have.has(optKey(o)));
    return {
      name: src.name, label: src.label, type: src.type,
      status: missingOptions.length ? 'options-missing' : 'ok',
      missingOptions,
    };
  });
}

// ── Record comparison ─────────────────────────────────────────────────────

// Standard contact fields worth checking on top of every custom property.
// These are the ones the app reads and writes.
export const CONTACT_FIELDS = [
  'firstname', 'lastname', 'jobtitle', 'phone', 'mobilephone', 'company',
  'city', 'state', 'country', 'hs_linkedin_url', 'hs_lead_status',
];
export const COMPANY_FIELDS = [
  'name', 'domain', 'website', 'phone', 'industry', 'city', 'state', 'country',
  'numberofemployees', 'annualrevenue', 'description',
];

// Semicolon lists (multi-select properties such as dans_tags) compare as
// sets: HubSpot doesn't promise an order, and "A;B" vs "B;A" is no loss.
function normValue(v) {
  const s = String(v ?? '').trim();
  if (!s.includes(';')) return s.toLowerCase().replace(/\s+/g, ' ');
  return s.split(';').map(x => x.trim().toLowerCase()).filter(Boolean).sort().join(';');
}

/**
 * The fields where the target has lost or changed something the source
 * holds. A field blank in the source is never a difference: there was
 * nothing to lose. Pure.
 */
export function fieldDiffs(sourceProps, targetProps, fields) {
  const out = [];
  for (const f of fields) {
    const s = sourceProps?.[f];
    if (s == null || String(s).trim() === '') continue;
    const t = targetProps?.[f];
    if (normValue(s) === normValue(t)) continue;
    out.push({ field: f, source: String(s), target: t == null ? '' : String(t) });
  }
  return out;
}

function ownerStatus(ownerIdValue, ownerId) {
  const o = String(ownerIdValue || '').trim();
  if (!o) return 'unowned';
  if (ownerId && o === String(ownerId)) return 'mine';
  return 'other';
}

/**
 * Classify one source contact against what the target holds for the same
 * email. `match` is the target contact or null. Pure.
 *
 * status:
 *   no-email   - can't be matched by email (and can't be imported by it)
 *   missing    - the target has no contact with this email
 *   matched    - it does; `owner` says whose it is there
 * `recent` marks a source record created inside the recent window, which
 * is where missing records are expected.
 */
export function classifyContact(src, match, { ownerId = '', fields = CONTACT_FIELDS, recentSince = 0, sourceCompanyName = '', targetCompanyName = '' } = {}) {
  const p = src.properties || {};
  const created = p.createdate ? new Date(p.createdate).getTime() : NaN;
  const row = {
    id: String(src.id),
    email: String(p.email || '').trim(),
    name: [p.firstname, p.lastname].filter(Boolean).join(' '),
    createdate: p.createdate || '',
    recent: Number.isFinite(created) && recentSince > 0 && created >= recentSince,
    sourceCompany: sourceCompanyName,
  };
  if (!row.email) return { ...row, status: 'no-email', owner: '', targetId: '', diffs: [] };
  if (!match) return { ...row, status: 'missing', owner: '', targetId: '', diffs: [] };
  const tp = match.properties || {};
  const diffs = fieldDiffs(p, tp, fields);
  // The company link is the one piece of company information a contact
  // import most often drops, so it is compared by the NAME of the linked
  // Company record on each side (ids differ between portals by definition).
  if (sourceCompanyName && normValue(sourceCompanyName) !== normValue(targetCompanyName)) {
    diffs.push({ field: 'associated company', source: sourceCompanyName, target: targetCompanyName || '' });
  }
  return {
    ...row,
    status: 'matched',
    owner: ownerStatus(tp.hubspot_owner_id, ownerId),
    targetId: String(match.id),
    diffs,
  };
}

// The bare host a company's domain or website reduces to, for matching.
export function domainKey(v) {
  return String(v || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

/**
 * Classify one source company against the target companies that share its
 * domain or its name. Pure.
 *
 * status: 'missing' | 'matched'
 * matchedBy: 'domain' | 'name'
 * candidates: how many target records matched (a corporate portal often
 *   holds several records for one big company, owned by different people)
 * owner: of the best candidate, preferring one owned by `ownerId`
 */
export function classifyCompany(src, candidates, { ownerId = '', fields = COMPANY_FIELDS, recentSince = 0 } = {}) {
  const p = src.properties || {};
  const created = p.createdate ? new Date(p.createdate).getTime() : NaN;
  const row = {
    id: String(src.id),
    name: String(p.name || '').trim(),
    domain: domainKey(p.domain),
    createdate: p.createdate || '',
    recent: Number.isFinite(created) && recentSince > 0 && created >= recentSince,
  };
  const dom = row.domain;
  const nm = normValue(row.name);
  const byDomain = dom ? (candidates || []).filter(c => domainKey(c.properties?.domain) === dom) : [];
  const byName = nm ? (candidates || []).filter(c => normValue(c.properties?.name) === nm) : [];
  const pool = byDomain.length ? byDomain : byName;
  if (!pool.length) return { ...row, status: 'missing', matchedBy: '', candidates: 0, owner: '', targetId: '', diffs: [] };
  const best = pool.find(c => ownerStatus(c.properties?.hubspot_owner_id, ownerId) === 'mine') || pool[0];
  return {
    ...row,
    status: 'matched',
    matchedBy: byDomain.length ? 'domain' : 'name',
    candidates: pool.length,
    owner: ownerStatus(best.properties?.hubspot_owner_id, ownerId),
    targetId: String(best.id),
    diffs: fieldDiffs(p, best.properties || {}, fields),
  };
}

// ── Paged reads ───────────────────────────────────────────────────────────

// A batch read in which none of the inputs exist can come back 404 rather
// than 207-with-errors. Either way it means "none of these", not a failure.
async function batchRead(client, path, body) {
  try {
    return await client.read(path, body);
  } catch (err) {
    if (err?.status === 404) return { results: [] };
    throw err;
  }
}

const PAGE = 100;

// One page of source records, oldest first, with the properties asked for.
export async function sourcePage(client, objectType, properties, after) {
  const params = new URLSearchParams({ limit: String(PAGE), properties: properties.join(','), archived: 'false' });
  if (after) params.set('after', String(after));
  const data = await client.get(`/crm/v3/objects/${objectType}?${params}`);
  return { results: data.results || [], next: data.paging?.next?.after || null };
}

// Company names for a set of company ids in one portal, 100 per request.
export async function companyNames(client, ids) {
  const out = new Map();
  const list = [...new Set((ids || []).map(String).filter(Boolean))];
  for (let i = 0; i < list.length; i += 100) {
    const data = await batchRead(client, '/crm/v3/objects/companies/batch/read', {
      properties: ['name'],
      inputs: list.slice(i, i + 100).map(id => ({ id })),
    });
    for (const r of (data.results || [])) out.set(String(r.id), r.properties?.name || '');
  }
  return out;
}

// Target contacts for a set of emails, keyed by lowercased email. A batch
// read by email answers 207 with an error entry for each address it
// doesn't know, which is exactly the "missing" list.
export async function targetContactsByEmail(client, emails, properties) {
  const out = new Map();
  const list = [...new Set((emails || []).map(e => String(e).trim().toLowerCase()).filter(Boolean))];
  for (let i = 0; i < list.length; i += 100) {
    const data = await batchRead(client, '/crm/v3/objects/contacts/batch/read', {
      idProperty: 'email',
      properties,
      inputs: list.slice(i, i + 100).map(id => ({ id })),
    });
    for (const r of (data.results || [])) {
      const e = String(r.properties?.email || '').trim().toLowerCase();
      if (e) out.set(e, r);
    }
  }
  return out;
}

// Target companies sharing a domain or a name with any of these source
// companies. Domains go in IN searches of 50; a company with no domain, or
// whose domain found nothing, is looked up by name one search at a time
// (HubSpot's IN wants exact lowercase values, which names aren't).
export async function targetCompanyCandidates(client, sourceCompanies, properties) {
  const found = new Map();
  const add = (r) => { if (r?.id) found.set(String(r.id), r); };
  const searchAll = async (filters) => {
    let after;
    for (let page = 0; page < 10; page += 1) {
      const body = { limit: 200, properties, filterGroups: [{ filters }] };
      if (after) body.after = after;
      const data = await client.read('/crm/v3/objects/companies/search', body);
      await client.pause();
      (data.results || []).forEach(add);
      after = data.paging?.next?.after;
      if (!after) break;
    }
  };
  const domains = [...new Set(sourceCompanies.map(c => domainKey(c.properties?.domain)).filter(Boolean))];
  for (let i = 0; i < domains.length; i += 50) {
    await searchAll([{ propertyName: 'domain', operator: 'IN', values: domains.slice(i, i + 50) }]);
  }
  const foundDomains = new Set([...found.values()].map(c => domainKey(c.properties?.domain)).filter(Boolean));
  for (const c of sourceCompanies) {
    const name = String(c.properties?.name || '').trim();
    const dom = domainKey(c.properties?.domain);
    if (!name || (dom && foundDomains.has(dom))) continue;
    await searchAll([{ propertyName: 'name', operator: 'EQ', value: name }]);
  }
  return [...found.values()];
}

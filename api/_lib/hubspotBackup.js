// A full, read-only backup of one HubSpot portal, taken before the app moves
// to another one (see hubspotMove.js for the comparison side of that move).
//
// "Full" means everything a rebuild would need, not just what the app reads:
//
//   * the portal's set-up: account details, every property definition and
//     property group per object type, deal and ticket pipelines, owners,
//     custom object schemas and lists,
//   * every record of every object type with ALL of its properties (a
//     backup that kept only the properties the app uses would lose exactly
//     the ones nobody remembered),
//   * the associations between records, with their types and labels, so
//     "this email was logged against this contact and this deal" survives.
//
// A portal is too big to read inside one function call, so the work is cut
// into chunks: the caller (the browser, one short request at a time) asks
// for one object type from a cursor, gets back the records read inside a
// time budget and the cursor to continue from. Each chunk is saved as its
// own file by api/hubspot-backup.js.
//
// Nothing here writes to HubSpot: the client it is handed (hubspotClient in
// hubspotMove.js) only GETs and POSTs to search and batch READ endpoints.

// The object types a portal can hold records in, in the order they are
// backed up. A type the token has no scope for is reported for that type
// and the rest carry on: a missing scope is something the backup has to
// surface, not something that should stop it.
export const STANDARD_TYPES = [
  'contacts', 'companies', 'deals', 'tickets', 'products', 'line_items',
  'emails', 'notes', 'calls', 'meetings', 'tasks', 'communications',
];

const ENGAGEMENT_TYPES = new Set(['emails', 'notes', 'calls', 'meetings', 'tasks', 'communications']);

// Which associations to read from each type. Each pair is read from one
// side only (contacts -> deals, not also deals -> contacts): HubSpot
// associations go both ways, so one side is the whole of it.
export function associationTargets(type) {
  if (type === 'contacts') return ['companies', 'deals', 'tickets'];
  if (type === 'companies') return ['deals', 'tickets'];
  if (type === 'deals') return ['line_items', 'tickets'];
  if (ENGAGEMENT_TYPES.has(type)) return ['contacts', 'companies', 'deals', 'tickets'];
  // Custom objects (objectTypeId like "2-1234567").
  if (/^2-\d+$/.test(type)) return ['contacts', 'companies', 'deals'];
  return [];
}

const LIST_LIMIT = 100;
const ASSOC_BATCH = 100;

// Every property name a type has, hidden ones included. Asked for once per
// chunk: it is one request, and a property created mid-backup then still
// gets read.
export async function propertyNames(client, type) {
  const data = await client.get(`/crm/v3/properties/${encodeURIComponent(type)}?archived=false`);
  return (data.results || []).map(p => p.name).filter(Boolean);
}

// One association pair for a batch of record ids:
//   { [fromId]: [{ id, types: [{ category, typeId, label }] }] }
// A record with more associations than one answer holds says so with
// `paging`; those are followed so nothing is cut short.
export async function readAssociations(client, fromType, toType, ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += ASSOC_BATCH) {
    const inputs = ids.slice(i, i + ASSOC_BATCH).map(id => ({ id: String(id) }));
    const data = await client.read(
      `/crm/v4/associations/${encodeURIComponent(fromType)}/${encodeURIComponent(toType)}/batch/read`,
      { inputs },
    );
    for (const r of data.results || []) {
      const fromId = String(r.from?.id ?? '');
      if (!fromId) continue;
      const list = out[fromId] || (out[fromId] = []);
      for (const t of r.to || []) list.push(assocEntry(t));
      let after = r.paging?.next?.after;
      while (after) {
        const more = await client.get(
          `/crm/v4/objects/${encodeURIComponent(fromType)}/${encodeURIComponent(fromId)}/associations/${encodeURIComponent(toType)}?limit=500&after=${encodeURIComponent(after)}`,
        );
        for (const t of more.results || []) list.push(assocEntry(t));
        after = more.paging?.next?.after;
      }
    }
  }
  return out;
}

function assocEntry(t) {
  return {
    id: String(t.toObjectId ?? t.id ?? ''),
    types: (t.associationTypes || []).map(a => ({ category: a.category, typeId: a.typeId, label: a.label ?? null })),
  };
}

// How much a chunk may hold before it stops, measured as saved JSON. Time
// alone is the wrong limit for logged emails: each carries its whole HTML
// body, and 40 seconds of them outgrew the function's memory (the first
// real run died with a bare 500 at 0 of 9,479 emails). Contacts stay far
// under this and are still cut by time.
export const CHUNK_MAX_BYTES = 12 * 1024 * 1024;

/**
 * Read records of one type from `after` until the time budget or the size
 * cap runs out, or the type is finished. Returns
 *   { records, next, associationErrors }
 * where `next` is the cursor to continue from ('' when done) and each
 * record is { id, createdAt, updatedAt, properties, associations }.
 *
 * Listing gives the ids; a batch read then fetches every property for them
 * (a list request naming hundreds of properties outgrows the URL).
 */
export async function readChunk(client, type, { after = '', budgetMs = 40000, maxBytes = CHUNK_MAX_BYTES, now = Date.now } = {}) {
  const started = now();
  const props = await propertyNames(client, type);
  const targets = associationTargets(type);
  const records = [];
  const associationErrors = {};
  let cursor = after;
  let bytes = 0;

  do {
    const qs = new URLSearchParams({ limit: String(LIST_LIMIT), archived: 'false' });
    if (cursor) qs.set('after', cursor);
    const page = await client.get(`/crm/v3/objects/${encodeURIComponent(type)}?${qs}`);
    const ids = (page.results || []).map(r => String(r.id));
    cursor = page.paging?.next?.after ? String(page.paging.next.after) : '';
    if (!ids.length) break;

    const full = await client.read(`/crm/v3/objects/${encodeURIComponent(type)}/batch/read`, {
      inputs: ids.map(id => ({ id })),
      properties: props,
    });
    const byId = new Map((full.results || []).map(r => [String(r.id), r]));

    const assoc = {};
    for (const to of targets) {
      if (associationErrors[to]) continue;
      try {
        assoc[to] = await readAssociations(client, type, to, ids);
      } catch (err) {
        // Usually a missing scope for the other side (no tickets access, say).
        // Reported once per chunk, and the records are still saved.
        associationErrors[to] = String(err?.message || err).slice(0, 300);
      }
    }

    for (const id of ids) {
      const r = byId.get(id);
      const associations = {};
      for (const to of Object.keys(assoc)) {
        if (assoc[to][id]?.length) associations[to] = assoc[to][id];
      }
      const record = {
        id,
        createdAt: r?.createdAt || null,
        updatedAt: r?.updatedAt || null,
        properties: r?.properties || {},
        associations,
        // Listed but gone by the time of the batch read (deleted mid-backup).
        ...(r ? {} : { missingOnRead: true }),
      };
      bytes += JSON.stringify(record).length;
      records.push(record);
    }
  } while (cursor && now() - started < budgetMs && bytes < maxBytes);

  return { records, next: cursor, associationErrors };
}

// Every page of a paged GET, for the set-up sections.
async function allPages(client, path, key = 'results') {
  const out = [];
  let after = '';
  for (let i = 0; i < 1000; i += 1) {
    const sep = path.includes('?') ? '&' : '?';
    const data = await client.get(`${path}${after ? `${sep}after=${encodeURIComponent(after)}` : ''}`);
    out.push(...(data[key] || []));
    after = data.paging?.next?.after;
    if (!after) break;
  }
  return out;
}

/**
 * The portal's set-up, plus the full list of object types to back up
 * (the standard ones and any custom objects). Each section is read on its
 * own; one that fails is recorded in `errors` and the rest still land.
 */
export async function collectSchema(client) {
  const schema = { account: null, schemas: [], properties: {}, propertyGroups: {}, pipelines: {}, owners: [], lists: [], errors: {} };
  const attempt = async (key, fn) => {
    try { await fn(); } catch (err) { schema.errors[key] = String(err?.message || err).slice(0, 300); }
  };

  await attempt('account', async () => { schema.account = await client.get('/account-info/v3/details'); });
  await attempt('schemas', async () => { schema.schemas = (await client.get('/crm/v3/schemas')).results || []; });

  const custom = schema.schemas.map(s => String(s.objectTypeId || '')).filter(Boolean);
  const types = [...STANDARD_TYPES, ...custom];

  for (const type of types) {
    await attempt(`properties:${type}`, async () => {
      schema.properties[type] = (await client.get(`/crm/v3/properties/${encodeURIComponent(type)}`)).results || [];
    });
    await attempt(`propertyGroups:${type}`, async () => {
      schema.propertyGroups[type] = (await client.get(`/crm/v3/properties/${encodeURIComponent(type)}/groups`)).results || [];
    });
  }
  for (const type of ['deals', 'tickets']) {
    await attempt(`pipelines:${type}`, async () => {
      schema.pipelines[type] = (await client.get(`/crm/v3/pipelines/${type}`)).results || [];
    });
  }
  await attempt('owners', async () => {
    const active = await allPages(client, '/crm/v3/owners?limit=100');
    const archived = await allPages(client, '/crm/v3/owners?limit=100&archived=true');
    schema.owners = [...active, ...archived.map(o => ({ ...o, archived: true }))];
  });
  await attempt('lists', async () => {
    const lists = [];
    for (let offset = 0, i = 0; i < 100; i += 1) {
      const data = await client.read('/crm/v3/lists/search', { offset, count: 500 });
      lists.push(...(data.lists || []));
      if (!data.hasMore) break;
      offset = data.offset;
    }
    schema.lists = lists;
  });

  // A type with no readable properties can't be backed up at all (no scope).
  const objectTypes = types.filter(t => Array.isArray(schema.properties[t]));
  return { schema, objectTypes };
}

// ── Files ─────────────────────────────────────────────────────────────────
// hubspot-backup/<portalId>/<runId>/schema.json
//                                   /<type>-0001.json, -0002.json, ...
//                                   /manifest.json   (written last)

export const BACKUP_ROOT = 'hubspot-backup/';

export function newRunId(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');
}

const SAFE = /^[A-Za-z0-9_-]+$/;
export function runPrefix(portalId, runId) {
  if (!SAFE.test(String(portalId)) || !SAFE.test(String(runId))) throw new Error('Invalid backup run id.');
  return `${BACKUP_ROOT}${portalId}/${runId}/`;
}

export function partName(prefix, type, part) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(type))) throw new Error('Invalid object type.');
  return `${prefix}${type}-${String(part).padStart(4, '0')}.json`;
}

/**
 * Tally the part files saved for a run from their names alone:
 *   { [type]: number of part files }
 * Pure. The record counts come from the chunks' own answers; this is what
 * proves every chunk the browser reported actually reached the bucket.
 */
export function tallyParts(names, prefix) {
  const out = {};
  for (const n of names || []) {
    if (!n.startsWith(prefix)) continue;
    const m = n.slice(prefix.length).match(/^(.+)-(\d{4})\.json$/);
    if (!m) continue;
    out[m[1]] = (out[m[1]] || 0) + 1;
  }
  return out;
}

/**
 * Check what the browser says it saved against the bucket and HubSpot:
 *   reported  { [type]: { records, parts, done } }   from the chunk answers
 *   partFiles { [type]: n }                          tallyParts of the bucket
 *   expected  { [type]: total | null }               HubSpot's own count
 * Returns { complete, rows } with one row per type. Pure.
 *
 * A type is short when it isn't finished, when a part file is missing, or
 * when it saved fewer records than HubSpot holds. More than HubSpot holds is
 * fine (records created while the backup ran).
 */
export function verifyRun({ objectTypes = [], reported = {}, partFiles = {}, expected = {}, typeErrors = {} }) {
  const rows = objectTypes.map(type => {
    const r = reported[type] || { records: 0, parts: 0, done: false };
    const exp = expected[type] ?? null;
    const problems = [];
    if (typeErrors[type]) problems.push(typeErrors[type]);
    if (!r.done) problems.push('not finished');
    if ((partFiles[type] || 0) < (r.parts || 0)) problems.push(`${r.parts - (partFiles[type] || 0)} part file(s) missing from storage`);
    if (exp != null && r.records < exp) problems.push(`saved ${r.records} of ${exp}`);
    return { type, records: r.records || 0, parts: partFiles[type] || 0, expected: exp, ok: problems.length === 0, problems };
  });
  return { complete: rows.every(r => r.ok), rows };
}

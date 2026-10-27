// Assertion tests for the HubSpot portal backup (api/_lib/hubspotBackup.js,
// api/hubspot-backup.js). Plain Node, no framework. Run:
//   node scripts/hubspotBackup.test.mjs
//
// What has to hold:
//   * the backup never writes to HubSpot: every request is a GET, a search,
//     a batch read, or the lists search,
//   * a type is read page by page from its cursor, every property is asked
//     for, and associations (including ones past the first answer's page)
//     land on their records,
//   * a chunk stops at its time budget or its size cap and hands back the
//     cursor,
//   * the verdict flags unfinished types, missing part files and short
//     counts, and accepts more records than HubSpot counted,
//   * start -> chunk -> finish saves schema, part files and a manifest under
//     the run's prefix, and a token swapped mid-run is refused.
import {
  readChunk, collectSchema, tallyParts, verifyRun, runPrefix, partName, associationTargets,
} from '../api/_lib/hubspotBackup.js';
import { hubspotClient } from '../api/_lib/hubspotMove.js';
import { handlerForTests as handler } from '../api/hubspot-backup.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

function fakeRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; },
  };
  return res;
}

const READ_POST = /\/(search|batch\/read)$/;

// A tiny HubSpot: 250 contacts, 2 companies, contact 1 linked to both
// companies with the second link on a further page. Records every request.
function fakeHubspot({ portalId = 111 } = {}) {
  const calls = [];
  const contacts = Array.from({ length: 250 }, (_, i) => String(i + 1));
  const json = (body, status = 200) => ({
    ok: status < 400, status, headers: { get: () => null },
    json: async () => body, text: async () => JSON.stringify(body),
  });
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(url);
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ method, path: u.pathname, body });
    const p = u.pathname;
    if (p === '/account-info/v3/details') return json({ portalId, uiDomain: 'app.hubspot.com' });
    if (p === '/crm/v3/schemas') return json({ results: [] });
    if (p.startsWith('/crm/v3/properties/')) {
      if (p.endsWith('/groups')) return json({ results: [{ name: 'info' }] });
      if (p.includes('/tickets')) return json({ status: 'error' }, 403);
      return json({ results: [{ name: 'email' }, { name: 'firstname' }, { name: 'dans_tags' }] });
    }
    if (p.startsWith('/crm/v3/pipelines/')) return json({ results: [{ id: 'default' }] });
    if (p === '/crm/v3/owners') return json({ results: [{ id: '77', email: 'dan@x.com' }] });
    if (p === '/crm/v3/lists/search') return json({ lists: [{ listId: '1' }], hasMore: false });
    if (p === '/crm/v3/objects/contacts' && method === 'GET') {
      const after = Number(u.searchParams.get('after') || 0);
      const ids = contacts.slice(after, after + 100);
      const next = after + 100 < contacts.length ? { next: { after: String(after + 100) } } : undefined;
      return json({ results: ids.map(id => ({ id })), paging: next });
    }
    if (p === '/crm/v3/objects/contacts/batch/read') {
      return json({ results: body.inputs.map(({ id }) => ({ id, properties: { email: `c${id}@x.com`, dans_tags: 'Key' } })) });
    }
    if (p === '/crm/v4/associations/contacts/companies/batch/read') {
      const has1 = body.inputs.some(i => i.id === '1');
      return json({ results: has1 ? [{ from: { id: '1' }, to: [{ toObjectId: 501, associationTypes: [{ category: 'HUBSPOT_DEFINED', typeId: 1, label: 'Primary' }] }], paging: { next: { after: 'X' } } }] : [] });
    }
    if (p === '/crm/v4/objects/contacts/1/associations/companies') {
      return json({ results: [{ toObjectId: 502, associationTypes: [{ category: 'HUBSPOT_DEFINED', typeId: 279, label: null }] }] });
    }
    if (p.startsWith('/crm/v4/associations/contacts/tickets')) return json({ message: 'missing scope' }, 403);
    if (p.startsWith('/crm/v4/associations/')) return json({ results: [] });
    if (p.endsWith('/search')) return json({ total: p.includes('contacts') ? 250 : 0, results: [] });
    if (p.startsWith('/crm/v3/objects/') && method === 'GET') return json({ results: [] });
    return json({ message: `unexpected ${method} ${p}` }, 404);
  };
  return { calls, fetchImpl };
}

const noSleep = async () => {};
const writes = (calls) => calls.filter(c => c.method !== 'GET' && !READ_POST.test(c.path) && c.path !== '/crm/v3/lists/search');

// ── pure helpers ─────────────────────────────────────────────────────────
eq(associationTargets('emails'), ['contacts', 'companies', 'deals', 'tickets'], 'logged emails keep their contact, company, deal and ticket links');
eq(associationTargets('2-123'), ['contacts', 'companies', 'deals'], 'custom objects keep their CRM links');
eq(partName(runPrefix('111', '2026-10-27T10-00-00Z'), 'contacts', 3), 'hubspot-backup/111/2026-10-27T10-00-00Z/contacts-0003.json', 'part file naming');
{
  let threw = false;
  try { runPrefix('111', '../other'); } catch { threw = true; }
  eq(threw, true, 'a run id cannot climb out of the backup folder');
}
{
  const pre = 'hubspot-backup/111/R/';
  eq(tallyParts([`${pre}schema.json`, `${pre}contacts-0001.json`, `${pre}contacts-0002.json`, `${pre}2-55-0001.json`, 'hubspot-backup/111/S/contacts-0001.json'], pre),
    { contacts: 2, '2-55': 1 }, 'part files are tallied per type, custom objects included, other runs ignored');
}
{
  const v = verifyRun({
    objectTypes: ['contacts', 'companies', 'deals', 'emails', 'calls'],
    reported: {
      contacts: { records: 250, parts: 2, done: true },
      companies: { records: 12, parts: 1, done: true },
      deals: { records: 3, parts: 1, done: false },
      emails: { records: 90, parts: 1, done: true },
      calls: { records: 5, parts: 2, done: true },
    },
    partFiles: { contacts: 2, companies: 1, deals: 1, emails: 1, calls: 1 },
    expected: { contacts: 250, companies: 10, deals: 3, emails: 100, calls: null },
  });
  eq(v.rows.map(r => [r.type, r.ok]), [['contacts', true], ['companies', true], ['deals', false], ['emails', false], ['calls', false]],
    'verdict: whole, more than counted is fine, unfinished, short, missing part file');
  eq(v.complete, false, 'any short type makes the run incomplete');
  eq(v.rows.find(r => r.type === 'emails').problems, ['saved 90 of 100'], 'a short count says by how much');
}

// ── readChunk ────────────────────────────────────────────────────────────
{
  const hs = fakeHubspot();
  const client = hubspotClient('t', { fetchImpl: hs.fetchImpl, sleep: noSleep });
  const all = await readChunk(client, 'contacts', { budgetMs: 1e9 });
  eq([all.records.length, all.next], [250, ''], 'a generous budget reads the whole type');
  eq(all.records[0].properties, { email: 'c1@x.com', dans_tags: 'Key' }, 'every property comes back');
  eq(all.records[0].associations.companies.map(a => a.id), ['501', '502'], 'associations past the first page are followed');
  eq(all.records[0].associations.companies[0].types[0].label, 'Primary', 'association labels are kept');
  eq(Object.keys(all.associationErrors), ['tickets'], 'an unreadable association pair is reported, not fatal');
  const batch = hs.calls.find(c => c.path === '/crm/v3/objects/contacts/batch/read');
  eq(batch.body.properties, ['email', 'firstname', 'dans_tags'], 'the batch read asks for every property the type has');
  eq(writes(hs.calls), [], 'readChunk never writes to HubSpot');

  // A clock that jumps past the budget after the first page.
  let t = 0;
  const hs2 = fakeHubspot();
  const c2 = hubspotClient('t', { fetchImpl: hs2.fetchImpl, sleep: noSleep });
  const first = await readChunk(c2, 'contacts', { budgetMs: 10, now: () => (t += 20) });
  eq([first.records.length, first.next], [100, '100'], 'a chunk stops at its budget and hands back the cursor');
  const rest = await readChunk(c2, 'contacts', { after: first.next, budgetMs: 1e9 });
  eq([rest.records.length, rest.records[0].id], [150, '101'], 'continuing from the cursor picks up where it stopped');
}

{
  // Big records (logged emails with their HTML bodies) stop at the size
  // cap long before the time budget.
  const hs = fakeHubspot();
  const client = hubspotClient('t', { fetchImpl: hs.fetchImpl, sleep: noSleep });
  const capped = await readChunk(client, 'contacts', { budgetMs: 1e9, maxBytes: 100 });
  eq([capped.records.length, capped.next], [100, '100'], 'a chunk stops at its size cap after the page that crossed it');
}

// ── collectSchema ────────────────────────────────────────────────────────
{
  const hs = fakeHubspot();
  const client = hubspotClient('t', { fetchImpl: hs.fetchImpl, sleep: noSleep });
  const { schema, objectTypes } = await collectSchema(client);
  eq(objectTypes.includes('tickets'), false, 'a type whose properties are unreadable is left out of the run');
  eq(Object.keys(schema.errors).includes('properties:tickets'), true, '...and its error is recorded');
  eq([schema.owners.length > 0, schema.lists.length, schema.pipelines.deals.length], [true, 1, 1], 'owners, lists and pipelines are captured');
  eq(writes(hs.calls), [], 'collectSchema never writes to HubSpot');
}

// ── handler: start -> chunk -> finish ────────────────────────────────────
{
  process.env.HUBSPOT_ACCESS_TOKEN = 't';
  process.env.BACKUP_GCS_BUCKET = 'b';
  const saved = new Map();
  const gcs = {
    uploadJsonToGcs: async ({ name, content }) => { saved.set(name, content); return {}; },
    listBackupObjects: async ({ prefix }) => [...saved.keys()].filter(n => n.startsWith(prefix)).map(name => ({ name, size: saved.get(name).length })),
    downloadGcsObject: async ({ name }) => saved.get(name),
  };
  const hs = fakeHubspot();
  const deps = { fetchImpl: hs.fetchImpl, sleep: noSleep, gcs, now: () => Date.parse('2026-10-27T10:00:00Z') };
  const admin = { email: 'baldaufdan@gmail.com' };
  const post = async (action, body, auth = admin, d = deps) => {
    const res = fakeRes();
    await handler({ method: 'POST', query: { action }, body }, res, auth, d);
    return res;
  };

  eq((await post('start', {}, { email: 'someone@else.com' })).statusCode, 403, 'only the admin can run a backup');

  const start = (await post('start', {})).body;
  eq([start.portalId, start.runId], ['111', '2026-10-27T10-00-00Z'], 'start names the portal and the run');
  const prefix = runPrefix(start.portalId, start.runId);
  eq(saved.has(`${prefix}schema.json`), true, 'start saves the schema file');

  const reported = {};
  for (const type of start.objectTypes) {
    // Real time here: the chunks run on a generous budget.
    const chunk = (await post('chunk', { portalId: start.portalId, runId: start.runId, type, after: '', part: 1 }, admin, { ...deps, now: undefined })).body;
    reported[type] = { records: chunk.records, parts: 1, done: !chunk.next };
  }
  eq(reported.contacts, { records: 250, parts: 1, done: true }, 'the contacts chunk saved all 250');
  const part = JSON.parse(saved.get(partName(prefix, 'contacts', 1)));
  eq([part.count, part.records.length], [250, 250], 'the part file holds the records');

  const fin = (await post('finish', { portalId: start.portalId, runId: start.runId, objectTypes: start.objectTypes, reported })).body;
  eq(fin.complete, true, 'every type checked against HubSpot: complete');
  eq(saved.has(`${prefix}manifest.json`), true, 'finish saves the manifest');

  const runsRes = fakeRes();
  await handler({ method: 'GET', query: { action: 'runs' }, body: {} }, runsRes, admin, deps);
  eq([runsRes.body.runs.length, runsRes.body.runs[0].manifest?.complete], [1, true], 'the run is listed with its verdict');

  // The token now belongs to another portal.
  const other = fakeHubspot({ portalId: 222 });
  let swapped = null;
  try { await post('chunk', { portalId: '111', runId: start.runId, type: 'contacts', part: 2 }, admin, { ...deps, fetchImpl: other.fetchImpl }); }
  catch (err) { swapped = err; }
  eq(swapped?.status, 409, 'a token swapped mid-run is refused instead of mixing portals');

  eq(writes(hs.calls), [], 'the whole run never writes to HubSpot');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

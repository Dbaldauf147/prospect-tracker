// Assertion tests for the shared-portal guard (api/_lib/hubspotScope.js and
// how api/hubspot.js uses it). Plain Node, no framework. Run:
//   node scripts/hubspotScope.test.mjs
//
// What has to hold:
//   * with neither HUBSPOT_PORTAL_ID nor HUBSPOT_OWNER_EMAIL set, nothing
//     changes and no extra request is made (the personal-portal behaviour),
//   * a token for a different portal than HUBSPOT_PORTAL_ID is refused
//     before anything is read or written,
//   * an owner email the portal doesn't know is refused, not ignored,
//   * when scoped: the contact sync and the activity feed only ask for the
//     owner's records, delete and merge are refused without a request, and
//     an edit to someone else's contact is refused without a write.
import { hubspotScope, clearHubspotScopeCache, HubSpotScopeError } from '../api/_lib/hubspotScope.js';
import { handlerForTests as handler } from '../api/hubspot.js';

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

const ok = (json, status = 200) => ({
  ok: status < 400, status, headers: { get: () => null },
  json: async () => json, text: async () => JSON.stringify(json),
  clone() { return this; },
});

// A shared portal 9001 where owner 77 is daniel.baldauf@se.com. Records
// every request; answers the reads the routes make.
function stubPortal({ portalId = '9001', contactOwners = {} } = {}) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const path = String(url).replace('https://api.hubapi.com', '');
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ method: opts.method || 'GET', path, body });
    if (path === '/account-info/v3/details') return ok({ portalId: Number(portalId) });
    if (path.startsWith('/crm/v3/owners')) return ok({ results: [{ id: '77', userId: 5, email: 'daniel.baldauf@se.com' }] });
    if (path === '/crm/v3/objects/contacts/search') {
      const gt = body.filterGroups[0].filters.find(f => f.propertyName === 'hs_object_id')?.value;
      // Two pages: 200 contacts, then 1.
      const results = gt === '0'
        ? Array.from({ length: 200 }, (_, i) => ({ id: String(i + 1), properties: { email: `c${i}@x.com` } }))
        : [{ id: '999', properties: { email: 'last@x.com' } }];
      return ok({ results });
    }
    if (path === '/crm/v3/objects/contacts/batch/read') {
      return ok({ results: body.inputs.map(i => ({ id: i.id, properties: { hubspot_owner_id: contactOwners[i.id] ?? '' } })) });
    }
    if (path === '/crm/v3/objects/companies/batch/read') return ok({ results: [] });
    if (path === '/crm/v3/objects/emails/search') return ok({ results: [] });
    if (path.startsWith('/crm/v4/associations')) return ok({ results: [] });
    return ok({ id: 'x', properties: {} });
  };
  return calls;
}

function setEnv(vars) {
  delete process.env.HUBSPOT_PORTAL_ID;
  delete process.env.HUBSPOT_OWNER_EMAIL;
  Object.assign(process.env, vars);
  process.env.HUBSPOT_ACCESS_TOKEN = 'tok';
  clearHubspotScopeCache();
}

// ── hubspotScope itself ──────────────────────────────────────────────────
{
  let fetched = 0;
  const s = await hubspotScope('tok', { env: {}, fetchImpl: async () => { fetched++; return ok({}); } });
  eq([s.scoped, fetched], [false, 0], 'no settings: unscoped, and no request made');
}
{
  clearHubspotScopeCache();
  let err = null;
  try {
    await hubspotScope('tok', { env: { HUBSPOT_PORTAL_ID: '4411' }, fetchImpl: async () => ok({ portalId: 9001 }) });
  } catch (e) { err = e; }
  eq([err instanceof HubSpotScopeError, err?.status], [true, 409], 'token for another portal is refused');
}
{
  clearHubspotScopeCache();
  let err = null;
  try {
    await hubspotScope('tok', {
      env: { HUBSPOT_OWNER_EMAIL: 'nobody@se.com' },
      fetchImpl: async () => ok({ results: [{ id: '1', email: 'someone@se.com' }] }),
    });
  } catch (e) { err = e; }
  eq(err instanceof HubSpotScopeError, true, 'an unknown owner email is refused');
}
{
  clearHubspotScopeCache();
  const s = await hubspotScope('tok', {
    env: { HUBSPOT_PORTAL_ID: '9001', HUBSPOT_OWNER_EMAIL: 'Daniel.Baldauf@se.com' },
    fetchImpl: async (url) => (String(url).includes('owners')
      ? ok({ results: [{ id: '77', userId: 5, email: 'daniel.baldauf@se.com' }] })
      : ok({ portalId: 9001 })),
  });
  eq([s.scoped, s.ownerId, s.ownerUserId, s.portalId], [true, '77', '5', '9001'], 'pinned portal + owner resolves');
}

// ── The route refuses a mismatched portal before doing anything ──────────
{
  setEnv({ HUBSPOT_PORTAL_ID: '4411' });
  const calls = stubPortal({ portalId: '9001' });
  const res = fakeRes();
  await handler({ query: { action: 'contacts' }, method: 'GET' }, res);
  eq(res.statusCode, 409, 'mismatched portal answers 409');
  eq(calls.map(c => c.path), ['/account-info/v3/details'], 'and makes no request past the identity check');
}

// ── Scoped: the contact sync only asks for the owner's contacts ──────────
{
  setEnv({ HUBSPOT_PORTAL_ID: '9001', HUBSPOT_OWNER_EMAIL: 'daniel.baldauf@se.com' });
  const calls = stubPortal();
  const res = fakeRes();
  await handler({ query: { action: 'contacts' }, method: 'GET' }, res);
  const searches = calls.filter(c => c.path === '/crm/v3/objects/contacts/search');
  eq(searches.length, 2, 'walks the owner\'s contacts page by page');
  eq(searches.every(c => c.body.filterGroups[0].filters.some(f => f.propertyName === 'hubspot_owner_id' && f.value === '77')), true,
    'every page is filtered to the owner');
  eq(searches[1].body.filterGroups[0].filters.find(f => f.propertyName === 'hs_object_id').value, '200',
    'the second page continues after the last id seen');
  eq(res.body.total, 201, 'returns all of them');
  eq(calls.some(c => c.path.startsWith('/crm/v3/objects/contacts?')), false, 'never lists the whole portal');
}

// ── Scoped: the activity feed only asks for the owner's activity ─────────
{
  setEnv({ HUBSPOT_PORTAL_ID: '9001', HUBSPOT_OWNER_EMAIL: 'daniel.baldauf@se.com' });
  const calls = stubPortal();
  await handler({ query: { action: 'activity', type: 'email', after: '0~1700000000000' }, method: 'GET' }, fakeRes());
  const search = calls.find(c => c.path === '/crm/v3/objects/emails/search');
  eq(search.body.filterGroups[0].filters.map(f => f.propertyName), ['hubspot_owner_id', 'hs_timestamp'],
    'activity search carries the owner filter alongside the window');
}

// ── Scoped: delete and merge are off, and nothing is sent ────────────────
{
  setEnv({ HUBSPOT_PORTAL_ID: '9001', HUBSPOT_OWNER_EMAIL: 'daniel.baldauf@se.com' });
  for (const [action, body] of [['delete-contact', { contactId: '5' }], ['merge-contacts', { primaryObjectId: '5', objectIdToMerge: '6' }]]) {
    const calls = stubPortal();
    const res = fakeRes();
    await handler({ query: { action }, method: 'POST', body }, res);
    eq([res.statusCode, calls.some(c => c.method === 'DELETE' || c.path.includes('merge'))], [403, false], `${action} refused without a request`);
  }
}

// ── Scoped: edits to someone else's contact are refused ──────────────────
{
  setEnv({ HUBSPOT_PORTAL_ID: '9001', HUBSPOT_OWNER_EMAIL: 'daniel.baldauf@se.com' });
  let calls = stubPortal({ contactOwners: { 5: '12' } });
  let res = fakeRes();
  await handler({ query: { action: 'update-contact' }, method: 'POST', body: { contactId: '5', properties: { jobtitle: 'CEO' } } }, res);
  eq([res.statusCode, calls.some(c => c.method === 'PATCH')], [403, false], 'update to a colleague\'s contact refused, nothing written');

  calls = stubPortal({ contactOwners: { 5: '77' } });
  res = fakeRes();
  await handler({ query: { action: 'update-contact' }, method: 'POST', body: { contactId: '5', properties: { jobtitle: 'CEO' } } }, res);
  eq([res.statusCode, calls.filter(c => c.method === 'PATCH').map(c => c.path)], [200, ['/crm/v3/objects/contacts/5']], 'update to my own contact goes through');

  calls = stubPortal({ contactOwners: { 5: '77' } });
  await handler({ query: { action: 'update-contact' }, method: 'POST', body: { contactId: '5', properties: { company: 'Acme' } } }, fakeRes());
  eq(calls.some(c => c.method === 'PATCH' && c.path.startsWith('/crm/v3/objects/companies/')), false,
    'a company edit never renames the shared Company record');

  calls = stubPortal();
  await handler({ query: { action: 'create-contact' }, method: 'POST', body: { properties: { email: 'n@x.com' } } }, fakeRes());
  const create = calls.find(c => c.method === 'POST' && c.path === '/crm/v3/objects/contacts');
  eq(create.body.properties.hubspot_owner_id, '77', 'new contacts are created as the owner\'s');
}

// ── Unscoped: delete still works as before ───────────────────────────────
{
  setEnv({});
  const calls = stubPortal();
  const res = fakeRes();
  await handler({ query: { action: 'delete-contact' }, method: 'POST', body: { contactId: '5' } }, res);
  eq([res.statusCode, calls.map(c => c.method)], [200, ['DELETE']], 'no settings: delete behaves as it always has, with no extra request');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

// Assertion tests for the HubSpot move comparison (api/_lib/hubspotMove.js,
// api/hubspot-move.js). Plain Node, no framework. Run:
//   node scripts/hubspotMove.test.mjs
//
// What has to hold:
//   * the comparison never writes to either portal: every request it makes
//     is a GET, a search, or a batch read,
//   * a contact the target lacks is "missing", and one created inside the
//     recent window is marked so (those are the expected gaps),
//   * a value the source holds and the target lost or changed is a diff,
//     but a blank source value never is,
//   * ownership in the target is read off hubspot_owner_id,
//   * custom properties the target lacks, or whose options it lacks, are
//     reported.
import {
  compareCustomProperties, fieldDiffs, classifyContact, classifyCompany, domainKey,
} from '../api/_lib/hubspotMove.js';
import { handlerForTests as handler } from '../api/hubspot-move.js';

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

const NOW = Date.parse('2026-10-08T12:00:00Z');
const RECENT = NOW - 5 * 86400000;

// ── fieldDiffs ───────────────────────────────────────────────────────────
eq(fieldDiffs({ jobtitle: 'VP', phone: '' }, { jobtitle: 'VP' }, ['jobtitle', 'phone']), [],
  'same values and blank source values are not diffs');
eq(fieldDiffs({ jobtitle: 'VP Energy' }, { jobtitle: '' }, ['jobtitle']),
  [{ field: 'jobtitle', source: 'VP Energy', target: '' }], 'a value lost in the target is a diff');
eq(fieldDiffs({ dans_tags: 'ESG;Key' }, { dans_tags: 'key; esg' }, ['dans_tags']), [],
  'multi-select values compare as sets, case-insensitively');
eq(fieldDiffs({ dans_tags: 'ESG;Key' }, { dans_tags: 'ESG' }, ['dans_tags']).length, 1,
  'a tag missing in the target is a diff');

// ── classifyContact ──────────────────────────────────────────────────────
{
  const src = { id: '1', properties: { email: 'a@x.com', firstname: 'A', createdate: '2026-10-06T00:00:00Z', jobtitle: 'CFO' } };
  const r = classifyContact(src, null, { recentSince: RECENT });
  eq([r.status, r.recent], ['missing', true], 'a contact created 2 days ago and absent is missing + recent');
  const old = { id: '2', properties: { email: 'b@x.com', createdate: '2025-01-01T00:00:00Z' } };
  eq(classifyContact(old, null, { recentSince: RECENT }).recent, false, 'an old missing contact is not recent');
  eq(classifyContact({ id: '3', properties: {} }, null).status, 'no-email', 'no email is reported as such');

  const match = { id: '900', properties: { email: 'a@x.com', firstname: 'A', jobtitle: 'CFO', hubspot_owner_id: '77' } };
  eq(classifyContact(src, match, { ownerId: '77' }).owner, 'mine', 'owned by me');
  eq(classifyContact(src, { ...match, properties: { ...match.properties, hubspot_owner_id: '12' } }, { ownerId: '77' }).owner,
    'other', 'owned by someone else');
  eq(classifyContact(src, { ...match, properties: { ...match.properties, hubspot_owner_id: '' } }, { ownerId: '77' }).owner,
    'unowned', 'no owner');
  const linked = classifyContact(src, match, { sourceCompanyName: 'Acme', targetCompanyName: '' });
  eq(linked.diffs.map(d => d.field), ['associated company'], 'a lost company link is a diff');
}

// ── classifyCompany ──────────────────────────────────────────────────────
{
  eq(domainKey('https://www.Acme.com/about'), 'acme.com', 'domainKey strips scheme, www, path');
  const src = { id: '5', properties: { name: 'Acme Corp', domain: 'acme.com', industry: 'Retail' } };
  const cands = [
    { id: '10', properties: { name: 'ACME', domain: 'acme.com', hubspot_owner_id: '12' } },
    { id: '11', properties: { name: 'Acme Corp', domain: 'acme.com', hubspot_owner_id: '77', industry: 'Retail' } },
  ];
  const r = classifyCompany(src, cands, { ownerId: '77' });
  eq([r.status, r.matchedBy, r.candidates, r.owner, r.targetId, r.diffs.length], ['matched', 'domain', 2, 'mine', '11', 0],
    'prefers the candidate I own among several by domain');
  const byName = classifyCompany({ id: '6', properties: { name: 'Beta LLC' } }, [{ id: '12', properties: { name: 'beta llc' } }]);
  eq([byName.status, byName.matchedBy], ['matched', 'name'], 'falls back to name when there is no domain');
  eq(classifyCompany({ id: '7', properties: { name: 'Gamma', domain: 'gamma.io' } }, []).status, 'missing', 'missing company');
}

// ── compareCustomProperties ──────────────────────────────────────────────
{
  const src = [
    { name: 'dans_tags', label: "Dan's Tags", type: 'enumeration', options: ['ESG', 'Key', 'NAM Only'] },
    { name: 'role', label: 'Role', type: 'string', options: [] },
    { name: 'tier', label: 'Tier', type: 'enumeration', options: ['1'] },
  ];
  const tgt = [
    { name: 'dans_tags', type: 'enumeration', options: ['esg', 'Key'] },
    { name: 'tier', type: 'string', options: [] },
  ];
  const out = compareCustomProperties(src, tgt);
  eq(out.map(r => [r.name, r.status]), [['dans_tags', 'options-missing'], ['role', 'missing'], ['tier', 'type-differs']],
    'reports missing properties, type mismatches and missing options');
  eq(out[0].missingOptions, ['NAM Only'], 'option comparison is case-insensitive');
}

// ── The endpoint only ever reads ─────────────────────────────────────────
// A fake pair of portals. The source has two contacts; the target has one
// of them. Every request is recorded so the methods can be asserted.
{
  process.env.HUBSPOT_ACCESS_TOKEN = 'src-token';
  process.env.HUBSPOT_TARGET_ACCESS_TOKEN = 'tgt-token';
  const calls = [];
  const ok = (json) => ({ ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) });
  const fetchImpl = async (url, opts) => {
    const side = opts.headers.Authorization === 'Bearer src-token' ? 'source' : 'target';
    const path = url.replace('https://api.hubapi.com', '');
    calls.push({ side, method: opts.method, path: path.split('?')[0] });
    if (path.startsWith('/crm/v3/owners')) return ok({ results: [{ id: '77', userId: 5, email: 'daniel.baldauf@se.com' }] });
    if (path.startsWith('/crm/v3/properties/')) return ok({ results: [] });
    if (path.startsWith('/crm/v3/objects/contacts?')) {
      return ok({ results: [
        { id: '1', properties: { email: 'kept@x.com', firstname: 'Kept', createdate: '2025-03-01T00:00:00Z', jobtitle: 'CFO' } },
        { id: '2', properties: { email: 'new@x.com', firstname: 'New', createdate: '2026-10-07T00:00:00Z' } },
      ] });
    }
    if (path === '/crm/v3/objects/contacts/batch/read') {
      return ok({ results: [{ id: '900', properties: { email: 'kept@x.com', jobtitle: 'CFO', hubspot_owner_id: '77' } }] });
    }
    if (path === '/crm/v3/objects/companies/batch/read') return ok({ results: [] });
    return { ok: false, status: 404, json: async () => ({}), text: async () => 'unexpected ' + path };
  };
  const res = fakeRes();
  await handler(
    { query: { action: 'compare-contacts', ownerEmail: 'daniel.baldauf@se.com' } },
    res,
    { email: 'baldaufdan@gmail.com' },
    { fetchImpl, sleep: async () => {}, now: () => NOW },
  );
  eq(res.statusCode, 200, 'compare-contacts answers');
  eq(res.body.rows.map(r => [r.email, r.status, r.owner, r.recent]),
    [['kept@x.com', 'matched', 'mine', false], ['new@x.com', 'missing', '', true]],
    'classifies a matched, owned contact and a recent missing one');

  const writes = calls.filter(c => c.method !== 'GET' && !/\/(search|batch\/read)$/.test(c.path));
  eq(writes, [], 'no request writes to either portal');

  const denied = fakeRes();
  await handler({ query: { action: 'overview' } }, denied, { email: 'someone@else.com' }, { fetchImpl });
  eq(denied.statusCode, 403, 'non-admin callers are refused');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

// Saving a company from the Utility Look Up page, with the SDK dead.
//
// The report:
//
//   The live database connection in this tab has crashed (a Firebase SDK
//   bug, not your data), and the fallback save didn't get through either.
//
// That is the LOST-save message, and it was accurate. The settings document
// had an HTTPS fallback for a crashed client; the per-company site lists
// did not, and "Save to <company>" writes one of those:
//
//   updateSettingsPath({ 'companySiteLists.<slug>': entry })
//     → savePathUpdates → applySiteListOps → setDoc(...)  ✗ b815
//
// applySiteListOps threw the assertion straight back out, past the settings
// fallback that never got a turn, and the save was gone — a whole merged
// site list, several hundred KB of it, with nothing but a reload to offer.
//
// Every operation it performs is one document read, write or delete, so
// each has an exact REST equivalent. These tests hold that in place.
//
// Run: node scripts/companySiteListWedgedClient.test.mjs
import { register } from 'node:module';
register('./stubs/loader.mjs', import.meta.url);

const fs = await import('./stubs/firestore.mjs');
const { savePathUpdates, saveUserSettings } = await import('../src/utils/userSettingsSync.js');
const store = await import('../src/utils/companySiteListsStore.js');
const health = await import('../src/utils/firestoreClientHealth.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}

const DOCS = 'https://firestore.googleapis.com/v1/projects/test-project/databases/(default)/documents';
const LIST = 'userSettings/u1/companySiteLists/veris-residential';

const wedgedError = () => new Error(
  'FIRESTORE (12.11.0) INTERNAL ASSERTION FAILED: Unexpected state (ID: b815) '
  + 'CONTEXT: {"Pc":"Error: FIRESTORE (12.11.0) INTERNAL ASSERTION FAILED: '
  + 'Unexpected state (ID: ca9) CONTEXT: {\\"ve\\":-1}"}',
);

// A saved site list, in the shape saveSitesAsCompanySiteList writes.
const entry = (rows = 2) => ({
  company: 'Veris Residential',
  fileName: 'Saved from Utility Look Up',
  headers: ['Site Name', 'Zip', 'Est. Annual Spend'],
  rows: Array.from({ length: rows }, (_, i) => ({
    'Site Name': `Site ${i + 1}`, Zip: '07302', 'Est. Annual Spend': 12000 + i,
  })),
  uploadedAt: '2026-09-09T12:00:00.000Z',
});

let restCalls = [];
const realFetch = globalThis.fetch;
// `pages` lets one test hand back a listing in two pages; anything else
// answers every request the same way.
function stubFetch({ status = 200, body = {}, pages = null } = {}) {
  restCalls = [];
  let page = 0;
  globalThis.fetch = async (url, init) => {
    restCalls.push({ url: String(url), method: init?.method, body: init?.body ? JSON.parse(init.body) : null });
    const payload = pages && init?.method === 'GET' ? (pages[Math.min(page++, pages.length - 1)]) : body;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    };
  };
}
const restore = () => { globalThis.fetch = realFetch; };
const pathOf = (call) => new URL(call.url).pathname.split('/documents/')[1];

function fresh() {
  fs.reset();
  health.__resetClientHealth();
  restCalls = [];
}

// ── The save that was being lost ───────────────────────────────────────
{
  fresh();
  stubFetch();
  // The real crash takes down every call in the tab, the settings document
  // and the site list alike.
  fs.failOn(/^userSettings/, wedgedError());

  const result = await savePathUpdates('u1', { 'companySiteLists.veris-residential': entry() }, {});

  ok(result.stale === false, 'the save completes instead of throwing the assertion');
  ok(result.viaRest === true, 'and reports that it went over HTTPS, so the tab is told to reload');

  const listWrite = restCalls.find(c => pathOf(c) === LIST);
  ok(!!listWrite && listWrite.method === 'PATCH', 'the company\'s site list went up as a PATCH');
  ok(listWrite.url.indexOf('updateMask') === -1,
    'with no update mask, which is how REST spells the whole-document write setDoc() would have done');
  ok(listWrite.body.fields.company.stringValue === 'Veris Residential', 'carrying the company');
  ok(listWrite.body.fields.rows.arrayValue.values.length === 2, 'and every row of the list');
  ok(listWrite.body.fields.rows.arrayValue.values[0].mapValue.fields['Est. Annual Spend'].integerValue === '12000',
    'with the row values encoded, not stringified');

  const stamp = restCalls.find(c => pathOf(c) === 'userSettings/u1');
  ok(!!stamp && Number(stamp.body.fields._lastWriteAt.integerValue) > 0,
    'and the settings document still gets the write stamp other devices watch');
  restore();
}

// ── Once crashed, the site list stops asking the SDK too ───────────────
{
  fresh();
  stubFetch();
  fs.failOn(/^userSettings/, wedgedError());
  await savePathUpdates('u1', { 'companySiteLists.veris-residential': entry() }, {});

  const before = fs.calls.length;
  await savePathUpdates('u1', { 'companySiteLists.veris-residential': entry(3) }, {});
  ok(fs.calls.length === before, 'the second save makes no SDK call at all');
  const listWrite = [...restCalls].reverse().find(c => pathOf(c) === LIST);
  ok(listWrite.body.fields.rows.arrayValue.values.length === 3, 'and still writes the newer list');
  restore();
}

// ── Patching one field inside a company's list ─────────────────────────
{
  fresh();
  stubFetch();
  fs.failOn(/^userSettings/, wedgedError());

  await savePathUpdates('u1', { 'companySiteLists.veris-residential.fileName': 'Pasted rows' }, {});
  const call = restCalls.find(c => pathOf(c) === LIST);
  const mask = [...new URL(call.url).searchParams.getAll('updateMask.fieldPaths')];
  ok(mask.length === 1 && mask[0] === 'fileName',
    'a patch names only the field it touches, so the rest of the list survives');
  ok(call.body.fields.fileName.stringValue === 'Pasted rows', 'and writes it');
  restore();
}

// ── Deleting a company's list ──────────────────────────────────────────
{
  fresh();
  stubFetch();
  fs.failOn(/^userSettings/, wedgedError());

  await savePathUpdates('u1', { 'companySiteLists.veris-residential': null }, {});
  const call = restCalls.find(c => pathOf(c) === LIST);
  ok(call?.method === 'DELETE', 'a cleared company is a DELETE, not an empty document');
  restore();
}

// ── Replacing the whole key (what a settings restore does) ─────────────
{
  fresh();
  stubFetch({
    body: {
      documents: [
        { name: `projects/test-project/databases/(default)/documents/${LIST}` },
        { name: 'projects/test-project/databases/(default)/documents/userSettings/u1/companySiteLists/gone-inc' },
      ],
    },
  });
  fs.failOn(/^userSettings/, wedgedError());

  await saveUserSettings('u1', { companySiteLists: { 'veris-residential': entry() } }, {});

  const listing = restCalls.find(c => c.method === 'GET');
  ok(new URL(listing.url).searchParams.get('mask.fieldPaths') === '_',
    'the listing that decides what to delete asks for ids only, not every stored portfolio');
  ok(restCalls.some(c => pathOf(c) === LIST && c.method === 'PATCH'), 'the company in the map is written');
  const dropped = restCalls.find(c => pathOf(c) === 'userSettings/u1/companySiteLists/gone-inc');
  ok(dropped?.method === 'DELETE', 'and a company absent from it is dropped, as writing the key always meant');
  restore();
}

// A listing that runs to more than one page: stopping at the first would
// leave the companies past it undeleted on a restore.
{
  fresh();
  const doc = (id) => ({ name: `projects/test-project/databases/(default)/documents/userSettings/u1/companySiteLists/${id}` });
  stubFetch({
    pages: [
      { documents: [doc('page-one-inc')], nextPageToken: 'more' },
      { documents: [doc('page-two-inc')] },
    ],
  });
  fs.failOn(/^userSettings/, wedgedError());

  await saveUserSettings('u1', { companySiteLists: {} }, {});
  const deleted = restCalls.filter(c => c.method === 'DELETE').map(pathOf);
  ok(deleted.includes('userSettings/u1/companySiteLists/page-one-inc')
    && deleted.includes('userSettings/u1/companySiteLists/page-two-inc'),
    'every page of the listing is followed');
  restore();
}

// ── Reading the lists back for the stale-write merge ───────────────────
//
// Two laptops saving the same company: the merge needs what the other one
// wrote. With the SDK gone that read has to go over HTTPS too, or the merge
// treats the company as empty and the other laptop's rows are written away.
{
  fresh();
  stubFetch({
    body: {
      fields: {
        company: { stringValue: 'Veris Residential' },
        rows: { arrayValue: { values: [{ mapValue: { fields: { 'Site Name': { stringValue: 'From The Other Laptop' } } } }] } },
      },
    },
  });
  health.noteClientWedged(wedgedError());

  const lists = await store.readCompanySiteLists('u1', ['veris-residential']);
  ok(lists['veris-residential']?.rows?.[0]?.['Site Name'] === 'From The Other Laptop',
    'the other device\'s rows still come back, decoded');
  ok(fs.calls.length === 0, 'without touching the SDK');
  restore();
}

// ── Everything else still fails as it always did ───────────────────────
{
  fresh();
  stubFetch();
  const denied = new Error('Missing or insufficient permissions.');
  denied.code = 'permission-denied';
  fs.failOn(/companySiteLists/, denied);

  let threw = null;
  await savePathUpdates('u1', { 'companySiteLists.veris-residential': entry() }, {})
    .catch((e) => { threw = e; });
  ok(threw === denied, 'a rules rejection on a site list still reaches the caller');
  ok(restCalls.length === 0, 'with no REST attempt behind its back');
  ok(!health.isClientWedged(), 'and the client is not written off');
  restore();
}

// A fallback that fails for a real reason says what it was, rather than
// handing the caller the assertion again.
{
  fresh();
  stubFetch({ status: 429, body: { error: { message: 'Quota exceeded.' } } });
  fs.failOn(/^userSettings/, wedgedError());

  let threw = null;
  await savePathUpdates('u1', { 'companySiteLists.veris-residential': entry() }, {})
    .catch((e) => { threw = e; });
  ok(/HTTP 429/.test(threw?.message || '') && /Quota exceeded/.test(threw?.message || ''),
    'the caller hears the quota, not the internal assertion');
  restore();
}

// ── A healthy client is untouched ──────────────────────────────────────
{
  fresh();
  stubFetch();
  const result = await savePathUpdates('u1', { 'companySiteLists.veris-residential': entry() }, {});
  ok(result.viaRest === false, 'a working SDK is not reported as a fallback save');
  ok(restCalls.length === 0, 'and makes no REST request');
  ok(fs.store.get(LIST)?.company === 'Veris Residential', 'the list is written through the SDK as before');
  restore();
}

// ── A site-list write is enough to raise the notice on its own ─────────
//
// The settings half of the same save may never touch the SDK again (it
// checks the health flag first), so the flag the UI reads has to survive
// the ops half setting it.
{
  fresh();
  stubFetch();
  fs.failOn(new RegExp(`^${LIST}$`), wedgedError());  // only the site list crashes

  const result = await savePathUpdates('u1', { 'companySiteLists.veris-residential': entry() }, {});
  ok(result.viaRest === true, 'a save whose site list fell back is a fallback save');
  ok(health.isClientWedged(), 'and the tab is marked crashed from the site-list write alone');
  restore();
}

restore();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

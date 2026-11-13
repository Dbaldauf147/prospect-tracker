// Assertion tests for the `restore-tags` write (api/hubspot.js). Plain Node —
// no test framework (the project has none). Run:
//   node scripts/tagRestore.test.mjs
//
// This endpoint puts back tags a bad write took off ~85 contacts. It is the
// only place in the app that writes tags in bulk from a FINDING rather than
// from something the user is looking at, so what it must never do:
//
//   * write the audit's idea of the contact. That reading can be hours old;
//     a tag put back by hand since must not be written twice, and a tag added
//     since must not be lost to the restore. Each contact is read now and the
//     missing tags added to THAT, through the same planTagEdit the editors use.
//   * touch a contact whose tags it cannot read. That is the overwrite this
//     whole exercise exists to undo.
//   * attempt "Met In Person", which is not in HubSpot's enumeration and is
//     stripped from every write anyway — the call would just be refused.
import { handlerForTests as handler, setTagDbForTests } from '../api/hubspot.js';
import { loadContactTags, saveContactTags } from '../api/_lib/contactTagStore.js';
import { fakeDb } from './_fakeTagDb.mjs';

// Tags live in the app's store now (api/_lib/contactTagStore.js), so a
// restore writes there and never to HubSpot. Each block gets a fresh store.
let db = null;
const freshStore = () => { db = fakeDb(); setTagDbForTests(db); return db; };
const stored = () => loadContactTags(db, 'test-user');

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

process.env.HUBSPOT_ACCESS_TOKEN = 'test-token';

function fakeRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; },
  };
  return res;
}

// HubSpot stand-in: `held` is what each contact currently carries; ids absent
// from it are contacts HubSpot has no record of. Records every write.
function stubHubSpot(held) {
  freshStore();
  const writes = [];
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (String(url).includes('batch/read')) {
      return {
        ok: true, status: 200, headers: { get: () => null },
        json: async () => ({
          results: body.inputs
            .filter(i => Object.prototype.hasOwnProperty.call(held, i.id))
            .map(i => ({ id: i.id, properties: { dans_tags: held[i.id] } })),
        }),
      };
    }
    writes.push(...body.inputs.map(i => ({ id: i.id, tags: i.properties.dans_tags })));
    return {
      ok: true, status: 200, headers: { get: () => null },
      json: async () => ({ results: body.inputs.map(i => ({ id: i.id })) }),
    };
  };
  return writes;
}

const call = async (body) => {
  const res = fakeRes();
  await handler({ query: { action: 'restore-tags' }, body }, res);
  return res;
};

// --- the dry run is the default -------------------------------------------
{
  const writes = stubHubSpot({ 101: 'ESG' });
  const res = await call({ restores: [{ id: '101', tags: ['Procurement'] }] });
  eq(res.body.dryRun, true, 'a call that does not say otherwise only plans');
  eq(writes.length, 0, 'and writes nothing');
  eq(res.body.plans[0], { id: '101', adding: ['Procurement'], from: 'ESG', to: 'ESG;Procurement', action: 'write' },
    'reporting what it would put back, and what the contact would end up with');
  eq(res.body.willWrite, 1, 'and how many contacts that is');
}

// --- writing --------------------------------------------------------------
{
  const writes = stubHubSpot({ 101: 'ESG', 102: 'Real Estate' });
  const res = await call({
    dryRun: false,
    restores: [{ id: '101', tags: ['Procurement'] }, { id: '102', tags: ['Dan Key Target'] }],
  });
  eq(await stored(), { 101: 'ESG;Procurement', 102: 'Real Estate;Dan Key Target' },
    'the lost tags are added to what each contact holds now, in the app store');
  eq(writes.length, 0, 'and nothing is written to HubSpot');
  eq(res.body.written, 2, 'and the count is the contacts changed');
}

// --- the audit's reading is stale, and that is fine ------------------------
{
  // Put back by hand since the audit: nothing to do, and certainly not twice.
  const writes = stubHubSpot({ 101: 'ESG;Procurement' });
  const res = await call({ dryRun: false, restores: [{ id: '101', tags: ['Procurement'] }] });
  eq([writes.length, await stored()], [0, {}], 'a tag already back is not written again');
  eq(res.body.plans[0].action, 'unchanged', 'it is reported as needing nothing');
}
{
  // Tagged with something else since the audit: the restore must not cost it.
  const writes = stubHubSpot({ 101: 'ESG;Climate Risk' });
  await call({ dryRun: false, restores: [{ id: '101', tags: ['Procurement'] }] });
  eq([writes.length, await stored()], [0, { 101: 'ESG;Climate Risk;Procurement' }],
    'a tag added since the audit survives the restore');
}
{
  // The app's own copy is what "now" means once it has one: HubSpot's stale
  // value for the same contact is ignored.
  const writes = stubHubSpot({ 101: 'ESG' });
  await saveContactTags(db, 'test-user', [{ id: '101', tags: 'ESG;Utilities' }], { source: 'seed' });
  await call({ dryRun: false, restores: [{ id: '101', tags: ['Procurement'] }] });
  eq([writes.length, await stored()], [0, { 101: 'ESG;Utilities;Procurement' }],
    'the restore builds on the stored tags, not HubSpot');
}

// --- a contact HubSpot cannot answer for ----------------------------------
{
  const writes = stubHubSpot({ 101: 'ESG' });   // 999 is not in HubSpot
  const res = await call({ dryRun: false, restores: [{ id: '999', tags: ['Procurement'] }] });
  eq([writes.length, await stored()], [0, {}], 'a contact whose tags cannot be read is never written');
  eq([res.body.plans[0].action, res.body.skipped], ['skip', 1], 'it is skipped, and said out loud');
}

// --- Met In Person --------------------------------------------------------
{
  const writes = stubHubSpot({ 101: 'ESG' });
  const res = await call({ dryRun: false, restores: [{ id: '101', tags: ['Met In Person'] }] });
  eq(res.statusCode, 400, 'a restore of nothing but Met In Person has nothing to do');
  eq(writes.length, 0, 'and is not attempted');

  stubHubSpot({ 101: 'ESG' });
  await call({ dryRun: false, restores: [{ id: '101', tags: ['Met In Person', 'Procurement'] }] });
  eq(await stored(), { 101: 'ESG;Procurement' },
    'alongside a real tag, it is dropped and the rest goes through');
}

// --- refusals -------------------------------------------------------------
{
  stubHubSpot({});
  eq((await call({ restores: [] })).statusCode, 400, 'nothing to restore is a refusal, not an empty write');
  eq((await call({ restores: Array.from({ length: 101 }, (_, i) => ({ id: String(i), tags: ['ESG'] })) })).statusCode,
    400, 'and so is a batch bigger than one call should carry');
}
{
  // The read failing means nothing is known, so nothing is written — the
  // opposite of the bug this restore exists to undo.
  freshStore();
  globalThis.fetch = async () => ({
    ok: false, status: 429, headers: { get: () => null },
    json: async () => ({ message: 'rate limited' }),
  });
  const res = await call({ dryRun: false, restores: [{ id: '101', tags: ['ESG'] }] });
  eq(res.statusCode, 429, 'a rate-limited read stops the restore');
  eq(/[Nn]othing was written/.test(res.body.error), true, 'and says plainly that nothing was written');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

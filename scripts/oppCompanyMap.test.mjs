// Issues > "Opp company not in Table View" > Resolve: mapping a company's
// opps to an existing Table View company, or to one created there.
//
// Run: node scripts/oppCompanyMap.test.mjs
import { register } from 'node:module';
register('./stubs/idbLoader.mjs', import.meta.url);
register('./stubs/loader.mjs', import.meta.url);
const { setDbUserId } = await import('../src/utils/db.js');
const { saveOpps2Cache, loadOpps2Cache } = await import('../src/utils/opps2Store.js');
const { mapOppsToCompany, aliasesWith, mapManyOppsToCompanies } = await import('../src/utils/oppCompanyMap.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}
setDbUserId('t');

const seed = () => saveOpps2Cache({ records: [
  { _id: 'o1', Account: 'Brookfield Properties (BSREP 1 Office)' },
  { _id: 'o2', Account: 'Brookfield Props' },
  { _id: 'o3', Account: 'Apollo' },
], _updatedAt: Date.now() });
const accounts = async () => (await loadOpps2Cache()).records.map(r => r.Account);
const resolve = { kind: 'oppCompany', account: 'Brookfield Properties (BSREP 1 Office)', accounts: ['Brookfield Properties (BSREP 1 Office)', 'Brookfield Props'], oppIds: ['o1', 'o2'] };

// Existing company.
await seed();
const updates = [];
const prospects = [{ id: 'p1', company: 'Brookfield Properties', companyAliases: ['BPY'] }];
const out = await mapOppsToCompany(resolve, { mode: 'existing', record: prospects[0] }, { keepAlias: true },
  { prospects, updateProspect: async (id, patch) => updates.push([id, patch]) });
ok(out.name === 'Brookfield Properties' && out.created === false, 'maps to the picked company');
ok(JSON.stringify(await accounts()) === JSON.stringify(['Brookfield Properties', 'Brookfield Properties', 'Apollo']), 'both opps re-pointed, the other untouched');
ok(JSON.stringify(updates) === JSON.stringify([['p1', { companyAliases: ['BPY', 'Brookfield Properties (BSREP 1 Office)', 'Brookfield Props'] }]]), 'old spellings kept as aliases');

// Created company with a cleaner name.
await seed();
const added = [];
const created = await mapOppsToCompany(resolve, { mode: 'create', name: 'Brookfield BSREP', status: 'Prospect' }, { keepAlias: false },
  { prospects: [], addProspect: async (data) => { added.push(data); return 'new1'; }, updateProspect: async () => { throw new Error('no alias write expected'); } });
ok(created.created === true && JSON.stringify(added) === JSON.stringify([{ company: 'Brookfield BSREP', status: 'Prospect' }]), 'creates the company with its status');
ok((await accounts())[0] === 'Brookfield BSREP', 'and points the opps at it');

// Creating a name the roster already has maps to that one.
await seed();
const dup = await mapOppsToCompany(resolve, { mode: 'create', name: 'brookfield properties' }, { keepAlias: false },
  { prospects, addProspect: async () => 'p1' });
ok(dup.created === false && dup.name === 'Brookfield Properties', 'an existing name is reused, not doubled');

// Guards.
let threw = '';
try { await mapOppsToCompany(resolve, { mode: 'existing', record: null }, {}, {}); } catch (e) { threw = e.message; }
ok(/Pick a Table View company/.test(threw), 'no pick, no save');
threw = '';
try { await mapOppsToCompany(resolve, { mode: 'create', name: '  ' }, {}, { addProspect: async () => 'x' }); } catch (e) { threw = e.message; }
ok(/Type a name/.test(threw), 'a blank new name is refused');

ok(aliasesWith({ company: 'Acme', companyAliases: [] }, ['ACME Inc.', 'Acme']) === null, 'a spelling of its own name is no alias');

// Approve best matches: several rows in one go.
await saveOpps2Cache({ records: [
  { _id: 'a1', Account: 'Brookfield (Calare)' }, { _id: 'a2', Account: 'Brookfield (AVEN)' },
  { _id: 'a3', Account: 'Best Buy Co' }, { _id: 'a4', Account: 'Untouched' },
], _updatedAt: Date.now() });
const many = [];
const bf = { id: 'bf', company: 'Brookfield' };
const bb = { id: 'bb', company: 'Best Buy' };
const res = await mapManyOppsToCompanies([
  { resolve: { account: 'Brookfield (Calare)', accounts: ['Brookfield (Calare)'], oppIds: ['a1'] }, record: bf },
  { resolve: { account: 'Brookfield (AVEN)', accounts: ['Brookfield (AVEN)'], oppIds: ['a2'] }, record: bf },
  { resolve: { account: 'Best Buy Co', oppIds: ['a3'] }, record: bb },
], { keepAlias: true }, { updateProspect: async (id, patch) => many.push([id, patch]) });
ok(res.opps === 3 && res.companies === 2, 'counts the opps and companies');
ok(JSON.stringify(await accounts()) === JSON.stringify(['Brookfield', 'Brookfield', 'Best Buy', 'Untouched']), 'every ticked opp re-pointed in one save');
ok(JSON.stringify(many) === JSON.stringify([['bf', { companyAliases: ['Brookfield (Calare)', 'Brookfield (AVEN)'] }]]), 'one alias write per company, a same-key spelling skipped');
threw = '';
try { await mapManyOppsToCompanies([{ resolve: { oppIds: ['a1'] }, record: null }], {}, {}); } catch (e) { threw = e.message; }
ok(/Nothing to approve/.test(threw), 'nothing valid, nothing saved');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

// A service rename, carried everywhere a service name is stored.
// Plain Node, no test framework. Run:
//   node scripts/serviceRename.test.mjs
//
// What has to hold:
//   1. Opps: Scope (and any column linked to the Solutions list), the
//      unpriced list and the frozen Pricing option are renamed on every
//      record, open or closed; a Scope naming both keeps one.
//   2. Settings beyond the old merge: Depends On / Auto-add / N/A lists,
//      scheduled opps, timelines, a seed service's metadata.
//   3. The Pricing cache, Deal Sizing, Account Potential, the pipeline and
//      hidden timeline bands.
//   4. A store that never named the old service plans to nothing.

import assert from 'node:assert/strict';
import { planServiceMerge, renameInNameString, serviceRenameLogEntry } from '../src/utils/serviceNameMerges.js';
import {
  planOppsRename, renameLineItemServices, renameFeeStructures, renameWorkbookServices,
  renameClientScopeMap, renameEstimate, renamePipeline, renameHiddenBands,
} from '../src/utils/serviceRenamePlans.js';

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS  ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}\n      ${err.message}`); }
}

const FROM = 'Budgets';
const TO = 'Budgets (site level)';

test('a Scope string is renamed in place, and never lists the service twice', () => {
  assert.equal(renameInNameString('GHG, Budgets, Bill payment', FROM, TO), 'GHG, Budgets (site level), Bill payment');
  assert.equal(renameInNameString('budgets', FROM, TO), TO);
  assert.equal(renameInNameString('Budgets, Budgets (site level)', FROM, TO), TO);
  assert.equal(renameInNameString('Budgets (account level)', FROM, TO), null);
  assert.equal(renameInNameString('GHG', FROM, TO), null);
  assert.equal(renameInNameString('', FROM, TO), null);
});

test('every opp naming the service is patched, closed ones included', () => {
  const records = [
    { _id: 'a', Scope: 'Budgets, GHG', Stage: 'Sold' },
    { _id: 'b', Scope: 'GHG', Stage: 'Lead' },
    { _id: 'c', Scope: 'Budgets (account level)', Stage: 'Not Sold' },
    {
      _id: 'd', Scope: 'Budgets', Stage: 'Not Sold',
      _unpricedServices: JSON.stringify(['Budgets']),
      _pricingOption: { services: ['Budgets', 'GHG'], rows: [{ fee: 'x', services: ['Budgets'] }, { fee: 'y', services: ['GHG'] }] },
      'Main service': 'Budgets',
    },
  ];
  const patches = planOppsRename(records, FROM, TO, { 'Main service': { listKey: 'solutions', mode: 'single' } });
  assert.deepEqual(Object.keys(patches).sort(), ['a', 'd']);
  assert.equal(patches.a.Scope, 'Budgets (site level), GHG');
  assert.equal(patches.d.Scope, TO);
  assert.deepEqual(JSON.parse(patches.d._unpricedServices), [TO]);
  assert.deepEqual(patches.d._pricingOption.services, [TO, 'GHG']);
  assert.deepEqual(patches.d._pricingOption.rows[0].services, [TO]);
  assert.deepEqual(patches.d._pricingOption.rows[1].services, ['GHG']);
  assert.equal(patches.d['Main service'], TO);
});

test('the Budgets merge renames the seed board and list, and its metadata', () => {
  const { settingsPatch } = planServiceMerge({ from: FROM, to: TO }, {
    dropdownLists: { solutions: ['Budgets', 'GHG'] },
    serviceOverrides: {
      Budgets: { years: '5 years' },
      'Bill payment': { dependsOn: 'Budgets, GHG', autoAdd: 'Budgets' },
    },
    scheduledOpps: [{ id: '1', scope: 'Budgets, GHG' }, { id: '2', scope: 'GHG' }],
  }, []);
  assert.deepEqual(settingsPatch.dropdownLists.solutions, [TO, 'GHG']);
  assert.equal(settingsPatch.serviceOverrides[TO].years, '5 years');
  assert.equal(settingsPatch.serviceOverrides.Budgets, undefined);
  assert.equal(settingsPatch.serviceOverrides['Bill payment'].dependsOn, 'Budgets (site level), GHG');
  assert.equal(settingsPatch.serviceOverrides['Bill payment'].autoAdd, TO);
  assert.equal(settingsPatch.scheduledOpps[0].scope, 'Budgets (site level), GHG');
  assert.equal(settingsPatch.scheduledOpps[1].scope, 'GHG');
});

test('a timeline tied to the service follows it', () => {
  const { settingsPatch } = planServiceMerge({ from: 'GHG', to: 'GHG reporting' }, {
    timelineTemplates: [{ id: 't', name: 'GHG timeline', services: ['GHG'], stages: [] }],
  }, []);
  assert.deepEqual(settingsPatch.timelineTemplates[0].services, ['GHG reporting']);
});

test('a seed service renamed to a new name keeps its catalogue metadata', () => {
  const { settingsPatch } = planServiceMerge({ from: 'Bill payment', to: 'Bill pay (new)' }, {}, []);
  const meta = settingsPatch.serviceOverrides['Bill pay (new)'];
  assert.ok(meta, 'metadata carried');
  assert.ok(meta.bfoTag, 'bfo tag carried');
});

test('the Pricing cache, Deal Sizing, Account Potential, pipeline and bands', () => {
  assert.deepEqual(
    renameLineItemServices({ 'budget build': ['Budgets'], other: ['GHG'] }, FROM, TO),
    { 'budget build': [TO], other: ['GHG'] },
  );
  assert.equal(renameLineItemServices({ other: ['GHG'] }, FROM, TO), null);
  const fs = renameFeeStructures({ budgets: { standardId: 's' }, ghg: {} }, FROM, TO);
  assert.deepEqual(Object.keys(fs).sort(), ['budgets (site level)', 'ghg']);
  const wb = renameWorkbookServices({ options: [{ servicesCompleted: ['budgets'], priceCheckIgnored: { budgets: ['i1'] } }] }, FROM, TO);
  assert.deepEqual(wb.options[0].servicesCompleted, ['budgets (site level)']);
  assert.deepEqual(wb.options[0].priceCheckIgnored, { 'budgets (site level)': ['i1'] });
  const scopes = renameClientScopeMap({ acme: { services: ['Budgets'], serviceUnits: { Budgets: 4 } }, beta: { services: ['GHG'] } }, FROM, TO);
  assert.deepEqual(scopes.acme, { services: [TO], serviceUnits: { [TO]: 4 } });
  assert.deepEqual(scopes.beta, { services: ['GHG'] });
  assert.deepEqual(renameEstimate({ scenario: { company: 'Acme', services: ['Budgets'], serviceUnits: {} } }, FROM, TO).scenario.services, [TO]);
  assert.deepEqual(renamePipeline({ coverageServices: ['Budgets', 'GHG'] }, FROM, TO).coverageServices, [TO, 'GHG']);
  assert.deepEqual(renameHiddenBands({ opp1: ['budgets'], opp2: ['ghg'] }, FROM, TO), { opp1: ['budgets (site level)'], opp2: ['ghg'] });
});

test('a log entry records the rename, not yet carried to shared stores', () => {
  const e = serviceRenameLogEntry('A', 'B', new Date('2026-09-28T12:00:00Z'));
  assert.equal(e.from, 'A');
  assert.equal(e.to, 'B');
  assert.equal(e.sharedDone, false);
  assert.ok(e.id);
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');

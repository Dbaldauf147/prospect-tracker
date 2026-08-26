// Assertion tests for folding one service name into another. Plain Node — no
// test framework (the project has none). Run:
//   node scripts/serviceNameMerge.test.mjs
//
// The merge rewrites stored data: a client's Services Explored, the board
// layout, the Solutions list. The failure worth guarding is silent data loss
// — a status recorded under the retired spelling that doesn't come across,
// or one recorded under the surviving spelling that gets overwritten by the
// retired one. Both are checked below.
import { readFileSync } from 'node:fs';
import { planServiceMerge, SERVICE_MERGES } from '../src/utils/serviceNameMerges.js';
import { SERVICE_CATEGORIES } from '../src/data/enums.js';
import { SERVICE_CATALOG } from '../src/data/serviceCatalog.js';

// dropdownLists.js imports './enums' without a file extension, which plain
// Node ESM won't resolve (Vite does), so the Solutions list is read as text
// rather than imported.
const SOLUTIONS_SOURCE = readFileSync(new URL('../src/data/dropdownLists.js', import.meta.url), 'utf8');
const solutionsHas = name => SOLUTIONS_SOURCE.includes(`'${name}',`);

let failures = 0;
function check(name, cond, detail) {
  if (cond) return;
  failures += 1;
  console.error(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`);
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `expected ${e}\n     got      ${a}`);
}

const MERGE = { from: 'Rebasline project', to: 'Rebaseline project' };

// --- the seeds agree on one spelling ---------------------------------------
// The merge only holds if the seed lists stop re-introducing the old name on
// a fresh account.
const seedNames = [
  ...SERVICE_CATEGORIES.flatMap(c => c.items),
  ...SERVICE_CATALOG.map(s => s.name),
];
check('no seed still carries the retired spelling',
  !seedNames.some(n => n === MERGE.from),
  `found in seeds: ${seedNames.filter(n => n === MERGE.from).length} time(s)`);
check('the surviving name is in the services board',
  SERVICE_CATEGORIES.some(c => c.items.includes(MERGE.to)));
check('the surviving name is in the Solutions list', solutionsHas(MERGE.to));
check('the Solutions list has dropped the retired spelling', !solutionsHas(MERGE.from));
check('the surviving name carries the seed metadata',
  SERVICE_CATALOG.some(s => s.name === MERGE.to && s.bfoTag === '#SUECO'));
check('the shipped merge matches the names under test',
  SERVICE_MERGES.some(m => m.from === MERGE.from && m.to === MERGE.to));

// --- a clean account plans nothing ------------------------------------------
{
  const { settingsPatch, prospectPatches } = planServiceMerge(MERGE, {
    customServiceCategories: [{ name: 'GHG Reporting', items: ['GHG', 'Rebaseline project'] }],
    dropdownLists: { solutions: ['Audits', 'Rebaseline project'] },
    serviceOverrides: { 'Rebaseline project': { bfoTag: '#SUECO' } },
  }, [{ id: 'p1', servicesExplored: { 'Rebaseline project': 'Sold' } }]);
  eq('clean account: no settings patch', settingsPatch, {});
  eq('clean account: no prospect patches', prospectPatches, []);
}

// --- only the retired name stored: renamed in place --------------------------
{
  const { settingsPatch, prospectPatches } = planServiceMerge(MERGE, {
    customServiceCategories: [
      { name: 'GHG Reporting', items: ['Comp GHG', 'Rebasline project', 'IMP'] },
      { name: 'Renewables', items: ['REOA'] },
    ],
    dropdownLists: { solutions: ['Audits', 'Rebasline project', 'REOA'], stage: ['3'] },
    serviceOverrides: { 'Rebasline project': { bfoTag: '#SUECO', sme: 'Pat' } },
    serviceRenames: { 'Rebasline project': 'Rebaseline' },
    hiddenServices: ['Rebasline project'],
    contractServicesIgnored: ['k:Rebasline project', 'n:tax matrix'],
  }, [
    {
      id: 'p1',
      company: 'Acme',
      servicesExplored: { 'Rebasline project': 'Sold', GHG: 'Explored' },
      serviceNotes: { 'Rebasline project': 'kicked off in May' },
      serviceSMEs: { 'Rebasline project': 'Pat' },
    },
    { id: 'p2', company: 'Beta', servicesExplored: { GHG: 'Sold' } },
  ]);

  eq('rename in place: board layout',
    settingsPatch.customServiceCategories,
    [
      { name: 'GHG Reporting', items: ['Comp GHG', 'Rebaseline project', 'IMP'] },
      { name: 'Renewables', items: ['REOA'] },
    ]);
  eq('rename in place: Solutions list keeps position',
    settingsPatch.dropdownLists.solutions, ['Audits', 'Rebaseline project', 'REOA']);
  eq('rename in place: other lists untouched', settingsPatch.dropdownLists.stage, ['3']);
  eq('rename in place: metadata carried',
    settingsPatch.serviceOverrides, { 'Rebaseline project': { bfoTag: '#SUECO', sme: 'Pat' } });
  eq('rename in place: rename carried',
    settingsPatch.serviceRenames, { 'Rebaseline project': 'Rebaseline' });
  eq('rename in place: hidden set drops the old name', settingsPatch.hiddenServices, []);
  eq('rename in place: ignore key rewritten',
    settingsPatch.contractServicesIgnored, ['k:Rebaseline project', 'n:tax matrix']);

  eq('rename in place: only the affected record is patched',
    prospectPatches.map(p => p.id), ['p1']);
  eq('rename in place: status carried',
    prospectPatches[0].patch.servicesExplored, { GHG: 'Explored', 'Rebaseline project': 'Sold' });
  eq('rename in place: note carried',
    prospectPatches[0].patch.serviceNotes, { 'Rebaseline project': 'kicked off in May' });
  eq('rename in place: SME carried',
    prospectPatches[0].patch.serviceSMEs, { 'Rebaseline project': 'Pat' });
}

// --- both names stored: the survivor wins, the retired one only fills blanks -
{
  const { settingsPatch, prospectPatches } = planServiceMerge(MERGE, {
    customServiceCategories: [
      { name: 'GHG Reporting', items: ['Rebasline project'] },
      { name: 'Other', items: ['Rebaseline project'] },
    ],
    dropdownLists: { solutions: ['Rebaseline project', 'Audits', 'Rebasline project'] },
    serviceOverrides: {
      'Rebasline project': { bfoTag: '#SUECO', region: 'NAM', sme: 'Pat' },
      'Rebaseline project': { bfoTag: '#DATA' },
    },
    hiddenServices: ['Rebasline project', 'Rebaseline project'],
  }, [
    {
      id: 'p1',
      servicesExplored: { 'Rebasline project': 'Explored', 'Rebaseline project': 'Sold' },
      serviceNotes: { 'Rebasline project': 'older note', 'Rebaseline project': '' },
    },
  ]);

  eq('both stored: the survivor keeps its own box',
    settingsPatch.customServiceCategories,
    [{ name: 'GHG Reporting', items: [] }, { name: 'Other', items: ['Rebaseline project'] }]);
  eq('both stored: the duplicate leaves the Solutions list',
    settingsPatch.dropdownLists.solutions, ['Rebaseline project', 'Audits']);
  eq('both stored: metadata is the union, survivor winning field by field',
    settingsPatch.serviceOverrides,
    { 'Rebaseline project': { bfoTag: '#DATA', region: 'NAM', sme: 'Pat' } });
  eq('both stored: a survivor hidden in its own right stays hidden',
    settingsPatch.hiddenServices, ['Rebaseline project']);
  eq('both stored: the survivor’s status is not overwritten',
    prospectPatches[0].patch.servicesExplored, { 'Rebaseline project': 'Sold' });
  eq('both stored: a blank on the survivor takes the retired value',
    prospectPatches[0].patch.serviceNotes, { 'Rebaseline project': 'older note' });
}

// --- casing drift ------------------------------------------------------------
{
  const { prospectPatches } = planServiceMerge(MERGE, {}, [
    { id: 'p1', servicesExplored: { 'rebasline PROJECT': 'Sold' } },
  ]);
  eq('casing drift: matched case-insensitively and written canonically',
    prospectPatches[0].patch.servicesExplored, { 'Rebaseline project': 'Sold' });
}

// --- missing / malformed data doesn't throw ----------------------------------
{
  const plan = planServiceMerge(MERGE, undefined, undefined);
  eq('no settings, no prospects: empty plan', plan.settingsPatch, {});
  eq('no settings, no prospects: no records', plan.prospectPatches, []);
  const odd = planServiceMerge(MERGE, {
    customServiceCategories: 'nope',
    dropdownLists: { solutions: null },
    serviceOverrides: [],
    hiddenServices: 'nope',
  }, [null, { id: 'p1', servicesExplored: 'nope' }]);
  eq('malformed settings are skipped', odd.settingsPatch, {});
  eq('malformed records are skipped', odd.prospectPatches, []);
}

if (failures) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log('serviceNameMerge: all assertions passed.');

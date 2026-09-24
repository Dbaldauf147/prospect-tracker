// Assertion tests for the Sourcing site list (Step by step). Plain Node, no
// test framework. Run:
//   node scripts/savingsSites.test.mjs
//
// What has to hold:
//   1. A record saved before the list existed becomes a one-site list, with
//      its scenario intact.
//   2. Switching swaps the live scenario and keeps the edits made to the one
//      being left.
//   3. Adding opens a blank site; removing the open one opens a neighbour;
//      removing the last leaves a blank one.
//   4. A saved state reads back as itself (the panel compares the two).

import {
  normalizeSavingsState, syncActiveSite, switchSite, addSite, removeSite, MAX_SITES,
} from '../src/utils/nymexSavings.js';

let failures = 0;
function check(label, cond) {
  if (cond) { console.log(`PASS  ${label}`); return; }
  failures += 1;
  console.log(`FAIL  ${label}`);
}

const legacy = normalizeSavingsState({ scenario: { name: 'Joliet', annualVolumeDth: 12000 } });
check('legacy record becomes one site', legacy.sites.length === 1 && legacy.activeSiteId === legacy.sites[0].id);
check('legacy scenario kept', legacy.scenario.name === 'Joliet' && legacy.sites[0].scenario.name === 'Joliet');

let st = addSite(legacy);
const fresh = normalizeSavingsState({}).scenario;
check('a new site takes the default term, not month one of 1900',
  st.scenario.startYear === fresh.startYear && st.scenario.termMonths === fresh.termMonths && st.scenario.annualVolumeDth === fresh.annualVolumeDth);
check('add opens a new blank site', st.sites.length === 2 && st.activeSiteId === st.sites[1].id && st.scenario.name === '');

// Edit the new site the way the panel does (scenario only), then switch.
st = { ...st, scenario: { ...st.scenario, name: 'Gary', annualVolumeDth: 5000 } };
const garyId = st.activeSiteId;
st = switchSite(st, legacy.sites[0].id);
check('switch opens the other site', st.scenario.name === 'Joliet' && st.scenario.annualVolumeDth === 12000);
check('switch keeps the edits to the site left', st.sites.find(x => x.id === garyId).scenario.name === 'Gary');
st = switchSite(st, garyId);
check('switching back restores it', st.scenario.name === 'Gary' && st.scenario.annualVolumeDth === 5000);
check('unknown id changes nothing', switchSite(st, 'nope').activeSiteId === garyId);

// Round trip through storage.
const saved = syncActiveSite(st);
const back = normalizeSavingsState(JSON.parse(JSON.stringify(saved)));
check('saved state reads back as itself', JSON.stringify(back) === JSON.stringify(normalizeSavingsState(back)));
check('saved state keeps both sites and the open one', back.sites.length === 2 && back.activeSiteId === garyId && back.scenario.name === 'Gary');

// Remove.
let r = removeSite(st, garyId);
check('removing the open site opens a neighbour', r.sites.length === 1 && r.scenario.name === 'Joliet');
r = removeSite(r, r.activeSiteId);
check('removing the last leaves a blank site', r.sites.length === 1 && r.scenario.name === '' && r.activeSiteId === r.sites[0].id);
check('that blank site has the default term', r.scenario.startYear === fresh.startYear && r.scenario.termMonths === fresh.termMonths);
r = removeSite(st, legacy.sites[0].id);
check('removing another site keeps the open one', r.activeSiteId === garyId && r.scenario.name === 'Gary' && r.sites.length === 1);

// Cap.
let many = legacy;
for (let i = 0; i < MAX_SITES + 5; i++) many = addSite(many);
check(`list stops at ${MAX_SITES}`, many.sites.length === MAX_SITES);

// Junk.
const junk = normalizeSavingsState({ scenario: { name: 'A' }, sites: [null, { id: '' }, { id: 'x', scenario: { name: 'X' } }, { id: 'x' }], activeSiteId: 'missing' });
check('junk entries and duplicate ids dropped', junk.sites.length === 1 && junk.sites[0].id === 'x');
check('a missing active id falls back to the first site', junk.activeSiteId === 'x');

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nAll passed');

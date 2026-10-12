// The RA Client mapping the company modal's warning writes is the one the
// "Search lists..." panel reads: same key, same synced settings path.
//
// Run: node scripts/listAccountMapping.test.mjs
import {
  RA_CLIENTS_MAP_KEY, listMatchKey, readListField, mapListRow, unmapListRow, mapsToCompany,
} from '../src/utils/listAccountMapping.js';

let passed = 0, failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n  expected ${e}\n  actual   ${a}`); }
}

// A settings object that applies dotted-path writes the way updateSettingsPath does.
function fakeSettings(initial = {}) {
  const box = { settings: initial, writes: [] };
  box.update = (patch) => {
    box.writes.push(patch);
    for (const [path, value] of Object.entries(patch)) {
      const parts = path.split('.');
      const next = structuredClone(box.settings);
      let o = next;
      for (const p of parts.slice(0, -1)) o = (o[p] ||= {});
      o[parts.at(-1)] = value;
      box.settings = next;
    }
  };
  return box;
}

check('match keys are the normalised name', listMatchKey('BRE Hotels & Resorts, Inc.'), listMatchKey('bre hotels and resorts'));
check('a blank name has no key', listMatchKey('  '), '');

const box = fakeSettings({ listMappings: { [RA_CLIENTS_MAP_KEY]: { dismissed: { [listMatchKey('BRE Hotels & Resorts')]: true } } } });
const key = listMatchKey('BRE Hotels & Resorts');
mapListRow(box.settings, box.update, RA_CLIENTS_MAP_KEY, key, 'BRE Hotels & Resorts');
check('mapping is written under the RA Clients key', readListField(box.settings, RA_CLIENTS_MAP_KEY, 'mapping')[key], 'BRE Hotels & Resorts');
check('and clears an earlier dismissal', readListField(box.settings, RA_CLIENTS_MAP_KEY, 'dismissed')[key], undefined);
check('to the synced settings path the panel reads',
  box.writes.map(w => Object.keys(w)[0]), [`listMappings.${RA_CLIENTS_MAP_KEY}.mapping`, `listMappings.${RA_CLIENTS_MAP_KEY}.dismissed`]);
check('the mapped value names the company', mapsToCompany(readListField(box.settings, RA_CLIENTS_MAP_KEY, 'mapping')[key], 'BRE Hotels and Resorts'), true);
check('and not another one', mapsToCompany('BRE Hotels & Resorts', 'Spa Hotels & Resorts'), false);
check('a blank mapping names nothing', mapsToCompany('', ''), false);

unmapListRow(box.settings, box.update, RA_CLIENTS_MAP_KEY, key);
check('unmap removes it', readListField(box.settings, RA_CLIENTS_MAP_KEY, 'mapping')[key], undefined);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

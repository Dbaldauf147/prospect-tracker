// Assertion tests for "Refile from backups" on Dropdowns › Services › Edit
// buckets. Plain Node, no test framework. Run:
//   node scripts/serviceBoardRefile.test.mjs
//
// The bug behind it: a batch of services fell out of their boxes and onto
// the "Other services" card, and nothing on the board remembered where they
// had been. The backups do. Each unfiled service goes back to the box the
// newest backup that had it filed says, and nothing filed since is touched.
import { planBoardRefile, applyBoardRefile } from '../src/utils/serviceBoardRefile.js';

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        expected ${e}\n        got      ${a}`}`);
}

const current = [
  { name: 'Traditional Energy Management', items: ['Strategic sourcing'] },
  { name: 'DATA', items: ['Bill payment'] },
];
const sources = [
  // Newest: already showing the damage, both services unfiled.
  { label: 'cloud backup 2026-10-19', data: { customServiceCategories: current } },
  // A backup with no stored layout was showing the seed and says nothing.
  { label: 'browser backup', data: { ccMap: {} } },
  { label: 'cloud backup 2026-10-17', data: { customServiceCategories: [
    { name: 'traditional energy management', items: ['Strategic sourcing', 'Risk management'] },
    { name: 'Client Services', items: ['Client management'] },
  ] } },
  { label: 'cloud backup 2026-10-01', data: { customServiceCategories: [
    { name: 'DATA', items: ['Risk management', 'Old name'] },
  ] } },
];

{
  const plan = planBoardRefile({}, current, ['Risk management', 'Client management', 'Wasteology'], sources);
  check('newest backup that had it filed wins, matched to the live box spelling',
    plan.found[0], { name: 'Risk management', bucket: 'Traditional Energy Management', label: 'cloud backup 2026-10-17', newBucket: false });
  check('a box that is gone is flagged as coming back',
    plan.found[1], { name: 'Client management', bucket: 'Client Services', label: 'cloud backup 2026-10-17', newBucket: true });
  check('never filed anywhere is missing', plan.missing, ['Wasteology']);
}

{
  const settings = { serviceRenameLog: [{ id: 'a', from: 'Old name', to: 'New name' }] };
  const plan = planBoardRefile(settings, current, ['New name'], sources);
  check('a service renamed since is found under its old name',
    plan.found.map(f => [f.name, f.bucket]), [['New name', 'DATA']]);
}

{
  const next = applyBoardRefile(current, [
    { name: 'Risk management', bucket: 'Traditional Energy Management' },
    { name: 'Client management', bucket: 'Client Services' },
  ]);
  check('refiled into the existing box, sorted', next[0].items, ['Risk management', 'Strategic sourcing']);
  check('a gone box is added back on the end', next[2], { name: 'Client Services', items: ['Client management'] });
  check('other boxes untouched', next[1], current[1]);
  check('nothing to move is null', applyBoardRefile(current, [{ name: 'Bill payment', bucket: 'DATA' }]), null);
}

if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log('\nAll passing');

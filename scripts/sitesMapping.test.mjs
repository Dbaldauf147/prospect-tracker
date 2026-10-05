// Assertion tests for restoring the Utility Lookup column mapping on load.
// Plain Node. Run:
//   node scripts/sitesMapping.test.mjs
//
// The mapping used to be re-guessed from header names on every load, so a
// cost or usage column the user had mapped by hand came back unmapped after
// a refresh and every savings figure went to $0 with the data still there.
import { mergeSavedSitesMapping } from '../src/components/SitesView/sitesMapping.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

const headers = ['Site', 'Zip', 'Elec Spend', 'Usage', 'Electric Cost (old)'];
// What header detection makes of these: it finds the zip and grabs the
// wrong cost column, and can't place "Elec Spend" or "Usage" at all.
const detected = { siteName: 'Site', zip: 'Zip', electricCost: 'Electric Cost (old)', electric: '', gasCost: '' };

{
  const m = mergeSavedSitesMapping(detected, null, headers);
  check('no saved mapping: detection as is', m, detected);
}
{
  const saved = { siteName: 'Site', zip: 'Zip', electricCost: 'Elec Spend', electric: 'Usage', gasCost: '' };
  const m = mergeSavedSitesMapping(detected, saved, headers);
  check('a hand-mapped cost column survives', m.electricCost, 'Elec Spend');
  check('a hand-mapped usage column survives', m.electric, 'Usage');
  check('a field detection agreed on stays', m.zip, 'Zip');
}
{
  // The user deliberately mapped Electric Cost to nothing.
  const m = mergeSavedSitesMapping(detected, { electricCost: '' }, headers);
  check('a saved blank is not re-guessed', m.electricCost, '');
}
{
  // A saved column that is no longer in the rows falls back to detection.
  const m = mergeSavedSitesMapping(detected, { electricCost: 'Gone Column' }, headers);
  check('a saved column that is gone falls back', m.electricCost, 'Electric Cost (old)');
}
{
  // A field the saved mapping never mentions (added since) is detected.
  const m = mergeSavedSitesMapping({ ...detected, country: 'Zip' }, { electricCost: 'Elec Spend' }, headers);
  check('an unmentioned field is detected', m.country, 'Zip');
}

if (failures) {
  console.log(`\n${failures} FAILED`);
  process.exit(1);
}
console.log('\nAll passed');

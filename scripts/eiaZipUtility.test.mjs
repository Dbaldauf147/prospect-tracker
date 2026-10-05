// Assertion tests for the bundled EIA zip -> electric utility table and the
// name tidying the build script applies to it. Plain Node. Run:
//   node scripts/eiaZipUtility.test.mjs
//
// The zips are a real portfolio's (Pursuit Aerospace), which came out of the
// Utility Lookup page with no utility on any US site because no utility file
// had been uploaded.
import { eiaElectricUtilityForZip } from '../src/utils/eiaZipUtility.js';
import { tidyUtilityName } from './buildEiaZipUtilities.mjs';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

check('Manchester, CT', eiaElectricUtilityForZip('06042'), 'Connecticut Light & Power Co');
check('Chicago, IL', eiaElectricUtilityForZip('60639'), 'Commonwealth Edison Co');
check('Morton, IL', eiaElectricUtilityForZip('61550'), 'Ameren Illinois Company');
check('Malden, MA', eiaElectricUtilityForZip('02148'), 'Massachusetts Electric Co');
check('Whitesboro, NY', eiaElectricUtilityForZip('13492'), 'Niagara Mohawk Power Corp.');

// Only a clean 5-digit zip is looked up: a Canadian postal code, a ZIP+4
// that wasn't normalized and an empty cell all come back with nothing.
check('Canadian postal code', eiaElectricUtilityForZip('L3V 6H1'), null);
check('ZIP+4 not normalized', eiaElectricUtilityForZip('06042-1234'), null);
check('blank', eiaElectricUtilityForZip(''), null);
check('null', eiaElectricUtilityForZip(null), null);
check('a zip no utility serves', eiaElectricUtilityForZip('00000'), null);

// The parent company and the state tag come off the display name.
check('parent in brackets', tidyUtilityName('Connecticut Light & Power Co (The) [Eversource Energy]'), 'Connecticut Light & Power Co');
check('state tag', tidyUtilityName('Town of Reading - (MA)'), 'Town of Reading');
check('state tag, no space', tidyUtilityName('Town of Stowe- (VT)'), 'Town of Stowe');
check('left alone', tidyUtilityName('UNS Electric, Inc'), 'UNS Electric, Inc');

if (failures) {
  console.log(`\n${failures} FAILED`);
  process.exit(1);
}
console.log('\nAll passed');

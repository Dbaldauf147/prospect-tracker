// Assertion tests for the split-postal-code address repair.
// Plain Node - no test framework (the project has none). Run:
//   node scripts/siteAddressRepair.test.mjs
//
// What's worth pinning: that a postal code halved across City and Zip is
// rejoined and named for its country, that the city and province come
// back out of the address, and that a row which was already fine, or a
// Country somebody uploaded, is never touched.
import { repairSiteLocation, splitAddressTail } from '../src/utils/siteAddressRepair.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}
const pick = ({ address, city, state, zip, country }) => ({ address, city, state, zip, country });

// Canadian: postal halved across City / Zip, city and province in the address.
check('Canada split', pick(repairSiteLocation({
  address: '96 Glencoe Drive, , Mount Pearl, , NL', city: 'A1N', state: '', zip: '4S9', country: '',
})), { address: '96 Glencoe Drive', city: 'Mount Pearl', state: 'NL', zip: 'A1N 4S9', country: 'Canada' });

check('Canada, London ON', pick(repairSiteLocation({
  address: '1035 Wilton Grove Road, , London, , ON', city: 'N6N', zip: '1C9',
})), { address: '1035 Wilton Grove Road', city: 'London', state: 'ON', zip: 'N6N 1C9', country: 'Canada' });

check('Canada, two-part street kept', pick(repairSiteLocation({
  address: '450 Thomas Street, R.R.4, , Ingersoll, , ON', city: 'N5C', zip: '3J7',
})), { address: '450 Thomas Street, R.R.4', city: 'Ingersoll', state: 'ON', zip: 'N5C 3J7', country: 'Canada' });

// UK: no state slot, city is the last piece.
check('UK split', pick(repairSiteLocation({
  address: 'Belle Eau Park, , Bilsthorpe', city: 'NG22', zip: '8TX',
})), { address: 'Belle Eau Park', city: 'Bilsthorpe', state: '', zip: 'NG22 8TX', country: 'United Kingdom' });

check('UK, multi-part street', pick(repairSiteLocation({
  address: 'Unit 7, Faraday Avenue, Hams Hall Distribution Park, , Coleshill', city: 'B46', zip: '1AL',
})), { address: 'Unit 7, Faraday Avenue, Hams Hall Distribution Park', city: 'Coleshill', state: '', zip: 'B46 1AL', country: 'United Kingdom' });

// Already fine: nothing changes.
const us = { address: '1 Main St', city: 'Boston', state: 'MA', zip: '02108', country: '' };
check('US row untouched', repairSiteLocation(us).changed, []);
check('whole Canadian row untouched but country', repairSiteLocation({
  address: '1 King St W', city: 'Toronto', state: 'ON', zip: 'M5H 1A1', country: 'Canada',
}).changed, []);

// An uploaded Country wins.
check('uploaded country kept', repairSiteLocation({
  address: 'x, , Laval, , QC', city: 'H7J', zip: '3N3', country: 'CA',
}).country, 'CA');

// A whole postal code in Zip still names the country.
check('whole CA zip names country', repairSiteLocation({
  address: '1 King St W', city: 'Toronto', state: '', zip: 'm5h1a1',
}).country, 'Canada');
check('whole CA zip with blank city', pick(repairSiteLocation({
  address: '1 King St W, Toronto, ON', city: '', zip: 'm5h1a1',
})), { address: '1 King St W', city: 'Toronto', state: 'ON', zip: 'M5H 1A1', country: 'Canada' });

// A US zip in City must not be mistaken for a UK outward code.
check('US zip in city untouched', repairSiteLocation({ city: 'Denver', zip: '80202' }).changed, []);

check('tail split', splitAddressTail('Garanor Way, , Portbury'), { street: 'Garanor Way', city: 'Portbury', state: '' });

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

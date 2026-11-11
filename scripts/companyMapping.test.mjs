// The contact popup's "company not on the Table View" check.
import { makeCompanyMappingCheck } from '../src/utils/companyMapping.js';

let passed = 0, failed = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passed += 1; else { failed += 1; console.error(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}

const check1 = makeCompanyMappingCheck([
  { company: 'Piedmont Office Realty Trust Inc.', emailDomain: 'firstname.lastname@piedmontreit.com' },
  { company: 'American Campus Communities (ACC)', website: 'https://www.americancampus.com/about' },
  { company: 'Blackstone' },
  { company: '' },
]);

check('exact name is mapped', check1('Blackstone', '').mapped, true);
check('suffix and case differences still map', check1('piedmont office realty trust', '').mapped, true);
check('punctuation still maps', check1('American Campus Communities ACC', '').mapped, true);
check('mapped has no suggestions', check1('Blackstone', 'a@piedmontreit.com').suggestions, []);

const miss = check1('Piedmont REIT', 'jon@piedmontreit.com');
check('unmapped name', miss.mapped, false);
check('domain suggestion first', miss.suggestions, [{ name: 'Piedmont Office Realty Trust Inc.', via: 'domain' }]);
check('near-name suggestion', check1('American Campus Communities', '').suggestions,
  [{ name: 'American Campus Communities (ACC)', via: 'name' }]);
check('website domain counts', check1('ACC', 'd@americancampus.com').suggestions,
  [{ name: 'American Campus Communities (ACC)', via: 'domain' }]);
check('free mail suggests nothing', check1('Nobody LLC', 'x@gmail.com').suggestions, []);
check('blank company is flagged blank, with a domain suggestion',
  check1('', 'x@piedmontreit.com'), { mapped: false, blank: true, suggestions: [{ name: 'Piedmont Office Realty Trust Inc.', via: 'domain' }] });
check('no prospects: nothing maps', makeCompanyMappingCheck([])('Blackstone', '').mapped, false);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

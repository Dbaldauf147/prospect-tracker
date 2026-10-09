// The Master Analysis "Compliance Site Detail" sheet names each category's
// mandate in its own "<category> Mandate" column, linked to the ordinance
// (siteMandateFor, written by utils/complianceReportXlsx.js). Plain Node. Run:
//   node scripts/complianceSiteDetailMandate.test.mjs
import { siteMandateFor, screenSite } from '../src/utils/complianceMandates.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const hit = (policyName, policyLink = '') => ({ active: true, eligible: true, policyName, policyLink });
const nyc = {
  matched: true, government: 'New York City',
  bbs: hit('Local Law 84', 'https://www.nyc.gov/ll84'), audits: hit('Local Law 87', 'https://www.nyc.gov/ll87'), bps: hit('Local Law 97'),
};
check('name and link, no category prefix', siteMandateFor(nyc, 'bbs'), { name: 'Local Law 84', link: 'https://www.nyc.gov/ll84' });
check('each category its own', siteMandateFor(nyc, 'audits'), { name: 'Local Law 87', link: 'https://www.nyc.gov/ll87' });
check('no link on file: name only', siteMandateFor(nyc, 'bps'), { name: 'Local Law 97', link: '' });
check('not a web address: no link', siteMandateFor({ matched: true, bbs: hit('X', 'see website') }, 'bbs').link, '');
check('under the size requirement: none',
  siteMandateFor({ matched: true, bbs: { active: true, eligible: false, policyName: 'Energize Denver' } }, 'bbs'), null);
check('no name on file: the jurisdiction',
  siteMandateFor({ matched: true, government: 'Austin', bbs: hit('Not available') }, 'bbs').name, 'Austin BBS ordinance');
check('no match: none', siteMandateFor({ matched: false }, 'bbs'), null);

// The screening carries each ordinance's page through: benchmarking's
// `link`, the audits / BPS `url`.
const ny = screenSite({ siteName: 'HQ', city: 'New York', state: 'NY', sqft: 100000, propertyType: 'Office' });
check('screened NYC site is matched', ny.matched, true);
check('BBS link off the ordinance list', /^https:\/\/.*nyc\.gov/.test(siteMandateFor(ny, 'bbs')?.link || ''), true);
check('BPS link off the ordinance list', /^https:\/\/.*nyc\.gov/.test(siteMandateFor(ny, 'bps')?.link || ''), true);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

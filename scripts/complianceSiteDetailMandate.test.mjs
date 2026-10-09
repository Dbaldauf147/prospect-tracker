// The Master Analysis "Compliance Site Detail" sheet names each site's
// mandates in a Mandate column (siteMandateNames, written by
// utils/complianceReportXlsx.js). Plain Node. Run:
//   node scripts/complianceSiteDetailMandate.test.mjs
import { siteMandateNames } from '../src/utils/complianceMandates.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const hit = (policyName, extra = {}) => ({ active: true, eligible: true, policyName, deadline: null, penalty: 1000, ...extra });
const nyc = {
  siteName: 'NYC HQ', city: 'New York', state: 'NY', matched: true, government: 'New York City', govId: 'NYC', sqft: 80000,
  bbs: hit('Local Law 84'), audits: hit('Local Law 87'), bps: hit('Local Law 97'),
};
const dc = {
  siteName: 'DC Office', city: 'Washington', state: 'DC', matched: true, government: 'Washington DC', govId: 'DC', sqft: 60000,
  bbs: hit('Building Energy Performance Standards (BEPS)'), audits: { active: false, eligible: false }, bps: hit('Building Energy Performance Standards (BEPS)'),
};
const small = {
  siteName: 'Small Shop', city: 'Denver', state: 'CO', matched: true, government: 'Denver', govId: 'DEN', sqft: 2000,
  bbs: { active: true, eligible: false, policyName: 'Energize Denver' }, audits: { active: false, eligible: false }, bps: { active: true, eligible: false, policyName: 'Energize Denver' },
};
const unnamed = {
  siteName: 'Unnamed', city: 'Austin', state: 'TX', matched: true, government: 'Austin', govId: 'AUS', sqft: 90000,
  bbs: hit('Not available'), audits: { active: false, eligible: false }, bps: { active: false, eligible: false },
};
const nomatch = { siteName: 'Rural', city: 'Nowhere', state: 'KS', matched: false };

check('one line per ordinance', siteMandateNames(nyc), ['BBS: Local Law 84', 'Energy Audits: Local Law 87', 'BPS: Local Law 97']);
check('one ordinance, two categories: one line', siteMandateNames(dc), ['BBS / BPS: Building Energy Performance Standards (BEPS)']);
check('under the size requirement: no mandate named', siteMandateNames(small), []);
check('no name on file: the jurisdiction', siteMandateNames(unnamed), ['BBS: Austin BBS ordinance']);
check('no match: nothing', siteMandateNames(nomatch), []);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

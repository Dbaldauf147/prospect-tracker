// Assertion tests for complianceFrameworkFlags: which frameworks a
// company's Corporate Compliance answers flag for its pop-up. Run:
//   node scripts/complianceFrameworkFlags.test.mjs
import { complianceFlaggedFrameworks } from '../src/utils/complianceFrameworkFlags.js';
import { computeListFlags } from '../src/utils/listFlags.js';
import { companyScreeningKey } from '../src/data/corporateComplianceScreening.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n     got ${JSON.stringify(actual)}\n     want ${JSON.stringify(expected)}`}`);
}
const flags = (names, screening) => [...complianceFlaggedFrameworks(names, screening)];
const key = companyScreeningKey('US LBM');

check('SB 253 Yes flags CA SB', flags(['US LBM'], { [key]: { 'california__sb-253': 'Yes' } }), ['CA SB']);
check('SB 261 Yes flags CA SB', flags(['US LBM'], { [key]: { 'california__sb-261': 'Yes' } }), ['CA SB']);
check('No / Unknown do not', flags(['US LBM'], { [key]: { 'california__sb-253': 'No', 'california__sb-261': 'Unknown' } }), []);
check('Operating in California alone does not', flags(['US LBM'], { [key]: { california: 'Yes' } }), []);
check('Another company’s answer does not', flags(['Acme'], { [key]: { 'california__sb-253': 'Yes' } }), []);
check('Matched through an alias', flags(['US LBM Holdings Inc', '', 'US LBM'], { [key]: { 'california__sb-253': 'Yes' } }), ['CA SB']);
check('No screening saved', flags(['US LBM'], undefined), []);
check('Derived Yes shown on the card flags CA SB', [...complianceFlaggedFrameworks(['US LBM'], undefined, { [key]: { 'california__sb-261': 'Yes' } })], ['CA SB']);
check('Derived No does not', [...complianceFlaggedFrameworks(['US LBM'], {}, { [key]: { 'california__sb-253': 'No' } })], []);
check('Hand-picked No beats a derived Yes', [...complianceFlaggedFrameworks(['US LBM'], { [key]: { 'california__sb-253': 'No', 'california__sb-261': 'No' } }, { [key]: { 'california__sb-253': 'Yes', 'california__sb-261': 'Yes' } })], []);
check('Card name "US LBM Holdings, LLC" matches popup "US LBM"', [...complianceFlaggedFrameworks(['US LBM'], undefined, { [companyScreeningKey('US LBM Holdings, LLC')]: { 'california__sb-253': 'Yes' } })], ['CA SB']);

// computeListFlags: the shared Frameworks-column source.
const shownYes = { [key]: { 'california__sb-253': 'Yes' } };
const f1 = await computeListFlags(['US LBM'], { prospects: [{ company: 'US LBM' }], compliance: { shown: shownYes } });
check('Frameworks column gets CA SB, marked DAN', [[...(f1.get('us lbm') || [])], [...(f1.compliance.get('us lbm') || [])]], [['CA SB'], ['CA SB']]);
const f2 = await computeListFlags(['US LBM'], { prospects: [{ company: 'US LBM' }] });
check('Without compliance opted in, nothing extra', [...(f2.get('us lbm') || [])], []);
const f3 = await computeListFlags(['Big Co'], { prospects: [{ company: 'Big Co', goesBy: 'US LBM', frameworks: ['CA SB'] }], compliance: { shown: shownYes } });
check('Already flagged by hand: shown, not marked DAN', [[...(f3.get('big co') || [])], f3.compliance.has('big co')], [['CA SB'], false]);

if (failures) { console.error(`\n${failures} failing`); process.exit(1); }
console.log('\nall passed');

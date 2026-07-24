// Assertion tests for the Building Compliance Screening lookup. Plain Node.
// Run:  node scripts/complianceMandates.test.mjs
import {
  lookupGovId, getMandates, screenSite, screenSites,
  classifyPropertyType, eligibilityByOrdinance, totalEligible,
  deadlinesByDate, penaltyByOrdinance, utilityFeedEligibility,
} from '../src/utils/complianceMandates.js';

let pass = 0, fail = 0;
const ok = (c, n) => c ? (pass++, console.log('PASS ', n)) : (fail++, console.log('FAIL ', n));
const eq = (a, b, n) => ok(JSON.stringify(a) === JSON.stringify(b), `${n} (got ${JSON.stringify(a)})`);

// --- two-step lookup -------------------------------------------------------
eq(lookupGovId('Seattle', 'WA'), 'US-WA-Seattl-01', 'Seattle,WA -> govId');
eq(lookupGovId('Seattle', 'Washington'), 'US-WA-Seattl-01', 'Seattle,Washington -> govId');
eq(lookupGovId('Brooklyn', 'NY'), 'US--New Yo-01', 'Brooklyn,NY -> NYC govId (borough alias)');
eq(lookupGovId('Queens', 'NY'), 'US--New Yo-01', 'Queens,NY -> NYC govId (borough alias)');
eq(lookupGovId('Nowhere', 'ZZ'), null, 'unknown city -> null');
ok(getMandates('US-WA-Seattl-01')?.government === 'Seattle', 'getMandates(Seattle)');

// --- property-type classification -----------------------------------------
eq(classifyPropertyType('Multifamily Housing'), 'multifamily', 'classify multifamily');
eq(classifyPropertyType('K-12 School'), 'public', 'classify public');
eq(classifyPropertyType('Office'), 'nonresidential', 'classify nonresidential');

// --- per-site eligibility (Seattle: BBS thr 20k, Audits thr 50k, BPS thr 20k) ---
{
  const big = screenSite({ id: 1, city: 'Seattle', state: 'WA', sqft: 60000, propertyType: 'Office', electricUtility: 'Puget Sound Energy', gasUtility: 'Puget Sound Energy' });
  ok(big.matched && big.bbs.eligible === true, 'Seattle 60k office: BBS eligible');
  ok(big.audits.eligible === true, 'Seattle 60k office: Audits eligible (>=50k)');
  ok(big.bps.eligible === true, 'Seattle 60k office: BPS eligible');
  eq(big.bbs.penalty, 4000, 'Seattle BBS penalty 4000');

  const small = screenSite({ id: 2, city: 'Seattle', state: 'WA', sqft: 30000, propertyType: 'Office' });
  ok(small.bbs.eligible === true, 'Seattle 30k: BBS applicable');
  ok(small.audits.eligible === true, 'Seattle 30k: Audits applicable (ft² threshold ignored)');
  ok(small.audits.meetsThreshold === false, 'Seattle 30k: below Audits threshold (informational only)');

  const noSize = screenSite({ id: 3, city: 'Seattle', state: 'WA', propertyType: 'Office' });
  ok(noSize.bbs.eligible === true, 'no square footage -> still applicable');
  ok(noSize.bbs.meetsThreshold === null, 'no square footage -> meetsThreshold unknown');

  const unmatched = screenSite({ id: 4, city: 'Nowhere', state: 'ZZ', sqft: 99999 });
  ok(unmatched.matched === false, 'unmatched site');
}

// --- aggregations ----------------------------------------------------------
{
  const sites = [
    { id: 1, city: 'Seattle', state: 'WA', sqft: 60000, propertyType: 'Office', electricUtility: 'Puget Sound Energy', gasUtility: 'Puget Sound Energy' },
    { id: 2, city: 'Seattle', state: 'WA', sqft: 60000, propertyType: 'Office', electricUtility: 'Puget Sound Energy', gasUtility: 'Puget Sound Energy' },
    { id: 3, city: 'Atlanta', state: 'GA', sqft: 60000, propertyType: 'Office', electricUtility: 'Georgia Power' },
  ];
  const res = screenSites(sites);
  ok(totalEligible(res, 'bbs') >= 2, 'totalEligible BBS >= 2');
  const byOrd = eligibilityByOrdinance(res, 'bbs');
  ok(byOrd.some(x => x.government === 'Seattle' && x.count === 2), 'eligibilityByOrdinance Seattle=2');
  ok(deadlinesByDate(res, 'bbs').length >= 1, 'deadlinesByDate non-empty');
  ok(penaltyByOrdinance(res, 'bbs').some(x => x.government === 'Seattle' && x.penalty === 8000), 'penalty Seattle 2x4000=8000');
  const feeds = utilityFeedEligibility(res, 'electric');
  ok(feeds.rows.some(x => x.state === 'Washington' && /Puget/.test(x.utility) && x.count === 2), 'utility feed PSE=2');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

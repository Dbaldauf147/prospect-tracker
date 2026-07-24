// Assertion tests for the Building Compliance Screening lookup. Plain Node.
// Run:  node scripts/complianceMandates.test.mjs
import {
  lookupGovId, getMandates, screenSite, screenSites,
  classifyPropertyType, eligibilityByOrdinance, totalEligible,
  deadlinesByDate, penaltyByOrdinance, utilityFeedEligibility,
  buildComplianceRoadmap,
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

// --- roadmap: cumulative sites + fines over time ---------------------------
{
  // Two Seattle sites (BBS 2026-06-01 $4000; Audits 2025-10-01 $20000; BPS
  // 2027-05-01 $15000 each). Cumulative fines/sites must be monotonic and the
  // final cumulative must equal the totals.
  const res = screenSites([
    { id: 1, city: 'Seattle', state: 'WA', sqft: 90000, propertyType: 'Office' },
    { id: 2, city: 'Seattle', state: 'WA', sqft: 90000, propertyType: 'Office' },
  ]);
  const rm = buildComplianceRoadmap(res);
  ok(rm.periods.length >= 2, 'roadmap: multiple quarters');
  ok(rm.totals.sites === 2, 'roadmap: 2 distinct sites in scope');
  ok(rm.totals.obligations === 6, 'roadmap: 6 obligations (2 sites × 3 active)');
  const last = rm.periods[rm.periods.length - 1];
  ok(last.cumSites === 2, 'roadmap: final cumulative sites = 2');
  ok(last.cumObligations === rm.totals.obligations, 'roadmap: final cum obligations = total');
  ok(last.cumFines === rm.totals.fines, 'roadmap: final cum fines = total');
  const monotonic = rm.periods.every((p, i) => i === 0 || (p.cumFines >= rm.periods[i - 1].cumFines && p.cumSites >= rm.periods[i - 1].cumSites));
  ok(monotonic, 'roadmap: cumulative sites & fines are non-decreasing');
  // Earliest obligation is the 2025-10-01 Audits deadline → first period Q4 2025.
  ok(rm.periods[0].label === 'Q4 2025', `roadmap: first period Q4 2025 (got ${rm.periods[0].label})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

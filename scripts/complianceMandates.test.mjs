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

// A bare city name must not cross a border: the city-only fallback is
// rejected when the site's state and the candidate jurisdiction resolve to
// different countries.
eq(lookupGovId('Cambridge', 'Canada'), null, 'Cambridge,Canada -> not Cambridge MA');
eq(lookupGovId('Cambridge', 'ON'), null, 'Cambridge,ON -> not Cambridge MA');
eq(lookupGovId('Cambridge', 'MA'), 'US-MA-Cambri-01', 'Cambridge,MA still resolves');
eq(lookupGovId('Cambridge', ''), 'US-MA-Cambri-01', 'Cambridge with no state unchanged');
eq(lookupGovId('Calgary', 'Canada'), 'CAN-AB-Calgar-01', 'Calgary,Canada resolves');
// Ottawa and Montreal sit in Canada behind a "US-" Government ID prefix, so
// the country test has to read the state name, not the prefix.
eq(lookupGovId('Ottawa', 'Canada'), 'US-ON-Ottawa-01', 'Ottawa,Canada resolves despite US- prefix');
eq(lookupGovId('Montreal', 'Canada'), 'US-QC-Montre-01', 'Montreal,Canada resolves despite US- prefix');
// "PR" in a state column is usually a mis-mapped field, not Puerto Rico, so
// it must not veto anything.
eq(lookupGovId('Montreal', 'PR'), 'US-QC-Montre-01', 'Montreal with a junk PR state resolves');
eq(lookupGovId('Brooklyn', 'Canada'), null, 'Brooklyn,Canada -> not NYC (guard applies to aliases)');
// Same country, different state: Columbus MS was screening as Columbus OH,
// which carries a $1.8M/yr benchmarking penalty.
eq(lookupGovId('Columbus', 'MS'), null, 'Columbus,MS -> not Columbus OH');
eq(lookupGovId('Columbus', 'Mississippi'), null, 'Columbus,Mississippi -> not Columbus OH');
eq(lookupGovId('Columbus', 'OH'), 'US-OH-Columb-01', 'Columbus,OH still resolves');
eq(lookupGovId('Columbus', 'Ohio'), 'US-OH-Columb-01', 'Columbus,Ohio still resolves');
eq(lookupGovId('Columbus', ''), 'US-OH-Columb-01', 'Columbus with no state unchanged');
// The guard is a positive-disagreement test, so an unknown state never vetoes.
eq(lookupGovId('Columbus', 'Multiple'), 'US-OH-Columb-01', 'unresolvable state does not veto');
// Washington DC is not Washington state.
eq(lookupGovId('Seattle', 'DC'), null, 'Seattle,DC -> not Seattle WA');

// --- jurisdictions split across several rows -------------------------------
// Portland, Oregon is two rows in the source workbook: one carries the BPS
// mandate, the other the benchmarking ordinance. Both Government IDs have to
// give the whole jurisdiction, or a Portland site silently misses a mandate.
{
  const a = getMandates('US-OR-Portla-01');
  const b = getMandates('US-OR-Portla-02');
  ok(a.bbs.active === true && b.bbs.active === true, 'Portland OR: BBS active from either Government ID');
  ok(a.bps.active === true && b.bps.active === true, 'Portland OR: BPS active from either Government ID');
  eq(a.govIds, ['US-OR-Portla-01', 'US-OR-Portla-02'], 'Portland OR names both source rows');
  eq(a.raws.length, 2, 'Portland OR keeps both raw rows for the export');
  const site = screenSite({ id: 9, city: 'Portland', state: 'OR', sqft: 50000, propertyType: 'Office' });
  ok(site.bbs.active === true && site.bps.active === true, 'Portland OR site screens against both mandates');
  ok(site.bbs.eligible === true, 'Portland OR 50k office: BBS eligible');
  // Same-name jurisdictions elsewhere stay separate.
  const me = getMandates(lookupGovId('Portland', 'Maine'));
  ok(me.govId === 'US-ME-Portla-01' && me.bps.active === false, 'Portland ME is not merged with Portland OR');
  ok(getMandates(lookupGovId('South Portland', 'ME')).govId === 'US-ME-South -01', 'South Portland ME separate');
}

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

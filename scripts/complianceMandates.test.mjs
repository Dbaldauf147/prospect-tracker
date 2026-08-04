// Assertion tests for the Building Compliance Screening lookup. Plain Node.
// Run:  node scripts/complianceMandates.test.mjs
import {
  lookupGovId, getMandates, screenSite, screenSites,
  classifyPropertyType, eligibilityByOrdinance, totalEligible,
  deadlinesByDate, penaltyByOrdinance, utilityFeedEligibility,
  buildComplianceRoadmap, auditRequirements, auditRequirementsLabel, categoryColumns,
} from '../src/utils/complianceMandates.js';
import MASTER_ORDINANCES from '../src/data/masterOrdinances.js';

let pass = 0, fail = 0;
const ok = (c, n) => c ? (pass++, console.log('PASS ', n)) : (fail++, console.log('FAIL ', n));
const eq = (a, b, n) => ok(JSON.stringify(a) === JSON.stringify(b), `${n} (got ${JSON.stringify(a)})`);

// --- two-step lookup -------------------------------------------------------
eq(lookupGovId('Seattle', 'WA'), 'US-WA-Seattl-01', 'Seattle,WA -> govId');
eq(lookupGovId('Seattle', 'Washington'), 'US-WA-Seattl-01', 'Seattle,Washington -> govId');
eq(lookupGovId('Brooklyn', 'NY'), 'US--New Yo-01', 'Brooklyn,NY -> NYC govId');
eq(lookupGovId('Queens', 'NY'), 'US--New Yo-01', 'Queens,NY -> NYC govId');
eq(lookupGovId('Nowhere', 'ZZ'), null, 'unknown city -> null');
ok(getMandates('US-WA-Seattl-01')?.government === 'Seattle', 'getMandates(Seattle)');

// --- member cities ---------------------------------------------------------
// What the real City Lookup tab buys over the old derived table: a city that
// is covered by another jurisdiction's ordinance resolves to that jurisdiction
// rather than reporting "no match".
eq(lookupGovId('Silver Spring', 'MD'), 'US-MD-Montgo-01', 'Silver Spring,MD -> Montgomery County');
eq(lookupGovId('Gaithersburg', 'Maryland'), 'US-MD-Montgo-01', 'Gaithersburg,MD -> Montgomery County');
eq(lookupGovId('West Hollywood', 'CA'), 'US-CA-Los An-01', 'West Hollywood,CA -> Los Angeles');
eq(lookupGovId('Allston', 'MA'), 'US-MA-Boston-01', 'Allston,MA -> Boston');
eq(lookupGovId('Milwaukie', 'OR'), 'US-OR-Portla-01', 'Milwaukie,OR -> Portland');
// Cities with no ordinance of their own fall to their state's program.
eq(lookupGovId('Sacramento', 'CA'), 'US-CA-Califo-01', 'Sacramento,CA -> California state program');
eq(lookupGovId('Fresno', 'California'), 'US-CA-Califo-01', 'Fresno,CA -> California state program');
eq(lookupGovId('Cambridge', 'ON'), 'CAN-ON-Ontari-01', 'Cambridge,ON -> Ontario program, not Cambridge MA');
// A city ordinance beats the statewide program covering the same city.
eq(lookupGovId('St. Paul', 'MN'), 'US-MN-St. Pa-01', 'St. Paul,MN -> St. Paul, not Minnesota state');
eq(lookupGovId('Boston', 'Massachusetts'), 'US-MA-Boston-01', 'Boston,MA -> Boston, not Massachusetts state');

// A bare city name must not cross a border: the city-only fallback is
// rejected when the site's state and the candidate jurisdiction resolve to
// different countries.
eq(lookupGovId('Cambridge', 'Canada'), null, 'Cambridge,Canada -> not Cambridge MA');
eq(lookupGovId('Cambridge', 'MA'), 'US-MA-Cambri-01', 'Cambridge,MA still resolves');
eq(lookupGovId('Cambridge', ''), 'US-MA-Cambri-01', 'Cambridge with no state -> the one city ordinance of that name');
eq(lookupGovId('Calgary', 'Canada'), 'CAN-AB-Calgar-01', 'Calgary,Canada resolves');
// Ottawa's own benchmarking row is superseded by the province-wide program the
// tab maps every Ontario city to. Montreal sits in Canada behind a "US-"
// Government ID prefix, so the country test has to read the state name.
eq(lookupGovId('Ottawa', 'Canada'), 'CAN-ON-Ontari-01', 'Ottawa,Canada -> Ontario program');
eq(lookupGovId('Ottawa', 'ON'), 'CAN-ON-Ontari-01', 'Ottawa,ON -> Ontario program');
eq(lookupGovId('Montreal', 'Canada'), 'US-QC-Montre-01', 'Montreal,Canada resolves despite US- prefix');
eq(lookupGovId('Toronto', 'ON'), 'CAN-ON-Toront-01', 'Toronto,ON -> Toronto (Government ID left blank in the tab)');
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

// --- benchmarking counts only mandatory programmes -------------------------
// "Active/ Voluntary" benchmarking obliges nobody, so it must not screen as a
// mandate — Calgary's and Edmonton's voluntary programmes each publish a
// $3,900 maximum that was being summed into portfolio exposure.
{
  for (const [city, state] of [['Calgary', 'Alberta'], ['Edmonton', 'Alberta'], ['Winnipeg', 'Manitoba'],
    ['Grand Rapids', 'MI'], ['Longmont', 'CO'], ['Victoria', 'BC']]) {
    const r = screenSite({ id: 1, city, state, sqft: 250000, propertyType: 'Office' });
    ok(r.matched === true, `${city} still resolves to a jurisdiction`);
    ok(r.bbs.active === false && r.bbs.eligible === false, `${city}: voluntary BBS is not a mandate`);
    ok(/voluntary/i.test(getMandates(r.govId).bbs.status), `${city}: the voluntary status is still on file`);
  }
  // Mandatory programmes are untouched, including in the same states.
  for (const [city, state] of [['Vancouver', 'BC'], ['Denver', 'CO'], ['Detroit', 'MI'], ['Seattle', 'WA']]) {
    const r = screenSite({ id: 2, city, state, sqft: 250000, propertyType: 'Office' });
    ok(r.bbs.active === true && r.bbs.eligible === true, `${city}: mandatory BBS still screens`);
  }
  // Longmont keeps the BPS mandate it does carry — only benchmarking drops.
  ok(screenSite({ id: 3, city: 'Longmont', state: 'CO', sqft: 250000, propertyType: 'Office' }).bps.active === true,
    'Longmont: BPS unaffected by the benchmarking rule');
  ok(MASTER_ORDINANCES.every(g => !g.bbs.active || /mandator/i.test(g.bbs.status)),
    'no jurisdiction has an active BBS without a mandatory status');
}

// --- what an audit ordinance asks for --------------------------------------
{
  const la = screenSite({ id: 1, city: 'Los Angeles', state: 'CA', sqft: 250000, propertyType: 'Office' });
  eq(la.audits.requirements.map(r => [r.key, r.level]),
    [['energyAudit', 'required'], ['waterAudit', 'required'], ['rcx', 'required']],
    'Los Angeles audits: energy + water + retro-commissioning');
  eq(la.audits.requirements[0].value, 'ASHRAE Level II', 'a named standard travels with the requirement');
  // "May be required" is conditional, "Optional" is not required — the columns
  // mix all three and the screening has to keep them apart.
  const atl = getMandates(lookupGovId('Atlanta', 'GA'));
  eq(auditRequirements(atl).map(r => [r.key, r.level]),
    [['energyAudit', 'required'], ['waterAudit', 'required'], ['rcx', 'optional']],
    'Atlanta: RCx is optional, not required');
  eq(auditRequirements(getMandates(lookupGovId('Seattle', 'WA'))).map(r => [r.key, r.level]),
    [['rcx', 'conditional'], ['tuneUp', 'conditional']], 'Seattle: both obligations are conditional');
  eq(auditRequirementsLabel(getMandates(lookupGovId('Madison', 'WI'))), 'Tune-up: Mandatory',
    'label reads as one line for a spreadsheet cell');
  // A blank set is missing detail, not an absent ordinance: those still screen.
  const den = screenSite({ id: 2, city: 'Denver', state: 'CO', sqft: 250000, propertyType: 'Office' });
  eq(den.audits.requirements, [], 'Denver publishes no requirement detail');
  ok(den.audits.eligible === true, 'Denver audits still applicable without requirement detail');
  // Only the audits category carries them.
  eq(la.bbs.requirements, [], 'BBS carries no audit requirements');

  // The export columns: the workbook's own order for one category.
  const cols = categoryColumns('audits');
  eq(cols[0], 'Audits - Policy Status', 'audit columns start at the policy status');
  eq(cols.slice(1, 8), ['Audits - Ordinance Name', 'Audits - URL', 'Audits - Due Date',
    'Audits - Compliance Cycle', 'Audits - Sq Thr / Public', 'Audits - Sq Thr / Commercial',
    'Audits - Sq Thr / Multifamily'], 'audit columns keep the workbook order');
  ok(cols.length === 22 && cols.every(c => c.startsWith('Audits - ')), 'every audit column, and only those');
  // No row carries all 22, so the order is merged across rows — it has to match
  // the header order of the richest row it does see.
  for (const want of ['Audits - Eligibility Details', 'Audits - Energy Audit Requirement',
    'Audits - Water Audit Requirement', 'Audits - RCxing Requirement', 'Audits - Tune-Up Requirement',
    'Audits - Required Credentials', 'Audits - Exemption Link', 'Audits - Exemption Criteria',
    'Audits - Performance Exemptions', 'Audits - Enforcement', 'Audits - Max Yearly Penalty Estimation',
    'Audits - Max Yearly Penalty', 'Audits - Considerations']) {
    ok(cols.includes(want), `export carries ${want}`);
  }
  ok(cols.indexOf('Audits - Max Yearly Penalty') > cols.indexOf('Audits - Enforcement'),
    'merged columns keep their relative header order');
  ok(categoryColumns('bbs').every(c => c.startsWith('BBS - ')), 'the same works per category');
  // A merged jurisdiction quotes each category from the row carrying it.
  const pdx = getMandates('US-OR-Portla-01');
  ok(pdx.categoryRaw.bbs['BBS - Policy Status'] === pdx.bbs.status, 'merged BBS detail comes from its own row');
  ok(pdx.categoryRaw.bps['BPS - Policy Status'] === pdx.bps.status, 'merged BPS detail comes from its own row');
  // A one-row jurisdiction carries it too, or its export columns come out blank.
  ok(MASTER_ORDINANCES.every(g => getMandates(g.govId)?.categoryRaw),
    'every jurisdiction carries per-category source rows');
  eq(getMandates(lookupGovId('Atlanta', 'GA')).categoryRaw.audits['Audits - Water Audit Requirement'],
    'Mandatory', 'a single-row jurisdiction quotes its own audit columns');
}

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
  // Same-name jurisdictions elsewhere stay separate. The City Lookup tab keys
  // Portland, Maine to Oregon's Government ID; the build repairs it against the
  // same-named Maine jurisdiction, so a Maine site is not screened against
  // Oregon's BPS mandate.
  const me = getMandates(lookupGovId('Portland', 'Maine'));
  ok(me.govId === 'US-ME-Portla-01' && me.bps.active === false, 'Portland ME is not merged with Portland OR');
  eq(lookupGovId('Portland', 'ME'), 'US-ME-Portla-01', 'Portland,ME -> Maine, not Oregon');
  eq(lookupGovId('South Portland', 'ME'), 'US-ME-Maine-01', 'South Portland,ME -> Maine state program');
  // Two city ordinances share the name, so a state-less Portland is a coin
  // flip the lookup declines to make.
  eq(lookupGovId('Portland', ''), null, 'Portland with no state -> no match (ME vs OR)');
  eq(lookupGovId('Bloomington', ''), null, 'Bloomington with no state -> no match (CA vs MN programs)');
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
  ok(small.bbs.eligible === true, 'Seattle 30k: BBS applicable (over the 20k threshold)');
  ok(small.audits.eligible === false, 'Seattle 30k: Audits not applicable (under the 50k threshold)');
  ok(small.audits.meetsThreshold === false, 'Seattle 30k: below Audits threshold');
  ok(small.audits.sizeAssumed === false, 'Seattle 30k: measured, not assumed');

  // No square footage is taken as meeting the size requirement rather than
  // held out — a missing value is a gap in the uploaded list, not a small
  // building — and the result says the size was assumed.
  const noSize = screenSite({ id: 3, city: 'Seattle', state: 'WA', propertyType: 'Office' });
  ok(noSize.bbs.eligible === true, 'no square footage -> BBS applicable');
  ok(noSize.audits.eligible === true, 'no square footage -> Audits applicable despite the 50k threshold');
  ok(noSize.bbs.meetsThreshold === true, 'no square footage -> threshold taken as met');
  ok(noSize.bbs.sizeAssumed === true, 'no square footage -> flagged as assumed');
  ok(noSize.bbs.applicable === true, 'no square footage -> counts toward the totals');

  const unmatched = screenSite({ id: 4, city: 'Nowhere', state: 'ZZ', sqft: 99999 });
  ok(unmatched.matched === false, 'unmatched site');
}

// --- audits: the ordinance's own building-type scope ------------------------
// An audit requirement is written for particular building types, so a blank
// column means that type isn't covered — the thresholds are not interchangeable
// the way a fallback treated them.
{
  // Austin's audit requirement is multifamily-only (510 ft²). An office there
  // was borrowing that 510 and screening as a mandate.
  const office = screenSite({ id: 1, city: 'Austin', state: 'TX', sqft: 60000, propertyType: 'Office' });
  ok(office.matched === true, 'Austin office resolves');
  ok(office.audits.active === true, 'Austin: the audit ordinance is still on file as in force');
  ok(office.audits.coveredType === false, 'Austin office: not a building type the audit ordinance covers');
  ok(office.audits.eligible === false, 'Austin office: Audits not applicable');
  ok(office.audits.threshold === null, 'Austin office: no size requirement to show');
  ok(office.audits.penalty === null && office.audits.deadline === null, 'Austin office: no fine or deadline rides along');
  const school = screenSite({ id: 2, city: 'Austin', state: 'TX', sqft: 60000, propertyType: 'K-12 School' });
  ok(school.audits.coveredType === false, 'Austin school: not covered either');
  const apts = screenSite({ id: 3, city: 'Austin', state: 'TX', sqft: 60000, propertyType: 'Multifamily Housing' });
  ok(apts.audits.eligible === true && apts.audits.threshold === 510, 'Austin apartments: still covered at 510 ft²');

  // The mirror image: Seattle's, San Francisco's, Philadelphia's and Salt Lake
  // City's audit requirements are commercial-only, so an apartment building
  // must not borrow the commercial threshold.
  for (const [city, state] of [['Seattle', 'WA'], ['San Francisco', 'CA'], ['Philadelphia', 'PA'], ['Salt Lake City', 'UT']]) {
    const mf = screenSite({ id: 4, city, state, sqft: 250000, propertyType: 'Multifamily Housing' });
    ok(mf.audits.coveredType === false, `${city} apartments: commercial-only audit ordinance does not reach multifamily`);
    ok(mf.audits.eligible === false, `${city} apartments: Audits not applicable`);
    const comm = screenSite({ id: 5, city, state, sqft: 250000, propertyType: 'Office' });
    ok(comm.audits.eligible === true, `${city} office: still covered`);
  }

  // Ordinances that publish a commercial or public requirement are untouched:
  // NYC LL87 reaches a 250k ft² office, and a jurisdiction publishing no audit
  // thresholds at all still covers everything.
  ok(screenSite({ id: 6, city: 'New York', state: 'NY', sqft: 250000, propertyType: 'Office' }).audits.eligible === true,
    'NYC office: LL87 audits still applicable');
  ok(screenSite({ id: 7, city: 'Atlanta', state: 'GA', sqft: 60000, propertyType: 'Office' }).audits.eligible === true,
    'Atlanta office: audits still applicable');
  ok(screenSite({ id: 8, city: 'Boston', state: 'MA', sqft: 60000, propertyType: 'K-12 School' }).audits.eligible === true,
    'Boston school: reads the non-residential requirement when no public one is published');
  {
    const denver = screenSite({ id: 9, city: 'Denver', state: 'CO', sqft: 60000, propertyType: 'Office' });
    ok(denver.audits.eligible === true && denver.audits.threshold === null,
      'Denver office: an ordinance publishing no size requirements still covers everything');
  }
  // Property type is only known for some sites; a blank one classifies as
  // non-residential and must keep reading the non-residential column.
  ok(screenSite({ id: 10, city: 'Seattle', state: 'WA', sqft: 250000 }).audits.eligible === true,
    'Seattle site with no property type: still screened against the commercial requirement');
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

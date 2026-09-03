// Assertion tests for the PE Portfolio "Top PC" pick. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/topPortfolioCompany.test.mjs
//
// The column names one company per firm, which is exactly the kind of
// output that is never obviously wrong. Three ways it could lie quietly:
//
//   - scoring the filtered list instead of the whole portfolio, so the
//     number here disagrees with the same company's score on All PCs;
//   - a loose name match pulling someone else's "Hold Off" over and
//     knocking the real top company out;
//   - an unscored (N/A) row being read as zero and winning a portfolio
//     where nothing else is scored either.
import {
  pickTopPortfolioCompany,
  buildStatusIndex,
  lookupCompanyStatus,
  topPcCompanyKey,
  topPcCompanyKeys,
  TOP_PC_EXCLUDED_STATUSES,
} from '../src/utils/topPortfolioCompany.js';
import { computePortfolioFitScore, siteCountNumber } from '../src/utils/portfolioCompaniesWorkbook.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// An explicit Opportunity Score is used verbatim, which keeps these cases
// readable — the composite methodology has its own tests upstream.
const pc = (companyName, opportunityScore, hqCity, hqCountry) =>
  ({ companyName, opportunityScore, hqCity, hqCountry });

// ---- the pick ---------------------------------------------------------------

eq(pickTopPortfolioCompany([], new Map()), null, 'no portfolio, no pick');
eq(pickTopPortfolioCompany(undefined, new Map()), null, 'a firm with nothing mapped is handled');

const basic = [
  pc('Acme Foods', 71, 'Dallas', 'United States'),
  pc('Northwind Logistics', 88, 'Toronto', 'Canada'),
  pc('Contoso Metals', 64, 'Chicago', 'United States'),
];
eq(pickTopPortfolioCompany(basic, new Map()).companyName, 'Northwind Logistics',
  'the highest score wins');
eq(pickTopPortfolioCompany(basic, new Map()).score, 88, 'and carries its score');

// ---- the North America filter ----------------------------------------------

const mixed = [
  pc('Zug Chemicals', 97, 'Zug', 'Switzerland'),
  pc('Acme Foods', 71, 'Dallas', 'United States'),
];
eq(pickTopPortfolioCompany(mixed, new Map()).companyName, 'Acme Foods',
  'a higher-scoring company outside North America is passed over');
eq(pickTopPortfolioCompany(mixed, new Map()).skippedRegion, 1, 'and is counted as skipped');

// A US state with no country still places a row; a bare city that nothing
// recognises does not, and an unplaceable HQ is left out rather than
// assumed domestic.
eq(pickTopPortfolioCompany([pc('State Only', 50, 'Austin', 'Texas')], new Map())?.companyName,
  'State Only', 'a US state alone is North America');
eq(pickTopPortfolioCompany([pc('No HQ', 50, '', '')], new Map()), null,
  'a row with no HQ at all is not assumed to be North American');
eq(pickTopPortfolioCompany([pc('City Only', 50, 'Springfield', '')], new Map()), null,
  'an unplaceable city is left out too');

// ---- the status filter ------------------------------------------------------

eq(TOP_PC_EXCLUDED_STATUSES, ['Lost - Not Sold', 'Hold Off', 'Client', 'Old Client'],
  'closed, parked and won — now or before — are all out of the running');

const PROSPECTS = [
  { company: 'Northwind Logistics', status: 'Lost - Not Sold' },
  { company: 'Acme Foods, Inc.', status: 'Hold Off' },
  { company: 'Contoso Metals', status: 'Qualifying' },
];
const statuses = buildStatusIndex(PROSPECTS);

const filtered = pickTopPortfolioCompany(basic, statuses);
eq(filtered.companyName, 'Contoso Metals', 'Not Sold and Hold Off are both passed over');
eq(filtered.skippedStatus, 2, 'both are counted as status skips');
eq(filtered.status, 'Qualifying', 'the pick carries the status it was allowed on');

// A Client is already won — it belongs in the PC Clients column, not in
// "who should I be working next".
const withClient = buildStatusIndex([
  ...PROSPECTS.filter(p => p.company !== 'Contoso Metals'),
  { company: 'Contoso Metals', status: 'Client' },
]);
eq(pickTopPortfolioCompany(basic, withClient), null, 'a Client is passed over too');
eq(pickTopPortfolioCompany([
  ...basic,
  pc('Riverbend Plastics', 30, 'Akron', 'United States'),
], withClient).companyName, 'Riverbend Plastics',
'…and the next company down takes the row');
eq(pickTopPortfolioCompany([
  ...basic,
  pc('Riverbend Plastics', 30, 'Akron', 'United States'),
], withClient).skippedStatus, 3, 'all three excluded statuses count as status skips');

// An Old Client is a company we used to serve. Winning it back is its own
// motion off the account, not the cold "who should I be working next" this
// column answers, so it's passed over like a current Client.
const withOldClient = buildStatusIndex([
  ...PROSPECTS.filter(p => p.company !== 'Contoso Metals'),
  { company: 'Contoso Metals', status: 'Old Client' },
]);
eq(pickTopPortfolioCompany(basic, withOldClient), null, 'an Old Client is passed over too');
eq(pickTopPortfolioCompany([
  ...basic,
  pc('Riverbend Plastics', 30, 'Akron', 'United States'),
], withOldClient).companyName, 'Riverbend Plastics',
'…and the next company down takes that row too');

// The same status set on the firm's own portfolio row, which is the way
// the PE Portfolio screenshot that prompted this showed it (QTS Data
// Centers, Old Client, still winning Blackstone's Top PC).
eq(pickTopPortfolioCompany([
  { ...basic[0], status: 'Old Client' },
], new Map()), null, 'an Old Client set on the PC row itself is passed over as well');

// A company with no prospect record has no status to fail — the filter
// drops what we know is closed, not what we know nothing about.
eq(pickTopPortfolioCompany([pc('Unknown Co', 90, 'Boston', 'United States')], statuses)?.companyName,
  'Unknown Co', 'a PC with no tracker record stays eligible');

// Everything filtered out is a blank cell, not a fallback to the best
// excluded row.
eq(pickTopPortfolioCompany([
  pc('Northwind Logistics', 88, 'Toronto', 'Canada'),
  pc('Zug Chemicals', 97, 'Zug', 'Switzerland'),
], statuses), null, 'nothing eligible means no pick at all');

// ---- status set on the PC row itself ----------------------------------------
//
// The reported case: a company marked Hold Off in the pop-up's Portfolio
// Companies table kept coming back as the firm's Top PC, because the filter
// only ever read the tracker prospect record. The row's own Status column is
// the more specific signal — set by hand, on this firm's portfolio — so it
// wins, and it works whether or not the company is tracked separately.

const rowPc = (companyName, opportunityScore, status) =>
  ({ companyName, opportunityScore, status, hqCity: 'Charlotte', hqCountry: 'USA' });

eq(pickTopPortfolioCompany([
  rowPc('Sealed Air', 82, 'Hold Off'),
  rowPc('Riverbend Plastics', 30, ''),
], new Map()).companyName, 'Riverbend Plastics',
'a Hold Off set on the PC row takes it out of the running');
eq(pickTopPortfolioCompany([rowPc('Sealed Air', 82, 'Hold Off')], new Map()), null,
  'even with no tracker record of its own to carry the status');
eq(pickTopPortfolioCompany([
  rowPc('Sealed Air', 82, 'Hold Off'),
  rowPc('Riverbend Plastics', 30, ''),
], new Map()).skippedStatus, 1, 'and it counts as a status skip like any other');

// Row beats record, both ways round: the row is what the user set last.
const RECORD_SAYS = buildStatusIndex([
  { company: 'Sealed Air', status: 'Qualifying' },
  { company: 'Riverbend Plastics', status: 'Hold Off' },
]);
eq(pickTopPortfolioCompany([rowPc('Sealed Air', 82, 'Hold Off')], RECORD_SAYS), null,
  "a row's Hold Off overrides a live tracker status");
eq(pickTopPortfolioCompany([rowPc('Riverbend Plastics', 30, 'Qualifying')], RECORD_SAYS)?.companyName,
  'Riverbend Plastics', "…and a row's live status overrides a parked tracker record");

// An eligible row status is reported as the pick's status, and flagged as
// the row's own so the tooltip can say where it came from.
const fromRow = pickTopPortfolioCompany([rowPc('Contoso Metals', 64, 'Inside Sales')], RECORD_SAYS);
eq([fromRow.status, fromRow.statusFromRow, fromRow.statusCompany], ['Inside Sales', true, ''],
  'the pick reports the row status and that it came from the row');

// A blank row status is not a status — fall back to the tracker record.
eq(pickTopPortfolioCompany([rowPc('Riverbend Plastics', 30, '   ')], RECORD_SAYS), null,
  'a blank row status falls through to the tracker record');
const fromRecord = pickTopPortfolioCompany([rowPc('Sealed Air', 82, '')], RECORD_SAYS);
eq([fromRecord.status, fromRecord.statusFromRow], ['Qualifying', false],
  '…and an inherited status is flagged as not the row\'s own');

// A row status outside the house vocabulary (an uploaded sheet's wording)
// isn't one of the three excluded values, so it can't quietly drop a row.
eq(pickTopPortfolioCompany([rowPc('Sealed Air', 82, 'Pending close')], new Map())?.companyName,
  'Sealed Air', 'an unrecognised row status does not exclude the company');

// ---- name matching ----------------------------------------------------------

eq(topPcCompanyKey('Acme Foods, Inc.'), topPcCompanyKey('acme foods'),
  'legal suffixes and punctuation fall away');
eq(topPcCompanyKey('Acme Foods') === topPcCompanyKey('Acme Foods Manufacturing'), false,
  'but a longer, different name is not the same company');
eq(pickTopPortfolioCompany([pc('Acme Foods Manufacturing', 71, 'Dallas', 'United States')], statuses)?.companyName,
  'Acme Foods Manufacturing', 'a near-name does not inherit another company\'s Hold Off');

// ---- the names the tracker actually uses ------------------------------------
//
// Three shapes the mapped PC rows generally don't carry. Each one used to
// read as "not tracked", so the status filter never saw the record and the
// column kept recommending a company the user had closed off.

eq(topPcCompanyKeys('CPP - Consolidated Precision Products').includes(
  topPcCompanyKey('Consolidated Precision Products')), true,
'an acronym prefix is an alternate name, not part of it');
eq(topPcCompanyKeys('TowerBrook Capital Partners (a Blue Owl co.)').includes(
  topPcCompanyKey('TowerBrook Capital Partners')), true,
'a trailing parenthetical falls away');
eq(topPcCompanyKeys('Perform Properties fka ShopCore').includes(
  topPcCompanyKey('ShopCore')), true, 'a former name is findable too');
eq(topPcCompanyKeys('Acme Foods')[0], topPcCompanyKey('Acme Foods'),
  'the full name always leads, so an exact match still wins');

// A leading word long enough to be a real one is left alone.
eq(topPcCompanyKeys('Perform - Properties').includes(topPcCompanyKey('Properties')), false,
  'a 7-letter first word is not treated as an acronym');

const REAL_NAMES = buildStatusIndex([
  { company: 'CPP - Consolidated Precision Products', status: 'Hold Off' },
  { company: 'TowerBrook Capital Partners (a Blue Owl co.)', status: 'Lost - Not Sold' },
  { company: 'Perform Properties fka ShopCore', status: 'Client' },
]);
eq(lookupCompanyStatus(REAL_NAMES, 'Consolidated Precision Products')?.status, 'Hold Off',
  'the reported case: the Hold Off is found');
eq(lookupCompanyStatus(REAL_NAMES, 'Consolidated Precision Products')?.company,
  'CPP - Consolidated Precision Products', 'and names the record it matched');
eq(lookupCompanyStatus(REAL_NAMES, 'TowerBrook Capital Partners')?.status, 'Lost - Not Sold',
  'a parenthetical suffix no longer hides a Not Sold');
eq(lookupCompanyStatus(REAL_NAMES, 'ShopCore')?.status, 'Client', 'a former name resolves');
eq(lookupCompanyStatus(REAL_NAMES, 'Contoso Metals'), null, 'an unrelated name still matches nothing');

// The reported row, end to end.
eq(pickTopPortfolioCompany(
  [pc('Consolidated Precision Products', 65, 'Cleveland', 'United States'),
    pc('Summit Rail', 40, 'Boston', 'United States')], REAL_NAMES).companyName,
'Summit Rail', 'the parked company is passed over for the next one down');

// An exact full-name record outranks another record's alternate key.
const BOTH = buildStatusIndex([
  { company: 'CPP - Consolidated Precision Products', status: 'Hold Off' },
  { company: 'Consolidated Precision Products', status: 'Client' },
]);
eq(lookupCompanyStatus(BOTH, 'Consolidated Precision Products')?.status, 'Client',
  'the record whose full name matches wins over an alternate');

// When several records share one alternate key, an excluded status wins —
// the filter exists to stop settled companies being recommended. (The
// first record here is deliberately a status that ISN'T excluded, so the
// rule is what decides rather than write order.)
const CLASH = buildStatusIndex([
  { company: 'Northwind Logistics (a Blackstone Co.)', status: 'Qualifying' },
  { company: 'Northwind Logistics (a Blue Owl Co.)', status: 'Hold Off' },
]);
eq(lookupCompanyStatus(CLASH, 'Northwind Logistics')?.status, 'Hold Off',
  'a clash on an alternate key resolves to the excluded one');

// First writer wins, so a stale duplicate can't knock out a live record.
eq(lookupCompanyStatus(buildStatusIndex([
  { company: 'Acme Foods', status: 'Client' },
  { company: 'Acme Foods', status: 'Hold Off' },
]), 'Acme Foods')?.status, 'Client', 'the first record for a name wins');

// ---- unscored rows ----------------------------------------------------------

const withNa = [
  pc('Credit Fund I', 'N/A', 'New York', 'United States'),
  pc('Acme Foods', 71, 'Dallas', 'United States'),
];
eq(pickTopPortfolioCompany(withNa, new Map()).companyName, 'Acme Foods', 'an N/A score cannot win');
eq(pickTopPortfolioCompany(withNa, new Map()).skippedNoScore, 1, 'and is counted separately');
eq(pickTopPortfolioCompany([pc('Credit Fund I', 'N/A', 'New York', 'United States')], new Map()),
  null, 'a portfolio of nothing but N/A has no top company');

// ---- scoring basis ----------------------------------------------------------

// The score is normalized within the firm's whole portfolio, so a row that
// the filters remove still sets the maxima. This is what keeps the number
// in this column equal to the same company's score on the All PCs tab.
const composite = [
  { companyName: 'Euro Giant', sector: 'Industrial / Manufacturing', energyGwh: 1000, siteCount: 200, acquisitionYear: 2020, hqCity: 'Zug', hqCountry: 'Switzerland' },
  { companyName: 'Domestic Mid', sector: 'Industrial / Manufacturing', energyGwh: 100, siteCount: 20, acquisitionYear: 2021, hqCity: 'Dallas', hqCountry: 'United States' },
  { companyName: 'Domestic Small', sector: 'Industrial / Manufacturing', energyGwh: 10, siteCount: 2, acquisitionYear: 2022, hqCity: 'Chicago', hqCountry: 'United States' },
];
// Full basis: the two domestic rows are both tiny against the Euro Giant's
// 1000 GWh / 200 sites, so recency separates them — Small (39) edges Mid
// (37). Scoring only the eligible rows would rebase the maxima onto Mid
// and hand it 84, flipping the winner. So this is not a cosmetic
// difference in the number: getting the basis wrong names a different
// company than the All PCs tab does.
const top = pickTopPortfolioCompany(composite, new Map());
eq([computePortfolioFitScore(composite[1], 1000, 200, { min: 2020, max: 2022 }),
  computePortfolioFitScore(composite[2], 1000, 200, { min: 2020, max: 2022 })],
[37, 39], 'the full-portfolio basis scores Mid 37, Small 39');
eq([computePortfolioFitScore(composite[1], 100, 20, { min: 2021, max: 2022 }),
  computePortfolioFitScore(composite[2], 100, 20, { min: 2021, max: 2022 })],
[84, 45], '…an eligible-only basis would score them 84 and 45 — a different winner');
eq(top.companyName, 'Domestic Small', 'the pick follows the full-portfolio basis');
eq(top.score, 39, 'and reports the score All PCs shows for it');
eq(top.skippedRegion, 1, 'the ineligible row still counted toward the maxima');

// ---- the counts behind the tooltip ------------------------------------------

const counted = pickTopPortfolioCompany([
  pc('Acme Foods', 71, 'Dallas', 'United States'),          // Hold Off
  pc('Northwind Logistics', 88, 'Toronto', 'Canada'),        // Lost - Not Sold
  pc('Zug Chemicals', 97, 'Zug', 'Switzerland'),             // not NAM
  pc('Credit Fund I', 'N/A', 'New York', 'United States'),   // unscored
  pc('Contoso Metals', 64, 'Chicago', 'United States'),      // the pick
], statuses);
eq({ ...counted, hqCity: undefined, hqCountry: undefined, hqLocation: undefined }, {
  companyName: 'Contoso Metals', score: 64, status: 'Qualifying', statusFromRow: false, statusCompany: '',
  hqCity: undefined, hqCountry: undefined, hqLocation: undefined,
  total: 5, eligible: 2, skippedRegion: 1, skippedStatus: 2, skippedNoScore: 1,
}, 'the counts add up to the portfolio');

// Ties break on name so the column doesn't flicker between equals.
eq(pickTopPortfolioCompany([
  pc('Bravo Inc', 80, 'Dallas', 'United States'),
  pc('Alpha Inc', 80, 'Boston', 'United States'),
], new Map()).companyName, 'Alpha Inc', 'a tie breaks on name, not portfolio order');

// ---- site count, estimated or not -------------------------------------------

// Uploads write the (P)/(E) marker into the cell itself ("20 (E)"), so a
// bare Number() on it is NaN. That used to mean an estimated site count
// scored as zero AND vanished from the normalization maximum — the site
// component silently ignored exactly the rows it was most needed for.
eq(siteCountNumber('20 (E)'), 20, 'an estimated site count is a site count');
eq(siteCountNumber('20 (P)'), 20, 'so is a partial one');
eq(siteCountNumber('5,200'), 5200, 'thousands separators parse');
eq([siteCountNumber(''), siteCountNumber(null), siteCountNumber('unknown')], [0, 0, 0],
  'and anything unreadable contributes 0, never NaN');

// Same row, marked and unmarked, scores identically.
const sitesRow = { companyName: 'Estimated Co', sector: 'Retail / Consumer', energyGwh: 0, siteCount: '400 (E)' };
eq(computePortfolioFitScore(sitesRow, 100, 400, null),
  computePortfolioFitScore({ ...sitesRow, siteCount: 400 }, 100, 400, null),
  'the (E) marker changes nothing about the score');

// …and an estimate-only portfolio ranks by site count rather than
// collapsing to a single sector-driven tie.
const estimated = [
  { companyName: 'Wide Co', sector: 'Retail / Consumer', siteCount: '400 (E)', hqCity: 'Dallas', hqCountry: 'United States' },
  { companyName: 'Narrow Co', sector: 'Retail / Consumer', siteCount: '10 (E)', hqCity: 'Boston', hqCountry: 'United States' },
];
eq(pickTopPortfolioCompany(estimated, new Map()).companyName, 'Wide Co',
  'the wider estimated footprint wins');

// ---- component weights ------------------------------------------------------

// Sites now carry the same 30% as energy. A row that is all sites and no
// energy scores the same as its mirror image; before the reweighting the
// energy-only row won by 20 points.
const allSites = { companyName: 'Sites Only', sector: '', energyGwh: 0, siteCount: 100 };
const allEnergy = { companyName: 'Energy Only', sector: '', energyGwh: 100, siteCount: 0 };
eq(computePortfolioFitScore(allSites, 100, 100, null), 30, 'a maxed site count is worth 30 points');
eq(computePortfolioFitScore(allEnergy, 100, 100, null), 30, 'exactly what a maxed energy figure is worth');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

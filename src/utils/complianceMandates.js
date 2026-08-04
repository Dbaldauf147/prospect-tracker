// Building Compliance Screening — two-step lookup + eligibility.
//
//   site (city, state, sq ft, property type)
//        │  1. City Lookup:  normalized city+state → Government ID
//        ▼
//   Government ID
//        │  2. Master Ordinances:  Government ID → BBS / Audits / BPS mandates
//        ▼
//   per-category eligibility (active ordinance AND building ≥ the size
//   threshold for its property type), the compliance deadline, and the
//   estimated max yearly penalty.
//
// The two reference tables are committed seeds: src/data/masterOrdinances.js
// (from scripts/buildComplianceOrdinances.mjs) and
// src/data/complianceCityLookup.js (from scripts/buildCityLookup.mjs).
// Callers may pass a replacement pair (e.g. a user-uploaded City Lookup +
// Master Ordinances) to every function.

import MASTER_ORDINANCES from '../data/masterOrdinances.js';
import CITY_LOOKUP from '../data/complianceCityLookup.js';
import { normalizeState } from './utilityRates.js';
import { normalizeProvince } from '../data/naMarkets.js';

export const CATEGORIES = ['bbs', 'audits', 'bps'];
export const CATEGORY_LABEL = { bbs: 'BBS', audits: 'Energy Audits', bps: 'BPS' };
// Brand-ish palette matching the example deliverable: BBS blue, Audits
// orange, BPS green (+ utility-feed gold / crimson on page 3).
export const CATEGORY_COLOR = { bbs: '#29ABE2', audits: '#F7941E', bps: '#3DAE2B' };

export function normKey(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// Index the ordinances list by Government ID once per (list identity).
const _ordIndexCache = new WeakMap();
function ordIndex(ordinances) {
  let m = _ordIndexCache.get(ordinances);
  if (!m) { m = new Map(ordinances.map(g => [g.govId, g])); _ordIndexCache.set(ordinances, m); }
  return m;
}

// Which country and state a "state" value names, or null when it can't be
// told. Used to stop a bare city name matching the wrong place — Cambridge,
// Ontario is not Cambridge, Massachusetts, and Columbus, Mississippi is not
// Columbus, Ohio.
//
// The state and province tables already exist for the rate lookups, so this
// reads through them rather than keeping a third copy that could drift.
// normalizeState answers for the 50 states plus DC and normalizeProvince for
// the provinces, both from either a code or a full name.
//
// Note what stays unresolved, on purpose:
//   - US territories (PR, GU, VI). A two-letter code in a state column is
//     often a mis-mapped field rather than a real territory, and reading "PR"
//     as Puerto Rico would veto correct matches on the strength of junk data.
//   - Anything neither table recognizes ("Multiple", "Nuevo Leon", "").
// An unresolved value vetoes nothing.
const COUNTRY_ONLY = new Map([
  ['canada', 'CA'], ['unitedstates', 'US'], ['unitedstatesofamerica', 'US'],
  ['usa', 'US'], ['us', 'US'],
]);

// { country, state } for a state / province / country value, or null.
export function regionOf(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return null;
  // States first: "CA" is California, not Canada.
  const st = normalizeState(raw);
  if (st) return { country: 'US', state: st };
  const prov = normalizeProvince(raw);
  if (prov) return { country: 'CA', state: prov };
  const country = COUNTRY_ONLY.get(normKey(raw));
  return country ? { country, state: null } : null;
}

export function regionCountry(value) {
  return regionOf(value)?.country || null;
}

// Where a jurisdiction sits, read from its state / province name. Not from
// the Government ID prefix — some Canadian jurisdictions carry a "US-" prefix
// in the seed data (Ottawa, Montreal), so the prefix can't be trusted while
// the state name can.
function govIdRegion(govId, ordinances) {
  const g = ordIndex(ordinances).get(govId);
  return g ? regionOf(g.state) : null;
}

// Do a site's stated location and a candidate jurisdiction's contradict each
// other? Only a positive disagreement counts — anything either side can't
// resolve leaves the match alone.
function regionsConflict(site, candidate) {
  if (!site || !candidate) return false;
  if (site.country && candidate.country && site.country !== candidate.country) return true;
  return !!(site.state && candidate.state && site.state !== candidate.state);
}

// Resolve a city + state to a Government ID. Tries city+state (state may be an
// abbreviation or full name — the lookup carries both), then city-only.
//
// The City Lookup carries every city a jurisdiction covers, so member cities
// resolve on the city+state key: Silver Spring to Montgomery County, West
// Hollywood to Los Angeles, a Fresno site to California's state program.
//
// The city-only step is a guess by nature: a bare "Cambridge" can't tell
// Cambridge MA from Cambridge ON, and a bare "Columbus" can't tell Columbus MS
// from Columbus OH. So it's rejected when the site's stated location and the
// candidate jurisdiction's positively disagree — a different country, or a
// different state within the same one. A city+state hit is an explicit curated
// mapping and is always trusted.
export function lookupGovId(city, state, cityLookup = CITY_LOOKUP, ordinances = MASTER_ORDINANCES) {
  const c = String(city || '').trim();
  const s = String(state || '').trim();
  if (!c) return null;
  const withState = cityLookup[normKey(c + s)];
  if (withState != null) return withState;
  const cityOnly = cityLookup[normKey(c)];
  if (cityOnly == null) return null;
  if (regionsConflict(regionOf(s), govIdRegion(cityOnly, ordinances))) return null;
  return cityOnly;
}

// A jurisdiction can arrive as more than one row in the source workbook.
// Portland, Oregon is split across US-OR-Portla-01, which carries the BPS
// mandate (House Bill 3409), and US-OR-Portla-02, which carries the
// benchmarking ordinance — each row showing the other category as inactive.
// The City Lookup can only point at one Government ID, so a Portland site was
// screened against whichever row came first and silently missed the mandate
// on the other.
//
// Rows naming the same government + state are therefore one jurisdiction: a
// category is active if any of its rows says so, and the detail comes from
// the row carrying that active ordinance. `raws` keeps every underlying row
// so the export still shows the full reference behind a merged match.
function mergeOrdinances(list) {
  const primary = list[0];
  const out = { ...primary, govIds: list.map(g => g.govId), raws: list.map(g => g.raw).filter(Boolean) };
  for (const c of CATEGORIES) {
    const active = list.find(g => g[c]?.active);
    out[c] = active ? active[c] : (list.find(g => g[c]) || primary)[c];
  }
  return out;
}

// govId → the merged jurisdiction it belongs to. Every Government ID in a
// group maps to the same merged record, so the lookup pointing at either row
// gives the whole picture.
const _mergedCache = new WeakMap();
function mergedIndex(ordinances) {
  let m = _mergedCache.get(ordinances);
  if (m) return m;
  const groups = new Map();
  for (const g of ordinances) {
    const k = `${normKey(g.government)}::${normKey(g.state)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(g);
  }
  m = new Map();
  for (const list of groups.values()) {
    const merged = list.length === 1
      ? { ...list[0], govIds: [list[0].govId], raws: list[0].raw ? [list[0].raw] : [] }
      : mergeOrdinances(list);
    for (const g of list) m.set(g.govId, merged);
  }
  _mergedCache.set(ordinances, m);
  return m;
}

export function getMandates(govId, ordinances = MASTER_ORDINANCES) {
  if (!govId) return null;
  return mergedIndex(ordinances).get(govId) || null;
}

// Classify a property type into the threshold bucket the ordinances use.
export function classifyPropertyType(propertyType) {
  const p = String(propertyType || '').toLowerCase();
  if (/multi.?family|apartment|residenc|dormitory|dwelling|housing/.test(p)) return 'multifamily';
  if (/government|public|civic|courthouse|library|police|fire\s*station|city\s*hall|municipal|school|university|college|museum/.test(p)) return 'public';
  return 'nonresidential';
}

// Returned by thresholdFor when the ordinance publishes size requirements but
// none for this building's property type — the mandate doesn't reach the
// building at all. That is a different answer from `null`, which means the
// ordinance publishes no size requirement anywhere and so covers everything.
const NOT_COVERED = Symbol('notCovered');

// Pick the applicable ft² threshold for a category given the property-type
// bucket, falling back to whatever threshold the ordinance does define.
function thresholdFor(category, mandate, ptClass) {
  const t = mandate[category].thresholds || {};
  let order;
  if (category === 'bbs') {
    order = ptClass === 'public' ? ['public', 'nonResidential', 'statewide']
      : ptClass === 'multifamily' ? ['multiFamily', 'nonResidential', 'statewide']
      : ['nonResidential', 'statewide', 'public'];
  } else if (category === 'audits') {
    // Audit ordinances scope themselves by building type, so their columns
    // are not interchangeable: a blank one means that type isn't covered.
    // Austin's audit requirement is multifamily-only (510 ft²) and Seattle's,
    // San Francisco's, Philadelphia's and Salt Lake City's are commercial-only.
    // Borrowing another type's number screened an Austin office into a
    // multifamily mandate and a Seattle apartment building into a commercial
    // one, so nothing crosses the residential / non-residential line here.
    // A public building still reads the general non-residential (commercial)
    // requirement when the ordinance doesn't publish a separate public one —
    // both describe the same non-residential stock.
    order = ptClass === 'public' ? ['public', 'commercial']
      : ptClass === 'multifamily' ? ['multifamily']
      : ['commercial'];
  } else { // bps
    order = ptClass === 'multifamily' ? ['multiFamily', 'nonResidential'] : ['nonResidential', 'multiFamily'];
  }
  for (const key of order) if (t[key] != null) return t[key];
  if (category === 'audits') {
    return Object.values(t).some(v => v != null) ? NOT_COVERED : null;
  }
  // Last resort: any defined threshold.
  for (const v of Object.values(t)) if (v != null) return v;
  return null;
}

// Evaluate one category for one site. `site`: { sqft, propertyType }.
// Returns { applicable, active, eligible, threshold, deadline, penalty, ... }.
//   active:   the jurisdiction has an in-force ordinance for this category.
//             Benchmarking counts only an "Active/ Mandatory" policy status —
//             a voluntary programme (Calgary, Building Benchmark BC, Grand
//             Rapids) obliges nobody, so it is reported as the ordinance on
//             file rather than a mandate the portfolio is exposed to. The flag
//             is set in the seed by scripts/buildComplianceOrdinances.mjs.
//   eligible: whether THIS building has to report under it —
//             true  = active ordinance and the building meets the size
//                     requirement (or the ordinance publishes none, or the
//                     site carries no square footage — see below).
//             false = active ordinance but the building is under the size
//                     requirement, or of a building type the ordinance
//                     doesn't cover (`coveredType: false`), or no ordinance
//                     at all.
//   Every count, penalty total and chart downstream keys off `eligible ===
//   true`, so a building below the threshold doesn't show up as needing to
//   report.
function evalCategory(category, mandate, site) {
  const cat = mandate[category];
  if (!cat || !cat.active) {
    return { category, applicable: false, active: false, eligible: false };
  }
  const ptClass = classifyPropertyType(site.propertyType);
  const threshold = thresholdFor(category, mandate, ptClass);
  // The ordinance is live here but doesn't reach this kind of building, so no
  // deadline and no fine ride along — same treatment as a building under the
  // size requirement, with its own reason so the page and the exports can say
  // which of the two it was.
  if (threshold === NOT_COVERED) {
    return {
      category, applicable: false, active: true, eligible: false,
      coveredType: false, threshold: null, meetsThreshold: null,
      sizeAssumed: false, ptClass,
      deadline: null, deadlineRaw: null,
      penalty: null, penaltyRate: null, penaltyUom: null,
      penaltyPerSqft: false, penaltyUnsized: false,
      policyName: cat.policyName || cat.ordinanceName || '',
      status: cat.status || '',
    };
  }
  const sqft = Number.isFinite(site.sqft) ? site.sqft : null;
  // The size requirement gates applicability: it's the ordinance's own test
  // for which buildings are covered, so screening a 5,000 ft² building as
  // needing to report under a 50,000 ft² mandate overstates the portfolio.
  //
  // A site with no square footage is taken to meet the requirement rather than
  // held out of the screening. A missing value is a gap in the uploaded list,
  // not evidence of a small building — holding those sites back dropped them
  // from the counts entirely, which reads as "no mandate here" and understates
  // the portfolio. `sizeAssumed` marks the ones counted on that assumption so
  // the page and the exports can say which figures rest on it.
  const sizeAssumed = threshold != null && sqft == null;
  const meetsThreshold = threshold == null ? null : (sqft == null ? true : sqft >= threshold);
  // No published threshold => the ordinance covers the building outright.
  const eligible = threshold == null ? true : meetsThreshold;
  // BPS penalties can be quoted per square foot per year (Denver: $10/ft²/yr),
  // which is a very different number from a flat annual fee — $10 against
  // $600,000 for a 60,000 ft² building. bpsNonReportingPenalty already
  // respected the unit for the BPS prioritization table; the per-site figure
  // now does too, instead of printing the rate as if it were the total.
  const perSqft = category === 'bps' && isPerSqftUom(cat.penaltyUom);
  const penalty = category === 'bps'
    ? bpsNonReportingPenalty(cat, sqft)
    : (cat.maxPenalty ?? null);
  return {
    category,
    applicable: eligible === true,
    active: true,
    eligible,
    // This building's type is one the ordinance covers.
    coveredType: true,
    threshold,
    meetsThreshold,
    // Counted as meeting the size requirement because the site has no square
    // footage to test, not because it was measured.
    sizeAssumed,
    ptClass,
    deadline: cat.deadline || null,
    deadlineRaw: cat.deadlineRaw || null,
    penalty,
    // The published rate and its unit, kept even when `penalty` can't be
    // worked out — a per-ft² fine with no square footage is "unsized", which
    // is a different thing from an ordinance that publishes no fine at all.
    penaltyRate: cat.maxPenalty ?? null,
    penaltyUom: cat.penaltyUom || null,
    penaltyPerSqft: perSqft,
    penaltyUnsized: perSqft && cat.maxPenalty != null && !Number.isFinite(sqft),
    policyName: cat.policyName || cat.ordinanceName || '',
    status: cat.status || '',
  };
}

// Screen one site end-to-end. `site`: { id, siteName, city, state, sqft,
// propertyType, electricUtility, gasUtility }. Never throws.
export function screenSite(site, { ordinances = MASTER_ORDINANCES, cityLookup = CITY_LOOKUP } = {}) {
  const govId = lookupGovId(site.city, site.state, cityLookup, ordinances);
  const mandate = getMandates(govId, ordinances);
  if (!mandate) {
    return { ...site, matched: false, govId: govId || null, government: null };
  }
  const out = { ...site, matched: true, govId, government: mandate.government, mandateState: mandate.state };
  for (const c of CATEGORIES) out[c] = evalCategory(c, mandate, site);
  return out;
}

export function screenSites(sites, opts) {
  return (sites || []).map(s => screenSite(s, opts));
}

// Human label for the company / portfolio a compliance site list belongs to,
// taken from each site's Company Name (mapped on the Utility Lookup upload).
// One distinct company → that name; a couple → both; more → the first plus a
// "+N more" tag; none → '' so callers can hide the line.
export function sitesCompanyLabel(sites) {
  const names = [];
  const seen = new Set();
  for (const s of (sites || [])) {
    const c = String(s?.company || '').trim();
    if (!c) continue;
    const k = c.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    names.push(c);
  }
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names[0]} +${names.length - 1} more`;
}

// ---- Aggregations for the dashboard / report -----------------------------
// All operate on the output of screenSites(). A site "counts" for a category
// when eligible === true.

const isEligible = (r, c) => r.matched && r[c] && r[c].eligible === true;

// Count of eligible sites grouped by jurisdiction (Government), for a category.
export function eligibilityByOrdinance(results, category) {
  const m = new Map();
  for (const r of results) if (isEligible(r, category)) m.set(r.government, (m.get(r.government) || 0) + 1);
  return [...m.entries()].map(([government, count]) => ({ government, count })).sort((a, b) => b.count - a.count);
}

export function totalEligible(results, category) {
  return results.reduce((n, r) => n + (isEligible(r, category) ? 1 : 0), 0);
}

// Eligible-site count per compliance deadline (for the timeline charts).
export function deadlinesByDate(results, category) {
  const m = new Map();
  for (const r of results) {
    if (!isEligible(r, category)) continue;
    const d = r[category].deadline;
    if (!d) continue;
    m.set(d, (m.get(d) || 0) + 1);
  }
  return [...m.entries()].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date));
}

// Estimated max yearly penalty summed over eligible sites, grouped by
// jurisdiction (per-site penalty × eligible sites in that jurisdiction).
export function penaltyByOrdinance(results, category) {
  const m = new Map();
  for (const r of results) {
    if (!isEligible(r, category)) continue;
    const p = r[category].penalty;
    if (p == null) continue;
    m.set(r.government, (m.get(r.government) || 0) + p);
  }
  return [...m.entries()].map(([government, penalty]) => ({ government, penalty })).sort((a, b) => b.penalty - a.penalty);
}

export function totalPenalty(results, category) {
  return penaltyByOrdinance(results, category).reduce((n, x) => n + x.penalty, 0);
}

// ---- BPS Prioritization ---------------------------------------------------
// A focused BPS view grouped by (deadline, jurisdiction): the fine for
// exceeding performance limits, how many sites are eligible, and the summed
// estimated non-reporting penalty. Surfaced on the Master Analysis overview,
// both compliance exports, and the on-page screening tab.

// "BPS Fines for Exceeding Limits" label from a jurisdiction's raw fields,
// e.g. "62000 $/year", "0.35 $/kBtu", "270 $/Metric ton/ CO2e", or "N/A".
function bpsExceedFineLabel(mandate) {
  const raw = mandate?.raw || {};
  const costRaw = raw['BPS - Enforcement Cost (Exceed limits)'];
  const uomRaw = raw['BPS - Enforcement UOM (Exceed Limits)'];
  const cost = costRaw == null ? '' : String(costRaw).trim();
  const uom = uomRaw == null ? '' : String(uomRaw).trim();
  const costBlank = cost === '' || Number(cost) === 0;
  const uomBlank = uom === '' || uom.toUpperCase() === 'N/A';
  if (costBlank && uomBlank) return 'N/A';
  if (costBlank) return uom || 'N/A';
  return [cost, uomBlank ? '' : uom].filter(Boolean).join(' ');
}

// Per-site estimated BPS non-reporting penalty, respecting the jurisdiction's
// penalty UOM: a "$ per SqFt/Year" penalty scales by building size; anything
// else is a flat annual amount. Returns null when it can't be computed (no
// penalty defined, or a size-based penalty with unknown square footage).
// Where each category's fine comes from in the source workbook, so a site can
// show its working rather than just a number. `amount` / `unit` / `basis` name
// the columns the figure itself is read from; `rows` are the supporting
// enforcement text — the violation schedule behind a BBS maximum, the
// exceeding-limits fine that sits alongside a BPS non-reporting penalty.
const PENALTY_SOURCES = {
  bbs: {
    amount: 'BBS - Maximun Yearly penalty',
    basis: 'BBS - Penalty Estimation',
    rows: [
      ['First violation', 'BBS - 1st Violation'],
      ['Second violation', 'BBS - 2nd Violation'],
    ],
  },
  audits: {
    amount: 'Audits - Max Yearly Penalty',
    basis: 'Audits - Max Yearly Penalty Estimation',
    rows: [['Enforcement', 'Audits - Enforcement']],
  },
  bps: {
    amount: 'BPS - Enforcement Cost (No Reporting)',
    unit: 'BPS - Enforcement UOM (No Reporting)',
    basis: 'BPS - Enforcement Estimated/Actual (Non-reporting)',
    rows: [
      ['Fine for exceeding limits', 'BPS - Enforcement Cost (Exceed limits)'],
      ['Exceeding-limits unit', 'BPS - Enforcement UOM (Exceed Limits)'],
      ['Exceeding-limits basis', 'BPS - Enforcement Estimated/Actual (Exceed Limits)'],
      ['Enforcement', 'BPS - Enforcement'],
    ],
  },
};

const blankish = (v) => {
  const s = String(v == null ? '' : v).trim();
  return s === '' || /^(n\/?a|none|not\s*specified|tbd|-)$/i.test(s);
};

// The published figures behind one category's fine, straight from the source
// row: { amount, unit, basis, rows: [{ label, value }] }. Any field the
// workbook leaves blank is dropped rather than shown as an empty line.
// Returns null for a jurisdiction with no row on file.
export function penaltyBasis(mandate, category) {
  const src = PENALTY_SOURCES[category];
  // A merged jurisdiction carries every underlying row; the fine belongs to
  // whichever row actually published this category's amount.
  const candidates = mandate?.raws?.length ? mandate.raws : [mandate?.raw];
  const raw = candidates.find(r => r && !blankish(r[src?.amount])) || candidates[0];
  if (!src || !raw) return null;
  const val = (key) => (key && !blankish(raw[key]) ? String(raw[key]).trim() : null);
  return {
    amount: val(src.amount),
    unit: val(src.unit),
    basis: val(src.basis),
    rows: src.rows
      .map(([label, key]) => ({ label, value: val(key) }))
      .filter(r => r.value),
  };
}

export function isPerSqftUom(uom) {
  return /sq\s*\.?\s*ft|sqft|\/\s*sf\b/.test(String(uom || '').toLowerCase());
}

export function bpsNonReportingPenalty(bpsMandate, sqft) {
  const cost = bpsMandate?.maxPenalty;
  if (cost == null) return null;
  if (isPerSqftUom(bpsMandate?.penaltyUom)) return Number.isFinite(sqft) ? cost * sqft : null;
  return cost;
}

// BPS prioritization rows: one per (deadline, government) across BPS-eligible
// sites, sorted by deadline (undated last) then government. `penalty` is the
// summed estimated non-reporting exposure; `penaltyKnown` is false when no
// site in the group had a computable penalty (so callers can show a dash).
export function bpsPrioritization(results, ordinances = MASTER_ORDINANCES) {
  const m = new Map();
  for (const r of (results || [])) {
    if (!isEligible(r, 'bps')) continue;
    const mandate = getMandates(r.govId, ordinances);
    const deadline = r.bps.deadline || null;
    const government = r.government || mandate?.government || '';
    const key = `${deadline || ''}||${government}`;
    let g = m.get(key);
    if (!g) {
      g = {
        deadline,
        deadlineRaw: r.bps.deadlineRaw || null,
        government,
        fine: bpsExceedFineLabel(mandate),
        sites: 0,
        penalty: 0,
        penaltyKnown: false,
        feeExceeding: 'TBD (Full Screening Analysis Needed)',
      };
      m.set(key, g);
    }
    g.sites += 1;
    const p = bpsNonReportingPenalty(mandate?.bps, r.sqft);
    if (p != null) { g.penalty += p; g.penaltyKnown = true; }
  }
  return [...m.values()].sort((a, b) => {
    const ad = a.deadline || '9999-12-31';
    const bd = b.deadline || '9999-12-31';
    if (ad !== bd) return ad.localeCompare(bd);
    return String(a.government).localeCompare(String(b.government));
  });
}

// Whole-Building Utility Data Collection eligibility: sites eligible for BBS or
// BPS, grouped by state → utility, for a commodity ('electric' | 'gas').
export function utilityFeedEligibility(results, commodity) {
  const utilKey = commodity === 'gas' ? 'gasUtility' : 'electricUtility';
  const byState = new Map();
  let total = 0;
  for (const r of results) {
    if (!(isEligible(r, 'bbs') || isEligible(r, 'bps'))) continue;
    const util = String(r[utilKey] || '').trim();
    if (!util) continue;
    const st = String(r.mandateState || r.state || '').trim();
    if (!byState.has(st)) byState.set(st, new Map());
    const u = byState.get(st);
    u.set(util, (u.get(util) || 0) + 1);
    total++;
  }
  const rows = [];
  for (const [state, utils] of byState) {
    for (const [utility, count] of utils) rows.push({ state, utility, count });
  }
  rows.sort((a, b) => a.state.localeCompare(b.state) || b.count - a.count);
  return { total, rows };
}

// ---- Compliance Roadmap: obligations, sites, and fine exposure over time --
// Turns the screened sites into a quarter-by-quarter timeline: how many new
// compliance deadlines land each quarter (by category), how the count of
// distinct sites carrying an obligation grows, and how the cumulative max
// yearly fine exposure ramps up. Powers the Compliance Roadmap subtab.

function quarterOf(iso) {
  const [y, m] = String(iso).split('-').map(Number);
  const q = Math.floor((m - 1) / 3) + 1;
  return { sort: y * 4 + (q - 1), label: `Q${q} ${y}` };
}
function labelOfSort(sort) {
  const y = Math.floor(sort / 4);
  const q = (sort % 4) + 1;
  return { key: `${y}-Q${q}`, label: `Q${q} ${y}`, startISO: `${y}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01` };
}

// results: output of screenSites(). Returns quarterly periods (spanning the
// first → last dated deadline) plus totals. A site counts toward "sites in
// scope" from its EARLIEST dated deadline; each (site, category) obligation
// adds its max yearly penalty at its own deadline. Obligations that are active
// but have no parseable deadline are tallied under `undated` (not placed on
// the timeline).
export function buildComplianceRoadmap(results) {
  const events = [];
  const siteEarliestSort = new Map();
  let undated = 0;
  for (const r of (results || [])) {
    if (!r.matched) continue;
    for (const c of CATEGORIES) {
      const e = r[c];
      // Only buildings that actually have to report belong on the roadmap —
      // same `eligible === true` test the counts and penalty totals use, so a
      // site under the size requirement doesn't carry a deadline here.
      if (!e || e.eligible !== true) continue;
      if (!e.deadline) { undated++; continue; }
      const q = quarterOf(e.deadline);
      events.push({ siteId: r.id, category: c, penalty: e.penalty || 0, sort: q.sort });
      const prev = siteEarliestSort.get(r.id);
      if (prev == null || q.sort < prev) siteEarliestSort.set(r.id, q.sort);
    }
  }
  const totals = {
    sites: siteEarliestSort.size,
    obligations: events.length,
    fines: events.reduce((n, e) => n + e.penalty, 0),
    undated,
  };
  if (!events.length) return { periods: [], totals };

  const newSitesBySort = new Map();
  for (const s of siteEarliestSort.values()) newSitesBySort.set(s, (newSitesBySort.get(s) || 0) + 1);
  const aggBySort = new Map();
  for (const ev of events) {
    let a = aggBySort.get(ev.sort);
    if (!a) { a = { fines: 0, oblig: 0, byCat: { bbs: 0, audits: 0, bps: 0 } }; aggBySort.set(ev.sort, a); }
    a.fines += ev.penalty; a.oblig++; a.byCat[ev.category]++;
  }

  const sorts = events.map(e => e.sort);
  const minS = Math.min(...sorts), maxS = Math.max(...sorts);
  const periods = [];
  let cumSites = 0, cumFines = 0, cumOblig = 0;
  const cumByCat = { bbs: 0, audits: 0, bps: 0 };
  for (let s = minS; s <= maxS; s++) {
    const a = aggBySort.get(s) || { fines: 0, oblig: 0, byCat: { bbs: 0, audits: 0, bps: 0 } };
    const newSites = newSitesBySort.get(s) || 0;
    cumSites += newSites; cumFines += a.fines; cumOblig += a.oblig;
    for (const c of CATEGORIES) cumByCat[c] += a.byCat[c];
    const meta = labelOfSort(s);
    periods.push({
      ...meta,
      newSites, cumSites,
      newObligations: a.oblig, cumObligations: cumOblig,
      newByCategory: { ...a.byCat },
      cumByCategory: { ...cumByCat },
      newFines: a.fines, cumFines,
    });
  }
  return { periods, totals };
}

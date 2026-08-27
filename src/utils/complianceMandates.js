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
import { countryRates, normalizeCountryRateName } from '../data/countryRates.js';

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

// The reference is a US and Canadian one, so a site outside North America has
// nothing in it to match. A bare city name is exactly where that went wrong:
// there is a Brisbane in Queensland as well as the one in California, and a
// London in Ontario as well as one in England. Neither an Australian state nor
// an English county contradicts a US jurisdiction the way another US state
// does, so the veto below never fired and an overseas site was screened
// against a Californian benchmarking deadline.
//
// Country is the signal to read: the site list already resolves it (mapped
// column, else derived from the zip / utility), where a State column reading
// "Queensland" resolves to nothing at all.
//
// Only a country the reference table can place counts, the same way only a
// positively disagreeing state vetoes a match. A blank Country — the common
// case for a US portfolio whose upload has no such column — and a spelling the
// table can't resolve both leave the match alone.
// The reference table's own region name for the continent — the same value
// siteRegion.js buckets its North America column on. Spelled here rather than
// imported from there because this module is loaded by the Node test scripts,
// and siteRegion's imports are extensionless (Vite-only).
const NORTH_AMERICA_REGION = 'North America';

export function countryOutsideNorthAmerica(country) {
  const canonical = normalizeCountryRateName(String(country == null ? '' : country).trim());
  if (!canonical) return false;
  const region = countryRates(canonical)?.region;
  return !!region && region !== NORTH_AMERICA_REGION;
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
//
// `country` outranks both steps: a site the country places outside North
// America matches nothing, the curated city+state key included.
export function lookupGovId(city, state, cityLookup = CITY_LOOKUP, ordinances = MASTER_ORDINANCES, country = '') {
  const c = String(city || '').trim();
  const s = String(state || '').trim();
  if (!c) return null;
  if (countryOutsideNorthAmerica(country)) return null;
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
// so the export still shows the full reference behind a merged match, and
// `categoryRaw` names the one row each category's detail was taken from — the
// exports quote a category's source columns from there rather than from
// whichever row happened to come first.
function mergeOrdinances(list) {
  const primary = list[0];
  const out = { ...primary, govIds: list.map(g => g.govId), raws: list.map(g => g.raw).filter(Boolean) };
  out.categoryRaw = {};
  for (const c of CATEGORIES) {
    const src = list.find(g => g[c]?.active) || list.find(g => g[c]) || primary;
    out[c] = src[c];
    out.categoryRaw[c] = src.raw || null;
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
    // Every jurisdiction goes through the merge, one row or several, so a
    // single-row jurisdiction still carries govIds / raws / categoryRaw.
    const merged = mergeOrdinances(list);
    for (const g of list) m.set(g.govId, merged);
  }
  _mergedCache.set(ordinances, m);
  return m;
}

export function getMandates(govId, ordinances = MASTER_ORDINANCES) {
  if (!govId) return null;
  return mergedIndex(ordinances).get(govId) || null;
}

// ---- what an audit ordinance actually asks for ----------------------------
// "Energy Audits applicable" is the start of the answer, not the whole of it:
// a jurisdiction can require an ASHRAE Level II energy audit, a water audit,
// retro-commissioning and a periodic tune-up, in any combination, and each is
// a separate piece of work to scope. The workbook carries one column per
// obligation, so the screening reads them out per site rather than leaving
// them in a reference sheet nobody opens.
//
// `level` grades how firm each one is, since the columns mix a hard
// requirement with a conditional: "Mandatory" and a named standard ("ASHRAE
// Level II") are required, "May be required" is conditional, "Optional" is
// not required. Anything else names a standard, so it counts as required.
const AUDIT_REQUIREMENTS = [
  ['energyAudit', 'Energy audit', 'Audits - Energy Audit Requirement'],
  ['waterAudit', 'Water audit', 'Audits - Water Audit Requirement'],
  ['rcx', 'Retro-commissioning', 'Audits - RCxing Requirement'],
  ['tuneUp', 'Tune-up', 'Audits - Tune-Up Requirement'],
];

const NO_REQUIREMENT = /^(n\/?a|none|not\s*(specified|identified|required|applicable|available))$/i;

function requirementLevel(value) {
  const v = String(value || '').trim();
  if (!v || NO_REQUIREMENT.test(v)) return null;
  if (/optional/i.test(v)) return 'optional';
  if (/may\s+be\s+required|if\s|conditional/i.test(v)) return 'conditional';
  return 'required';
}

// The audit obligations a jurisdiction publishes, as
// [{ key, label, value, level }]. Empty when the ordinance names none — four
// of the 21 active audit ordinances (Columbus, Denver, Evanston, Minneapolis)
// leave every column blank, which says the workbook doesn't record the detail,
// not that the ordinance asks for nothing. Those still screen as applicable.
export function auditRequirements(mandate) {
  const raw = mandate?.categoryRaw?.audits || mandate?.raw || {};
  const out = [];
  for (const [key, label, column] of AUDIT_REQUIREMENTS) {
    const value = String(raw[column] || '').trim();
    const level = requirementLevel(value);
    if (level) out.push({ key, label, value, level });
  }
  return out;
}

// One-line summary of the above for a spreadsheet cell: "Energy audit: ASHRAE
// Level II · Water audit: Mandatory".
export function auditRequirementsLabel(mandate) {
  return auditRequirements(mandate).map(r => `${r.label}: ${r.value}`).join(' · ');
}

// The workbook's own column order for one category's source columns.
// A jurisdiction's raw row only keeps the columns it has a value for, so no
// single row lists them all; each row is merged in after the last column it
// shares with the order so far, which reconstructs the header order.
const _colCache = new WeakMap();
export function categoryColumns(category, ordinances = MASTER_ORDINANCES) {
  let byCat = _colCache.get(ordinances);
  if (!byCat) { byCat = new Map(); _colCache.set(ordinances, byCat); }
  if (byCat.has(category)) return byCat.get(category);
  const prefix = { bbs: 'BBS - ', audits: 'Audits - ', bps: 'BPS - ' }[category];
  const order = [];
  for (const g of ordinances) {
    let at = 0;
    for (const k of Object.keys(g.raw || {})) {
      if (!k.startsWith(prefix)) continue;
      const idx = order.indexOf(k);
      if (idx >= 0) at = idx + 1;
      else { order.splice(at, 0, k); at++; }
    }
  }
  byCat.set(category, order);
  return order;
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
    // Audits read one column and one only: "Audits - Sq Thr / Commercial" for
    // every site, "Audits - Sq Thr / Multifamily" for a multifamily one. The
    // columns are not interchangeable — Austin's audit requirement is
    // multifamily-only (510 ft²) and Seattle's, San Francisco's,
    // Philadelphia's and Salt Lake City's are commercial-only — so a blank
    // column means the ordinance doesn't reach that kind of building rather
    // than that another column's number stands in. Public buildings read the
    // commercial threshold like everything else; the "Sq Thr / Public" column
    // is left to the BBS mandate, which does scope itself that way.
    order = ptClass === 'multifamily' ? ['multifamily'] : ['commercial'];
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
//                     doesn't cover (`coveredType: false`), or — for audits —
//                     an ordinance with no published deadline
//                     (`noDeadline: true`), or no ordinance at all.
//   Every count, penalty total and chart downstream keys off `eligible ===
//   true`, so a building below the threshold doesn't show up as needing to
//   report.
function evalCategory(category, mandate, site) {
  const cat = mandate[category];
  if (!cat || !cat.active) {
    return { category, applicable: false, active: false, eligible: false };
  }
  const ptClass = classifyPropertyType(site.propertyType);
  // No published deadline, nothing due: an audit mandate with no date on file
  // gives a site nothing to comply with and no point to plan against, so it
  // isn't counted as needing an audit. Austin, Columbus and Denver are the
  // three active audit ordinances in that position; the other 18 all publish
  // a date. The ordinance stays on file as in force — it's the obligation
  // that isn't established, not the policy that's absent.
  if (category === 'audits' && !cat.deadline && !cat.deadlineRaw) {
    return {
      category, applicable: false, active: true, eligible: false,
      noDeadline: true, coveredType: null, threshold: null, meetsThreshold: null,
      sizeAssumed: false, ptClass, thresholdKey: null,
      deadline: null, deadlineRaw: null,
      penalty: null, penaltyRate: null, penaltyUom: null,
      penaltyPerSqft: false, penaltyUnsized: false,
      requirements: auditRequirements(mandate),
      policyName: cat.policyName || cat.ordinanceName || '',
      status: cat.status || '',
    };
  }
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
    // What the ordinance asks for, not just that it applies: the energy /
    // water / retro-commissioning / tune-up obligations behind an Energy
    // Audits hit. Empty for the other two categories.
    requirements: category === 'audits' ? auditRequirements(mandate) : [],
    // The threshold column the number came from, where that isn't simply the
    // building's own bucket: audits read Commercial for every site that isn't
    // multifamily, so a school screened at the commercial figure shouldn't be
    // labelled "public".
    thresholdKey: category === 'audits' ? (ptClass === 'multifamily' ? 'multifamily' : 'commercial') : null,
  };
}

// Screen one site end-to-end. `site`: { id, siteName, city, state, sqft,
// propertyType, electricUtility, gasUtility }. Never throws.
export function screenSite(site, { ordinances = MASTER_ORDINANCES, cityLookup = CITY_LOOKUP } = {}) {
  const govId = lookupGovId(site.city, site.state, cityLookup, ordinances, site.country);
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

// ---- Recurring obligations ------------------------------------------------
// A published deadline is the FIRST filing, not the only one: benchmarking
// repeats every year, BPS every year once its programme starts, and an audit
// on whatever multi-year cycle its ordinance sets. A roadmap that stops at the
// first date understates the work by everything that follows it.
//
// Where the reference publishes a cycle it is used as written; these are the
// fallbacks for the ordinances that don't.
export const DEFAULT_CYCLE_YEARS = { bbs: 1, audits: 5, bps: 1 };

// "Every 5 years" / "Annual" / "2024, 2027 & 2030" — the three shapes the
// Compliance Cycle column actually takes. An explicit year list is a schedule
// and is used as one; anything unrecognised falls back to the category default
// rather than being silently treated as one-off.
export function parseCycle(text, fallbackYears) {
  const s = String(text || '').trim();
  if (s) {
    const listed = [...s.matchAll(/\b(20\d{2})\b/g)].map(m => Number(m[1]));
    if (listed.length >= 2) return { years: [...new Set(listed)].sort((a, b) => a - b) };
    const every = /every\s+(\d+)\s*\+?\s*year/i.exec(s);
    if (every && Number(every[1]) > 0) return { every: Number(every[1]) };
    if (/\b(annual|annually|yearly|each\s+year|every\s+year)\b/i.test(s)) return { every: 1 };
  }
  return { every: fallbackYears };
}

// Same month and day, n years on. A 29 February deadline lands on the 28th in
// the years that don't have one.
function isoPlusYears(iso, n) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const day = (m === 2 && d === 29) ? 28 : d;
  return `${y + n}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function occurrencesAfter(deadline, cycle, horizonISO) {
  const out = [];
  if (cycle.years) {
    const y0 = Number(String(deadline).slice(0, 4));
    for (const y of cycle.years) {
      if (y <= y0) continue;
      const iso = `${y}${String(deadline).slice(4)}`;
      if (iso <= horizonISO) out.push(iso);
    }
    return out;
  }
  // Bounded by the horizon, with a hard stop so a zero-length cycle from bad
  // reference data can't spin.
  for (let k = 1; k <= 120; k++) {
    const iso = isoPlusYears(deadline, k * cycle.every);
    if (iso > horizonISO) break;
    out.push(iso);
  }
  return out;
}

// Every filing date for a category — the published deadline plus the
// recurrences that follow it — as { date, count, projected }. Projections stop
// `horizonYears` from today, so the chart covers one fixed window whatever the
// deadlines are: measuring the horizon from each deadline instead let a single
// far-off published date trail a decade of hollow dots behind it. Published
// deadlines are always kept — they're real dates, horizon or not.
export function deadlinesWithRecurrence(results, category, {
  todayISO, horizonYears = 5, ordinances = MASTER_ORDINANCES,
} = {}) {
  const published = new Map();
  const projected = new Map();
  const horizon = todayISO ? isoPlusYears(todayISO, horizonYears) : null;
  for (const r of results) {
    if (!isEligible(r, category)) continue;
    const deadline = r[category].deadline;
    if (!deadline) continue;
    published.set(deadline, (published.get(deadline) || 0) + 1);
    if (!todayISO) continue;
    const cycle = parseCycle(getMandates(r.govId, ordinances)?.[category]?.complianceCycle, DEFAULT_CYCLE_YEARS[category]);
    for (const iso of occurrencesAfter(deadline, cycle, horizon)) {
      projected.set(iso, (projected.get(iso) || 0) + 1);
    }
  }
  const rows = [...published.entries()].map(([date, count]) => ({ date, count, projected: false }));
  for (const [date, count] of projected) {
    // A projected filing that lands on a published deadline shares that
    // date's dot rather than drawing a second one on top of it — but it is
    // still a filing due that day, so it is counted there. Dropping it
    // instead (which is what this did) undercounted every date where one
    // jurisdiction's published deadline collides with another's recurrence,
    // and the site list behind the dot then had more sites in it than the
    // dot claimed.
    const at = rows.find(r => r.date === date);
    if (at) at.count += count;
    else rows.push({ date, count, projected: true });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The sites behind one dot on the deadlines chart.
 *
 * Counting and listing have to agree, so this walks the same path
 * deadlinesWithRecurrence counts along: a site is behind a date when its
 * published deadline IS that date, or when one of its recurrences lands on
 * it. Anything else — recomputing the list a different way, or filtering
 * the results by deadline alone — drifts from the number on the chart the
 * first time a cycle is involved, and a drill-down that disagrees with the
 * figure it opened from is worse than no drill-down.
 *
 * `projected` marks the sites whose appearance here is a modelled
 * recurrence rather than a published date.
 */
export function sitesForDeadline(results, category, date, {
  todayISO, horizonYears = 5, ordinances = MASTER_ORDINANCES,
} = {}) {
  const target = String(date || '');
  if (!target) return [];
  const horizon = todayISO ? isoPlusYears(todayISO, horizonYears) : null;
  const out = [];
  for (const r of (results || [])) {
    if (!isEligible(r, category)) continue;
    const deadline = r[category].deadline;
    if (!deadline) continue;
    if (deadline === target) { out.push({ ...r, projected: false }); continue; }
    if (!todayISO) continue;
    const cycle = parseCycle(getMandates(r.govId, ordinances)?.[category]?.complianceCycle, DEFAULT_CYCLE_YEARS[category]);
    if (occurrencesAfter(deadline, cycle, horizon).includes(target)) {
      out.push({ ...r, projected: true });
    }
  }
  return out.sort((a, b) => String(a.government || '').localeCompare(String(b.government || ''))
    || String(a.siteName || '').localeCompare(String(b.siteName || '')));
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

// The sites behind a utility-feed figure: BBS- or BPS-eligible sites whose
// commodity utility ('electric' | 'gas') both is known and hands over
// whole-building data for that commodity. With `state` + `utility` it's one
// bar on the card; without them it's the card's whole total. The counts below
// are grouped from this same list, so a bar and the list it opens can't
// disagree. Each row carries the state and utility it was counted under
// (`feedState` / `feedUtility`) — the mandate's state, which is what the card
// groups by, not necessarily the site's own.
//
// `wbMeters` is the Whole Building Data file's own answer for the utility it
// named — see withWholeBuildingUtilities(). A feed is only collectible where
// that answer is "Yes", so anything else is left out however plainly the site
// names a utility: a site served by a utility the file says nothing about is a
// site the service can't reach. Rows that never went through the reference
// carry no `wbMeters` and are admitted on the utility name alone, which is
// what the screening does while the reference is still loading.
export function utilityFeedSites(results, commodity, { state = null, utility = null } = {}) {
  const utilKey = commodity === 'gas' ? 'gasUtility' : 'electricUtility';
  const out = [];
  for (const r of (results || [])) {
    if (!(isEligible(r, 'bbs') || isEligible(r, 'bps'))) continue;
    if (r.wbMeters && r.wbMeters[commodity] !== 'yes') continue;
    const feedUtility = String(r[utilKey] || '').trim();
    if (!feedUtility) continue;
    const feedState = String(r.mandateState || r.state || '').trim();
    if (utility != null && feedUtility !== utility) continue;
    if (state != null && feedState !== state) continue;
    out.push({ ...r, feedState, feedUtility });
  }
  out.sort((a, b) => a.feedState.localeCompare(b.feedState)
    || a.feedUtility.localeCompare(b.feedUtility)
    || String(a.siteName || '').localeCompare(String(b.siteName || '')));
  return out;
}

// Whole-Building Utility Data Collection eligibility: sites eligible for BBS or
// BPS, grouped by state → utility, for a commodity ('electric' | 'gas').
export function utilityFeedEligibility(results, commodity) {
  const sites = utilityFeedSites(results, commodity);
  const byState = new Map();
  for (const r of sites) {
    if (!byState.has(r.feedState)) byState.set(r.feedState, new Map());
    const u = byState.get(r.feedState);
    u.set(r.feedUtility, (u.get(r.feedUtility) || 0) + 1);
  }
  const rows = [];
  for (const [state, utils] of byState) {
    for (const [utility, count] of utils) rows.push({ state, utility, count });
  }
  rows.sort((a, b) => a.state.localeCompare(b.state) || b.count - a.count);
  return { total: sites.length, rows };
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

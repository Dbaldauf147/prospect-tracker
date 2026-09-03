import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { sanitizeExcelWorkbook } from '../../utils/exportSanitize.js';
import { DataTable } from '../common/DataTable';
import {
  saveList as saveListToIDB,
  loadList as loadListFromIDB,
  clearList as clearListFromIDB,
} from '../../utils/uploadedListStore';
import {
  saveUtilityRates,
  loadUtilityRates,
  clearUtilityRates,
  normalizeZip,
} from '../../utils/utilityRatesStore';
import {
  zipToState,
  normalizeState,
  detectConsumptionColumns,
  detectConsumptionUnit,
  normalizeElectricUom,
  normalizeGasUom,
  resolveContractPriceUom,
  priceUomLabel,
  summarizePriceUomFlags,
  toKwh,
  toTherms,
  stateRate,
  propertyTypeSegment,
  normalizeSegment,
  formatMoney,
  formatRate,
} from '../../utils/utilityRates';
import { isCaliforniaSite } from '../../utils/siteRegion';
import {
  siteEditableColumns, coerceSiteValue, applySiteColumnEdit, describeSiteEdit,
} from '../../utils/siteMassEdit';
import { mergeIntoSiteList } from '../../utils/siteListMerge';
import { parseAllSheets, parseBestSheet, parseSplitSitesTemplate, readRoundTripState, isIndicativeSavingsExport, readSheetNames } from '../../utils/xlsxParse';
import { salvageWorkbook, looksLikeZipDamage, describeLostEntries } from '../../utils/salvageWorkbook';
import { UtilityMappingView, NAME_MAP_LIST_KEY } from './UtilityMappingView';
import { BuildingComplianceScreening } from './BuildingComplianceScreening';
import { ComplianceRoadmap } from './ComplianceRoadmap';
import { applyOrdinanceOverrides, overrideKey, mergeOverrideLayers } from '../../utils/ordinanceOverrides';
import { loadSharedOrdinanceOverrides, saveSharedOrdinanceOverride } from '../../utils/ordinanceOverrideStore';
import MASTER_ORDINANCES from '../../data/masterOrdinances.js';
import { scopeSitesByOwnership, isLeasedUtilityRow, savingsOwnershipScope, tenureCoverage } from './ownershipScope.js';
import { SavingsScopeToggle, TenureWarningBanner } from './OwnershipScopeBar.jsx';
import CorporateCompliance from './CorporateCompliance';
import { screenSites, CATEGORIES, totalPenalty, bpsPrioritization } from '../../utils/complianceMandates';
import {
  JURISDICTION_QUESTIONS, REGULATIONS_BY_JURISDICTION,
  deriveRegulationVerdict, parseRevenueUsd, pickThresholdRevenue,
  JURISDICTION_CRITERIA_GROUPS, criterionKey, deriveCriterion,
  deriveDoingBusinessInCA, deriveCsrdWaveVerdict, californiaRevenueScreen,
  ALWAYS_SHOW_REGULATIONS,
} from '../../data/corporateComplianceScreening';
import { classifyHqRegion, normalizeHqRegion } from '../../utils/hqRegion';
import { sustainabilityProfile } from '../../utils/sustainabilityProfile';
import { normalizeCompany } from '../../utils/companyNorm';
import { exportComplianceReportXlsx, buildCorporateComplianceSheet, buildComplianceMethodologySheet } from '../../utils/complianceReportXlsx';
import { detectColumn, pickZipColumn, pickSiteNameColumn } from '../../utils/siteColumns';
import { appendIntervalDataSummary } from '../../utils/intervalDataSummary';
import { buildDivisionsSheet, summarizeDivisions, divisionLabel } from '../../utils/divisionsSummary';
import { saveIndicativeAnalysis, getIndicativeAnalysisMeta, loadIndicativeAnalysis } from '../../utils/firestoreSync';
import { injectLiveLineChart } from '../../utils/xlsxLiveChart';
import { findFuzzyMatch } from '../../utils/utilityNameMatch';
import { classifyUtility } from '../../utils/utilityClassify';
import { buildCityStateZipIndex, buildCityStateZipFallback, estimateZipFromCityState } from '../../utils/zipEstimate';
import {
  saveZipFallback,
  loadZipFallback,
  clearZipFallback,
} from '../../utils/zipFallbackStore';
import { ENERGY_SUPPLIERS } from '../../data/energySuppliers';
import { isRegulatedRateOpportunity } from '../../data/regulatedRateOpportunities';
import {
  normalizePropertyType,
  estimateConsumption,
  propertyTypeAccounts,
  propertyTypeAccountTotal,
  propertyTypeIntensity,
  varianceVsEstimate,
  KWH_PER_DTH,
  CONSUMPTION_ESTIMATES,
  ACCOUNT_ESTIMATES,
  PROPERTY_TYPE_OPTIONS,
  PROPERTY_TYPE_EXCLUDED,
  PROPERTY_TYPE_EXCLUDED_LABEL,
} from '../../data/propertyTypeEstimates';
import {
  normalizeCountryName,
  countryElectricSavings,
  countryGasSavings,
  countryHasRegulatedRateOpportunity,
  COUNTRY_DEREGULATION,
} from '../../data/countryDeregulation';
import {
  NA_CATEGORIES,
  US_MARKETS,
  CA_MARKETS,
  normalizeProvince,
} from '../../data/naMarkets';
import {
  COUNTRY_CENTERS,
  US_STATE_CENTERS,
  CANADA_PROVINCE_CENTERS,
  statusTier,
  getCountryFeatures,
  getNAAdmin1Features,
  TOPO_NAME_TO_DEREG_KEY,
} from '../../data/worldGeo';
import {
  ISO_REGIONS,
  ISO_FILL,
  ISO_LABEL,
  isoForState,
  isoForProvince,
  resolveSiteIso,
  STATE_ISO_SPLIT,
  STATE_ISO_SUBAREAS,
} from '../../data/isoRegions';
import { lookupIsoForZip } from '../../utils/isoLookup';
import {
  countryElectricRate,
  countryGasRatePerTherm,
  normalizeCountryRateName,
} from '../../data/countryRates';
import styles from './SitesView.module.css';

const SITES_STORAGE_KEY = 'sites-list-override';

// Sentinel for the Division scope's "sites with no division" choice. A
// real division can't collide with it — a blank division is exactly the
// case this stands for, and any other value is the division's own text.
const NO_DIVISION = '__no-division__';

// The one place that decides what a Country cell means. Uploads spell the
// same country several ways — "United States" / "USA" / "US", "Canada" /
// "CAN" / "CA", "México" / "MEX" — and the checks below used to be written
// out by hand at each call site with a slightly different regex each time.
// They drifted: the utility-lookup and state-derivation gates accepted the
// three-letter codes while the NAM scope, the ST / Prov resolver and the
// Mexico flags did not, so a list whose Country column carried "CAN" kept
// its utility match but lost its province, its deregulation status, its
// indicative rate, and every dollar of indicative savings.
//
// Kept as regexes on the raw cell rather than routed through
// normalizeCountryName because these four answer a narrower question —
// "is this cell one of the North American countries the US-centric lookups
// are valid for" — and must keep accepting the alpha-2 forms ("US", "CA")
// that the country reference tables deliberately leave out.
const isUnitedStatesCountry = (raw) =>
  /^(u\.?\s*s\.?\s*a?\.?|united states( of america)?)$/i.test(String(raw || '').trim());
const isCanadaCountry = (raw) =>
  /^(ca|can|canada)$/i.test(String(raw || '').trim());
const isMexicoCountry = (raw) =>
  /^(mx|mex|m[eé]xico)$/i.test(String(raw || '').trim());
const isPuertoRicoCountry = (raw) =>
  /^(pr|puerto\s*rico)$/i.test(String(raw || '').trim());

// Which North American country a derived row belongs to, for the NAM sheet
// and its map.
//
// A blank Country column reads as the US (or Canada) when the row's state
// code is one. Everything upstream already treats a blank country that way:
// the state code is only derived at all for the US / Puerto Rico / Canada,
// so a row that HAS one has already been judged North American. Requiring
// the column to be filled in here meant a portfolio that never mapped
// Country — or mapped it and left cells blank — lost those sites off the
// NAM tab while the rest of the page counted them, so the sheet's total came
// up short of the site count with nothing on the sheet to explain the gap.
//
// A row with a genuine non-NA country is still out: the check only rescues
// rows whose country is absent, never one that says Spain.
function naScopeOf(row) {
  const rawCountry = String(row?.__country__ || '').trim();
  const country = normalizeCountryName(rawCountry) || rawCountry;
  const stateCode = String(row?.__state__ || '').trim().toUpperCase();
  let isUS = isUnitedStatesCountry(country);
  let isCA = isCanadaCountry(country);
  if (!isUS && !isCA && !rawCountry && stateCode) {
    if (US_STATE_CENTERS[stateCode]) isUS = true;
    else if (CANADA_PROVINCE_CENTERS[stateCode]) isCA = true;
  }
  return { country, stateCode, isUS, isCA, isNA: isUS || isCA };
}

// Does a derived row fall inside the active division scope? '' scopes to
// everything. Shared by the analysis set and the unestimated-site tally so
// the count next to the site total can't disagree with the table.
function rowInDivision(row, divisionFilter) {
  if (!divisionFilter) return true;
  const d = String(row?.__division__ || '').trim();
  return divisionFilter === NO_DIVISION ? !d : d === divisionFilter;
}

// Ceiling on a Master Analysis saved against a company. The workbook is
// chunked across Firestore docs (900 KB of base64 each) and the company popup
// reads only the metadata doc, so the binding cost is the upload itself — this
// is a backstop against a runaway workbook, not a portfolio-size limit. A
// ~2,700-site portfolio lands around 11–12 MB, so this leaves real headroom.
const MAX_ANALYSIS_MB = 40;
const MAX_ANALYSIS_BASE64_CHARS = Math.ceil((MAX_ANALYSIS_MB * 1024 * 1024) / 3) * 4;

// Utility accounts (bills) estimated for one site, as text. Halves are
// real — a property type whose water account is "0 – 1" contributes 0.5 —
// so the fraction is kept rather than rounded into a number the per-site
// breakdown beside it wouldn't add up to.
function fmtAccounts(n) {
  if (n == null || !Number.isFinite(n)) return '-';
  return Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

// The per-commodity working behind that number, in the reference table's
// own wording ('Multiple', '0 – 1', 'N/A') rather than the counts those
// stand in for. A steam row reading '0' is left out: every property type
// carries one, and a column of "Steam 0" says nothing.
function accountBreakdownText(acc) {
  if (!acc) return '';
  return [
    acc.electric ? `Elec ${acc.electric.label}` : null,
    acc.gas ? `Gas ${acc.gas.label}` : null,
    acc.water ? `Water ${acc.water.label}` : null,
    acc.waste ? `Waste ${acc.waste.label}` : null,
    acc.steam && acc.steam.label !== '0' ? `Steam ${acc.steam.label}` : null,
  ].filter(Boolean).join(' · ');
}

// When a company's saved Master Analysis was last written, phrased the way
// the question is actually asked — "is what's on this company still current?"
// Recent saves read as "today" / "3 days ago"; older ones get the date, with
// the year only when it isn't this one.
function describeAnalysisSave(meta) {
  const d = meta?.savedAt ? new Date(meta.savedAt) : null;
  if (!d || isNaN(d)) return 'previously';
  const midnight = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const now = new Date();
  const days = Math.round((midnight(now) - midnight(d)) / 86400000);
  if (days === 0) return `today, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

// xlsxParse reads date cells with raw:true, so source date values
// arrive as Excel serial numbers (e.g., 45673) rather than JS Dates.
// Convert at the row-creation boundary so every downstream consumer
// (Contract Summary, Contract Overview, Site Detail, the by-state
// Earliest Start aggregation) gets a real Date object — which Excel
// then displays correctly with a short-date numFmt.
function parseSourceDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
  const asNum = typeof v === 'number'
    ? v
    : (typeof v === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(v) ? Number(v) : NaN);
  if (Number.isFinite(asNum) && asNum >= 1 && asNum < 73050) {
    // Excel epoch is 1899-12-30 (accounts for its 1900-leap-year bug
    // on any realistic date). UTC midnight keeps the displayed day
    // stable across local-timezone DST shifts.
    const d = new Date(Date.UTC(1899, 11, 30) + asNum * 86400000);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const d = new Date(String(v).trim());
  return Number.isFinite(d.getTime()) ? d : null;
}

// A header that names a unit of measure rather than carrying a value.
// Used to hold those columns out of the price detection below.
const notUom = (h) => !/\b(uom|unit\s*of\s*measure|units?)\b/i.test(String(h));

// Auto-detect every Utility-Lookup target field on a fresh sites
// header list. Ordered patterns inside each detectColumn call go from
// most-specific to most-generic so that e.g. "Annual Electric Spend ($)"
// wins over "Electricity" when picking the cost column.
function detectSitesMapping(headers) {
  if (!headers.length) return { siteName: '', zip: '' };
  const siteName = pickSiteNameColumn(headers);
  return {
    siteName,
    companyName: detectColumn(headers, [/^company\s*name$/i, /^company$/i, /\bcompany\b/i, /\bportfolio\b/i, /parent\s*(co|company|org)/i, /\baccount\s*name\b/i, /\bcustomer\s*name\b/i, /\borganization\b/i, /\bclient\b/i]) || '',
    // Sub-level of Company Name — the operating brand / subsidiary /
    // business unit the site sits under. Patterns stay clear of the
    // company ones above so a sheet carrying both maps each correctly.
    division: detectColumn(headers, [/^division$/i, /^business\s*unit$/i, /^operating\s*(company|unit|brand)$/i, /^subsidiary$/i, /^banner$/i, /\bdivision\b/i, /business\s*unit/i, /\bsubsidiary\b/i]) || '',
    address: detectColumn(headers, [/^address$/i, /^street\s*address$/i, /street/i, /\baddress\b/i]) || '',
    city: detectColumn(headers, [/^city$/i, /^town$/i, /^municipality$/i, /\bcity\b/i]) || '',
    state: detectColumn(headers, [/^state$/i, /^province$/i, /^state\s*\/\s*province$/i, /\bstate\b/i, /\bregion\b/i]) || '',
    zip: pickZipColumn(headers),
    country: detectColumn(headers, [/^country$/i, /\bcountry\b/i, /\bnation\b/i]) || '',
    propertyType: detectColumn(headers, [/property\s*type/i, /building\s*type/i, /property\s*class/i, /asset\s*type/i, /^use$/i, /\buse\s*type\b/i, /\bsegment\b/i]) || '',
    segment: detectColumn(headers, [/customer\s*class/i, /rate\s*class/i, /\bc\s*&\s*i\b/i, /commercial\s*\/?\s*industrial/i, /industrial\s*\/?\s*commercial/i, /comm.*ind|ind.*comm/i]) || '',
    // "Tenure Category" / "Tenure Type" is how a lot of real-estate
    // exports label the owned-vs-leased column, so it gets an exact
    // pattern alongside bare "Tenure"; a bare \btenure\b sits last so a
    // header that merely mentions the word only wins when nothing better
    // is on the sheet.
    ownership: detectColumn(headers, [/^ownership$/i, /^owned\s*\/?\s*leased?$/i, /^leased?\s*\/?\s*owned?$/i, /^own\s*\/?\s*lease$/i, /ownership\s*(status|type)/i, /\bownership\b/i, /^tenure$/i, /^tenure\s*(category|categorization|type|status|class(ification)?)$/i, /tenure\s*(category|type|status)/i, /occupancy\s*(status|type)/i, /(own|lease)\w*\s*status/i, /\btenure\b/i]) || '',
    siteDescription: detectColumn(headers, [/^site\s*description$/i, /^description$/i, /\bdescription\b/i]) || '',
    propertySize: detectColumn(headers, [/sq\s*\.?\s*ft/i, /square\s*(feet|foot)/i, /\bft\s*2\b/i, /\bft\^?2\b/i, /\bsf\b/i, /size.*ft/i, /building.*size/i, /gross.*area/i, /^size$/i, /rsf|gsf/i]) || '',
    electric: detectColumn(headers, [/electric.*kwh|kwh.*electric/i, /annual.*electric.*kwh/i, /annual.*kwh/i, /^kwh$/i, /electric.*usage/i, /electric.*consumption/i, /annual.*electric/i, /^electric$/i]) || '',
    electricUom: detectColumn(headers, [/electric.*\b(uom|unit\s*of\s*measure|units?)\b/i, /\b(uom|unit\s*of\s*measure|units?)\b.*electric/i]) || '',
    gas: detectColumn(headers, [/gas.*therm|therm.*gas/i, /annual.*gas.*(therm|dth|mmbtu)/i, /natural\s*gas.*usage/i, /gas.*usage/i, /gas.*consumption/i, /^therms?$/i, /^dth$/i, /^mmbtu$/i, /annual.*gas/i, /^gas$/i]) || '',
    gasUom: detectColumn(headers, [/gas.*\b(uom|unit\s*of\s*measure|units?)\b/i, /\b(uom|unit\s*of\s*measure|units?)\b.*gas/i]) || '',
    electricCost: detectColumn(headers, [/electric.*(actual|annual).*(cost|spend|amount|\$)/i, /(actual|annual).*electric.*(cost|spend)/i, /electric.*cost/i, /electric.*spend/i, /electric.*\$/i]) || '',
    gasCost: detectColumn(headers, [/gas.*(actual|annual).*(cost|spend|amount|\$)/i, /(actual|annual).*gas.*(cost|spend)/i, /gas.*cost/i, /gas.*spend/i, /gas.*\$/i]) || '',
    electricSupplier: detectColumn(headers, [/electric.*(supplier|provider|vendor)/i, /(supplier|provider|vendor).*electric/i]) || '',
    gasSupplier: detectColumn(headers, [/gas.*(supplier|provider|vendor)/i, /(supplier|provider|vendor).*gas/i]) || '',
    electricStart: detectColumn(headers, [/electric.*contract.*start/i, /electric.*start.*date/i, /electric.*begin/i]) || '',
    electricEnd: detectColumn(headers, [/electric.*contract.*end/i, /electric.*(end|expir).*date/i, /electric.*term.*end/i]) || '',
    // `notUom` keeps a price from binding to its own "… Contract Price UoM"
    // column, which every one of these patterns also matches. detectColumn
    // takes the first header in file order, so without the guard a file that
    // lists the UoM column first maps the price to a unit string.
    electricContractPrice: detectColumn(headers.filter(notUom), [/electric.*contract.*(price|rate)/i, /electric.*\$\s*\/\s*kwh/i, /electric.*supply\s*(price|rate)/i, /(power|electricity).*contract.*price/i]) || '',
    electricContractName: detectColumn(headers, [/electric.*contract.*name/i, /(power|electricity).*contract.*name/i, /electric.*deal\s*name/i]) || '',
    electricProductType: detectColumn(headers, [/electric.*product/i, /(power|electricity).*product/i, /electric.*structure/i]) || '',
    gasStart: detectColumn(headers, [/gas.*contract.*start/i, /gas.*start.*date/i, /gas.*begin/i]) || '',
    gasEnd: detectColumn(headers, [/gas.*contract.*end/i, /gas.*(end|expir).*date/i, /gas.*term.*end/i]) || '',
    gasContractPrice: detectColumn(headers.filter(notUom), [/gas.*contract.*(price|rate)/i, /gas.*\$\s*\/\s*(therm|mmbtu|dth)/i, /gas.*supply\s*(price|rate)/i]) || '',
    gasContractName: detectColumn(headers, [/gas.*contract.*name/i, /gas.*deal\s*name/i]) || '',
    gasProductType: detectColumn(headers, [/gas.*product/i, /gas.*structure/i]) || '',
  };
}

// Ownership status of the building — Owned vs Leased. Source sheets
// spell it a dozen ways ("Own", "Owner-Occupied", "Tenant", "Leasehold",
// bare "O"/"L"), so fold the common variants onto the two canonical
// labels. Anything we can't place comes back null and the raw string is
// surfaced as-is, same treatment as an unrecognized property type.
function normalizeOwnership(raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!v) return null;
  // Single-letter codes first — too short for the word test below.
  if (v === 'o') return 'Owned';
  if (v === 'l') return 'Leased';
  const saysOwned = /\bown(s|ed|er|ers|ership)?\b|\bfreehold\b|\bpurchased?\b/.test(v);
  const saysLeased = /\bleas(e|es|ed|ing|ehold)\b|\blessee\b|\btenant\b|\brent(s|ed|ing|al)?\b/.test(v);
  // "Owned/Leased" and friends name both — genuinely ambiguous for a
  // single site, so leave it unresolved rather than guessing.
  if (saysOwned && !saysLeased) return 'Owned';
  if (saysLeased && !saysOwned) return 'Leased';
  return null;
}

// classifyUtility (Regulated vs Deregulated) now lives in
// ../../utils/utilityClassify so the Master Site List shares it.

// Ontario Global Adjustment (GA) opportunity flag. Every Ontario
// commercial customer pays GA, but only Class A — peak demand ≥ 1 MW
// (or ≥ 500 kW for select industries under the expanded ICI) — can
// reduce it by curtailing during the IESO's top-5 system-peak hours.
// We only have annual kWh, so use it as a coarse proxy:
//   ≥ 4.38 GWh  → ~500 kW peak at 100 % LF / ~1 MW at 50 % LF —
//                 strong Class A candidate.
//   ≥ 1.0  GWh  → load big enough that peak demand could clear the
//                 500 kW Class A bar; flag for verification.
//   smaller     → almost certainly Class B; still pays GA but no ICI
//                 lever.
const GAC_CLASS_A_KWH = 4_380_000;
const GAC_REVIEW_KWH = 1_000_000;
function gacOpportunity(state, kwh) {
  if (String(state || '').toUpperCase() !== 'ON') return null;
  if (kwh != null && kwh >= GAC_CLASS_A_KWH) {
    return { tier: 'high', label: 'Yes: Class A potential' };
  }
  if (kwh != null && kwh >= GAC_REVIEW_KWH) {
    return { tier: 'mid', label: 'Maybe: verify peak demand' };
  }
  return { tier: 'low', label: 'Class B (small load)' };
}

// The utility-provider lookup is North-America-centric: the bundled
// utility database (zip → utility, plus the known-utility fuzzy list)
// only covers the United States, Puerto Rico, Canada, and Mexico. For a
// site in any other country a zip can still collide with a US zip and
// resolve a bogus provider, so we gate the lookup to those four. An
// empty / unknown country defaults to in-scope — uploads without a
// Country column are overwhelmingly US, matching the prior behavior.
function isUtilityLookupCountry(rawCountry) {
  const c = String(rawCountry || '').trim();
  if (!c) return true;
  return isUnitedStatesCountry(c)
    || isPuertoRicoCountry(c)
    || isCanadaCountry(c)
    || isMexicoCountry(c);
}

// Narrower still: which countries a US/Canadian state code may be
// DERIVED for. Every source of that code — the utility file's zip match,
// the zip-prefix table, and the state-column normalizer — speaks US
// 2-letter codes, and postal codes collide across countries: a Spanish
// 45600 reads as Ohio's 456xx, an Argentine 16291 as Pennsylvania's
// 162xx. That produced a state (and an ISO, and a US state's indicative
// rate, and a US state's compliance ordinances) for sites nowhere near
// North America.
//
// Mexico is in scope for the utility lookup above but NOT here: its
// 5-digit códigos postales collide with US zips just as freely, and it
// has no US-style state code to resolve to. Its subdivision reaches the
// Mexico flags as the raw uploaded string instead (__stateRaw__).
//
// An empty / unknown country stays in scope, like the lookup above:
// uploads without a Country column are overwhelmingly US.
function isStateCodeCountry(rawCountry) {
  const c = String(rawCountry || '').trim();
  if (!c) return true;
  return isUnitedStatesCountry(c)
    || isPuertoRicoCountry(c)
    || isCanadaCountry(c);
}

// Inline autocomplete input used by supplier cells in the Utility
// Lookup table. Filters the bundled ENERGY_SUPPLIERS list by the
// typed substring; Enter commits the highlighted match (or the typed
// text when nothing is highlighted), Escape cancels, blur commits.
// Free-form text is allowed too — picking from the list is just a
// shortcut, not a constraint, since the source data sometimes has
// regional / co-op suppliers that aren't on the bundled list.
function SupplierAutocomplete({ initialValue, onCommit, onCancel }) {
  const [draft, setDraft] = useState(initialValue || '');
  const [hover, setHover] = useState(0);
  const [navigated, setNavigated] = useState(false);
  const [open, setOpen] = useState(true);
  // Anchor rect for the portaled dropdown — the cell wrapping this
  // input has overflow:hidden, so an in-DOM absolute-positioned
  // dropdown gets clipped. Rendering the list to document.body and
  // pinning it to the input's getBoundingClientRect avoids that.
  const [anchor, setAnchor] = useState(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const updateAnchor = () => {
    if (!inputRef.current) return;
    const r = inputRef.current.getBoundingClientRect();
    setAnchor({ top: r.bottom + 2, left: r.left, width: Math.max(r.width, 220) });
  };
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      try { inputRef.current.select(); } catch (e) { void e; }
      updateAnchor();
    }
    const onScrollOrResize = () => updateAnchor();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, []);
  useEffect(() => {
    const onDown = (e) => {
      const insideInput = inputRef.current && inputRef.current.contains(e.target);
      const insideList = listRef.current && listRef.current.contains(e.target);
      if (!insideInput && !insideList) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);
  const q = (draft || '').trim().toLowerCase();
  const matches = q
    ? ENERGY_SUPPLIERS.filter(n => String(n).toLowerCase().includes(q)).slice(0, 50)
    : ENERGY_SUPPLIERS.slice(0, 50);
  const showList = open && matches.length > 0 && anchor;
  return (
    <div style={{ position: 'relative', minWidth: 180 }}>
      <input
        ref={inputRef}
        type="text"
        value={draft}
        placeholder="Type a supplier…"
        onChange={e => { setDraft(e.target.value); setHover(0); setNavigated(false); setOpen(true); }}
        onFocus={updateAnchor}
        onBlur={(e) => {
          // Ignore blur caused by clicking inside our own portaled list.
          if (listRef.current && listRef.current.contains(e.relatedTarget)) return;
          onCommit(draft);
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (showList && navigated && matches[hover] !== undefined) onCommit(matches[hover]);
            else onCommit(draft);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          } else if (showList) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setNavigated(true); setHover(h => Math.min(h + 1, matches.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setNavigated(true); setHover(h => Math.max(h - 1, 0)); }
          }
        }}
        style={{ width: '100%', padding: '0.25rem 0.4rem', fontSize: '0.72rem', fontFamily: 'inherit', border: '1px solid #93C5FD', borderRadius: 4 }}
      />
      {showList && createPortal(
        <div
          ref={listRef}
          tabIndex={-1}
          style={{ position: 'fixed', top: anchor.top, left: anchor.left, width: anchor.width, maxHeight: 240, overflowY: 'auto', background: '#fff', border: '1px solid #CBD5E1', borderRadius: 4, boxShadow: '0 8px 20px rgba(15,23,42,0.18)', zIndex: 1000 }}
        >
          {matches.map((m, i) => (
            <div
              key={m}
              onMouseDown={e => { e.preventDefault(); onCommit(m); }}
              onMouseEnter={() => { setHover(i); setNavigated(true); }}
              style={{ padding: '0.3rem 0.5rem', fontSize: '0.72rem', background: i === hover ? '#EFF6FF' : '#fff', color: '#1E293B', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >{m}</div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

// Same slug transform ProspectModal uses to key a company's uploaded site
// list under settings.companySiteLists — kept in sync so a lookup here
// resolves the exact entry the modal wrote.
function companySlug(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '-');
}

// Canonical key the Corporate Compliance page saves screening answers,
// research notes, reference links and findings under. Distinct from
// companySlug, which is what the revenue research is keyed by — both are
// needed to carry a company's research in and out of an export.
function complianceKeyOf(name) {
  const norm = normalizeCompany(name);
  return norm ? norm.replace(/\s+/g, '-') : '';
}

// Look up a company (from Table View / any company that has a site list)
// and show whether a site list is already mapped to it. Site lists live in
// settings.companySiteLists, keyed by the company-name slug, and are
// uploaded from the company popup. This is a read-only convenience so the
// user doesn't have to open each company to check.
// Maps the Property Type strings an upload carried onto our canonical
// list, for the values normalizePropertyType couldn't place. Opens
// automatically after an import that brought in unrecognized types, and
// stays reachable from the header chip. Left column is what the file
// said (with how many sites use it); right column picks the type we
// support. Unmapped rows are simply left alone — a site with no
// resolvable property type still imports, it just gets no
// consumption / account estimates.
function PropertyTypeMappingModal({ items, value, onSave, onClose }) {
  // Local draft so the table can be filled in before anything is
  // committed; seeded with whatever is already mapped.
  const [draft, setDraft] = useState(() => {
    const seed = {};
    for (const it of items) if (value[it.key]) seed[it.key] = value[it.key];
    return seed;
  });
  const chosen = Object.values(draft).filter(Boolean).length;
  // Types marked N/A, and how many sites carry them — the consequence is
  // worth stating before the mapping is applied.
  const excludedKeys = items.filter(it => draft[it.key] === PROPERTY_TYPE_EXCLUDED);
  const excludedSiteCount = excludedKeys.reduce((n, it) => n + (it.count || 0), 0);
  // Rows still without a target, judged against the draft so the copy
  // updates as the user fills the table in.
  const pending = items.filter((it) => !draft[it.key]).length;

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', zIndex: 10000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 10, width: 'min(720px, 96vw)', maxHeight: '82vh',
          display: 'flex', flexDirection: 'column', boxShadow: '0 16px 48px rgba(15, 23, 42, 0.25)',
        }}
      >
        <div style={{ padding: '0.9rem 1.1rem 0.6rem', borderBottom: '1px solid #E2E8F0' }}>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A' }}>
            Map property types
          </div>
          <div style={{ fontSize: '0.75rem', color: '#64748B', marginTop: '0.25rem', lineHeight: 1.45 }}>
            {items.length === 0 ? (
              <>Nothing to map: every property type in your site list already matches a type we support.</>
            ) : pending > 0 ? (
              <>
                {pending} property {pending === 1 ? 'type' : 'types'} in your site list {pending === 1 ? "doesn't" : "don't"} match
                the types we support. Pick the closest match for each so the sites pick up
                consumption and account estimates. Anything you leave blank stays unmapped.
              </>
            ) : (
              <>Every property type is mapped. Change a target below to re-map it, or set one back
                to &ldquo;leave unmapped&rdquo; to drop the mapping.</>
            )}
            {items.length > 0 && (
              <div style={{ marginTop: '0.35rem' }}>
                Pick <strong>{PROPERTY_TYPE_EXCLUDED_LABEL}</strong> for anything with no usage worth
                modelling: parking lots, ATMs, cell towers. Those sites still count, still screen for
                compliance and still appear in every export — they just carry no estimated
                electricity or gas, so they add nothing to the spend and savings figures. Any usage
                your own file supplies for them is still used.
              </div>
            )}
          </div>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '0.4rem 1.1rem 0.8rem' }}>
          {items.length === 0 && (
            <div style={{ padding: '1.4rem 0.2rem', textAlign: 'center', color: '#94A3B8', fontSize: '0.8rem' }}>
              No property types need mapping.
            </div>
          )}
          {items.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem 0.4rem 0', fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748B', borderBottom: '1px solid #E2E8F0' }}>
                  In your file
                </th>
                <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748B', borderBottom: '1px solid #E2E8F0', width: '46%' }}>
                  Map to
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.key}>
                  <td style={{ padding: '0.4rem 0.5rem 0.4rem 0', borderBottom: '1px solid #F1F5F9', verticalAlign: 'middle' }}>
                    <div style={{ fontWeight: 600, color: draft[it.key] === PROPERTY_TYPE_EXCLUDED ? '#94A3B8' : '#1E293B', wordBreak: 'break-word' }}>{it.raw}</div>
                    <div style={{ fontSize: '0.68rem', color: draft[it.key] === PROPERTY_TYPE_EXCLUDED ? '#B45309' : '#94A3B8' }}>
                      {it.count} {it.count === 1 ? 'site' : 'sites'}
                      {draft[it.key] === PROPERTY_TYPE_EXCLUDED ? ' · no usage estimated' : ''}
                    </div>
                  </td>
                  <td style={{ padding: '0.4rem 0.5rem', borderBottom: '1px solid #F1F5F9', verticalAlign: 'middle' }}>
                    <select
                      value={draft[it.key] || ''}
                      onChange={(e) => setDraft((d) => ({ ...d, [it.key]: e.target.value }))}
                      aria-label={`Map "${it.raw}" to a property type`}
                      style={{
                        width: '100%', padding: '0.3rem 0.4rem', borderRadius: 6, fontFamily: 'inherit',
                        fontSize: '0.78rem', border: '1px solid #CBD5E1', background: '#fff',
                        color: draft[it.key] ? '#0F172A' : '#94A3B8', cursor: 'pointer',
                      }}
                    >
                      <option value="">(leave unmapped)</option>
                      <option value={PROPERTY_TYPE_EXCLUDED}>{PROPERTY_TYPE_EXCLUDED_LABEL}</option>
                      {PROPERTY_TYPE_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
        </div>

        <div style={{ padding: '0.7rem 1.1rem', borderTop: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem' }}>
          <span style={{ fontSize: '0.72rem', color: '#64748B' }}>
            {items.length > 0 ? `${chosen} of ${items.length} mapped` : ''}
            {excludedKeys.length > 0 && (
              <span style={{ color: '#B45309', fontWeight: 600 }}>
                {' · '}{excludedKeys.length} marked N/A
                {excludedSiteCount > 0 ? ` (${excludedSiteCount.toLocaleString()} site${excludedSiteCount === 1 ? '' : 's'} left unestimated)` : ''}
              </span>
            )}
          </span>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button
              type="button"
              onClick={onClose}
              style={{ padding: '0.4rem 0.9rem', background: '#fff', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: '0.8rem', fontFamily: 'inherit', cursor: 'pointer' }}
            >Cancel</button>
            <button
              type="button"
              onClick={() => onSave(draft)}
              style={{ padding: '0.4rem 0.9rem', background: '#009530', border: '1px solid #009530', color: '#fff', borderRadius: 6, fontSize: '0.8rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}
            >Apply mapping</button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function CompanySiteListLookup({ prospects = [], companySiteLists = {}, onUseCompany, activeCompany = '', onSelectProspect, resetSignal = 0, onImportAnalysis, importStatus = { state: 'idle', message: '' } }) {
  // Seed the lookup from an already-mapped portfolio company so its name and
  // status show on load without re-searching.
  const [query, setQuery] = useState(activeCompany || '');
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(activeCompany || '');
  const boxRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  // Screen position for the portaled suggestion list. The lookup row is a
  // horizontal scroller (overflowX: auto), which clips anything absolutely
  // positioned below the input — so the list renders into document.body and
  // is anchored to the input's rect instead. Same pattern as the supplier
  // combobox above.
  const [anchor, setAnchor] = useState(null);

  const updateAnchor = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Drop above the input when there isn't room below it.
    const below = window.innerHeight - r.bottom;
    const flip = below < 140 && r.top > below;
    setAnchor({
      left: r.left,
      width: Math.max(r.width, 220),
      top: flip ? undefined : r.bottom + 2,
      bottom: flip ? window.innerHeight - r.top + 2 : undefined,
      maxHeight: Math.max(120, Math.min(240, (flip ? r.top : below) - 12)),
    });
  }, []);

  useEffect(() => {
    function onDown(e) {
      const insideBox = boxRef.current?.contains(e.target);
      const insideList = listRef.current?.contains(e.target);
      if (!insideBox && !insideList) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // Keep the list glued to the input while anything scrolls or resizes —
  // capture phase so the lookup row's own sideways scroll counts too.
  useEffect(() => {
    if (!open) return;
    updateAnchor();
    const onMove = () => updateAnchor();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, updateAnchor]);

  // slug -> entry for every company that actually has a site list.
  const bySlug = useMemo(() => {
    const m = new Map();
    for (const [slug, entry] of Object.entries(companySiteLists || {})) {
      if (entry && Array.isArray(entry.rows) && entry.rows.length > 0) m.set(slug, entry);
    }
    return m;
  }, [companySiteLists]);

  // Autocomplete pool: every Table View company, unioned with any company
  // that has a site list (so a mapped company shows even without a prospect
  // record). Deduped case-insensitively.
  const companyNames = useMemo(() => {
    const seen = new Set();
    const names = [];
    const add = (n) => {
      const name = String(n || '').trim();
      if (!name) return;
      const k = name.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      names.push(name);
    };
    for (const p of prospects || []) add(p?.company);
    for (const entry of bySlug.values()) add(entry?.company);
    return names.sort((a, b) => a.localeCompare(b));
  }, [prospects, bySlug]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const starts = [], includes = [];
    for (const n of companyNames) {
      const lower = n.toLowerCase();
      if (lower.startsWith(q)) starts.push(n);
      else if (lower.includes(q)) includes.push(n);
      if (starts.length + includes.length >= 40) break;
    }
    return [...starts, ...includes].slice(0, 30);
  }, [query, companyNames]);

  // slug -> prospect (company) record, so a looked-up company can surface
  // the revenue saved on its Table View record.
  const prospectBySlug = useMemo(() => {
    const m = new Map();
    for (const p of prospects || []) {
      const slug = companySlug(p?.company);
      if (slug && !m.has(slug)) m.set(slug, p);
    }
    return m;
  }, [prospects]);

  const result = useMemo(() => {
    if (!picked) return null;
    const slug = companySlug(picked);
    const entry = bySlug.get(slug) || null;
    const prospect = prospectBySlug.get(slug) || null;
    return {
      company: picked,
      entry,
      prospect,
      revenue: String(prospect?.revenue || '').trim(),
      analysis: prospect?.indicativeAnalysisMeta || null,
    };
  }, [picked, bySlug, prospectBySlug]);

  // The prospect-record marker is only stamped on saves made after it was
  // introduced, so analyses saved before that would read "Not saved". Fall
  // back to a metadata-only read of the picked company's analyses doc — one
  // document read, and only for the company currently on screen.
  const [fetchedAnalysis, setFetchedAnalysis] = useState(null);
  const resultProspectId = result?.prospect?.id || null;
  useEffect(() => {
    setFetchedAnalysis(null);
    if (!resultProspectId) return;
    let cancelled = false;
    getIndicativeAnalysisMeta(resultProspectId)
      .then((meta) => { if (!cancelled) setFetchedAnalysis(meta); })
      .catch(() => { /* absent or unreadable — leave the marker-based value */ });
    return () => { cancelled = true; };
  }, [resultProspectId]);

  const analysisMeta = result?.analysis || fetchedAnalysis || null;

  // `query` / `picked` are seeded from activeCompany on mount only, so a
  // later change to the mapped portfolio company left this panel showing
  // the old name — most visibly after Remove Sites, which clears the
  // mapping but couldn't reach this local state. Re-sync whenever
  // activeCompany actually changes. Typing alone doesn't move
  // activeCompany, so an in-progress search is never stomped.
  const lastActiveRef = useRef(activeCompany || '');
  useEffect(() => {
    const next = activeCompany || '';
    if (next === lastActiveRef.current) return;
    lastActiveRef.current = next;
    setPicked(next);
    setQuery(next);
  }, [activeCompany]);

  // Remove Sites empties the page, so it bumps `resetSignal` to empty this
  // panel too. Needed on top of the sync above because a company can be
  // looked up here without ever being mapped — activeCompany never moves
  // in that case, so there'd be no change for the sync to react to.
  const firstResetRef = useRef(true);
  useEffect(() => {
    if (firstResetRef.current) { firstResetRef.current = false; return; }
    setPicked('');
    setQuery('');
    setOpen(false);
  }, [resetSignal]);

  function choose(name) {
    setPicked(name);
    setQuery(name);
    setOpen(false);
  }

  function clearPick() {
    setPicked('');
    setQuery('');
    if (onUseCompany && activeCompany) onUseCompany('');
  }

  return (
    <div
      ref={boxRef}
      style={{
        marginTop: '0.6rem', padding: '0.5rem 0.75rem',
        border: '1px solid var(--color-border)', borderRadius: 8, background: '#fff',
        // Everything sits on one horizontal line — title, search, the picked
        // company, and every status. Never wraps; the row scrolls sideways
        // instead of stacking when the viewport can't fit it.
        display: 'flex', alignItems: 'center', gap: '0.85rem',
        flexWrap: 'nowrap', overflowX: 'auto',
      }}
    >
      <div style={{ flexShrink: 0, fontSize: '0.75rem', fontWeight: 700, color: '#0F172A', whiteSpace: 'nowrap' }}>
        Company Look Up
      </div>
      <div style={{ position: 'relative', flex: '0 0 210px' }}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder="Type a company name…"
          onChange={(e) => { setQuery(e.target.value); setOpen(true); updateAnchor(); if (picked) setPicked(''); }}
          onFocus={() => { if (query.trim()) { setOpen(true); updateAnchor(); } }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (matches.length > 0) choose(matches[0]);
              else if (query.trim()) { setPicked(query.trim()); setOpen(false); }
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
          style={{
            width: '100%', boxSizing: 'border-box', padding: '0.4rem 0.55rem',
            border: '1px solid var(--color-border)', borderRadius: 6,
            fontSize: '0.8rem', fontFamily: 'inherit',
          }}
        />
        {open && matches.length > 0 && anchor && createPortal(
          <div
            ref={listRef}
            style={{
              position: 'fixed', zIndex: 1000,
              left: anchor.left, width: anchor.width,
              top: anchor.top, bottom: anchor.bottom,
              maxHeight: anchor.maxHeight, overflowY: 'auto',
              background: '#fff', border: '1px solid #CBD5E1', borderRadius: 6,
              boxShadow: '0 8px 20px rgba(15,23,42,0.18)',
            }}
          >
            {matches.map((n) => {
              const has = bySlug.has(companySlug(n));
              return (
                <div
                  key={n}
                  onMouseDown={(e) => { e.preventDefault(); choose(n); }}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem',
                    padding: '0.35rem 0.55rem', fontSize: '0.76rem', color: '#1E293B', cursor: 'pointer',
                  }}
                  onMouseOver={(e) => e.currentTarget.style.background = '#F1F5F9'}
                  onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n}</span>
                  <span style={{ flexShrink: 0, fontSize: '0.62rem', fontWeight: 700, color: has ? '#166534' : '#94A3B8' }}>
                    {has ? '● list' : '-'}
                  </span>
                </div>
              );
            })}
          </div>,
          document.body
        )}
      </div>

      {result && (
        <>
          {/* Mapped company name — clickable to open the company popup when a
              matching Table View record exists. */}
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'nowrap', whiteSpace: 'nowrap' }}>
            {onSelectProspect && result.prospect ? (
              <button
                type="button"
                onClick={() => onSelectProspect(result.prospect)}
                title={`Open ${result.company}'s company page`}
                style={{ padding: 0, border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.85rem', fontWeight: 700, color: '#005A9E', textDecoration: 'underline', textUnderlineOffset: '2px' }}
              >
                {result.company}
              </button>
            ) : (
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0F172A' }}>{result.company}</span>
            )}
            {onUseCompany && (result.company === activeCompany ? (
              <span style={{ padding: '0.05rem 0.45rem', borderRadius: 999, background: '#DCFCE7', border: '1px solid #86EFAC', color: '#166534', fontSize: '0.62rem', fontWeight: 700 }}>
                ✓ Portfolio company
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onUseCompany(result.company)}
                title="Apply this company to every uploaded site (shows on all Utility Lookup subtabs, including Corporate Compliance)"
                style={{ padding: '0.2rem 0.55rem', border: '1px solid #009530', background: '#009530', color: '#fff', borderRadius: 6, fontSize: '0.66rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700 }}
              >
                Map as portfolio company
              </button>
            ))}
            <button
              type="button"
              onClick={clearPick}
              title="Clear the looked-up company"
              style={{ padding: '0.2rem 0.5rem', border: '1px solid #CBD5E1', background: '#fff', color: '#64748B', borderRadius: 6, fontSize: '0.66rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700 }}
            >
              Clear
            </button>
          </div>

          {/* The saved site list and the Indicative Savings Analysis are
              two stores behind one idea — the analysis is built from the
              site list — so they report as a single status. Either one
              present counts as saved; whichever details exist are shown
              (site count from the list, save date from the analysis). */}
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'baseline', gap: '0.4rem', whiteSpace: 'nowrap' }}>
            <span style={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: '#94A3B8' }}>
              Indicative savings
            </span>
            {(result.entry || analysisMeta) ? (
              <span style={{ fontSize: '0.74rem', color: '#166534', fontWeight: 600 }}>
                ✓ Saved
                <span style={{ color: '#15803D', fontWeight: 400 }}>
                  {result.entry
                    ? ` · ${result.entry.rows.length} site${result.entry.rows.length === 1 ? '' : 's'}`
                    : ''}
                  {analysisMeta?.savedAt
                    ? ` · ${new Date(analysisMeta.savedAt).toLocaleDateString()}`
                    : ''}
                </span>
              </span>
            ) : (
              <span style={{ fontSize: '0.74rem', color: '#94A3B8' }}>Not saved</span>
            )}
            {/* Pull that saved analysis back onto the page — the site
                list it was built from, its column mapping and supplier
                decisions, which between them repopulate every subtab.
                Only offered when the company has an analysis to import
                and a prospect record to read it from. */}
            {onImportAnalysis && analysisMeta && result.prospect && (
              <button
                type="button"
                onClick={() => onImportAnalysis(result.prospect)}
                disabled={importStatus.state === 'loading'}
                title={`Import ${result.company}'s saved Master Analysis into the Utility Lookup page: loads its site list and refills every subtab (Utility Mapping, Building Compliance, Roadmap, Corporate Compliance). Replaces the sites currently loaded.`}
                style={{
                  padding: '0.2rem 0.55rem', border: '1px solid #005A9E',
                  background: importStatus.state === 'loading' ? '#E2E8F0' : '#005A9E',
                  color: importStatus.state === 'loading' ? '#64748B' : '#fff',
                  borderRadius: 6, fontSize: '0.66rem',
                  cursor: importStatus.state === 'loading' ? 'default' : 'pointer',
                  fontFamily: 'inherit', fontWeight: 700, whiteSpace: 'nowrap',
                }}
              >
                {importStatus.state === 'loading' ? 'Importing…' : '⬆ Import Analysis'}
              </button>
            )}
          </div>
          {importStatus.state !== 'idle' && importStatus.message && (
            <div style={{
              flexShrink: 0, whiteSpace: 'nowrap', padding: '0.2rem 0.5rem', borderRadius: 6,
              fontSize: '0.7rem',
              background: importStatus.state === 'success' ? '#DCFCE7' : importStatus.state === 'error' ? '#FEE2E2' : '#F1F5F9',
              color: importStatus.state === 'success' ? '#166534' : importStatus.state === 'error' ? '#991B1B' : '#475569',
            }}>{importStatus.message}</div>
          )}
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'baseline', gap: '0.4rem', whiteSpace: 'nowrap' }}>
            <span style={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: '#94A3B8' }}>
              Company revenue
            </span>
            {result.revenue ? (
              <span style={{ fontSize: '0.74rem', color: '#0F172A', fontWeight: 700 }}>{result.revenue}</span>
            ) : (
              <span style={{ fontSize: '0.74rem', color: '#94A3B8' }}>Not set</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function SitesView({ settings, updateSettings, updateSettingsPath, prospects = [], updateProspect, onSelectProspect } = {}) {
  // Top-level toggle between the Utility Lookup page and the nested
  // Utility Mapping view (interval-data availability by utility).
  const [mainTab, setMainTab] = useState('lookup'); // 'lookup' | 'mapping' | 'compliance'
  const [sitesData, setSitesData] = useState([]);
  const [sitesLoaded, setSitesLoaded] = useState(false);
  const [utility, setUtility] = useState(null); // { zipMap, meta }
  const [utilityLoaded, setUtilityLoaded] = useState(false);
  // User-uploaded city + state → zip fallback table: { list, meta }.
  // Supplies a zip for sites that arrive with a city + state but no zip,
  // taking precedence over the zips inferred from the utility lookup.
  const [zipFallback, setZipFallback] = useState(null);
  const [zipFallbackBusy, setZipFallbackBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [utilityBusy, setUtilityBusy] = useState(false);
  // The utility-lookup / fallback-zip data-source bars are collapsed by
  // default — once the files are loaded they're just noise, so we tuck
  // them behind a toggle and show a one-line summary instead.
  const [showDataSources, setShowDataSources] = useState(false);
  const [mappingModal, setMappingModal] = useState(null);
  // Column-mapping modal for the Fallback Zips upload — mirrors
  // mappingModal but only needs City / State / Zip.
  const [zipFbMappingModal, setZipFbMappingModal] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  // Picker for "Save to Company": null = closed, '' = open & empty,
  // string = open & user is typing. saveStatus drives the button
  // label / disabled state while the analysis blob is being built and
  // uploaded to Firestore.
  const [savePickerSearch, setSavePickerSearch] = useState(null);
  const [saveStatus, setSaveStatus] = useState({ state: 'idle', message: '' });
  // Mirror of saveStatus for the reverse trip — pulling a company's
  // saved Master Analysis back onto the page. Shown inside the Company
  // Look Up panel, next to the Import button that drives it.
  const [importStatus, setImportStatus] = useState({ state: 'idle', message: '' });
  const [electricColOverride, setElectricColOverride] = useState(null);
  const [gasColOverride, setGasColOverride] = useState(null);
  const [siteNameOverride, setSiteNameOverride] = useState(null);
  const [zipColOverride, setZipColOverride] = useState(null);
  // Optional supplier / contract / actual-cost overrides — captured
  // from the column-mapping popup. Each one is the file header that
  // should fill the corresponding column on the Utility Lookup table,
  // or null when the user left it on Ignore.
  const [electricCostOverride, setElectricCostOverride] = useState(null);
  const [gasCostOverride, setGasCostOverride] = useState(null);
  const [electricSupplierOverride, setElectricSupplierOverride] = useState(null);
  const [gasSupplierOverride, setGasSupplierOverride] = useState(null);
  const [electricStartOverride, setElectricStartOverride] = useState(null);
  const [electricEndOverride, setElectricEndOverride] = useState(null);
  const [gasStartOverride, setGasStartOverride] = useState(null);
  const [gasEndOverride, setGasEndOverride] = useState(null);
  // Per-row UoM and country columns from the template. Filled when
  // present, otherwise the existing header-based unit detection and
  // zip-derived state continue to apply.
  const [electricUomOverride, setElectricUomOverride] = useState(null);
  const [gasUomOverride, setGasUomOverride] = useState(null);
  const [countryOverride, setCountryOverride] = useState(null);
  // Optional Address / City / State columns from the upload — purely
  // descriptive (don't drive any computation). Surface on the on-page
  // table and in the Indicative Savings Site Detail / Contract
  // Overview sheets when mapped.
  // Optional Company Name column from the upload — purely descriptive
  // (doesn't drive any computation). Surfaced on the on-page table and
  // used to name the Indicative Savings export file.
  const [companyNameOverride, setCompanyNameOverride] = useState(null);
  // A single company applied to every uploaded site that has no per-row
  // Company Name value. Set from "Save to Company", the site-list lookup,
  // or typed directly, and persisted so ALL Utility Lookup subtabs (the
  // on-page table, Corporate Compliance, the exports) treat the portfolio
  // as one company. Per-row Company Name column values still win over it.
  const portfolioCompanyName = String(settings?.utilityLookupCompanyName || '').trim();
  const setPortfolioCompanyName = useCallback((name) => {
    if (!updateSettingsPath) return;
    const v = String(name || '').trim();
    updateSettingsPath({ utilityLookupCompanyName: v || null });
  }, [updateSettingsPath]);
  // The prospect record the mapped portfolio company resolves to — the one
  // "Save to <company>" writes its Master Analysis against.
  const portfolioProspect = useMemo(() => {
    const target = portfolioCompanyName.toLowerCase();
    if (!target) return null;
    return (prospects || []).find(p => String(p?.company || '').trim().toLowerCase() === target) || null;
  }, [prospects, portfolioCompanyName]);

  // Whether that company ALREADY has a Master Analysis saved, and when.
  // Saving stamps a marker on the prospect record, which is the cheap read;
  // analyses saved before that marker existed only show up in the analyses
  // subcollection, so fall back to a metadata-only fetch (one document read
  // for the mapped company). Re-runs after a save, since the marker moves.
  const savedAnalysisMarker = portfolioProspect?.indicativeAnalysisMeta || null;
  const [fetchedAnalysisMeta, setFetchedAnalysisMeta] = useState(null);
  useEffect(() => {
    setFetchedAnalysisMeta(null);
    if (!portfolioProspect?.id) return;
    let cancelled = false;
    getIndicativeAnalysisMeta(portfolioProspect.id)
      .then(meta => { if (!cancelled) setFetchedAnalysisMeta(meta); })
      .catch(() => { /* absent or unreadable — the marker still stands */ });
    return () => { cancelled = true; };
  }, [portfolioProspect?.id, savedAnalysisMarker?.savedAt]);
  // Prefer whichever carries a date; the marker is written client-side at
  // save time, the fetched copy comes from the analysis doc's server stamp.
  const savedAnalysis = savedAnalysisMarker?.savedAt ? savedAnalysisMarker : (fetchedAnalysisMeta || savedAnalysisMarker);

  // Bumped by Remove Sites so the Company Look Up panel empties with the
  // rest of the page — the company it shows is local state down there.
  const [lookupResetSignal, setLookupResetSignal] = useState(0);
  const [addressOverride, setAddressOverride] = useState(null);
  const [cityOverride, setCityOverride] = useState(null);
  const [stateColumnOverride, setStateColumnOverride] = useState(null);
  // Optional Property Type + Size columns from the upload — drive the
  // per-property-type consumption / account-count estimates shown on
  // the Indicative Savings export's Property Type Estimates tab. Both
  // are optional; with only Property Type the export uses the
  // reference Size_ft2 for that type and skips per-site size scaling.
  const [propertyTypeOverride, setPropertyTypeOverride] = useState(null);
  // Hand-drawn mapping from a raw Property Type string in the upload to
  // one of our canonical types, for values normalizePropertyType can't
  // resolve on its own ("Distribution Center", "Class A Office", …).
  // Keyed by the lower-cased raw string so it applies to every row with
  // that value, and kept in localStorage so a curated mapping survives a
  // reload and carries across uploads — same treatment as the vendor
  // decisions above.
  const [propertyTypeMap, setPropertyTypeMap] = useState(() => {
    try {
      const raw = localStorage.getItem('utility-lookup:property-type-map');
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch { return {}; }
  });
  const persistPropertyTypeMap = useCallback((next) => {
    setPropertyTypeMap(next);
    try { localStorage.setItem('utility-lookup:property-type-map', JSON.stringify(next)); } catch {}
  }, []);
  // null = closed. Set to the pending list to open the mapping modal.
  const [propertyTypeModalOpen, setPropertyTypeModalOpen] = useState(false);
  // Set right after an import so the modal can auto-open once the rows
  // (and therefore the unmapped list) have recomputed.
  const [propertyTypeCheckPending, setPropertyTypeCheckPending] = useState(false);
  // Optional column mapping the user's own Commercial / Industrial
  // classification onto each site, overriding the property-type-derived
  // segment that drives commercial-vs-industrial rate selection.
  const [segmentOverride, setSegmentOverride] = useState(null);
  // Optional column carrying each building's Owned / Leased status.
  const [ownershipOverride, setOwnershipOverride] = useState(null);
  const [siteDescriptionOverride, setSiteDescriptionOverride] = useState(null);
  // Optional column naming the division / business unit the site sits
  // under — the level below Company Name. Passthrough, like the company.
  const [divisionOverride, setDivisionOverride] = useState(null);
  // Page-level Division scope — which division the whole page is looking
  // at. '' is every division. Distinct from divisionOverride above: that
  // says which uploaded column carries the division, this says which one
  // of its values the page is currently narrowed to. Deliberately not
  // persisted, like the compliance ownership scope: it is a lens on the
  // upload, not a property of it.
  const [divisionFilter, setDivisionFilter] = useState('');
  const [propertySizeOverride, setPropertySizeOverride] = useState(null);
  const [electricContractPriceOverride, setElectricContractPriceOverride] = useState(null);
  const [gasContractPriceOverride, setGasContractPriceOverride] = useState(null);
  const [electricContractNameOverride, setElectricContractNameOverride] = useState(null);
  const [electricProductTypeOverride, setElectricProductTypeOverride] = useState(null);
  const [gasContractNameOverride, setGasContractNameOverride] = useState(null);
  const [gasProductTypeOverride, setGasProductTypeOverride] = useState(null);
  // Per-vendor accept/reject decisions for the fuzzy supplier lookup.
  // Keyed by lowercased raw vendor string. Stored in localStorage so
  // a curated mapping survives a refresh and doesn't have to be
  // re-confirmed every time the page reloads. Map<vendorLower,
  //   'accepted' | 'rejected'>.
  const [vendorDecisions, setVendorDecisions] = useState(() => {
    try {
      const raw = localStorage.getItem('utility-lookup:vendor-decisions');
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch { return {}; }
  });
  const setVendorDecision = (rawVendor, decision) => {
    const key = String(rawVendor || '').trim().toLowerCase();
    if (!key) return;
    setVendorDecisions(prev => {
      const next = { ...prev };
      if (decision == null) delete next[key]; else next[key] = decision;
      try { localStorage.setItem('utility-lookup:vendor-decisions', JSON.stringify(next)); } catch {}
      return next;
    });
  };
  // Per-row, per-commodity supplier overrides — set when the user
  // types into a supplier cell and picks a value from the bundled
  // ENERGY_SUPPLIERS autocomplete (or types something free-form).
  // Keyed by `${rowId}_${commodity}` and persisted to localStorage so
  // an edit survives a refresh. When set, the override replaces the
  // multi-token render entirely; clearing it (× button or empty
  // commit) falls back to the source-data tokens.
  const [supplierOverrides, setSupplierOverrides] = useState(() => {
    try {
      const raw = localStorage.getItem('utility-lookup:supplier-overrides');
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch { return {}; }
  });
  const setSupplierOverride = (rowId, commodity, value) => {
    const key = `${rowId}_${commodity}`;
    setSupplierOverrides(prev => {
      const next = { ...prev };
      const v = String(value || '').trim();
      if (!v) delete next[key]; else next[key] = v;
      try { localStorage.setItem('utility-lookup:supplier-overrides', JSON.stringify(next)); } catch {}
      return next;
    });
  };
  // Which supplier cell is currently in edit mode. `${rowId}_${commodity}` or null.
  const [editingSupplier, setEditingSupplier] = useState(null);
  // ---- Mass edit (one column, many sites) ------------------------------
  // Off by default: the checkbox column and the toolbar are only earned
  // once the user says they're editing, and this page is dense enough
  // that a permanent extra column would cost every reader who isn't.
  const [massEditOn, setMassEditOn] = useState(false);
  // Selected rows, held as the row ids the table renders (the index into
  // cleanSitesData). Survives the mode toggle — ticking twenty sites and
  // then leaving the mode by accident shouldn't cost the selection — and
  // survives an apply, so a second column can be set on the same sites.
  const [selectedSiteIds, setSelectedSiteIds] = useState(() => new Set());
  const [massHeader, setMassHeader] = useState('');
  const [massValue, setMassValue] = useState('');
  const [massBusy, setMassBusy] = useState(false);
  // { type: 'success' | 'error', message } — the outcome of the last
  // apply, kept on screen because the edit itself is invisible on a
  // table scrolled away from the rows that changed.
  const [massStatus, setMassStatus] = useState(null);
  // Column-mapping confirmation popup for the Sites File upload —
  // null when no upload is mid-flight; otherwise carries the parsed
  // rows + headers + auto-detected mapping the user can adjust before
  // committing.
  const [sitesMappingModal, setSitesMappingModal] = useState(null);
  // { rows, headers, mapping: { zip, electric, gas, water } }
  const sitesFileRef = useRef(null);
  const utilityFileRef = useRef(null);
  const zipFallbackFileRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [sites, util, zipFb] = await Promise.all([
        loadListFromIDB(SITES_STORAGE_KEY),
        loadUtilityRates(),
        loadZipFallback(),
      ]);
      if (cancelled) return;
      const sitesArr = Array.isArray(sites) ? sites : [];
      setSitesData(sitesArr);
      setSitesLoaded(true);
      // Re-derive the column overrides from the persisted data on
      // mount. The import path drops everything the user marked
      // Ignore, so the saved columns are exactly the mapped ones —
      // detectSitesMapping picks them back up by header pattern and
      // the per-row supplier / cost / date logic flows again.
      if (sitesArr.length) {
        const persistedHeaders = Object.keys(sitesArr[0]);
        const m = detectSitesMapping(persistedHeaders);
        setSiteNameOverride(m.siteName || null);
        setCompanyNameOverride(m.companyName || null);
        setZipColOverride(m.zip || null);
        setElectricColOverride(m.electric || '__none__');
        setGasColOverride(m.gas || '__none__');
        setElectricCostOverride(m.electricCost || null);
        setGasCostOverride(m.gasCost || null);
        setElectricSupplierOverride(m.electricSupplier || null);
        setGasSupplierOverride(m.gasSupplier || null);
        setElectricStartOverride(m.electricStart || null);
        setElectricEndOverride(m.electricEnd || null);
        setGasStartOverride(m.gasStart || null);
        setGasEndOverride(m.gasEnd || null);
        setElectricUomOverride(m.electricUom || null);
        setGasUomOverride(m.gasUom || null);
        setCountryOverride(m.country || null);
        setAddressOverride(m.address || null);
        setCityOverride(m.city || null);
        setStateColumnOverride(m.state || null);
        setPropertyTypeOverride(m.propertyType || null);
        setSegmentOverride(m.segment || null);
        setOwnershipOverride(m.ownership || null);
        setSiteDescriptionOverride(m.siteDescription || null);
        setDivisionOverride(m.division || null);
        setPropertySizeOverride(m.propertySize || null);
        setElectricContractPriceOverride(m.electricContractPrice || null);
        setGasContractPriceOverride(m.gasContractPrice || null);
        setElectricContractNameOverride(m.electricContractName || null);
        setElectricProductTypeOverride(m.electricProductType || null);
        setGasContractNameOverride(m.gasContractName || null);
        setGasProductTypeOverride(m.gasProductType || null);
      }
      setUtility(util);
      setUtilityLoaded(true);
      setZipFallback(zipFb);
    })();
    return () => { cancelled = true; };
  }, []);

  // Document-level paste listener — React's onPaste only fires when
  // focus is inside the wrapper, but Cmd+V from a fresh page load
  // dispatches on document.body. Mirror BFOActivityView's pattern so
  // a user can drop into the page and immediately paste from Excel.
  useEffect(() => {
    function onPaste(e) {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
      // Skip if a modal already has the user's attention.
      if (sitesMappingModal || mappingModal) return;
      handlePagePaste(e);
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
    // handlePagePaste closes over setSitesMappingModal/setUploadError, both
    // stable from useState. Re-running on every render would just attach
    // and detach — leave deps empty for a single mount-time install.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sitesMappingModal, mappingModal]);

  // Column mapping for the "Site List" tab of one of our own exports.
  // The mapping the workbook was exported with (from its hidden state
  // sheet) is authoritative: it's exactly what the page was applying
  // when the workbook was built, and a field it left blank was
  // deliberately unmapped. Auto-detection only stands in when there's no
  // saved mapping — a workbook written before the state sheet carried
  // one — or for the two fields the lookup can't run without. Detecting
  // over the saved mapping instead would map the export's own snapshot
  // columns: the per-site rate columns read as gas consumption and
  // electric cost.
  function mappingForExportedSheet(headers, roundTripState) {
    const detected = detectSitesMapping(headers);
    const saved = (roundTripState?.mapping && typeof roundTripState.mapping === 'object')
      ? roundTripState.mapping
      : null;
    if (!saved) return detected;
    const headerSet = new Set(headers);
    const mapping = {};
    for (const [key, col] of Object.entries(saved)) {
      mapping[key] = (col && headerSet.has(col)) ? col : '';
    }
    if (!mapping.siteName) mapping.siteName = detected.siteName;
    if (!mapping.zip) mapping.zip = detected.zip;
    return mapping;
  }

  async function loadSitesFromFile(file) {
    if (!file) return;
    setUploadError('');
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      // Parse every sheet so the user can pick which one to map. When
      // the workbook matches the two-tab Utility Lookup template
      // (Electric Power + Gas), include the auto-merged result as an
      // extra "Merged" pseudo-tab and default to it — it's almost
      // always the one the user wants for that template.
      const sheets = parseAllSheets(bytes).map(s => ({
        sheetName: s.sheetName,
        rows: s.rows,
        headers: s.headers,
        mapping: detectSitesMapping(s.headers),
        isMerged: false,
      }));
      const merged = parseSplitSitesTemplate(bytes);
      if (merged) {
        sheets.unshift({
          sheetName: `Merged: ${merged.sheetName}`,
          rows: merged.rows,
          headers: merged.headers,
          mapping: detectSitesMapping(merged.headers),
          isMerged: true,
        });
      }
      if (sheets.length === 0) {
        // No sheet had data. Fall back to parseBestSheet so the
        // existing "Sheets scanned: ..." error message surfaces.
        const parsed = parseBestSheet(bytes, {
          preferSheetName: /site\s*list|^\s*sites?\s*$/i,
        });
        sheets.push({
          sheetName: parsed.sheetName,
          rows: parsed.rows,
          headers: parsed.headers,
          mapping: detectSitesMapping(parsed.headers),
          isMerged: false,
        });
      }
      // Workbook is an Indicative Savings export when it has the
      // distinctive Site Detail / Methodology tabs alongside Site
      // List — in that case force-pick Site List and skip the merged
      // Electric/Gas pseudo-tab default (those tabs aren't even
      // present in an export, but be explicit).
      const isExportRoundTrip = isIndicativeSavingsExport(bytes);
      // Prefer the merged tab (index 0 when present); otherwise prefer
      // a sheet whose name looks like a Site List; otherwise the first.
      let selectedIdx = 0;
      if (isExportRoundTrip) {
        const idx = sheets.findIndex(s => s.sheetName === 'Site List');
        if (idx >= 0) selectedIdx = idx;
      } else if (!sheets[0].isMerged) {
        const preferredIdx = sheets.findIndex(s => /site\s*list|^\s*sites?\s*$/i.test(s.sheetName));
        if (preferredIdx >= 0) selectedIdx = preferredIdx;
      }
      const roundTripState = isExportRoundTrip ? readRoundTripState(bytes) : null;
      // One of our own exports dropped back on the page: seed the Site
      // List tab from the mapping it was exported with rather than
      // re-detecting, so the modal opens on the same columns the export
      // was built from. The user can still change any of them.
      if (isExportRoundTrip && roundTripState?.mapping) {
        const idx = sheets.findIndex(s => s.sheetName === 'Site List');
        if (idx >= 0) {
          sheets[idx] = { ...sheets[idx], mapping: mappingForExportedSheet(sheets[idx].headers, roundTripState) };
        }
      }
      setSitesMappingModal({
        fileName: file.name,
        sheets,
        selectedIdx,
        roundTripState,
      });
    } catch (err) {
      setUploadError(err?.message || 'Failed to read the sites file');
    }
  }

  // The mapping the page is currently applying, in the shape the import
  // path consumes. `headers` scopes it to a column list: any override
  // pointing at a column that isn't in it is dropped. Shared by the
  // update-mapping modal and the Master Analysis round-trip sheet, so an
  // exported workbook carries the exact mapping it was built with.
  function currentSitesMapping(headers) {
    const noneToEmpty = (v) => (v === '__none__' || v == null) ? '' : v;
    const headerSet = new Set(headers || []);
    const safe = (v) => (v && headerSet.has(v)) ? v : '';
    return {
      siteName:              safe(noneToEmpty(siteNameOverride)),
      companyName:           safe(noneToEmpty(companyNameOverride)),
      address:               safe(noneToEmpty(addressOverride)),
      city:                  safe(noneToEmpty(cityOverride)),
      state:                 safe(noneToEmpty(stateColumnOverride)),
      zip:                   safe(noneToEmpty(zipColOverride)),
      country:               safe(noneToEmpty(countryOverride)),
      propertyType:          safe(noneToEmpty(propertyTypeOverride)),
      segment:               safe(noneToEmpty(segmentOverride)),
      ownership:             safe(noneToEmpty(ownershipOverride)),
      siteDescription:       safe(noneToEmpty(siteDescriptionOverride)),
      division:              safe(noneToEmpty(divisionOverride)),
      propertySize:          safe(noneToEmpty(propertySizeOverride)),
      electric:              safe(noneToEmpty(electricColOverride)),
      electricUom:           safe(noneToEmpty(electricUomOverride)),
      gas:                   safe(noneToEmpty(gasColOverride)),
      gasUom:                safe(noneToEmpty(gasUomOverride)),
      electricCost:          safe(noneToEmpty(electricCostOverride)),
      gasCost:               safe(noneToEmpty(gasCostOverride)),
      electricSupplier:      safe(noneToEmpty(electricSupplierOverride)),
      gasSupplier:           safe(noneToEmpty(gasSupplierOverride)),
      electricStart:         safe(noneToEmpty(electricStartOverride)),
      electricEnd:           safe(noneToEmpty(electricEndOverride)),
      electricContractPrice: safe(noneToEmpty(electricContractPriceOverride)),
      electricContractName:  safe(noneToEmpty(electricContractNameOverride)),
      electricProductType:   safe(noneToEmpty(electricProductTypeOverride)),
      gasStart:              safe(noneToEmpty(gasStartOverride)),
      gasEnd:                safe(noneToEmpty(gasEndOverride)),
      gasContractPrice:      safe(noneToEmpty(gasContractPriceOverride)),
      gasContractName:       safe(noneToEmpty(gasContractNameOverride)),
      gasProductType:        safe(noneToEmpty(gasProductTypeOverride)),
    };
  }

  // Re-open the column mapping modal against the data the user has
  // already imported. Lets the user re-target which column drives
  // each Utility Lookup field without re-uploading. Only columns that
  // survived the previous import are available (unmapped columns
  // were dropped on import) — to bring back a dropped column, the
  // user has to re-upload the original file.
  function openUpdateColumnMapping() {
    if (!sitesData.length) return;
    const headers = Object.keys(sitesData[0]);
    const mapping = currentSitesMapping(headers);
    setUploadError('');
    setSitesMappingModal({
      fileName: '(currently loaded sites)',
      mode: 'update',
      sheets: [{
        sheetName: 'Loaded sites',
        rows: sitesData,
        headers,
        mapping,
        isMerged: false,
      }],
      selectedIdx: 0,
      roundTripState: null,
    });
  }

  // Commit the popup's chosen mapping, persist the data + override
  // settings, and close the modal. If the user blanks out the site
  // name or zip column we fall back to auto-detection so the lookup
  // can still try to match.
  async function executeSitesImport() {
    if (!sitesMappingModal) return;
    const active = sitesMappingModal.sheets[sitesMappingModal.selectedIdx];
    if (!active) return;
    await commitSitesImport({
      rows: active.rows,
      mapping: active.mapping,
      isUpdate: sitesMappingModal.mode === 'update',
      roundTripState: sitesMappingModal.roundTripState,
    });
    setSitesMappingModal(null);
  }

  // The import itself, independent of the modal: keep only the mapped
  // columns, persist them, and point every per-field override at the
  // column that drives it. Called by the mapping modal's Import button
  // and by the "import a company's saved Master Analysis" flow, which
  // has a mapping already (from the workbook's round-trip sheet) and so
  // never opens the modal. Throws nothing — failures land in
  // uploadError, same as before, and come back as a `false` return so a
  // caller can report them in its own status line.
  async function commitSitesImport({ rows, mapping, isUpdate = false, roundTripState = null }) {
    setUploadError('');
    try {
      // Drop columns the user didn't assign a target — otherwise every
      // pass-through column ends up rendered on the Utility Lookup
      // table even though the user only wanted these specific fields.
      const TARGET_KEYS = [
        'siteName', 'companyName', 'division', 'address', 'city', 'state', 'zip', 'country',
        'propertyType', 'segment', 'ownership', 'siteDescription', 'propertySize',
        'electric', 'electricUom', 'gas', 'gasUom',
        'electricCost', 'gasCost',
        'electricSupplier', 'gasSupplier',
        'electricStart', 'electricEnd', 'electricContractPrice',
        'electricContractName', 'electricProductType',
        'gasStart', 'gasEnd', 'gasContractPrice',
        'gasContractName', 'gasProductType',
      ];
      const mappedHeaders = TARGET_KEYS.map(k => mapping[k]).filter(Boolean);
      const keep = new Set(mappedHeaders);
      const filteredRows = keep.size === 0
        ? rows
        : rows.map(r => {
            const out = {};
            for (const h of mappedHeaders) out[h] = r[h];
            return out;
          });
      await saveListToIDB(SITES_STORAGE_KEY, filteredRows);
      setSitesData(filteredRows);
      // Surface any property types we can't place, once the rows have
      // recomputed off the new upload.
      setPropertyTypeCheckPending(true);
      // Wipe per-row supplier overrides from the previous sites list.
      // They're keyed by row index (e.g. `5_gas` -> "NRG Energy"), so
      // they bleed straight onto row 5 of the new list when row counts
      // overlap. Vendor-name decisions stay — those are brand-keyed and
      // still meaningful across uploads. Skipped on the update-mapping
      // flow: row indexes are identical to what they were before, so
      // the existing per-row overrides still point at the right rows.
      if (!isUpdate) {
        setSupplierOverrides({});
        try { localStorage.removeItem('utility-lookup:supplier-overrides'); } catch {}
      }
      // The mass-edit selection is row positions, so it means nothing
      // once a different file occupies those positions — and a stale one
      // would aim the next column edit at whichever sites happen to sit
      // where the old ones did. Dropped on an update too: even a
      // re-mapped file can arrive with different rows.
      setSelectedSiteIds(new Set());
      setMassStatus(null);
      setSiteNameOverride(mapping.siteName || null);
      setCompanyNameOverride(mapping.companyName || null);
      setZipColOverride(mapping.zip || null);
      setElectricColOverride(mapping.electric || '__none__');
      setGasColOverride(mapping.gas || '__none__');
      setElectricCostOverride(mapping.electricCost || null);
      setGasCostOverride(mapping.gasCost || null);
      setElectricSupplierOverride(mapping.electricSupplier || null);
      setGasSupplierOverride(mapping.gasSupplier || null);
      setElectricStartOverride(mapping.electricStart || null);
      setElectricEndOverride(mapping.electricEnd || null);
      setGasStartOverride(mapping.gasStart || null);
      setGasEndOverride(mapping.gasEnd || null);
      setElectricUomOverride(mapping.electricUom || null);
      setGasUomOverride(mapping.gasUom || null);
      setCountryOverride(mapping.country || null);
      setAddressOverride(mapping.address || null);
      setCityOverride(mapping.city || null);
      setStateColumnOverride(mapping.state || null);
      setPropertyTypeOverride(mapping.propertyType || null);
      setSegmentOverride(mapping.segment || null);
      setOwnershipOverride(mapping.ownership || null);
      setSiteDescriptionOverride(mapping.siteDescription || null);
      setDivisionOverride(mapping.division || null);
      setPropertySizeOverride(mapping.propertySize || null);
      setElectricContractPriceOverride(mapping.electricContractPrice || null);
      setGasContractPriceOverride(mapping.gasContractPrice || null);
      setElectricContractNameOverride(mapping.electricContractName || null);
      setElectricProductTypeOverride(mapping.electricProductType || null);
      setGasContractNameOverride(mapping.gasContractName || null);
      setGasProductTypeOverride(mapping.gasProductType || null);
      // Restore round-trip state from an export's hidden sheet (vendor
      // accept/reject decisions, per-row supplier overrides). Replaces —
      // not merges — to match the supplierOverrides "fresh slate" model:
      // an export-then-import flow is a session restore, not a merge
      // of two different sessions. Skipped on update-mapping — the
      // user's existing vendor decisions stay put.
      if (!isUpdate) {
        const rt = roundTripState;
        if (rt && rt.vendorDecisions && typeof rt.vendorDecisions === 'object') {
          setVendorDecisions(rt.vendorDecisions);
          try { localStorage.setItem('utility-lookup:vendor-decisions', JSON.stringify(rt.vendorDecisions)); } catch {}
        }
        // Per-row supplier edits are keyed by row index, and the export
        // wrote its rows in the page's own row order, so the indexes
        // still line up on the way back in. Restored after the wipe
        // above so the cells show the same manual picks they had.
        if (rt && rt.supplierOverrides && typeof rt.supplierOverrides === 'object') {
          setSupplierOverrides(rt.supplierOverrides);
          try { localStorage.setItem('utility-lookup:supplier-overrides', JSON.stringify(rt.supplierOverrides)); } catch { /* noop */ }
        }
        // The company's researched facts, so an imported analysis restores
        // the Corporate Compliance cards along with the site list.
        if (rt && rt.companyResearch && typeof rt.companyResearch === 'object') {
          restoreCompanyResearch(rt.companyResearch);
        }
      }
      return true;
    } catch (err) {
      setUploadError(err?.message || 'Failed to save the sites file');
      return false;
    }
  }

  async function handleSitesUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    await loadSitesFromFile(file);
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) loadSitesFromFile(file);
  }

  // Allow pasting raw tab-separated rows directly from Excel onto the
  // page. First line is the header; subsequent lines become data
  // rows. Routes through the same column-mapping modal as a file
  // drop, so the user gets the side-by-side mapping UI for either
  // entry point. Skips when focus is in a text input / textarea so
  // we don't steal paste from an editable field.
  function handlePagePaste(e) {
    const tag = (e.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
    const text = e.clipboardData?.getData('text/plain') || '';
    if (!text || !text.includes('\t')) return;
    const lines = text.replace(/\r\n?/g, '\n').split('\n').filter(l => l.length > 0);
    if (lines.length < 2) return;
    e.preventDefault();
    const split = (line) => line.split('\t');
    const rawHeaders = split(lines[0]).map(h => h.trim());
    const seen = new Map();
    const headers = rawHeaders.map((h, i) => {
      const base = h || `Column ${i + 1}`;
      const c = seen.get(base) || 0;
      seen.set(base, c + 1);
      return c === 0 ? base : `${base} (${c + 1})`;
    });
    const rows = lines.slice(1).map(line => {
      const cells = split(line);
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (cells[i] ?? '').trim(); });
      return obj;
    });
    setUploadError('');
    setSitesMappingModal({
      fileName: `(pasted ${rows.length.toLocaleString()} row${rows.length === 1 ? '' : 's'})`,
      sheets: [{
        sheetName: 'Pasted rows',
        rows,
        headers,
        mapping: detectSitesMapping(headers),
        isMerged: false,
      }],
      selectedIdx: 0,
      roundTripState: null,
    });
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!dragOver) setDragOver(true);
  }
  function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    // Ignore drag leave events that bounce between child elements.
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDragOver(false);
  }

  async function handleRemoveSites() {
    // The portfolio company is persisted in settings, so it outlives the
    // sites it was mapped to — leaving it set would keep labelling the
    // Save button ("Save to Acme Corp") and Corporate Compliance's
    // Portfolio company field for a portfolio that no longer exists.
    // Clear it with the sites, and say so in the prompt. The per-column
    // mappings are transient state re-derived on the next upload, so
    // they need no cleanup here.
    const mapped = portfolioCompanyName;
    const prompt = mapped
      ? `Remove the uploaded sites list and clear the mapped company (${mapped})?`
      : 'Remove the uploaded sites list?';
    if (!window.confirm(prompt)) return;
    await clearListFromIDB(SITES_STORAGE_KEY);
    setSitesData([]);
    if (mapped) setPortfolioCompanyName('');
    setLookupResetSignal(n => n + 1);
  }

  async function handleUtilityFileSelect(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadError('');
    setUtilityBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const { rows, headers, sheetName } = parseBestSheet(new Uint8Array(buf));
      const mapping = {
        zip: detectColumn(headers, [/zip.?postal/i, /^zip\s*code$/i, /^postal\s*code$/i, /^zip$/i, /zip/i, /postal/i]),
        commodityType: detectColumn(headers, [/commodity\s*type/i, /commodity/i, /service\s*type/i, /^type$/i]),
        utility: detectColumn(headers, [/^utility$/i, /utility\s*(name|company|provider)/i, /provider/i, /utility/i]),
        city: detectColumn(headers, [/^city$/i, /city/i, /municipality/i]),
        state: detectColumn(headers, [/^state$/i, /\bstate\b/i, /province/i, /region/i]),
        country: detectColumn(headers, [/^country$/i, /country/i, /nation/i]),
        uniqueLookup: detectColumn(headers, [/unique\s*lookup/i, /lookup\s*key/i, /unique\s*id/i]),
      };
      setMappingModal({ rows, headers, mapping, fileName: file.name, sheetName });
    } catch (err) {
      setUploadError(err?.message || 'Failed to read the utility file');
    } finally {
      setUtilityBusy(false);
    }
  }

  async function executeUtilityImport() {
    if (!mappingModal) return;
    const { rows, mapping, fileName } = mappingModal;
    if (!mapping.zip) { setUploadError('Zip / Postal Code column is required'); return; }
    if (!mapping.commodityType) { setUploadError('Commodity Type column is required'); return; }
    if (!mapping.utility) { setUploadError('Utility column is required'); return; }
    setUtilityBusy(true);
    try {
      // The file has one row per (zip, commodity) combination. Group by
      // normalized zip and assign the utility provider to the matching
      // commodity slot. Later rows overwrite earlier ones for the same
      // (zip, commodity) pair — matches the "first match wins" UX in
      // other imports.
      const zipMap = {};
      // Zips whose rows named more than one country — reported after the
      // import so a rates file mixing US and Mexican records says so rather
      // than quietly deciding per zip.
      const conflictingZips = new Set();
      let valid = 0;
      let unrecognizedCommodity = 0;
      for (const r of rows) {
        const zip = normalizeZip(r[mapping.zip]);
        if (!zip) continue;
        const rawCommodity = String(r[mapping.commodityType] ?? '').trim().toLowerCase();
        let commodityKey = null;
        if (/electric|elec|power|kwh/.test(rawCommodity)) commodityKey = 'electric';
        else if (/gas|therm|methane/.test(rawCommodity)) commodityKey = 'gas';
        else if (/water|sewer|h2o/.test(rawCommodity)) commodityKey = 'water';
        if (!commodityKey) { unrecognizedCommodity++; continue; }
        const utilityName = String(r[mapping.utility] ?? '').trim();
        if (!utilityName) continue;
        const entry = zipMap[zip] || {};
        entry[commodityKey] = utilityName;
        if (mapping.city && !entry.city) {
          const city = String(r[mapping.city] ?? '').trim();
          if (city) entry.city = city;
        }
        if (mapping.state && !entry.state) {
          const rawState = String(r[mapping.state] ?? '').trim();
          const code = normalizeState(rawState);
          if (code) entry.state = code;
        }
        // One entry per zip, but a five-digit key isn't unique across
        // countries: US ZIPs and Mexican códigos postales overlap heavily
        // (45050 is Monroe, Ohio and also Zapopan, Jalisco). Merging a US
        // row and a Mexican row into one entry produced a record claiming
        // both — an Ohio state and a country of Mexico — and every site on
        // that zip inherited whichever country happened to be written
        // first. Rows that disagree leave the entry with no country at all,
        // so a site falls back to its own State / zip evidence instead of a
        // coin flip.
        if (mapping.country) {
          const country = String(r[mapping.country] ?? '').trim();
          if (country && !entry.countryConflict) {
            if (!entry.country) entry.country = country;
            else if (entry.country.toLowerCase() !== country.toLowerCase()) {
              entry.countryConflict = true;
              delete entry.country;
              conflictingZips.add(zip);
            }
          }
        }
        zipMap[zip] = entry;
        valid++;
      }
      const uniqueZips = Object.keys(zipMap).length;
      const meta = {
        fileName,
        rowCount: rows.length,
        zipCount: uniqueZips,
        validRows: valid,
        unrecognizedCommodity,
        // How many zips carried rows from more than one country. Kept on the
        // import metadata so the panel can say the file mixes countries on
        // some keys, rather than the ambiguity only showing up later as a
        // site labelled with the wrong one.
        conflictingCountryZips: conflictingZips.size,
        columns: mapping,
        importedAt: Date.now(),
      };
      await saveUtilityRates(zipMap, meta);
      setUtility({ zipMap, meta });
      setMappingModal(null);
    } catch (err) {
      setUploadError(err?.message || 'Failed to save utility lookup');
    } finally {
      setUtilityBusy(false);
    }
  }

  async function handleClearUtility() {
    if (!window.confirm('Remove the uploaded utility lookup?')) return;
    await clearUtilityRates();
    setUtility(null);
  }

  // Upload the city + state → zip fallback table. The file needs City,
  // State, and Zip columns. We auto-detect them as a starting point but
  // open a column-mapping modal so the user can confirm or correct the
  // picks before importing — the actual build runs in
  // executeZipFallbackImport once they confirm.
  async function handleZipFallbackFileSelect(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadError('');
    setZipFallbackBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const { rows, headers, sheetName } = parseBestSheet(new Uint8Array(buf));
      if (!rows.length) {
        setUploadError('No data rows found in the fallback zip file.');
        return;
      }
      const mapping = {
        city: detectColumn(headers, [/^city$/i, /city/i, /municipality/i, /town/i]) || '',
        state: detectColumn(headers, [/^state$/i, /\bstate\b/i, /province/i, /region/i]) || '',
        zip: detectColumn(headers, [/zip.?postal/i, /^zip\s*code$/i, /^postal\s*code$/i, /^zip$/i, /zip/i, /postal/i]) || '',
      };
      setZipFbMappingModal({ rows, headers, mapping, fileName: file.name, sheetName });
    } catch (err) {
      setUploadError(err?.message || 'Failed to read the fallback zip file');
    } finally {
      setZipFallbackBusy(false);
    }
  }

  // Finalize the Fallback Zips import from the mapping modal's column
  // choices: build one { city, state, zip } record per usable row,
  // de-duped on (state, city), then persist.
  async function executeZipFallbackImport() {
    if (!zipFbMappingModal) return;
    const { rows, mapping, fileName } = zipFbMappingModal;
    const cityCol = mapping.city;
    const stateCol = mapping.state;
    const zipCol = mapping.zip;
    if (!cityCol || !stateCol || !zipCol) {
      const missing = [!cityCol && 'City', !stateCol && 'State', !zipCol && 'Zip'].filter(Boolean).join(', ');
      setUploadError(`Map all three columns first: still need: ${missing}.`);
      return;
    }
    setUploadError('');
    setZipFallbackBusy(true);
    try {
      const list = [];
      const seen = new Set();
      for (const r of rows) {
        const city = String(r[cityCol] ?? '').trim();
        const state = String(r[stateCol] ?? '').trim();
        const zip = normalizeZip(r[zipCol]);
        if (!city || !state || !zip) continue;
        // De-dupe on (state, city) keeping the first zip seen so a tidy
        // count is shown and the index build is deterministic.
        const key = `${state.toLowerCase()}|${city.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        list.push({ city, state, zip });
      }
      if (!list.length) {
        setUploadError('No usable City / State / Zip rows found in the fallback file.');
        return;
      }
      const meta = {
        fileName,
        rowCount: rows.length,
        entryCount: list.length,
        columns: { city: cityCol, state: stateCol, zip: zipCol },
        importedAt: Date.now(),
      };
      await saveZipFallback(list, meta);
      setZipFallback({ list, meta });
      setZipFbMappingModal(null);
    } catch (err) {
      setUploadError(err?.message || 'Failed to save the fallback zip list');
    } finally {
      setZipFallbackBusy(false);
    }
  }

  async function handleClearZipFallback() {
    if (!window.confirm('Remove the uploaded fallback zip list?')) return;
    await clearZipFallback();
    setZipFallback(null);
  }

  const zipColumn = useMemo(() => {
    if (!sitesData.length) return '';
    const headers = Object.keys(sitesData[0]);
    if (zipColOverride && headers.includes(zipColOverride)) return zipColOverride;
    return pickZipColumn(headers);
  }, [sitesData, zipColOverride]);

  // Detect the column that holds the site name so we can drop blank
  // rows. Falls back to the sticky first column if no obvious
  // name/site/location header shows up.
  const siteNameColumn = useMemo(() => {
    if (!sitesData.length) return '';
    const headers = Object.keys(sitesData[0]);
    if (siteNameOverride && headers.includes(siteNameOverride)) return siteNameOverride;
    return pickSiteNameColumn(headers) || '';
  }, [sitesData, siteNameOverride]);

  // Rows that don't carry a site name are junk for this analysis —
  // filter them out before anything else sees them.
  const cleanSitesData = useMemo(() => {
    if (!siteNameColumn) return sitesData;
    return sitesData.filter(r => String(r[siteNameColumn] ?? '').trim() !== '');
  }, [sitesData, siteNameColumn]);

  // Detect every plausible annual consumption column. When a site has
  // multiple candidates we pick the smallest non-null value per row —
  // the user asked for the conservative estimate, and conservative
  // means lower consumption → lower cost.
  const detectedConsumption = useMemo(() => {
    if (!cleanSitesData.length) return { electric: [], gas: [] };
    const headers = Object.keys(cleanSitesData[0]);
    // A plausibility filter: commercial consumption is never a handful
    // of units. If the column's max converted value sits at or below
    // this threshold across every row, it's a flag / indicator column
    // (e.g. "Gas" = 1/0) rather than real consumption. Drop it so the
    // conservative-min picker doesn't grab a 1 and wipe out the
    // actual consumption figure.
    const PLAUSIBLE_MIN = 10;
    const mk = (commodity) => {
      const toUnit = commodity === 'electric' ? toKwh : toTherms;
      return detectConsumptionColumns(headers, commodity)
        .map(header => ({ header, unit: detectConsumptionUnit(header, commodity) }))
        .filter(({ header, unit }) => {
          let max = 0;
          for (const r of cleanSitesData) {
            const v = toUnit(r[header], unit);
            if (typeof v === 'number' && Number.isFinite(v) && v > max) max = v;
          }
          return max > PLAUSIBLE_MIN;
        });
    };
    return { electric: mk('electric'), gas: mk('gas') };
  }, [cleanSitesData]);
  // Active consumption columns = detection result, unless the user
  // picked explicit overrides on the header bar.
  const consumption = useMemo(() => {
    function resolve(commodity, override) {
      if (!override) return detectedConsumption[commodity];
      if (override === '__none__') return [];
      return [{ header: override, unit: detectConsumptionUnit(override, commodity) }];
    }
    return {
      electric: resolve('electric', electricColOverride),
      gas: resolve('gas', gasColOverride),
    };
  }, [detectedConsumption, electricColOverride, gasColOverride]);

  // The uploaded file's "… Contract Price UoM" columns, if it carries them.
  //
  // Detected off the headers rather than mapped on the header bar like every
  // other column, because nothing on the page CONSUMES these: a contract
  // price is carried exactly as the file wrote it, in whatever unit that
  // was. They're read only so the page can tell you when that unit isn't the
  // one every downstream label assumes ($/kWh, $/therm) — a warning it can
  // raise best-effort or not at all, which isn't worth a mapping row.
  const contractPriceUomColumns = useMemo(() => {
    const headers = cleanSitesData.length ? Object.keys(cleanSitesData[0]) : [];
    return {
      electric: detectColumn(headers, [
        /electric.*contract.*price.*\b(uom|unit)/i,
        /\b(uom|unit)\b.*electric.*contract.*price/i,
        /(power|electricity).*price.*\b(uom|unit)/i,
      ]),
      gas: detectColumn(headers, [
        /gas.*contract.*price.*\b(uom|unit)/i,
        /\b(uom|unit)\b.*gas.*contract.*price/i,
      ]),
    };
  }, [cleanSitesData]);

  const siteHeaders = useMemo(() => sitesData.length ? Object.keys(sitesData[0]) : [], [sitesData]);

  // Compact { siteName, city, state } list fed to the Building Compliance
  // Screening subtab so it can screen every uploaded site. City/State come
  // from the resolved (detected or overridden) columns of the site list.
  // complianceSites is built from the fully-processed `rows` (defined below)
  // so it carries square footage, property type, and the electric/gas utility
  // the Building Compliance Screening subtab needs — see just after the `rows`
  // memo.

  // Pick the FIRST candidate column (in document order) that has a
  // valid value for this row. Earlier we took the per-row minimum,
  // but that lets a stray "1" in a later column beat the real
  // estimate in column one. The user prefers their primary estimate
  // column (typically labelled "Est. Natural Gas" / "Est. Electric")
  // as the canonical value, falling through to later candidates only
  // when the primary is blank.
  const pickFirstConsumption = (row, candidates, toUnit, rowUnitOverride) => {
    for (const { header, unit } of candidates) {
      const raw = row[header];
      // Per-row UoM (from the template's Electric UoM / Gas UoM
      // column) wins over the column-header-detected unit when the
      // user filled it in — that's the whole point of the column.
      const effectiveUnit = rowUnitOverride || unit;
      const converted = toUnit(raw, effectiveUnit);
      if (converted == null || !Number.isFinite(converted) || converted <= 0) continue;
      return { value: converted, sourceHeader: header };
    }
    return { value: null, sourceHeader: null };
  };

  // Distinct list of every utility name we know about (collected from
  // the uploaded utility-rates lookup). Vendors from the sites file
  // get fuzzy-matched against this list — anything that hits a known
  // utility goes in the Utility column (with the canonical name);
  // anything that doesn't lands in the Supplier column.
  const knownUtilityNames = useMemo(() => {
    const arr = [];
    const seen = new Set();
    if (!utility?.zipMap) return arr;
    for (const entry of Object.values(utility.zipMap)) {
      for (const k of ['electric', 'gas', 'water']) {
        const name = entry?.[k];
        if (name && !seen.has(name)) { seen.add(name); arr.push(name); }
      }
    }
    return arr;
  }, [utility]);
  // Returns { canonical, score } when the vendor matches a known
  // utility above threshold, else null. The matcher is reusable —
  // see src/utils/utilityNameMatch.js.
  function matchVendorToUtility(vendor) {
    if (!vendor) return null;
    const hit = findFuzzyMatch(vendor, knownUtilityNames);
    return hit ? { canonical: hit.name, score: hit.score } : null;
  }
  // Same fuzzy scorer, but against the bundled top-suppliers list
  // (src/data/energySuppliers.js). When a vendor matches a known
  // supplier we keep the canonical brand name so cosmetic variants
  // ("Reliant", "Reliant Energy LLC", "REL energy") all collapse to
  // "Reliant Energy" in the Supplier column.
  function matchVendorToSupplier(vendor) {
    if (!vendor) return null;
    const hit = findFuzzyMatch(vendor, ENERGY_SUPPLIERS);
    return hit ? { canonical: hit.name, score: hit.score } : null;
  }

  // Reverse index (city + state → zips) built from the loaded utility
  // lookup so a site that arrives without a zip — but with a city and
  // state — can borrow a representative zip from the other locations we
  // already know live in that same city. Rebuilt only when the utility
  // file changes. See src/utils/zipEstimate.js.
  const cityStateZipIndex = useMemo(
    () => buildCityStateZipIndex(utility?.zipMap),
    [utility]
  );

  // Explicit city + state → zip map from the user-uploaded fallback list.
  // Consulted ahead of cityStateZipIndex when a site has no zip of its
  // own, so the user's authoritative mapping wins over an inferred zip.
  const zipFallbackIndex = useMemo(
    () => buildCityStateZipFallback(zipFallback?.list),
    [zipFallback]
  );

  // Every site in the file, derived. `rows` below is this narrowed to the
  // active division — the two differ only by that scope, since a property
  // type mapped to N/A now withholds the usage estimate rather than
  // removing the site.
  const allRows = useMemo(() => {
    return cleanSitesData.map((r, i) => {
      const cityColInput = cityOverride ? String(r[cityOverride] || '').trim() : '';
      const stateColInput = stateColumnOverride ? String(r[stateColumnOverride] || '').trim() : '';
      const uploadedZip = zipColumn ? normalizeZip(r[zipColumn]) : '';
      // When the row has no zip of its own, estimate one from its city +
      // state using zips already present in the utility lookup. The
      // estimate then feeds the zip → utility / state / rate match below
      // exactly like an uploaded zip would, flagged via __zipEstimated__
      // so the UI can render it as modeled rather than measured.
      const zipEstimate = (!uploadedZip && (cityStateZipIndex || zipFallbackIndex))
        ? estimateZipFromCityState(cityStateZipIndex, cityColInput, stateColInput, zipFallbackIndex)
        : null;
      const zip = uploadedZip || zipEstimate?.zip || '';
      const zipEstimated = !uploadedZip && !!zipEstimate;
      const match = utility?.zipMap && zip ? utility.zipMap[zip] : null;
      const inputCountry = countryOverride ? String(r[countryOverride] || '').trim() : '';
      // Whether a US / Canadian state code may be derived for this site
      // at all. Read from the uploaded Country alone — never from the zip
      // match's country, which on a foreign site is the collision this
      // gate exists to stop.
      const stateInScope = isStateCodeCountry(inputCountry);
      // State resolution for indicative rates + the deregulation map.
      // Prefer the utility file's zip match, then the zip prefix, then
      // a mapped State column — but only when that column normalizes to
      // a real US state code, so international provinces ("Milan",
      // "SP") don't false-map and still fall through to country rates.
      //
      // Out of scope, nothing is derived: a site in Spain or Argentina has
      // no state, and inventing one from a colliding postal code priced it
      // at an Ohio rate and screened it against Ohio's ordinances.
      const state = stateInScope
        ? (match?.state || zipToState(zip) || normalizeState(stateColInput))
        : null;
      // The country this site resolves to, for every consumer below.
      //
      // A resolved US state settles it: every source `state` can come from
      // is US-only (the match's own state is normalized against the US
      // table, as are the zip prefix and the State column), so a row that
      // has one is in the US and the zip match's country can't be trusted
      // to say otherwise. Five-digit keys aren't unique across countries —
      // 45050 is Monroe, Ohio and also Zapopan, Jalisco — so a rates file
      // carrying Mexican rows was relabelling Ohio sites as Mexican
      // wherever the upload had no Country column of its own. The uploaded
      // Country column still wins over both.
      const resolvedCountry = inputCountry || (state ? 'United States' : (match?.country || ''));
      // Property type + customer segment resolve first: the segment
      // (commercial vs industrial) picks which state-rate column
      // applies. An explicit Segment column wins; otherwise infer it
      // from the property type; absent both, default to commercial.
      const inputPropertyType = propertyTypeOverride ? String(r[propertyTypeOverride] || '').trim() : '';
      // A hand-drawn mapping wins over the automatic resolver: the user
      // set it precisely because the resolver got this value wrong (or
      // couldn't place it at all).
      const mappingTarget = inputPropertyType
        ? propertyTypeMap[inputPropertyType.toLowerCase()] || null
        : null;
      // Mapped to N/A: this value isn't a building we analyse, so the row is
      // flagged here and filtered out of `rows` below rather than resolving to
      // a canonical type.
      const excludedType = mappingTarget === PROPERTY_TYPE_EXCLUDED;
      const mappedPropertyType = excludedType ? null : mappingTarget;
      const canonicalPropertyType = mappedPropertyType
        || (inputPropertyType && !excludedType ? normalizePropertyType(inputPropertyType) : null);
      const segmentFromColumn = segmentOverride ? normalizeSegment(r[segmentOverride]) : null;
      const segment = segmentFromColumn || propertyTypeSegment(canonicalPropertyType) || 'commercial';
      const segmentSource = segmentFromColumn ? 'column' : (propertyTypeSegment(canonicalPropertyType) ? 'propertyType' : 'default');
      const stateElectricRate = state ? stateRate(state, 'electric', segment) : null;
      const stateGasRate = state ? stateRate(state, 'gas', segment) : null;
      const electricUomRaw = electricUomOverride ? r[electricUomOverride] : '';
      const gasUomRaw = gasUomOverride ? r[gasUomOverride] : '';
      const elec = pickFirstConsumption(r, consumption.electric, toKwh, normalizeElectricUom(electricUomRaw));
      const gas = pickFirstConsumption(r, consumption.gas, toTherms, normalizeGasUom(gasUomRaw));
      // Gate the utility-provider lookup to the four supported countries
      // (US / Puerto Rico / Canada / Mexico). Out-of-scope sites skip the
      // zip → utility match and the vendor-name → known-utility match so
      // a colliding US zip or a coincidental name match can't fabricate a
      // provider. Rates, consumption, suppliers, etc. are unaffected.
      const lookupAllowed = isUtilityLookupCountry(inputCountry);
      // Country-rate fallback. When the state rate didn't resolve
      // (non-US sites, or US sites whose state code we couldn't
      // derive), look up an indicative commercial rate from the
      // country reference table and substitute it. Electric drops in
      // as $/kWh directly; gas converts from $/kWh-equiv to $/therm
      // via the 29.3001 kWh/therm energy-content factor so the cost
      // helpers downstream stay shape-compatible.
      const resolvedCountryForRate = resolvedCountry || null;
      const countryElectricRateVal = stateElectricRate == null
        ? countryElectricRate(resolvedCountryForRate)
        : null;
      const countryGasRateVal = stateGasRate == null
        ? countryGasRatePerTherm(resolvedCountryForRate)
        : null;
      const electricRate = stateElectricRate ?? countryElectricRateVal ?? null;
      const gasRate = stateGasRate ?? countryGasRateVal ?? null;
      const electricRateSource = stateElectricRate != null
        ? 'state'
        : (countryElectricRateVal != null ? 'country' : null);
      const gasRateSource = stateGasRate != null
        ? 'state'
        : (countryGasRateVal != null ? 'country' : null);
      const resolvedCountryRateName = (electricRateSource === 'country' || gasRateSource === 'country')
        ? normalizeCountryRateName(resolvedCountryForRate)
        : null;
      const inputCompanyName = companyNameOverride ? String(r[companyNameOverride] || '').trim() : '';
      const inputSiteDescription = siteDescriptionOverride ? String(r[siteDescriptionOverride] || '').trim() : '';
      const inputDivision = divisionOverride ? String(r[divisionOverride] || '').trim() : '';
      const inputOwnership = ownershipOverride ? String(r[ownershipOverride] || '').trim() : '';
      const canonicalOwnership = normalizeOwnership(inputOwnership);
      // Loose numeric parse for the optional Size_ft2 column — strips
      // commas, "sf"/"sqft" suffixes, etc.
      //
      // A zero is kept as zero, not folded into "no value". The two mean
      // different things downstream: the compliance screening takes a missing
      // size as meeting an ordinance's ft² threshold (a gap in the upload
      // isn't evidence of a small building), so a 0 that arrived as a blank
      // was screened as if it qualified. A 0 in the file is a measurement,
      // and it is below every threshold.
      //
      // Text that carries no digits at all ("N/A", "TBD", "—") still reads as
      // no value — stripping it would leave "", and Number("") is 0, which
      // would turn every one of those into a zero-size building.
      const parseSize = (v) => {
        if (v == null || v === '') return null;
        const cleaned = String(v).replace(/[^0-9.]/g, '');
        if (!/\d/.test(cleaned)) return null;
        const n = Number(cleaned);
        return Number.isFinite(n) && n >= 0 ? n : null;
      };
      const inputPropertySize = propertySizeOverride ? parseSize(r[propertySizeOverride]) : null;
      // Property-type-driven consumption fallback. When the source
      // sheet didn't carry actual electric / gas consumption for this
      // site but the property type is recognized, the reference table
      // gives us a representative annual usage to plug in (scaled by
      // Size_ft2 if the user mapped one). The estimate flows through
      // the same downstream columns as real data — cost, indicative
      // savings, monthly breakdown — flagged via __kwhFromEstimate__ /
      // __thermsFromEstimate__ so the UI can render an italic / muted
      // hint that the number is modeled rather than measured.
      const propertyTypeEstimate = canonicalPropertyType
        ? estimateConsumption(canonicalPropertyType, inputPropertySize)
        : null;
      const elecValueFinal = elec.value ?? propertyTypeEstimate?.electricKwh ?? null;
      const elecValueFromEstimate = elec.value == null && elecValueFinal != null;
      // gasDth → therms is ×10 (1 Dth = 10 therms). The on-screen
      // gas-usage cell is denominated in therms, matching what
      // toTherms normalizes to for actual data.
      const gasValueFinal = gas.value ?? (propertyTypeEstimate ? propertyTypeEstimate.gasDth * 10 : null);
      const gasValueFromEstimate = gas.value == null && gasValueFinal != null;
      const parseRate = (v) => {
        if (v == null || v === '') return null;
        const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
        return Number.isFinite(n) && n > 0 ? n : null;
      };
      const electricContractPrice = electricContractPriceOverride ? parseRate(r[electricContractPriceOverride]) : null;
      const gasContractPrice = gasContractPriceOverride ? parseRate(r[gasContractPriceOverride]) : null;
      // What unit the file says each contract price is quoted in. Nothing
      // converts it — the number is carried as written and every downstream
      // label reads it as $/kWh or $/therm — so this is here to say when
      // that assumption is wrong rather than to act on it. A price quoted
      // per Dth and read per therm is ten times high, and until now nothing
      // said so. Resolved only where there IS a price: a unit with no
      // figure against it is nothing to warn about.
      const electricPriceUom = electricContractPrice == null ? null : resolveContractPriceUom('electric', {
        cellValue: contractPriceUomColumns.electric ? r[contractPriceUomColumns.electric] : '',
        header: electricContractPriceOverride,
      });
      const gasPriceUom = gasContractPrice == null ? null : resolveContractPriceUom('gas', {
        cellValue: contractPriceUomColumns.gas ? r[contractPriceUomColumns.gas] : '',
        header: gasContractPriceOverride,
      });
      const estElectricCost = electricRate != null && elecValueFinal != null ? electricRate * elecValueFinal : null;
      const estGasCost = gasRate != null && gasValueFinal != null ? gasRate * gasValueFinal : null;
      // Actual cost columns from the file when the user mapped them.
      // Strings like "$1,234.56" parse cleanly; null when blank or
      // unparseable so the per-row total can fall back to the rate
      // estimate.
      const parseDollar = (v) => {
        if (v == null || v === '') return null;
        const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
        return Number.isFinite(n) && n !== 0 ? n : null;
      };
      const actualElectricCost = electricCostOverride ? parseDollar(r[electricCostOverride]) : null;
      const actualGasCost = gasCostOverride ? parseDollar(r[gasCostOverride]) : null;
      const electricCost = actualElectricCost ?? estElectricCost;
      const gasCost = actualGasCost ?? estGasCost;
      const totalCost = (electricCost ?? 0) + (gasCost ?? 0);
      // Vendor column from the sites file. Resolution order:
      //   1. Fuzzy-match against the bundled top-suppliers list →
      //      Supplier column with the canonical brand name.
      //   2. Else fuzzy-match against the loaded utility-rates list →
      //      Utility column with the canonical utility name.
      //   3. Else the raw vendor string falls through to the Supplier
      //      column unchanged.
      // Supplier list wins ties so a brand that exists on both rosters
      // (e.g. Constellation NewEnergy) lands as a supplier, which is
      // what shows up on the customer's bill.
      // Treat em-dash, hyphen, "N/A", "TBD", "?" etc. as empty so a
      // source row whose supplier column is just `—` doesn't render a
      // pill in the Supplier column. Same rule the export uses.
      const isSupplierPlaceholder = (s) => {
        const t = String(s || '').trim();
        if (!t) return true;
        if (/^[-\u2013\u2014_]+$/.test(t)) return true;
        if (/^(n\/a|na|none|null|tbd|unknown|\?|\.)$/i.test(t)) return true;
        return false;
      };
      const rawElectric = electricSupplierOverride ? String(r[electricSupplierOverride] || '').trim() : '';
      const rawGas = gasSupplierOverride ? String(r[gasSupplierOverride] || '').trim() : '';
      // A source supplier cell can list more than one entity separated
      // by commas / semicolons (e.g. "City of Santa Clara, CA, Pacific
      // Gas & Electric" or "Constellation, Direct Energy"). Split into
      // tokens and classify each independently so each gets its own
      // pill + accept/reject decision instead of fuzzy-matching the
      // whole concatenated string. State abbreviations like "CA" that
      // sit between names are dropped.
      const splitVendorTokens = (s) => {
        if (!s || isSupplierPlaceholder(s)) return [];
        const parts = String(s).split(/[,;]/).map(t => t.trim()).filter(Boolean);
        const seen = new Set();
        const out = [];
        for (const t of parts) {
          if (isSupplierPlaceholder(t)) continue;
          if (/^[A-Za-z]{2}$/.test(t)) continue; // state abbrev like "CA"
          const k = t.toLowerCase();
          if (seen.has(k)) continue;
          seen.add(k);
          out.push(t);
        }
        return out;
      };
      // Classify a single token: supplier match wins, then utility.
      // Decision is keyed by the lowercased token so a curated mapping
      // sticks per-name across rows + refreshes.
      const classifyVendorToken = (raw) => {
        const supplier = matchVendorToSupplier(raw);
        // Only promote a vendor token to a looked-up utility for in-scope
        // countries; elsewhere it stays an (un-looked-up) supplier token.
        const utility = (!supplier && lookupAllowed) ? matchVendorToUtility(raw) : null;
        const kind = supplier ? 'supplier' : (utility ? 'utility' : null);
        const canonical = supplier?.canonical || utility?.canonical || null;
        const score = (supplier?.score ?? utility?.score) || null;
        const decision = vendorDecisions[raw.toLowerCase()] || null;
        const isFuzzy = !!(canonical && raw.toLowerCase() !== String(canonical).toLowerCase());
        const resolved = (canonical && decision !== 'rejected') ? canonical : raw;
        return { raw, kind, canonical, score, decision, isFuzzy, resolved };
      };
      const electricRawTokens = splitVendorTokens(rawElectric);
      const gasRawTokens = splitVendorTokens(rawGas);
      const electricTokens = electricRawTokens.map(classifyVendorToken);
      const gasTokens = gasRawTokens.map(classifyVendorToken);
      // Utility-classified tokens belong in the utility column; the
      // rest (suppliers and unknown vendors) drive the supplier column.
      const electricUtilityTokens = electricTokens.filter(t => t.kind === 'utility' && t.decision !== 'rejected');
      const gasUtilityTokens = gasTokens.filter(t => t.kind === 'utility' && t.decision !== 'rejected');
      // Rejected tokens drop out of view entirely — the user used ✗
      // to mean "this isn't a real supplier, hide it" so neither the
      // pill nor the joined string should still surface them.
      const electricSupplierDisplayTokens = electricTokens.filter(t => t.kind !== 'utility' && t.decision !== 'rejected');
      const gasSupplierDisplayTokens = gasTokens.filter(t => t.kind !== 'utility' && t.decision !== 'rejected');
      const electricSupplierResolved = electricSupplierDisplayTokens.length
        ? electricSupplierDisplayTokens.map(t => t.resolved).filter(Boolean).join(', ')
        : null;
      const gasSupplierResolved = gasSupplierDisplayTokens.length
        ? gasSupplierDisplayTokens.map(t => t.resolved).filter(Boolean).join(', ')
        : null;
      // Score / kind for the utility column tooltip ("matched from
      // vendor …") — pull from the first utility-classified token,
      // since that's what could backfill a missing zip-based utility.
      const electricUtilityVendorScore = electricUtilityTokens[0]?.score || null;
      const gasUtilityVendorScore = gasUtilityTokens[0]?.score || null;
      // Fuzzy supplier matches across both commodities — kept here
      // (pre-rejection filter) so the page header can report how many
      // suggestions the user has decided on.
      const supplierSuggestions = [...electricTokens, ...gasTokens]
        .filter(t => t.kind === 'supplier' && t.isFuzzy);
      return {
        ...r,
        id: i,
        __zipNorm__: zip,
        // ISO / RTO is a North-American market map keyed by US zip, so it
        // is gated with the state code: a Spanish postal code that lands
        // inside PJM's zip range is the same collision, and the Excel
        // export already blanks the market for non-US/CA sites. Out of
        // scope reads back as the same "nothing known" shape the lookup
        // returns for a zip it has never seen.
        __iso__: stateInScope ? lookupIsoForZip(zip) : lookupIsoForZip(null),
        __zipEstimated__: zipEstimated,
        __zipEstimateCount__: zipEstimate?.candidateCount || 0,
        __zipEstimateSource__: zipEstimate?.source || null,
        __supplierSuggestions__: supplierSuggestions,
        __electric__: (lookupAllowed ? match?.electric : null) || electricUtilityTokens[0]?.canonical || null,
        __gas__: (lookupAllowed ? match?.gas : null) || gasUtilityTokens[0]?.canonical || null,
        __electricVendorRaw__: rawElectric || null,
        __electricVendorMatchScore__: electricUtilityVendorScore,
        __electricVendorMatchKind__: electricUtilityTokens.length ? 'utility' : null,
        __gasVendorRaw__: rawGas || null,
        __gasVendorMatchScore__: gasUtilityVendorScore,
        __gasVendorMatchKind__: gasUtilityTokens.length ? 'utility' : null,
        __electricSupplierTokens__: electricSupplierDisplayTokens,
        __gasSupplierTokens__: gasSupplierDisplayTokens,
        __electricUtilityTokens__: electricUtilityTokens,
        __gasUtilityTokens__: gasUtilityTokens,
        __water__: lookupAllowed ? match?.water : undefined,
        __address__: addressOverride ? String(r[addressOverride] || '').trim() || null : null,
        __city__: cityColInput || match?.city,
        __country__: resolvedCountry || undefined,
        // Canonical US code when resolved (drives rates + deregulation
        // lookups); else the raw mapped value so non-US provinces still
        // display.
        // Null outside the US / Canada, where the raw value is a foreign
        // subdivision ("Toledo (Castilla-La Mancha)") that every consumer
        // of this field reads as a state code. The uploaded string is
        // still carried, on __stateRaw__.
        __state__: stateInScope ? (state || stateColInput || null) : null,
        // The State / Province column exactly as uploaded, whatever the
        // country and never a derived code. The Mexico flags key off it —
        // a Baja site has to stay recognisable as Baja even though a
        // Mexican código postal resolves no state code.
        __stateRaw__: stateColInput || null,
        // Display value for the export's State / Province columns. US and
        // Canadian sites keep the 2-letter code (TX, ON); every other
        // country shows the full subdivision name exactly as uploaded —
        // a derived US code from a zip-prefix / name collision (e.g. a
        // German postal code resolving to "NY") must never override it.
        __stateProvinceDisplay__: (() => {
          const isUS = isUnitedStatesCountry(resolvedCountry);
          const isCA = isCanadaCountry(resolvedCountry);
          const countryLabel = normalizeCountryName(resolvedCountry) || resolvedCountry;
          return (isUS || isCA)
            ? (state || stateColInput || countryLabel || '')
            : (stateColInput || countryLabel || '');
        })(),
        __companyName__: (inputCompanyName || portfolioCompanyName) || null,
        __division__: inputDivision || null,
        __propertyTypeRaw__: inputPropertyType || null,
        __excludedType__: excludedType,
        __propertyType__: canonicalPropertyType,
        __segment__: segment,
        __segmentSource__: segmentSource,
        __ownershipRaw__: inputOwnership || null,
        __ownership__: canonicalOwnership,
        __siteDescription__: inputSiteDescription || null,
        __propertySizeFt2__: inputPropertySize,
        __kwhFromEstimate__: elecValueFromEstimate,
        __thermsFromEstimate__: gasValueFromEstimate,
        __kwh__: elecValueFinal,
        __therms__: gasValueFinal,
        __kwhSource__: elec.sourceHeader,
        __thermsSource__: gas.sourceHeader,
        __electricRate__: electricRate,
        __gasRate__: gasRate,
        __electricRateSource__: electricRateSource,
        __gasRateSource__: gasRateSource,
        __rateCountry__: resolvedCountryRateName,
        __electricCost__: electricCost,
        __gasCost__: gasCost,
        __electricCostActual__: actualElectricCost,
        __gasCostActual__: actualGasCost,
        __electricCostEstimated__: estElectricCost,
        __gasCostEstimated__: estGasCost,
        __totalCost__: (electricCost != null || gasCost != null) ? totalCost : null,
        __electricSupplier__: supplierOverrides[`${i}_electric`] || electricSupplierResolved,
        __gasSupplier__: supplierOverrides[`${i}_gas`] || gasSupplierResolved,
        __electricStart__: electricStartOverride ? parseSourceDate(r[electricStartOverride]) : null,
        __electricEnd__: electricEndOverride ? parseSourceDate(r[electricEndOverride]) : null,
        __electricContractPrice__: electricContractPrice,
        __electricPriceUom__: electricPriceUom,
        __electricContractName__: electricContractNameOverride ? String(r[electricContractNameOverride] || '').trim() || null : null,
        __electricProductType__: electricProductTypeOverride ? String(r[electricProductTypeOverride] || '').trim() || null : null,
        __gasStart__: gasStartOverride ? parseSourceDate(r[gasStartOverride]) : null,
        __gasEnd__: gasEndOverride ? parseSourceDate(r[gasEndOverride]) : null,
        __gasContractPrice__: gasContractPrice,
        __gasPriceUom__: gasPriceUom,
        __gasContractName__: gasContractNameOverride ? String(r[gasContractNameOverride] || '').trim() || null : null,
        __gasProductType__: gasProductTypeOverride ? String(r[gasProductTypeOverride] || '').trim() || null : null,
        __matched__: !!match || electricUtilityTokens.length > 0 || gasUtilityTokens.length > 0,
      };
    });
  }, [cleanSitesData, zipColumn, utility, cityStateZipIndex, zipFallbackIndex, consumption, electricCostOverride, gasCostOverride, electricSupplierOverride, gasSupplierOverride, electricStartOverride, electricEndOverride, gasStartOverride, gasEndOverride, electricUomOverride, gasUomOverride, countryOverride, companyNameOverride, portfolioCompanyName, addressOverride, cityOverride, stateColumnOverride, propertyTypeOverride, propertyTypeMap, segmentOverride, ownershipOverride, siteDescriptionOverride, divisionOverride, propertySizeOverride, electricContractPriceOverride, gasContractPriceOverride, contractPriceUomColumns, electricContractNameOverride, electricProductTypeOverride, gasContractNameOverride, gasProductTypeOverride, knownUtilityNames, vendorDecisions, supplierOverrides]);

  // The analysis set. The Division scope narrows it, so every consumer of
  // `rows` — the table, the stats, all four other tabs and every export —
  // sees one division without any of them having to know the filter exists.
  //
  // Sites whose property type was mapped to N/A used to be dropped here,
  // which took them out of the site count, the compliance screening and
  // every export — a site in the portfolio vanishing from the Master
  // Analysis. An N/A mapping says the type gives no basis for modelling
  // usage, not that the building isn't there. It already means that on its
  // own: the mapping resolves to no canonical property type, and the
  // consumption estimate is keyed off exactly that, so these rows carry no
  // estimated kWh / therms wherever they appear. Nothing else needed
  // suppressing.
  const rows = useMemo(
    () => allRows.filter(r => rowInDivision(r, divisionFilter)),
    [allRows, divisionFilter],
  );

  // Every division present in the upload, with its site count. Built from
  // allRows rather than `rows` so choosing one doesn't collapse the list
  // to the choice just made.
  const divisionOptions = useMemo(() => {
    const counts = new Map();
    let blank = 0;
    for (const r of allRows) {
      const d = String(r.__division__ || '').trim();
      if (!d) { blank++; continue; }
      counts.set(d, (counts.get(d) || 0) + 1);
    }
    const list = [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([value, count]) => ({ value, label: value, count }));
    // Only worth offering once something is actually filed by division —
    // otherwise "(no division)" would be the entire upload.
    if (blank > 0 && list.length > 0) list.push({ value: NO_DIVISION, label: '(no division)', count: blank });
    return list;
  }, [allRows]);

  // A replaced sites file can retire the division being viewed. Without
  // this the page would show zero sites with the reason hidden in a picker
  // that no longer lists the value.
  useEffect(() => {
    if (!divisionFilter) return;
    if (!divisionOptions.some(o => o.value === divisionFilter)) setDivisionFilter('');
  }, [divisionOptions, divisionFilter]);

  // The active division as a label for export file names and the
  // compliance report header. Empty when the page is showing everything.
  function activeDivisionLabel() {
    if (!divisionFilter) return '';
    return divisionFilter === NO_DIVISION ? 'No Division' : divisionFilter;
  }

  // What the N/A mapping took out, for the notice next to the site count.
  // Scoped to the active division for the same reason the site count is:
  // the two sit side by side and would otherwise describe different sets.
  // Contract prices the file quotes in a unit the page doesn't read them in.
  //
  // Nothing converts a contract price: the figure is carried as written and
  // labelled $/kWh or $/therm wherever it surfaces — the Contract Overview
  // sheet, the Supplier Contracts rollup's consumption-weighted average. So
  // a portfolio whose gas prices are per Dth reports them ten times high
  // against a per-therm assumption, silently. This is what the page needs to
  // say out loud.
  //
  // Only sites that HAVE a price count, and only where the file actually
  // names a different unit — an unreadable or absent unit resolves as
  // canonical, so a file that says nothing raises nothing.
  const contractPriceUomFlags = useMemo(
    () => summarizePriceUomFlags(rows.map(r => ({ electric: r.__electricPriceUom__, gas: r.__gasPriceUom__ }))),
    [rows],
  );

  // Sites whose property type is mapped to N/A. They're in the analysis set
  // like any other site; what they don't get is a modelled consumption
  // figure, since the estimate is keyed off a canonical property type and
  // N/A resolves to none. Counted so the headline can say which sites are
  // carrying no usage number and why.
  const unestimatedSites = useMemo(() => {
    const byType = new Map();
    for (const r of allRows) {
      if (!r.__excludedType__) continue;
      if (!rowInDivision(r, divisionFilter)) continue;
      const raw = String(r.__propertyTypeRaw__ || '').trim() || '(blank)';
      byType.set(raw, (byType.get(raw) || 0) + 1);
    }
    return {
      total: [...byType.values()].reduce((n, v) => n + v, 0),
      byType: [...byType.entries()].map(([raw, count]) => ({ raw, count })).sort((a, b) => b.count - a.count),
    };
  }, [allRows, divisionFilter]);

  // Utility accounts (bills) behind the loaded sites, estimated from each
  // site's property type — the unit a data deal is priced in ($/account/
  // month), which is why it belongs beside the site count rather than only
  // inside the export. Division-scoped like every other headline figure.
  //
  // Sites whose property type didn't resolve contribute nothing and are
  // counted separately: a total that quietly skipped a third of the
  // portfolio would read as the portfolio's, so the headline says how many
  // sites are behind it and the hover names the types still to be mapped.
  const accountStats = useMemo(() => {
    let total = 0;
    let sites = 0;
    let unknown = 0;
    // Sites that carry SOME property-type value, mapped or not. It is the
    // difference between "these types need mapping" and "this upload has no
    // property type at all", which are different jobs for the user: one is
    // the Property Types button, the other is the column mapping.
    let withRawType = 0;
    const byType = new Map();
    for (const r of rows) {
      if (String(r.__propertyTypeRaw__ || '').trim()) withRawType += 1;
      const est = propertyTypeAccountTotal(r.__propertyType__);
      if (est == null) { unknown += 1; continue; }
      total += est;
      sites += 1;
      const name = r.__propertyType__;
      const prev = byType.get(name) || { name, sites: 0, accounts: 0 };
      prev.sites += 1;
      prev.accounts += est;
      byType.set(name, prev);
    }
    return {
      total: Math.round(total),
      sites,
      unknown,
      withRawType,
      byType: [...byType.values()].sort((a, b) => b.accounts - a.accounts),
    };
  }, [rows]);

  // A hand-entered total, for the portfolio the page is working on.
  //
  // The per-property-type estimate is a model, and a model is no use against
  // a real bill count someone already has — an upload with no property types
  // estimates nothing at all, and even a fully mapped one is a typical-site
  // figure rather than this portfolio's. So the total can be typed, and once
  // it is, it is what the page shows and what "Save to Company" writes onto
  // the company's Number of Accounts. The per-site column stays the estimate:
  // a portfolio total can't be divided back over the sites.
  //
  // Keyed by company rather than held per upload, because the figure is a
  // fact about the company and this page holds one file at a time — a
  // portfolio that arrives as three regional uploads shouldn't have to be
  // re-typed three times. Uploads with no company to file under share one
  // reserved key, which the hover says out loud.
  const UNFILED_ACCOUNTS_KEY = '__unfiled__';
  const manualAccountsMap = useMemo(() => {
    const raw = settings?.utilityLookupAccounts;
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  }, [settings?.utilityLookupAccounts]);
  const accountsCompany = deriveExportCompanyName(null) || portfolioCompanyName;
  const accountsKey = companySlug(accountsCompany) || UNFILED_ACCOUNTS_KEY;
  const manualAccounts = useMemo(() => {
    const n = Number(manualAccountsMap[accountsKey]);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }, [manualAccountsMap, accountsKey]);
  // null clears it — back to the estimate, rather than a stored zero that
  // reads as "this portfolio has no accounts".
  const setManualAccounts = useCallback((value) => {
    if (!updateSettingsPath) return;
    updateSettingsPath({ [`utilityLookupAccounts.${accountsKey}`]: value == null ? null : value });
  }, [updateSettingsPath, accountsKey]);
  // null = not editing; a string = what's in the box.
  const [accountsDraft, setAccountsDraft] = useState(null);
  function commitAccountsDraft() {
    const raw = String(accountsDraft ?? '').trim().replace(/,/g, '');
    setAccountsDraft(null);
    if (!raw) { if (manualAccounts != null) setManualAccounts(null); return; }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return;
    setManualAccounts(Math.round(n));
  }

  // Distinct Property Type strings from the upload that still have no
  // canonical match — the rows the mapping modal exists to resolve.
  // Sorted by how many sites carry each value so the biggest wins are
  // at the top. A type mapped to N/A is skipped: that's a decision already
  // taken, not a value still waiting to be resolved.
  const unmappedPropertyTypes = useMemo(() => {
    const counts = new Map();
    for (const r of allRows) {
      const raw = String(r.__propertyTypeRaw__ || '').trim();
      if (!raw || r.__propertyType__ || r.__excludedType__) continue;
      const key = raw.toLowerCase();
      const prev = counts.get(key);
      if (prev) prev.count += 1;
      else counts.set(key, { key, raw, count: 1 });
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.raw.localeCompare(b.raw));
  }, [allRows]);

  // Everything the mapping modal can act on: the property types in the
  // current file with no canonical match (the ones needing attention),
  // plus every value already hand-mapped — so opening it from the toolbar
  // can edit or clear an existing mapping, not only fill in blanks. Counted
  // over `allRows` so a type mapped to N/A still shows how many sites it
  // covers, and can be mapped back to a real type.
  const propertyTypeMappingItems = useMemo(() => {
    // Original casing + per-file counts for whatever the upload carries.
    const rawByKey = new Map();
    const counts = new Map();
    for (const r of allRows) {
      const raw = String(r.__propertyTypeRaw__ || '').trim();
      if (!raw) continue;
      const k = raw.toLowerCase();
      if (!rawByKey.has(k)) rawByKey.set(k, raw);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    const byKey = new Map();
    for (const it of unmappedPropertyTypes) byKey.set(it.key, it);
    for (const [key, target] of Object.entries(propertyTypeMap || {})) {
      if (!target || byKey.has(key)) continue;
      byKey.set(key, { key, raw: rawByKey.get(key) || key, count: counts.get(key) || 0 });
    }
    // Unmapped first (they need attention), then the most-used, then A-Z.
    return [...byKey.values()].sort((a, b) => {
      const aPending = !propertyTypeMap?.[a.key];
      const bPending = !propertyTypeMap?.[b.key];
      if (aPending !== bPending) return aPending ? -1 : 1;
      return b.count - a.count || a.raw.localeCompare(b.raw);
    });
  }, [allRows, unmappedPropertyTypes, propertyTypeMap]);

  // Auto-open the mapping modal after an import that brought in property
  // types we can't place. Only on import — the modal stays reachable
  // afterwards from the header chip, so it can't nag on every render.
  useEffect(() => {
    if (!propertyTypeCheckPending) return;
    if (!sitesLoaded) return;
    setPropertyTypeCheckPending(false);
    if (unmappedPropertyTypes.length > 0) setPropertyTypeModalOpen(true);
  }, [propertyTypeCheckPending, sitesLoaded, unmappedPropertyTypes]);

  // Sites fed to the Building Compliance Screening subtab. Built from the
  // processed rows so each site carries the derived square footage, property
  // type, and electric/gas utility — the screening uses square footage vs each
  // ordinance's threshold for eligibility, and the utilities for the
  // whole-building-data-collection (utility feed) breakdown.
  const complianceSites = useMemo(() => {
    return rows.map((r, i) => ({
      id: r.id ?? i,
      company: r.__companyName__ || '',
      siteName: siteNameColumn ? String(r[siteNameColumn] ?? '').trim() : (r.__siteName__ || ''),
      city: String(r.__city__ || (cityOverride ? r[cityOverride] : '') || '').trim(),
      state: String(r.__state__ || (stateColumnOverride ? r[stateColumnOverride] : '') || '').trim(),
      // Resolved country (mapped column, else zip/utility-derived) — the
      // Corporate Compliance subtab buckets sites into North America /
      // Europe / Rest of World off this.
      country: String(r.__country__ || '').trim(),
      sqft: (typeof r.__propertySizeFt2__ === 'number' && Number.isFinite(r.__propertySizeFt2__)) ? r.__propertySizeFt2__ : null,
      propertyType: r.__propertyType__ || r.__propertyTypeRaw__ || '',
      // Canonical 'Owned' / 'Leased' where the upload's value could be
      // placed — that's what scopes the two building-compliance subtabs,
      // whose obligations fall on the owner. Where it couldn't, the raw
      // string travels as-is rather than the cell going blank, same as
      // propertyType above and the Master Site List: "Owned/Leased" or
      // "TBD" is a real answer about that site, and now that Ownership is
      // a column on the Site Detail table, dropping it would read as "not
      // provided" when it wasn't. A raw value still isn't === 'Leased', so
      // it screens like any other unknown status.
      ownership: r.__ownership__ || r.__ownershipRaw__ || null,
      // The utility mapping behind the whole-building-data cards: the zip the
      // lookup resolved from, and the three serving utilities it resolved to.
      zip: String(r.__zipNorm__ || '').trim(),
      electricUtility: r.__electric__ || '',
      gasUtility: r.__gas__ || '',
      waterUtility: r.__water__ || '',
    }));
  }, [rows, siteNameColumn, cityOverride, stateColumnOverride]);

  // Building Compliance Screening + Compliance Roadmap default to leaving
  // the leased buildings out and toggle back to the full list — these
  // obligations fall on the owner. Shared here rather than per-subtab so
  // the two views of the same analysis always agree. Only a site known to
  // be Leased is dropped: an unknown ownership status is a gap in the
  // upload, not a reason to leave a building out of its own compliance
  // report. Inert (and the toggle disabled) when nothing is leased.
  const [complianceExcludeLeased, setComplianceExcludeLeased] = useState(true);
  const complianceScopedSites = useMemo(
    () => scopeSitesByOwnership(complianceSites, complianceExcludeLeased),
    [complianceSites, complianceExcludeLeased],
  );

  // The savings side of the same question, and the export toolbar's toggle.
  // Indicative savings are a motion on the supply contract behind the meter,
  // which on a leased building is usually the landlord's — so the exports
  // leave leased locations out by default. "Usually" isn't "always" though:
  // a triple-net portfolio often holds its own supply contracts, and this
  // puts those sites back into the projection without anyone having to
  // unmap the Ownership column. Read by the Master Analysis / Indicative
  // Savings export and by the per-company / per-division roll-ups, which
  // is why it lives up here rather than inside either.
  const [includeLeasedSavings, setIncludeLeasedSavings] = useState(false);
  // How many loaded sites are leased — what the toolbar button counts, and
  // whether it renders at all. With nothing leased the toggle decides
  // nothing.
  const leasedSiteCount = useMemo(() => savingsOwnershipScope(rows).leased, [rows]);

  // Tenure coverage, and whether the page is currently warning about it.
  // Everything above reads one optional column, and an upload that never
  // carried it is indistinguishable downstream from a portfolio that owns
  // every building — so say so here rather than let the silence pass for an
  // answer. See TenureWarningBanner for what the two shapes of the gap mean.
  const tenureStats = useMemo(() => tenureCoverage(rows), [rows]);
  // Dismissal is per-gap, not forever: the key changes whenever the shape of
  // the gap does (a new upload, a re-mapped column, a mass edit that fills
  // some in), so hiding the warning on one list never hides it on the next.
  const tenureWarningKey = `${tenureStats.total}:${tenureStats.missing}:${ownershipOverride || ''}`;
  const [tenureWarningDismissed, setTenureWarningDismissed] = useState(null);
  const showTenureWarning = sitesData.length > 0
    && tenureStats.missing > 0
    && tenureWarningDismissed !== tenureWarningKey;

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const term = search.toLowerCase();
    return rows.filter(r =>
      Object.entries(r).some(([k, v]) =>
        !k.startsWith('__') && String(v).toLowerCase().includes(term)
      )
    );
  }, [search, rows]);

  // ---- Mass edit: which columns, and writing them ----------------------
  // The page's live column mapping, as one object. Every one of these is
  // the header a field is currently read from, so an edit aimed at
  // "Property Type" lands in the column the property-type derivation
  // reads on the very next render — no second mapping to keep in step.
  const siteFieldMapping = useMemo(() => ({
    siteName: siteNameColumn,
    companyName: companyNameOverride,
    division: divisionOverride,
    address: addressOverride,
    city: cityOverride,
    state: stateColumnOverride,
    zip: zipColumn,
    country: countryOverride,
    propertyType: propertyTypeOverride,
    segment: segmentOverride,
    ownership: ownershipOverride,
    siteDescription: siteDescriptionOverride,
    propertySize: propertySizeOverride,
    electric: electricColOverride,
    electricUom: electricUomOverride,
    gas: gasColOverride,
    gasUom: gasUomOverride,
    electricCost: electricCostOverride,
    gasCost: gasCostOverride,
    electricSupplier: electricSupplierOverride,
    gasSupplier: gasSupplierOverride,
    electricStart: electricStartOverride,
    electricEnd: electricEndOverride,
    electricContractPrice: electricContractPriceOverride,
    electricContractName: electricContractNameOverride,
    electricProductType: electricProductTypeOverride,
    gasStart: gasStartOverride,
    gasEnd: gasEndOverride,
    gasContractPrice: gasContractPriceOverride,
    gasContractName: gasContractNameOverride,
    gasProductType: gasProductTypeOverride,
  }), [
    siteNameColumn, companyNameOverride, divisionOverride, addressOverride, cityOverride,
    stateColumnOverride, zipColumn, countryOverride, propertyTypeOverride, segmentOverride,
    ownershipOverride, siteDescriptionOverride, propertySizeOverride, electricColOverride,
    electricUomOverride, gasColOverride, gasUomOverride, electricCostOverride, gasCostOverride,
    electricSupplierOverride, gasSupplierOverride, electricStartOverride, electricEndOverride,
    electricContractPriceOverride, electricContractNameOverride, electricProductTypeOverride,
    gasStartOverride, gasEndOverride, gasContractPriceOverride, gasContractNameOverride,
    gasProductTypeOverride,
  ]);

  const editableSiteColumns = useMemo(
    () => siteEditableColumns(
      sitesData.length ? Object.keys(sitesData[0]) : [],
      siteFieldMapping,
      [siteNameColumn],
    ),
    [sitesData, siteFieldMapping, siteNameColumn],
  );
  const massColumn = useMemo(
    () => editableSiteColumns.find(c => c.header === massHeader) || null,
    [editableSiteColumns, massHeader],
  );
  // A field left selected after a re-upload that dropped its column would
  // otherwise sit there looking applicable and write nowhere.
  useEffect(() => {
    if (massHeader && !massColumn) { setMassHeader(''); setMassValue(''); }
  }, [massHeader, massColumn]);

  // The rows the "select all" box covers: what the search has left on
  // screen, not the whole upload. Selecting sites the user can't see is
  // how a bulk edit lands somewhere they didn't look.
  const selectableSiteIds = useMemo(() => filtered.map(r => r.id), [filtered]);
  const selectedVisibleCount = useMemo(
    () => selectableSiteIds.filter(id => selectedSiteIds.has(id)).length,
    [selectableSiteIds, selectedSiteIds],
  );
  const allVisibleSelected = selectableSiteIds.length > 0
    && selectedVisibleCount === selectableSiteIds.length;

  function toggleSelectAllVisible() {
    setSelectedSiteIds(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) for (const id of selectableSiteIds) next.delete(id);
      else for (const id of selectableSiteIds) next.add(id);
      return next;
    });
  }

  // Write the chosen value into the chosen column on every selected site,
  // then persist. The uploaded rows ARE the page's data — utility match,
  // rates, costs, compliance screening are all derived from them — so a
  // saved edit is the same as if the spreadsheet had arrived that way.
  async function applySiteMassEdit() {
    if (massBusy || !massColumn) return;
    // Selection is by row id, but the write is by object identity: ids
    // are positions in the cleaned list, and positions are exactly what
    // a re-upload or a renamed site can shift underneath a stale set.
    const targets = new Set(
      [...selectedSiteIds].map(id => cleanSitesData[id]).filter(Boolean),
    );
    if (targets.size === 0) return;

    const coerced = coerceSiteValue(massColumn, massValue);
    if (!coerced.ok) { setMassStatus({ type: 'error', message: coerced.error }); return; }
    if (!window.confirm(describeSiteEdit(massColumn, coerced.value, targets.size))) return;

    setMassBusy(true);
    setMassStatus(null);
    try {
      const { rows: next, changed, skipped } = applySiteColumnEdit(
        sitesData, targets, massColumn.header, coerced.value,
      );
      // Saved before the state swap: a write that fails must not leave
      // the page showing an edit the next reload won't have.
      await saveListToIDB(SITES_STORAGE_KEY, next);
      setSitesData(next);
      // The value deliberately stays in the box. Clearing it would leave
      // a loaded Apply button one click from writing a blank over the
      // column that was just set — and keeping it is what the next step
      // usually wants anyway: same value, a different set of sites.
      setMassStatus({
        type: 'success',
        message: changed === 0
          ? `Every one of those ${targets.size} site${targets.size === 1 ? '' : 's'} already had that value — nothing changed.`
          : `${massColumn.label} set on ${changed} site${changed === 1 ? '' : 's'}`
            + `${skipped > 0 ? ` (${skipped} already had it)` : ''}.`,
      });
    } catch (err) {
      setMassStatus({ type: 'error', message: `Couldn’t save the edit: ${err?.message || err}` });
    } finally {
      setMassBusy(false);
    }
  }

  // Data-quality flag for the header — counts uploaded sites missing
  // any of the three inputs that the rest of the page relies on:
  // zip code (drives utility / supplier matching), electric kWh
  // (actual-from-file or property-type estimate), and gas therms.
  const missingStats = useMemo(() => {
    if (!rows.length) return { total: 0, anyMissing: 0, noZip: 0, noElectric: 0, noGas: 0, estimatedZip: 0, samples: [] };
    let anyMissing = 0;
    let noZip = 0;
    let noElectric = 0;
    let noGas = 0;
    let estimatedZip = 0;
    const samples = [];
    for (const r of rows) {
      if (r.__zipEstimated__) estimatedZip += 1;
      const missingZip = !r.__zipNorm__;
      const missingElectric = r.__kwh__ == null;
      const missingGas = r.__therms__ == null;
      if (!(missingZip || missingElectric || missingGas)) continue;
      anyMissing += 1;
      if (missingZip) noZip += 1;
      if (missingElectric) noElectric += 1;
      if (missingGas) noGas += 1;
      if (samples.length < 25) {
        const name = String(r[Object.keys(r).find(k => !k.startsWith('__')) || ''] || '').trim() || '(no name)';
        const flags = [
          missingZip ? 'no zip' : null,
          missingElectric ? 'no electric' : null,
          missingGas ? 'no gas' : null,
        ].filter(Boolean).join(' · ');
        samples.push(`${name} · ${flags}`);
      }
    }
    return { total: rows.length, anyMissing, noZip, noElectric, noGas, estimatedZip, samples };
  }, [rows]);

  const columns = useMemo(() => {
    if (!sitesData.length) return [];
    const headers = Object.keys(sitesData[0]);
    // Short-date formatter for any column the user mapped as a
    // contract start / end. Used by both the auto-pass-through base
    // columns (so the source header for that field stops showing the
    // raw Excel serial) and the derived makeDateCol columns below.
    const fmtShortDate = (v) => {
      if (v == null || v === '') return '';
      const d = v instanceof Date ? v : parseSourceDate(v);
      if (d && Number.isFinite(d.getTime())) {
        return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
      }
      return String(v);
    };
    const dateOverrideCols = new Set(
      [electricStartOverride, electricEndOverride, gasStartOverride, gasEndOverride].filter(Boolean)
    );
    const base = headers.map((k, i) => {
      const isDate = dateOverrideCols.has(k);
      return {
        key: k,
        label: k,
        defaultWidth: i === 0 ? 220 : 140,
        ...(i === 0 ? { sticky: true } : {}),
        render: (row) => {
          const v = row[k];
          // Only the mapped zip column gets the zip treatment. Guarding on
          // zipColumn itself keeps an unmapped file (zipColumn === '') from
          // matching a blank header and turning that column into the zip.
          const isZipCol = !!zipColumn && k === zipColumn;
          if (isZipCol && row.__zipNorm__) {
            if (row.__zipEstimated__) {
              const n = row.__zipEstimateCount__;
              const where = `${row.__city__ || 'this city'}${row.__state__ ? `, ${row.__state__}` : ''}`;
              const title = row.__zipEstimateSource__ === 'fallback'
                ? `Estimated zip: this site had no zip, so it uses ${row.__zipNorm__} from the uploaded fallback zip list for ${where}.`
                : `Estimated zip: this site had no zip, so it borrows ${row.__zipNorm__} from ${n} known location${n === 1 ? '' : 's'} in ${where} in the utility lookup.`;
              return (
                <span
                  title={title}
                  style={{ color: '#94A3B8', fontStyle: 'italic' }}
                >{row.__zipNorm__} (est)</span>
              );
            }
            return row.__zipNorm__;
          }
          if (isZipCol) {
            // No uploaded zip, and the site's city + state didn't resolve
            // to a known zip in the utility lookup, so there was nothing
            // to estimate from.
            return (
              <span
                title="This site has no zip code, and its city + state didn't match any zip in the utility lookup: so none could be estimated."
                style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}
              >no estimate available</span>
            );
          }
          if (v == null || v === '') return <span style={{ color: 'var(--color-text-muted)' }}>-</span>;
          return isDate ? fmtShortDate(v) : String(v);
        },
        exportValue: (row) => {
          if (zipColumn && k === zipColumn && row.__zipNorm__) return row.__zipNorm__;
          const v = row[k];
          if (isDate) return fmtShortDate(v);
          return v ?? '';
        },
      };
    });
    // Company Name — the company / portfolio each site belongs to, from
    // the optional mapped Company Name column. Purely descriptive; also
    // drives the Indicative Savings export's file name.
    const companyNameCol = {
      key: 'companyName',
      label: 'Company Name',
      defaultWidth: 200,
      render: (row) => {
        const v = row.__companyName__;
        if (!v) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>-</span>;
        return (
          <span
            title={v}
            style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-primary)', display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >{v}</span>
        );
      },
      exportValue: (row) => row.__companyName__ || '',
    };
    // Division — the operating brand / subsidiary / business unit the
    // site belongs to, one level under Company Name. Passthrough from
    // the optional mapped column: nothing derives from it, it is here so
    // a portfolio spanning several divisions can be read and filtered
    // apart on the page and carries that split into the exports.
    const divisionCol = {
      key: 'division',
      // "Division" alone under-sold what this column actually holds. In a
      // PE-backed portfolio the level under Company Name is a portfolio
      // company, not a division, and a header naming only one of the two
      // reads as though the other belongs somewhere else on the page.
      label: 'Division/Portfolio Company',
      defaultWidth: 170,
      render: (row) => {
        const v = row.__division__;
        if (!v) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>-</span>;
        return (
          <span
            title={v}
            style={{ fontSize: '0.72rem', color: 'var(--color-text-primary)', display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >{v}</span>
        );
      },
      exportValue: (row) => row.__division__ || '',
    };
    // ISO / RTO — the site's wholesale electricity market, resolved from its
    // zip via EPA eGRID subregions (see utils/isoLookup). A small chip flags
    // when the zip straddles two markets (seam) or the subregion is ambiguous
    // (verify). "None …" markets show muted; unresolved zips show a dash.
    const isoCol = {
      key: 'iso',
      label: 'ISO / RTO',
      defaultWidth: 150,
      render: (row) => {
        const info = row.__iso__ || { iso: null, iso_confidence: 'unknown' };
        if (!info.iso) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>-</span>;
        const isNone = info.iso.startsWith('None');
        const conf = info.iso_confidence;
        const chip = conf === 'seam'
          ? { bg: '#FEF3C7', border: '#FCD34D', text: '#92400E', label: 'seam' }
          : conf === 'verify'
            ? { bg: '#EDE9FE', border: '#C4B5FD', text: '#5B21B6', label: 'verify' }
            : null;
        const tip = [
          isNone ? info.iso : `ISO / RTO: ${info.iso}`,
          info.egrid_subregion ? `eGRID ${info.egrid_subregion}` : null,
          conf === 'seam' ? 'ZIP straddles two markets: primary market shown' : null,
          conf === 'verify' ? 'Subregion is ambiguous: verify' : null,
        ].filter(Boolean).join(' · ');
        return (
          <span title={tip} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 600, color: isNone ? 'var(--color-text-muted)' : 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {isNone ? 'None' : info.iso}
            </span>
            {chip && (
              <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '0 5px', borderRadius: 999, background: chip.bg, border: `1px solid ${chip.border}`, color: chip.text }}>
                {chip.label}
              </span>
            )}
          </span>
        );
      },
      exportValue: (row) => row.__iso__?.iso || '',
    };
    const makeUtilityCol = (key, label, color) => ({
      key,
      label,
      defaultWidth: 160,
      render: (row) => {
        if (!utility?.zipMap) {
          return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>no utility loaded</span>;
        }
        if (!row.__matched__) {
          return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>-</span>;
        }
        const val = row[`__${key}__`];
        if (val == null || val === '') return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>-</span>;
        const text = String(val);
        // Tooltip mentions when the value came from a vendor fuzzy
        // match so the user can see why "Pepco MD" became "PEPCO …".
        const vendorRaw = key === 'electric' ? row.__electricVendorRaw__ : key === 'gas' ? row.__gasVendorRaw__ : null;
        const vendorScore = key === 'electric' ? row.__electricVendorMatchScore__ : key === 'gas' ? row.__gasVendorMatchScore__ : null;
        const matchedFromVendor = vendorRaw && vendorScore && String(vendorRaw).toLowerCase() !== String(text).toLowerCase();
        const baseTitle = `${label} · ${text}${row.__city__ ? ` · ${row.__city__}` : ''}${row.__country__ ? ` · ${row.__country__}` : ''}`;
        const tip = matchedFromVendor
          ? `${baseTitle} · matched from vendor "${vendorRaw}" (fuzzy score ${vendorScore}/100)`
          : baseTitle;
        return (
          <span
            title={tip}
            style={{ background: color.bg, border: `1px solid ${color.border}`, color: color.text, padding: '1px 8px', borderRadius: 999, fontSize: '0.7rem', fontWeight: 600, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}
          >{text}</span>
        );
      },
      exportValue: (row) => row[`__${key}__`] ?? '',
    });
    const makeLocationCol = (key, label) => ({
      key,
      label,
      defaultWidth: 120,
      render: (row) => {
        const val = row[`__${key}__`];
        if (!val) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>-</span>;
        return <span style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)' }}>{val}</span>;
      },
      exportValue: (row) => row[`__${key}__`] ?? '',
    });
    // Property Type — surfaces the canonical match from the
    // CONSUMPTION_ESTIMATES reference table plus a one-line summary of
    // what the table predicts for this site. Lets the user spot rows
    // whose mapping failed (raw string in muted red) before relying on
    // the Property Type Estimates export tab. Consumption numbers are
    // already size-scaled when the upload carried a Size_ft2 column.
    const propertyTypeCol = {
      key: 'propertyType',
      label: 'Property Type',
      defaultWidth: 180,
      render: (row) => {
        const canonical = row.__propertyType__;
        const raw = row.__propertyTypeRaw__;
        if (!canonical && !raw) {
          return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>-</span>;
        }
        if (!canonical) {
          return (
            <span
              title={`Unrecognized property type: "${raw}". Add an alias in propertyTypeEstimates.js to enable estimates.`}
              style={{ fontSize: '0.72rem', color: '#B91C1C', fontStyle: 'italic' }}
            >{raw}</span>
          );
        }
        const est = estimateConsumption(canonical, row.__propertySizeFt2__);
        const accounts = propertyTypeAccounts(canonical);
        const sub = est
          ? `Est. ${Math.round(est.electricKwh).toLocaleString()} kWh · ${Math.round(est.gasDth).toLocaleString()} Dth`
          : '';
        const acctSummary = accounts
          ? [
              accounts.electric ? `Elec ${accounts.electric.label}` : null,
              accounts.gas ? `Gas ${accounts.gas.label}` : null,
              accounts.water ? `Water ${accounts.water.label}` : null,
              accounts.waste ? `Waste ${accounts.waste.label}` : null,
              accounts.steam && accounts.steam.label !== '0' ? `Steam ${accounts.steam.label}` : null,
            ].filter(Boolean).join(' · ')
          : '';
        const tip = [canonical, est ? sub : null, acctSummary || null]
          .filter(Boolean).join('\n');
        return (
          <span title={tip} style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1.15, maxWidth: '100%' }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--color-text-primary)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{canonical}</span>
            {sub && (
              <span style={{ fontSize: '0.65rem', color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>
            )}
          </span>
        );
      },
      exportValue: (row) => row.__propertyType__ || row.__propertyTypeRaw__ || '',
    };
    // Customer segment (Commercial / Industrial) — drives which state
    // rate column the cost estimate uses. Derived from property type
    // unless the upload mapped an explicit Segment column. A coloured
    // badge mirrors the electric/gas palette: amber-ish for industrial,
    // slate for commercial.
    const segmentCol = {
      key: 'segment',
      label: 'Segment',
      defaultWidth: 110,
      render: (row) => {
        const seg = row.__segment__;
        if (!seg) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>-</span>;
        const isIndustrial = seg === 'industrial';
        const src = row.__segmentSource__;
        const srcLabel = src === 'column'
          ? 'from the mapped Segment column'
          : src === 'propertyType'
            ? 'inferred from property type'
            : 'defaulted (no property type or segment column)';
        const palette = isIndustrial
          ? { bg: '#FEF3C7', border: '#FCD34D', text: '#92400E' }
          : { bg: '#F1F5F9', border: '#CBD5E1', text: '#475569' };
        return (
          <span
            title={`${isIndustrial ? 'Industrial' : 'Commercial'} · ${srcLabel}. Uses the state ${isIndustrial ? 'industrial' : 'commercial'} indicative rate.`}
            style={{ display: 'inline-block', fontSize: '0.68rem', fontWeight: 600, padding: '0.1rem 0.4rem', borderRadius: 4, background: palette.bg, border: `1px solid ${palette.border}`, color: palette.text }}
          >{isIndustrial ? 'Industrial' : 'Commercial'}</span>
        );
      },
      exportValue: (row) => row.__segment__ === 'industrial' ? 'Industrial' : (row.__segment__ ? 'Commercial' : ''),
    };
    // Owned vs Leased, from the mapped Ownership column. Canonicalized
    // to the two labels so mixed spellings ("Own", "Tenant", "L") read
    // consistently; a value we couldn't place shows the raw string in
    // muted red the way an unrecognized property type does.
    //
    // Headed by the two values it holds rather than by the abstraction
    // over them: "Ownership" names the mapping the upload asks for, and
    // stays the name there and in the mass-edit picker, but on the table
    // the column is the answer, not the question.
    const ownershipCol = {
      key: 'ownership',
      label: 'Owned / Leased',
      // Wider than the old "Ownership" header needed: the label is five
      // characters longer and the values ("Owned", "Leased", or a raw
      // string the import couldn't place) sit under it as pills.
      defaultWidth: 140,
      render: (row) => {
        const canonical = row.__ownership__;
        const raw = row.__ownershipRaw__;
        if (!canonical && !raw) {
          return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>-</span>;
        }
        if (!canonical) {
          return (
            <span
              title={`Unrecognized ownership status: "${raw}". Expected Owned or Leased.`}
              style={{ fontSize: '0.72rem', color: '#B91C1C', fontStyle: 'italic' }}
            >{raw}</span>
          );
        }
        const isOwned = canonical === 'Owned';
        const palette = isOwned
          ? { bg: '#DCFCE7', border: '#86EFAC', text: '#166534' }
          : { bg: '#E0E7FF', border: '#A5B4FC', text: '#3730A3' };
        return (
          <span
            title={`${canonical}${raw && raw.toLowerCase() !== canonical.toLowerCase() ? `: from "${raw}"` : ''}`}
            style={{ display: 'inline-block', fontSize: '0.68rem', fontWeight: 600, padding: '0.1rem 0.4rem', borderRadius: 4, background: palette.bg, border: `1px solid ${palette.border}`, color: palette.text }}
          >{canonical}</span>
        );
      },
      exportValue: (row) => row.__ownership__ || row.__ownershipRaw__ || '',
    };
    // Free-text site annotation that lives next to Property Type. No
    // canonicalization or estimates — purely a passthrough column for
    // the user's notes / descriptions of each site.
    const siteDescriptionCol = {
      key: 'siteDescription',
      label: 'Site Description',
      defaultWidth: 220,
      render: (row) => {
        const v = row.__siteDescription__;
        if (!v) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>-</span>;
        return (
          <span
            title={v}
            style={{ fontSize: '0.72rem', color: 'var(--color-text-primary)', display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >{v}</span>
        );
      },
      exportValue: (row) => row.__siteDescription__ || '',
    };
    // Square footage of the site. Same value that scales the
    // property-type consumption estimates — surfaced here so the user
    // can see what the page used per row.
    const propertySizeCol = {
      key: 'propertySize',
      label: 'Size (ft²)',
      defaultWidth: 110,
      render: (row) => {
        const v = row.__propertySizeFt2__;
        if (v == null || !Number.isFinite(v)) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>-</span>;
        return (
          <span style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono, ui-monospace, monospace)' }}>{Math.round(v).toLocaleString()}</span>
        );
      },
      exportValue: (row) => (typeof row.__propertySizeFt2__ === 'number' && Number.isFinite(row.__propertySizeFt2__)) ? Math.round(row.__propertySizeFt2__) : '',
    };
    const makeMarketCol = (utilityKey, label) => ({
      key: `${utilityKey}_market`,
      label,
      defaultWidth: 120,
      render: (row) => {
        const classification = classifyMarket(row, utilityKey);
        if (!classification) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>-</span>;
        const isRegulated = classification === 'Regulated';
        // Deregulated = green (opportunity), Regulated = orange.
        const color = isRegulated
          ? { bg: '#FFEDD5', border: '#FDBA74', text: '#9A3412' }
          : { bg: '#DCFCE7', border: '#86EFAC', text: '#166534' };
        const ruleHint = isRegulated
          ? 'Single-utility market: no supplier choice, so no sourcing motion.'
          : 'Competitive retail market: customers can choose a supplier.';
        return (
          <span
            title={`${label}: ${classification}. ${ruleHint} ${marketBasis(row, utilityKey)}`}
            style={{ background: color.bg, border: `1px solid ${color.border}`, color: color.text, padding: '1px 8px', borderRadius: 999, fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap' }}
          >{classification}</span>
        );
      },
      exportValue: (row) => classifyMarket(row, utilityKey) || '',
    });
    const makeGacOpportunityCol = () => ({
      key: 'gac_opportunity',
      label: 'GAC Opportunity (Ontario)',
      defaultWidth: 200,
      render: (row) => {
        const flag = gacOpportunity(row.__state__, row.__kwh__);
        if (!flag) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>-</span>;
        const colorByTier = {
          high: { bg: '#DCFCE7', border: '#86EFAC', text: '#166534' },
          mid:  { bg: '#FEF3C7', border: '#FCD34D', text: '#92400E' },
          low:  { bg: '#E2E8F0', border: '#CBD5E1', text: '#334155' },
        };
        const c = colorByTier[flag.tier];
        const tip = 'Ontario customers pay the Global Adjustment (GA). Class A (peak demand ≥ 1 MW, or ≥ 500 kW for select industries) can reduce GA by curtailing during the IESO\'s top-5 system-peak hours (ICI). Class B pays a flat per-kWh GA rate. Annual kWh is a coarse proxy for the peak-demand threshold: confirm with metered demand.';
        return (
          <span
            title={tip}
            style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.text, padding: '1px 8px', borderRadius: 999, fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap' }}
          >{flag.label}</span>
        );
      },
      exportValue: (row) => gacOpportunity(row.__state__, row.__kwh__)?.label || '',
    });
    const makeStateCol = () => ({
      key: 'lookup_state',
      label: 'State',
      defaultWidth: 80,
      render: (row) => row.__state__
        ? <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text)' }}>{row.__state__}</span>
        : <span style={{ color: 'var(--color-text-muted)', fontSize: '0.72rem' }}>-</span>,
      exportValue: (row) => row.__state__ || '',
    });
    const makeRateCol = (commodity, label) => ({
      key: `${commodity}_rate`,
      label,
      defaultWidth: 110,
      render: (row) => {
        const val = row[`__${commodity}Rate__`];
        if (val == null) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>-</span>;
        const source = row[`__${commodity}RateSource__`];
        const segLabel = row.__segment__ === 'industrial' ? 'industrial' : 'commercial';
        const tip = source === 'country'
          ? `${row.__rateCountry__ || 'country'} indicative commercial rate. Drops in when no state rate resolves and no actual cost was provided. Indicative only: not a tariff rate.`
          : `${row.__state__ || 'unknown state'} ${segLabel} average. Indicative only: not a tariff rate.`;
        return (
          <span
            title={tip}
            style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
          >{formatRate(val, commodity)}</span>
        );
      },
      exportValue: (row) => {
        const val = row[`__${commodity}Rate__`];
        return val == null ? '' : Number(val);
      },
    });
    const makeCostCol = (key, label, color) => ({
      key,
      label,
      defaultWidth: 120,
      render: (row) => {
        const val = row[`__${key}__`];
        if (val == null) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>-</span>;
        const text = formatMoney(val);
        let title = label;
        const fromActual = (key === 'electricCost' && row.__electricCostActual__ != null)
          || (key === 'gasCost' && row.__gasCostActual__ != null);
        if (fromActual) {
          title = `Actual cost from your file. Estimate would be ${
            key === 'electricCost'
              ? formatMoney(row.__electricCostEstimated__ || 0)
              : formatMoney(row.__gasCostEstimated__ || 0)
          }.`;
        } else if (key === 'electricCost' && row.__kwh__ != null) {
          title = `Estimated: ${row.__kwh__.toLocaleString()} kWh × ${formatRate(row.__electricRate__, 'electric')}${row.__kwhSource__ ? ` · from "${row.__kwhSource__}"` : ''}`;
        } else if (key === 'gasCost' && row.__therms__ != null) {
          title = `Estimated: ${Math.round(row.__therms__).toLocaleString()} therms × ${formatRate(row.__gasRate__, 'gas')}${row.__thermsSource__ ? ` · from "${row.__thermsSource__}"` : ''}`;
        } else if (key === 'totalCost') {
          const parts = [];
          if (row.__electricCost__ != null) parts.push(`Electric ${formatMoney(row.__electricCost__)}`);
          if (row.__gasCost__ != null) parts.push(`Gas ${formatMoney(row.__gasCost__)}`);
          if (parts.length) title = parts.join(' + ');
        }
        return (
          <span
            title={title}
            style={{ background: color.bg, border: `1px solid ${color.border}`, color: color.text, padding: '1px 8px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', whiteSpace: 'nowrap' }}
          >{text}</span>
        );
      },
      exportValue: (row) => {
        const val = row[`__${key}__`];
        return val == null ? '' : Math.round(Number(val) * 100) / 100;
      },
    });
    // Pull the parsed annual consumption straight off the row. kWh
    // is stored natively; Dth = therms ÷ 10. Tooltip shows the
    // source column header so the user can verify which sheet
    // column drove the value.
    const makeConsumptionCol = (commodity) => {
      const isElectric = commodity === 'electric';
      const label = isElectric ? 'Annual Electric (kWh)' : 'Annual Gas (Dth)';
      return {
        key: `${commodity}_consumption`,
        label,
        defaultWidth: 140,
        render: (row) => {
          const raw = isElectric ? row.__kwh__ : row.__therms__;
          if (raw == null) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>-</span>;
          const val = isElectric ? raw : raw / 10; // therms → Dth
          const fromEstimate = isElectric ? row.__kwhFromEstimate__ : row.__thermsFromEstimate__;
          const sourceHeader = isElectric ? row.__kwhSource__ : row.__thermsSource__;
          // Italicized + muted when the value came from the property-
          // type reference rather than the uploaded data, so the user
          // can tell modeled rows from measured ones at a glance.
          const tip = fromEstimate
            ? `Estimated from Property Type "${row.__propertyType__}": no actual ${isElectric ? 'electric' : 'gas'} consumption in the upload`
            : (sourceHeader ? `From "${sourceHeader}" column` : `${isElectric ? 'kWh' : 'Dth'} pulled from the uploaded sites file`);
          return (
            <span
              title={tip}
              style={{ fontSize: '0.72rem', color: fromEstimate ? '#94A3B8' : 'var(--color-text-secondary)', fontStyle: fromEstimate ? 'italic' : 'normal', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
            >{Math.round(val).toLocaleString()}{fromEstimate ? ' (est)' : ''}</span>
          );
        },
        exportValue: (row) => {
          const raw = isElectric ? row.__kwh__ : row.__therms__;
          if (raw == null) return '';
          return isElectric ? Math.round(raw) : Math.round(raw / 10);
        },
      };
    };
    // Existing supplier (competitive retailer). The source supplier
    // cell can list multiple vendors comma-separated, so each one is
    // tokenized and rendered as its own pill. A token whose fuzzy
    // match is still pending shows ✓ / ✗ inline; once the user picks
    // one (or undoes), the choice persists per-token via localStorage.
    const renderSupplierToken = (token, idx) => {
      const { raw, kind, canonical, score, decision, isFuzzy } = token;
      const pillStyle = { background: '#F5F3FF', border: '1px solid #C4B5FD', color: '#5B21B6', padding: '1px 8px', borderRadius: 999, fontSize: '0.7rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 };
      // Fuzzy supplier match awaiting a decision — show suggestion +
      // score + ✓/✗ + the raw source string for context.
      if (kind === 'supplier' && isFuzzy && !decision) {
        return (
          <span key={idx} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            <span title={`Suggested canonical name from the bundled supplier list. Was: "${raw}". Click ✓ to accept, ✗ to keep the original.`} style={pillStyle}>{String(canonical)}</span>
            <span style={{ color: '#94A3B8', fontSize: '0.62rem', fontWeight: 600 }}>{score}%</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setVendorDecision(raw, 'accepted'); }}
              title={`Accept "${canonical}" as the canonical supplier for "${raw}"`}
              style={{ border: '1px solid #16A34A', background: '#fff', color: '#16A34A', borderRadius: 4, fontSize: '0.65rem', cursor: 'pointer', fontFamily: 'inherit', padding: '0 4px', lineHeight: 1.4 }}
            >✓</button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setVendorDecision(raw, 'rejected'); }}
              title={`Keep the original "${raw}" instead of "${canonical}"`}
              style={{ border: '1px solid #DC2626', background: '#fff', color: '#DC2626', borderRadius: 4, fontSize: '0.65rem', cursor: 'pointer', fontFamily: 'inherit', padding: '0 4px', lineHeight: 1.4 }}
            >✗</button>
            <span title={`Source vendor string: "${raw}"`} style={{ color: '#94A3B8', fontSize: '0.62rem', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%', flexBasis: '100%' }}>← {raw}</span>
          </span>
        );
      }
      // Accepted fuzzy match — show canonical + ✓ score + undo.
      // (Rejected tokens are filtered out of the row's token list
      // upstream, so the cell hides them entirely.)
      if (kind === 'supplier' && isFuzzy && decision === 'accepted') {
        return (
          <span key={idx} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span title={`Accepted canonical "${canonical}" (was: "${raw}", fuzzy score ${score}/100). Click ↺ to undo.`} style={pillStyle}>{String(canonical)}</span>
            <span style={{ color: '#16A34A', fontSize: '0.62rem', fontWeight: 700 }}>{`✓${score}%`}</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setVendorDecision(raw, null); }}
              title="Undo decision"
              style={{ border: '1px solid #CBD5E1', background: '#fff', color: '#64748B', borderRadius: 4, fontSize: '0.65rem', cursor: 'pointer', fontFamily: 'inherit', padding: '0 4px', lineHeight: 1.4 }}
            >↺</button>
          </span>
        );
      }
      // Plain pill — exact-match supplier or unknown vendor.
      const tip = kind === 'supplier'
        ? `Supplier: ${canonical || raw} · matched against the bundled supplier list${score ? ` (fuzzy score ${score}/100)` : ''}`
        : `Supplier: ${raw} (not matched to a known utility or supplier: treated as a competitive retailer)`;
      return (
        <span key={idx} title={tip} style={pillStyle}>{String(canonical || raw)}</span>
      );
    };
    const makeSupplierCol = (commodity, label) => ({
      key: `${commodity}_supplier`,
      label,
      defaultWidth: 220,
      render: (row) => {
        const overrideKey = `${row.id}_${commodity}`;
        const override = supplierOverrides[overrideKey];
        const isEditing = editingSupplier === overrideKey;
        const tokens = commodity === 'electric' ? row.__electricSupplierTokens__ : row.__gasSupplierTokens__;
        const tokenString = tokens && tokens.length
          ? tokens.map(t => t.kind === 'supplier' && t.decision !== 'rejected' && t.canonical ? t.canonical : t.raw).join(', ')
          : '';
        if (isEditing) {
          return (
            <SupplierAutocomplete
              initialValue={override ?? tokenString}
              onCommit={(v) => { setSupplierOverride(row.id, commodity, v); setEditingSupplier(null); }}
              onCancel={() => setEditingSupplier(null)}
            />
          );
        }
        const editButton = (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setEditingSupplier(overrideKey); }}
            title={`Search the bundled supplier list and pick a ${commodity === 'electric' ? 'electric' : 'gas'} supplier for this site`}
            style={{ border: '1px dashed #94A3B8', background: '#fff', color: '#475569', borderRadius: 4, fontSize: '0.62rem', cursor: 'pointer', fontFamily: 'inherit', padding: '0 5px', lineHeight: 1.5, flexShrink: 0 }}
          >✎</button>
        );
        if (override) {
          return (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: '100%' }}>
              <span
                onClick={() => setEditingSupplier(overrideKey)}
                title={`Manually set to "${override}". Click to edit.`}
                style={{ background: '#DBEAFE', border: '1px solid #93C5FD', color: '#1E3A8A', padding: '1px 8px', borderRadius: 999, fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}
              >{override}</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setSupplierOverride(row.id, commodity, ''); }}
                title="Clear manual override (revert to source-data tokens)"
                style={{ border: '1px solid #CBD5E1', background: '#fff', color: '#64748B', borderRadius: 4, fontSize: '0.65rem', cursor: 'pointer', fontFamily: 'inherit', padding: '0 4px', lineHeight: 1.4 }}
              >×</button>
            </span>
          );
        }
        if (!tokens || !tokens.length) {
          return (
            <span
              onClick={() => setEditingSupplier(overrideKey)}
              title="Click to type / pick a supplier"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--color-text-muted)', fontSize: '0.7rem', cursor: 'pointer' }}
            >- {editButton}</span>
          );
        }
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', maxWidth: '100%' }}>
            {tokens.map((t, i) => renderSupplierToken(t, i))}
            {editButton}
          </span>
        );
      },
      exportValue: (row) => {
        const override = supplierOverrides[`${row.id}_${commodity}`];
        if (override) return override;
        return (commodity === 'electric' ? row.__electricSupplier__ : row.__gasSupplier__) || '';
      },
    });
    const makeDateCol = (key, label, color) => ({
      key,
      label,
      defaultWidth: 120,
      render: (row) => {
        const val = row[`__${key}__`];
        if (val == null || val === '') return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>-</span>;
        return (
          <span style={{ fontSize: '0.72rem', color, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{fmtShortDate(val)}</span>
        );
      },
      exportValue: (row) => fmtShortDate(row[`__${key}__`]),
    });
    return [
      ...base,
      companyNameCol,
      divisionCol,
      makeStateCol(),
      isoCol,
      makeUtilityCol('electric', 'Electric Utility', { bg: '#FEF3C7', border: '#FCD34D', text: '#92400E' }),
      makeSupplierCol('electric', 'Electric Supplier'),
      makeMarketCol('electric', 'Electric Market'),
      makeConsumptionCol('electric'),
      makeRateCol('electric', 'Electric Rate'),
      makeCostCol('electricCost', 'Total Electric Cost', { bg: '#FEF3C7', border: '#FCD34D', text: '#92400E' }),
      makeDateCol('electricStart', 'Electric Contract Start', '#92400E'),
      makeDateCol('electricEnd', 'Electric Contract End', '#92400E'),
      makeGacOpportunityCol(),
      makeUtilityCol('gas', 'Gas Utility', { bg: '#DBEAFE', border: '#93C5FD', text: '#1E3A8A' }),
      makeSupplierCol('gas', 'Gas Supplier'),
      makeMarketCol('gas', 'Gas Market'),
      makeConsumptionCol('gas'),
      makeRateCol('gas', 'Gas Rate'),
      makeCostCol('gasCost', 'Total Natural Gas Cost', { bg: '#DBEAFE', border: '#93C5FD', text: '#1E3A8A' }),
      makeDateCol('gasStart', 'Gas Contract Start', '#1E3A8A'),
      makeDateCol('gasEnd', 'Gas Contract End', '#1E3A8A'),
      makeCostCol('totalCost', 'Total Est. Cost', { bg: '#EDE9FE', border: '#C4B5FD', text: '#5B21B6' }),
      makeUtilityCol('water', 'Water Utility', { bg: '#DCFCE7', border: '#86EFAC', text: '#166534' }),
      makeLocationCol('city', 'Lookup City'),
      makeLocationCol('country', 'Lookup Country'),
      propertyTypeCol,
      segmentCol,
      ownershipCol,
      siteDescriptionCol,
      propertySizeCol,
      // Property-type-based estimates — always show the reference
      // figure regardless of whether the upload also carried actual
      // values, so the user can spot under- / over-reported sites by
      // comparing the actual columns against these.
      ...(() => {
        const muted = { color: 'var(--color-text-muted)', fontSize: '0.7rem' };
        const dash = <span style={muted}>-</span>;
        const fmtInt = (n) => Math.round(n).toLocaleString();
        const estCol = (key, label, get, exportGet) => ({
          key, label, defaultWidth: 140,
          render: (row) => {
            const canonical = row.__propertyType__;
            if (!canonical) return dash;
            const est = estimateConsumption(canonical, row.__propertySizeFt2__);
            if (!est) return dash;
            const v = get(row, est);
            if (v == null || !Number.isFinite(v)) return dash;
            return <span style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono, ui-monospace, monospace)' }}>{fmtInt(v)}</span>;
          },
          exportValue: (row) => {
            const canonical = row.__propertyType__;
            if (!canonical) return '';
            const est = estimateConsumption(canonical, row.__propertySizeFt2__);
            if (!est) return '';
            return exportGet ? exportGet(row, est) : (get(row, est) ?? '');
          },
        });
        return [
          estCol('estElectricKwh', 'Est. Electric (kWh)', (_r, est) => est.electricKwh),
          estCol('estElectricCost', 'Est. Electric Cost', (r, est) => {
            const rate = r.__electricRate__;
            return rate != null ? rate * est.electricKwh : null;
          }),
          estCol('estGasDth', 'Est. Gas (Dth)', (_r, est) => est.gasDth),
          estCol('estGasCost', 'Est. Gas Cost', (r, est) => {
            const rate = r.__gasRate__;
            // gas rate is per-therm; one Dth = 10 therms.
            return rate != null ? rate * est.gasDth * 10 : null;
          }),
          {
            key: 'estAccounts',
            label: 'Est. Accounts',
            defaultWidth: 210,
            // A data deal is priced per utility account per month, so the
            // number of accounts is the figure being read off this column —
            // the per-commodity labels are the working behind it. The total
            // leads, the breakdown follows it.
            render: (row) => {
              const canonical = row.__propertyType__;
              if (!canonical) return dash;
              const acc = propertyTypeAccounts(canonical);
              if (!acc) return dash;
              const total = propertyTypeAccountTotal(canonical);
              const text = accountBreakdownText(acc);
              return (
                <span
                  style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)' }}
                  title={`${fmtAccounts(total)} utility account${total === 1 ? '' : 's'} (bills) estimated for a ${canonical} site${text ? `: ${text}` : ''}`}
                >
                  <strong style={{ color: 'var(--color-text)', fontFamily: 'var(--font-mono, ui-monospace, monospace)' }}>{fmtAccounts(total)}</strong>
                  {text ? <span style={{ fontSize: '0.66rem' }}> {text}</span> : null}
                </span>
              );
            },
            // The number, not the labels: an exported column of
            // "Elec 1 · Gas 1 · …" is the one thing a reader can't add up,
            // and the labels are on the export's Property Type Estimates tab.
            exportValue: (row) => {
              const canonical = row.__propertyType__;
              if (!canonical) return '';
              const total = propertyTypeAccountTotal(canonical);
              return total == null ? '' : total;
            },
            getSortValue: (row) => propertyTypeAccountTotal(row.__propertyType__) ?? -1,
          },
        ];
      })(),
    ];
  }, [sitesData, zipColumn, utility, supplierOverrides, editingSupplier, electricStartOverride, electricEndOverride, gasStartOverride, gasEndOverride]);

  const alwaysVisible = useMemo(() => {
    if (!columns.length) return [];
    return [
      // Not hideable while Mass Edit is on: the Columns menu would
      // otherwise offer to remove the only way to pick a row, from a
      // mode whose entire job is picking rows.
      '__select__',
      columns[0].key,
      'propertyType',
      'segment',
      'ownership',
      'siteDescription',
      'propertySize',
      'electric', 'electric_market', 'electric_rate', 'electricCost',
      'gas', 'gas_market', 'gas_rate', 'gasCost',
      'totalCost',
      'water',
    ];
  }, [columns]);

  // Keyed off the data columns alone. The selection column is a mode,
  // not a shape: folding it in here would hand Mass Edit its own table
  // id, and the widths / visibility / renames the user arranged would
  // vanish the moment they turned the mode on.
  // Stable — see the note on DealsView's tableId.
  const tableId = 'sites-list';

  // The columns as rendered: the data columns, plus a checkbox column
  // while Mass Edit is on. Appended rather than prepended — DataTable
  // pins a `__select__` column to the far left itself, and leaving
  // `columns[0]` as the site name keeps it the sticky one. Sticky here
  // too, so the frozen block is the checkbox AND the name: pinning only
  // the name would let it scroll over the boxes it belongs to.
  const tableColumns = useMemo(() => {
    if (!massEditOn || !columns.length) return columns;
    return [...columns, {
      key: '__select__',
      label: '',
      defaultWidth: 34,
      sticky: true,
      render: (row) => (
        <input
          type="checkbox"
          checked={selectedSiteIds.has(row.id)}
          onChange={(e) => {
            e.stopPropagation();
            setSelectedSiteIds(prev => {
              const next = new Set(prev);
              if (next.has(row.id)) next.delete(row.id); else next.add(row.id);
              return next;
            });
          }}
          onClick={(e) => e.stopPropagation()}
          style={{ cursor: 'pointer', accentColor: 'var(--color-accent)' }}
          aria-label="Select this site for the column edit"
        />
      ),
      // Never a column of the export: it's this session's selection, not
      // anything about the site.
      exportValue: () => '',
    }];
  }, [columns, massEditOn, selectedSiteIds]);

  // Actual vs estimated split across the portfolio for the on-page
  // summary panel. Actual = value came from a column in the source
  // file (consumption, cost, or supplier name). Estimated = value was
  // derived (property-type consumption × rate, or zip-based utility
  // lookup with no supplier name to back it up).
  const analysisSummary = useMemo(() => {
    if (!rows.length) return null;
    let elecActualKwh = 0, elecActualKwhSites = 0;
    let elecEstKwh = 0, elecEstKwhSites = 0;
    let gasActualTherms = 0, gasActualThermsSites = 0;
    let gasEstTherms = 0, gasEstThermsSites = 0;
    let elecActualCost = 0, elecActualCostSites = 0;
    let elecEstCost = 0, elecEstCostSites = 0;
    let gasActualCost = 0, gasActualCostSites = 0;
    let gasEstCost = 0, gasEstCostSites = 0;
    // "Missing" = the site landed in neither the actual nor the
    // estimated bucket, i.e. we have no consumption / cost figure for
    // it at all. Tracked per commodity so the summary card can flag
    // the data gap in red.
    let elecMissingKwhSites = 0, gasMissingThermsSites = 0;
    let elecMissingCostSites = 0, gasMissingCostSites = 0;
    let elecFromSupplier = 0, elecFromZip = 0, elecUnknown = 0;
    let gasFromSupplier = 0, gasFromZip = 0, gasUnknown = 0;
    for (const r of rows) {
      // __kwhFromEstimate__ / __thermsFromEstimate__ are BOOLEAN
      // flags ("did this value come from the property-type estimate
      // fallback?"), not numbers. The kWh / therms total lives on
      // __kwh__ / __therms__ regardless of provenance — pick the
      // right bucket via the source / estimate flag, then accumulate
      // the actual number from __kwh__ / __therms__.
      if (r.__kwhSource__ && typeof r.__kwh__ === 'number' && Number.isFinite(r.__kwh__)) {
        elecActualKwh += r.__kwh__; elecActualKwhSites++;
      } else if (r.__kwhFromEstimate__ && typeof r.__kwh__ === 'number' && Number.isFinite(r.__kwh__)) {
        elecEstKwh += r.__kwh__; elecEstKwhSites++;
      } else {
        elecMissingKwhSites++;
      }
      if (r.__thermsSource__ && typeof r.__therms__ === 'number' && Number.isFinite(r.__therms__)) {
        gasActualTherms += r.__therms__; gasActualThermsSites++;
      } else if (r.__thermsFromEstimate__ && typeof r.__therms__ === 'number' && Number.isFinite(r.__therms__)) {
        gasEstTherms += r.__therms__; gasEstThermsSites++;
      } else {
        gasMissingThermsSites++;
      }
      if (typeof r.__electricCostActual__ === 'number' && Number.isFinite(r.__electricCostActual__)) {
        elecActualCost += r.__electricCostActual__; elecActualCostSites++;
      } else if (typeof r.__electricCostEstimated__ === 'number' && Number.isFinite(r.__electricCostEstimated__)) {
        elecEstCost += r.__electricCostEstimated__; elecEstCostSites++;
      } else {
        elecMissingCostSites++;
      }
      if (typeof r.__gasCostActual__ === 'number' && Number.isFinite(r.__gasCostActual__)) {
        gasActualCost += r.__gasCostActual__; gasActualCostSites++;
      } else if (typeof r.__gasCostEstimated__ === 'number' && Number.isFinite(r.__gasCostEstimated__)) {
        gasEstCost += r.__gasCostEstimated__; gasEstCostSites++;
      } else {
        gasMissingCostSites++;
      }
      // Utility company provenance — vendor-match wins (the source
      // file named a supplier that resolved to a utility); else zip-
      // based rates lookup; else nothing.
      if (r.__electricVendorMatchKind__ === 'utility') elecFromSupplier++;
      else if (r.__electric__) elecFromZip++;
      else elecUnknown++;
      if (r.__gasVendorMatchKind__ === 'utility') gasFromSupplier++;
      else if (r.__gas__) gasFromZip++;
      else gasUnknown++;
    }
    return {
      total: rows.length,
      consumption: {
        electric: { actual: elecActualKwh, actualSites: elecActualKwhSites, est: elecEstKwh, estSites: elecEstKwhSites, missingSites: elecMissingKwhSites },
        gas:      { actual: gasActualTherms, actualSites: gasActualThermsSites, est: gasEstTherms, estSites: gasEstThermsSites, missingSites: gasMissingThermsSites },
      },
      cost: {
        electric: { actual: elecActualCost, actualSites: elecActualCostSites, est: elecEstCost, estSites: elecEstCostSites, missingSites: elecMissingCostSites },
        gas:      { actual: gasActualCost, actualSites: gasActualCostSites, est: gasEstCost, estSites: gasEstCostSites, missingSites: gasMissingCostSites },
      },
      utility: {
        electric: { fromSupplier: elecFromSupplier, fromZip: elecFromZip, unknown: elecUnknown },
        gas:      { fromSupplier: gasFromSupplier, fromZip: gasFromZip, unknown: gasUnknown },
      },
    };
  }, [rows]);

  const matchStats = useMemo(() => {
    if (!utility?.zipMap || !rows.length) return null;
    let matched = 0;
    let electricCost = 0;
    let gasCost = 0;
    let costedSites = 0;
    // Dedup supplier suggestions by raw vendor string — a single
    // accept/reject decision applies to every row using that vendor,
    // so counting per-row would overstate the work remaining.
    const suggestedSeen = new Set();
    let suggestedDecided = 0;
    for (const r of rows) {
      if (r.__matched__) matched++;
      if (r.__electricCost__ != null) electricCost += r.__electricCost__;
      if (r.__gasCost__ != null) gasCost += r.__gasCost__;
      if (r.__totalCost__ != null) costedSites++;
      for (const t of (r.__supplierSuggestions__ || [])) {
        const key = String(t.raw || '').toLowerCase().trim();
        if (!key || suggestedSeen.has(key)) continue;
        suggestedSeen.add(key);
        if (t.decision === 'accepted' || t.decision === 'rejected') suggestedDecided++;
      }
    }
    return {
      matched,
      total: rows.length,
      electricCost,
      gasCost,
      totalCost: electricCost + gasCost,
      costedSites,
      suggestedTotal: suggestedSeen.size,
      suggestedDecided,
      suggestedPct: suggestedSeen.size ? Math.round((suggestedDecided / suggestedSeen.size) * 100) : 0,
    };
  }, [rows, utility]);

  // Lightweight projection of each site's matched electric/gas utility,
  // handed to the nested Utility Mapping view so it can roll the
  // portfolio up by utility without re-running the whole rows pipeline.
  const siteUtilities = useMemo(() => rows.map(r => ({
    siteName: siteNameColumn ? String(r[siteNameColumn] || '').trim() : '',
    state: r.__state__ || '',
    electricUtility: r.__electric__ || '',
    gasUtility: r.__gas__ || '',
  })), [rows, siteNameColumn]);

  const utilMeta = utility?.meta || null;
  const zipFbMeta = zipFallback?.meta || null;

  // Virginia's retail-choice program is gated on individual-site load:
  // only sites consuming more than 45,000 MWh/yr (5 MW × 8,760 hr) can
  // leave the regulated tariff. We don't want VA showing up as a
  // deregulated market just because the portfolio has small VA sites —
  // it would advertise a savings motion that's not actually available.
  // So VA is conditionally included in the deregulation map: it lands
  // in the table only when at least one VA site in the uploaded data
  // clears the 45,000 MWh/yr threshold. The site-level Flags column on
  // the export still surfaces the gating alert.
  const VA_HEAVY_LOAD_KWH = 45_000 * 1_000;
  const vaHasQualifyingSite = rows.some((r) => {
    if (r.__state__ !== 'VA') return false;
    const kwh = r.__kwh__;
    return typeof kwh === 'number' && Number.isFinite(kwh) && kwh > VA_HEAVY_LOAD_KWH;
  });

  // Per-commodity savings % used for the overview. Applied to
  // deregulated spend only — the user can adjust the numbers later if
  // their bid-based estimates diverge.
  // Electric deregulation status per state / province, with the
  // corresponding indicative savings range. Anything not listed here
  // is treated as a regulated market with zero savings — the user
  // explicitly asked that regulated markets show no savings.
  const ELECTRIC_DEREGULATION = {
    AB: { status: 'yes',     range: '0%',      lowPct: 0,    highPct: 0 },
    CT: { status: 'yes',     range: '2 - 4%',  lowPct: 0.02, highPct: 0.04 },
    DC: { status: 'yes',     range: '2 - 4%',  lowPct: 0.02, highPct: 0.04 },
    DE: { status: 'yes',     range: '2 - 4%',  lowPct: 0.02, highPct: 0.04 },
    IL: { status: 'yes',     range: '2 - 4%',  lowPct: 0.02, highPct: 0.04 },
    MA: { status: 'yes',     range: '2 - 4%',  lowPct: 0.02, highPct: 0.04 },
    MD: { status: 'yes',     range: '2 - 4%',  lowPct: 0.02, highPct: 0.04 },
    ME: { status: 'yes',     range: '2 - 4%',  lowPct: 0.02, highPct: 0.04 },
    NH: { status: 'yes',     range: '2 - 4%',  lowPct: 0.02, highPct: 0.04 },
    NJ: { status: 'yes',     range: '2 - 4%',  lowPct: 0.02, highPct: 0.04 },
    NY: { status: 'yes',     range: '0%',      lowPct: 0,    highPct: 0 },
    OH: { status: 'yes',     range: '2 - 4%',  lowPct: 0.02, highPct: 0.04 },
    ON: { status: 'yes',     range: '0%',      lowPct: 0,    highPct: 0 },
    OR: { status: 'yes',     range: '2 - 4%',  lowPct: 0.02, highPct: 0.04 },
    PA: { status: 'yes',     range: '2 - 4%',  lowPct: 0.02, highPct: 0.04 },
    RI: { status: 'yes',     range: '2 - 4%',  lowPct: 0.02, highPct: 0.04 },
    TX: { status: 'yes',     range: '1 - 2%',  lowPct: 0.01, highPct: 0.02 },
    // Limited-deregulation markets — the underlying retail-choice
    // programs are narrow enough (Direct Access only in CA, opt-in
    // pilots in MI, prior-3rd-party gating in AZ) that the standard
    // 2-4 % commodity savings doesn't apply. Surfaced as 0 - 0 % so
    // the Indicative Savings tab still lists them (Status stays
    // "Limited" so they aren't filtered out as regulated) but every
    // savings column resolves to $0. WA is intentionally absent —
    // its retail-choice pilot was small enough that the seller no
    // longer wants WA sites surfaced as deregulated at all, so it
    // falls through to the regulated bucket. VA is handled separately
    // below — it's only included when at least one site clears the
    // 45,000 MWh/yr large-load threshold.
    AZ: { status: 'Limited', range: '0 - 0%', lowPct: 0, highPct: 0 },
    CA: { status: 'Limited', range: '0 - 0%', lowPct: 0, highPct: 0 },
    MI: { status: 'Limited', range: '0 - 0%', lowPct: 0, highPct: 0 },
    ...(vaHasQualifyingSite
      ? { VA: { status: 'Limited', range: '0 - 0%', lowPct: 0, highPct: 0 } }
      : {}),
  };
  // Flat savings range applied to any deregulated natural-gas site.
  const GAS_SAVINGS = { range: '2 - 4%', lowPct: 0.02, highPct: 0.04 };
  // Per-state natural-gas deregulation status + savings range. States
  // marked "Large load only" mean retail choice is restricted to
  // industrial / large-volume customers, so the standard 2-4 %
  // doesn't apply — they carry a 0 - 0 % savings range so the row
  // still surfaces on the Indicative Savings tab (status keeps it
  // out of the regulated-hide filter) but every savings column
  // resolves to $0. Anything not in this map falls through to
  // status 'no'.
  //
  // US coverage is a closed list, corrected against the seller's own
  // read of the gas markets: AL, ID, MS, MT, ND and SD are the only
  // large-load-only states, Vermont is the only regulated one (so it is
  // the one US code deliberately absent below), and every other state
  // plus DC is fully competitive at 2 - 4 %. Canada is unchanged and is
  // NOT covered by that rule — AB, BC and MB stay large-load-only.
  //
  // Editing this map moves money: it sets the indicative gas savings
  // band for every site in the state. naMarkets.js mirrors the status
  // for display and has to be updated alongside it.
  const GAS_DEREGULATION = {
    AK: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    AR: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    AZ: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    CA: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    CO: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    CT: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    DC: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    DE: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    FL: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    GA: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    HI: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    IA: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    IL: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    IN: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    KS: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    KY: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    LA: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    MA: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    MD: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    ME: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    MI: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    MN: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    MO: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    NB: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    NC: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    NE: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    NH: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    NJ: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    NM: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    NV: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    NY: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    OH: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    OK: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    ON: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    OR: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    PA: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    QC: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    RI: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    SC: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    SK: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    TN: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    TX: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    UT: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    VA: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    WA: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    WI: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    WV: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    WY: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    // Large-load-only markets — retail choice is restricted to
    // industrial / large-volume customers.
    AB: { status: 'Large load only', range: '0 - 0%', lowPct: 0, highPct: 0 },
    AL: { status: 'Large load only', range: '0 - 0%', lowPct: 0, highPct: 0 },
    BC: { status: 'Large load only', range: '0 - 0%', lowPct: 0, highPct: 0 },
    ID: { status: 'Large load only', range: '0 - 0%', lowPct: 0, highPct: 0 },
    MB: { status: 'Large load only', range: '0 - 0%', lowPct: 0, highPct: 0 },
    MS: { status: 'Large load only', range: '0 - 0%', lowPct: 0, highPct: 0 },
    MT: { status: 'Large load only', range: '0 - 0%', lowPct: 0, highPct: 0 },
    ND: { status: 'Large load only', range: '0 - 0%', lowPct: 0, highPct: 0 },
    SD: { status: 'Large load only', range: '0 - 0%', lowPct: 0, highPct: 0 },
  };

  // Deregulation status → the tier the Overview tables and the map dots
  // bucket by.
  //
  // The two maps above spell partial deregulation differently:
  // ELECTRIC_DEREGULATION says 'Limited' (AZ, CA, MI, and VA once a site
  // clears the large-load threshold), GAS_DEREGULATION says 'Large load
  // only' (AB, AR, AZ, BC, IA, MB, MN, MO, MT, NC, NM, NV, OK, TN, WI,
  // WV, WY). Every caller used to test for a literal 'large', which
  // neither map has ever contained — so nothing could reach the 'some'
  // tier, "Some deregulation" read 0 on every portfolio ever exported,
  // and those markets were silently counted under "Regulated /
  // unlikely" instead. Matched case-insensitively, on both spellings,
  // so a relabel in either map can't quietly empty the row again.
  //
  // A state absent from its map stays regulated, which is the maps' own
  // stated rule — 'unknown' is reserved for rows with no US/CA state at
  // all and is assigned by the callers, not here.
  const deregStatusTier = (entry) => {
    const s = String(entry?.status ?? '').trim().toLowerCase();
    if (s === 'yes') return 'dereg';
    if (s === 'limited' || s.startsWith('large load')) return 'some';
    return 'reg';
  };
  // Display spelling of each tier, for the per-state status columns.
  const DEREG_TIER_LABEL = { dereg: 'Deregulated', some: 'Some deregulation', reg: 'Regulated' };

  // ST / Prov only applies to US and Canada sites. International uploads
  // sometimes carry a US-state-like code in the state column (e.g. a
  // France site tagged "GA"); that value is meaningless abroad, so we
  // ignore it and let those sites classify (and bucket) by country
  // instead. Returns the cleaned state code for US/CA sites, '' otherwise.
  function effectiveStateCode(r) {
    const rawCountry = String(r.__country__ || '').trim();
    if (!isUnitedStatesCountry(rawCountry) && !isCanadaCountry(rawCountry)) return '';
    return String(r.__state__ || '').trim();
  }

  // THE market classifier. Every surface that says whether a site sits in
  // a competitive market — the Market column and summary card on this
  // page, the Indicative Savings by State sheets, the Site Detail sheet,
  // the Electric / Gas Overview sheets — runs through this one function,
  // so the page and the exports can't report different deregulated-site
  // counts for the same portfolio.
  //
  // The rule, in order:
  //   * US / Canada — the curated ELECTRIC_DEREGULATION /
  //     GAS_DEREGULATION maps decide whether the STATE is a competitive
  //     market. Only inside such a state does the per-utility classifier
  //     decide which SITES count, dropping municipals / coops on a
  //     regulated tariff (CPS Energy, Austin Energy); a supplier on file
  //     also counts, since you can't hold a retail contract without a
  //     competitive market. A state absent from the maps is regulated and
  //     none of its sites count — the name-based classifier defaults an
  //     unrecognized utility (e.g. "Duke Energy Florida") to Deregulated,
  //     which would otherwise surface a regulated state as an opportunity.
  //   * International — the country reference decides, since the
  //     utility-name heuristics are keyed off US naming patterns.
  //   * Neither a US/CA state nor a recognized country — null (Unknown).
  //     These are exactly the rows the by-state export skips.
  //
  // Declared as a hoisted function so the Market column closure defined
  // above, the marketSummary memo below, and the export builders can all
  // share it. References the dereg maps above — only ever called during
  // render / export, well after they're initialized.
  function classifyMarket(row, commodity) {
    const state = effectiveStateCode(row);
    if (!state) {
      const country = normalizeCountryName(row.__country__ || '');
      if (!country) return null;
      const entry = commodity === 'electric'
        ? countryElectricSavings(country)
        : countryGasSavings(country);
      const status = entry?.status || 'No opportunity';
      return (status === 'Deregulated' || status === 'Some deregulation')
        ? 'Deregulated'
        : 'Regulated';
    }
    const map = commodity === 'electric' ? ELECTRIC_DEREGULATION : GAS_DEREGULATION;
    if (!map[state]) return 'Regulated';
    const provider = commodity === 'electric' ? row.__electric__ : row.__gas__;
    const supplier = commodity === 'electric' ? row.__electricSupplier__ : row.__gasSupplier__;
    if (supplier || classifyUtility(provider) === 'Deregulated') return 'Deregulated';
    // Competitive state, but nothing on file to say which side of it this
    // site sits on: no utility and no supplier. Unknown rather than
    // Regulated — the state says there's an opportunity here, we just
    // can't confirm it per site until a utility file is loaded.
    if (!provider) return null;
    return 'Regulated';
  }

  // Plain-English account of which clause above decided the row, for the
  // Market cell's tooltip. Kept next to the classifier so the two can't
  // drift into explaining different rules.
  function marketBasis(row, commodity) {
    const state = effectiveStateCode(row);
    if (!state) {
      const country = normalizeCountryName(row.__country__ || '');
      if (!country) return 'No US/CA state and no recognized country: market unknown.';
      return `Based on the country reference for ${country}.`;
    }
    const map = commodity === 'electric' ? ELECTRIC_DEREGULATION : GAS_DEREGULATION;
    if (!map[state]) return `${state} is a regulated market for this commodity.`;
    const provider = commodity === 'electric' ? row.__electric__ : row.__gas__;
    const supplier = commodity === 'electric' ? row.__electricSupplier__ : row.__gasSupplier__;
    if (supplier) return `${state} is a competitive market · supplier on file: ${supplier}`;
    if (provider) return `${state} is a competitive market · utility: ${provider}`;
    return `${state} is a competitive market, but this site has no utility or supplier on file to confirm it.`;
  }

  // Regulated / deregulated split for the on-page summary card. Lives
  // in its own memo (after the dereg maps) so it can use the classifier
  // above. Three buckets per commodity always sum to total, and the
  // deregulated bucket matches the exports' Deregulated Sites totals.
  const marketSummary = useMemo(() => {
    if (!rows.length) return null;
    const bucket = () => ({ deregulated: 0, regulated: 0, unknown: 0 });
    const electric = bucket(), gas = bucket();
    const tally = (acc, cls) => {
      if (cls === 'Deregulated') acc.deregulated++;
      else if (cls === 'Regulated') acc.regulated++;
      else acc.unknown++;
    };
    for (const r of rows) {
      tally(electric, classifyMarket(r, 'electric'));
      tally(gas, classifyMarket(r, 'gas'));
    }
    return { total: rows.length, electric, gas };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, utility]);

  // Detect a company column on the uploaded sites sheet so we can
  // group the overview by (company, state). Falls back to the sticky
  // first column when no company-like header exists.
  const siteCompanyColumn = useMemo(() => {
    if (!sitesData.length) return '';
    const headers = Object.keys(sitesData[0]);
    const match = headers.find(h => /company|portfolio|parent|owner|account/i.test(String(h)));
    return match || headers[0] || '';
  }, [sitesData]);

  // Build per-commodity overview rows grouped by (group, state), where
  // `groupOf(row)` names the group a site belongs to — the company for the
  // Electric / Gas Overview sheets and the Summary tab, the division for the
  // Master Analysis' Divisions tab. A group name of '' leaves the site out.
  // Each row summarizes sites, deregulated-only consumption/spend, and an
  // indicative savings range.
  //
  // One implementation for both so the same portfolio can't come out with
  // one savings number on the Summary tab and another on the Divisions tab:
  // the market classifier, the per-state deregulation tables and the savings
  // percentages are applied here and nowhere else.
  function buildMarketOverview(commodity, groupOf, groupKey = 'Company') {
    const consumptionKey = commodity === 'electric' ? '__kwh__' : '__therms__';
    const costKey = `__${commodity}Cost__`;
    const groups = new Map();
    for (const r of rows) {
      const company = String(groupOf(r) ?? '').trim();
      const state = r.__state__ || '';
      if (!company) continue;
      const key = `${company}||${state}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          company,
          state,
          totalSites: 0,
          deregulatedSites: 0,
          deregulatedConsumption: 0,
          deregulatedSpend: 0,
          // The slice of deregulatedSpend the savings range is applied
          // to: everything except the leased locations. Tracked apart
          // from deregulatedSpend so the spend column keeps reporting
          // the whole deregulated footprint while the savings columns
          // project on the part of it this portfolio can actually
          // contract for.
          savingsEligibleSpend: 0,
          leasedSites: 0,
        };
        groups.set(key, g);
      }
      g.totalSites++;
      const isLeased = isLeasedUtilityRow(r);
      if (isLeased) g.leasedSites++;
      // Whether a leased site is out of the savings basis is the toolbar
      // toggle's call; that it is leased is the upload's.
      const outOfSavingsScope = isLeased && !includeLeasedSavings;
      // Same classifier as the page's Market card and the Indicative
      // Savings by State sheets — this tab used to gate electric on the
      // state map but let gas through on the provider alone, so its
      // Deregulated Sites column disagreed with both.
      if (classifyMarket(r, commodity) !== 'Deregulated') continue;
      g.deregulatedSites++;
      const consumption = r[consumptionKey];
      if (typeof consumption === 'number' && Number.isFinite(consumption)) {
        g.deregulatedConsumption += consumption;
      }
      const cost = r[costKey];
      if (typeof cost === 'number' && Number.isFinite(cost)) {
        g.deregulatedSpend += cost;
        if (!outOfSavingsScope) g.savingsEligibleSpend += cost;
      }
    }

    const consumptionLabel = commodity === 'electric'
      ? 'Annual Deregulated Consumption kWh'
      : 'Annual Deregulated Consumption therms';
    const out = [];
    for (const g of groups.values()) {
      let status;
      let range;
      let lowPct;
      let highPct;
      if (commodity === 'electric') {
        const entry = ELECTRIC_DEREGULATION[g.state];
        status = entry?.status || 'no';
        range = entry?.range ?? '';
        lowPct = entry?.lowPct ?? null;
        highPct = entry?.highPct ?? null;
      } else {
        if (g.deregulatedSites > 0) {
          status = 'yes';
          range = GAS_SAVINGS.range;
          lowPct = GAS_SAVINGS.lowPct;
          highPct = GAS_SAVINGS.highPct;
        } else {
          status = 'no';
          range = '';
          lowPct = null;
          highPct = null;
        }
      }
      // Regulated markets get zero savings by construction — the
      // lowPct/highPct nulls resolve to blanks below. The range applies
      // to the savings-eligible spend, not the whole deregulated spend:
      // a leased location's supply contract isn't this portfolio's to
      // re-source, so nothing is projected on it. With nothing leased
      // the two figures are the same number.
      const low = (lowPct != null && g.savingsEligibleSpend > 0)
        ? Math.round(g.savingsEligibleSpend * lowPct * 100) / 100
        : (lowPct != null ? 0 : '');
      const high = (highPct != null && g.savingsEligibleSpend > 0)
        ? Math.round(g.savingsEligibleSpend * highPct * 100) / 100
        : (highPct != null ? 0 : '');
      out.push({
        [groupKey]: g.company,
        'ST/Prov': g.state,
        'Deregulated Status': status,
        'Total Sites': g.totalSites,
        'Deregulated Sites': g.deregulatedSites,
        [consumptionLabel]: Math.round(g.deregulatedConsumption),
        'Annual Deregulated Spend': Math.round(g.deregulatedSpend * 100) / 100,
        'Indicative Savings Range': range,
        'Indicative Savings Low': low,
        'Indicative Savings High': high,
      });
    }
    out.sort((a, b) => {
      if (a[groupKey] !== b[groupKey]) return a[groupKey].localeCompare(b[groupKey]);
      return a['ST/Prov'].localeCompare(b['ST/Prov']);
    });
    return out;
  }

  const overviewByCommodity = useMemo(() => {
    if (!utility?.zipMap || !rows.length || !siteCompanyColumn) {
      return { electric: [], gas: [] };
    }
    const groupOf = (r) => String(r[siteCompanyColumn] ?? '').trim();
    return {
      electric: buildMarketOverview('electric', groupOf),
      gas: buildMarketOverview('gas', groupOf),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, utility, siteCompanyColumn, includeLeasedSavings]);

  // Roll a pair of per-(group, state) overview lists up to one row per
  // group, combining both commodities across every state the group operates
  // in. State-level detail stays on the per-commodity overview tabs; this is
  // the executive roll-up — the Summary tab's company rows, and the
  // Divisions tab's division rows, off the same arithmetic.
  function rollupMarketOverview(electricRows, gasRows, groupKey = 'Company') {
    const byKey = new Map();
    const toNum = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : 0;
    function ensureRow(company) {
      if (!byKey.has(company)) {
        byKey.set(company, {
          [groupKey]: company,
          'Total Sites': 0,
          'States Covered': new Set(),
          'Electric Deregulated Sites': 0,
          'Electric Annual Spend': 0,
          'Electric Savings Low': 0,
          'Electric Savings High': 0,
          'Gas Deregulated Sites': 0,
          'Gas Annual Spend': 0,
          'Gas Savings Low': 0,
          'Gas Savings High': 0,
          'Total Annual Spend': 0,
          'Total Savings Low': 0,
          'Total Savings High': 0,
        });
      }
      return byKey.get(company);
    }
    // Track per-group total-site counts by state so we don't
    // double-count when a group appears in both the electric and
    // gas overviews for the same state.
    const siteTotalsByCompanyState = new Map();
    function recordSites(company, state, total) {
      const key = `${company}||${state}`;
      if (!siteTotalsByCompanyState.has(key)) {
        siteTotalsByCompanyState.set(key, toNum(total));
      }
    }
    for (const e of electricRows) {
      const row = ensureRow(e[groupKey]);
      row['States Covered'].add(e['ST/Prov'] || '-');
      row['Electric Deregulated Sites'] += toNum(e['Deregulated Sites']);
      row['Electric Annual Spend']      += toNum(e['Annual Deregulated Spend']);
      row['Electric Savings Low']       += toNum(e['Indicative Savings Low']);
      row['Electric Savings High']      += toNum(e['Indicative Savings High']);
      recordSites(e[groupKey], e['ST/Prov'] || '-', e['Total Sites']);
    }
    for (const g of gasRows) {
      const row = ensureRow(g[groupKey]);
      row['States Covered'].add(g['ST/Prov'] || '-');
      row['Gas Deregulated Sites'] += toNum(g['Deregulated Sites']);
      row['Gas Annual Spend']      += toNum(g['Annual Deregulated Spend']);
      row['Gas Savings Low']       += toNum(g['Indicative Savings Low']);
      row['Gas Savings High']      += toNum(g['Indicative Savings High']);
      recordSites(g[groupKey], g['ST/Prov'] || '-', g['Total Sites']);
    }
    // Fold per-(group, state) site totals back into each group's row.
    for (const [key, total] of siteTotalsByCompanyState.entries()) {
      const [company] = key.split('||');
      const row = byKey.get(company);
      if (row) row['Total Sites'] += total;
    }

    const out = [];
    for (const row of byKey.values()) {
      // Turn the States Covered set into a sorted count + list for
      // the exported cell (keeps the Summary self-describing).
      const states = [...row['States Covered']].sort();
      row['States Covered'] = states.length
        ? `${states.length} (${states.join(', ')})`
        : '';
      row['Electric Annual Spend'] = Math.round(row['Electric Annual Spend'] * 100) / 100;
      row['Electric Savings Low']  = Math.round(row['Electric Savings Low']  * 100) / 100;
      row['Electric Savings High'] = Math.round(row['Electric Savings High'] * 100) / 100;
      row['Gas Annual Spend']      = Math.round(row['Gas Annual Spend']      * 100) / 100;
      row['Gas Savings Low']       = Math.round(row['Gas Savings Low']       * 100) / 100;
      row['Gas Savings High']      = Math.round(row['Gas Savings High']      * 100) / 100;
      row['Total Annual Spend']    = Math.round((row['Electric Annual Spend'] + row['Gas Annual Spend']) * 100) / 100;
      row['Total Savings Low']     = Math.round((row['Electric Savings Low']  + row['Gas Savings Low'])  * 100) / 100;
      row['Total Savings High']    = Math.round((row['Electric Savings High'] + row['Gas Savings High']) * 100) / 100;
      out.push(row);
    }
    out.sort((a, b) => a[groupKey].localeCompare(b[groupKey]));
    return out;
  }

  const summaryRows = useMemo(
    () => rollupMarketOverview(overviewByCommodity.electric, overviewByCommodity.gas),
    [overviewByCommodity],
  );

  // The same procurement roll-up cut by division instead of by company, for
  // the Master Analysis' Divisions tab. Keyed by divisionLabel() so it joins
  // to the rest of that tab, and gated exactly as the company overview is —
  // without a utility rates file no site resolves a serving utility, and the
  // two views would otherwise disagree about how many sites are in a
  // competitive market.
  //
  // Sites with no division fall into their own bucket rather than being
  // dropped: they carry spend like any other, and a savings figure that
  // quietly excluded them wouldn't add up to the Summary tab's.
  const divisionSavings = useMemo(() => {
    if (!utility?.zipMap || !rows.length) return {};
    const groupOf = (r) => divisionLabel(r.__division__);
    const rolled = rollupMarketOverview(
      buildMarketOverview('electric', groupOf, 'Division'),
      buildMarketOverview('gas', groupOf, 'Division'),
      'Division',
    );
    const out = {};
    for (const row of rolled) {
      out[row.Division] = {
        electricDeregSites: row['Electric Deregulated Sites'],
        electricSpend: row['Electric Annual Spend'],
        electricLow: row['Electric Savings Low'],
        electricHigh: row['Electric Savings High'],
        gasDeregSites: row['Gas Deregulated Sites'],
        gasSpend: row['Gas Annual Spend'],
        gasLow: row['Gas Savings Low'],
        gasHigh: row['Gas Savings High'],
      };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, utility, includeLeasedSavings]);

  // Cell text for a contract price whose unit isn't the one the page reads
  // it in. Empty for a price that is (or that the file said nothing about),
  // so the column stays blank on a clean portfolio instead of repeating
  // "OK" down every row.
  function priceUomWarning(commodity, uom) {
    if (!uom || uom.canonical) return '';
    return `⚠ Quoted ${priceUomLabel(commodity, uom.unit)} but carried unconverted and read as ${priceUomLabel(commodity)}`;
  }

  // Same warning for a rolled-up group, which can be wrong two ways: its
  // sites disagreed about the unit (so the blended average is arithmetic
  // over incompatible numbers), or they agreed on a unit that isn't the one
  // the Price Unit column names.
  function priceUnitsWarning(commodity, units) {
    const seen = [...(units || [])].filter(Boolean);
    const canonical = priceUomLabel(String(commodity).toLowerCase());
    if (seen.length === 0) return '';
    if (seen.length > 1) {
      return `⚠ Blended across mixed price units (${seen.join(', ')}) — the average is not in any one of them`;
    }
    if (seen[0] === canonical) return '';
    return `⚠ Quoted ${seen[0]} but carried unconverted and read as ${canonical}`;
  }

  // Contract Overview — one row per (site, commodity) where there's
  // any contract data filled in (supplier, contract name, dates, or
  // contract price). Suppresses empty-shell rows so the sheet stays
  // readable when half the portfolio doesn't have contract info in
  // the source file yet.
  const contractOverviewRows = useMemo(() => {
    const out = [];
    const siteName = siteNameOverride || '';
    const hasAny = (...vals) => vals.some(v => v != null && String(v).trim() !== '');
    for (const r of rows) {
      const name = siteName ? r[siteName] : (r.__siteName__ || r.Site || r.SITE || r.Name || '');
      // Per-commodity row. Both electric and gas use the same column
      // names — the Commodity column distinguishes them, and Excel's
      // pivot table can group on it. Unit is implicit (kWh / therms)
      // and shown in the column-header rendered on export.
      if (hasAny(r.__electricSupplier__, r.__electricContractName__, r.__electricProductType__, r.__electricStart__, r.__electricEnd__, r.__electricContractPrice__)) {
        out.push({
          'Site': name,
          'State': r.__stateProvinceDisplay__ || '',
          'Country': r.__country__ || '',
          'Commodity': 'Electric',
          'Utility': r.__electric__ || '',
          'Supplier': r.__electricSupplier__ || '',
          'Contract Name': r.__electricContractName__ || '',
          'Product Type': r.__electricProductType__ || '',
          'Contract Start': r.__electricStart__ || '',
          'Contract End': r.__electricEnd__ || '',
          'Contract Price': r.__electricContractPrice__ ?? '',
          // The unit the SOURCE FILE quoted, not the one the page assumes.
          // The price is carried unconverted, so printing a flat $/kWh
          // against a figure the file said was per MWh states something
          // untrue about the number in the cell beside it.
          'Price Unit': r.__electricContractPrice__ != null ? priceUomLabel('electric', r.__electricPriceUom__?.unit) : '',
          'Price Unit Warning': priceUomWarning('electric', r.__electricPriceUom__),
          'Annual Consumption': r.__kwh__ ?? '',
          'Consumption Unit': r.__kwh__ != null ? 'kWh' : '',
          'Annual Cost': r.__electricCost__ ?? '',
        });
      }
      if (hasAny(r.__gasSupplier__, r.__gasContractName__, r.__gasProductType__, r.__gasStart__, r.__gasEnd__, r.__gasContractPrice__)) {
        out.push({
          'Site': name,
          'State': r.__stateProvinceDisplay__ || '',
          'Country': r.__country__ || '',
          'Commodity': 'Gas',
          'Utility': r.__gas__ || '',
          'Supplier': r.__gasSupplier__ || '',
          'Contract Name': r.__gasContractName__ || '',
          'Product Type': r.__gasProductType__ || '',
          'Contract Start': r.__gasStart__ || '',
          'Contract End': r.__gasEnd__ || '',
          'Contract Price': r.__gasContractPrice__ ?? '',
          'Price Unit': r.__gasContractPrice__ != null ? priceUomLabel('gas', r.__gasPriceUom__?.unit) : '',
          'Price Unit Warning': priceUomWarning('gas', r.__gasPriceUom__),
          'Annual Consumption': r.__therms__ ?? '',
          'Consumption Unit': r.__therms__ != null ? 'therms' : '',
          'Annual Cost': r.__gasCost__ ?? '',
        });
      }
    }
    return out;
  }, [rows, siteNameOverride]);

  // Contract Summary — one row per (Company, Commodity, Supplier,
  // Contract Name) rolled up across every site sharing that contract.
  // Powers the renewal pipeline: how big is each existing supply
  // contract, when does it expire, what's the blended price.
  const contractSummaryRows = useMemo(() => {
    if (!siteCompanyColumn) return [];
    const groups = new Map();
    const upsert = (commodity, supplier, contractName, productType, start, end, price, consumption, cost, consumptionUnit, priceUnit, company, priceUom) => {
      // Skip rows that have no contract signal at all — supplier,
      // contract name, dates, and price all empty means there's
      // nothing to summarize for this fuel at this site.
      if (!supplier && !contractName && !start && !end && price == null) return;
      const key = `${company}||${commodity}||${supplier || ''}||${contractName || ''}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          company, commodity, supplier: supplier || '', contractName: contractName || '',
          productType: productType || '',
          earliestStart: null, latestEnd: null,
          siteCount: 0, totalConsumption: 0, totalCost: 0,
          weightedPriceNum: 0, weightedPriceDenom: 0,
          consumptionUnit, priceUnit,
          // Every price unit that fed this group's blended average. More
          // than one and the average is arithmetic over incompatible
          // numbers — $4.50/Dth and $0.45/therm are the same price, and
          // averaging them yields neither.
          priceUnits: new Set(),
        };
        groups.set(key, g);
      }
      g.siteCount++;
      if (start) {
        const d = new Date(start);
        if (!isNaN(d) && (!g.earliestStart || d < g.earliestStart)) g.earliestStart = d;
      }
      if (end) {
        const d = new Date(end);
        if (!isNaN(d) && (!g.latestEnd || d > g.latestEnd)) g.latestEnd = d;
      }
      if (typeof consumption === 'number' && Number.isFinite(consumption)) g.totalConsumption += consumption;
      if (typeof cost === 'number' && Number.isFinite(cost)) g.totalCost += cost;
      if (typeof price === 'number' && Number.isFinite(price) && typeof consumption === 'number' && Number.isFinite(consumption) && consumption > 0) {
        g.weightedPriceNum += price * consumption;
        g.weightedPriceDenom += consumption;
        g.priceUnits.add(priceUomLabel(commodity.toLowerCase(), priceUom?.unit));
      }
      if (!g.productType && productType) g.productType = productType;
    };

    for (const r of rows) {
      const company = String(r[siteCompanyColumn] ?? '').trim();
      if (!company) continue;
      upsert('Electric',
        r.__electricSupplier__, r.__electricContractName__, r.__electricProductType__,
        r.__electricStart__, r.__electricEnd__, r.__electricContractPrice__,
        r.__kwh__, r.__electricCost__, 'kWh', '$/kWh', company, r.__electricPriceUom__);
      upsert('Gas',
        r.__gasSupplier__, r.__gasContractName__, r.__gasProductType__,
        r.__gasStart__, r.__gasEnd__, r.__gasContractPrice__,
        r.__therms__, r.__gasCost__, 'therms', '$/therm', company, r.__gasPriceUom__);
    }

    const fmtD = (d) => d ? `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}` : '';
    const out = [];
    for (const g of groups.values()) {
      const avg = g.weightedPriceDenom > 0 ? g.weightedPriceNum / g.weightedPriceDenom : null;
      out.push({
        'Company': g.company,
        'Commodity': g.commodity,
        'Supplier': g.supplier,
        'Contract Name': g.contractName,
        'Product Type': g.productType,
        'Sites': g.siteCount,
        'Earliest Start': fmtD(g.earliestStart),
        'Latest End': fmtD(g.latestEnd),
        'Total Annual Consumption': g.totalConsumption ? Math.round(g.totalConsumption) : '',
        'Consumption Unit': g.consumptionUnit,
        'Total Annual Cost': g.totalCost ? Math.round(g.totalCost * 100) / 100 : '',
        'Avg Contract Price': avg != null ? Math.round(avg * 10000) / 10000 : '',
        'Price Unit': g.priceUnit,
        // The average is weighted by consumption across sites, so a group
        // whose sites quoted different units produced a number that means
        // nothing — and one whose sites all quoted a non-canonical unit is
        // in that unit, not the one the column claims.
        'Price Unit Warning': priceUnitsWarning(g.commodity, g.priceUnits),
      });
    }
    out.sort((a, b) => {
      if (a.Company !== b.Company) return a.Company.localeCompare(b.Company);
      if (a.Commodity !== b.Commodity) return a.Commodity.localeCompare(b.Commodity);
      return (a.Supplier || '').localeCompare(b.Supplier || '');
    });
    return out;
  }, [rows, siteCompanyColumn]);

  const exportExtraSheets = useMemo(() => {
    const sheets = [];
    if (overviewByCommodity.electric.length) {
      sheets.push({ name: 'Electric Overview', rows: overviewByCommodity.electric });
    }
    if (overviewByCommodity.gas.length) {
      sheets.push({ name: 'Gas Overview', rows: overviewByCommodity.gas });
    }
    if (contractOverviewRows.length) {
      sheets.push({ name: 'Contract Overview', rows: contractOverviewRows });
    }
    if (contractSummaryRows.length) {
      sheets.push({ name: 'Contract Summary', rows: contractSummaryRows });
    }
    if (summaryRows.length) {
      sheets.push({ name: 'Summary', rows: summaryRows });
    }
    return sheets;
  }, [overviewByCommodity, contractOverviewRows, contractSummaryRows, summaryRows]);

  // Blank Sites-upload template — TWO commodity tabs (Electric Power
  // and Gas) each with header row + 200 pre-formatted blank data
  // rows. Common columns (Site Name, Zip, Country) appear on both
  // tabs so the user can fill in just one or split the data between
  // them. On upload the importer joins the two tabs by Site Name.
  // First column (Site Name) and header row are frozen so they stay
  // visible while the user scrolls.
  async function downloadSitesTemplate() {
    const { Workbook } = await import('exceljs');
    const SE_GREEN_DARK = 'FF009530';
    const SE_SLATE = 'FF475569';
    const SE_BORDER = 'FFD4DDE1';
    const SE_TEXT_DARK = 'FF1E293B';

    const ELECTRIC_UOM_OPTIONS = ['kWh', 'MWh', 'GWh'];
    const GAS_UOM_OPTIONS = ['therms', 'MMBtu', 'Dth', 'Mcf', 'Ccf', 'BTU'];
    // Bare unit names — Excel data validation lists choke on the "$"
    // character even inside a quoted literal, so the dropdown silently
    // drops on the Gas tab. The Contract Price column already implies
    // dollars; this column just carries the per-unit denominator.
    const ELECTRIC_PRICE_UOM_OPTIONS = ['kWh', 'MWh'];
    // Gas accepts MWh too — used in some European markets where gas is
    // priced on its energy-content equivalent.
    const GAS_PRICE_UOM_OPTIONS = ['therm', 'Dth', 'MMBtu', 'Mcf', 'Ccf', 'MWh'];
    const OWNERSHIP_OPTIONS = ['Owned', 'Leased'];
    const COUNTRY_OPTIONS = ['United States', 'Canada', 'Mexico', 'United Kingdom', 'Germany', 'France', 'Spain', 'Italy', 'Netherlands', 'Australia'];
    const CURRENCY_OPTIONS = ['USD', 'CAD', 'MXN', 'GBP', 'EUR', 'AUD'];
    const ELECTRIC_PRODUCT_OPTIONS = ['Fixed', 'Index', 'Block & Index', 'Heat Rate', 'Hybrid', 'Pass-through', 'Utility Default'];
    const GAS_PRODUCT_OPTIONS = ['Fixed', 'Index', 'NYMEX + Basis', 'Block & Index', 'Hybrid', 'Flexible', 'Pass-through', 'Utility Default'];

    const COMMON_FIELDS = [
      { label: 'Site Name', required: true, hint: 'Row label. Required so the row isn\'t filtered as blank. Enter on the Electric Power tab: the Gas tab pulls Site Name from there via formula.' },
      { label: 'Company Name', greenHeader: true, hint: 'Company / portfolio the site belongs to. Optional reference field: shown as a column on the Utility Lookup page and used to name the Indicative Savings export file. Enter on the Electric Power tab: the Gas tab pulls from there via formula.' },
      { label: 'Division', greenHeader: true, hint: 'Division / business unit / operating brand the site belongs to — one level under Company Name. Optional reference field: shown as its own column on the Utility Lookup page. Enter on the Electric Power tab: the Gas tab pulls from there via formula.' },
      { label: 'Address', greenHeader: true, hint: 'Street address of the site. Optional reference field. Enter on the Electric Power tab: the Gas tab pulls from there via formula.' },
      { label: 'City', greenHeader: true, hint: 'City / town of the site. Optional reference field. Enter on the Electric Power tab: the Gas tab pulls from there via formula.' },
      { label: 'State / Province', greenHeader: true, hint: 'State or province. Optional reference field: auto-derived from Zip for US / Canada when blank. Enter on the Electric Power tab: the Gas tab pulls from there via formula.' },
      { label: 'Zip / Postal Code', greenHeader: true, hint: 'Required for US and Canada sites: drives the utility lookup and state derivation. Leave blank for sites outside US / Canada. Enter on the Electric Power tab; the Gas tab pulls from there via formula.' },
      { label: 'Country', greenHeader: true, hint: 'Country of the site. Pick from the dropdown on the Electric Power tab: the Gas tab pulls from there via formula. Falls back to the utility-rates file when blank.', validation: { type: 'list', options: COUNTRY_OPTIONS } },
      { label: 'Currency', greenHeader: true, hint: 'Currency the site reports costs in. Pick from the dropdown on the Electric Power tab: the Gas tab pulls from there via formula.', validation: { type: 'list', options: CURRENCY_OPTIONS } },
      { label: 'Property Type', greenHeader: true, hint: 'Building / use type. Drives the per-property-type consumption + account-count estimates surfaced on the page and on the Indicative Savings export. Pick from the dropdown on the Electric Power tab: the Gas tab pulls from there via formula.', validation: { type: 'list', options: PROPERTY_TYPE_OPTIONS } },
      { label: 'Ownership', greenHeader: true, hint: 'Whether the building is Owned or Leased. Pick from the dropdown on the Electric Power tab: the Gas tab pulls from there via formula. Variants like "Own", "Owner-Occupied", "Tenant", or "Leasehold" are recognized on upload too.', validation: { type: 'list', options: OWNERSHIP_OPTIONS } },
      { label: 'Site Description', greenHeader: true, hint: 'Free-text annotation for the site: building name, internal code, notes, anything that helps identify the row. Passthrough only; shown next to Property Type on the Utility Lookup page. Enter on the Electric Power tab: the Gas tab pulls from there via formula.' },
      { label: 'Size (ft²)', greenHeader: true, hint: 'Square footage of the site. Scales the property-type reference consumption linearly. Optional: when blank the reference size for the property type is used as-is. Enter on the Electric Power tab: the Gas tab pulls from there via formula.' },
    ];
    const ELECTRIC_FIELDS = [
      { label: 'Annual Electric Consumption', required: false, hint: 'Annual electricity usage. Pair with Electric UoM so the tool can convert to kWh for cost estimates. Used when Total Electric Cost is blank.' },
      { label: 'Electric UoM', required: false, hint: 'Unit of measure for the Electric Consumption column. Pick from the dropdown: defaults to kWh when blank.', validation: { type: 'list', options: ELECTRIC_UOM_OPTIONS } },
      { label: 'Total Electric Cost ($)', required: false, hint: 'Actual annual electric spend. Overrides the consumption × rate estimate when provided.' },
      { label: 'Electric Supplier / Vendor', required: false, hint: 'If the value matches a utility from the rates file it lands in the Electric Utility column; otherwise it lands in the Supplier column.' },
      { label: 'Electric Contract Start', required: false, hint: 'Start date of the existing electric supply contract. Formatted as Excel Short Date.', dateColumn: true },
      { label: 'Electric Contract End', required: false, hint: 'End / expiration date of the existing electric supply contract. Formatted as Excel Short Date.', dateColumn: true },
      { label: 'Electric Contract Price', required: false, hint: 'Price under the existing electric supply contract. Numeric: pair with Electric Contract Price UoM to indicate whether the figure is per kWh or per MWh.', priceColumn: 'kwh' },
      { label: 'Electric Contract Price UoM', required: false, hint: 'Per-unit denominator the Electric Contract Price is quoted against. Pick from the dropdown: defaults to kWh when blank.', validation: { type: 'list', options: ELECTRIC_PRICE_UOM_OPTIONS } },
      { label: 'Electric Contract Name', required: false, hint: 'Human-readable identifier for the existing electric contract.' },
      { label: 'Electric Product Type', required: false, hint: 'Pricing structure of the electric contract: pick from the dropdown or type a custom value.', validation: { type: 'list', options: ELECTRIC_PRODUCT_OPTIONS } },
    ];
    const GAS_FIELDS = [
      { label: 'Annual Gas Consumption', required: false, hint: 'Annual gas usage. Pair with Gas UoM so the tool can convert to therms. Used when Total Natural Gas Cost is blank.' },
      { label: 'Gas UoM', required: false, hint: 'Unit of measure for the Gas Consumption column. Pick from the dropdown: defaults to therms when blank.', validation: { type: 'list', options: GAS_UOM_OPTIONS } },
      { label: 'Total Natural Gas Cost ($)', required: false, hint: 'Actual annual gas spend. Overrides the consumption × rate estimate when provided.' },
      { label: 'Gas Supplier / Vendor', required: false, hint: 'If the value matches a utility from the rates file it lands in the Gas Utility column; otherwise it lands in the Supplier column.' },
      { label: 'Gas Contract Start', required: false, hint: 'Start date of the existing gas supply contract. Formatted as Excel Short Date.', dateColumn: true },
      { label: 'Gas Contract End', required: false, hint: 'End / expiration date of the existing gas supply contract. Formatted as Excel Short Date.', dateColumn: true },
      { label: 'Gas Contract Price', required: false, hint: 'Price under the existing gas supply contract. Numeric: pair with Gas Contract Price UoM to indicate whether the figure is per therm, Dth, MMBtu, Mcf, Ccf, or MWh.', priceColumn: 'therm' },
      { label: 'Gas Contract Price UoM', required: false, hint: 'Per-unit denominator the Gas Contract Price is quoted against. Pick from the dropdown: defaults to therm when blank.', validation: { type: 'list', options: GAS_PRICE_UOM_OPTIONS } },
      { label: 'Gas Contract Name', required: false, hint: 'Human-readable identifier for the existing gas contract.' },
      { label: 'Gas Product Type', required: false, hint: 'Pricing structure of the gas contract: pick from the dropdown or type a custom value.', validation: { type: 'list', options: GAS_PRODUCT_OPTIONS } },
    ];

    const wb = new Workbook();
    wb.creator = 'Schneider Electric · Prospect Tracker';
    wb.created = new Date();

    // 1-based column index → Excel letter ("A", "B", ..., "AA").
    const colLetter = (idx) => {
      let s = '';
      let n = idx;
      while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
      return s;
    };

    // Header + 200 pre-formatted blank rows, with column-wide number
    // formats and dropdown validations stamped in place. Used twice —
    // once per commodity tab.
    const DATA_FORMATTED_ROWS = 200;
    const DATA_LAST_ROW = 1 + DATA_FORMATTED_ROWS;
    function renderCommoditySheet(name, fields, options = {}) {
      const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] });
      ws.columns = fields.map(f => ({ width: Math.max(String(f.label).length + 4, 16) }));
      const headerRow = ws.getRow(1);
      fields.forEach((f, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = f.label;
        cell.font = { name: 'Nunito Sans', bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        const useGreen = f.required || f.greenHeader;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: useGreen ? SE_GREEN_DARK : SE_SLATE } };
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
        cell.border = {
          top:    { style: 'thin', color: { argb: SE_BORDER } },
          bottom: { style: 'thin', color: { argb: SE_BORDER } },
          left:   { style: 'thin', color: { argb: SE_BORDER } },
          right:  { style: 'thin', color: { argb: SE_BORDER } },
        };
      });
      headerRow.height = 32;

      // Per-field number format, computed once. Applied per cell
      // below — ExcelJS column-level numFmts are silently dropped
      // once a cell has its own font / alignment / border style, so
      // the blank template rows end up reading as "General" without
      // this. Mirrors the column-level numFmt set further down.
      const fieldNumFmt = fields.map(f => {
        const lower = String(f.label).toLowerCase();
        if (f.dateColumn) return 'm/d/yyyy';
        if (f.priceColumn === 'kwh' || f.priceColumn === 'therm') return '"$"0.000';
        if (/cost|spend|\$/.test(lower)) return '"$"#,##0';
        if (/(consumption|kwh|therm|mmbtu|dth|mcf|ccf)/.test(lower) && !/uom|unit/.test(lower)) return '#,##0';
        return null;
      });

      for (let r = 2; r <= DATA_LAST_ROW; r++) {
        const row = ws.getRow(r);
        fields.forEach((f, i) => {
          const cell = row.getCell(i + 1);
          cell.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
          cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
          cell.border = {
            bottom: { style: 'thin', color: { argb: SE_BORDER } },
            left:   { style: 'thin', color: { argb: SE_BORDER } },
            right:  { style: 'thin', color: { argb: SE_BORDER } },
          };
          if (fieldNumFmt[i]) cell.numFmt = fieldNumFmt[i];
        });
        row.height = 18;
      }

      fields.forEach((f, i) => {
        const colIdx = i + 1;
        const col = ws.getColumn(colIdx);
        const lower = String(f.label).toLowerCase();
        if (f.dateColumn) {
          col.numFmt = 'm/d/yyyy';
        } else if (f.priceColumn === 'kwh' || f.priceColumn === 'therm') {
          col.numFmt = '"$"0.000';
        } else if (/cost|spend|\$/.test(lower)) {
          col.numFmt = '"$"#,##0';
        } else if (/(consumption|kwh|therm|mmbtu|dth|mcf|ccf)/.test(lower) && !/uom|unit/.test(lower)) {
          col.numFmt = '#,##0';
        }
        // Skip dropdown validation on linked columns — the value
        // there comes from a formula referencing the source sheet,
        // and stacking list validation on top of a formula leads to
        // confusing prompts ("you must pick from the list") when
        // the source cell is blank.
        const isLinked = options.linkColumns && colIdx <= options.linkColumns.count;
        if (f.validation?.type === 'list' && !isLinked) {
          const letter = colLetter(colIdx);
          const range = `${letter}2:${letter}${DATA_LAST_ROW}`;
          ws.dataValidations.add(range, {
            type: 'list',
            allowBlank: true,
            formulae: [`"${f.validation.options.join(',')}"`],
            showInputMessage: true,
            promptTitle: f.label,
            prompt: `Pick one of: ${f.validation.options.join(', ')}`,
          });
        }
      });

      // Mirror the leftmost N columns from a source sheet via Excel
      // formulas. Wrapped in IF(... = "", "", ...) so empty source
      // rows stay blank instead of rendering as 0. Light gray font
      // signals "computed value — don't type here, go to the source
      // tab instead".
      if (options.linkColumns) {
        const { fromSheet, count } = options.linkColumns;
        const quotedSheet = `'${fromSheet}'`;
        for (let r = 2; r <= DATA_LAST_ROW; r++) {
          for (let i = 0; i < count; i++) {
            const letter = colLetter(i + 1);
            const ref = `${quotedSheet}!${letter}${r}`;
            const cell = ws.getRow(r).getCell(i + 1);
            cell.value = { formula: `IF(${ref}="","",${ref})` };
            cell.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_SLATE }, italic: true };
          }
        }
      }

      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: fields.length } };
    }

    renderCommoditySheet('Electric Power', [...COMMON_FIELDS, ...ELECTRIC_FIELDS]);
    renderCommoditySheet('Gas', [...COMMON_FIELDS, ...GAS_FIELDS], {
      linkColumns: { fromSheet: 'Electric Power', count: COMMON_FIELDS.length },
    });
    const FIELDS = [...COMMON_FIELDS, ...ELECTRIC_FIELDS, ...GAS_FIELDS];

    // Sheet 2: Instructions
    const notes = wb.addWorksheet('Instructions');
    notes.columns = [{ width: 38 }, { width: 12 }, { width: 90 }];

    notes.mergeCells(1, 1, 1, 3);
    const intro = notes.getCell(1, 1);
    intro.value = 'Fill in the Electric Power tab and the Gas tab separately. Use the SAME Site Name on both tabs for each site: the importer joins the two tabs together by Site Name on upload. Site Name and Zip / Postal Code are required on each tab the site appears on. Everything else is optional. The Utility Lookup page derives State, Utility, Market, Rate, and Total Cost automatically from the rates file. Use the Electric UoM / Gas UoM dropdowns to choose what unit your consumption values are in; the tool converts to kWh / therms internally.';
    intro.font = { name: 'Nunito Sans', italic: true, size: 10, color: { argb: SE_SLATE } };
    intro.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
    notes.getRow(1).height = 80;

    const notesHeader = notes.getRow(2);
    ['Column', 'Required', 'Description'].forEach((h, i) => {
      const cell = notesHeader.getCell(i + 1);
      cell.value = h;
      cell.font = { name: 'Nunito Sans', bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
      cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    });
    notesHeader.height = 26;

    FIELDS.forEach((f, i) => {
      const row = notes.getRow(3 + i);
      const c1 = row.getCell(1);
      c1.value = f.label;
      c1.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: SE_TEXT_DARK } };
      c1.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      const c2 = row.getCell(2);
      c2.value = f.required ? 'Yes' : 'No';
      c2.font = { name: 'Nunito Sans', bold: f.required, size: 10, color: { argb: f.required ? SE_GREEN_DARK : SE_SLATE } };
      c2.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      const c3 = row.getCell(3);
      c3.value = f.hint;
      c3.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_SLATE } };
      c3.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
      row.height = 26;
    });

    sanitizeExcelWorkbook(wb);
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Utility Lookup Template.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Schneider-branded "Indicative Savings by State" workbook. Single
  // sheet, two sections (Electric Power + Natural Gas), per-state
  // rows with 2 % – 4 % indicative savings on the deregulated spend
  // plus supplier name and contract dates trailing the standard
  // savings columns. Triggered by its own button so it ships
  // independent of the raw-data export.
  // Convert an ArrayBuffer (what exceljs writeBuffer returns) into a
  // plain base64 string for storage in Firestore. Chunked so we don't
  // overflow the call stack on String.fromCharCode(...big array).
  function arrayBufferToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      const slice = bytes.subarray(i, i + CHUNK);
      binary += String.fromCharCode.apply(null, slice);
    }
    return btoa(binary);
  }

  // What the analysis worked out about a site, as columns to hang off
  // that site's row in the company's site list.
  //
  // The uploaded file says where a site is; the analysis is what the page
  // adds to it — which utility serves it, which market it sits in, what it
  // consumes and what that costs. Storing the upload alone left the
  // company's site list saying no more after a Master Analysis than it did
  // before one, so the answers had to be read back out of the workbook.
  //
  // Labels match the workbook's Site Detail sheet: the same figure should
  // not have two names depending on where it is read.
  //
  // Figures are rounded to what the sheet displays. A cell here is read
  // as-is — there is no number format behind it to round 8.293000000000001
  // down to $8.29 the way the workbook does.
  const round = (value, dp = 0) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const f = 10 ** dp;
    return Math.round(value * f) / f;
  };
  const ANALYSIS_SITE_COLUMNS = [
    // The division / business unit the site sits under, from the mapped
    // Division column. It is what a portfolio this size is actually read
    // by — "which of our operating companies is this site" — and the
    // company popup had no way to answer it.
    ['Division', r => r.__division__ || ''],
    ['ST / Prov', r => r.__stateProvinceDisplay__ || r.__state__ || ''],
    ['Country', r => r.__country__ || ''],
    ['Zip', r => r.__zipNorm__ || ''],
    ['Property Type', r => r.__propertyType__ || r.__propertyTypeRaw__ || ''],
    ['Size (ft²)', r => round(r.__propertySizeFt2__)],
    ['Electric Utility', r => r.__electric__ || ''],
    ['ISO / RTO', r => r.__iso__?.iso || ''],
    ['Electric Supplier', r => r.__electricSupplier__ || ''],
    ['Electric Market', r => classifyMarket(r, 'electric') || ''],
    ['Annual Electric (kWh)', r => round(r.__kwh__)],
    ['Electric Rate ($/kWh)', r => round(r.__electricRate__, 4)],
    ['Total Electric Cost', r => round(r.__electricCost__)],
    ['Gas Utility', r => r.__gas__ || ''],
    ['Gas Market', r => classifyMarket(r, 'gas') || ''],
    // Dth, like the Site Detail sheet — __therms__ is therms and
    // __gasRate__ is $/therm, so both are decimal-shifted to match.
    ['Annual Gas (Dth)', r => round(typeof r.__therms__ === 'number' ? r.__therms__ / 10 : null)],
    ['Gas Rate ($/Dth)', r => round(typeof r.__gasRate__ === 'number' ? r.__gasRate__ * 10 : null, 2)],
    ['Total Natural Gas Cost', r => round(r.__gasCost__)],
    ['Total Energy Cost', r => round(r.__totalCost__)],
    // Expected utility accounts (bills) for the site, from its property
    // type. Written per site so a company's account total can be read
    // back off the saved list the same way its site count is — by
    // counting the list, not the one upload that happened to be open.
    ['Est. Utility Accounts', r => round(propertyTypeAccountTotal(r.__propertyType__), 2)],
  ];

  // Which of those figures were MODELED rather than measured, for one
  // row. A company's site list can hold real consumption — someone typed
  // it off a bill, or an upload carried it — and an indicative number
  // must never be written over that. Consumption is modeled when it came
  // from the property-type estimate; cost when no actual spend was
  // mapped; the rates always, since they are state / country averages and
  // never a billed tariff.
  const analysisEstimatedFields = (r, columnFor) => {
    const out = [];
    const mark = (label, isEstimate) => { if (isEstimate) out.push(columnFor(label)); };
    mark('Annual Electric (kWh)', !!r.__kwhFromEstimate__ && typeof r.__kwh__ === 'number');
    mark('Total Electric Cost', r.__electricCostActual__ == null && typeof r.__electricCost__ === 'number');
    mark('Electric Rate ($/kWh)', typeof r.__electricRate__ === 'number');
    mark('Annual Gas (Dth)', !!r.__thermsFromEstimate__ && typeof r.__therms__ === 'number');
    mark('Total Natural Gas Cost', r.__gasCostActual__ == null && typeof r.__gasCost__ === 'number');
    mark('Gas Rate ($/Dth)', typeof r.__gasRate__ === 'number');
    // Total Energy Cost is the sum of two costs, so it is only measured
    // when both sides of it were.
    mark('Total Energy Cost', typeof r.__totalCost__ === 'number'
      && (r.__electricCostActual__ == null || r.__gasCostActual__ == null));
    return out.filter(Boolean);
  };

  // Mandate corrections held in the SHARED reference — one document per
  // jurisdiction, read by every signed-in user. A city's deadline is the
  // same deadline for everyone screening a site there, so a correction
  // belongs to the team rather than to whoever typed it.
  const [sharedOrdinanceOverrides, setSharedOrdinanceOverrides] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { overrides } = await loadSharedOrdinanceOverrides();
      if (!cancelled) setSharedOrdinanceOverrides(overrides);
    })();
    return () => { cancelled = true; };
  }, []);

  // The user's own copy. Written only when the shared write is refused,
  // and laid OVER the shared layer so what they typed still stands for
  // them — see mergeOverrideLayers.
  const personalOrdinanceOverrides = settings?.complianceOrdinanceOverrides || null;
  const ordinanceOverrides = useMemo(
    () => mergeOverrideLayers(sharedOrdinanceOverrides, personalOrdinanceOverrides),
    [sharedOrdinanceOverrides, personalOrdinanceOverrides],
  );

  // Mandate data with those corrections applied. Every screening on this
  // page — the two compliance subtabs and the two exports — reads this
  // rather than the published seed, so a corrected deadline or penalty
  // reaches every figure instead of only the popup it was typed into.
  // MASTER_ORDINANCES is returned unchanged when nothing is corrected,
  // which keeps the screening's per-list caches warm.
  const ordinances = useMemo(
    () => applyOrdinanceOverrides(MASTER_ORDINANCES, ordinanceOverrides),
    [ordinanceOverrides],
  );

  /**
   * Save (or clear, with a null patch) one jurisdiction's correction for
   * one mandate category.
   *
   * The shared reference is written first, because that is what the
   * correction is FOR. A refusal isn't a failure to report and walk away
   * from: the correction is kept in the user's own settings so their
   * screening still reflects it, and the caller is told which of the two
   * happened so the page can say so.
   *
   * Returns { ok, shared, error }.
   */
  const saveOrdinanceOverride = useCallback(async (govId, category, patch) => {
    const key = overrideKey(govId);
    if (!key || !category) return { ok: false, shared: false, error: 'Nothing to save.' };

    const applyLocally = () => setSharedOrdinanceOverrides((prev) => {
      const next = { ...(prev || {}) };
      const entry = { ...(next[key] || {}) };
      if (patch) entry[category] = patch; else delete entry[category];
      if (Object.keys(entry).length) next[key] = entry; else delete next[key];
      return next;
    });

    const result = await saveSharedOrdinanceOverride(key, category, patch);
    if (result.ok) {
      // Reflect it immediately rather than waiting for a re-read: the
      // popup this was typed into is still open and showing the old
      // figures.
      applyLocally();
      // A correction that made it to the shared reference doesn't need a
      // personal copy shadowing it — and a stale personal copy would win
      // over every future shared edit.
      if (personalOrdinanceOverrides?.[key]?.[category] && updateSettingsPath) {
        const rest = { ...personalOrdinanceOverrides[key] };
        delete rest[category];
        updateSettingsPath({
          [`complianceOrdinanceOverrides.${key}`]: Object.keys(rest).length ? rest : null,
        });
      }
      return { ok: true, shared: true, error: '' };
    }

    if (!updateSettingsPath) return { ok: false, shared: false, error: result.error };
    const current = personalOrdinanceOverrides?.[key] || {};
    const next = { ...current };
    if (patch) next[category] = patch;
    else delete next[category];
    updateSettingsPath({
      // Dropping the last correction for a jurisdiction drops the
      // jurisdiction, so the map doesn't fill with empty objects.
      [`complianceOrdinanceOverrides.${key}`]: Object.keys(next).length ? next : null,
    });
    return { ok: true, shared: false, error: result.error };
  }, [personalOrdinanceOverrides, updateSettingsPath]);

  // Total expected utility accounts across a saved site list. Rows this
  // page writes carry the per-site estimate in their analysis column;
  // rows that predate it — or came from a plain upload on the company
  // popup — fall back to the property-type lookup, so a list assembled
  // over several uploads still totals correctly. Headers are matched by
  // prefix because a colliding uploaded column pushes the analysis one to
  // "<label> (analysis)".
  function siteListAccountTotal({ headers = [], rows = [] } = {}) {
    const isHeader = (h, label) => typeof h === 'string' && h.startsWith(label);
    const acctHeaders = headers.filter(h => isHeader(h, 'Est. Utility Accounts'));
    const typeHeaders = headers.filter(h => isHeader(h, 'Property Type'));
    let total = 0;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      let stated = null;
      for (const h of acctHeaders) {
        const n = Number(row[h]);
        if (Number.isFinite(n) && n > 0) { stated = n; break; }
      }
      if (stated != null) { total += stated; continue; }
      for (const h of typeHeaders) {
        const est = propertyTypeAccountTotal(row[h]);
        if (est) { total += est; break; }
      }
    }
    return Math.round(total);
  }

  // Mirror the currently-loaded sites into settings.companySiteLists under
  // the company's slug, matching the shape the company popup writes
  // ({ company, fileName, headers, rows, uploadedAt }) so the Company Look
  // Up status and the Site List Overview both read it. Returns the note
  // to append to the save status, how many sites the company's list holds
  // afterwards, and the utility accounts behind them (both 0 when it
  // couldn't be written).
  async function saveSitesAsCompanySiteList(company) {
    const slug = companySlug(company);
    if (!slug || !updateSettingsPath) return { note: ' Site list not updated: no company to file it under.', total: 0, accounts: 0 };
    if (!sitesData.length || !siteHeaders.length) return { note: ' Site list not updated: no sites are loaded.', total: 0, accounts: 0 };
    // Firestore rejects Dates / nested objects in these row maps, and the
    // popup's own upload path normalizes the same way.
    const safeCell = (v) => {
      if (v == null) return '';
      if (v instanceof Date) return v.toISOString();
      if (typeof v === 'object') return String(v);
      if (typeof v === 'number') return Number.isFinite(v) ? v : '';
      return v;
    };

    // An uploaded column already called "Country" wins its own name: the
    // file's value is what the user put there, and overwriting it with a
    // derived one would edit their data rather than add to it.
    const used = new Set(siteHeaders);
    const analysisCols = ANALYSIS_SITE_COLUMNS.map(([label, get]) => {
      let name = label;
      for (let n = 1; used.has(name); n += 1) {
        name = n === 1 ? `${label} (analysis)` : `${label} (analysis ${n})`;
      }
      used.add(name);
      return { label, name, get };
    });

    // allRows is built from cleanSitesData, which is sitesData filtered by
    // site name — so it is indexed by position within THAT list, not this
    // one. Pair them by the row object itself; every uploaded row is kept,
    // whether or not the analysis had anything to say about it.
    const derivedFor = new Map();
    allRows.forEach((derived, i) => {
      const source = cleanSitesData[i];
      if (source) derivedFor.set(source, derived);
    });

    // An analysis column's label may have been renamed around a colliding
    // uploaded one, and the estimate flags have to name the column as it
    // was actually written.
    const columnFor = (label) => analysisCols.find(c => c.label === label)?.name || '';
    const loadedSoft = [];
    const loadedRows = sitesData.map((r) => {
      const o = {};
      for (const h of siteHeaders) o[h] = safeCell(r[h]);
      const derived = derivedFor.get(r);
      for (const col of analysisCols) o[col.name] = derived ? safeCell(col.get(derived)) : '';
      loadedSoft.push(derived ? analysisEstimatedFields(derived, columnFor) : []);
      return o;
    });
    const loadedHeaders = [...siteHeaders, ...analysisCols.map(c => c.name)];

    // What the company already has. The page rarely holds a company's
    // whole portfolio at once — a file gets uploaded per region, per
    // division, per acquisition — so a save ADDS to that list rather than
    // standing in for it. Replacing it wholesale meant the second upload
    // silently deleted the first, and the only way back was to find the
    // original file. (Wholesale replacement is still available, on the
    // company popup's own Replace via file / paste.)
    const existing = (settings?.companySiteLists || {})[slug] || null;
    const existingHeaders = Array.isArray(existing?.headers) ? existing.headers.filter(h => typeof h === 'string') : [];
    const existingRows = Array.isArray(existing?.rows) ? existing.rows.filter(r => r && typeof r === 'object') : [];
    const merged = mergeIntoSiteList(
      { headers: existingHeaders, rows: existingRows },
      { headers: loadedHeaders, rows: loadedRows },
      { soft: loadedSoft },
    );

    const entry = {
      company: company || '',
      fileName: 'Saved from Utility Look Up',
      headers: merged.headers,
      rows: merged.rows,
      uploadedAt: new Date().toISOString(),
    };
    // Each company's list is its own Firestore document, so the ~1 MiB
    // cap applies to this company alone rather than to every company's
    // list at once (it used to be one map on the settings document, and
    // the limit was shared). Skip rather than fail the whole save when
    // one company's rows won't fit — and say that the list the company
    // already had is untouched, since that is the difference between
    // "nothing was added" and "everything is gone".
    if (JSON.stringify(entry).length > 900_000) {
      return {
        note: existingRows.length
          ? ` Site list not updated: ${merged.rows.length.toLocaleString()} sites is too many to store for one company, so the ${existingRows.length.toLocaleString()} already saved are unchanged.`
          : ' Site list not updated: too many sites to store for one company.',
        total: existingRows.length,
        accounts: siteListAccountTotal({ headers: existingHeaders, rows: existingRows }),
      };
    }
    try {
      // Awaited, so the save status can't call the site list done while
      // the write is still in flight.
      await updateSettingsPath({ [`companySiteLists.${slug}`]: entry });
      const parts = [];
      if (merged.added) parts.push(`${merged.added.toLocaleString()} added`);
      if (merged.updated) parts.push(`${merged.updated.toLocaleString()} updated`);
      const detail = parts.length ? `${parts.join(', ')}, ` : '';
      // Worth saying out loud: an indicative figure was NOT written over
      // a real one. Silence there reads as the estimate having landed.
      const kept = merged.protected
        ? ` ${merged.protected.toLocaleString()} actual figure${merged.protected === 1 ? '' : 's'} already on the list were kept over the indicative ones.`
        : '';
      return {
        note: ` Site list now holds ${merged.rows.length.toLocaleString()} site${merged.rows.length === 1 ? '' : 's'} (${detail}with the analysis columns).${kept}`,
        total: merged.rows.length,
        accounts: siteListAccountTotal(merged),
      };
    } catch (e) {
      console.warn('Could not save company site list:', e);
      return { note: ' Site list could not be updated.', total: 0, accounts: 0 };
    }
  }

  // Builds the Master Analysis workbook (Indicative Savings + Building
  // Compliance + Corporate Compliance + Methodology) and saves it against
  // the company, where it shows up on that company's prospect / client
  // popup. Kept under the indicativeAnalysis storage keys so previously
  // saved analyses stay readable and a re-save replaces them in place.
  async function saveMasterAnalysisToCompany(prospect) {
    if (!prospect?.id) return;
    // Picking a company to save to also names the whole portfolio, so the
    // company flows onto every Utility Lookup subtab (incl. Corporate
    // Compliance) — not just the saved export file.
    setPortfolioCompanyName(prospect.company);
    setSaveStatus({ state: 'saving', message: `Saving to ${prospect.company || 'company'}…` });
    try {
      const result = await exportMasterAnalysis({ returnBuffer: true, companyName: prospect.company });
      if (!result) {
        setSaveStatus({ state: 'error', message: 'Nothing to save: load sites first.' });
        return;
      }
      const { buffer, fileName } = result;
      const dataBase64 = arrayBufferToBase64(buffer);
      const sizeMb = buffer.byteLength / (1024 * 1024);
      // The analysis is chunked across multiple Firestore docs on save, so
      // it's not bound by the ~1 MiB single-document cap, and the company
      // popup now reads only the metadata doc — the chunks are fetched on
      // the Download click. That leaves upload time as the real cost, so the
      // ceiling here is a backstop against a runaway workbook rather than a
      // limit real portfolios are expected to hit.
      if (dataBase64.length > MAX_ANALYSIS_BASE64_CHARS) {
        setSaveStatus({
          state: 'error',
          message: `Analysis is ${sizeMb.toFixed(1)} MB: over the ${MAX_ANALYSIS_MB} MB save limit. Trim sites and retry.`,
        });
        return;
      }
      setSaveStatus({ state: 'saving', message: `Saving ${sizeMb.toFixed(1)} MB to ${prospect.company || 'company'}…` });
      // No pre-delete: saveIndicativeAnalysis writes the chunks first, the
      // `main` metadata doc last, and prunes any stale tail chunks, so a
      // re-save is already a clean replace. Wiping first meant an upload that
      // died partway — far likelier now that a workbook can run to tens of
      // megabytes — left the company with no analysis at all instead of the
      // previous one.
      await saveIndicativeAnalysis(prospect.id, {
        fileName,
        dataBase64,
        sizeBytes: buffer.byteLength,
      });
      // Fold the loaded sites into this company's site list, so the "Site
      // list mapped" status (and the Site List Overview) reflect the save
      // instead of staying empty until someone re-uploads the same rows
      // from the company popup. Ahead of the prospect stamp below because
      // the merged list is what Number of Sites is counted from.
      const siteList = await saveSitesAsCompanySiteList(prospect.company);
      // Stamp a lightweight marker on the prospect record so the Company
      // Look Up widget can show "analysis saved" without fetching the
      // (chunked) analysis subcollection for every company it lists.
      // Number of Sites comes off the company's whole site list rather
      // than this upload: the page holds one file at a time, and a company
      // whose 158 sites arrived as three uploads has 158 sites, not
      // however many were on screen for the last save.
      const siteCount = Math.max(cleanSitesData.length, siteList.total || 0);
      // Number of Accounts rides along on the same reasoning: the utility
      // accounts (bills) behind those sites, estimated from each site's
      // property type. It feeds the popup's estimated annual data deal
      // size, which is priced per account per month.
      //
      // A total typed on the page wins outright rather than being max'd with
      // the estimate: it is a stated fact about the portfolio, and a model
      // that came out higher is still a model. That also makes a correction
      // downwards possible, which a max() would silently ignore.
      const loadedAccounts = Math.round(
        allRows.reduce((sum, r) => sum + (propertyTypeAccountTotal(r.__propertyType__) || 0), 0),
      );
      const accountCount = manualAccounts != null
        ? manualAccounts
        : Math.max(loadedAccounts, siteList.accounts || 0);
      if (updateProspect) {
        try {
          updateProspect(prospect.id, {
            indicativeAnalysisMeta: { fileName, sizeBytes: buffer.byteLength, savedAt: new Date().toISOString() },
            ...(siteCount > 0 ? { numberOfSites: siteCount } : {}),
            ...(accountCount > 0 ? { numberOfAccounts: accountCount } : {}),
          });
        } catch (e) { console.warn('Could not stamp analysis marker on prospect:', e); }
      }
      const siteCountNote = siteCount > 0
        ? ` Number of Sites set to ${siteCount.toLocaleString()}.`
        : '';
      const accountCountNote = accountCount > 0
        ? ` Number of Accounts set to ${accountCount.toLocaleString()}${manualAccounts != null ? ' (the total entered on this page)' : ''}.`
        : '';
      setSaveStatus({ state: 'success', message: `Saved to ${prospect.company || 'company'}.${siteCountNote}${accountCountNote}${siteList.note}` });
      setSavePickerSearch(null);
      setTimeout(() => setSaveStatus({ state: 'idle', message: '' }), 4000);
    } catch (err) {
      console.error('Save indicative analysis failed:', err);
      setSaveStatus({ state: 'error', message: err?.message || 'Save failed.' });
    }
  }

  // The reverse of saveMasterAnalysisToCompany: pull the Master Analysis
  // saved against a company back onto this page. The workbook carries a
  // "Site List" tab (the rows it was built from, with resolved values
  // baked in) plus a hidden state sheet with the column mapping, vendor
  // decisions and per-row supplier edits — enough to restore the site
  // list without asking the user to re-map anything. Loading those rows
  // repopulates every Utility Lookup subtab, since Utility Mapping,
  // Building Compliance, the Roadmap and Corporate Compliance all derive
  // from the same site list + portfolio company.
  //
  // Analyses saved before the round-trip sheets existed have no Site List
  // tab; those fall back to the column-mapping modal so the user can map
  // one of the workbook's other tabs by hand.
  async function importMasterAnalysisFromCompany(prospect) {
    if (!prospect?.id) return;
    const label = prospect.company || 'company';
    if (sitesData.length > 0 && !window.confirm(
      `Replace the ${sitesData.length} site${sitesData.length === 1 ? '' : 's'} currently loaded with ${label}'s saved Master Analysis?`
    )) return;
    setImportStatus({ state: 'loading', message: `Loading ${label}'s analysis…` });
    try {
      const saved = await loadIndicativeAnalysis(prospect.id);
      if (!saved?.dataBase64) {
        setImportStatus({ state: 'error', message: `No saved analysis found on ${label}.` });
        return;
      }
      const binary = atob(saved.dataBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const toSheets = (buf) => parseAllSheets(buf).map(s => ({
        sheetName: s.sheetName,
        rows: s.rows,
        headers: s.headers,
        mapping: detectSitesMapping(s.headers),
        isMerged: false,
      }));
      let rt, sheets;
      // Damage confined to one sheet's zip entry makes the strict reader
      // refuse the whole workbook, even when the Site List is untouched.
      // Rebuild from the entries that still decompress and read that.
      let salvageNote = '';
      try {
        rt = readRoundTripState(bytes);
        sheets = toSheets(bytes);
      } catch (parseErr) {
        if (!looksLikeZipDamage(parseErr)) throw parseErr;
        setImportStatus({ state: 'loading', message: `${label}'s analysis is damaged — trying to recover it…` });
        const { bytes: repaired, lost } = await salvageWorkbook(bytes);
        rt = readRoundTripState(repaired);
        sheets = toSheets(repaired);
        // Names off the rebuilt workbook, not the parsed sheets: a lost
        // sheet is absent from the latter, so indexing it would name the
        // wrong tab.
        const names = describeLostEntries(lost, readSheetNames(repaired));
        salvageNote = names.length
          ? ` Recovered from a damaged file — ${names.join(', ')} could not be read.`
          : ' Recovered from a damaged file.';
      }
      const siteListIdx = sheets.findIndex(s => s.sheetName === 'Site List');
      if (siteListIdx < 0) {
        // Pre-round-trip analysis. Hand the workbook to the mapping modal
        // (defaulting to the Site Detail tab, the closest thing it has to
        // a site list) rather than guessing at a mapping.
        if (sheets.length === 0) {
          setImportStatus({ state: 'error', message: 'That saved analysis has no readable data tabs.' });
          return;
        }
        const detailIdx = sheets.findIndex(s => /site\s*detail/i.test(s.sheetName));
        setUploadError('');
        setSitesMappingModal({
          fileName: saved.fileName || `${label} Master Analysis`,
          sheets,
          selectedIdx: detailIdx >= 0 ? detailIdx : 0,
          roundTripState: rt,
        });
        setImportStatus({ state: 'idle', message: '' });
        return;
      }
      const siteList = sheets[siteListIdx];
      const mapping = mappingForExportedSheet(siteList.headers, rt);
      const ok = await commitSitesImport({
        rows: siteList.rows,
        mapping,
        isUpdate: false,
        roundTripState: rt,
      });
      if (!ok) {
        setImportStatus({ state: 'error', message: 'Could not load the sites from that analysis.' });
        return;
      }
      // Naming the portfolio company is what carries the import through to
      // Corporate Compliance (its screening answers, revenue research and
      // compliance links are all stored per company).
      setPortfolioCompanyName(prospect.company || rt?.portfolioCompanyName || '');
      setMainTab('lookup');
      const n = siteList.rows.length;
      setImportStatus({
        state: 'success',
        message: `Imported ${n} site${n === 1 ? '' : 's'} from ${label}'s Master Analysis.${salvageNote}`,
      });
      // A salvaged import leaves the user a decision to make (re-save to
      // replace the damaged copy), so hold that message rather than
      // clearing it out from under them.
      if (!salvageNote) setTimeout(() => setImportStatus({ state: 'idle', message: '' }), 5000);
    } catch (err) {
      console.error('Import saved analysis failed:', err);
      // A workbook that reassembled to the right length but wrong bytes gets
      // as far as the xlsx reader and dies inside the zip parser, with a
      // message about byte counts that gives the user nothing to act on.
      // Say what it means and what fixes it.
      const raw = String(err?.message || '');
      const unreadableZip = /Bad (compressed|uncompressed) size|Bad CRC32|Unsupported ZIP|end of central directory|Corrupted zip|Cannot find file/i.test(raw);
      setImportStatus({
        state: 'error',
        message: unreadableZip
          ? `${label}'s saved analysis is damaged past recovery (${raw}). Download it from the company popup and try opening it in Excel, which can often repair a file this page can't, then upload the result here as a sites file.`
          : (raw || 'Import failed.'),
      });
    }
  }

  // Pick a single company name to label the export with. Prefers an
  // explicit override (e.g. the company a "Save to Company" save is
  // bound to), otherwise the most common value in the mapped Company
  // Name column. Returns '' when nothing is available.
  function deriveExportCompanyName(override) {
    const explicit = String(override || '').trim();
    if (explicit) return explicit;
    const counts = new Map();
    for (const r of rows) {
      const name = String(r.__companyName__ || '').trim();
      if (!name) continue;
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    let best = '';
    let bestCount = 0;
    for (const [name, count] of counts) {
      if (count > bestCount) { best = name; bestCount = count; }
    }
    return best;
  }

  // Strip characters that browsers / OSes reject in download file names
  // and collapse the leftover whitespace.
  function sanitizeFileNamePart(s) {
    return String(s).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Tag an export's file name with the active division. The exports that
  // lead with a company name join it there instead; this is for the ones
  // that don't, so no scoped workbook leaves the page looking like the
  // whole portfolio.
  function divisionScopedName(stem) {
    const d = sanitizeFileNamePart(activeDivisionLabel());
    return d ? `${stem} - ${d}` : stem;
  }

  // Company-level Corporate Compliance rollup for the export's Summary tab.
  // Mirrors the Corporate Compliance page: group sites by the canonical
  // company key, read that company's six jurisdiction answers and its
  // researched revenue, and derive which reporting regimes are triggered.
  // Screening answers key off the canonical key while revenue research keys
  // off a plain slug of the display name — same split the page uses.
  function corporateComplianceSummary() {
    const screening = settings?.corporateComplianceScreening || {};
    const revenueResearch = settings?.companyRevenueResearch || {};
    const complianceResearch = settings?.companyComplianceResearch || {};
    // The reference link and findings the user typed against each row —
    // their own work, and the part of the card a static export was
    // previously dropping entirely. Links are filed by row key for the whole
    // page (the same statute whoever is screened); findings stay per company,
    // so those are looked up one company at a time inside the loop below.
    // Both maps used to be indexed here with a row key against the
    // per-company map, which resolved to nothing — the export shipped an
    // empty Reference column no matter what was on the card.
    const sharedLinks = settings?.complianceReferenceLinks || {};
    const legacyLinks = settings?.companyComplianceLinks || {};
    const allFindings = settings?.companyComplianceFindings || {};
    // HQ sources, in the same priority order the card's HQ row uses.
    const hqResearch = settings?.companyHqResearch || {};
    const hqRegionMap = settings?.hqRegionMap || {};
    // Each company's ultimate parent, as recorded on the card. Every regime
    // in this section tests its thresholds at the consolidated group, so the
    // parent (and its revenue) is part of showing the working — a verdict
    // reached against a parent's numbers reads as unsupported without it.
    const parentCompanies = settings?.corporateComplianceParent || {};
    // Saved "Research with Claude" runs — the programme summary, published
    // reports and researched targets the company page stores.
    const companyResearch = settings?.companyResearch || {};
    const keyOf = (name) => {
      const norm = normalizeCompany(name);
      return norm ? norm.replace(/\s+/g, '-') : '';
    };
    const revSlug = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '-');

    const byKey = new Map();
    for (const site of complianceSites) {
      const rawName = String(site.company || '').trim();
      if (!rawName) continue; // unnamed sites carry no company to screen
      const key = keyOf(rawName);
      const mapKey = key || rawName.toLowerCase();
      if (!byKey.has(mapKey)) byKey.set(mapKey, { key, california: 0, total: 0, names: new Map(), caSites: [] });
      const e = byKey.get(mapKey);
      e.total += 1;
      e.names.set(rawName, (e.names.get(rawName) || 0) + 1);
      // Same California test the Corporate Compliance page and the Excel
      // report use — a CA State backed by a US (or absent) country.
      if (isCaliforniaSite(site)) {
        e.california += 1;
        const label = [site.siteName, site.city].filter(Boolean).join(': ');
        if (label) e.caSites.push(label);
      }
    }

    const out = [];
    for (const e of byKey.values()) {
      // Display name = most common raw spelling, matching the page.
      let name = '';
      let best = -1;
      for (const [n, c] of e.names) {
        if (c > best || (c === best && (n.length > name.length || (n.length === name.length && n < name)))) {
          name = n; best = c;
        }
      }
      const answers = screening[e.key] || {};
      const yesJurisdictions = JURISDICTION_QUESTIONS
        .filter(q => answers[q.key] === 'Yes')
        .map(q => q.jurisdiction);

      // One row's reference link and this company's findings on it, resolved
      // the way the card resolves them: the shared link first, then anything
      // filed per company before links moved off the company.
      const companyLinks = legacyLinks[e.key] || {};
      const findings = allFindings[e.key] || {};
      const links = (rowKey) => sharedLinks[rowKey] || companyLinks[rowKey] || '';

      // Revenue: the researched figure, else the matched prospect record —
      // the same fallback order the page's cards use.
      const revData = revenueResearch[revSlug(name)] || null;
      const prospect = (prospects || []).find(p => keyOf(p?.company) === e.key) || null;
      const fromProspect = prospect?.revenue;
      const ownRevenueLabel = String(revData?.revenue || fromProspect || '').trim();

      // The entity the thresholds are measured at, resolved exactly as the
      // card's thresholdRevenueFor does. Every regime in this section tests
      // the CONSOLIDATED group, and either side can trigger a mandate, so
      // the larger of the company's own figure and its parent's is the test
      // subject; an unresearched parent falls back to the company's own
      // rather than screening on nothing.
      const parentName = String(parentCompanies[e.key] || '').trim();
      const parentRev = parentName ? (revenueResearch[revSlug(parentName)] || null) : null;
      const parentRevenueLabel = String(parentRev?.revenue || '').trim();
      const { label: revenueLabel, entity: revenueEntity } = pickThresholdRevenue({
        own: ownRevenueLabel,
        parent: parentRevenueLabel,
        parentName,
      });
      const revenueUsd = parseRevenueUsd(revenueLabel);
      const research = complianceResearch[e.key] || null;
      const employees = Number.isFinite(Number(revData?.employees)) && Number(revData.employees) > 0
        ? Number(revData.employees)
        : null;

      // Headquarters, resolved the way the card's HQ row resolves it: this
      // company's own lookup, then the revenue-research run, then the HQ
      // Location the My Accounts page stores against the prospect record.
      const hqSlug = revSlug(name);
      const hqSaved = hqResearch[hqSlug] || null;
      const hqLocation = String(hqSaved?.location || '').trim()
        || String(revData?.headquarters || '').trim()
        || (prospect?.id ? String(hqRegionMap[prospect.id] || '').trim() : '');
      const hq = {
        location: hqLocation,
        source: hqSaved?.location ? 'HQ lookup'
          : revData?.headquarters ? 'revenue research'
          : hqLocation ? 'My Accounts HQ Location' : '',
        region: normalizeHqRegion(hqSaved?.region)
          || normalizeHqRegion(revData?.hqRegion)
          || classifyHqRegion(hqLocation)
          || normalizeHqRegion(prospect?.hqRegion)
          || '',
      };

      // The same context the card's JurisdictionScreening builds, so every
      // derived verdict in the workbook is the one the card is showing —
      // including the CSRD figures and CBAM import verdicts the compliance
      // research run turned up and the EU answer Wave 2 reads.
      const criterionContext = {
        revenueUsd,
        revenueLabel,
        revenueEntity,
        caSiteCount: e.california,
        employees,
        csrd: research?.csrd || null,
        csrdNotes: research?.csrdNotes || null,
        cbam: research?.cbam || null,
        cbamNotes: research?.cbamNotes || null,
        euAnswer: answers.eu || '',
      };
      // California turns on revenue AND doing business there. Under the
      // lowest threshold nothing can bite, so the card rules the whole
      // jurisdiction out and reads its doing-business rows N/A; the sheet
      // carries both facts rather than a bare column of Nos.
      const doingBusinessInCA = deriveDoingBusinessInCA(answers, criterionContext);
      const caScreen = californiaRevenueScreen(answers, criterionContext);
      const caRuledOut = caScreen.screenedOut;
      const caRuledOutWhy = `Revenue is under ${caScreen.floorLabel}, the lowest California threshold, so no California mandate can apply and this test can't change that.`;

      // Per-jurisdiction detail mirroring the card's table, including each
      // regulation's Applies? verdict. A hand-picked answer (stored under
      // `<jurisdiction>__<regulation-slug>`) always wins over the derived
      // one — same precedence the card applies.
      const regulations = [];
      const jurisdictions = JURISDICTION_QUESTIONS.map((q) => {
        const answer = answers[q.key] || '';
        const ruledOut = q.key === 'california' && caRuledOut;

        // The workings the card spells out above each jurisdiction's
        // mandates — California's revenue thresholds and one-of-three
        // doing-business test, the EU's CSRD screening figures. Always on,
        // exactly as on the card: they're how the jurisdiction's answer is
        // arrived at, so they don't wait for it.
        const criteriaGroups = (JURISDICTION_CRITERIA_GROUPS[q.key] || []).map((group) => {
          // Once revenue has ruled California out, the doing-business leg
          // can't change any verdict — those rows read N/A rather than
          // sitting there unanswered. The revenue rows stay live: they're
          // the evidence, and editing one is how the rule-out gets undone.
          const groupNA = ruledOut && group.key === 'doing-business';
          return {
            label: group.label,
            note: groupNA ? caRuledOutWhy : (group.note || ''),
            na: groupNA,
            rows: group.rows.map((row) => {
              const cKey = criterionKey(q.key, row.key);
              const saved = answers[cKey] || '';
              // A hand-entered value always wins; without one the card
              // works the row out from revenue, the site list, or research.
              const derived = saved ? null : deriveCriterion(row, criterionContext);
              return {
                label: row.label,
                screening: row.fromSiteCount
                  ? `${e.california} ${e.california === 1 ? 'site' : 'sites'} in CA`
                  : (row.note || ''),
                verdict: groupNA ? 'N/A' : (saved || derived?.verdict || ''),
                auto: !groupNA && !saved && !!derived,
                basis: groupNA ? caRuledOutWhy : (derived?.basis || ''),
                na: groupNA,
                reference: links(cKey),
                findings: findings[cKey] || '',
              };
            }),
          };
        });

        // Mandates surface for Yes and Unknown, and unconditionally for the
        // jurisdictions where seeing the regimes is part of answering the
        // question — the same ALWAYS_SHOW_REGULATIONS set the card uses.
        // Anything the user has already annotated stays visible regardless.
        const showRegs = answer === 'Yes' || answer === 'Unknown' || ALWAYS_SHOW_REGULATIONS.has(q.key);
        const regs = (REGULATIONS_BY_JURISDICTION[q.key] || []).map((reg) => {
          const regKey = `${q.key}__${String(reg.regulation || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
          const picked = answers[regKey] || '';
          const reference = links(regKey);
          const regFindings = findings[regKey] || '';
          if (!showRegs && !reference && !regFindings) return null;
          // California's mandates turn on revenue plus the doing-business
          // result above; the EU's waves derive from the CSRD rows instead
          // of a revenue threshold. Everything else is a plain threshold
          // test, or not derivable at all.
          const auto = picked ? null : (q.key === 'eu'
            ? deriveCsrdWaveVerdict(reg, { answers, context: criterionContext })
            : deriveRegulationVerdict(reg, {
              revenueUsd,
              revenueLabel,
              revenueEntity,
              jurisdictionAnswer: answer,
              jurisdictionLabel: q.jurisdiction,
              doingBusiness: q.key === 'california' ? doingBusinessInCA : undefined,
            }));
          const verdict = picked || auto?.verdict || '';
          if (verdict === 'Yes') regulations.push({ regulation: reg.regulation, timeline: reg.timeline });
          return {
            regulation: reg.regulation,
            timeline: reg.timeline,
            thresholds: (reg.thresholds || []).map(t => `${t.value} ${t.metric}`).join(' · '),
            description: reg.description || '',
            verdict,
            auto: !!auto,
            basis: auto?.basis || '',
            ruledOut,
            reference,
            findings: regFindings,
          };
        }).filter(Boolean);

        return {
          jurisdiction: q.jurisdiction,
          question: q.question,
          answer,
          note: research?.notes?.[q.key] || '',
          ruledOut,
          ruledOutWhy: ruledOut ? caRuledOutWhy : '',
          criteriaGroups,
          regulations: regs,
          reference: links(q.key),
          findings: findings[q.key] || '',
        };
      });

      out.push({
        name, california: e.california, total: e.total, caSites: e.caSites,
        yesJurisdictions, regulations, revenueLabel,
        revenueFiscalYear: revData?.fiscalYear || '',
        revenueSummary: revData?.summary || '',
        employees,
        hq,
        parent: parentName,
        parentRevenueLabel,
        parentRevenueFiscalYear: parentRev?.fiscalYear || '',
        // Which entity's revenue the verdicts below were derived from, and
        // this company's own figure when they differ — the sheet has to show
        // both or a reader can't check the working.
        revenueEntity,
        ownRevenueLabel,
        // Targets / frameworks / programmes / reports, resolved exactly as
        // the Corporate Compliance card resolves them: curated company-page
        // fields where they exist, saved research where they don't.
        sustainability: sustainabilityProfile({
          company: name,
          prospect,
          companyResearch,
        }),
        // Card-level screening state the jurisdiction rows are read against.
        doingBusinessInCA: doingBusinessInCA || '',
        caRuledOut,
        caRuledOutWhy: caRuledOut ? caRuledOutWhy : '',
        summary: research?.summary || '',
        sources: Array.isArray(research?.sources) ? research.sources : [],
        answeredAt: research?.savedAt || null,
        jurisdictions,
      });
    }
    return out.sort(
      (a, b) => b.regulations.length - a.regulations.length
        || b.california - a.california
        || b.total - a.total
        || a.name.localeCompare(b.name)
    );
  }

  async function exportIndicativeSavings({ returnBuffer = false, companyName = null, targetWb = null } = {}) {
    // The button is gated on sitesData.length, but the export reads
    // from `rows` — which strips entries without a Site Name when a
    // mapping is set. If every uploaded row is blank at the site-
    // name column, the export silently returned null and the click
    // looked like it did nothing. Throw so the caller's catch shows
    // the user what to fix.
    if (!rows.length) {
      throw new Error('No sites available to export: re-check the uploaded file or the Site Name column mapping.');
    }
    // Leased locations don't carry a savings projection unless the
    // toolbar's savings-scope button says they do — see the gate in
    // buildBucket. When they are being left out, the by-state tables grow
    // two columns that show the exclusion rather than leaving the gap
    // between spend and savings unexplained. A portfolio with nothing
    // leased (every upload that didn't map an Ownership column included)
    // exports exactly the sheet it did before, and so does one whose
    // leased sites are being counted in — with a line in the Savings
    // Summary band saying which basis this workbook was built on, since
    // the same portfolio can now produce two different headlines.
    const leasedScope = savingsOwnershipScope(rows);
    const excludeLeasedSavings = !includeLeasedSavings;
    const showLeasedColumns = excludeLeasedSavings && leasedScope.leased > 0;
    const noteLeasedScope = leasedScope.leased > 0;
    const { Workbook } = await import('exceljs');
    const SE_GREEN_DARK = 'FF009530';
    const SE_GREEN_LIGHT = 'FFE6F7EC';
    const SE_TEXT_DARK = 'FF1E293B';
    const SE_BORDER = 'FFD4DDE1';
    const SE_GREEN = 'FF3DCD58';
    const SE_SLATE = 'FF475569';
    // Amber used to flag estimated / indicative values on the Site Detail
    // sheet (modeled consumption, rate-derived cost, indicative rates).
    const SE_EST = 'FFB45309';
    // Red for a site whose energy intensity sits 25%+ away from the
    // estimate its property type carries — the same red the mapping
    // sheets use for a hard "no".
    const SE_VAR_OFF = 'FFB91C1C';

    // Total line for the three tier-overview tables (Portfolio Overview,
    // NAM, Europe). The tiers partition one population, so the total is
    // the portfolio in that scope — without it the reader has to add four
    // rows by hand to answer "and what is the whole thing?", which is the
    // first question the table invites. Bold on the light green band, with
    // a rule above it, so it reads as a summary rather than a fifth tier.
    //
    // `totals` carries the already-rounded per-row values, so the line
    // agrees with the column above it to the digit.
    const writeOverviewTotalRow = (ws, rowIdx, colCount, totals, pct) => {
      const r = ws.getRow(rowIdx);
      r.getCell(1).value = 'Total';
      r.getCell(2).value = totals.eSites;
      r.getCell(3).value = pct(totals.eSites);
      r.getCell(4).value = totals.gSites;
      r.getCell(5).value = pct(totals.gSites);
      r.getCell(6).value = totals.kwh;
      r.getCell(7).value = totals.dth;
      r.getCell(8).value = totals.cost;
      r.getCell(3).numFmt = '0.0%';
      r.getCell(5).numFmt = '0.0%';
      r.getCell(6).numFmt = '#,##0';
      r.getCell(7).numFmt = '#,##0';
      r.getCell(8).numFmt = '"$"#,##0';
      for (let ci = 1; ci <= colCount; ci++) {
        const cell = r.getCell(ci);
        cell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: SE_GREEN_DARK } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        cell.border = {
          top:    { style: 'thin', color: { argb: SE_GREEN_DARK } },
          bottom: { style: 'hair', color: { argb: SE_BORDER } },
          right:  { style: 'hair', color: { argb: SE_BORDER } },
        };
      }
      r.height = 20;
      return r;
    };

    // Mexico-specific helpers. Baja California / Baja California Sur
    // run on a grid separate from CFE's national system, so they
    // never count as a CFE sourcing opportunity. CFE is the only
    // viable counterparty for the rest of Mexico — other utilities
    // are private generators or self-supply and aren't a target.
    // Threshold: 6 GWh/yr (6,000,000 kWh) per site for the
    // procurement opportunity to be worth pursuing.
    const MEXICO_CFE_KWH_THRESHOLD = 6_000_000;
    // Same test the utility-lookup gate uses, so a Mexican site that got a
    // CFE match can't then fail the flag's own idea of "Mexico".
    const isMexico = isMexicoCountry;
    const isBajaState = (state) => /\bbaja\b/i.test(String(state || ''));
    const isCFE = (utility) => {
      const s = String(utility || '').toLowerCase();
      if (!s) return false;
      if (/\bcfe\b/.test(s)) return true;
      return /comisi[oó]n\s+federal\s+de\s+electricidad/.test(s);
    };
    const mexicoSiteFlag = (country, state, utility, kwh) => {
      if (!isMexico(country)) return '';
      if (isBajaState(state)) return '';
      const k = typeof kwh === 'number' && Number.isFinite(kwh) ? kwh : 0;
      if (k < MEXICO_CFE_KWH_THRESHOLD) return '⚠ Mexico consumption likely too low (< 6,000,000 kWh/yr)';
      if (isCFE(utility)) return '★ Potential Mexico sourcing opportunity (CFE, > 6,000,000 kWh/yr)';
      return '';
    };
    // ST / Prov bucketing uses the component-level effectiveStateCode,
    // shared with classifyMarket so a site is labelled by the same
    // state / country this sheet buckets it under.

    // Both commodities use a per-state curated savings range — see
    // ELECTRIC_DEREGULATION and GAS_DEREGULATION above for the
    // canonical status / range / lowPct / highPct lookup.

    // Distinct list joined with ", "; trims to a sensible cap so a
    // state with dozens of suppliers doesn't blow up the cell.
    // Placeholder strings that show up in the source data when no
    // real value is set — em-dash, hyphen, "N/A", etc. We treat them
    // as empty so they don't pollute the comma-joined Supplier /
    // Utility cells.
    const isPlaceholder = (s) => {
      const t = String(s || '').trim();
      if (!t) return true;
      if (/^[-\u2013\u2014_]+$/.test(t)) return true; // dashes / em / en / underscore
      if (/^(n\/a|na|none|null|tbd|unknown|\?|\.)$/i.test(t)) return true;
      return false;
    };
    const joinDistinct = (vals) => {
      const seen = new Set();
      const out = [];
      for (const v of vals) {
        const t = String(v ?? '').trim();
        if (!t || isPlaceholder(t)) continue;
        const k = t.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(t);
      }
      return out.join(', ');
    };
    const parseDate = (v) => {
      if (!v) return null;
      const t = Date.parse(v);
      return Number.isNaN(t) ? null : new Date(t);
    };
    const fmtDate = (d) => d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

    // Five-year monthly horizon used for the contract-aware savings
    // math. Anchored to the first of the current month so each "Year N"
    // column lines up to the same calendar boundary regardless of when
    // the export runs. monthStartDates[i] is the first day of horizon
    // month i (0-indexed); a site is "under contract" for that month
    // when the supplier contract end date is strictly after that
    // boundary, which zeroes its savings contribution for the month.
    const HORIZON_MONTHS = 60;
    const today = new Date();
    const horizonStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthStartDates = [];
    for (let i = 0; i < HORIZON_MONTHS; i++) {
      monthStartDates.push(new Date(horizonStart.getFullYear(), horizonStart.getMonth() + i, 1));
    }
    const monthShortLabels = monthStartDates.map(d =>
      d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }));

    // Helper: write a single space into an "empty" cell so long text
    // in the cell to the left can't overflow into this cell visually.
    // Excel will normally flag a space inside a number-formatted cell
    // with the green "number stored as text" triangle — we suppress
    // that indicator on those cells via ignoredErrors so the sheet
    // stays clean.
    const writeBlank = (cell, hasNumFmt) => {
      cell.value = ' ';
      if (hasNumFmt) cell.ignoredErrors = { numberStoredAsText: true };
    };
    // Integer-display formats — anything Excel would render with no
    // decimals. Spend / consumption / sites columns all flow through
    // here; rate / price columns ('$0.000') keep their precision.
    const isIntegerFmt = (fmt) => fmt === '#,##0' || fmt === '"$"#,##0';
    const ceilForFmt = (v, fmt) => {
      if (!isIntegerFmt(fmt)) return v;
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? Math.ceil(n) : v;
    };
    // Coerce a value into a real Excel-date-typed cell value when the
    // column is flagged as a date column.
    //  - Date instance → returned as-is.
    //  - Excel serial number (1-73050, covering 1900 – 2099) — whether
    //    arriving as a JS number or a numeric string from xlsxParse's
    //    raw:true read — gets converted to a JS Date.
    //  - Date-like string ("3/15/2025", "Mon Jan 15 2024 …") goes
    //    through new Date() and is returned as a Date when parseable.
    //  - Everything else (e.g. 'TBD', blanks, unparseable strings)
    //    passes through unchanged so the cell renders as text.
    const toExcelDate = (v) => {
      if (v == null || v === '') return v;
      if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : v;
      const asNum = typeof v === 'number'
        ? v
        : (typeof v === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(v) ? Number(v) : NaN);
      if (Number.isFinite(asNum) && asNum >= 1 && asNum < 73050) {
        // Excel's date epoch is 1899-12-30 (matching its 1900-leap-year
        // bug for any realistic date past 1900-03-01). Adding asNum
        // days from that epoch — in UTC, to avoid local-timezone DST
        // shifts that would flip the displayed day on either side of
        // midnight — yields the right calendar day in Excel.
        const ms = Date.UTC(1899, 11, 30) + asNum * 86400000;
        const d = new Date(ms);
        if (Number.isFinite(d.getTime())) return d;
      }
      const s = String(v).trim();
      if (!s) return v;
      const d = new Date(s);
      return Number.isFinite(d.getTime()) ? d : v;
    };
    // Helper: write a scenario-aware Excel formula and pre-emptively
    // silence the green "inconsistent formula" / "formula" warning
    // triangle that Excel sometimes raises when a column mixes
    // formulas with constants. Every scenario cell goes through this
    // so the workbook opens with no green chevrons on the audit tab.
    // Optional yearGate zeroes the cell when the term-length
    // dropdown sits below the gate.
    const writeScenarioFormula = (cell, low, mid, high, yearGate) => {
      const result = Number.isFinite(mid) ? mid : 0;
      cell.value = { formula: scenarioFormula(low, mid, high, yearGate), result };
      cell.ignoredErrors = { formula: true, formulaRange: true, numberStoredAsText: true };
    };
    // Helper: write a fixed numeric value behind the same year-gate as
    // the scenario cells, so reg-rate columns also disappear when the
    // user shrinks the term length.
    const writeYearGatedConstant = (cell, value, yearGate) => {
      const num = Number.isFinite(Number(value)) ? Number(value) : 0;
      cell.value = {
        formula: `IF(--${YEARS_REF}>=${yearGate},${num},0)`,
        result: num,
      };
      cell.ignoredErrors = { formula: true, formulaRange: true, numberStoredAsText: true };
    };
    // Month-level gate for the Monthly Savings Breakdown sheet —
    // zeroes any month column whose 1-indexed position is past the
    // term-length × 12 mark.
    const writeMonthGatedConstant = (cell, value, monthNum) => {
      const num = Number.isFinite(Number(value)) ? Number(value) : 0;
      cell.value = {
        formula: `IF(--${YEARS_REF}*12>=${monthNum},${num},0)`,
        result: num,
      };
      cell.ignoredErrors = { formula: true, formulaRange: true, numberStoredAsText: true };
    };

    function buildBucket(commodity) {
      const providerKey = `__${commodity}__`;
      const consumptionKey = commodity === 'electric' ? '__kwh__' : '__therms__';
      const costKey = `__${commodity}Cost__`;
      const supplierKey = commodity === 'electric' ? '__electricSupplier__' : '__gasSupplier__';
      const startKey = commodity === 'electric' ? '__electricStart__' : '__gasStart__';
      const endKey = commodity === 'electric' ? '__electricEnd__' : '__gasEnd__';
      // Per-bucket savings band: pre-resolved during bucket creation so
      // we can route US/Canada (state-keyed) and international (country-
      // keyed) buckets through the same lookup. `pctsFor` then just
      // reads the cached numbers off the bucket.
      const pctsFor = (g) => ({ lowPct: g.lowPct, highPct: g.highPct });
      const states = new Map();
      // Per-site detail kept for the Monthly Savings Breakdown sheet.
      const siteRows = [];
      for (const r of rows) {
        const state = effectiveStateCode(r);
        // International (non-US/Canada) sites bucket by country —
        // pulled from the row's resolved country tag and matched against
        // the COUNTRY_DEREGULATION reference. Falls back to skipping the
        // row when there's neither a state nor a recognized country.
        const country = state ? null : normalizeCountryName(r.__country__ || '');
        let bucketKey;
        let isCountryBucket = false;
        if (state) {
          bucketKey = state;
        } else if (country) {
          bucketKey = `__country__:${country}`;
          isCountryBucket = true;
        } else {
          continue;
        }
        let g = states.get(bucketKey);
        if (!g) {
          // Resolve the bucket's savings band once at creation. US/CA
          // buckets read the state-level ELECTRIC_DEREGULATION /
          // GAS_DEREGULATION maps; country buckets read the country
          // reference table. Both expose the same { status, range,
          // lowPct, highPct } shape so the rest of the code is source-
          // agnostic.
          let bandStatus;
          let bandRange = '';
          let bandLowPct = null;
          let bandHighPct = null;
          let countryRegRateOpportunity = false;
          if (isCountryBucket) {
            const entry = commodity === 'electric'
              ? countryElectricSavings(country)
              : countryGasSavings(country);
            bandStatus = entry?.status || 'No opportunity';
            bandRange = entry?.range ?? '';
            bandLowPct = entry?.lowPct ?? null;
            bandHighPct = entry?.highPct ?? null;
            countryRegRateOpportunity = countryHasRegulatedRateOpportunity(country);
          } else {
            const entry = commodity === 'electric'
              ? ELECTRIC_DEREGULATION[state]
              : GAS_DEREGULATION[state];
            if (entry) {
              bandStatus = entry.status;
              bandRange = entry.range ?? '';
              bandLowPct = entry.lowPct ?? null;
              bandHighPct = entry.highPct ?? null;
            } else {
              // State absent from the curated list → regulated market
              // ('no'). The curated ELECTRIC_DEREGULATION /
              // GAS_DEREGULATION maps are the source of truth for which
              // states are deregulated; an unlisted state carries zero
              // commodity savings and folds into the regulated-markets
              // summary downstream. The band is left unset so no site here
              // can accrue indicative savings.
              bandStatus = 'no';
              bandRange = '';
              bandLowPct = null;
              bandHighPct = null;
            }
          }
          g = {
            // `state` here is the bucket label that lands in the ST /
            // Prov / Country column — either a US/CA state code or a
            // country name. Lookup uses bucketKey above so two buckets
            // can't ever collide.
            state: isCountryBucket ? country : state,
            isCountry: isCountryBucket,
            status: bandStatus,
            range: bandRange,
            lowPct: bandLowPct,
            highPct: bandHighPct,
            // True when the country's Power Rate Optimization column is
            // Deregulated or Some deregulation — drives the country-
            // level reg-rate motion below. Always false for US/CA
            // buckets, which use the per-utility curated list instead.
            countryRegRateOpportunity,
            totalSites: 0,
            deregulatedSites: 0,
            // Sites in this bucket the upload marked Leased. They are
            // listed and counted like any other site; what they never do
            // is carry a savings number — see the savings gate in the
            // per-site loop below.
            leasedSites: 0,
            regulatedRateOpportunitySites: 0,
            regulatedRateOpportunitySpend: 0,
            consumption: 0,
            spend: 0,
            // The slice of `spend` the savings range is applied to:
            // deregulated spend less the leased locations'. Equal to
            // `spend` on a portfolio with nothing leased.
            savingsEligibleSpend: 0,
            utilities: [],
            suppliers: [],
            starts: [],
            ends: [],
            // Per-month savings vectors that already have contract
            // gating baked in; year totals are slices of these.
            monthlyLow: new Array(HORIZON_MONTHS).fill(0),
            monthlyMid: new Array(HORIZON_MONTHS).fill(0),
            monthlyHigh: new Array(HORIZON_MONTHS).fill(0),
            // Flags surfaced on the by-state sheet's Flags column.
            // Computed in the post-loop map() once we know the state's
            // total electric / gas spend + consumption.
            hasMexicoSourcing: false,
            // Aggregates that include regulated sites too — needed for
            // VA / AZ / MI flags that fire on any electric load,
            // independent of the dereg gate that filters g.consumption.
            anyConsumption: 0,
            maxSiteConsumption: 0,
          };
          states.set(bucketKey, g);
        }
        g.totalSites += 1;
        // Indicative savings are a procurement motion on the supply
        // contract behind the meter, and on a leased location that
        // contract is the landlord's more often than not — so this
        // export never projects savings onto one. The site still counts
        // in Total Sites, still contributes its utility and its load to
        // the market picture, and is called out in its own column; what
        // it doesn't do is add spend to the basis the savings range is
        // applied to, here or in the reg-rate motion below.
        const isLeased = isLeasedUtilityRow(r);
        if (isLeased) g.leasedSites += 1;
        // Whether that removes the site from the savings basis is the
        // toolbar toggle's call: a triple-net portfolio holding its own
        // supply contracts counts them in.
        const outOfSavingsScope = isLeased && excludeLeasedSavings;
        // Track consumption across every site (including regulated ones)
        // so flags that fire on "any electric load" or "single-site load
        // above N" can see sites the dereg gate would otherwise skip.
        const rawConsumption = r[consumptionKey];
        if (typeof rawConsumption === 'number' && Number.isFinite(rawConsumption) && rawConsumption > 0) {
          const normalized = commodity === 'gas' ? rawConsumption / 10 : rawConsumption;
          g.anyConsumption += normalized;
          if (normalized > g.maxSiteConsumption) g.maxSiteConsumption = normalized;
        }
        const provider = r[providerKey];
        // Track the regulated utility for every site (not just the
        // deregulated ones) so the Utility column captures PG&E /
        // ComEd / Dominion etc. even on regulated rows.
        if (provider) g.utilities.push(provider);
        // Reg-rate motion. US/CA: count any electric site whose utility
        // is on the curated (state, utility) opportunity list. Country
        // buckets: count every electric site in the country when the
        // country's Power Rate Optimization column says Deregulated /
        // Some deregulation AND the country's electric market itself
        // isn't already deregulated (otherwise the commodity-savings
        // motion already captures it; doubling up would inflate).
        if (commodity === 'electric') {
          if (isCountryBucket) {
            const electricIsDereg = g.status === 'Deregulated' || g.status === 'Some deregulation';
            if (g.countryRegRateOpportunity && !electricIsDereg) {
              g.regulatedRateOpportunitySites += 1;
              const regCost = r[costKey];
              // Spend, not the site count, is what the flat 0.25 % is
              // taken off — so a leased location is counted here and
              // still contributes nothing to the reg-rate savings.
              if (!outOfSavingsScope && typeof regCost === 'number' && Number.isFinite(regCost)) {
                g.regulatedRateOpportunitySpend += regCost;
              }
            }
          } else if (isRegulatedRateOpportunity(state, provider)) {
            g.regulatedRateOpportunitySites += 1;
            const regCost = r[costKey];
            if (!outOfSavingsScope && typeof regCost === 'number' && Number.isFinite(regCost)) {
              g.regulatedRateOpportunitySpend += regCost;
            }
          }
        }
        // Mexico tracking: a state / bucket counts as a sourcing
        // opportunity only when at least one site there is on CFE
        // (Comisión Federal de Electricidad), has > 6 GWh/yr of
        // consumption, and isn't in Baja (which runs on a grid
        // separate from CFE's national system). Runs before the
        // dereg gate so a regulated CFE site still surfaces.
        if (commodity === 'electric'
          && isMexico(r.__country__)
          // The uploaded subdivision, not __state__: Mexico resolves no
          // US state code, so "Baja California" only survives on the raw
          // field.
          && !isBajaState(r.__stateRaw__ || r.__state__)
          && isCFE(r.__electric__)) {
          const kwh = (typeof r.__kwh__ === 'number' && Number.isFinite(r.__kwh__)) ? r.__kwh__ : 0;
          if (kwh > MEXICO_CFE_KWH_THRESHOLD) g.hasMexicoSourcing = true;
        }
        // Deregulation gate — see classifyMarket for the rule (curated
        // state map first, then the per-utility classifier / supplier
        // inside a competitive state; country reference for international
        // sites). This sheet's Deregulated Sites column is the number the
        // page's Market card and the Overview tabs are held to.
        if (classifyMarket(r, commodity) !== 'Deregulated') continue;
        g.deregulatedSites += 1;
        const consumption = r[consumptionKey];
        if (typeof consumption === 'number' && Number.isFinite(consumption)) {
          // Gas: kWh-equivalent therms → Dth (÷10) for the export column.
          g.consumption += commodity === 'gas' ? consumption / 10 : consumption;
        }
        const cost = r[costKey];
        const spend = (typeof cost === 'number' && Number.isFinite(cost)) ? cost : 0;
        if (spend) {
          g.spend += spend;
          if (!outOfSavingsScope) g.savingsEligibleSpend += spend;
        }
        // Only count an actual supplier here — never fall back to the
        // utility name. A deregulated site with no supplier on file
        // contributes nothing to the Supplier Name column rather than
        // polluting it with utility names like "Port Authority of NY".
        const supplierName = r[supplierKey] || '';
        if (supplierName) g.suppliers.push(supplierName);
        const ds = parseDate(r[startKey]);
        const de = parseDate(r[endKey]);
        if (ds) g.starts.push(ds);
        if (de) g.ends.push(de);

        // Build the per-site monthly savings vector with contract
        // gating: zero for any month whose first day is still inside
        // the supplier's contract window. The state vector is a
        // running sum of these.
        const { lowPct, highPct } = pctsFor(g);
        // A leased location gets a zero savings vector rather than a
        // skipped one: it stays on the Monthly Savings sheet with its
        // spend and its contract dates intact, showing $0 every month.
        const savingsSpend = outOfSavingsScope ? 0 : spend;
        const annualLow = (savingsSpend > 0 && lowPct != null) ? savingsSpend * lowPct : 0;
        const annualHigh = (savingsSpend > 0 && highPct != null) ? savingsSpend * highPct : 0;
        const annualMid = (annualLow + annualHigh) / 2;
        const monthlyLowAmt = annualLow / 12;
        const monthlyMidAmt = annualMid / 12;
        const monthlyHighAmt = annualHigh / 12;
        const siteLow = new Array(HORIZON_MONTHS).fill(0);
        const siteMid = new Array(HORIZON_MONTHS).fill(0);
        const siteHigh = new Array(HORIZON_MONTHS).fill(0);
        let monthsUnderContract = 0;
        for (let i = 0; i < HORIZON_MONTHS; i++) {
          const monthStart = monthStartDates[i];
          const isUnderContract = de && de > monthStart;
          if (isUnderContract) {
            monthsUnderContract += 1;
            continue;
          }
          siteLow[i] = monthlyLowAmt;
          siteMid[i] = monthlyMidAmt;
          siteHigh[i] = monthlyHighAmt;
          g.monthlyLow[i] += monthlyLowAmt;
          g.monthlyMid[i] += monthlyMidAmt;
          g.monthlyHigh[i] += monthlyHighAmt;
        }
        siteRows.push({
          siteName: siteNameColumn ? String(r[siteNameColumn] || '').trim() : '',
          // Mirror the bucket label so the Monthly Savings sheet shows
          // either the US/CA state code or the country name in the
          // ST / Prov / Country column.
          state: g.state,
          commodity,
          utility: provider || '',
          supplier: supplierName,
          // Owned / Leased / blank, straight off the upload. Shown on
          // the ledger so a row sitting at $0 every month says why.
          ownership: r.__ownership__ || '',
          annualSpend: Math.round(spend),
          // A leased location has no savings band applied, so the band
          // reads blank here rather than showing a rate that produced
          // nothing.
          lowPct: outOfSavingsScope ? null : lowPct,
          highPct: outOfSavingsScope ? null : highPct,
          annualLow: Math.round(annualLow),
          annualMid: Math.round(annualMid),
          annualHigh: Math.round(annualHigh),
          contractStart: ds ? fmtDate(ds) : (supplierName ? 'TBD' : ''),
          contractEnd: de ? fmtDate(de) : (supplierName ? 'TBD' : ''),
          contractStartDate: ds,
          contractEndDate: de,
          monthsUnderContract,
          monthsOffContract: HORIZON_MONTHS - monthsUnderContract,
          fiveYearLow: siteLow.reduce((a, b) => a + b, 0),
          fiveYearMid: siteMid.reduce((a, b) => a + b, 0),
          fiveYearHigh: siteHigh.reduce((a, b) => a + b, 0),
          monthlyLow: siteLow,
          monthlyMid: siteMid,
          monthlyHigh: siteHigh,
        });
      }
      // Markets ranked by deregulated spend, largest first — so the
      // by-state Indicative Savings tables open with the biggest
      // commodity-savings opportunities at the top. Ties fall back to
      // state-code alphabetical so the order is stable.
      const out = [...states.values()].sort((a, b) => {
        const ds = (Number(b.spend) || 0) - (Number(a.spend) || 0);
        if (ds !== 0) return ds;
        return String(a.state).localeCompare(String(b.state));
      });
      const stateRows = out.map(g => {
        // Each bucket already resolved its savings band at creation —
        // US/CA from ELECTRIC_DEREGULATION / GAS_DEREGULATION, countries
        // from the COUNTRY_DEREGULATION reference. Pull straight off the
        // bucket so the source-of-truth lookup happens in exactly one
        // place.
        // Status comes straight off the bucket's curated band. US/CA
        // states absent from the deregulation map stay 'no' (regulated)
        // and fold into the regulated-markets summary downstream — the
        // per-site loop above only accrues deregulated sites/spend inside
        // states the curated map actually lists as deregulated, so a
        // regulated state never carries deregulated spend to promote.
        const status = g.status;
        const range = g.range ?? '';
        const { lowPct, highPct } = pctsFor(g);
        const hasPct = lowPct != null && highPct != null;
        // Year-N cumulative = sum of the per-state monthly vector
        // through month N*12. Each month is already gated by its
        // sites' contract end dates, so a state where every site is
        // locked into a 3-year contract starts contributing in month
        // 37 (year 4) and not before.
        const sumThrough = (arr, months) => {
          let s = 0;
          const upto = Math.min(months, arr.length);
          for (let i = 0; i < upto; i++) s += arr[i] || 0;
          return s;
        };
        // Per-year low / mid / high cumulatives — the scenario toggle
        // at the top of the sheet picks one of these via formula. Mid
        // is the canonical default ("Base"); low/high feed the
        // Conservative / Aggressive scenarios.
        const cumByYear = (months) => ({
          low:  sumThrough(g.monthlyLow,  months),
          mid:  sumThrough(g.monthlyMid,  months),
          high: sumThrough(g.monthlyHigh, months),
        });
        const yr1 = cumByYear(12);
        const yr2 = cumByYear(24);
        const yr3 = cumByYear(36);
        const yr4 = cumByYear(48);
        const yr5 = cumByYear(60);
        const earliest = g.starts.length ? new Date(Math.min(...g.starts.map(d => d.getTime()))) : null;
        const latest = g.ends.length ? new Date(Math.max(...g.ends.map(d => d.getTime()))) : null;
        // Regulated-rate sites get a flat 0.25 % savings off their
        // total electric spend — gas has no equivalent reg-rate motion
        // so this stays 0 for the gas bucket. Reg-rate is a utility-
        // tariff motion (no third-party supplier contract), so it is
        // intentionally NOT gated by the supplier contract dates.
        const regRateSavings = commodity === 'electric'
          ? Math.round(g.regulatedRateOpportunitySpend * 0.0025)
          : 0;
        const regYearN = (n) => regRateSavings > 0 ? regRateSavings * n : '';
        const triple = (t) => hasPct
          ? { low: Math.round(t.low), mid: Math.round(t.mid), high: Math.round(t.high) }
          : null;
        return {
          state: g.state,
          status,
          totalSites: g.totalSites,
          deregulatedSites: g.deregulatedSites,
          leasedSites: g.leasedSites,
          regulatedRateOpportunitySites: g.regulatedRateOpportunitySites,
          regulatedRateOpportunitySpend: Math.round(g.regulatedRateOpportunitySpend),
          regRateSavings,
          consumption: Math.round(g.consumption),
          spend: Math.round(g.spend),
          // What the savings columns are actually a percentage of.
          savingsEligibleSpend: Math.round(g.savingsEligibleSpend),
          range,
          // European country buckets resolve to a "TBD" band (no
          // committed lowPct/highPct) — flagged here so the by-state
          // writer shows TBD in the Low/High cells and a flat $0/0 % in
          // the savings columns instead of a formula that errors against
          // the empty percentage inputs.
          isTbd: range === 'TBD',
          // Per-state flags joined with newlines so the cell wraps
          // visibly on the by-state sheet. Electric: small market
          // (< $1M dereg spend), Risk Management consideration
          // (> 10,000 MWh dereg consumption — kWh > 10M), Mexico
          // sourcing opportunity (any Mexican site with > 1 MWh).
          // Gas: too-low-for-sourcing (< $30K dereg spend).
          flags: (() => {
            const out = [];
            if (commodity === 'electric') {
              if (g.spend > 0 && g.spend < 1_000_000) out.push('⚠ Spend < $1M: small electric market');
              // g.consumption is the sum of every site's __kwh__ in
              // this state (kilowatt-hours per year). Divide by 1000
              // to convert to MWh before comparing to the 10,000 MWh
              // Risk Management threshold.
              const consumptionMWh = g.consumption / 1000;
              // Risk Management is a NAM-only offering: US / Canada
              // state buckets always qualify; country buckets only
              // when the reference table places the country in North
              // America (e.g. Mexico). International markets skip it.
              const isNamMarket = !g.isCountry
                || COUNTRY_DEREGULATION[g.state]?.region === 'North America';
              if (isNamMarket && consumptionMWh > 10_000) out.push('⚠ Risk Management should be considered (>10,000 MWh)');
              // Wholesale Plus: > 44,000 MWh/yr of deregulated electric
              // in a single state is large enough to justify exploring
              // the structured wholesale procurement product.
              if (consumptionMWh > 44_000) out.push('★ Wholesale Plus should be explored (>44,000 MWh)');
              if (g.hasMexicoSourcing) out.push('★ Potential Mexico sourcing opportunity');
              // Virginia heavy-load gating: VA's retail-choice program
              // only opens up for a single site above 45,000 MWh/yr —
              // no aggregation across sites, so we compare against the
              // largest individual site's kWh.
              if (g.state === 'VA' && g.maxSiteConsumption / 1000 > 45_000) {
                out.push('★ Virginia site exceeds 45,000 MWh/yr: large-load deregulation threshold met');
              }
              // Arizona / Michigan: limited retail-choice markets where
              // we can only support a customer if they already have a
              // third-party supply contract in place. Fires on any
              // electric load — even regulated sites — so the seller
              // sees the gating up front.
              if ((g.state === 'AZ' || g.state === 'MI') && g.anyConsumption > 0) {
                out.push('⚠ Limited market: can only help if 3rd-party supply is already in place');
              }
            } else if (commodity === 'gas') {
              if (g.spend > 0 && g.spend < 30_000) out.push('⚠ Natural gas consumption might be too low for sourcing (<$30K)');
            }
            return out.join('\n');
          })(),
          // Savings rate as a scenario-aware decimal so the Savings %
          // column on the by-state sheet picks one of low / mid / high
          // depending on the toggle. Stored raw (0.02 etc.) — the
          // cell's '0.0%' format handles display, no string coercion.
          savingsPct: hasPct
            ? { low: lowPct, mid: (lowPct + highPct) / 2, high: highPct }
            : null,
          // Raw low / high percentages exposed so the by-state sheet
          // can write them as editable input cells; downstream
          // formula-driven cells read these to recompute Savings % /
          // Annual / Year 1-5 live when the user edits them.
          lowPct: hasPct ? lowPct : null,
          highPct: hasPct ? highPct : null,
          // Each scenario-aware triple is `{ low, mid, high }` (or null
          // when the state has no savings band). The writeSection
          // helper turns these into Excel formulas keyed off the
          // scenario cell so flipping the toggle re-renders every
          // savings number on the sheet.
          annualSavings: triple(yr1),
          year1: triple(yr1),
          year2: triple(yr2),
          year3: triple(yr3),
          year4: triple(yr4),
          year5: triple(yr5),
          regYear1: regYearN(1),
          regYear2: regYearN(2),
          regYear3: regYearN(3),
          regYear4: regYearN(4),
          regYear5: regYearN(5),
          utilities: joinDistinct(g.utilities),
          suppliers: joinDistinct(g.suppliers),
          // When the state has a supplier on record but no parseable
          // contract dates, surface "TBD" so the export tells the user
          // a date is expected vs leaving the cell blank (which reads
          // as no contract at all).
          earliestStart: earliest ? fmtDate(earliest) : (g.suppliers.length > 0 ? 'TBD' : ''),
          latestEnd: latest ? fmtDate(latest) : (g.suppliers.length > 0 ? 'TBD' : ''),
        };
      });
      return { stateRows, siteRows };
    }

    const { stateRows: electricRows, siteRows: electricSiteRows } = buildBucket('electric');
    const { stateRows: gasRows, siteRows: gasSiteRows } = buildBucket('gas');

    // Combined-export mode builds these sheets into a shared workbook so
    // the Indicative Savings tabs sit alongside the compliance exports.
    const wb = targetWb || new Workbook();
    wb.creator = 'Schneider Electric · Prospect Tracker';
    wb.created = new Date();
    // ---- Executive Summary sheet (tab #1) ---------------------------
    // Created first so it leads the workbook; it's populated further
    // down (see "Populate the Executive Summary tab") once the
    // Indicative Savings headline figures and the building-compliance
    // screening totals have been computed.
    const summarySheet = wb.addWorksheet('Summary', {
      properties: { tabColor: { argb: SE_GREEN } },
      views: [{ showGridLines: false }],
    });
    // Captured inside the Hedging Analysis sheet builder so the chart
    // injection at the end of the export knows which rows to plot.
    let hedgingChartRange = null;
    // Same trick for the Gas Market Timing tab — its chart bounds get
    // ferried out via closure to the injection block at the end of the
    // export.
    let gasTimingChartRange = null;

    // ---- Portfolio Overview sheet -----------------------------------
    // World map + per-bucket dot rendering. Each dot is split
    // vertically — left half colored by electric deregulation tier,
    // right half by gas — so the user can read both commodities at
    // once. Sites bucket by US state / Canadian province / country;
    // dot radius scales with site count. Map is rendered to a canvas
    // and embedded as a PNG because ExcelJS doesn't write charts.
    {
      const ws = wb.addWorksheet('Global', {
        properties: { tabColor: { argb: SE_GREEN_DARK } },
        views: [{ showGridLines: false }],
      });
      // The legend now lives on the map canvas itself (matching the
      // NAM View treatment). COLS spans out to column T so the green
      // title band covers the full width of the two-panel map image,
      // exactly like the NAM View.
      const MAP_COLS = 14;
      const LEGEND_COLS = 6;
      const COLS = MAP_COLS + LEGEND_COLS;
      // Widen the columns the summary tables use for large numbers
      // — Load (kWh / Dth) and Cost — so a comma-formatted figure
      // like "12,345,678" or "$1,234,567" doesn't get truncated.
      // Columns E (5) and G (7) are the user-visible big-number
      // columns on the Country level view; F and H benefit too.
      const NUMERIC_WIDE_COLS = new Set([5, 6, 7, 8]);
      ws.columns = [
        ...Array.from({ length: MAP_COLS }, (_, i) => ({
          width: NUMERIC_WIDE_COLS.has(i + 1) ? 17 : 12,
        })),
        // Cols O–T kept narrow so the worksheet's right edge sits next
        // to the two-panel map image instead of leaving a wide empty
        // band — the title band merges through column T to span the map.
        { width: 4 },
        { width: 6 },
        { width: 6 },
        { width: 12 },
        { width: 12 },
        { width: 12 },
      ];

      // Bucket sites by (country, state-or-province) and look up the
      // dereg tier + map coordinates. The lookup chain is:
      //   1. US/CA site with state code in the per-state center map →
      //      drop dot at the state's centroid, tier from
      //      ELECTRIC_DEREGULATION / GAS_DEREGULATION.
      //   2. International site whose country is in COUNTRY_CENTERS →
      //      drop dot at the country center, tier from
      //      COUNTRY_DEREGULATION.
      //   3. Country we don't have a center for → skip the dot but
      //      still count in the summary table.
      const buckets = new Map();
      let skippedCount = 0;
      for (const r of rows) {
        const rawCountry = String(r.__country__ || '').trim();
        const country = normalizeCountryName(rawCountry) || rawCountry;
        const stateCode = String(r.__state__ || '').trim().toUpperCase();
        let key, location, elecTier, gasTier, label;
        const isUS = /^(united states|usa|us)$/i.test(country);
        const isCA = /^(canada|ca)$/i.test(country);
        if (isUS && US_STATE_CENTERS[stateCode]) {
          key = `US/${stateCode}`;
          location = US_STATE_CENTERS[stateCode];
          label = `${stateCode}, USA`;
          // US states: 'yes' in the per-state dereg map → dereg;
          // 'large' → some deregulation; otherwise regulated.
          const e = ELECTRIC_DEREGULATION[stateCode];
          const g = GAS_DEREGULATION[stateCode];
          elecTier = deregStatusTier(e);
          gasTier  = deregStatusTier(g);
        } else if (isCA && CANADA_PROVINCE_CENTERS[stateCode]) {
          key = `CA/${stateCode}`;
          location = CANADA_PROVINCE_CENTERS[stateCode];
          label = `${stateCode}, Canada`;
          // Canada is universally deregulated in the country
          // reference for both commodities; per-province nuance is
          // out of scope for the map.
          elecTier = 'dereg';
          gasTier = 'dereg';
        } else if (COUNTRY_CENTERS[country]) {
          key = country;
          location = COUNTRY_CENTERS[country];
          label = country;
          const c = COUNTRY_DEREGULATION[country];
          elecTier = statusTier(c?.electric);
          gasTier = statusTier(c?.gas);
        } else {
          skippedCount++;
          continue;
        }
        if (!buckets.has(key)) {
          buckets.set(key, { location, elecTier, gasTier, label, count: 0 });
        }
        buckets.get(key).count++;
      }

      // How many sites the map itself could place, for the subtitle
      // below the title. This is a statement about the map, not about
      // the portfolio — the Overview table counts every row (see
      // below), and the two figures differ by exactly skippedCount.
      let mappedSites = 0;
      for (const b of buckets.values()) mappedSites += b.count;

      // Per-tier sites + load + cost — keyed by the same tier label the
      // Overview table uses. `electric` tracks electric-tier
      // attribution (kWh + electric cost); `gas` tracks gas-tier
      // attribution (therms + gas cost).
      //
      // Sites are counted here, in the same per-row pass that attributes
      // the load and the cost, rather than off the map buckets. Taking
      // them from the buckets meant the two halves of each row described
      // different populations: a site whose country has no centroid is
      // skipped for the dot, so it added nothing to any tier's site
      // count, while this pass still booked its kWh and its spend. The
      // table then showed tiers carrying millions in cost against zero
      // sites, which reads as a bug in the numbers rather than as a gap
      // in the geographic reference. One pass, one population.
      const blankTierAgg = () => ({ sites: 0, kwh: 0, therms: 0, cost: 0 });
      const electricTierAgg = { dereg: blankTierAgg(), some: blankTierAgg(), reg: blankTierAgg(), mixed: blankTierAgg(), unknown: blankTierAgg() };
      const gasTierAgg      = { dereg: blankTierAgg(), some: blankTierAgg(), reg: blankTierAgg(), mixed: blankTierAgg(), unknown: blankTierAgg() };
      // Denominator for the tier percentages, and the site figure the
      // Total row reports. Every row lands in exactly one electric tier
      // and one gas tier, so each commodity's column sums to this.
      let overviewSites = 0;
      const rowTierFor = (commodity, country, stateCode, isUS, isCA) => {
        if (isUS && US_STATE_CENTERS[stateCode]) {
          const m = commodity === 'electric' ? ELECTRIC_DEREGULATION[stateCode] : GAS_DEREGULATION[stateCode];
          return deregStatusTier(m);
        }
        if (isCA && CANADA_PROVINCE_CENTERS[stateCode]) return 'dereg';
        const c = COUNTRY_DEREGULATION[country];
        if (!c) return 'unknown';
        return statusTier(commodity === 'electric' ? c.electric : c.gas);
      };
      for (const r of rows) {
        const rawCountry = String(r.__country__ || '').trim();
        const country = normalizeCountryName(rawCountry) || rawCountry;
        const stateCode = String(r.__state__ || '').trim().toUpperCase();
        const isUS = /^(united states|usa|us)$/i.test(country);
        const isCA = /^(canada|ca)$/i.test(country);
        const eTier = rowTierFor('electric', country, stateCode, isUS, isCA);
        const gTier = rowTierFor('gas',      country, stateCode, isUS, isCA);
        electricTierAgg[eTier].sites++;
        gasTierAgg[gTier].sites++;
        overviewSites++;
        if (typeof r.__kwh__ === 'number' && Number.isFinite(r.__kwh__)) electricTierAgg[eTier].kwh += r.__kwh__;
        if (typeof r.__therms__ === 'number' && Number.isFinite(r.__therms__)) gasTierAgg[gTier].therms += r.__therms__;
        const eCost = (typeof r.__electricCostActual__ === 'number' && Number.isFinite(r.__electricCostActual__))
          ? r.__electricCostActual__
          : (typeof r.__electricCostEstimated__ === 'number' && Number.isFinite(r.__electricCostEstimated__) ? r.__electricCostEstimated__ : 0);
        const gCost = (typeof r.__gasCostActual__ === 'number' && Number.isFinite(r.__gasCostActual__))
          ? r.__gasCostActual__
          : (typeof r.__gasCostEstimated__ === 'number' && Number.isFinite(r.__gasCostEstimated__) ? r.__gasCostEstimated__ : 0);
        electricTierAgg[eTier].cost += eCost;
        gasTierAgg[gTier].cost += gCost;
      }

      // Per-country aggregation for the choropleth fill + the
      // country-breakdown table below the map. Aggregates EVERY row
      // (including the un-mappable ones the dot pass skipped) so the
      // table is a faithful portfolio summary even when a country
      // doesn't have a center we can drop a dot at.
      const countryAggs = new Map();
      for (const r of rows) {
        const rawCountry = String(r.__country__ || '').trim();
        const country = normalizeCountryName(rawCountry) || rawCountry;
        if (!country) continue;
        let agg = countryAggs.get(country);
        if (!agg) {
          const c = COUNTRY_DEREGULATION[country];
          agg = {
            country,
            tier: c ? statusTier(c.electric) : 'unknown',
            elecStatus: c?.electric || '',
            gasStatus: c?.gas || '',
            sites: 0,
            kwh: 0,
            therms: 0,
            costActual: 0,
            costEstimated: 0,
          };
          countryAggs.set(country, agg);
        }
        agg.sites++;
        if (typeof r.__kwh__ === 'number' && Number.isFinite(r.__kwh__)) agg.kwh += r.__kwh__;
        if (typeof r.__therms__ === 'number' && Number.isFinite(r.__therms__)) agg.therms += r.__therms__;
        if (typeof r.__electricCostActual__ === 'number' && Number.isFinite(r.__electricCostActual__)) agg.costActual += r.__electricCostActual__;
        else if (typeof r.__electricCostEstimated__ === 'number' && Number.isFinite(r.__electricCostEstimated__)) agg.costEstimated += r.__electricCostEstimated__;
        if (typeof r.__gasCostActual__ === 'number' && Number.isFinite(r.__gasCostActual__)) agg.costActual += r.__gasCostActual__;
        else if (typeof r.__gasCostEstimated__ === 'number' && Number.isFinite(r.__gasCostEstimated__)) agg.costEstimated += r.__gasCostEstimated__;
      }
      // Rank by Annual Cost descending — the largest markets bubble
      // to the top so the country table reads as "where the spend
      // is" rather than "where the sites are." Ties fall back to
      // site count and then country name for stable ordering.
      const countryRows = [...countryAggs.values()].sort((a, b) => {
        const aCost = (a.costActual || 0) + (a.costEstimated || 0);
        const bCost = (b.costActual || 0) + (b.costEstimated || 0);
        if (bCost !== aCost) return bCost - aCost;
        if (b.sites !== a.sites) return b.sites - a.sites;
        return String(a.country).localeCompare(String(b.country));
      });

      // Canvas render — two side-by-side equirectangular world maps,
      // Natural Gas on the left and Electric Power on the right, mirroring
      // the NAM View. Each country is shaded by its deregulation status
      // (hue) and portfolio site count (darker = more sites); countries
      // with no sites stay light grey. No dots or site-count labels — the
      // choropleth alone carries the distribution.
      // Same panel dimensions as the NAM View so the two sheets' maps
      // are identically sized.
      const MAP_W = 800;
      const MAP_H = 500;
      const PAD = 16;
      const TITLE_H = 36;
      const LEGEND_H = 70;
      const W = MAP_W * 2 + PAD * 3;
      const H = TITLE_H + MAP_H + LEGEND_H + PAD * 2;
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, W, H);

      // NAM-style palette + helpers. statusTier returns
      // dereg/some/reg/unknown for a country; map to the NAM
      // categories (dereg/limited/reg) so the chips read the same
      // way across both sheets.
      const STATUS_FILL = {
        reg:     '#94A3B8', // slate
        dereg:   '#10B981', // emerald
        limited: '#F59E0B', // amber
      };
      const STATUS_LABEL = {
        reg:     'Regulated',
        dereg:   'Deregulated',
        limited: 'Limited Deregulation',
      };
      const NO_SITES_FILL   = '#E5E7EB';
      const NO_SITES_STROKE = '#9CA3AF';
      const tierToStatus = (tier) => {
        if (tier === 'dereg') return 'dereg';
        if (tier === 'some')  return 'limited';
        return 'reg'; // 'reg' or 'unknown' both fall through
      };

      // Per-country site count → choropleth density. Sqrt scaling
      // keeps a single-site country visibly tinted while the densest
      // market hits the full status hue plus a 20 % darken.
      const maxCountrySites = Math.max(1, ...Array.from(countryAggs.values()).map(a => a.sites));
      const argbToRgb = (hex) => {
        const h = String(hex).replace(/^#/, '').replace(/^FF/i, '');
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
      };
      const rgbToHex = (rgb) => '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
      const shadeForCount = (statusHex, count) => {
        if (count <= 0) return NO_SITES_FILL;
        const [r, g, b] = argbToRgb(statusHex);
        const t = Math.sqrt(count / maxCountrySites);
        const sat  = 0.45 + 0.55 * t;
        const dark = 0.20 * t;
        const blend = (c) => (c * sat + 255 * (1 - sat)) * (1 - dark);
        return rgbToHex([blend(r), blend(g), blend(b)]);
      };

      const countryFeatures = getCountryFeatures();

      // Antimeridian-aware feature drawing: countries that cross the date
      // line (Russia, Fiji, the Aleutians) have adjacent ring points whose
      // longitudes jump ~360°. Drawing those connectors straight in
      // equirectangular space streaks a line across the map, so we split
      // the ring at each big jump and draw each sub-ring as its own
      // closed polygon.
      const drawFeature = (project, rings) => {
        for (const ring of rings) {
          const subRings = [];
          let cur = [];
          let prevLng = null;
          for (const pt of ring) {
            if (prevLng !== null && Math.abs(pt[0] - prevLng) > 180) {
              if (cur.length > 2) subRings.push(cur);
              cur = [];
            }
            cur.push(pt);
            prevLng = pt[0];
          }
          if (cur.length > 2) subRings.push(cur);
          for (const sr of subRings) {
            ctx.beginPath();
            for (let i = 0; i < sr.length; i++) {
              const [px, py] = project(sr[i][0], sr[i][1]);
              if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          }
        }
      };

      // One world-map panel. Every country's color comes from its
      // COUNTRY_DEREGULATION entry for the chosen commodity (gas / electric)
      // — portfolio has sites → status hue shaded by density; no sites →
      // uniform light grey so the sites-having countries dominate visually.
      // The world is 2:1 (360° × 180°); fit it into the NAM-sized panel
      // while preserving that aspect so it isn't vertically stretched,
      // then centre it (the panel is taller than 2:1, so a thin ocean
      // band sits above and below the map).
      const worldScale = Math.min(MAP_W / 360, MAP_H / 180);
      const worldOffX = (MAP_W - 360 * worldScale) / 2;
      const worldOffY = (MAP_H - 180 * worldScale) / 2;
      const drawPanel = (originX, commodity, headerLabel) => {
        const project = (lng, lat) => [
          originX + worldOffX + (lng + 180) * worldScale,
          TITLE_H + worldOffY + (90 - lat) * worldScale,
        ];
        // Panel header above the map.
        ctx.fillStyle = '#0F172A';
        ctx.font = 'bold 18px Nunito Sans, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(headerLabel, originX + MAP_W / 2, TITLE_H - 10);

        // Clip every layer to the panel so geometry never bleeds past an
        // edge onto the adjacent panel or the legend strip below.
        ctx.save();
        ctx.beginPath();
        ctx.rect(originX, TITLE_H, MAP_W, MAP_H);
        ctx.clip();

        // Ocean tint inside the map area so land (no-sites grey) stays
        // distinct from sea.
        ctx.fillStyle = '#F1F5F9';
        ctx.fillRect(originX, TITLE_H, MAP_W, MAP_H);

        ctx.lineWidth = 0.5;
        ctx.strokeStyle = NO_SITES_STROKE;
        for (const feat of countryFeatures) {
          const derGKey = TOPO_NAME_TO_DEREG_KEY[feat.name] || feat.name;
          const c = COUNTRY_DEREGULATION[derGKey];
          const tier = c ? statusTier(commodity === 'gas' ? c.gas : c.electric) : 'unknown';
          const status = tierToStatus(tier);
          const sites = countryAggs.get(derGKey)?.sites || 0;
          ctx.fillStyle = sites > 0 ? shadeForCount(STATUS_FILL[status], sites) : NO_SITES_FILL;
          drawFeature(project, feat.rings);
        }
        ctx.restore();
      };

      drawPanel(PAD,             'gas',      'Natural Gas Markets');
      drawPanel(PAD * 2 + MAP_W, 'electric', 'Electric Power Markets');

      // Per-panel legends along the bottom — same chip set on both maps.
      const SWATCH = 22;
      const GAP_SWATCH_LABEL = 8;
      const GAP_ITEMS = 22;
      ctx.font = '13px Nunito Sans, Arial, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const itemW = (label) => SWATCH + GAP_SWATCH_LABEL + ctx.measureText(label).width;
      const drawPanelLegend = (originX) => {
        const labels = [
          { color: STATUS_FILL.dereg,   label: STATUS_LABEL.dereg },
          { color: STATUS_FILL.limited, label: STATUS_LABEL.limited },
          { color: STATUS_FILL.reg,     label: STATUS_LABEL.reg },
          { color: NO_SITES_FILL,       label: 'No portfolio sites' },
        ];
        const totalW = labels.reduce((a, it) => a + itemW(it.label), 0) + GAP_ITEMS * (labels.length - 1);
        let cursorX = originX + (MAP_W - totalW) / 2;
        const legendY = TITLE_H + MAP_H + PAD * 2;
        for (const it of labels) {
          ctx.fillStyle = it.color;
          ctx.fillRect(cursorX, legendY, SWATCH, SWATCH);
          ctx.strokeStyle = NO_SITES_STROKE;
          ctx.lineWidth = 0.8;
          ctx.strokeRect(cursorX, legendY, SWATCH, SWATCH);
          ctx.fillStyle = '#0F172A';
          ctx.fillText(it.label, cursorX + SWATCH + GAP_SWATCH_LABEL, legendY + SWATCH / 2);
          cursorX += itemW(it.label) + GAP_ITEMS;
        }
      };
      drawPanelLegend(PAD);
      drawPanelLegend(PAD * 2 + MAP_W);

      const dataUrl = canvas.toDataURL('image/png');
      const imageId = wb.addImage({ base64: dataUrl, extension: 'png' });

      // Title band.
      ws.mergeCells(1, 1, 1, COLS);
      const title = ws.getCell(1, 1);
      title.value = 'Global View: Site Distribution by Market';
      title.font = { name: 'Nunito Sans', bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
      title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
      title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(1).height = 30;

      ws.mergeCells(2, 1, 2, COLS);
      const sub = ws.getCell(2, 1);
      const subtotal = mappedSites;
      const skippedNote = skippedCount > 0 ? ` (${skippedCount} site${skippedCount === 1 ? '' : 's'} skipped: country not in the geographic reference)` : '';
      sub.value = `${subtotal} site${subtotal === 1 ? '' : 's'} across ${buckets.size} market${buckets.size === 1 ? '' : 's'}. Natural Gas (left) and Electric Power (right) maps each shade every country by its market status (hue) and portfolio site count (darker = more sites); countries with no sites stay light grey.${skippedNote}`;
      sub.font = { name: 'Nunito Sans', italic: true, size: 10, color: { argb: SE_SLATE } };
      sub.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
      ws.getRow(2).height = 36;

      // Anchor the image starting at row 4. Image dimensions are in
      // pixels; cell-grid sizing scales it visually. The legend now
      // lives on the canvas itself (matching NAM View), so there's no
      // separate Excel-cell legend block to the right of the image.
      ws.addImage(imageId, {
        tl: { col: 0, row: 3 },
        ext: { width: W, height: H },
      });

      // Overview table sits just below the map image. Anchored at
      // row 39 (same as the NAM View) so it clears the bottom edge of
      // the now NAM-sized 638-px map image above — the Country level
      // view follows immediately underneath (the country header recalcs
      // its row offset from this constant).
      const SUMMARY_START = 39;
      ws.mergeCells(SUMMARY_START, 1, SUMMARY_START, COLS);
      const sumHdr = ws.getCell(SUMMARY_START, 1);
      sumHdr.value = 'Overview';
      sumHdr.font = { name: 'Nunito Sans', bold: true, size: 12, color: { argb: SE_GREEN_DARK } };
      sumHdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
      sumHdr.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(SUMMARY_START).height = 22;

      const tableHeaderRow = SUMMARY_START + 1;
      const overviewHeaders = [
        'Tier',
        'Electric Sites',
        'Electric %',
        'Gas Sites',
        'Gas %',
        'Load (kWh)',
        'Load (Dth)',
        'Total Cost ($)',
      ];
      const hdr = ws.getRow(tableHeaderRow);
      overviewHeaders.forEach((label, i) => {
        const cell = hdr.getCell(i + 1);
        cell.value = label;
        cell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      });
      hdr.height = 22;
      const tierRows = [
        ['Deregulated',          'dereg'],
        ['Some deregulation',    'some'],
        ['Regulated / unlikely', 'reg'],
        ['No data',              'unknown'],
      ];
      const pct = (n) => overviewSites > 0 ? n / overviewSites : 0;
      // Totals accumulate the values actually written into each tier
      // row, so the Total line adds up to the column above it rather
      // than to a separately-rounded figure nobody can reconcile.
      const totals = { eSites: 0, gSites: 0, kwh: 0, dth: 0, cost: 0 };
      tierRows.forEach((tr, i) => {
        const r = ws.getRow(tableHeaderRow + 1 + i);
        const [label, tierKey] = tr;
        const eSites = electricTierAgg[tierKey]?.sites || 0;
        const gSites = gasTierAgg[tierKey]?.sites || 0;
        const kwh = Math.round(electricTierAgg[tierKey]?.kwh || 0);
        const dth = Math.round((gasTierAgg[tierKey]?.therms || 0) / 10); // therms → Dth
        const cost = Math.round((electricTierAgg[tierKey]?.cost || 0) + (gasTierAgg[tierKey]?.cost || 0));
        totals.eSites += eSites;
        totals.gSites += gSites;
        totals.kwh += kwh;
        totals.dth += dth;
        totals.cost += cost;
        r.getCell(1).value = label;
        r.getCell(2).value = eSites;
        r.getCell(3).value = pct(eSites);
        r.getCell(4).value = gSites;
        r.getCell(5).value = pct(gSites);
        r.getCell(6).value = kwh;
        r.getCell(7).value = dth;
        r.getCell(8).value = cost;
        r.getCell(3).numFmt = '0.0%';
        r.getCell(5).numFmt = '0.0%';
        r.getCell(6).numFmt = '#,##0';
        r.getCell(7).numFmt = '#,##0';
        r.getCell(8).numFmt = '"$"#,##0';
        for (let ci = 1; ci <= overviewHeaders.length; ci++) {
          r.getCell(ci).font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
          r.getCell(ci).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
          r.getCell(ci).border = {
            bottom: { style: 'hair', color: { argb: SE_BORDER } },
            right:  { style: 'hair', color: { argb: SE_BORDER } },
          };
        }
        r.height = 20;
      });
      writeOverviewTotalRow(ws, tableHeaderRow + 1 + tierRows.length, overviewHeaders.length, totals, pct);

      // ---- Country breakdown table -----------------------------
      // One row per country in the portfolio: dereg status, site
      // count, load (kWh + Dth), cost (actual + estimated). Sorted
      // by descending site count so the heaviest concentrations
      // sit at the top.
      if (countryRows.length > 0) {
        // +1 over the tier rows for the Total line, then the same
        // blank-row gap this table has always had below the Overview.
        const countryHdrRow = tableHeaderRow + tierRows.length + 4;
        ws.mergeCells(countryHdrRow, 1, countryHdrRow, COLS);
        const cHdr = ws.getCell(countryHdrRow, 1);
        cHdr.value = 'Country level view';
        cHdr.font = { name: 'Nunito Sans', bold: true, size: 12, color: { argb: SE_GREEN_DARK } };
        cHdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
        cHdr.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        ws.getRow(countryHdrRow).height = 22;

        const cTblHdrRow = countryHdrRow + 1;
        const cHdrCells = ws.getRow(cTblHdrRow);
        const cCols = [
          'Country',
          'Electric',
          'Gas',
          'Sites',
          'Load (kWh)',
          'Load (Dth)',
          'Annual Cost ($)',
        ];
        cCols.forEach((label, i) => {
          const cell = cHdrCells.getCell(i + 1);
          cell.value = label;
          cell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
          cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        });
        cHdrCells.height = 22;

        countryRows.forEach((cr, i) => {
          const rr = ws.getRow(cTblHdrRow + 1 + i);
          rr.getCell(1).value = cr.country;
          rr.getCell(2).value = cr.elecStatus || '';
          rr.getCell(3).value = cr.gasStatus || '';
          rr.getCell(4).value = cr.sites;
          rr.getCell(5).value = Math.round(cr.kwh);
          rr.getCell(6).value = Math.round(cr.therms / 10);
          rr.getCell(7).value = Math.round(cr.costActual + cr.costEstimated);
          rr.getCell(4).numFmt = '#,##0';
          rr.getCell(5).numFmt = '#,##0';
          rr.getCell(6).numFmt = '#,##0';
          rr.getCell(7).numFmt = '"$"#,##0';
          for (let ci = 1; ci <= 7; ci++) {
            rr.getCell(ci).font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
            rr.getCell(ci).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
            rr.getCell(ci).border = {
              bottom: { style: 'hair', color: { argb: SE_BORDER } },
              right:  { style: 'hair', color: { argb: SE_BORDER } },
            };
          }
          rr.height = 20;
        });
      }
    }

    // ---- North America Overview sheet --------------------------
    // Same map-and-summary treatment as the Portfolio Overview, but
    // scoped to US + Canadian sites only. The projection is bounded
    // to the NA bounding box so states / provinces fill the canvas
    // instead of being a handful of pixels on a world map, and the
    // bottom table breaks out per US state / Canadian province
    // rather than rolling up to the country level.
    {
      const ws = wb.addWorksheet('NAM', {
        properties: { tabColor: { argb: SE_GREEN_DARK } },
        views: [{ showGridLines: false }],
      });
      const MAP_COLS = 14;
      const LEGEND_COLS = 6;
      const COLS = MAP_COLS + LEGEND_COLS;
      const NUMERIC_WIDE_COLS = new Set([5, 6, 7, 8]);
      ws.columns = [
        ...Array.from({ length: MAP_COLS }, (_, i) => ({
          width: NUMERIC_WIDE_COLS.has(i + 1) ? 17 : 12,
        })),
        { width: 4 },
        { width: 6 },
        { width: 6 },
        // Cols R–T kept narrow so the worksheet's right edge sits next
        // to the two-panel map image instead of leaving a wide empty
        // band. The top green title band merges through column T so it
        // visually spans the full width of the map figure.
        { width: 12 },
        { width: 12 },
        { width: 12 },
      ];

      // Bucket NA sites by (state | province). Non-NA rows are
      // skipped — they're already covered on the Portfolio Overview
      // sheet, so dropping them here keeps this view focused.
      const buckets = new Map();
      for (const r of rows) {
        const { stateCode, isUS, isCA, isNA } = naScopeOf(r);
        if (!isNA) continue;
        let key, location, elecTier, gasTier, label;
        if (isUS && US_STATE_CENTERS[stateCode]) {
          key = `US/${stateCode}`;
          location = US_STATE_CENTERS[stateCode];
          label = `${stateCode}, USA`;
          const e = ELECTRIC_DEREGULATION[stateCode];
          const g = GAS_DEREGULATION[stateCode];
          elecTier = deregStatusTier(e);
          gasTier  = deregStatusTier(g);
        } else if (isCA && CANADA_PROVINCE_CENTERS[stateCode]) {
          key = `CA/${stateCode}`;
          location = CANADA_PROVINCE_CENTERS[stateCode];
          label = `${stateCode}, Canada`;
          elecTier = 'dereg';
          gasTier = 'dereg';
        } else {
          // NA row whose state code we don't have a centroid for
          // (rare — usually a malformed state). No dot on the map, but
          // it is still one of the company's sites: the per-row pass
          // below books it, its load and its spend under the "No data"
          // tier, so it has to be counted there too.
          continue;
        }
        if (!buckets.has(key)) {
          buckets.set(key, { location, elecTier, gasTier, label, count: 0, stateCode, country: isUS ? 'United States' : 'Canada' });
        }
        buckets.get(key).count++;
      }

      // Tier roll-up. Sites are counted in the same per-row pass that
      // attributes the load and the cost (below) rather than off the map
      // buckets: a site the map can't place is skipped for the dot, so
      // taking the counts from the buckets left the "No data" tier
      // reporting 24 M kWh and $4.5 M against 0 sites — the load was
      // real, the site behind it just never made it into the count.
      const blankTierAgg = () => ({ sites: 0, kwh: 0, therms: 0, cost: 0 });
      const electricTierAgg = { dereg: blankTierAgg(), some: blankTierAgg(), reg: blankTierAgg(), mixed: blankTierAgg(), unknown: blankTierAgg() };
      const gasTierAgg      = { dereg: blankTierAgg(), some: blankTierAgg(), reg: blankTierAgg(), mixed: blankTierAgg(), unknown: blankTierAgg() };
      const rowTierFor = (commodity, country, stateCode, isUS, isCA) => {
        if (isUS && US_STATE_CENTERS[stateCode]) {
          const m = commodity === 'electric' ? ELECTRIC_DEREGULATION[stateCode] : GAS_DEREGULATION[stateCode];
          return deregStatusTier(m);
        }
        if (isCA && CANADA_PROVINCE_CENTERS[stateCode]) return 'dereg';
        return 'unknown';
      };
      // Denominator for the tier percentages, and the site figure the
      // Total row reports: every NA row lands in exactly one electric
      // tier and one gas tier, so each commodity's column sums to this.
      let naSites = 0;
      // Per-state aggregation for the breakdown table at the bottom.
      const stateAggs = new Map();
      for (const r of rows) {
        const { country, stateCode, isUS, isCA, isNA } = naScopeOf(r);
        if (!isNA) continue;
        const eTier = rowTierFor('electric', country, stateCode, isUS, isCA);
        const gTier = rowTierFor('gas',      country, stateCode, isUS, isCA);
        electricTierAgg[eTier].sites++;
        gasTierAgg[gTier].sites++;
        naSites++;
        const kwh = (typeof r.__kwh__ === 'number' && Number.isFinite(r.__kwh__)) ? r.__kwh__ : 0;
        const therms = (typeof r.__therms__ === 'number' && Number.isFinite(r.__therms__)) ? r.__therms__ : 0;
        const eCost = (typeof r.__electricCostActual__ === 'number' && Number.isFinite(r.__electricCostActual__))
          ? r.__electricCostActual__
          : (typeof r.__electricCostEstimated__ === 'number' && Number.isFinite(r.__electricCostEstimated__) ? r.__electricCostEstimated__ : 0);
        const gCost = (typeof r.__gasCostActual__ === 'number' && Number.isFinite(r.__gasCostActual__))
          ? r.__gasCostActual__
          : (typeof r.__gasCostEstimated__ === 'number' && Number.isFinite(r.__gasCostEstimated__) ? r.__gasCostEstimated__ : 0);
        electricTierAgg[eTier].kwh += kwh;
        gasTierAgg[gTier].therms += therms;
        electricTierAgg[eTier].cost += eCost;
        gasTierAgg[gTier].cost += gCost;
        const key = `${isUS ? 'US' : 'CA'}/${stateCode || '-'}`;
        let agg = stateAggs.get(key);
        if (!agg) {
          const eDereg = ELECTRIC_DEREGULATION[stateCode];
          const gDereg = GAS_DEREGULATION[stateCode];
          agg = {
            label: stateCode || '-',
            country: isUS ? 'United States' : 'Canada',
            elecStatus: isCA ? 'Deregulated' : DEREG_TIER_LABEL[deregStatusTier(eDereg)],
            gasStatus:  isCA ? 'Deregulated' : DEREG_TIER_LABEL[deregStatusTier(gDereg)],
            sites: 0,
            kwh: 0,
            therms: 0,
            cost: 0,
          };
          stateAggs.set(key, agg);
        }
        agg.sites++;
        agg.kwh += kwh;
        agg.therms += therms;
        agg.cost += eCost + gCost;
      }

      // Two-panel choropleth — Natural Gas markets on the left,
      // Electric Power markets on the right. Both panels derive their
      // per-state / per-province status straight from the NA_CATEGORIES
      // table (US_MARKETS + CA_MARKETS) so the map always agrees with the
      // State / Province deregulation status table and the per-site
      // Electric / Gas Market columns. Each status string is bucketed
      // into one of the legend colours below; states / provinces with no
      // sites fade to a light grey so the highlighted set reads as a
      // single foreground layer.
      const statusBucket = (statusText) => {
        const s = String(statusText || '').toLowerCase();
        if (!s || s.startsWith('regulated')) return 'reg';
        if (s.includes('limited opportunity') || s.includes('limited deregulation')) return 'limited';
        if (s.includes('direct access')) return 'direct_access';
        if (s.startsWith('deregulated')) return 'dereg';
        return 'reg';
      };
      // Electric Power gets a finer breakdown than the NG panel so the
      // legend can call out each state's specific retail-choice program
      // (market-cap lottery, annual election, 5 MW minimum, etc.).
      const epCategoryKey = (statusText) => {
        const s = String(statusText || '').toLowerCase();
        if (!s || s.startsWith('regulated')) return 'reg';
        if (s.includes('annual lottery')) return 'lottery';   // CA
        if (s.includes('market cap')) return 'cap';            // MI
        if (s.includes('annual election')) return 'election';  // OR
        if (s.includes('5 mw')) return 'va5mw';                        // VA
        if (s.includes('third-party supply')) return 'az_prior_supply'; // AZ
        // Any other limited-opportunity wording falls to the generic amber
        // rather than borrowing one of the named states' rules. These two
        // used to share a bucket, which put Virginia's 5 MW minimum in the
        // legend against Arizona's shape — a restriction Arizona doesn't
        // have. A rule the legend can't name is better left unnamed.
        if (s.includes('limited opportunity')) return 'limited';
        return 'dereg';
      };
      const ngStatusByKey = new Map();
      const epStatusByKey = new Map();
      for (const m of US_MARKETS) {
        const cat = NA_CATEGORIES[m.category];
        ngStatusByKey.set(`US/${m.code}`, statusBucket(cat?.ng));
        epStatusByKey.set(`US/${m.code}`, epCategoryKey(cat?.ep));
      }
      for (const m of CA_MARKETS) {
        const cat = NA_CATEGORIES[m.category];
        ngStatusByKey.set(`CA/${m.code}`, statusBucket(cat?.ng));
        epStatusByKey.set(`CA/${m.code}`, epCategoryKey(cat?.ep));
      }
      const hasSites = (key) => buckets.has(key);

      const STATUS_FILL = {
        reg:           '#1FA0E0', // blue
        dereg:         '#57B947', // green
        limited:       '#F59E0B', // amber (NG limited opportunity)
        direct_access: '#3B82F6', // sky blue
        // Electric-power program-specific buckets (EP legend).
        va5mw:         '#F5C400', // gold  — VA 5 MW minimum
        // Bronze: the same warm family as the gold above, so Arizona still
        // reads as restricted at a glance, but far enough apart in lightness
        // that the two don't merge into one band on the map.
        az_prior_supply: '#A16207',
        election:      '#A9DEEC', // light cyan — OR annual election period
        cap:           '#4C535A', // dark grey — MI market cap
        lottery:       '#E07D18', // orange — CA market cap + annual lottery
      };
      const STATUS_LABEL = {
        reg:           'Regulated',
        dereg:         'Deregulated',
        limited:       'Limited Deregulation',
        direct_access: 'Direct Access only',
        va5mw:         'Deregulated – Limited Opportunity – utility account must be 5 MW',
        az_prior_supply: 'Deregulated – Limited Opportunity – site must already have third-party supply',
        election:      'Deregulated with annual election period',
        cap:           'Deregulated with market cap',
        lottery:       'Deregulated, eligibility for new third-party supply subject to market cap and annual lottery',
      };
      const NO_SITES_FILL   = '#E5E7EB';
      const NO_SITES_STROKE = '#9CA3AF';
      const MEXICO_FILL     = '#E5E7EB';

      // Site-count → fill shading. Sqrt scaling keeps a single-site
      // state visibly tinted while the densest market hits the full
      // status hue plus a 20 % darken, so density reads as background
      // without needing a bold outline.
      const maxSiteCount = Math.max(1, ...Array.from(buckets.values()).map(b => b.count));
      const argbToRgb = (hex) => {
        const h = String(hex).replace(/^#/, '').replace(/^FF/i, '');
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
      };
      const rgbToHex = (rgb) => '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
      const shadeForCount = (statusHex, count) => {
        if (count <= 0) return NO_SITES_FILL;
        const [r, g, b] = argbToRgb(statusHex);
        const t = Math.sqrt(count / maxSiteCount);
        const sat  = 0.45 + 0.55 * t;
        const dark = 0.20 * t;
        const blend = (c) => (c * sat + 255 * (1 - sat)) * (1 - dark);
        return rgbToHex([blend(r), blend(g), blend(b)]);
      };

      // Composite canvas — two panels side by side, each with its own
      // legend strip underneath. One image keeps Excel layout simple.
      const MAP_W = 800;
      const MAP_H = 500;
      const PAD = 16;
      const TITLE_H = 36;
      // Tall enough for the Electric Power panel's vertical legend, which
      // lists each program-specific deregulation category on its own row.
      const LEGEND_H = 240;
      const W = MAP_W * 2 + PAD * 3;
      const H = TITLE_H + MAP_H + LEGEND_H + PAD * 2;
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, W, H);

      const NA_LNG_MIN = -170;
      const NA_LNG_MAX = -52;
      const NA_LAT_MIN = 18;
      // 84 °N keeps the Canadian Arctic archipelago (Ellesmere reaches
      // ~83 °N) on-canvas instead of clipping the top of Canada.
      const NA_LAT_MAX = 84;
      const projectInto = (originX, originY) => (lng, lat) => [
        originX + ((lng - NA_LNG_MIN) / (NA_LNG_MAX - NA_LNG_MIN)) * MAP_W,
        originY + ((NA_LAT_MAX - lat) / (NA_LAT_MAX - NA_LAT_MIN)) * MAP_H,
      ];

      // Splits rings that cross the antimeridian (Alaska's Aleutians)
      // into sub-rings so we don't draw a connector line across the
      // whole panel.
      const drawFeature = (project, rings) => {
        for (const ring of rings) {
          const subRings = [];
          let cur = [];
          let prevLng = null;
          for (const pt of ring) {
            if (prevLng !== null && Math.abs(pt[0] - prevLng) > 180) {
              if (cur.length > 2) subRings.push(cur);
              cur = [];
            }
            cur.push(pt);
            prevLng = pt[0];
          }
          if (cur.length > 2) subRings.push(cur);
          for (const sr of subRings) {
            ctx.beginPath();
            for (let i = 0; i < sr.length; i++) {
              const [px, py] = project(sr[i][0], sr[i][1]);
              if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          }
        }
      };

      const countryFeatures = getCountryFeatures();
      const naFeatures = getNAAdmin1Features();

      const drawPanel = (originX, originY, statusByKey, headerLabel) => {
        const project = projectInto(originX, originY);
        ctx.fillStyle = '#0F172A';
        ctx.font = 'bold 18px Nunito Sans, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(headerLabel, originX + MAP_W / 2, originY - 10);

        // Clip every map layer to the panel rectangle so geometry that
        // projects past an edge — chiefly Mexico's southern tip, which
        // extends below NA_LAT_MIN — is cut off flush with the grey
        // boundary instead of bleeding onto the white canvas beneath the
        // map. The title above is drawn before this clip so it stays
        // visible.
        ctx.save();
        ctx.beginPath();
        ctx.rect(originX, originY, MAP_W, MAP_H);
        ctx.clip();

        // Panel background uses the no-sites grey instead of the old
        // slate ocean tint so Mexico's southern edge (now clipped at the
        // panel's southern edge) blends into the background instead of
        // showing a hard line where Mexico meets the panel.
        ctx.fillStyle = NO_SITES_FILL;
        ctx.fillRect(originX, originY, MAP_W, MAP_H);

        ctx.fillStyle = MEXICO_FILL;
        ctx.strokeStyle = NO_SITES_STROKE;
        ctx.lineWidth = 0.5;
        for (const feat of countryFeatures) {
          const derGKey = TOPO_NAME_TO_DEREG_KEY[feat.name] || feat.name;
          if (derGKey !== 'Mexico' && feat.name !== 'Mexico') continue;
          drawFeature(project, feat.rings);
        }

        // Hairline borders for every state / province — the choropleth
        // fill carries the information, the outline only defines the
        // shape.
        ctx.strokeStyle = NO_SITES_STROKE;
        ctx.lineWidth = 0.5;
        for (const feat of naFeatures) {
          const key = `${feat.admin}/${feat.postal}`;
          const tier = statusByKey.get(key) || 'reg';
          const count = buckets.get(key)?.count || 0;
          ctx.fillStyle = shadeForCount(STATUS_FILL[tier], count);
          drawFeature(project, feat.rings);
        }

        ctx.restore();
      };

      drawPanel(PAD,             TITLE_H, ngStatusByKey, 'Natural Gas Markets');
      drawPanel(PAD * 2 + MAP_W, TITLE_H, epStatusByKey, 'Electric Power Markets');

      // Per-panel legends along the bottom — each map gets its own key
      // so the EP-only "Direct Access" chip doesn't show beneath the
      // gas map.
      const SWATCH = 22;
      const GAP_SWATCH_LABEL = 8;
      const GAP_ITEMS = 22;
      ctx.font = '13px Nunito Sans, Arial, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const itemW = (label) => SWATCH + GAP_SWATCH_LABEL + ctx.measureText(label).width;
      // Horizontal legend — used for the Natural Gas panel (few, short
      // categories that fit on one row under the map).
      const drawPanelLegend = (originX, tiers) => {
        const labels = [
          ...tiers.map(t => ({ color: STATUS_FILL[t], label: STATUS_LABEL[t] })),
          { color: NO_SITES_FILL, label: 'No portfolio sites' },
        ];
        const totalW = labels.reduce((a, it) => a + itemW(it.label), 0) + GAP_ITEMS * (labels.length - 1);
        let cursorX = originX + (MAP_W - totalW) / 2;
        // PAD * 2 of breathing room above the chips so each legend
        // doesn't crowd the bottom edge of Mexico in the map above.
        const legendY = TITLE_H + MAP_H + PAD * 2;
        for (const it of labels) {
          ctx.fillStyle = it.color;
          ctx.fillRect(cursorX, legendY, SWATCH, SWATCH);
          ctx.strokeStyle = NO_SITES_STROKE;
          ctx.lineWidth = 0.8;
          ctx.strokeRect(cursorX, legendY, SWATCH, SWATCH);
          ctx.fillStyle = '#0F172A';
          ctx.fillText(it.label, cursorX + SWATCH + GAP_SWATCH_LABEL, legendY + SWATCH / 2);
          cursorX += itemW(it.label) + GAP_ITEMS;
        }
      };
      // Vertical legend — used for the Electric Power panel, whose
      // program-specific categories carry long labels that need their own
      // row each (wrapping if a label runs wider than the panel).
      const drawVerticalLegend = (originX, tiers) => {
        const items = [
          ...tiers.map(t => ({ color: STATUS_FILL[t], label: STATUS_LABEL[t] })),
          { color: NO_SITES_FILL, label: 'No portfolio sites' },
        ];
        const LINE_H = 17;
        const ROW_GAP = 7;
        const textX = originX + PAD + SWATCH + GAP_SWATCH_LABEL;
        const maxLabelW = MAP_W - PAD - SWATCH - GAP_SWATCH_LABEL - PAD;
        let y = TITLE_H + MAP_H + PAD;
        for (const it of items) {
          // Greedy word-wrap so an over-long label spills onto extra lines.
          const words = String(it.label).split(' ');
          const lines = [];
          let cur = '';
          for (const w of words) {
            const test = cur ? `${cur} ${w}` : w;
            if (cur && ctx.measureText(test).width > maxLabelW) { lines.push(cur); cur = w; }
            else cur = test;
          }
          if (cur) lines.push(cur);
          ctx.fillStyle = it.color;
          ctx.fillRect(originX + PAD, y, SWATCH, SWATCH);
          ctx.strokeStyle = NO_SITES_STROKE;
          ctx.lineWidth = 0.8;
          ctx.strokeRect(originX + PAD, y, SWATCH, SWATCH);
          ctx.fillStyle = '#0F172A';
          let ty = y + SWATCH / 2 - ((lines.length - 1) * LINE_H) / 2;
          for (const ln of lines) { ctx.fillText(ln, textX, ty); ty += LINE_H; }
          y += Math.max(SWATCH, lines.length * LINE_H) + ROW_GAP;
        }
      };
      drawPanelLegend(PAD, ['dereg', 'limited', 'reg']); // Natural Gas
      // Electric Power. Filtered to the buckets the map actually used, so a
      // legend row can't describe a colour that isn't on the panel — the
      // generic 'limited' fallback exists for wordings none of the current
      // categories carry, and listing it unconditionally would put an
      // unexplained swatch under every export.
      {
        const used = new Set(epStatusByKey.values());
        const EP_LEGEND_ORDER = ['reg', 'dereg', 'va5mw', 'az_prior_supply', 'limited', 'election', 'cap', 'lottery'];
        drawVerticalLegend(PAD * 2 + MAP_W, EP_LEGEND_ORDER.filter(t => used.has(t)));
      }

      const dataUrl = canvas.toDataURL('image/png');
      const imageId = wb.addImage({ base64: dataUrl, extension: 'png' });

      ws.mergeCells(1, 1, 1, COLS);
      const title = ws.getCell(1, 1);
      title.value = 'NAM View: US + Canada Site Distribution';
      title.font = { name: 'Nunito Sans', bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
      title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
      title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(1).height = 30;

      ws.addImage(imageId, {
        tl: { col: 0, row: 1 },
        ext: { width: W, height: H },
      });

      // Overview table — same tier rollup as Portfolio Overview but
      // scoped to NA sites only. Anchored at row 43: the map image
      // above actually overlaps down through row 41, so row 37 put the
      // header and the first tier rows underneath it. 43 leaves a
      // one-row gap below the image's true bottom edge. Every row
      // below (tier rows, the State / Province table) offsets from
      // this constant, so the whole sheet shifts with it.
      const SUMMARY_START = 43;
      ws.mergeCells(SUMMARY_START, 1, SUMMARY_START, COLS);
      const sumHdr = ws.getCell(SUMMARY_START, 1);
      // Say what this tab covers when that isn't all of the portfolio. The
      // total below counts US / Canada sites only, so a reader comparing it
      // against the site count on the page has no way to tell a scope from a
      // missing-data problem — which is exactly the question a short total
      // raises.
      const nonNaSites = Math.max(0, rows.length - naSites);
      sumHdr.value = nonNaSites > 0
        ? `NA Overview — ${naSites.toLocaleString()} of ${rows.length.toLocaleString()} sites are in the US / Canada. `
          + `The other ${nonNaSites.toLocaleString()} sit outside North America and are counted on the Portfolio Overview sheet.`
        : 'NA Overview';
      sumHdr.font = { name: 'Nunito Sans', bold: true, size: 12, color: { argb: SE_GREEN_DARK } };
      sumHdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
      sumHdr.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(SUMMARY_START).height = 22;

      const tableHeaderRow = SUMMARY_START + 1;
      const overviewHeaders = ['Tier', 'Electric Sites', 'Electric %', 'Gas Sites', 'Gas %', 'Load (kWh)', 'Load (Dth)', 'Total Cost ($)'];
      const hdr = ws.getRow(tableHeaderRow);
      overviewHeaders.forEach((label, i) => {
        const cell = hdr.getCell(i + 1);
        cell.value = label;
        cell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      });
      hdr.height = 22;
      const tierRows = [
        ['Deregulated',          'dereg'],
        ['Some deregulation',    'some'],
        ['Regulated / unlikely', 'reg'],
        ['No data',              'unknown'],
      ];
      const pct = (n) => naSites > 0 ? n / naSites : 0;
      // Totals accumulate the values actually written into each tier
      // row, so the Total line adds up to the column above it rather
      // than to a separately-rounded figure nobody can reconcile.
      const totals = { eSites: 0, gSites: 0, kwh: 0, dth: 0, cost: 0 };
      tierRows.forEach((tr, i) => {
        const r = ws.getRow(tableHeaderRow + 1 + i);
        const [label, tierKey] = tr;
        const eSites = electricTierAgg[tierKey]?.sites || 0;
        const gSites = gasTierAgg[tierKey]?.sites || 0;
        const kwh = Math.round(electricTierAgg[tierKey]?.kwh || 0);
        const dth = Math.round((gasTierAgg[tierKey]?.therms || 0) / 10);
        const cost = Math.round((electricTierAgg[tierKey]?.cost || 0) + (gasTierAgg[tierKey]?.cost || 0));
        totals.eSites += eSites;
        totals.gSites += gSites;
        totals.kwh += kwh;
        totals.dth += dth;
        totals.cost += cost;
        r.getCell(1).value = label;
        r.getCell(2).value = eSites;
        r.getCell(3).value = pct(eSites);
        r.getCell(4).value = gSites;
        r.getCell(5).value = pct(gSites);
        r.getCell(6).value = kwh;
        r.getCell(7).value = dth;
        r.getCell(8).value = cost;
        r.getCell(3).numFmt = '0.0%';
        r.getCell(5).numFmt = '0.0%';
        r.getCell(6).numFmt = '#,##0';
        r.getCell(7).numFmt = '#,##0';
        r.getCell(8).numFmt = '"$"#,##0';
        for (let ci = 1; ci <= overviewHeaders.length; ci++) {
          r.getCell(ci).font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
          r.getCell(ci).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
          r.getCell(ci).border = {
            bottom: { style: 'hair', color: { argb: SE_BORDER } },
            right:  { style: 'hair', color: { argb: SE_BORDER } },
          };
        }
        r.height = 20;
      });
      writeOverviewTotalRow(ws, tableHeaderRow + 1 + tierRows.length, overviewHeaders.length, totals, pct);

      // Per state / per province deregulation reference. Sourced from
      // the same US_MARKETS + CA_MARKETS dataset that drives the
      // North America Markets sheet, so the two tabs stay in sync.
      // Portfolio site counts + load + cost roll in from stateAggs;
      // only states / provinces that actually have portfolio sites are
      // listed (no-site markets are omitted). The Markets legend is
      // appended directly below the table.
      //
      // Rank by Annual Cost descending — largest portfolio markets at
      // the top; ties fall back to alphabetical by code.
      const marketRows = [
        ...US_MARKETS.map(m => ({ ...m, country: 'United States', countryKey: 'US' })),
        ...CA_MARKETS.map(m => ({ ...m, country: 'Canada',        countryKey: 'CA' })),
      ]
        .filter(m => (stateAggs.get(`${m.countryKey}/${m.code}`)?.sites || 0) > 0)
        .sort((a, b) => {
          const aCost = stateAggs.get(`${a.countryKey}/${a.code}`)?.cost || 0;
          const bCost = stateAggs.get(`${b.countryKey}/${b.code}`)?.cost || 0;
          if (bCost !== aCost) return bCost - aCost;
          return String(a.code).localeCompare(String(b.code));
        });
      if (marketRows.length > 0) {
        // +1 over the tier rows for the Total line, then the same
        // blank-row gap this table has always had below the Overview.
        const stateHdrRow = tableHeaderRow + tierRows.length + 4;
        ws.mergeCells(stateHdrRow, 1, stateHdrRow, COLS);
        const sHdr = ws.getCell(stateHdrRow, 1);
        sHdr.value = 'State / Province deregulation status';
        sHdr.font = { name: 'Nunito Sans', bold: true, size: 12, color: { argb: SE_GREEN_DARK } };
        sHdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
        sHdr.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        ws.getRow(stateHdrRow).height = 22;

        const sTblHdrRow = stateHdrRow + 1;
        const sCols = ['Code', 'Name', 'Country', 'Natural Gas', 'Electric Power', 'Market Category', 'Sites', 'Load (kWh)', 'Load (Dth)', 'Annual Cost ($)'];
        const sHdrCells = ws.getRow(sTblHdrRow);
        sCols.forEach((label, i) => {
          const cell = sHdrCells.getCell(i + 1);
          cell.value = label;
          cell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
          cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
          cell.border = {
            top:    { style: 'thin', color: { argb: SE_BORDER } },
            bottom: { style: 'thin', color: { argb: SE_BORDER } },
            left:   { style: 'thin', color: { argb: SE_BORDER } },
            right:  { style: 'thin', color: { argb: SE_BORDER } },
          };
        });
        sHdrCells.height = 26;

        marketRows.forEach((m, i) => {
          const cat = NA_CATEGORIES[m.category];
          const agg = stateAggs.get(`${m.countryKey}/${m.code}`);
          const sites = agg ? agg.sites : 0;
          const kwh = agg ? Math.round(agg.kwh) : 0;
          const dth = agg ? Math.round(agg.therms / 10) : 0;
          const cost = agg ? Math.round(agg.cost) : 0;
          const rr = ws.getRow(sTblHdrRow + 1 + i);
          rr.getCell(1).value = m.code;
          rr.getCell(2).value = m.name;
          rr.getCell(3).value = m.country;
          rr.getCell(4).value = cat?.ng || 'Regulated';
          rr.getCell(5).value = cat?.ep || 'Regulated';
          rr.getCell(6).value = cat?.label || 'Regulated: NG & EP';
          rr.getCell(7).value = sites;
          rr.getCell(8).value = kwh;
          rr.getCell(9).value = dth;
          rr.getCell(10).value = cost;
          rr.getCell(7).numFmt = '#,##0';
          rr.getCell(8).numFmt = '#,##0';
          rr.getCell(9).numFmt = '#,##0';
          rr.getCell(10).numFmt = '"$"#,##0';
          for (let ci = 1; ci <= sCols.length; ci++) {
            rr.getCell(ci).font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
            rr.getCell(ci).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
            rr.getCell(ci).border = {
              bottom: { style: 'hair', color: { argb: SE_BORDER } },
              right:  { style: 'hair', color: { argb: SE_BORDER } },
            };
          }
          if (cat) {
            const catCell = rr.getCell(6);
            catCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cat.fill } };
            catCell.font = { name: 'Nunito Sans', size: 10, bold: true, color: { argb: cat.fg } };
          }
          // Colour the NG (4) and EP (5) cells by their own status so the
          // table reads like the source map: Regulated = blue,
          // Deregulated = green, Limited Opportunity = amber.
          const statusCellStyle = (statusText) => {
            const s = String(statusText || '').toLowerCase();
            if (!s || s.startsWith('regulated')) return { fill: 'FF4AA3E0', fg: 'FFFFFFFF' };
            if (s.includes('limited opportunity') || s.includes('limited deregulation')) return { fill: 'FFF2C200', fg: 'FF422006' };
            return { fill: 'FF4CAF50', fg: 'FF14532D' };
          };
          [[4, cat?.ng], [5, cat?.ep]].forEach(([ci, status]) => {
            const st = statusCellStyle(status);
            rr.getCell(ci).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: st.fill } };
            rr.getCell(ci).font = { name: 'Nunito Sans', size: 10, bold: true, color: { argb: st.fg } };
          });
          if (sites > 0) {
            rr.getCell(7).font = { name: 'Nunito Sans', size: 10, bold: true, color: { argb: SE_TEXT_DARK } };
          }
          rr.height = 20;
        });
      }
    }

    // ---- ISO / RTO Overview sheet ------------------------------
    // Parallels the NAM View, but the geographic unit is the wholesale
    // electricity market (ISO / RTO) rather than the state. Aligned to the
    // ISO/RTO Council reference map: the seven US markets plus the three
    // Canadian markets (Alberta AESO, Ontario IESO, New Brunswick), with
    // everything outside those footprints (the non-ISO West / Southeast,
    // most of Canada) drawn grey. Sites are placed in a market the fine
    // way — by electric utility, then ZIP, then state / province (see
    // src/data/isoRegions.js) — so split-state sites land in the right ISO
    // even though the choropleth itself colours whole states / provinces.
    // Single panel: ISOs are electricity markets, so there's no Natural Gas
    // / Electric Power split. The bottom table rolls the portfolio up per
    // ISO / RTO market.
    {
      const ws = wb.addWorksheet('ISO', {
        properties: { tabColor: { argb: SE_GREEN_DARK } },
        views: [{ showGridLines: false }],
      });
      const COLS = 12;
      ws.columns = [
        { width: 22 }, // Region
        { width: 12 }, // Sites
        { width: 10 }, // Sites %
        { width: 16 }, // Load (kWh)
        { width: 16 }, // Load (Dth)
        { width: 18 }, // Annual Cost
        { width: 6 }, { width: 6 }, { width: 6 },
        { width: 6 }, { width: 6 }, { width: 6 },
      ];

      // Aggregate North America sites (US + Canada) into ISO regions. Each
      // site is resolved to its market the fine way — by electric utility
      // first, then ZIP, then state / province — so split-state sites land
      // in the right ISO (a Chicago ComEd site → PJM even though Illinois'
      // footprint polygon is MISO). Sites outside any IRC-mapped market
      // (the non-ISO West / Southeast, most of Canada) resolve to null and
      // are excluded from the rollup. Two tallies feed the map: per
      // state / province site counts (density) and, within each, how the
      // portfolio splits across ISOs (so a split state is coloured by the
      // market its sites actually sit in).
      const stateCounts = new Map();        // "US:IL" / "CA:ON" -> site count
      const stateRegionCounts = new Map();  // stateKey -> Map(regionKey -> count)
      const isoAggs = new Map();            // regionKey -> { sites, kwh, therms, cost }
      const siteRecords = [];               // per-site rows feeding the ISO Site Explorer
      let naSiteCount = 0;
      let unmappedCount = 0;                // NA sites that resolve to no ISO market
      for (const r of rows) {
        const rawCountry = String(r.__country__ || '').trim();
        const country = normalizeCountryName(rawCountry) || rawCountry;
        const isUS = /^(united states|usa|us)$/i.test(country);
        const isCA = /^(canada|ca)$/i.test(country);
        if (!isUS && !isCA) continue;
        const admin = isUS ? 'US' : 'CA';
        naSiteCount++;
        const code = String(r.__state__ || '').trim().toUpperCase();
        const region = resolveSiteIso({ admin, code, zip: r.__zipNorm__, utility: r.__electric__ });
        if (!region) { unmappedCount++; continue; }
        const stateKey = `${admin}:${code}`;
        stateCounts.set(stateKey, (stateCounts.get(stateKey) || 0) + 1);
        let rc = stateRegionCounts.get(stateKey);
        if (!rc) { rc = new Map(); stateRegionCounts.set(stateKey, rc); }
        rc.set(region, (rc.get(region) || 0) + 1);
        const kwh = (typeof r.__kwh__ === 'number' && Number.isFinite(r.__kwh__)) ? r.__kwh__ : 0;
        const therms = (typeof r.__therms__ === 'number' && Number.isFinite(r.__therms__)) ? r.__therms__ : 0;
        const eCost = (typeof r.__electricCostActual__ === 'number' && Number.isFinite(r.__electricCostActual__))
          ? r.__electricCostActual__
          : (typeof r.__electricCostEstimated__ === 'number' && Number.isFinite(r.__electricCostEstimated__) ? r.__electricCostEstimated__ : 0);
        const gCost = (typeof r.__gasCostActual__ === 'number' && Number.isFinite(r.__gasCostActual__))
          ? r.__gasCostActual__
          : (typeof r.__gasCostEstimated__ === 'number' && Number.isFinite(r.__gasCostEstimated__) ? r.__gasCostEstimated__ : 0);
        let agg = isoAggs.get(region);
        if (!agg) { agg = { sites: 0, kwh: 0, therms: 0, cost: 0 }; isoAggs.set(region, agg); }
        agg.sites++;
        agg.kwh += kwh;
        agg.therms += therms;
        agg.cost += eCost + gCost;
        // Keep a per-site record so the ISO Site Explorer below can list the
        // sites in whichever market the reader picks from the dropdown.
        siteRecords.push({
          siteName: siteNameColumn ? String(r[siteNameColumn] ?? '').trim() : String(r.__siteName__ || '').trim(),
          // Canonical type where the upload's value resolved to one, else the
          // raw string it carried — the same fallback the Property Type
          // column on the sites table shows.
          propertyType: String(r.__propertyType__ || r.__propertyTypeRaw__ || '').trim(),
          city: String(r.__city__ || '').trim(),
          state: String(r.__stateProvinceDisplay__ || r.__state__ || '').trim(),
          zip: String(r.__zipNorm__ || '').trim(),
          electric: String(r.__electric__ || '').trim(),
          kwh: Math.round(kwh),
          cost: Math.round(eCost + gCost),
          iso: ISO_LABEL[region] || region,
        });
      }

      // Per-feature helpers: the whole-polygon footprint ISO (dominant
      // market for that state / province) and the display region — the ISO
      // the portfolio actually favours in that state when it has sites
      // there, else the footprint so empty markets still read on the map.
      const footprintForFeature = (feat) => (
        feat.admin === 'CA' ? isoForProvince(feat.postal) : isoForState(feat.postal)
      );
      const displayRegionForFeature = (feat) => {
        const key = `${feat.admin}:${String(feat.postal || '').toUpperCase()}`;
        const rc = stateRegionCounts.get(key);
        if (rc && rc.size) {
          let best = null, bestN = -1;
          for (const [k, n] of rc) if (n > bestN) { bestN = n; best = k; }
          return best;
        }
        return footprintForFeature(feat);
      };

      const NO_REGION_FILL   = '#E5E7EB'; // unmapped US states (AK/HI) + non-US
      const NO_REGION_STROKE = '#9CA3AF';
      const maxSiteCount = Math.max(1, ...Array.from(stateCounts.values()));
      const argbToRgb = (hex) => {
        const h = String(hex).replace(/^#/, '').replace(/^FF/i, '');
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
      };
      const rgbToHex = (rgb) => '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
      // Region hue, always applied (so every region reads on the map like
      // the reference breakdown), with a sqrt density darken keyed to the
      // state's portfolio site count. Zero-site states stay a light tint of
      // their region hue rather than fading to grey.
      const shadeForRegion = (regionKey, count) => {
        const [r, g, b] = argbToRgb(ISO_FILL[regionKey] || '#9CA3AF');
        if (count <= 0) {
          const sat = 0.38;
          const blend = (c) => c * sat + 255 * (1 - sat);
          return rgbToHex([blend(r), blend(g), blend(b)]);
        }
        const t = Math.sqrt(count / maxSiteCount);
        const sat = 0.60 + 0.40 * t;
        const dark = 0.16 * t;
        const blend = (c) => (c * sat + 255 * (1 - sat)) * (1 - dark);
        return rgbToHex([blend(r), blend(g), blend(b)]);
      };

      // Single-panel canvas, framed to North America south of ~60°N so the
      // three Canadian ISO markets (Alberta, Ontario, New Brunswick) sit
      // above the US band, mirroring the IRC reference map. Same
      // equirectangular projection helper as the NAM sheet.
      const MAP_W = 900;
      const MAP_H = 580;
      const PAD = 16;
      const TITLE_H = 34;
      const LEGEND_H = 96;
      const W = MAP_W + PAD * 2;
      const H = TITLE_H + MAP_H + LEGEND_H + PAD * 2;
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, W, H);

      const NA_LNG_MIN = -125;
      const NA_LNG_MAX = -63;
      const NA_LAT_MIN = 24;
      const NA_LAT_MAX = 60;
      const project = (lng, lat) => [
        PAD + ((lng - NA_LNG_MIN) / (NA_LNG_MAX - NA_LNG_MIN)) * MAP_W,
        TITLE_H + ((NA_LAT_MAX - lat) / (NA_LAT_MAX - NA_LAT_MIN)) * MAP_H,
      ];
      const traceFeature = (rings, { fill = false, stroke = false } = {}) => {
        for (const ring of rings) {
          const subRings = [];
          let cur = [];
          let prevLng = null;
          for (const pt of ring) {
            if (prevLng !== null && Math.abs(pt[0] - prevLng) > 180) {
              if (cur.length > 2) subRings.push(cur);
              cur = [];
            }
            cur.push(pt);
            prevLng = pt[0];
          }
          if (cur.length > 2) subRings.push(cur);
          for (const sr of subRings) {
            ctx.beginPath();
            for (let i = 0; i < sr.length; i++) {
              const [px, py] = project(sr[i][0], sr[i][1]);
              if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.closePath();
            if (fill) ctx.fill();
            if (stroke) ctx.stroke();
          }
        }
      };
      const drawFeature = (rings) => traceFeature(rings, { fill: true, stroke: true });
      const strokeFeature = (rings) => traceFeature(rings, { stroke: true });

      // Build a single clip path from all of a feature's rings (splitting at
      // the antimeridian like traceFeature) and set it as the canvas clip, so
      // subsequent fills only paint inside the state / province outline.
      const clipToFeature = (rings) => {
        ctx.beginPath();
        for (const ring of rings) {
          const subRings = [];
          let cur = [];
          let prevLng = null;
          for (const pt of ring) {
            if (prevLng !== null && Math.abs(pt[0] - prevLng) > 180) {
              if (cur.length > 2) subRings.push(cur);
              cur = [];
            }
            cur.push(pt);
            prevLng = pt[0];
          }
          if (cur.length > 2) subRings.push(cur);
          for (const sr of subRings) {
            for (let i = 0; i < sr.length; i++) {
              const [px, py] = project(sr[i][0], sr[i][1]);
              if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.closePath();
          }
        }
        ctx.clip();
      };

      // Screen-space bounding box of a feature (projected). Used to size the
      // diagonal stripe field that fills a hybrid state.
      const featureScreenBBox = (rings) => {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const ring of rings) {
          for (const pt of ring) {
            const [px, py] = project(pt[0], pt[1]);
            if (px < minX) minX = px;
            if (px > maxX) maxX = px;
            if (py < minY) minY = py;
            if (py > maxY) maxY = py;
          }
        }
        return { minX, minY, maxX, maxY };
      };

      // Turn ordered ISO shares into an evenly-interleaved stripe assignment
      // via largest-remainder apportionment: band i goes to whichever market
      // is most "owed" so far (share × bands − assigned). Weights of 0.85 /
      // 0.15 yield ~6 dominant bands per minority band, spread out rather than
      // clumped, so the dominant market visibly out-stripes the minority.
      const buildStripePattern = (weights, len) => {
        const assigned = weights.map(() => 0);
        const pat = [];
        for (let i = 0; i < len; i++) {
          let best = 0, bestScore = -Infinity;
          for (let k = 0; k < weights.length; k++) {
            const score = weights[k].weight * (i + 1) - assigned[k];
            if (score > bestScore) { bestScore = score; best = k; }
          }
          assigned[best] += 1;
          pat.push(weights[best].iso);
        }
        return pat;
      };

      const STRIPE_W = 9; // px, diagonal stripe thickness on the map

      // Fill a split state as a hybrid: diagonal stripes proportioned to the
      // ISO shares (denser = dominant market), plus a solid block over each
      // minority market's geographic corner. All clipped to the state outline;
      // `count` drives the same site-density darkening as the solid fills.
      const fillHybridFeature = (feat, split, count) => {
        const bbox = featureScreenBBox(feat.rings);
        const cx = (bbox.minX + bbox.maxX) / 2;
        const cy = (bbox.minY + bbox.maxY) / 2;
        const reach = Math.hypot(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY) + STRIPE_W;
        ctx.save();
        clipToFeature(feat.rings);
        // Diagonal stripes (45°). Rotate about the state's centre, lay down
        // horizontal bands across the reach, let the clip trim them.
        const pattern = buildStripePattern(split, 120);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(-Math.PI / 4);
        let bi = 0;
        for (let y = -reach; y < reach; y += STRIPE_W, bi += 1) {
          ctx.fillStyle = shadeForRegion(pattern[bi % pattern.length], count);
          ctx.fillRect(-reach, y, reach * 2, STRIPE_W + 0.5);
        }
        ctx.restore();
        // Shaded minority sub-areas (e.g. the SPP Panhandle of Texas). Solid
        // block of the minority hue over its lat/lng box, clipped to the state.
        const subs = STATE_ISO_SUBAREAS[`${feat.admin}:${String(feat.postal || '').toUpperCase()}`];
        if (subs) {
          for (const s of subs) {
            const [aLng, aLat, bLng, bLat] = s.bbox;
            const [x0, y0] = project(aLng, bLat);
            const [x1, y1] = project(bLng, aLat);
            ctx.fillStyle = shadeForRegion(s.iso, count);
            ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
          }
        }
        ctx.restore();
        // White hairline border, matching the solid states.
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 0.6;
        strokeFeature(feat.rings);
      };

      const naFeatures = getNAAdmin1Features();

      // Panel title.
      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 18px Nunito Sans, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('ISO / RTO Regions', PAD + MAP_W / 2, TITLE_H - 10);

      // Clip the map layers to the panel rectangle.
      ctx.save();
      ctx.beginPath();
      ctx.rect(PAD, TITLE_H, MAP_W, MAP_H);
      ctx.clip();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(PAD, TITLE_H, MAP_W, MAP_H);

      // Which ISO / RTO regions actually hold portfolio sites. Regions with
      // no sites are drawn as plain grey states (like any non-ISO area) — no
      // region-coloured outline — so the map only highlights the markets the
      // portfolio actually touches.
      const activeRegions = new Set(isoAggs.keys());

      // Pass 1 — fills. A state / province where the portfolio has sites is
      // filled with the ISO those sites actually favour (utility/ZIP-resolved
      // majority), darkened by site count; an empty state in an active market
      // keeps a light tint of that market's hue so the footprint still reads.
      // A state that genuinely straddles two markets (STATE_ISO_SPLIT) is
      // instead drawn HYBRID — diagonal stripes proportioned to each market's
      // share, plus a shaded block over the minority market's corner.
      // Everything else — empty markets, and anything outside the IRC map
      // (the non-ISO West / Southeast, most of Canada, AK/HI) — is greyed out.
      let anyHybrid = false;
      ctx.lineWidth = 0.6;
      for (const feat of naFeatures) {
        const code = String(feat.postal || '').toUpperCase();
        if (feat.admin === 'US' && (code === 'AK' || code === 'HI')) continue;
        const stateKey = `${feat.admin}:${code}`;
        const region = displayRegionForFeature(feat);
        if (region && activeRegions.has(region)) {
          const split = STATE_ISO_SPLIT[stateKey];
          // Only stripe when at least one of the split's markets actually
          // holds portfolio sites — otherwise a whole empty market would show
          // stripes it hasn't earned. The dominant band still reflects the
          // footprint even when the portfolio favours the minority side.
          if (split && split.length > 1 && split.some(s => activeRegions.has(s.iso))) {
            fillHybridFeature(feat, split, stateCounts.get(stateKey) || 0);
            anyHybrid = true;
            continue;
          }
          ctx.fillStyle = shadeForRegion(region, stateCounts.get(stateKey) || 0);
          ctx.strokeStyle = '#FFFFFF';
        } else {
          // Greyed out as a plain state: outside the IRC map, or in a market
          // that holds no portfolio sites. Both read as neutral grey with an
          // ordinary state boundary — empty markets are no longer outlined.
          ctx.fillStyle = NO_REGION_FILL;
          ctx.strokeStyle = NO_REGION_STROKE;
        }
        drawFeature(feat.rings);
      }
      ctx.restore();

      // Thin frame around the map, echoing the reference image's border.
      ctx.strokeStyle = '#0F172A';
      ctx.lineWidth = 2;
      ctx.strokeRect(PAD, TITLE_H, MAP_W, MAP_H);

      // Wrapping horizontal legend — one chip per ISO region.
      const SWATCH = 20;
      const GAP_SWATCH_LABEL = 7;
      const GAP_ITEMS = 20;
      const ROW_H = 28;
      ctx.font = '14px Nunito Sans, Arial, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const legendItems = [
        ...ISO_REGIONS.map(r => ({ color: r.fill, label: r.label })),
        // Striped example chip — only when a split state was actually drawn
        // hybrid. MISO:PJM at 2:1 mirrors the map's "denser = dominant" stripes.
        ...(anyHybrid
          ? [{ striped: true, stripeColors: [ISO_FILL.MISO, ISO_FILL.MISO, ISO_FILL.PJM], label: 'Split state: striped by ISO share (denser = dominant)' }]
          : []),
        { color: NO_REGION_FILL, label: 'ISO / RTO market with no sites, or outside any market' },
      ];
      const itemW = (label) => SWATCH + GAP_SWATCH_LABEL + ctx.measureText(label).width;
      // Greedy row packing centred within the map width.
      const legendRows = [];
      let curRow = [];
      let curW = 0;
      for (const it of legendItems) {
        const w = itemW(it.label);
        const add = curRow.length ? GAP_ITEMS + w : w;
        if (curRow.length && curW + add > MAP_W) { legendRows.push({ items: curRow, width: curW }); curRow = []; curW = 0; }
        curRow.push(it);
        curW += curRow.length === 1 ? w : GAP_ITEMS + w;
      }
      if (curRow.length) legendRows.push({ items: curRow, width: curW });
      let legendY = TITLE_H + MAP_H + PAD + SWATCH / 2;
      for (const lr of legendRows) {
        let cursorX = PAD + (MAP_W - lr.width) / 2;
        for (const it of lr.items) {
          const swX = cursorX;
          const swY = legendY - SWATCH / 2;
          if (it.striped) {
            // Diagonal striped swatch, mirroring the map's hybrid fill.
            ctx.save();
            ctx.beginPath();
            ctx.rect(swX, swY, SWATCH, SWATCH);
            ctx.clip();
            ctx.translate(swX + SWATCH / 2, swY + SWATCH / 2);
            ctx.rotate(-Math.PI / 4);
            const cols = it.stripeColors;
            const sw = 4;
            let k = 0;
            for (let y = -SWATCH; y < SWATCH; y += sw, k += 1) {
              ctx.fillStyle = cols[k % cols.length];
              ctx.fillRect(-SWATCH, y, SWATCH * 2, sw + 0.5);
            }
            ctx.restore();
          } else {
            ctx.fillStyle = it.color;
            ctx.fillRect(swX, swY, SWATCH, SWATCH);
          }
          ctx.strokeStyle = NO_REGION_STROKE;
          ctx.lineWidth = 0.8;
          ctx.strokeRect(swX, swY, SWATCH, SWATCH);
          ctx.fillStyle = '#0F172A';
          ctx.fillText(it.label, cursorX + SWATCH + GAP_SWATCH_LABEL, legendY);
          cursorX += itemW(it.label) + GAP_ITEMS;
        }
        legendY += ROW_H;
      }

      const dataUrl = canvas.toDataURL('image/png');
      const imageId = wb.addImage({ base64: dataUrl, extension: 'png' });

      ws.mergeCells(1, 1, 1, COLS);
      const title = ws.getCell(1, 1);
      title.value = 'ISO View: North America Site Distribution by Wholesale Market Region';
      title.font = { name: 'Nunito Sans', bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
      title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
      title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(1).height = 30;

      ws.mergeCells(2, 1, 2, COLS);
      const sub = ws.getCell(2, 1);
      const unmappedNote = unmappedCount > 0
        ? ` (${unmappedCount} site${unmappedCount === 1 ? '' : 's'} outside any ISO / RTO market (the non-ISO West / Southeast, most of Canada, AK / HI), are excluded)`
        : '';
      sub.value = `${naSiteCount} North America site${naSiteCount === 1 ? '' : 's'} across ${isoAggs.size} ISO / RTO market${isoAggs.size === 1 ? '' : 's'}, aligned to the ISO/RTO Council map (US markets plus Alberta, Ontario, and New Brunswick). Each site is placed in its market by electric utility, then ZIP, then state / province, so split-state sites land in the right ISO. States / provinces with portfolio sites are shaded by that market's hue and site count (darker = more sites); markets with no portfolio sites are shown as plain grey states, the same as areas outside every ISO / RTO market. States that straddle two markets are drawn hybrid: diagonal stripes proportioned to each market's share (denser stripes = the dominant ISO, e.g. Texas reads mostly ERCOT with a Southwest Power Pool minority; Illinois and Indiana mostly MISO with PJM to the northeast), plus a shaded block over the minority market's corner (e.g. the SPP Panhandle of northwest Texas). The choropleth colours whole states / provinces, so the drawn boundaries are indicative, not authoritative seams.${unmappedNote}`;
      sub.font = { name: 'Nunito Sans', italic: true, size: 10, color: { argb: SE_SLATE } };
      sub.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
      ws.getRow(2).height = 36;

      ws.addImage(imageId, {
        tl: { col: 0, row: 3 },
        ext: { width: W, height: H },
      });

      // ISO Overview table — one row per region that has portfolio sites,
      // ranked by annual cost descending. Anchored clear of the map image.
      const SUMMARY_START = 40;
      ws.mergeCells(SUMMARY_START, 1, SUMMARY_START, COLS);
      const sumHdr = ws.getCell(SUMMARY_START, 1);
      sumHdr.value = 'ISO / RTO Overview';
      sumHdr.font = { name: 'Nunito Sans', bold: true, size: 12, color: { argb: SE_GREEN_DARK } };
      sumHdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
      sumHdr.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(SUMMARY_START).height = 22;

      const tableHeaderRow = SUMMARY_START + 1;
      const overviewHeaders = ['ISO / RTO Region', 'Sites', 'Sites %', 'Load (kWh)', 'Load (Dth)', 'Annual Cost ($)'];
      const hdr = ws.getRow(tableHeaderRow);
      overviewHeaders.forEach((label, i) => {
        const cell = hdr.getCell(i + 1);
        cell.value = label;
        cell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        cell.border = {
          top:    { style: 'thin', color: { argb: SE_BORDER } },
          bottom: { style: 'thin', color: { argb: SE_BORDER } },
          left:   { style: 'thin', color: { argb: SE_BORDER } },
          right:  { style: 'thin', color: { argb: SE_BORDER } },
        };
      });
      hdr.height = 22;

      const totalSites = Array.from(isoAggs.values()).reduce((a, x) => a + x.sites, 0);
      const regionRows = ISO_REGIONS
        .map(r => ({ region: r, agg: isoAggs.get(r.key) }))
        .filter(x => x.agg && x.agg.sites > 0)
        .sort((a, b) => (b.agg.cost - a.agg.cost) || String(a.region.label).localeCompare(String(b.region.label)));

      regionRows.forEach((x, i) => {
        const rr = ws.getRow(tableHeaderRow + 1 + i);
        const { region, agg } = x;
        rr.getCell(1).value = region.label;
        rr.getCell(2).value = agg.sites;
        rr.getCell(3).value = totalSites > 0 ? agg.sites / totalSites : 0;
        rr.getCell(4).value = Math.round(agg.kwh);
        rr.getCell(5).value = Math.round(agg.therms / 10);
        rr.getCell(6).value = Math.round(agg.cost);
        rr.getCell(3).numFmt = '0.0%';
        rr.getCell(4).numFmt = '#,##0';
        rr.getCell(5).numFmt = '#,##0';
        rr.getCell(6).numFmt = '"$"#,##0';
        for (let ci = 1; ci <= overviewHeaders.length; ci++) {
          rr.getCell(ci).font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
          rr.getCell(ci).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
          rr.getCell(ci).border = {
            bottom: { style: 'hair', color: { argb: SE_BORDER } },
            right:  { style: 'hair', color: { argb: SE_BORDER } },
          };
        }
        // Tint the region cell with its map hue so the table reads like
        // the map legend.
        const fillHex = 'FF' + String(region.fill).replace(/^#/, '').toUpperCase();
        // ERCOT's near-black hue needs white text; everything else is light
        // enough for dark text.
        const [rr0, gg0, bb0] = argbToRgb(region.fill);
        const luminance = 0.299 * rr0 + 0.587 * gg0 + 0.114 * bb0;
        rr.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillHex } };
        rr.getCell(1).font = { name: 'Nunito Sans', size: 10, bold: true, color: { argb: luminance < 140 ? 'FFFFFFFF' : 'FF1E293B' } };
        rr.height = 20;
      });

      // Total row.
      if (regionRows.length > 0) {
        const totalRow = ws.getRow(tableHeaderRow + 1 + regionRows.length);
        const totKwh = regionRows.reduce((a, x) => a + x.agg.kwh, 0);
        const totTherms = regionRows.reduce((a, x) => a + x.agg.therms, 0);
        const totCost = regionRows.reduce((a, x) => a + x.agg.cost, 0);
        totalRow.getCell(1).value = 'Total';
        totalRow.getCell(2).value = totalSites;
        totalRow.getCell(3).value = 1;
        totalRow.getCell(4).value = Math.round(totKwh);
        totalRow.getCell(5).value = Math.round(totTherms / 10);
        totalRow.getCell(6).value = Math.round(totCost);
        totalRow.getCell(3).numFmt = '0.0%';
        totalRow.getCell(4).numFmt = '#,##0';
        totalRow.getCell(5).numFmt = '#,##0';
        totalRow.getCell(6).numFmt = '"$"#,##0';
        for (let ci = 1; ci <= overviewHeaders.length; ci++) {
          totalRow.getCell(ci).font = { name: 'Nunito Sans', size: 10, bold: true, color: { argb: SE_TEXT_DARK } };
          totalRow.getCell(ci).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
          totalRow.getCell(ci).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
          totalRow.getCell(ci).border = { top: { style: 'thin', color: { argb: SE_BORDER } } };
        }
        totalRow.height = 20;
      }

      // ---- ISO / RTO Site Explorer ------------------------------
      // A dropdown-driven site list: pick an ISO / RTO market and its sites
      // spill in below. The picker is a data-validation list sourced from the
      // Overview rows above; the list itself is a dynamic-array FILTER over a
      // hidden per-site table off to the right (columns O–V). FILTER spills
      // live in Excel 365 and Google Sheets, and a forced recalc-on-open fills
      // the list without the reader having to touch anything.
      if (regionRows.length > 0 && siteRecords.length > 0) {
        const firstRegionRow = tableHeaderRow + 1;
        const lastRegionRow = tableHeaderRow + regionRows.length;

        // Row layout for the explorer, a few rows below the Overview total.
        const secRow = lastRegionRow + 3;   // section header
        const noteRow = secRow + 1;         // instruction line
        const pickRow = noteRow + 1;        // label + dropdown
        const listHdrRow = pickRow + 2;     // site-list header
        const listStart = listHdrRow + 1;   // first site row
        const pickRef = `$B$${pickRow}`;

        // Hidden source table (cols O–X): 8 display columns, the ISO label as
        // the match key (W), and a running match-rank helper (X) that numbers
        // 1,2,3… down the rows of whichever market is picked. Kept in hidden
        // columns clear of the visible layout so only the assembled list shows.
        const LIST_COLS = 8;
        const SRC_DISP0 = 15;              // first display column (O)
        const SRC_ISO = SRC_DISP0 + LIST_COLS;   // ISO match-key column (W)
        const SRC_RANK = SRC_ISO + 1;            // running match-rank column (X)
        const SRC_FIRST = 2;
        const SRC_LAST = SRC_FIRST + siteRecords.length - 1;
        const L = (n) => ws.getColumn(n).letter;
        const vCol = L(SRC_ISO);
        const wCol = L(SRC_RANK);

        // The list opens on PJM when the portfolio has sites there — it's the
        // market these reports are read for most — and on the top market by
        // cost otherwise. Either way that view is cached as each formula's
        // stored result, so the list is right on open even in a viewer that
        // doesn't recalculate (the Master Analysis file is re-zipped after
        // export, which can drop the recalc-on-open flag).
        const PREFERRED_ISO = 'PJM';
        const regionLabels = regionRows.map(x => x.region.label);
        const defaultIso = regionLabels.includes(PREFERRED_ISO) ? PREFERRED_ISO : regionLabels[0];
        const defaultMatches = siteRecords.filter(s => s.iso === defaultIso);

        let defRank = 0;
        siteRecords.forEach((s, i) => {
          const rowNum = SRC_FIRST + i;
          const sr = ws.getRow(rowNum);
          sr.getCell(SRC_DISP0 + 0).value = s.siteName;
          sr.getCell(SRC_DISP0 + 1).value = s.propertyType;
          sr.getCell(SRC_DISP0 + 2).value = s.city;
          sr.getCell(SRC_DISP0 + 3).value = s.state;
          sr.getCell(SRC_DISP0 + 4).value = s.zip;
          sr.getCell(SRC_DISP0 + 5).value = s.electric;
          sr.getCell(SRC_DISP0 + 6).value = s.kwh;
          sr.getCell(SRC_DISP0 + 7).value = s.cost;
          sr.getCell(SRC_ISO).value = s.iso;
          const isDefault = s.iso === defaultIso;
          if (isDefault) defRank += 1;
          sr.getCell(SRC_RANK).value = {
            formula: `IF($${vCol}$${rowNum}=${pickRef},COUNTIF($${vCol}$${SRC_FIRST}:$${vCol}$${rowNum},${pickRef}),"")`,
            result: isDefault ? defRank : '',
          };
        });
        for (let c = SRC_DISP0; c <= SRC_RANK; c++) {
          const col = ws.getColumn(c);
          if (!col.width) col.width = 12;
          col.hidden = true;
        }

        // Explorer section header.
        ws.mergeCells(secRow, 1, secRow, COLS);
        const secHdr = ws.getCell(secRow, 1);
        secHdr.value = 'ISO / RTO Site Explorer';
        secHdr.font = { name: 'Nunito Sans', bold: true, size: 12, color: { argb: SE_GREEN_DARK } };
        secHdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
        secHdr.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        ws.getRow(secRow).height = 22;

        ws.mergeCells(noteRow, 1, noteRow, COLS);
        const note = ws.getCell(noteRow, 1);
        note.value = 'Pick an ISO / RTO market from the dropdown to list its sites below.';
        note.font = { name: 'Nunito Sans', italic: true, size: 10, color: { argb: SE_SLATE } };
        note.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        ws.getRow(noteRow).height = 18;

        // Picker row: label + dropdown cell (data validation list).
        const pickLabel = ws.getCell(pickRow, 1);
        pickLabel.value = 'ISO / RTO market:';
        pickLabel.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: SE_TEXT_DARK } };
        pickLabel.alignment = { vertical: 'middle', horizontal: 'right' };
        const pickCell = ws.getCell(pickRow, 2);
        pickCell.value = defaultIso; // default to the top market
        pickCell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: SE_GREEN_DARK } };
        pickCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        pickCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7CC' } };
        pickCell.border = {
          top:    { style: 'thin', color: { argb: SE_GREEN_DARK } },
          bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } },
          left:   { style: 'thin', color: { argb: SE_GREEN_DARK } },
          right:  { style: 'thin', color: { argb: SE_GREEN_DARK } },
        };
        ws.dataValidations.add(`B${pickRow}`, {
          type: 'list',
          allowBlank: false,
          formulae: [`$A$${firstRegionRow}:$A$${lastRegionRow}`],
          showErrorMessage: true,
          errorStyle: 'warning',
          showInputMessage: true,
          promptTitle: 'ISO / RTO market',
          prompt: 'Pick a market to list its sites below.',
        });
        ws.getRow(pickRow).height = 20;

        // Site-list header row.
        const listHeaders = ['Site Name', 'Property Type', 'City', 'State / Province', 'ZIP', 'Electric Utility', 'Load (kWh)', 'Annual Cost ($)'];
        const FIRST_NUM_COL = LIST_COLS - 1;  // Load and Annual Cost, right-aligned
        const lh = ws.getRow(listHdrRow);
        listHeaders.forEach((label, i) => {
          const cell = lh.getCell(i + 1);
          cell.value = label;
          cell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
          cell.alignment = { vertical: 'middle', horizontal: (i >= FIRST_NUM_COL - 1) ? 'right' : 'left', indent: 1 };
          cell.border = {
            top:    { style: 'thin', color: { argb: SE_BORDER } },
            bottom: { style: 'thin', color: { argb: SE_BORDER } },
            left:   { style: 'thin', color: { argb: SE_BORDER } },
            right:  { style: 'thin', color: { argb: SE_BORDER } },
          };
        });
        lh.height = 22;

        // Assemble the list: a fixed block sized to the largest single market,
        // each cell pulling the rank-th matching site via INDEX/MATCH against
        // the running-rank helper. These are plain formulas (no dynamic
        // arrays), so they work in every Excel version and Google Sheets, and
        // they re-evaluate whenever the dropdown changes. Cached results show
        // the default market on open.
        const maxListRows = Math.max(1, ...regionRows.map(x => x.agg.sites));
        const fieldByCol = ['siteName', 'propertyType', 'city', 'state', 'zip', 'electric', 'kwh', 'cost'];
        for (let k = 0; k < maxListRows; k++) {
          const rowNum = listStart + k;
          const rank = k + 1;
          const rec = defaultMatches[k];
          const rr = ws.getRow(rowNum);
          for (let c = 1; c <= LIST_COLS; c++) {
            const srcCol = L(SRC_DISP0 + (c - 1));
            const cell = rr.getCell(c);
            const cached = rec ? rec[fieldByCol[c - 1]] : '';
            cell.value = {
              formula: `IFERROR(INDEX($${srcCol}$${SRC_FIRST}:$${srcCol}$${SRC_LAST},MATCH(${rank},$${wCol}$${SRC_FIRST}:$${wCol}$${SRC_LAST},0)),"")`,
              result: (cached === undefined || cached === null) ? '' : cached,
            };
            cell.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
            cell.alignment = { vertical: 'middle', horizontal: (c >= FIRST_NUM_COL) ? 'right' : 'left', indent: 1 };
            cell.border = { bottom: { style: 'hair', color: { argb: SE_BORDER } } };
            if (c === FIRST_NUM_COL) cell.numFmt = '#,##0';
            if (c === LIST_COLS) cell.numFmt = '"$"#,##0';
          }
          rr.height = 18;
        }
        // The Load and Cost columns sit over the map underlay's narrow columns
        // — widen them so the figures fit. The map image is pixel-sized, so
        // this doesn't shift it.
        if ((ws.getColumn(FIRST_NUM_COL).width || 0) < 14) ws.getColumn(FIRST_NUM_COL).width = 14;
        if ((ws.getColumn(LIST_COLS).width || 0) < 14) ws.getColumn(LIST_COLS).width = 14;

        // Recalculate on open so the list reflects the current pick.
        wb.calcProperties = wb.calcProperties || {};
        wb.calcProperties.fullCalcOnLoad = true;
      }
    }

    // ---- Europe View sheet -------------------------------------
    // Same two-panel choropleth treatment as the NAM View, scoped to
    // Europe. Country-level resolution (no per-region breakout): every
    // country is shaded by its COUNTRY_DEREGULATION status for the panel's
    // commodity (Natural Gas left, Electric Power right) and darkened by
    // its portfolio site count; countries with no sites stay light grey.
    // A site counts as European when its country resolves to a
    // COUNTRY_DEREGULATION entry whose region starts with "Europe" (covers
    // "Europe" and the trans-continental "Europe/Asia" entries).
    {
      const ws = wb.addWorksheet('Europe', {
        properties: { tabColor: { argb: SE_GREEN_DARK } },
        views: [{ showGridLines: false }],
      });
      const MAP_COLS = 14;
      const LEGEND_COLS = 6;
      const COLS = MAP_COLS + LEGEND_COLS;
      const NUMERIC_WIDE_COLS = new Set([4, 5, 6, 7]);
      ws.columns = [
        ...Array.from({ length: MAP_COLS }, (_, i) => ({
          width: NUMERIC_WIDE_COLS.has(i + 1) ? 17 : 12,
        })),
        { width: 4 }, { width: 6 }, { width: 6 },
        { width: 12 }, { width: 12 }, { width: 12 },
      ];

      // NAM-style palette + helpers. statusTier returns dereg/some/reg/
      // unknown for a country; tierToStatus folds it into the chart's
      // dereg/limited/reg categories so the chips read the same as NAM.
      const STATUS_FILL = {
        reg:     '#94A3B8', // slate
        dereg:   '#10B981', // emerald
        limited: '#F59E0B', // amber
      };
      const STATUS_LABEL = {
        reg:     'Regulated',
        dereg:   'Deregulated',
        limited: 'Limited Deregulation',
      };
      const NO_SITES_FILL   = '#E5E7EB';
      const NO_SITES_STROKE = '#9CA3AF';
      const tierToStatus = (tier) => {
        if (tier === 'dereg') return 'dereg';
        if (tier === 'some')  return 'limited';
        return 'reg'; // 'reg' or 'unknown' both fall through
      };
      const argbFromHex = (hex) => 'FF' + String(hex).replace(/^#/, '').toUpperCase();

      // Bucket European sites by country + aggregate load / cost. One row
      // pass feeds the map (buckets), the Overview tier table
      // (electric/gasTierAgg), and the per-country table (countryAggs).
      const isEuropean = (c) => !!c && String(c.region || '').startsWith('Europe');
      const finite = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : 0;
      const buckets = new Map();
      const countryAggs = new Map();
      const blankTierAgg = () => ({ kwh: 0, therms: 0, cost: 0 });
      const electricTierAgg = { dereg: blankTierAgg(), some: blankTierAgg(), reg: blankTierAgg(), unknown: blankTierAgg() };
      const gasTierAgg      = { dereg: blankTierAgg(), some: blankTierAgg(), reg: blankTierAgg(), unknown: blankTierAgg() };
      let euSiteCount = 0;
      for (const r of rows) {
        const rawCountry = String(r.__country__ || '').trim();
        const country = normalizeCountryName(rawCountry) || rawCountry;
        const c = COUNTRY_DEREGULATION[country];
        if (!isEuropean(c)) continue;
        euSiteCount++;
        const eTier = statusTier(c.electric);
        const gTier = statusTier(c.gas);
        if (!buckets.has(country)) buckets.set(country, { elecTier: eTier, gasTier: gTier, count: 0 });
        buckets.get(country).count++;
        const kwh = finite(r.__kwh__);
        const therms = finite(r.__therms__);
        const eCost = finite(r.__electricCostActual__) || finite(r.__electricCostEstimated__);
        const gCost = finite(r.__gasCostActual__) || finite(r.__gasCostEstimated__);
        electricTierAgg[eTier].kwh += kwh; electricTierAgg[eTier].cost += eCost;
        gasTierAgg[gTier].therms += therms; gasTierAgg[gTier].cost += gCost;
        let agg = countryAggs.get(country);
        if (!agg) {
          agg = {
            country,
            elecTierKey: eTier, gasTierKey: gTier,
            elecStatus: STATUS_LABEL[tierToStatus(eTier)],
            gasStatus:  STATUS_LABEL[tierToStatus(gTier)],
            sites: 0, kwh: 0, therms: 0, cost: 0,
          };
          countryAggs.set(country, agg);
        }
        agg.sites++; agg.kwh += kwh; agg.therms += therms; agg.cost += eCost + gCost;
      }

      // Tier roll-up for the Overview table — site counts per tier from
      // the buckets, load + cost already attributed per row above.
      let elecDereg = 0, elecSome = 0, elecReg = 0, elecUnknown = 0;
      let gasDereg = 0, gasSome = 0, gasReg = 0, gasUnknown = 0;
      let mappedSites = 0;
      for (const b of buckets.values()) {
        mappedSites += b.count;
        if (b.elecTier === 'dereg') elecDereg += b.count;
        else if (b.elecTier === 'some') elecSome += b.count;
        else if (b.elecTier === 'reg') elecReg += b.count;
        else elecUnknown += b.count;
        if (b.gasTier === 'dereg') gasDereg += b.count;
        else if (b.gasTier === 'some') gasSome += b.count;
        else if (b.gasTier === 'reg') gasReg += b.count;
        else gasUnknown += b.count;
      }

      // Site-count → fill shading. Sqrt scaling keeps a single-site
      // country visibly tinted while the densest market hits the full
      // status hue plus a 20 % darken.
      const maxSiteCount = Math.max(1, ...Array.from(buckets.values()).map(b => b.count));
      const argbToRgb = (hex) => {
        const h = String(hex).replace(/^#/, '').replace(/^FF/i, '');
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
      };
      const rgbToHex = (rgb) => '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
      const shadeForCount = (statusHex, count) => {
        if (count <= 0) return NO_SITES_FILL;
        const [r, g, b] = argbToRgb(statusHex);
        const t = Math.sqrt(count / maxSiteCount);
        const sat  = 0.45 + 0.55 * t;
        const dark = 0.20 * t;
        const blend = (c) => (c * sat + 255 * (1 - sat)) * (1 - dark);
        return rgbToHex([blend(r), blend(g), blend(b)]);
      };

      // Composite canvas — two panels side by side, each with its own
      // legend strip underneath. Same panel dimensions as the NAM View so
      // the two sheets' maps are identically sized; the cosine-corrected
      // projection below centres Europe within the wider panel.
      const MAP_W = 800;
      const MAP_H = 500;
      const PAD = 16;
      const TITLE_H = 36;
      const LEGEND_H = 70;
      const W = MAP_W * 2 + PAD * 3;
      const H = TITLE_H + MAP_H + LEGEND_H + PAD * 2;
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, W, H);

      // Europe bounding box. Iceland (~-22°) to western Russia / Turkey
      // (~45°E), Mediterranean (~34°N) up to the top of Norway (~72°N).
      // Longitude is compressed by cos(mid-latitude) so Europe isn't
      // stretched horizontally the way a raw equirectangular projection
      // would render it; the drawn map is then centred in the panel.
      const EU_LNG_MIN = -25, EU_LNG_MAX = 45;
      const EU_LAT_MIN = 34, EU_LAT_MAX = 72;
      const EU_MID_LAT = (EU_LAT_MIN + EU_LAT_MAX) / 2;
      const EU_LNG_K = Math.cos(EU_MID_LAT * Math.PI / 180);
      const euLngSpan = (EU_LNG_MAX - EU_LNG_MIN) * EU_LNG_K;
      const euLatSpan = EU_LAT_MAX - EU_LAT_MIN;
      const euScale = Math.min(MAP_W / euLngSpan, MAP_H / euLatSpan);
      const euOffX = (MAP_W - euLngSpan * euScale) / 2;
      const euOffY = (MAP_H - euLatSpan * euScale) / 2;
      const projectInto = (originX, originY) => (lng, lat) => [
        originX + euOffX + (lng - EU_LNG_MIN) * EU_LNG_K * euScale,
        originY + euOffY + (EU_LAT_MAX - lat) * euScale,
      ];

      // Antimeridian-aware feature drawing (Russia wraps past 180°).
      const drawFeature = (project, rings) => {
        for (const ring of rings) {
          const subRings = [];
          let cur = [];
          let prevLng = null;
          for (const pt of ring) {
            if (prevLng !== null && Math.abs(pt[0] - prevLng) > 180) {
              if (cur.length > 2) subRings.push(cur);
              cur = [];
            }
            cur.push(pt);
            prevLng = pt[0];
          }
          if (cur.length > 2) subRings.push(cur);
          for (const sr of subRings) {
            ctx.beginPath();
            for (let i = 0; i < sr.length; i++) {
              const [px, py] = project(sr[i][0], sr[i][1]);
              if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          }
        }
      };

      const countryFeatures = getCountryFeatures();

      const drawPanel = (originX, commodity, headerLabel) => {
        const project = projectInto(originX, TITLE_H);
        // Panel header above the map.
        ctx.fillStyle = '#0F172A';
        ctx.font = 'bold 18px Nunito Sans, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(headerLabel, originX + MAP_W / 2, TITLE_H - 10);

        // Clip every layer to the panel so geometry outside the Europe
        // box (the rest of Asia / Africa) is cut flush with the edge.
        ctx.save();
        ctx.beginPath();
        ctx.rect(originX, TITLE_H, MAP_W, MAP_H);
        ctx.clip();

        // Light ocean tint so land with no sites (grey) stays distinct.
        ctx.fillStyle = '#F1F5F9';
        ctx.fillRect(originX, TITLE_H, MAP_W, MAP_H);

        ctx.lineWidth = 0.5;
        ctx.strokeStyle = NO_SITES_STROKE;
        for (const feat of countryFeatures) {
          const derGKey = TOPO_NAME_TO_DEREG_KEY[feat.name] || feat.name;
          const c = COUNTRY_DEREGULATION[derGKey];
          const tier = c ? statusTier(commodity === 'gas' ? c.gas : c.electric) : 'unknown';
          const status = tierToStatus(tier);
          const sites = buckets.get(derGKey)?.count || 0;
          ctx.fillStyle = sites > 0 ? shadeForCount(STATUS_FILL[status], sites) : NO_SITES_FILL;
          drawFeature(project, feat.rings);
        }
        ctx.restore();
      };

      drawPanel(PAD,             'gas',      'Natural Gas Markets');
      drawPanel(PAD * 2 + MAP_W, 'electric', 'Electric Power Markets');

      // Per-panel legends along the bottom — same chip set on both maps.
      const SWATCH = 22;
      const GAP_SWATCH_LABEL = 8;
      const GAP_ITEMS = 22;
      ctx.font = '13px Nunito Sans, Arial, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const itemW = (label) => SWATCH + GAP_SWATCH_LABEL + ctx.measureText(label).width;
      const drawPanelLegend = (originX) => {
        const labels = [
          { color: STATUS_FILL.dereg,   label: STATUS_LABEL.dereg },
          { color: STATUS_FILL.limited, label: STATUS_LABEL.limited },
          { color: STATUS_FILL.reg,     label: STATUS_LABEL.reg },
          { color: NO_SITES_FILL,       label: 'No portfolio sites' },
        ];
        const totalW = labels.reduce((a, it) => a + itemW(it.label), 0) + GAP_ITEMS * (labels.length - 1);
        let cursorX = originX + (MAP_W - totalW) / 2;
        const legendY = TITLE_H + MAP_H + PAD * 2;
        for (const it of labels) {
          ctx.fillStyle = it.color;
          ctx.fillRect(cursorX, legendY, SWATCH, SWATCH);
          ctx.strokeStyle = NO_SITES_STROKE;
          ctx.lineWidth = 0.8;
          ctx.strokeRect(cursorX, legendY, SWATCH, SWATCH);
          ctx.fillStyle = '#0F172A';
          ctx.fillText(it.label, cursorX + SWATCH + GAP_SWATCH_LABEL, legendY + SWATCH / 2);
          cursorX += itemW(it.label) + GAP_ITEMS;
        }
      };
      drawPanelLegend(PAD);
      drawPanelLegend(PAD * 2 + MAP_W);

      const dataUrl = canvas.toDataURL('image/png');
      const imageId = wb.addImage({ base64: dataUrl, extension: 'png' });

      // Title band.
      ws.mergeCells(1, 1, 1, COLS);
      const title = ws.getCell(1, 1);
      title.value = 'Europe View: Site Distribution by Market';
      title.font = { name: 'Nunito Sans', bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
      title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
      title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(1).height = 30;

      ws.mergeCells(2, 1, 2, COLS);
      const sub = ws.getCell(2, 1);
      sub.value = `${euSiteCount} Europe site${euSiteCount === 1 ? '' : 's'} across ${buckets.size} countr${buckets.size === 1 ? 'y' : 'ies'}. Natural Gas (left) and Electric Power (right) maps each shade every country by its market status (hue) and portfolio site count (darker = more sites); countries with no sites stay light grey.`;
      sub.font = { name: 'Nunito Sans', italic: true, size: 10, color: { argb: SE_SLATE } };
      sub.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
      ws.getRow(2).height = 36;

      ws.addImage(imageId, {
        tl: { col: 0, row: 3 },
        ext: { width: W, height: H },
      });

      // Overview tier table — same rollup shape as the NAM View, scoped
      // to European sites. Anchored at row 39 (same as the NAM View) to
      // clear the bottom edge of the now NAM-sized 638-px map image.
      const SUMMARY_START = 39;
      ws.mergeCells(SUMMARY_START, 1, SUMMARY_START, COLS);
      const sumHdr = ws.getCell(SUMMARY_START, 1);
      sumHdr.value = 'Europe Overview';
      sumHdr.font = { name: 'Nunito Sans', bold: true, size: 12, color: { argb: SE_GREEN_DARK } };
      sumHdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
      sumHdr.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(SUMMARY_START).height = 22;

      const tableHeaderRow = SUMMARY_START + 1;
      const overviewHeaders = ['Tier', 'Electric Sites', 'Electric %', 'Gas Sites', 'Gas %', 'Load (kWh)', 'Load (Dth)', 'Total Cost ($)'];
      const hdr = ws.getRow(tableHeaderRow);
      overviewHeaders.forEach((label, i) => {
        const cell = hdr.getCell(i + 1);
        cell.value = label;
        cell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      });
      hdr.height = 22;
      const tierRows = [
        ['Deregulated',           'dereg',   elecDereg,   gasDereg],
        ['Limited Deregulation',  'some',    elecSome,    gasSome],
        ['Regulated / unlikely',  'reg',     elecReg,     gasReg],
        ['No data',               'unknown', elecUnknown, gasUnknown],
      ];
      const pct = (n) => mappedSites > 0 ? n / mappedSites : 0;
      // Totals accumulate the values actually written into each tier
      // row, so the Total line adds up to the column above it rather
      // than to a separately-rounded figure nobody can reconcile.
      const totals = { eSites: 0, gSites: 0, kwh: 0, dth: 0, cost: 0 };
      tierRows.forEach((tr, i) => {
        const r = ws.getRow(tableHeaderRow + 1 + i);
        const [label, tierKey, eSites, gSites] = tr;
        const kwh = Math.round(electricTierAgg[tierKey]?.kwh || 0);
        const dth = Math.round((gasTierAgg[tierKey]?.therms || 0) / 10);
        const cost = Math.round((electricTierAgg[tierKey]?.cost || 0) + (gasTierAgg[tierKey]?.cost || 0));
        totals.eSites += eSites;
        totals.gSites += gSites;
        totals.kwh += kwh;
        totals.dth += dth;
        totals.cost += cost;
        r.getCell(1).value = label;
        r.getCell(2).value = eSites;
        r.getCell(3).value = pct(eSites);
        r.getCell(4).value = gSites;
        r.getCell(5).value = pct(gSites);
        r.getCell(6).value = kwh;
        r.getCell(7).value = dth;
        r.getCell(8).value = cost;
        r.getCell(3).numFmt = '0.0%';
        r.getCell(5).numFmt = '0.0%';
        r.getCell(6).numFmt = '#,##0';
        r.getCell(7).numFmt = '#,##0';
        r.getCell(8).numFmt = '"$"#,##0';
        for (let ci = 1; ci <= overviewHeaders.length; ci++) {
          r.getCell(ci).font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
          r.getCell(ci).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
          r.getCell(ci).border = {
            bottom: { style: 'hair', color: { argb: SE_BORDER } },
            right:  { style: 'hair', color: { argb: SE_BORDER } },
          };
        }
        r.height = 20;
      });
      writeOverviewTotalRow(ws, tableHeaderRow + 1 + tierRows.length, overviewHeaders.length, totals, pct);

      // Per-country deregulation table — only countries with portfolio
      // sites (same rule as the NAM state table), ranked by Annual Cost
      // descending then country name. NG / EP status cells are tinted with
      // their tier hue so the table reads like the map legend.
      const euCountryRows = [...countryAggs.values()]
        .sort((a, b) => (b.cost - a.cost) || String(a.country).localeCompare(String(b.country)));
      if (euCountryRows.length > 0) {
        // +1 over the tier rows for the Total line, then the same
        // blank-row gap this table has always had below the Overview.
        const cHdrRow = tableHeaderRow + tierRows.length + 4;
        ws.mergeCells(cHdrRow, 1, cHdrRow, COLS);
        const cHdr = ws.getCell(cHdrRow, 1);
        cHdr.value = 'Country deregulation status';
        cHdr.font = { name: 'Nunito Sans', bold: true, size: 12, color: { argb: SE_GREEN_DARK } };
        cHdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
        cHdr.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        ws.getRow(cHdrRow).height = 22;

        const cTblHdrRow = cHdrRow + 1;
        const cCols = ['Country', 'Natural Gas', 'Electric Power', 'Sites', 'Load (kWh)', 'Load (Dth)', 'Annual Cost ($)'];
        const cHdrCells = ws.getRow(cTblHdrRow);
        cCols.forEach((label, i) => {
          const cell = cHdrCells.getCell(i + 1);
          cell.value = label;
          cell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
          cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        });
        cHdrCells.height = 22;

        // Flag high-consumption markets: any European country whose annual
        // electric load exceeds 100 GWh gets a ⚑ marker on its name and a
        // red highlight on the Load (kWh) cell so the biggest power users
        // jump out of the table. 100 GWh = 100,000,000 kWh.
        const HIGH_LOAD_KWH = 100_000_000; // 100 GWh
        const FLAG_FILL = 'FFFDEAEA';      // light red
        const FLAG_TEXT = 'FFB91C1C';      // strong red
        let flaggedCount = 0;

        euCountryRows.forEach((cr, i) => {
          const rr = ws.getRow(cTblHdrRow + 1 + i);
          const highLoad = cr.kwh > HIGH_LOAD_KWH;
          if (highLoad) flaggedCount++;
          rr.getCell(1).value = highLoad ? `⚑ ${cr.country}` : cr.country;
          rr.getCell(2).value = cr.gasStatus;
          rr.getCell(3).value = cr.elecStatus;
          rr.getCell(4).value = cr.sites;
          rr.getCell(5).value = Math.round(cr.kwh);
          rr.getCell(6).value = Math.round(cr.therms / 10);
          rr.getCell(7).value = Math.round(cr.cost);
          rr.getCell(4).numFmt = '#,##0';
          rr.getCell(5).numFmt = '#,##0';
          rr.getCell(6).numFmt = '#,##0';
          rr.getCell(7).numFmt = '"$"#,##0';
          for (let ci = 1; ci <= cCols.length; ci++) {
            rr.getCell(ci).font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
            rr.getCell(ci).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
            rr.getCell(ci).border = {
              bottom: { style: 'hair', color: { argb: SE_BORDER } },
              right:  { style: 'hair', color: { argb: SE_BORDER } },
            };
          }
          // Tint the status cells with their tier hue (amber gets dark
          // text, the darker green / slate get white) so the table mirrors
          // the map's colour key.
          const tintStatusCell = (cell, tierKey) => {
            const status = tierToStatus(tierKey);
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argbFromHex(STATUS_FILL[status]) } };
            cell.font = { name: 'Nunito Sans', size: 10, bold: true, color: { argb: status === 'limited' ? SE_TEXT_DARK : 'FFFFFFFF' } };
          };
          tintStatusCell(rr.getCell(2), cr.gasTierKey);
          tintStatusCell(rr.getCell(3), cr.elecTierKey);
          // Highlight the country + Load (kWh) cells for flagged markets.
          if (highLoad) {
            rr.getCell(1).font = { name: 'Nunito Sans', size: 10, bold: true, color: { argb: FLAG_TEXT } };
            rr.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FLAG_FILL } };
            rr.getCell(5).font = { name: 'Nunito Sans', size: 10, bold: true, color: { argb: FLAG_TEXT } };
          }
          rr.height = 20;
        });

        // Footnote explaining the ⚑ flag, shown only when something tripped
        // the 100 GWh threshold.
        if (flaggedCount > 0) {
          const noteRow = cTblHdrRow + 1 + euCountryRows.length;
          ws.mergeCells(noteRow, 1, noteRow, COLS);
          const note = ws.getCell(noteRow, 1);
          note.value = `⚑ Flags ${flaggedCount} ${flaggedCount === 1 ? 'country' : 'countries'} with more than 100 GWh of annual electric power consumption.`;
          note.font = { name: 'Nunito Sans', italic: true, size: 9, color: { argb: FLAG_TEXT } };
          note.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
          ws.getRow(noteRow).height = 18;
        }
      }
    }

    // The second tab in the workbook is always named "Indicative
    // Savings" now — the old "Indicative Savings by State"
    // formulation was confusing when the portfolio happened to be
    // US-only but conceptually applies to any geography. The
    // separate hasGlobalSites flag still gates the US-state nesting
    // (parent "United States" row + outlineLevel children).
    const hasGlobalSites = electricRows.some(g => g.isCountry) || gasRows.some(g => g.isCountry);
    const SCENARIO_SHEET_NAME = 'Indicative Savings';
    const ws = wb.addWorksheet(SCENARIO_SHEET_NAME, {
      // summaryBelow: false → Excel renders the "+/-" outline toggle
      // ABOVE the grouped children (next to the United States parent
      // row), which is the layout we use when nesting state rows.
      properties: { tabColor: { argb: SE_GREEN }, outlineProperties: { summaryBelow: false } },
      // Freeze the title + scenario block (rows 1-3) so the toggle
      // stays visible as the user scrolls down through the electric /
      // gas / reg-rate blocks.
      views: [{ showGridLines: false, state: 'frozen', ySplit: 3 }],
    });

    // SPAN sized for the widest section (electric, which carries the
    // deregulated Year 1-5 cumulative block + a spacer column + the
    // regulated-rate block with its own Year 1-5 cumulative). Gas
    // uses fewer slots; the title / section bands still merge across
    // SPAN so the headings stay aligned across both sections.
    // Two extra slots when the portfolio has leased locations: a Leased
    // Sites count next to Deregulated Sites, and the savings-eligible
    // spend next to the full deregulated spend.
    const SPAN = 26 + (showLeasedColumns ? 2 : 0);
    const widths = [
      22, 14, 11, 13,                     // ST/Prov/Country..Deregulated Sites (4)
      ...(showLeasedColumns ? [13] : []), // Leased Sites (1)
      16, 18,                             // Deregulated Consumption + Spend (2)
      ...(showLeasedColumns ? [18] : []), // Savings-Eligible Spend (1)
      13,                                // Low % (1)
      13,                                // High % (1)
      11,                                // Savings % (1)
      16, 14, 14, 14, 14, 14,            // Annual Savings + Year 1-5 (6)
      24, 24, 14, 14,                    // Utility/Supplier/Contract Start/End (4)
      4,                                 // spacer (1)
      16, 16, 14, 14, 14, 14, 14,        // Reg-rate block (7)
    ];
    ws.columns = widths.map(w => ({ width: w }));

    // Scenario-toggle reference: every scenario-aware cell points at
    // this single cell so the user can flip the dropdown and see all
    // of the savings columns recalculate at once. Always written as a
    // qualified `'Sheet Name'!$D$2` reference so the same formula is
    // valid on the by-state sheet AND on the monthly-breakdown sheet.
    // SCENARIO_SHEET_NAME was already declared above so the
    // worksheet name + the qualified formula references share one
    // source of truth.
    const SCENARIO_LOCAL_CELL = 'D2';
    const SCENARIO_REF = `'${SCENARIO_SHEET_NAME}'!$${SCENARIO_LOCAL_CELL[0]}$${SCENARIO_LOCAL_CELL.slice(1)}`;
    // Term-length toggle (1-5 years). Drives the same scenario-aware
    // cells: any savings column tagged with `yearGate: N` is zeroed
    // when the user picks fewer than N years; the monthly breakdown
    // sheet zeroes any month whose 1-indexed number exceeds N*12.
    // The `--` (double unary) idiom in the formula coerces the value
    // to a number whether Excel stored the dropdown selection as
    // text or numeric.
    const YEARS_LOCAL_CELL = 'G2';
    const YEARS_REF = `'${SCENARIO_SHEET_NAME}'!$${YEARS_LOCAL_CELL[0]}$${YEARS_LOCAL_CELL.slice(1)}`;
    // Excel formula factory for a scenario-aware cell. Inlines the
    // three numeric possibilities so the workbook stays self-contained
    // (no helper sheet needed) and Excel sees real numbers in the
    // formula — no "number stored as text" warnings. Values are NOT
    // rounded here so percentages like 0.02 survive intact; the cell's
    // numFmt handles display (currency cells show whole dollars, '0.0%'
    // cells show "2.0%", etc.). When a `yearGate` is supplied, the
    // outer IF zeroes the cell whenever the user's chosen term length
    // is shorter than that gate value.
    const scenarioFormula = (low, mid, high, yearGate) => {
      const safe = (n) => Number.isFinite(n) ? n : 0;
      const inner = `IF(${SCENARIO_REF}="Conservative",${safe(low)},IF(${SCENARIO_REF}="Aggressive",${safe(high)},${safe(mid)}))`;
      if (yearGate == null) return inner;
      return `IF(--${YEARS_REF}>=${yearGate},${inner},0)`;
    };

    // Title row — Schneider green band, white text.
    ws.mergeCells(1, 1, 1, SPAN);
    const title = ws.getCell(1, 1);
    title.value = SCENARIO_SHEET_NAME;
    title.font = { name: 'Nunito Sans', bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
    title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(1).height = 28;

    // Rows 2-3: scenario toggle + term-length toggle live on row 2
    // (each label + dropdown side-by-side); the long explainer takes
    // row 3 so nothing gets clipped behind the data columns.
    //   Row 2 — A2:C2 "Savings Scenario" label · D2:E2 scenario
    //           dropdown · F2 "# of Years" label · G2 term dropdown.
    //   Row 3 — italic explainer band, full width.
    const cellStyle = (cell, fill, color, bold = false) => {
      cell.font = { name: 'Nunito Sans', bold, size: 12, color: { argb: color } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
      cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    };
    const dropdownBorder = {
      top:    { style: 'thin', color: { argb: SE_GREEN_DARK } },
      bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } },
      left:   { style: 'thin', color: { argb: SE_GREEN_DARK } },
      right:  { style: 'thin', color: { argb: SE_GREEN_DARK } },
    };

    ws.mergeCells(2, 1, 2, 3);
    cellStyle(ws.getCell('A2'), SE_GREEN_LIGHT, SE_GREEN_DARK, true);
    ws.getCell('A2').value = 'Savings Scenario';

    ws.mergeCells(2, 4, 2, 5);
    const toggleValue = ws.getCell(SCENARIO_LOCAL_CELL);
    toggleValue.value = 'Base';
    cellStyle(toggleValue, 'FFFFFFFF', SE_TEXT_DARK, true);
    toggleValue.border = dropdownBorder;
    toggleValue.dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: ['"Conservative,Base,Aggressive"'],
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Pick a scenario',
      error: 'Choose Conservative, Base, or Aggressive.',
    };

    cellStyle(ws.getCell('F2'), SE_GREEN_LIGHT, SE_GREEN_DARK, true);
    ws.getCell('F2').value = '# of Years';

    const yearsValue = ws.getCell(YEARS_LOCAL_CELL);
    yearsValue.value = 5;
    cellStyle(yearsValue, 'FFFFFFFF', SE_TEXT_DARK, true);
    yearsValue.border = dropdownBorder;
    yearsValue.dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: ['"1,2,3,4,5"'],
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Pick a term',
      error: 'Choose 1, 2, 3, 4, or 5.',
    };
    ws.getRow(2).height = 22;

    ws.mergeCells(3, 1, 3, SPAN);
    const toggleHint = ws.getCell(3, 1);
    toggleHint.value = 'Conservative = low end of the savings range · Base = average · Aggressive = high end. # of Years controls how far the savings extend: Year N columns zero out below it. The Low % and High % cells per state are editable (yellow): type a new range and Savings %, Indicative Annual Savings, and Year 1–5 Cumulative all recompute live.'
      + (showLeasedColumns
        ? ' Leased locations are excluded from the projection: their spend is still reported under Deregulated Spend/yr, but the savings are taken off Savings-Eligible Spend/yr, which leaves them out.'
        : noteLeasedScope
          ? ' Leased locations are included in this projection, at the request of the analysis: they carry the same savings range as every other site.'
          : '');
    toggleHint.font = { name: 'Nunito Sans', italic: true, size: 10, color: { argb: SE_TEXT_DARK } };
    toggleHint.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
    toggleHint.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
    ws.getRow(3).height = 30;

    let r = 5;
    // Captures each section's Total → Indicative Annual Savings cell
    // address + its Base (mid) dollar value, so the Savings Summary band
    // at the top of the sheet can sum electric + gas with a live,
    // scenario-aware formula. Keyed by the section label.
    const annualTotals = {};
    function writeSection(label, sectionRows, columnDefs) {
      // Section header band — light green wash with dark green text.
      ws.mergeCells(r, 1, r, SPAN);
      const head = ws.getCell(r, 1);
      head.value = label;
      head.font = { name: 'Nunito Sans', bold: true, size: 12, color: { argb: SE_GREEN_DARK } };
      head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
      head.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(r).height = 22;
      r += 1;
      // Column headers — solid green band, white text. Spacer columns
      // (`c.spacer`) skip the band so the dereg block and the reg-rate
      // block visually detach from each other.
      const headerRow = ws.getRow(r);
      columnDefs.forEach((c, i) => {
        const cell = headerRow.getCell(i + 1);
        if (c.spacer) return;
        cell.value = c.label;
        cell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
        // Bottom-aligned per the user spec — labels sit on the
        // bottom edge of the band so the data rows below read like a
        // continuation of the header. wrapText still on for the
        // longer labels (Reg. Rate Year N Cumulative, Indicative
        // Annual Savings, Deregulated Consumption kWh/yr).
        cell.alignment = { vertical: 'bottom', horizontal: 'left', wrapText: true, indent: 1 };
        cell.border = { bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } } };
      });
      // Tall column-header band so the longer wrapped labels
      // ("Deregulated Consumption kWh/yr", "Reg. Rate Year N
      // Cumulative", etc.) sit cleanly on three lines without
      // clipping. Fixed at 45 — both the Electric Power column
      // header (row 6) and the Natural Gas column header further
      // down the sheet flow through this same writeSection call.
      headerRow.height = 45;
      r += 1;

      // Build a tag → column-letter map so the per-row formula
      // branches below can reference sibling cells in the same row
      // (Spend, Low %, High %, Savings %, Annual Savings).
      const colByTag = {};
      columnDefs.forEach((c, i) => {
        if (c.tag) colByTag[c.tag] = i + 1;
      });
      const colLetterFor = (n) => {
        let s = '';
        let m = n;
        while (m > 0) { m--; s = String.fromCharCode(65 + (m % 26)) + s; m = Math.floor(m / 26); }
        return s;
      };
      const cellRef = (tag, rowNum) => {
        const col = colByTag[tag];
        return col ? `${colLetterFor(col)}${rowNum}` : null;
      };
      const INPUT_FILL = 'FFFFF9C3';
      const INPUT_BORDER = 'FFCA8A04';
      // Soft amber row tint for "too low" markets (small electric
      // spend OR gas spend below the sourcing threshold). Applied to
      // every non-editable cell on the row so the warning carries
      // across the whole entry without overwriting the yellow Low /
      // High % input fills.
      const TOO_LOW_FILL = 'FFFEEAD2';
      const isTooLow = (row) => {
        const flags = String(row?.flags || '');
        if (flags.includes('small electric market') || flags.includes('too low for sourcing')) return true;
        // Deregulated markets that surface no deregulated spend have
        // nothing to pursue — tint them amber like the small markets so
        // the user can scan past them. Catches rows like OH whose status
        // is Deregulated but every site there is regulated / carries no
        // spend on file, which the "small market" flag (spend > 0) skips.
        if (!row?.isParent && !(Number(row?.spend) > 0)) return true;
        return false;
      };
      // Hide regulated leaf rows outright. Statuses 'no' (US/CA per-
      // state regulated), 'Regulated', 'Unlikely', and 'No opportunity'
      // all mean the market has no deregulated savings motion — they
      // don't belong on the Indicative Savings tab even if they carry
      // a reg-rate (utility tariff) opportunity. Parent aggregate rows
      // (United States, Canada) are always kept and roll up surviving
      // children.
      const REGULATED_STATUSES = new Set(['no', 'Regulated', 'Unlikely', 'No opportunity']);
      const visibleRows = sectionRows.filter((row) => {
        if (row.isParent) return true;
        return !REGULATED_STATUSES.has(row.status);
      });
      const dataStartRow = r;

      // Data rows — every cell left-aligned regardless of type so the
      // sheet reads as a flat report rather than a finance ledger.
      // Scenario / formula columns become Excel formulas so the
      // toggle (Conservative / Base / Aggressive), the # of Years
      // dropdown, and the editable Low / High % cells all recompute
      // every savings number on the sheet.
      for (const row of visibleRows) {
        const dataRow = ws.getRow(r);
        // Children of a country-aggregate row (US states / Canadian
        // provinces) get outline level 1 so Excel shows the +/-
        // collapse button next to the parent United States / Canada
        // row above them.
        if (row._outlineLevel) dataRow.outlineLevel = row._outlineLevel;
        columnDefs.forEach((c, i) => {
          const cell = dataRow.getCell(i + 1);
          if (c.spacer) return;
          const v = c.get(row);

          // Editable Low % / High % cell — yellow fill signals input.
          // Parent aggregate rows (United States, Canada) suppress
          // the yellow editable cell because their savings band is
          // a mix of children; user edits happen on the per-state
          // rows nested below.
          if ((c.editable === 'lowPct' || c.editable === 'highPct') && !row.isParent) {
            // European markets carry no committed range — show "TBD"
            // text rather than a blank (which reads as 0 %) or a number.
            if (row.isTbd) {
              cell.value = 'TBD';
              cell.ignoredErrors = { numberStoredAsText: true };
            }
            else if (typeof v === 'number' && Number.isFinite(v)) cell.value = v;
            else writeBlank(cell, !!c.numFmt);
            cell.font = { name: 'Nunito Sans', size: 10, bold: true, color: { argb: SE_TEXT_DARK } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INPUT_FILL } };
            cell.alignment = { vertical: 'bottom', horizontal: 'left', indent: 1 };
            if (c.numFmt) cell.numFmt = c.numFmt;
            cell.border = {
              top:    { style: 'thin', color: { argb: INPUT_BORDER } },
              bottom: { style: 'thin', color: { argb: INPUT_BORDER } },
              left:   { style: 'thin', color: { argb: INPUT_BORDER } },
              right:  { style: 'thin', color: { argb: INPUT_BORDER } },
            };
            return;
          }

          // Savings % = scenario toggle picks low / mid / high from
          // the row's editable Low / High cells.
          if (c.formulaKind === 'savingsPct') {
            const lowRef = cellRef('lowPct', r);
            const highRef = cellRef('highPct', r);
            const midResult = (v && typeof v === 'object' && Number.isFinite(v.mid)) ? v.mid : 0;
            // Parent aggregate rows have no editable Low/High cells
            // to point at, so write the precomputed mid value as a
            // plain number instead of a formula referencing blanks.
            if (lowRef && highRef && !row.isParent && !row.isTbd) {
              const formula = `IF(${SCENARIO_REF}="Conservative",${lowRef},IF(${SCENARIO_REF}="Aggressive",${highRef},(${lowRef}+${highRef})/2))`;
              cell.value = { formula, result: midResult };
              cell.ignoredErrors = { formula: true, formulaRange: true, numberStoredAsText: true };
            } else {
              cell.value = midResult;
            }
          }
          // Indicative Annual Savings = Spend × Savings %.
          else if (c.formulaKind === 'annualSavings') {
            const spendRef = cellRef('spend', r);
            const pctRef = cellRef('savingsPct', r);
            const midResult = (v && typeof v === 'object' && Number.isFinite(v.mid)) ? Math.round(v.mid) : 0;
            if (spendRef && pctRef && !row.isParent && !row.isTbd) {
              cell.value = { formula: `${spendRef}*${pctRef}`, result: midResult };
              cell.ignoredErrors = { formula: true, formulaRange: true, numberStoredAsText: true };
            } else {
              // Parent row: precomputed sum-of-children Annual.
              cell.value = midResult;
            }
          }
          // Year N Cumulative = IF(years_toggle >= N, Annual × N, 0).
          // Loses the contract-month-precise gating the old monthly
          // accumulator did, in exchange for live recompute when the
          // user edits Low / High.
          else if (c.formulaKind === 'yearCumulative') {
            const annualRef = cellRef('annualSavings', r);
            const N = c.yearGate;
            const midResult = (v && typeof v === 'object' && Number.isFinite(v.mid)) ? Math.round(v.mid * (N || 1)) : 0;
            if (annualRef && N && !row.isParent && !row.isTbd) {
              cell.value = {
                formula: `IF(--${YEARS_REF}>=${N},${annualRef}*${N},0)`,
                result: midResult,
              };
              cell.ignoredErrors = { formula: true, formulaRange: true, numberStoredAsText: true };
            } else {
              // Parent row keeps the precomputed value (already a
              // sum of the children's Year N values).
              cell.value = midResult;
            }
          }
          else if (c.scenario) {
            // Even when the row has no savings band (regulated state)
            // we still emit a formula returning 0 — that keeps every
            // cell in the column shaped the same way so Excel doesn't
            // raise the "inconsistent formula" warning when it sees a
            // mix of formulas and constants in one column. The helper
            // also stamps ignoredErrors on the cell so the warning
            // triangle is suppressed even if it would otherwise fire.
            if (v && typeof v === 'object') {
              writeScenarioFormula(cell, ceilForFmt(v.low, c.numFmt), ceilForFmt(v.mid, c.numFmt), ceilForFmt(v.high, c.numFmt), c.yearGate);
            } else {
              writeScenarioFormula(cell, 0, 0, 0, c.yearGate);
            }
          } else if (c.yearGate != null) {
            // Non-scenario column that still needs the term-length
            // gate (reg-rate Year 1-5 cumulative). Wrap the constant
            // in IF(years>=N, value, 0) so it follows the dropdown.
            writeYearGatedConstant(cell, ceilForFmt(v, c.numFmt), c.yearGate);
          } else if (v === '' || v == null) {
            writeBlank(cell, !!c.numFmt);
          } else if (c.dateColumn) {
            // Coerce date-like strings / Dates to a true Date so the
            // cell numFmt 'm/d/yyyy' renders as a short date instead
            // of falling back to General (raw text / serial number).
            cell.value = toExcelDate(v);
          } else {
            cell.value = ceilForFmt(v, c.numFmt);
          }
          // Parent aggregate rows (United States / Canada) render
          // bold + a light green band so they visually separate from
          // the per-state children grouped below them. "Too low"
          // markets get an amber row tint so users can scan and skip
          // them quickly.
          if (row.isParent) {
            cell.font = { name: 'Nunito Sans', size: 10, bold: true, color: { argb: SE_TEXT_DARK } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
          } else if (isTooLow(row)) {
            cell.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOO_LOW_FILL } };
          } else {
            cell.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
          }
          // Bottom-aligned data rows (per user spec) — values sit
          // tight to the bottom of the cell so the section reads as
          // one block. Heights stay just tall enough for one line of
          // text, with a bump only when a flag cell is wrapping.
          cell.alignment = { vertical: 'bottom', horizontal: 'left', indent: 1, wrapText: !!c.wrapText };
          if (c.numFmt) cell.numFmt = c.numFmt;
          cell.border = { bottom: { style: 'hair', color: { argb: SE_BORDER } } };
        });
        // Bump the row height only when a wrapped cell actually
        // carries content (multi-line flag), otherwise stay at 16
        // — just tall enough to show a single line at 10pt.
        const anyWrap = columnDefs.some(c => c.wrapText && !c.spacer && c.get(row));
        dataRow.height = anyWrap ? 32 : 16;
        r += 1;
      }
      // Capture the last deregulated data row BEFORE we append the
      // regulated-summary line below — the Total row's SUM / SUMPRODUCT
      // formulas need to skip the summary so the weighted savings %
      // doesn't get diluted by zero-savings regulated spend.
      const dataEndRow = r - 1;

      // Regulated-markets summary row — single greyed-out line that
      // surfaces the sites we filtered out of the leaf rows above (any
      // state / province whose status is 'no' / 'Regulated' / etc.).
      // The user still sees the count + the underlying spend / load but
      // every savings column reads $0 / 0 %, signalling that those
      // markets carry no deregulated motion.
      const hiddenRegulatedRows = sectionRows.filter(row =>
        !row.isParent && REGULATED_STATUSES.has(row.status)
      );
      const sumOf = (key) => hiddenRegulatedRows.reduce((s, x) => s + (Number(x[key]) || 0), 0);
      // Lifted above the if-block so the Total-row roll-up below can
      // fold the regulated count into the headline Total Sites figure.
      const aggTotalSites  = sumOf('totalSites');
      const aggConsumption = sumOf('consumption');
      const aggSpend       = sumOf('spend');
      const aggLeasedSites = sumOf('leasedSites');
      const aggEligible    = sumOf('savingsEligibleSpend');
      if (hiddenRegulatedRows.length > 0) {
        const REG_ROW_FILL = 'FFE5E7EB';
        const REG_ROW_TEXT = SE_SLATE;
        const aggRow = ws.getRow(r);
        columnDefs.forEach((c, i) => {
          const cell = aggRow.getCell(i + 1);
          if (c.spacer) return;
          if (i === 0) {
            cell.value = `Remaining sites in regulated markets (${hiddenRegulatedRows.length} state${hiddenRegulatedRows.length === 1 ? '' : 's'} / province${hiddenRegulatedRows.length === 1 ? '' : 's'})`;
          } else if (c.label === 'Deregulated Status') {
            cell.value = 'Regulated';
          } else if (c.sumKey === 'totalSites') {
            cell.value = aggTotalSites;
          } else if (c.sumKey === 'consumption') {
            cell.value = aggConsumption;
          } else if (c.sumKey === 'leasedSites') {
            cell.value = aggLeasedSites;
          // Checked ahead of the spend branch below: the eligible column
          // carries the 'spend' tag (it is what the savings formulas
          // multiply against) but its own sum.
          } else if (c.sumKey === 'savingsEligibleSpend') {
            cell.value = aggEligible;
          } else if (c.tag === 'spend' || c.sumKey === 'spend') {
            cell.value = aggSpend;
          } else if (c.numFmt && c.numFmt.includes('"$"')) {
            cell.value = 0;
          } else if (c.numFmt && c.numFmt.includes('%')) {
            cell.value = 0;
          } else {
            writeBlank(cell, !!c.numFmt);
          }
          cell.font = { name: 'Nunito Sans', italic: true, size: 10, color: { argb: REG_ROW_TEXT } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: REG_ROW_FILL } };
          cell.alignment = { vertical: 'bottom', horizontal: 'left', indent: 1 };
          if (c.numFmt) cell.numFmt = c.numFmt;
          cell.border = { bottom: { style: 'hair', color: { argb: SE_BORDER } } };
        });
        aggRow.height = 18;
        r += 1;
      }

      // Total row — green double rule above and below. Scenario
      // columns sum each scenario branch independently then write
      // the same toggle-driven formula so the totals follow the
      // selected scenario.
      const totalRow = ws.getRow(r);
      const scalarTotals = {};
      const scenarioTotals = {};
      // Sum across LEAF rows only — and only the rows that actually
      // render after the regulated-with-no-reg-rate filter, so totals
      // match what the user sees. Parent aggregate rows (United
      // States / Canada) carry sum-of-children values; summing them
      // alongside their children would double-count the totals.
      const summable = visibleRows.filter(row => !row.isParent);
      // Record this section's Total → Indicative Annual Savings cell (the
      // total row is at `r`) and its Base value for the Savings Summary
      // band. Base = sum of each visible leaf row's mid annual savings.
      const annualColIdx = columnDefs.findIndex(c => c.formulaKind === 'annualSavings');
      if (annualColIdx >= 0) {
        const annualBaseMid = summable.reduce((sum, row) => {
          const t = row.annualSavings;
          return sum + (t && typeof t === 'object' && Number.isFinite(t.mid) ? t.mid : 0);
        }, 0);
        annualTotals[label] = { cell: `${colLetterFor(annualColIdx + 1)}${r}`, base: annualBaseMid };
      }
      for (const c of columnDefs) {
        if (!c.sumKey) continue;
        if (c.scenario) {
          let low = 0, mid = 0, high = 0;
          for (const row of summable) {
            const t = c.get(row);
            if (t && typeof t === 'object') {
              low += Number(t.low) || 0;
              mid += Number(t.mid) || 0;
              high += Number(t.high) || 0;
            }
          }
          scenarioTotals[c.sumKey] = { low, mid, high };
        } else {
          let s = 0;
          for (const row of summable) s += Number(c.get(row)) || 0;
          scalarTotals[c.sumKey] = s;
        }
      }
      // Fold the regulated-markets summary into the headline Total
      // Sites count so the Total row reflects the entire portfolio,
      // not just the deregulated motion. Spend / consumption / savings
      // columns stay dereg-only — the summary row's spend is real but
      // doesn't roll into the deregulated rate motion, so summing it
      // into the Total Spend / Savings would muddy the savings story.
      if (hiddenRegulatedRows.length > 0 && scalarTotals.totalSites != null) {
        scalarTotals.totalSites += aggTotalSites;
      }
      const colRange = (tag) => {
        const col = colByTag[tag];
        if (!col || dataEndRow < dataStartRow) return null;
        const letter = colLetterFor(col);
        return `${letter}${dataStartRow}:${letter}${dataEndRow}`;
      };
      columnDefs.forEach((c, i) => {
        const cell = totalRow.getCell(i + 1);
        if (c.spacer) return;
        if (i === 0) {
          cell.value = 'Total';
        } else if (c.editable === 'lowPct' || c.editable === 'highPct') {
          // Per-state min / max so the totals row reads as the range
          // span across the table rather than a meaningless sum.
          const range = colRange(c.editable);
          if (range) {
            const fn = c.editable === 'lowPct' ? 'MIN' : 'MAX';
            cell.value = { formula: `${fn}(${range})`, result: 0 };
            cell.ignoredErrors = { formula: true };
          } else {
            writeBlank(cell, !!c.numFmt);
          }
        } else if (c.formulaKind === 'savingsPct') {
          // Spend-weighted average so the total row reflects the
          // portfolio-weighted savings rate rather than a flat mean.
          const spendRange = colRange('spend');
          const pctRange = colRange('savingsPct');
          if (spendRange && pctRange) {
            cell.value = {
              formula: `IFERROR(SUMPRODUCT(${spendRange},${pctRange})/SUM(${spendRange}),0)`,
              result: 0,
            };
            cell.ignoredErrors = { formula: true };
          } else {
            writeBlank(cell, !!c.numFmt);
          }
        } else if (c.formulaKind === 'annualSavings') {
          const r2 = colRange('annualSavings');
          if (r2) {
            cell.value = { formula: `SUM(${r2})`, result: 0 };
            cell.ignoredErrors = { formula: true };
          } else writeBlank(cell, !!c.numFmt);
        } else if (c.formulaKind === 'yearCumulative') {
          // Each Year N column lives at its own column letter — find
          // it via the column index, not a tag.
          const col = colLetterFor(i + 1);
          const r2 = `${col}${dataStartRow}:${col}${dataEndRow}`;
          if (dataEndRow >= dataStartRow) {
            cell.value = { formula: `SUM(${r2})`, result: 0 };
            cell.ignoredErrors = { formula: true };
          } else writeBlank(cell, !!c.numFmt);
        } else if (c.scenario && c.sumKey) {
          const t = scenarioTotals[c.sumKey];
          writeScenarioFormula(cell, ceilForFmt(t.low, c.numFmt), ceilForFmt(t.mid, c.numFmt), ceilForFmt(t.high, c.numFmt), c.yearGate);
        } else if (c.yearGate != null && c.sumKey) {
          writeYearGatedConstant(cell, ceilForFmt(scalarTotals[c.sumKey] || 0, c.numFmt), c.yearGate);
        } else if (c.sumKey) {
          cell.value = ceilForFmt(scalarTotals[c.sumKey] || 0, c.numFmt);
        } else {
          writeBlank(cell, !!c.numFmt);
        }
        cell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: SE_GREEN_DARK } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
        cell.alignment = { vertical: 'bottom', horizontal: 'left', indent: 1 };
        if (c.numFmt) cell.numFmt = c.numFmt;
        cell.border = {
          top: { style: 'thin', color: { argb: SE_GREEN_DARK } },
          bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } },
        };
      });
      totalRow.height = 18;
      r += 2;
    }

    // The savings tables carry the raw deregulation status ('yes' for
    // deregulated US / Canadian states, 'Limited', country-level
    // 'Deregulated', etc.). 'yes' is an internal flag — surface it as the
    // human-readable "Deregulated" in the exported Indicative Savings tabs
    // so every deregulated market reads consistently.
    const displayDeregStatus = (s) => (s === 'yes' ? 'Deregulated' : s);

    // The leased-location columns, present only on a portfolio that has
    // some. `Leased Sites` explains why a market's site count can run
    // ahead of the spend the savings are taken off; `Savings-Eligible
    // Spend/yr` is that spend, and it carries the 'spend' tag so every
    // savings formula on the row (Savings %, Indicative Annual Savings,
    // Year 1-5, and the Total row's spend-weighted average) multiplies
    // against it instead of the full deregulated figure. With no leased
    // sites the tag stays on Deregulated Spend/yr and the sheet is
    // unchanged.
    const leasedSitesCol = showLeasedColumns
      ? [{ label: 'Leased Sites', get: (g) => g.leasedSites, numFmt: '#,##0', sumKey: 'leasedSites' }]
      : [];
    const eligibleSpendCol = showLeasedColumns
      ? [{ label: 'Savings-Eligible Spend/yr', tag: 'spend', get: (g) => g.savingsEligibleSpend, numFmt: '"$"#,##0', sumKey: 'savingsEligibleSpend' }]
      : [];
    // Only one of the two spend columns carries the formula tag.
    const fullSpendTag = showLeasedColumns ? undefined : 'spend';

    const electricCols = [
      { label: 'ST / Prov / Country', get: (g) => g.state },
      { label: 'Deregulated Status', get: (g) => displayDeregStatus(g.status) },
      { label: 'Total Sites', get: (g) => g.totalSites, numFmt: '#,##0', sumKey: 'totalSites' },
      { label: 'Deregulated Sites', get: (g) => g.deregulatedSites, numFmt: '#,##0', sumKey: 'deregulatedSites' },
      ...leasedSitesCol,
      { label: 'Deregulated Consumption kWh/yr', get: (g) => g.consumption, numFmt: '#,##0', sumKey: 'consumption' },
      { label: 'Deregulated Spend/yr', tag: fullSpendTag, get: (g) => g.spend, numFmt: '"$"#,##0', sumKey: 'spend' },
      ...eligibleSpendCol,
      // Editable Low / High range inputs replace the static "Range"
      // text column. Yellow fill signals input; downstream Savings %
      // / Annual Savings / Year 1-5 cells are formulas that read
      // these so editing them recomputes the rest of the row.
      { label: 'Low %', tag: 'lowPct', editable: 'lowPct', get: (g) => g.lowPct, numFmt: '0.0%' },
      { label: 'High %', tag: 'highPct', editable: 'highPct', get: (g) => g.highPct, numFmt: '0.0%' },
      // Savings % picks low / mid / high from the row's editable
      // cells based on the scenario toggle at the top of the sheet.
      { label: 'Savings %', tag: 'savingsPct', formulaKind: 'savingsPct', get: (g) => g.savingsPct, numFmt: '0.0%' },
      // Annual + Year 1-5 cumulative for the deregulated motion only.
      // Reg-rate savings live in their own block to the right.
      { label: 'Indicative Annual Savings', tag: 'annualSavings', formulaKind: 'annualSavings', get: (g) => g.annualSavings, numFmt: '"$"#,##0', sumKey: 'annualSavings' },
      { label: 'Year 1 Cumulative', formulaKind: 'yearCumulative', yearGate: 1, get: (g) => g.year1, numFmt: '"$"#,##0', sumKey: 'year1' },
      { label: 'Year 2 Cumulative', formulaKind: 'yearCumulative', yearGate: 2, get: (g) => g.year2, numFmt: '"$"#,##0', sumKey: 'year2' },
      { label: 'Year 3 Cumulative', formulaKind: 'yearCumulative', yearGate: 3, get: (g) => g.year3, numFmt: '"$"#,##0', sumKey: 'year3' },
      { label: 'Year 4 Cumulative', formulaKind: 'yearCumulative', yearGate: 4, get: (g) => g.year4, numFmt: '"$"#,##0', sumKey: 'year4' },
      { label: 'Year 5 Cumulative', formulaKind: 'yearCumulative', yearGate: 5, get: (g) => g.year5, numFmt: '"$"#,##0', sumKey: 'year5' },
      { label: 'Utility Vendor(s)', get: (g) => g.utilities },
      { label: 'Supplier Name(s)', get: (g) => g.suppliers },
      { label: 'Contract Start', get: (g) => g.earliestStart, numFmt: 'm/d/yyyy', dateColumn: true },
      { label: 'Contract End', get: (g) => g.latestEnd, numFmt: 'm/d/yyyy', dateColumn: true },
      // Spacer column — physically separates the deregulated block
      // from the regulated-rate block so the two motions read as
      // distinct stories on the sheet. (Per-state flags now live in
      // the Findings & Recommendations summary at the top of the
      // sheet, so the inline column is gone.)
      { label: '', get: () => '', spacer: true },
      // Regulated-rate block: site count + flat 0.25 % savings + its
      // own Year 1-5 cumulative, isolated from the deregulated totals.
      // The Year 1-5 columns honor the same term-length dropdown as
      // the deregulated block so the user sees a consistent horizon.
      { label: 'Reg. Rate Savings Sites', get: (g) => g.regulatedRateOpportunitySites, numFmt: '#,##0', sumKey: 'regulatedRateOpportunitySites' },
      { label: 'Reg. Rate Savings (0.25%)', get: (g) => g.regRateSavings || '', numFmt: '"$"#,##0', sumKey: 'regRateSavings' },
      { label: 'Reg. Rate Year 1 Savings', yearGate: 1, get: (g) => g.regYear1 || 0, numFmt: '"$"#,##0', sumKey: 'regYear1' },
      { label: 'Reg. Rate Year 2 Cumulative', yearGate: 2, get: (g) => g.regYear2 || 0, numFmt: '"$"#,##0', sumKey: 'regYear2' },
      { label: 'Reg. Rate Year 3 Cumulative', yearGate: 3, get: (g) => g.regYear3 || 0, numFmt: '"$"#,##0', sumKey: 'regYear3' },
      { label: 'Reg. Rate Year 4 Cumulative', yearGate: 4, get: (g) => g.regYear4 || 0, numFmt: '"$"#,##0', sumKey: 'regYear4' },
      { label: 'Reg. Rate Year 5 Cumulative', yearGate: 5, get: (g) => g.regYear5 || 0, numFmt: '"$"#,##0', sumKey: 'regYear5' },
    ];
    const gasCols = [
      { label: 'ST / Prov / Country', get: (g) => g.state },
      { label: 'Deregulated Status', get: (g) => displayDeregStatus(g.status) },
      { label: 'Sites', get: (g) => g.totalSites, numFmt: '#,##0', sumKey: 'totalSites' },
      { label: 'Deregulated Sites', get: (g) => g.deregulatedSites, numFmt: '#,##0', sumKey: 'deregulatedSites' },
      ...leasedSitesCol,
      { label: 'Deregulated Consumption Dth/yr', get: (g) => g.consumption, numFmt: '#,##0', sumKey: 'consumption' },
      { label: 'Deregulated Spend/yr', tag: fullSpendTag, get: (g) => g.spend, numFmt: '"$"#,##0', sumKey: 'spend' },
      ...eligibleSpendCol,
      // Editable Low / High range inputs replace the static "Range"
      // text column. Yellow fill signals input; downstream Savings %
      // / Annual Savings / Year 1-5 cells are formulas that read
      // these so editing them recomputes the rest of the row.
      { label: 'Low %', tag: 'lowPct', editable: 'lowPct', get: (g) => g.lowPct, numFmt: '0.0%' },
      { label: 'High %', tag: 'highPct', editable: 'highPct', get: (g) => g.highPct, numFmt: '0.0%' },
      { label: 'Savings %', tag: 'savingsPct', formulaKind: 'savingsPct', get: (g) => g.savingsPct, numFmt: '0.0%' },
      // Annual + Year 1-5 cumulative for the deregulated motion.
      { label: 'Indicative Annual Savings', tag: 'annualSavings', formulaKind: 'annualSavings', get: (g) => g.annualSavings, numFmt: '"$"#,##0', sumKey: 'annualSavings' },
      { label: 'Year 1 Cumulative', formulaKind: 'yearCumulative', yearGate: 1, get: (g) => g.year1, numFmt: '"$"#,##0', sumKey: 'year1' },
      { label: 'Year 2 Cumulative', formulaKind: 'yearCumulative', yearGate: 2, get: (g) => g.year2, numFmt: '"$"#,##0', sumKey: 'year2' },
      { label: 'Year 3 Cumulative', formulaKind: 'yearCumulative', yearGate: 3, get: (g) => g.year3, numFmt: '"$"#,##0', sumKey: 'year3' },
      { label: 'Year 4 Cumulative', formulaKind: 'yearCumulative', yearGate: 4, get: (g) => g.year4, numFmt: '"$"#,##0', sumKey: 'year4' },
      { label: 'Year 5 Cumulative', formulaKind: 'yearCumulative', yearGate: 5, get: (g) => g.year5, numFmt: '"$"#,##0', sumKey: 'year5' },
      { label: 'Utility Vendor(s)', get: (g) => g.utilities },
      { label: 'Supplier Name(s)', get: (g) => g.suppliers },
      { label: 'Contract Start', get: (g) => g.earliestStart, numFmt: 'm/d/yyyy', dateColumn: true },
      { label: 'Contract End', get: (g) => g.latestEnd, numFmt: 'm/d/yyyy', dateColumn: true },
    ];

    // Findings & Recommendations summary band — pulled from the
    // per-state flags so the user sees a roll-up at the top of the
    // sheet instead of having to scan each row's Flags cell. Drops
    // entire categories that don't have any hits; skips the whole
    // band when nothing fires. The state-level Flags column is
    // intentionally removed below — this summary is the single
    // place flags surface on this sheet.
    const collectStates = (rows, needle) => rows
      .filter(r => r.flags && r.flags.includes(needle))
      .map(r => r.state);
    const summaryFindings = [];
    const riskMgmtStates = collectStates(electricRows, 'Risk Management');
    const wholesalePlusStates = collectStates(electricRows, 'Wholesale Plus');
    const smallElectricStates = collectStates(electricRows, 'Spend < $1M');
    const mexicoStates = collectStates(electricRows, 'Mexico sourcing');
    const smallGasStates = collectStates(gasRows, 'too low for sourcing');
    // Limited-market gating flags surfaced in the summary band so the
    // seller doesn't have to scan each row's Flags cell.
    const vaHeavyLoadStates = collectStates(electricRows, 'Virginia site exceeds 45,000 MWh');
    const limitedSupplyStates = collectStates(electricRows, 'can only help if 3rd-party supply');
    // Portfolio-wide VPPA opportunity flag. North America electric
    // load above 100,000 MWh/yr is the threshold where a Virtual PPA
    // typically pencils out. NA = US states + Canadian provinces
    // (which bucket at state level — non-NA countries roll up as
    // isCountry rows and are excluded). Consumption is stored in kWh,
    // so divide by 1000 to compare in MWh.
    const naElectricMWh = electricRows
      .filter(r => !r.isCountry)
      .reduce((sum, r) => sum + (r.consumption || 0), 0) / 1000;
    if (naElectricMWh > 100_000) {
      summaryFindings.push(`A VPPA should be explored: North America electric consumption ${Math.round(naElectricMWh).toLocaleString()} MWh exceeds 100,000 MWh threshold`);
    }
    if (riskMgmtStates.length) {
      summaryFindings.push(`Risk Management should be considered (>10,000 MWh): ${riskMgmtStates.join(', ')}`);
    }
    if (wholesalePlusStates.length) {
      summaryFindings.push(`Wholesale Plus should be explored (>44,000 MWh): ${wholesalePlusStates.join(', ')}`);
    }
    if (vaHeavyLoadStates.length) {
      summaryFindings.push('Virginia site exceeds 45,000 MWh/yr: large-load deregulation threshold met');
    }
    if (limitedSupplyStates.length) {
      summaryFindings.push(`Limited market (can only help if 3rd-party supply is already in place), ${limitedSupplyStates.join(', ')}`);
    }
    if (smallElectricStates.length) {
      summaryFindings.push(`Small electric market: Deregulated spend < $1M: ${smallElectricStates.join(', ')}`);
    }
    if (mexicoStates.length) {
      summaryFindings.push(`Potential Mexico sourcing opportunity: ${mexicoStates.join(', ')}`);
    }
    if (smallGasStates.length) {
      summaryFindings.push(`Natural gas consumption might be too low for sourcing (<$30K): ${smallGasStates.join(', ')}`);
    }

    // Reserve the top-of-body rows for the Savings Summary band. It's
    // filled in after the Electric / Gas sections are written (so their
    // Total cells exist to reference), but it lives here — above the
    // Findings & Recommendations band and the by-state tables.
    const summaryBandHeaderRow = r;
    const summaryBandValueRow = r + 1;
    const summaryBandCumulativeRow = r + 2;
    // Scope line, on any portfolio with leased locations: which basis the
    // two headline figures above were built on. Written whether they were
    // left out or counted in — the same portfolio produces two different
    // headlines depending on that answer, and a reader who wasn't at the
    // screen when the button was set can't tell them apart otherwise.
    const summaryBandLeasedRow = noteLeasedScope ? r + 3 : null;
    // Two data-quality lines (estimated usage / estimated cost shares).
    // Written even later than the rest of the band — the per-site
    // estimate flags only exist once the Site Detail rows are built.
    const summaryBandUsageQualityRow = r + (noteLeasedScope ? 4 : 3);
    const summaryBandCostQualityRow = summaryBandUsageQualityRow + 1;
    // band header + annual + cumulative + (leased scope) + 2 data-quality
    // lines + a breather row
    r += noteLeasedScope ? 7 : 6;

    if (summaryFindings.length > 0) {
      // Section band, same look as the Electric Power / Natural Gas
      // bands so it reads as a peer section.
      ws.mergeCells(r, 1, r, SPAN);
      const head = ws.getCell(r, 1);
      head.value = 'Findings & Recommendations';
      head.font = { name: 'Nunito Sans', bold: true, size: 12, color: { argb: SE_GREEN_DARK } };
      head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
      head.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(r).height = 22;
      r += 1;
      for (const text of summaryFindings) {
        ws.mergeCells(r, 1, r, SPAN);
        const cell = ws.getCell(r, 1);
        cell.value = `•  ${text}`;
        cell.font = { name: 'Nunito Sans', size: 11, color: { argb: SE_TEXT_DARK } };
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 2, wrapText: true };
        cell.border = { bottom: { style: 'hair', color: { argb: SE_BORDER } } };
        ws.getRow(r).height = 22;
        r += 1;
      }
      r += 1; // breather row before the Electric Power section
    }

    // When the portfolio is global, nest US state rows under a
    // synthetic "United States" parent row (and same for Canadian
    // provinces). Country buckets bubble to the top; the parent row
    // carries the rolled-up US totals so the user reads it as a
    // single line in the country list, with the per-state breakdown
    // collapsible below it. When the portfolio is US-only, this is a
    // no-op and the rows render in the existing alphabetical order.
    function restructureForGlobal(sectionRows) {
      if (!hasGlobalSites) return sectionRows;
      const countries = [];
      const usStates = [];
      const caProvinces = [];
      for (const g of sectionRows) {
        if (g.isCountry) countries.push(g);
        else if (CANADA_PROVINCE_CENTERS[String(g.state).toUpperCase()]) caProvinces.push(g);
        else usStates.push(g);
      }
      // Rank each group by deregulated spend descending so the
      // biggest commodity-savings opportunities sit at the top of
      // each block. Ties fall back to state-code alphabetical for
      // stable ordering.
      const bySpend = (a, b) => {
        const ds = (Number(b.spend) || 0) - (Number(a.spend) || 0);
        if (ds !== 0) return ds;
        return String(a.state).localeCompare(String(b.state));
      };
      countries.sort(bySpend);
      usStates.sort(bySpend);
      caProvinces.sort(bySpend);

      // Build a synthetic parent row that aggregates the child rows
      // for a country group. Numeric scalars sum; per-scenario triples
      // ({low, mid, high}) sum element-wise; lowPct/highPct stay null
      // because the editable yellow cells only make sense per state.
      const buildParent = (label, children) => {
        if (!children.length) return null;
        const sum = (k) => children.reduce((a, c) => a + (Number(c[k]) || 0), 0);
        const sumTriple = (k) => {
          let lo = 0, mi = 0, hi = 0;
          let any = false;
          for (const c of children) {
            const t = c[k];
            if (t && typeof t === 'object') {
              lo += Number(t.low)  || 0;
              mi += Number(t.mid)  || 0;
              hi += Number(t.high) || 0;
              any = true;
            }
          }
          return any ? { low: Math.round(lo), mid: Math.round(mi), high: Math.round(hi) } : null;
        };
        return {
          state: label,
          isCountry: true, // groups visually with the other country rows
          isParent: true,  // suppresses the editable Low/High yellow cells
          status: '',
          totalSites: sum('totalSites'),
          deregulatedSites: sum('deregulatedSites'),
          leasedSites: sum('leasedSites'),
          regulatedRateOpportunitySites: sum('regulatedRateOpportunitySites'),
          regulatedRateOpportunitySpend: sum('regulatedRateOpportunitySpend'),
          regRateSavings: sum('regRateSavings'),
          consumption: sum('consumption'),
          spend: sum('spend'),
          savingsEligibleSpend: sum('savingsEligibleSpend'),
          range: '',
          savingsPct: null,
          lowPct: null,
          highPct: null,
          annualSavings: sumTriple('annualSavings'),
          year1: sumTriple('year1'),
          year2: sumTriple('year2'),
          year3: sumTriple('year3'),
          year4: sumTriple('year4'),
          year5: sumTriple('year5'),
          flags: '',
          // Empty supplier / contract metadata — the underlying state
          // rows still carry per-state values for these columns.
          supplierNames: '',
          earliestContractStart: null,
          latestContractEnd: null,
          monthsUnderContract: null,
          monthsOffContract: null,
        };
      };

      const usParent = buildParent('United States', usStates);
      const caParent = buildParent('Canada', caProvinces);
      // Mark children for outline grouping. writeSection reads
      // `_outlineLevel` and applies it to the dataRow.
      for (const s of usStates) s._outlineLevel = 1;
      for (const s of caProvinces) s._outlineLevel = 1;

      const out = [];
      out.push(...countries);
      if (usParent) { out.push(usParent); out.push(...usStates); }
      if (caParent) { out.push(caParent); out.push(...caProvinces); }
      return out;
    }

    writeSection('Electric Power', restructureForGlobal(electricRows), electricCols);
    writeSection('Natural Gas',   restructureForGlobal(gasRows),       gasCols);

    // ---- Savings Summary band (top of the Indicative Savings sheet) --
    // Combined indicative annual savings across electric + gas, written
    // into the rows reserved above. Uses a live formula that sums each
    // section's Total → Indicative Annual Savings cell, so the headline
    // follows the Savings Scenario toggle exactly like the tables below.
    {
      ws.mergeCells(summaryBandHeaderRow, 1, summaryBandHeaderRow, SPAN);
      const sHead = ws.getCell(summaryBandHeaderRow, 1);
      sHead.value = 'Savings Summary';
      sHead.font = { name: 'Nunito Sans', bold: true, size: 12, color: { argb: SE_GREEN_DARK } };
      sHead.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
      sHead.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(summaryBandHeaderRow).height = 22;

      const elecTot = annualTotals['Electric Power'];
      const gasTot = annualTotals['Natural Gas'];
      const refs = [elecTot?.cell, gasTot?.cell].filter(Boolean);
      const baseResult = Math.round((elecTot?.base || 0) + (gasTot?.base || 0));

      // Label (cols 1–9) · value (col 10) · note (cols 11–SPAN).
      ws.mergeCells(summaryBandValueRow, 1, summaryBandValueRow, 9);
      const sLabel = ws.getCell(summaryBandValueRow, 1);
      sLabel.value = 'Total Indicative Annual Savings (Electric + Natural Gas)';
      sLabel.font = { name: 'Nunito Sans', bold: true, size: 12, color: { argb: SE_TEXT_DARK } };
      sLabel.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

      const sValue = ws.getCell(summaryBandValueRow, 10);
      if (refs.length) {
        sValue.value = { formula: refs.join('+'), result: baseResult };
        sValue.ignoredErrors = { formula: true };
      } else {
        sValue.value = baseResult;
      }
      sValue.numFmt = '"$"#,##0';
      sValue.font = { name: 'Nunito Sans', bold: true, size: 14, color: { argb: SE_GREEN_DARK } };
      sValue.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

      ws.mergeCells(summaryBandValueRow, 11, summaryBandValueRow, SPAN);
      const sNote = ws.getCell(summaryBandValueRow, 11);
      sNote.value = 'Follows the Savings Scenario toggle above (Base = average of the Low / High range).';
      sNote.font = { name: 'Nunito Sans', italic: true, size: 10, color: { argb: SE_SLATE } };
      sNote.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
      ws.getRow(summaryBandValueRow).height = 24;

      // Cumulative line — annual total × the # of Years dropdown, so
      // the headline re-derives whenever the user changes the term.
      const defaultTermYears = Number(ws.getCell(YEARS_LOCAL_CELL).value) || 1;
      ws.mergeCells(summaryBandCumulativeRow, 1, summaryBandCumulativeRow, 9);
      const cLabel = ws.getCell(summaryBandCumulativeRow, 1);
      cLabel.value = 'Total Indicative Cumulative Savings over the Term (Electric + Natural Gas)';
      cLabel.font = { name: 'Nunito Sans', bold: true, size: 12, color: { argb: SE_TEXT_DARK } };
      cLabel.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

      const cValue = ws.getCell(summaryBandCumulativeRow, 10);
      if (refs.length) {
        cValue.value = {
          formula: `(${refs.join('+')})*--${YEARS_REF}`,
          result: baseResult * defaultTermYears,
        };
        cValue.ignoredErrors = { formula: true };
      } else {
        cValue.value = baseResult * defaultTermYears;
      }
      cValue.numFmt = '"$"#,##0';
      cValue.font = { name: 'Nunito Sans', bold: true, size: 14, color: { argb: SE_GREEN_DARK } };
      cValue.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

      ws.mergeCells(summaryBandCumulativeRow, 11, summaryBandCumulativeRow, SPAN);
      const cNote = ws.getCell(summaryBandCumulativeRow, 11);
      cNote.value = 'Annual savings × the # of Years selected above: adjusts automatically when the term changes.';
      cNote.font = { name: 'Nunito Sans', italic: true, size: 10, color: { argb: SE_SLATE } };
      cNote.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
      ws.getRow(summaryBandCumulativeRow).height = 24;

      // Scope line — what the two figures above leave out. Same three-part
      // layout as the data-quality lines below them.
      if (summaryBandLeasedRow) {
        ws.mergeCells(summaryBandLeasedRow, 1, summaryBandLeasedRow, 9);
        const lLabel = ws.getCell(summaryBandLeasedRow, 1);
        lLabel.value = `Leased Sites (${excludeLeasedSavings ? 'excluded from' : 'included in'} the savings projection)`;
        lLabel.font = { name: 'Nunito Sans', bold: true, size: 12, color: { argb: SE_TEXT_DARK } };
        lLabel.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

        const lValue = ws.getCell(summaryBandLeasedRow, 10);
        lValue.value = leasedScope.leased;
        lValue.numFmt = '#,##0';
        lValue.font = { name: 'Nunito Sans', bold: true, size: 14, color: { argb: excludeLeasedSavings ? SE_EST : SE_GREEN_DARK } };
        lValue.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

        ws.mergeCells(summaryBandLeasedRow, 11, summaryBandLeasedRow, SPAN);
        const lNote = ws.getCell(summaryBandLeasedRow, 11);
        lNote.value = excludeLeasedSavings
          ? `${leasedScope.leased} of ${leasedScope.total} sites are marked Leased: their supply contracts aren't taken to be the portfolio's to re-source, so the savings above are taken off the remaining ${leasedScope.scoped.toLocaleString()}.`
          : `${leasedScope.leased} of ${leasedScope.total} sites are marked Leased and are counted in the savings above: this analysis was run on the basis that the portfolio holds their supply contracts.`;
        lNote.font = { name: 'Nunito Sans', italic: true, size: 10, color: { argb: SE_SLATE } };
        lNote.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
        ws.getRow(summaryBandLeasedRow).height = 24;
      }

      // ---- Populate the Executive Summary tab (tab #1) -------------
      // The two headline savings figures mirror the band just written —
      // via live cross-sheet references so they keep following the
      // Savings Scenario + # of Years toggles on the Indicative Savings
      // tab — sitting above the building-compliance screening KPIs so
      // the first tab reads as the portfolio snapshot the user wants.
      {
        const SUM_NCOLS = 8;
        const usdShort = (n) => {
          if (n == null || !Number.isFinite(n)) return '$-';
          const a = Math.abs(n);
          if (a >= 1e6) return '$' + (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
          if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
          return '$' + Math.round(n);
        };
        summarySheet.columns = [
          { width: 32 }, { width: 15 }, { width: 15 }, { width: 15 },
          { width: 15 }, { width: 15 }, { width: 15 }, { width: 15 },
        ];

        // Title + subtitle band.
        summarySheet.mergeCells(1, 1, 1, SUM_NCOLS);
        const sumTitle = summarySheet.getCell(1, 1);
        sumTitle.value = 'Executive Summary';
        sumTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN } };
        sumTitle.font = { name: 'Nunito Sans', bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
        sumTitle.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        summarySheet.getRow(1).height = 38;

        summarySheet.mergeCells(2, 1, 2, SUM_NCOLS);
        const sumSub = summarySheet.getCell(2, 1);
        sumSub.value = `Indicative savings headline and building-compliance exposure across the portfolio.  Generated ${new Date().toLocaleDateString()}`;
        sumSub.font = { name: 'Nunito Sans', italic: true, size: 10, color: { argb: SE_SLATE } };
        sumSub.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        summarySheet.getRow(2).height = 20;
        summarySheet.getRow(3).height = 6;

        const sumSection = (rowNum, text) => {
          summarySheet.mergeCells(rowNum, 1, rowNum, SUM_NCOLS);
          const c = summarySheet.getCell(rowNum, 1);
          c.value = text;
          c.font = { name: 'Nunito Sans', bold: true, size: 12, color: { argb: SE_GREEN_DARK } };
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
          c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
          summarySheet.getRow(rowNum).height = 22;
        };

        // Section 1: Indicative Savings — the two headline figures,
        // pulled live from the Indicative Savings tab's Savings Summary
        // band (column J of the two band rows).
        const savingsFigure = (rowNum, label, formulaRef, resultVal) => {
          summarySheet.mergeCells(rowNum, 1, rowNum, 5);
          const lab = summarySheet.getCell(rowNum, 1);
          lab.value = label;
          lab.font = { name: 'Nunito Sans', bold: true, size: 11, color: { argb: SE_TEXT_DARK } };
          lab.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
          summarySheet.mergeCells(rowNum, 6, rowNum, SUM_NCOLS);
          const val = summarySheet.getCell(rowNum, 6);
          if (refs.length) {
            val.value = { formula: formulaRef, result: resultVal };
            val.ignoredErrors = { formula: true };
          } else {
            val.value = resultVal;
          }
          val.numFmt = '"$"#,##0';
          val.font = { name: 'Nunito Sans', bold: true, size: 14, color: { argb: SE_GREEN_DARK } };
          val.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
          summarySheet.getRow(rowNum).height = 26;
        };
        sumSection(4, 'Indicative Savings');
        savingsFigure(
          5,
          'Total Indicative Annual Savings (Electric + Natural Gas)',
          `'${SCENARIO_SHEET_NAME}'!$J$${summaryBandValueRow}`,
          baseResult,
        );
        savingsFigure(
          6,
          'Total Indicative Cumulative Savings over the Term (Electric + Natural Gas)',
          `'${SCENARIO_SHEET_NAME}'!$J$${summaryBandCumulativeRow}`,
          baseResult * defaultTermYears,
        );
        summarySheet.mergeCells(7, 1, 7, SUM_NCOLS);
        const savNote = summarySheet.getCell(7, 1);
        savNote.value = 'Mirrors the Indicative Savings tab, following the Savings Scenario and # of Years selections made there.';
        savNote.font = { name: 'Nunito Sans', italic: true, size: 9.5, color: { argb: SE_SLATE } };
        savNote.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
        summarySheet.getRow(7).height = 18;

        // From here down the sections vary in length (the states table has
        // one row per state), so track the next free row rather than hard-
        // coding row numbers.
        let sumRow = 8;
        summarySheet.getRow(sumRow++).height = 6; // spacer

        // Merged cells don't auto-fit in Excel, so a wrapped value in a
        // fixed-height row just gets clipped — which is what buried the
        // regimes list. Estimate the wrapped line count from the merged
        // width and size each row to fit. `chars` is the usable width in
        // characters (column width units ≈ characters, less the indent).
        // Shared by the findings bullets and the company sections below,
        // which all merge cells.
        const wrapLines = (text, chars) => String(text == null ? '' : text)
          .split('\n')
          .reduce((total, line) => {
            const words = line.split(/\s+/).filter(Boolean);
            if (!words.length) return total + 1;
            let lines = 1, len = 0;
            for (const w of words) {
              const next = len ? len + 1 + w.length : w.length;
              if (next <= chars) { len = next; continue; }
              lines++; len = w.length;
            }
            return total + lines;
          }, 0);

        // Section 1a: Findings & Recommendations — the same roll-up written
        // into the band on the Indicative Savings tab, repeated directly
        // under the headline figures so the first tab carries the "so what"
        // alongside the dollars instead of making the reader jump tabs for
        // it. Same `summaryFindings` array, so the two can't drift; skipped
        // entirely when no alert fired, exactly like the band.
        if (summaryFindings.length) {
          // Usable width of the merged row: the 8 column widths less the
          // bullet's indent, so a long state list wraps into a tall enough
          // row instead of being clipped.
          const findChars = (32 + 15 * (SUM_NCOLS - 1)) - 4;
          sumSection(sumRow++, 'Findings & Recommendations');
          for (const text of summaryFindings) {
            const rowNum = sumRow++;
            summarySheet.mergeCells(rowNum, 1, rowNum, SUM_NCOLS);
            const cell = summarySheet.getCell(rowNum, 1);
            cell.value = `•  ${text}`;
            cell.font = { name: 'Nunito Sans', size: 10.5, color: { argb: SE_TEXT_DARK } };
            cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 2, wrapText: true };
            cell.border = { bottom: { style: 'hair', color: { argb: SE_BORDER } } };
            summarySheet.getRow(rowNum).height = Math.max(20, wrapLines(`•  ${text}`, findChars) * 15);
          }
          summarySheet.mergeCells(sumRow, 1, sumRow, SUM_NCOLS);
          const findNote = summarySheet.getCell(sumRow, 1);
          findNote.value = 'Mirrors the Findings & Recommendations band on the Indicative Savings tab. The Alerts Catalog tab (hidden: right-click a tab → Unhide) documents every alert\'s trigger and threshold.';
          findNote.font = { name: 'Nunito Sans', italic: true, size: 9.5, color: { argb: SE_SLATE } };
          findNote.alignment = { vertical: 'top', horizontal: 'left', indent: 1, wrapText: true };
          // Sized like the bullets: the note runs past one merged line, and
          // a fixed 18pt row would clip its second line.
          summarySheet.getRow(sumRow++).height = Math.max(18, wrapLines(findNote.value, findChars) * 13);
          summarySheet.getRow(sumRow++).height = 6; // spacer
        }

        // Section 1b: Top 5 States by Indicative Savings — the five
        // highest-savings states / provinces / countries for electric and
        // for natural gas, side by side. Ranked by the Base (mid) Year 1
        // indicative savings from the same by-state buckets that drive the
        // Indicative Savings tab, so the figures line up with that sheet.
        const topSavingsBy = (bucketRows) => bucketRows
          .map(g => ({ state: g.state, sites: g.totalSites || 0, savings: (g.year1 && g.year1.mid) || 0 }))
          .filter(x => x.savings > 0)
          .sort((a, b) => b.savings - a.savings)
          .slice(0, 5);
        const topElectric = topSavingsBy(electricRows);
        const topGas = topSavingsBy(gasRows);

        if (topElectric.length || topGas.length) {
          sumSection(sumRow++, 'Top 5 States by Indicative Savings');
          // Commodity header row: Electric (cols 1-4) | Natural Gas (cols 5-8).
          const comHdrRowNum = sumRow++;
          [{ c: 1, t: 'Electric' }, { c: 5, t: 'Natural Gas' }].forEach(h => {
            summarySheet.mergeCells(comHdrRowNum, h.c, comHdrRowNum, h.c + 3);
            const cell = summarySheet.getCell(comHdrRowNum, h.c);
            cell.value = h.t;
            cell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: SE_GREEN_DARK } };
            cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
          });
          summarySheet.getRow(comHdrRowNum).height = 18;
          // Sub-header row: ST / Prov / Country | Sites | Yr 1 Savings (x2).
          const subHdrRowNum = sumRow++;
          const subHdrs = [
            { c: 1, t: 'ST / Prov / Country' }, { c: 2, t: 'Sites' }, { c: 3, span: 2, t: 'Yr 1 Savings' },
            { c: 5, t: 'ST / Prov / Country' }, { c: 6, t: 'Sites' }, { c: 7, span: 2, t: 'Yr 1 Savings' },
          ];
          subHdrs.forEach(h => {
            if (h.span) summarySheet.mergeCells(subHdrRowNum, h.c, subHdrRowNum, h.c + h.span - 1);
            const cell = summarySheet.getCell(subHdrRowNum, h.c);
            cell.value = h.t;
            cell.font = { name: 'Nunito Sans', bold: true, size: 9, color: { argb: SE_SLATE } };
            cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
            cell.border = { bottom: { style: 'thin', color: { argb: SE_BORDER } } };
          });
          summarySheet.getRow(subHdrRowNum).height = 16;
          // Up to five ranked rows, electric on the left, gas on the right.
          const writeTopBlock = (rowNum, startCol, item) => {
            const stCell = summarySheet.getCell(rowNum, startCol);
            stCell.value = item ? item.state : '';
            stCell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: SE_TEXT_DARK } };
            stCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
            const siCell = summarySheet.getCell(rowNum, startCol + 1);
            siCell.value = item ? item.sites : '';
            siCell.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
            siCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
            summarySheet.mergeCells(rowNum, startCol + 2, rowNum, startCol + 3);
            const svCell = summarySheet.getCell(rowNum, startCol + 2);
            svCell.value = item ? item.savings : '';
            if (item) svCell.numFmt = '"$"#,##0';
            svCell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: SE_GREEN_DARK } };
            svCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
          };
          const nTop = Math.max(topElectric.length, topGas.length);
          for (let i = 0; i < nTop; i++) {
            const rowNum = sumRow++;
            writeTopBlock(rowNum, 1, topElectric[i]);
            writeTopBlock(rowNum, 5, topGas[i]);
            summarySheet.getRow(rowNum).height = 18;
          }
          summarySheet.mergeCells(sumRow, 1, sumRow, SUM_NCOLS);
          const topNote = summarySheet.getCell(sumRow, 1);
          topNote.value = 'Ranked by Base (mid) Year 1 indicative savings. Mirrors the per-state figures on the Indicative Savings tab.';
          topNote.font = { name: 'Nunito Sans', italic: true, size: 9.5, color: { argb: SE_SLATE } };
          topNote.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
          summarySheet.getRow(sumRow++).height = 18;
          summarySheet.getRow(sumRow++).height = 6; // spacer
        }

        // Section 2: Building Compliance Screening — KPI tiles mirroring
        // the on-page Compliance Screening dashboard. Same derivation as
        // the compliance report: sites screened, sites with any eligible
        // mandate, distinct matched jurisdictions, and the summed max
        // yearly penalty across the three mandate types.
        // Same ownership scope the Compliance Screening subtab is showing,
        // so the workbook's KPI tiles reconcile with the page.
        const complianceResults = screenSites(complianceScopedSites, { ordinances });
        const cMatched = complianceResults.filter(r => r.matched);
        const cJurisdictions = new Set(cMatched.map(r => r.govId)).size;
        const cWithMandate = complianceResults.filter(r => CATEGORIES.some(c => r[c]?.eligible === true)).length;
        const cGrandPenalty = CATEGORIES.reduce((sum, c) => sum + totalPenalty(complianceResults, c), 0);
        const cSiteCount = complianceResults.length;

        sumSection(sumRow++, 'Building Compliance Screening');
        const kpis = [
          { v: String(cSiteCount), l: 'Sites Screened', c: SE_GREEN_DARK },
          { v: String(cWithMandate), l: 'Sites With a Mandate', c: 'FF3DCD58' },
          { v: String(cJurisdictions), l: 'Jurisdictions Matched', c: 'FF29ABE2' },
          { v: usdShort(cGrandPenalty), l: 'Est. Max Yearly Exposure', c: 'FFF7941E' },
        ];
        const kpiNumRowNum = sumRow++;
        const kpiLblRowNum = sumRow++;
        const kpiNumRow = summarySheet.getRow(kpiNumRowNum);
        const kpiLblRow = summarySheet.getRow(kpiLblRowNum);
        kpis.forEach((k, i) => {
          const c0 = i * 2 + 1;
          summarySheet.mergeCells(kpiNumRowNum, c0, kpiNumRowNum, c0 + 1);
          summarySheet.mergeCells(kpiLblRowNum, c0, kpiLblRowNum, c0 + 1);
          const num = kpiNumRow.getCell(c0);
          num.value = k.v;
          num.font = { name: 'Nunito Sans', bold: true, size: 22, color: { argb: SE_TEXT_DARK } };
          num.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
          num.border = {
            top: { style: 'medium', color: { argb: k.c } },
            left: { style: 'thin', color: { argb: SE_BORDER } },
            right: { style: 'thin', color: { argb: SE_BORDER } },
          };
          const lbl = kpiLblRow.getCell(c0);
          lbl.value = k.l.toUpperCase();
          lbl.font = { name: 'Nunito Sans', bold: true, size: 9, color: { argb: SE_SLATE } };
          lbl.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
          lbl.border = {
            bottom: { style: 'thin', color: { argb: SE_BORDER } },
            left: { style: 'thin', color: { argb: SE_BORDER } },
            right: { style: 'thin', color: { argb: SE_BORDER } },
          };
        });
        kpiNumRow.height = 30;
        kpiLblRow.height = 16;

        const cmpNoteRowNum = sumRow++;
        summarySheet.mergeCells(cmpNoteRowNum, 1, cmpNoteRowNum, SUM_NCOLS);
        const cmpNote = summarySheet.getCell(cmpNoteRowNum, 1);
        cmpNote.value = "Preliminary BBS / energy-audit / BPS applicability across the portfolio. Est. max yearly exposure sums each eligible site's maximum annual penalty across the three mandate types.";
        cmpNote.font = { name: 'Nunito Sans', italic: true, size: 9.5, color: { argb: SE_SLATE } };
        cmpNote.alignment = { vertical: 'top', horizontal: 'left', indent: 1, wrapText: true };
        summarySheet.getRow(cmpNoteRowNum).height = 30;
        summarySheet.getRow(sumRow++).height = 6; // spacer

        // Section 2b: BPS — Prioritization. One row per (deadline,
        // jurisdiction) over the BPS-eligible sites, matching the compliance
        // exports + on-page table.
        const bpsRows = bpsPrioritization(complianceResults, ordinances);
        if (bpsRows.length) {
          sumSection(sumRow++, 'BPS Prioritization');
          const bpsHdrRowNum = sumRow++;
          const bpsHdrs = [
            { c: 1, t: 'Upcoming Deadline' },
            { c: 2, t: 'Compliance Government' },
            { c: 3, t: 'BPS Fines for Exceeding Limits' },
            { c: 4, t: 'Eligible sites' },
            { c: 5, span: 2, t: 'Sum of Est. Penalty (non-reporting)' },
            { c: 7, span: 2, t: 'Fee for exceeding limits' },
          ];
          bpsHdrs.forEach(h => {
            if (h.span) summarySheet.mergeCells(bpsHdrRowNum, h.c, bpsHdrRowNum, h.c + h.span - 1);
            const cell = summarySheet.getCell(bpsHdrRowNum, h.c);
            cell.value = h.t;
            cell.font = { name: 'Nunito Sans', bold: true, size: 9, color: { argb: SE_SLATE } };
            cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: h.c !== 7 };
            cell.border = { bottom: { style: 'thin', color: { argb: SE_BORDER } } };
          });
          summarySheet.getRow(bpsHdrRowNum).height = 28;
          for (const g of bpsRows) {
            const rowNum = sumRow++;
            const cells = [
              { c: 1, v: g.deadline ? `${Number(g.deadline.split('-')[1])}/${Number(g.deadline.split('-')[2])}/${g.deadline.split('-')[0]}` : '', align: 'left', bold: true, dark: true },
              { c: 2, v: g.government || '', align: 'left', bold: true, dark: true },
              { c: 3, v: g.fine, align: 'left' },
              { c: 4, v: g.sites, align: 'left', dark: true },
            ];
            cells.forEach(cd => {
              const cell = summarySheet.getCell(rowNum, cd.c);
              cell.value = cd.v;
              cell.font = { name: 'Nunito Sans', size: 10, bold: !!cd.bold, color: { argb: cd.dark ? SE_TEXT_DARK : SE_SLATE } };
              cell.alignment = { vertical: 'middle', horizontal: cd.align, indent: 1 };
            });
            summarySheet.mergeCells(rowNum, 5, rowNum, 6);
            const penCell = summarySheet.getCell(rowNum, 5);
            penCell.value = g.penaltyKnown ? g.penalty : '';
            if (g.penaltyKnown) penCell.numFmt = '"$"#,##0';
            penCell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: SE_TEXT_DARK } };
            penCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
            summarySheet.mergeCells(rowNum, 7, rowNum, 8);
            const feeCell = summarySheet.getCell(rowNum, 7);
            feeCell.value = g.feeExceeding;
            feeCell.font = { name: 'Nunito Sans', italic: true, size: 9, color: { argb: SE_SLATE } };
            feeCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: false };
            summarySheet.getRow(rowNum).height = 18;
          }
          summarySheet.getRow(sumRow++).height = 6; // spacer
        }

        // The company-level rollup, built once and read by the two sections
        // below — the screening verdicts and the sustainability commitments
        // are two views of the same companies, and rebuilding it per section
        // is how they would drift apart.
        const ccCompanies = corporateComplianceSummary();

        // Section 3: Corporate Compliance Screening — the company-level
        // disclosure view from the Corporate Compliance tab. Mirrors that
        // page's derivation: companies grouped by canonical key, the six
        // jurisdiction gating answers, and the regulations those answers
        // plus the researched revenue trigger.
        {
          if (ccCompanies.length) {
            const anyYes = ccCompanies.filter(c => c.yesJurisdictions.length).length;
            const regCount = new Set(
              ccCompanies.flatMap(c => c.regulations.map(r => r.regulation))
            ).size;
            const ccCA = ccCompanies.reduce((s, c) => s + c.california, 0);

            sumSection(sumRow++, 'Corporate Compliance Screening');
            const ccKpis = [
              { v: String(ccCompanies.length), l: 'Companies Screened', c: SE_GREEN_DARK },
              { v: String(anyYes), l: 'With a Jurisdiction Hit', c: 'FF3DCD58' },
              { v: String(regCount), l: 'Reporting Regimes Triggered', c: 'FF29ABE2' },
              { v: String(ccCA), l: 'California Sites', c: 'FFF7941E' },
            ];
            const ccNumRowNum = sumRow++;
            const ccLblRowNum = sumRow++;
            const ccNumRow = summarySheet.getRow(ccNumRowNum);
            const ccLblRow = summarySheet.getRow(ccLblRowNum);
            ccKpis.forEach((k, i) => {
              const c0 = i * 2 + 1;
              summarySheet.mergeCells(ccNumRowNum, c0, ccNumRowNum, c0 + 1);
              summarySheet.mergeCells(ccLblRowNum, c0, ccLblRowNum, c0 + 1);
              const num = ccNumRow.getCell(c0);
              num.value = k.v;
              num.font = { name: 'Nunito Sans', bold: true, size: 22, color: { argb: SE_TEXT_DARK } };
              num.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
              num.border = {
                top: { style: 'medium', color: { argb: k.c } },
                left: { style: 'thin', color: { argb: SE_BORDER } },
                right: { style: 'thin', color: { argb: SE_BORDER } },
              };
              const lbl = ccLblRow.getCell(c0);
              lbl.value = k.l.toUpperCase();
              lbl.font = { name: 'Nunito Sans', bold: true, size: 9, color: { argb: SE_SLATE } };
              lbl.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
              lbl.border = {
                bottom: { style: 'thin', color: { argb: SE_BORDER } },
                left: { style: 'thin', color: { argb: SE_BORDER } },
                right: { style: 'thin', color: { argb: SE_BORDER } },
              };
            });
            ccNumRow.height = 30;
            ccLblRow.height = 16;
            summarySheet.getRow(sumRow++).height = 6; // spacer

            // Per-company table: revenue + which jurisdictions screened Yes
            // and which regulations that triggers.
            const ccHdrRowNum = sumRow++;
            const ccHdrs = [
              { c: 1, t: 'Company' },
              { c: 2, t: 'Revenue' },
              { c: 3, t: 'CA Sites' },
              { c: 4, span: 2, t: 'Jurisdictions = Yes' },
              { c: 6, span: 3, t: 'Reporting Regimes That Apply' },
            ];
            ccHdrs.forEach(h => {
              if (h.span) summarySheet.mergeCells(ccHdrRowNum, h.c, ccHdrRowNum, h.c + h.span - 1);
              const cell = summarySheet.getCell(ccHdrRowNum, h.c);
              cell.value = h.t;
              cell.font = { name: 'Nunito Sans', bold: true, size: 9, color: { argb: SE_SLATE } };
              cell.alignment = { vertical: 'middle', horizontal: h.c === 3 ? 'center' : 'left', indent: h.c === 3 ? 0 : 1, wrapText: true };
              cell.border = { bottom: { style: 'thin', color: { argb: SE_BORDER } } };
            });
            summarySheet.getRow(ccHdrRowNum).height = 20;

            // Columns 4-5 and 6-8 are width 15 each; the indent costs ~2.
            const JURIS_CHARS = 15 * 2 - 2;
            const REGIME_CHARS = 15 * 3 - 2;

            for (const c of ccCompanies) {
              const rowNum = sumRow++;
              summarySheet.mergeCells(rowNum, 4, rowNum, 5);
              summarySheet.mergeCells(rowNum, 6, rowNum, 8);
              const nameCell = summarySheet.getCell(rowNum, 1);
              nameCell.value = c.name;
              nameCell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: SE_TEXT_DARK } };
              nameCell.alignment = { vertical: 'top', horizontal: 'left', indent: 1 };

              const revCell = summarySheet.getCell(rowNum, 2);
              revCell.value = c.revenueLabel || '-';
              revCell.font = { name: 'Nunito Sans', size: 10, color: { argb: c.revenueLabel ? SE_TEXT_DARK : SE_SLATE } };
              revCell.alignment = { vertical: 'top', horizontal: 'left', indent: 1 };

              const caCell = summarySheet.getCell(rowNum, 3);
              caCell.value = c.california;
              caCell.numFmt = '#,##0';
              caCell.font = { name: 'Nunito Sans', size: 10, color: { argb: c.california > 0 ? SE_GREEN_DARK : SE_SLATE } };
              caCell.alignment = { vertical: 'top', horizontal: 'center' };

              const jCell = summarySheet.getCell(rowNum, 4);
              jCell.value = c.yesJurisdictions.join(', ') || '-';
              jCell.font = { name: 'Nunito Sans', size: 10, color: { argb: c.yesJurisdictions.length ? SE_TEXT_DARK : SE_SLATE } };
              jCell.alignment = { vertical: 'top', horizontal: 'left', indent: 1, wrapText: true };

              const rCell = summarySheet.getCell(rowNum, 6);
              // One regime per line rather than a semicolon run — the old
              // "SB 253 (2026 data (reporting starts 2027)); …" also nested
              // parens inside parens, which read badly even unclipped.
              const regimeText = c.regulations.length
                ? c.regulations.map(r => `${r.regulation} · ${r.timeline}`).join('\n')
                : 'None triggered';
              rCell.value = regimeText;
              rCell.font = {
                name: 'Nunito Sans', size: 10,
                bold: c.regulations.length > 0,
                color: { argb: c.regulations.length ? SE_GREEN_DARK : SE_SLATE },
              };
              rCell.alignment = { vertical: 'top', horizontal: 'left', indent: 1, wrapText: true };

              const lines = Math.max(
                wrapLines(regimeText, REGIME_CHARS),
                wrapLines(jCell.value, JURIS_CHARS),
                1,
              );
              summarySheet.getRow(rowNum).height = Math.max(18, lines * 14 + 4);
            }

            const ccNoteRowNum = sumRow++;
            summarySheet.mergeCells(ccNoteRowNum, 1, ccNoteRowNum, SUM_NCOLS);
            const ccNote = summarySheet.getCell(ccNoteRowNum, 1);
            ccNote.value = 'Company-level disclosure screening from the Corporate Compliance tab. A regime is listed when its jurisdiction screened Yes and the researched annual revenue meets that regime’s threshold; blank jurisdictions mean nobody has screened them yet.';
            ccNote.font = { name: 'Nunito Sans', italic: true, size: 9.5, color: { argb: SE_SLATE } };
            ccNote.alignment = { vertical: 'top', horizontal: 'left', indent: 1, wrapText: true };
            summarySheet.getRow(ccNoteRowNum).height = 30;
            summarySheet.getRow(sumRow++).height = 6; // spacer
          }
        }

        // Section 4: Sustainability Targets — the last thing on the sheet,
        // and deliberately so. Everything above it is what the portfolio is
        // obliged to do; this is what the company has said it will do. A
        // reader who has just seen which regimes bite wants the commitments
        // next, and the published reports those commitments live in are the
        // documents any of it gets checked against.
        //
        // Companies with nothing recorded are skipped rather than listed
        // empty: a page of "no targets" rows says nothing and buries the
        // ones that do.
        {
          const withTargets = ccCompanies.filter(c => c.sustainability?.hasAny);
          if (withTargets.length) {
            sumSection(sumRow++, 'Sustainability Targets');

            for (const c of withTargets) {
              const prof = c.sustainability;

              // Company banner, with the frameworks it reports under.
              const bannerNum = sumRow++;
              summarySheet.mergeCells(bannerNum, 1, bannerNum, SUM_NCOLS);
              const banner = summarySheet.getCell(bannerNum, 1);
              // Confirmed frameworks, then any the narrative claims without
              // a published report behind them — marked, because a reader
              // scanning this banner must not read the two as the same
              // kind of fact.
              const frameworkBits = [
                ...prof.frameworks,
                ...prof.claimedFrameworks.map(f => `${f} (claimed, unverified)`),
              ];
              banner.value = frameworkBits.length
                ? `${c.name}    ${frameworkBits.join(' · ')}`
                : c.name;
              banner.font = { name: 'Nunito Sans', bold: true, size: 10.5, color: { argb: SE_TEXT_DARK } };
              banner.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
              banner.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
              summarySheet.getRow(bannerNum).height = 18;

              const detailRow = (label, text, opts = {}) => {
                if (!text) return;
                const rowNum = sumRow++;
                summarySheet.mergeCells(rowNum, 1, rowNum, 2);
                summarySheet.mergeCells(rowNum, 3, rowNum, SUM_NCOLS);
                const lbl = summarySheet.getCell(rowNum, 1);
                lbl.value = label;
                lbl.font = { name: 'Nunito Sans', bold: true, size: 9, color: { argb: SE_SLATE } };
                lbl.alignment = { vertical: 'top', horizontal: 'left', indent: 1 };
                const val = summarySheet.getCell(rowNum, 3);
                val.value = text;
                val.font = { name: 'Nunito Sans', size: 9.5, color: { argb: opts.muted ? SE_SLATE : SE_TEXT_DARK } };
                val.alignment = { vertical: 'top', horizontal: 'left', indent: 1, wrapText: true };
                // Columns 3..N at width 15 each, less the indent.
                const chars = (SUM_NCOLS - 2) * 15 - 2;
                summarySheet.getRow(rowNum).height = Math.max(15, wrapLines(text, chars) * 12 + 3);
              };

              detailRow(
                prof.targetsSource === 'research' ? 'Targets *' : 'Targets',
                prof.targets.map(t => `• ${t}`).join('\n'),
              );
              detailRow('Programs', prof.programs.map(t => `• ${t}`).join('\n'));
              detailRow('Summary', prof.summary, { muted: true });
              detailRow(
                'Reports',
                prof.reports.map(r => `${r.title}${r.year ? ` (${r.year})` : ''} — ${r.url}`).join('\n'),
              );
            }

            const stNoteNum = sumRow++;
            summarySheet.mergeCells(stNoteNum, 1, stNoteNum, SUM_NCOLS);
            const stNote = summarySheet.getCell(stNoteNum, 1);
            stNote.value = 'Sustainability commitments and disclosures per company, from the company page\u2019s Sustainability Targets field and its saved Claude research. Targets marked * came from research and have not been confirmed on the company page. A framework marked \u201Cclaimed, unverified\u201D is one the research narrative names without finding a published report under it \u2014 check the reports listed before relying on it.';
            stNote.font = { name: 'Nunito Sans', italic: true, size: 9.5, color: { argb: SE_SLATE } };
            stNote.alignment = { vertical: 'top', horizontal: 'left', indent: 1, wrapText: true };
            summarySheet.getRow(stNoteNum).height = 30;
            summarySheet.getRow(sumRow++).height = 6; // spacer
          }
        }
      }
    }

    // ---- Second sheet: Site Detail ---------------------------------
    // Flat per-site listing so the user can see the underlying data
    // that rolled up into the by-state summary above.
    const detailSheet = wb.addWorksheet('Site Detail', {
      properties: { tabColor: { argb: SE_GREEN } },
      views: [{ showGridLines: false, state: 'frozen', ySplit: 1 }],
    });
    const detailCols = [
      { label: 'Site Name', get: (s) => s.siteName, width: 28 },
      // City sits with the other address fields, ahead of ST / Prov, so the
      // sheet reads City / State / Country / Zip. Same value the compliance
      // subtabs read (mapped column first, then the utility-rates lookup),
      // so a site names the same city on every tab of the workbook.
      { label: 'City', get: (s) => s.city, width: 18 },
      { label: 'ST / Prov', get: (s) => s.state, width: 14 },
      { label: 'Country', get: (s) => s.country, width: 18 },
      { label: 'Zip', get: (s) => s.zip, width: 9 },
      { label: 'Property Type', get: (s) => s.propertyType, width: 22 },
      // Owned vs Leased. Sits with the other building attributes rather
      // than with the energy columns: it describes the site, and it is
      // what decides whether a building-performance mandate binds this
      // company or its landlord — the same question the compliance
      // subtabs' Owned / All-sites toggle asks.
      { label: 'Owned / Leased', get: (s) => s.ownership, width: 15 },
      { label: 'Size (ft²)', get: (s) => s.sqft, numFmt: '#,##0', width: 12 },
      { label: 'Electric Utility', get: (s) => s.electricUtility, width: 22 },
      { label: 'ISO / RTO', get: (s) => s.iso, width: 11 },
      { label: 'Electric Supplier', get: (s) => s.electricSupplier, width: 22 },
      { label: 'Electric Market', get: (s) => s.electricMarket, width: 18 },
      { label: 'Reg. Rate Savings Opportunity', get: (s) => s.regRateOpportunity, width: 28 },
      { label: 'Annual Electric (kWh)', get: (s) => s.kwh, numFmt: '#,##0', width: 18, estimated: (s) => s.kwhEstimated },
      // Indicative market rate, the blended rate the site's own uploaded
      // spend actually implies, and the gap between them. The indicative
      // rate is a state / country average; a site paying materially off
      // it is either on an out-of-market contract or carrying delivery
      // charges the average doesn't reflect — both worth seeing per site
      // rather than only in the portfolio roll-up.
      { label: 'Est. Electric Rate ($/kWh)', get: (s) => s.electricRate, numFmt: '"$"0.0000', width: 17, estimated: () => true },
      { label: 'Actual Electric Rate ($/kWh)', get: (s) => s.actualElectricRate, numFmt: '"$"0.0000', width: 18 },
      { label: 'Electric Rate vs Est.', get: (s) => s.electricRateVar, numFmt: '+0%;-0%;0%', width: 16, varianceColor: true },
      { label: 'Total Electric Cost', get: (s) => s.electricCost, numFmt: '"$"#,##0', width: 16, estimated: (s) => s.electricCostEstimated },
      { label: 'Electric Contract Start', get: (s) => s.electricStart, width: 18, numFmt: 'm/d/yyyy', dateColumn: true },
      { label: 'Electric Contract End', get: (s) => s.electricEnd, width: 18, numFmt: 'm/d/yyyy', dateColumn: true },
      { label: 'Gas Utility', get: (s) => s.gasUtility, width: 22 },
      { label: 'Gas Supplier', get: (s) => s.gasSupplier, width: 22 },
      { label: 'Gas Market', get: (s) => s.gasMarket, width: 18 },
      { label: 'Annual Gas (Dth)', get: (s) => s.dth, numFmt: '#,##0', width: 16, estimated: (s) => s.thermsEstimated },
      { label: 'Est. Gas Rate ($/Dth)', get: (s) => s.gasRate, numFmt: '"$"0.00', width: 15, estimated: () => true },
      { label: 'Actual Gas Rate ($/Dth)', get: (s) => s.actualGasRate, numFmt: '"$"0.00', width: 16 },
      { label: 'Gas Rate vs Est.', get: (s) => s.gasRateVar, numFmt: '+0%;-0%;0%', width: 14, varianceColor: true },
      { label: 'Total Natural Gas Cost', get: (s) => s.gasCost, numFmt: '"$"#,##0', width: 18, estimated: (s) => s.gasCostEstimated },
      { label: 'Gas Contract Start', get: (s) => s.gasStart, width: 18, numFmt: 'm/d/yyyy', dateColumn: true },
      { label: 'Gas Contract End', get: (s) => s.gasEnd, width: 18, numFmt: 'm/d/yyyy', dateColumn: true },
      // ---- Energy intensity: the site against its property type ------
      // Three pairs (electric / gas / total), each the site's own
      // consumption per square foot next to the per-square-foot estimate
      // its property type carries, then how far apart the two are.
      //
      // Intensity is what makes a 40,000 ft² lab and a 400,000 ft²
      // campus comparable, and it is the one column where a bad
      // consumption figure or a wrong property type shows up as an
      // obviously wrong number rather than hiding inside a plausible
      // annual total.
      //
      // The variance cells carry a colour ramp — within 10% reads as
      // normal text, 10–25% amber, 25%+ red — so a scan down the column
      // lands on the outliers without the reader doing the arithmetic.
      // On a site whose consumption was itself modelled from the
      // property type the variance is 0% by construction; the estimate
      // dagger on the measured columns is what tells the two apart.
      { label: 'Electric Intensity (kWh/ft²)', get: (s) => s.electricIntensity, numFmt: '#,##0.0', width: 18, estimated: (s) => s.kwhEstimated },
      { label: 'Est. Electric Intensity (kWh/ft²)', get: (s) => s.estElectricIntensity, numFmt: '#,##0.0', width: 20, estimated: () => true },
      { label: 'Electric vs Est.', get: (s) => s.electricIntensityVar, numFmt: '+0%;-0%;0%', width: 14, varianceColor: true },
      { label: 'Gas Intensity (Dth/ft²)', get: (s) => s.gasIntensity, numFmt: '#,##0.000', width: 16, estimated: (s) => s.thermsEstimated },
      { label: 'Est. Gas Intensity (Dth/ft²)', get: (s) => s.estGasIntensity, numFmt: '#,##0.000', width: 18, estimated: () => true },
      { label: 'Gas vs Est.', get: (s) => s.gasIntensityVar, numFmt: '+0%;-0%;0%', width: 14, varianceColor: true },
      { label: 'Total Intensity (kWh/ft²)', get: (s) => s.totalIntensity, numFmt: '#,##0.0', width: 18, estimated: (s) => s.kwhEstimated || s.thermsEstimated },
      { label: 'Est. Total Intensity (kWh/ft²)', get: (s) => s.estTotalIntensity, numFmt: '#,##0.0', width: 20, estimated: () => true },
      { label: 'Total vs Est.', get: (s) => s.totalIntensityVar, numFmt: '+0%;-0%;0%', width: 14, varianceColor: true },
      // Per-site Mexico-sourcing flag (any Mexican site with > 1 MWh
      // of electric consumption). Other site-level flags can plug in
      // here later without growing the column.
      { label: 'Flags', get: (s) => s.flags, width: 36 },
    ];
    detailSheet.columns = detailCols.map(c => ({ width: c.width }));

    // Header row. Borders on bottom + right so the column separators
    // continue down through the data rows.
    const detailHeader = detailSheet.getRow(1);
    detailCols.forEach((c, i) => {
      const cell = detailHeader.getCell(i + 1);
      // Mark columns that can carry estimated / indicative data with a
      // dagger; the legend below the table explains it.
      cell.value = c.estimated ? `${c.label} †` : c.label;
      cell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
      cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 };
      cell.border = {
        bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } },
        right:  { style: 'hair', color: { argb: 'FFFFFFFF' } },
      };
    });
    detailHeader.height = 32;

    // Build the per-site rows from the same `rows` collection that
    // feeds the Utility Lookup table on screen. Apply the same
    // TBD-when-no-date rule used in the by-state aggregation so the
    // two sheets read the same way.
    const sitesForDetail = rows
      .map(r => {
        const electricUtility = r.__electric__ || '';
        const gasUtility = r.__gas__ || '';
        // Show the resolved competitive supplier when there is one,
        // but blank the cell when it would just duplicate the utility
        // value (regulated markets where the file's supplier column
        // mirrors the utility) — the user doesn't want the same name
        // sitting in both columns. No fallback to utility when no
        // supplier was mapped at all.
        const sameAsUtility = (sup, util) => {
          if (!sup || !util) return false;
          return String(sup).trim().toLowerCase() === String(util).trim().toLowerCase();
        };
        const electricSupplierRaw = r.__electricSupplier__ || '';
        const gasSupplierRaw = r.__gasSupplier__ || '';
        const electricSupplier = sameAsUtility(electricSupplierRaw, electricUtility) ? '' : electricSupplierRaw;
        const gasSupplier = sameAsUtility(gasSupplierRaw, gasUtility) ? '' : gasSupplierRaw;
        const therms = r.__therms__;
        const dth = (typeof therms === 'number' && Number.isFinite(therms)) ? Math.round(therms / 10) : null;
        const tbdIfMissing = (date, supplierPresent) => {
          // Preserve Date / numeric types so downstream dateColumn
          // cells can format them as short dates. Strings are still
          // trimmed; only when the value is fully empty do we fall
          // through to 'TBD' / ''.
          if (date instanceof Date && Number.isFinite(date.getTime())) return date;
          if (typeof date === 'number' && Number.isFinite(date)) return date;
          const trimmed = String(date || '').trim();
          if (trimmed) return trimmed;
          return supplierPresent ? 'TBD' : '';
        };
        const stateCode = effectiveStateCode(r);
        const rawCountry = String(r.__country__ || '').trim();
        // ST / Prov column: US/CA sites show the 2-letter code, every
        // other country shows the full subdivision name from the upload
        // (falling back to the country label when no state was given).
        // Computed once at row build time so this sheet and the Contract
        // Overview tab stay in sync. See __stateProvinceDisplay__.
        const stateProvince = r.__stateProvinceDisplay__ || '';
        // US/CA reg-rate motion is per-utility curated; country sites
        // pick up the reg-rate flag from the Power Rate Optimization
        // column on the country reference instead.
        const isRegRateOpportunity = stateCode
          ? (!!electricUtility && isRegulatedRateOpportunity(stateCode, electricUtility))
          : countryHasRegulatedRateOpportunity(rawCountry);
        const country = rawCountry;
        // Per-commodity Regulated / Deregulated status, from the shared
        // classifyMarket — so summing the Deregulated rows of this sheet
        // reproduces the by-state sheet's Deregulated Sites total and the
        // page's Market card. It used to read the utility name first,
        // which labelled a site in a regulated state Deregulated whenever
        // the name didn't match a municipal / coop pattern.
        const isUSSite = /^(united states|usa|us)$/i.test(rawCountry);
        const isCASite = /^(canada|ca)$/i.test(rawCountry);
        const electricMarket = classifyMarket(r, 'electric') || '';
        const gasMarket = classifyMarket(r, 'gas') || '';
        // ISO / RTO market for the site, resolved the same fine way as the
        // ISO tab — electric utility first, then ZIP, then state / province.
        // Only US/CA sites carry a market; everything else (and NA sites
        // outside an IRC-mapped footprint) stays blank.
        const iso = (isUSSite || isCASite)
          ? (ISO_LABEL[resolveSiteIso({
              admin: isCASite ? 'CA' : 'US',
              code: stateCode,
              zip: r.__zipNorm__,
              utility: electricUtility,
            })] || '')
          : '';
        const kwh = typeof r.__kwh__ === 'number' ? Math.round(r.__kwh__) : null;
        // Mexico flag: Baja sites are off CFE's grid so they don't
        // get tagged at all. Other Mexican sites get either the
        // sourcing-opportunity flag (CFE + > 6 GWh/yr) or the
        // too-low-consumption flag (< 6 GWh/yr). Pass the raw state
        // string here (not the US/CA-only stateCode) so the Baja
        // exclusion still sees a "Baja California" tag on Mexican rows.
        const mxFlag = mexicoSiteFlag(country, r.__stateRaw__ || r.__state__ || '', electricUtility, kwh);
        // Property-type mapping flag: when the upload carried a raw
        // property-type value but normalizePropertyType couldn't
        // resolve it to a canonical entry, the per-property-type
        // consumption / account estimates can't run for this site.
        // Surface the unrecognized string so the user knows which
        // rows need an alias added in propertyTypeEstimates.js
        // (or a corrected source value).
        const propertyTypeFlag = (r.__propertyTypeRaw__ && !r.__propertyType__)
          ? `⚠ Property type "${r.__propertyTypeRaw__}" not recognized: estimates will not run for this site. Add an alias in propertyTypeEstimates.js or correct the source value.`
          : '';
        const allFlags = [mxFlag, propertyTypeFlag].filter(Boolean).join('\n');
        // ---- Energy intensity vs the property-type estimate ----------
        // Measured intensity needs a real square footage; without one
        // there is nothing to divide by, so every intensity cell on the
        // row stays empty rather than reporting a per-site total dressed
        // up as a rate. The estimate side still fills in — it is a
        // property of the type, not of this building — so the reader can
        // see what the site would have been benchmarked against once a
        // size is supplied.
        const sizeForIntensity = (typeof r.__propertySizeFt2__ === 'number'
          && Number.isFinite(r.__propertySizeFt2__) && r.__propertySizeFt2__ > 0)
          ? r.__propertySizeFt2__
          : null;
        const perFt2 = (v) => (sizeForIntensity != null && typeof v === 'number' && Number.isFinite(v))
          ? v / sizeForIntensity
          : null;
        // Unrounded Dth (the displayed column rounds to whole Dth, which
        // at three decimals of Dth/ft² would visibly move the number).
        const dthExact = (typeof therms === 'number' && Number.isFinite(therms)) ? therms / 10 : null;
        // Site total in kWh-equivalent, the same basis as the reference
        // table's Total column. A commodity with no figure contributes
        // nothing — an electric-only site therefore reads below its
        // type's total estimate, which is the honest answer when the
        // gas side is unknown; the per-commodity pairs beside it show
        // which half is missing.
        const totalKwhSite = (kwh != null || dthExact != null)
          ? (kwh || 0) + (dthExact || 0) * KWH_PER_DTH
          : null;
        const benchmark = propertyTypeIntensity(r.__propertyType__);
        // ---- Actual vs indicative rate -------------------------------
        // The blended rate the site's own numbers imply: uploaded annual
        // spend ÷ uploaded annual consumption. Only a spend the file
        // supplied counts — where the cost was itself derived as
        // consumption × the indicative rate, dividing it back out returns
        // that same rate and the delta would read 0% on a site with no
        // cost data at all. Those cells stay empty instead.
        const electricRateEst = (typeof r.__electricRate__ === 'number' && Number.isFinite(r.__electricRate__))
          ? r.__electricRate__
          : null;
        // __gasRate__ is $/therm; ×10 → $/Dth, matching the Dth columns.
        const gasRateEst = (typeof r.__gasRate__ === 'number' && Number.isFinite(r.__gasRate__))
          ? r.__gasRate__ * 10
          : null;
        const impliedRate = (cost, volume) =>
          (typeof cost === 'number' && Number.isFinite(cost)
            && typeof volume === 'number' && Number.isFinite(volume) && volume > 0)
            ? cost / volume
            : null;
        const actualElectricRate = impliedRate(r.__electricCostActual__, kwh);
        const actualGasRate = impliedRate(r.__gasCostActual__, dthExact);
        const electricIntensity = perFt2(kwh);
        const gasIntensity = perFt2(dthExact);
        const totalIntensity = perFt2(totalKwhSite);
        return {
          siteName: siteNameColumn ? String(r[siteNameColumn] || '').trim() : '',
          // Mapped City column when the upload has one, else the city the
          // utility-rates lookup resolved from the ZIP — the same
          // expression complianceSites uses.
          city: String(r.__city__ || (cityOverride ? r[cityOverride] : '') || '').trim(),
          state: stateProvince,
          zip: r.__zipNorm__ || '',
          country,
          // Prefer the canonical property type so the value here lines
          // up with what the Property Type Estimates sheet keys on; if
          // the upload's raw value wasn't recognized, surface it as-is
          // (the Flags column already calls out the unrecognized case).
          propertyType: r.__propertyType__ || r.__propertyTypeRaw__ || '',
          // Canonical Owned / Leased where the upload's value could be
          // placed. Where it couldn't, the raw string travels as-is
          // rather than the cell going blank: "Owned/Leased" or "TBD" is
          // a real answer about that site, and dropping it would read as
          // "not provided" when it was.
          ownership: r.__ownership__ || r.__ownershipRaw__ || '',
          // Mapped property size (sq ft) when the user provided one.
          sqft: (typeof r.__propertySizeFt2__ === 'number' && Number.isFinite(r.__propertySizeFt2__)) ? Math.round(r.__propertySizeFt2__) : null,
          electricUtility,
          iso,
          electricSupplier,
          electricMarket,
          regRateOpportunity: isRegRateOpportunity ? 'Yes' : '',
          kwh,
          // Indicative $/kWh used to derive the estimated cost. Always an
          // indicative (state / country) rate, never a billed tariff.
          electricRate: electricRateEst,
          electricCost: typeof r.__electricCost__ === 'number' ? Math.round(r.__electricCost__) : null,
          electricStart: tbdIfMissing(r.__electricStart__, !!electricSupplier),
          electricEnd: tbdIfMissing(r.__electricEnd__, !!electricSupplier),
          gasUtility,
          gasSupplier,
          gasMarket,
          dth,
          gasRate: gasRateEst,
          gasCost: typeof r.__gasCost__ === 'number' ? Math.round(r.__gasCost__) : null,
          gasStart: tbdIfMissing(r.__gasStart__, !!gasSupplier),
          gasEnd: tbdIfMissing(r.__gasEnd__, !!gasSupplier),
          flags: allFlags,
          // Estimate flags drive the italic-amber "estimated data" call-out
          // on the matching columns. Consumption is modeled from the
          // property type; cost is estimated when no actual $ was provided.
          kwhEstimated: !!r.__kwhFromEstimate__,
          thermsEstimated: !!r.__thermsFromEstimate__,
          electricCostEstimated: r.__electricCostActual__ == null && typeof r.__electricCost__ === 'number',
          gasCostEstimated: r.__gasCostActual__ == null && typeof r.__gasCost__ === 'number',
          electricIntensity,
          gasIntensity,
          totalIntensity,
          estElectricIntensity: benchmark?.electricKwhPerFt2 ?? null,
          estGasIntensity: benchmark?.gasDthPerFt2 ?? null,
          estTotalIntensity: benchmark?.totalKwhPerFt2 ?? null,
          actualElectricRate,
          actualGasRate,
          electricRateVar: varianceVsEstimate(actualElectricRate, electricRateEst),
          gasRateVar: varianceVsEstimate(actualGasRate, gasRateEst),
          electricIntensityVar: varianceVsEstimate(electricIntensity, benchmark?.electricKwhPerFt2),
          gasIntensityVar: varianceVsEstimate(gasIntensity, benchmark?.gasDthPerFt2),
          totalIntensityVar: varianceVsEstimate(totalIntensity, benchmark?.totalKwhPerFt2),
        };
      })
      .filter(s => s.siteName)
      .sort((a, b) => (a.state || '').localeCompare(b.state || '') || a.siteName.localeCompare(b.siteName));

    // ---- Savings Summary: estimated-data share lines ----------------
    // Written into the rows reserved in the Savings Summary band, but
    // computed here — the per-site estimate flags only exist on the
    // Site Detail rows built above. A "data point" is one site's value
    // for one commodity (electric usage, gas usage, electric cost, gas
    // cost); sites with no value for a commodity don't count against it.
    {
      const tally = () => ({ est: 0, tot: 0, elecEst: 0, elecTot: 0, gasEst: 0, gasTot: 0 });
      const usage = tally();
      const cost = tally();
      const bump = (c, side, isEst) => {
        c.tot += 1;
        c[`${side}Tot`] += 1;
        if (isEst) { c.est += 1; c[`${side}Est`] += 1; }
      };
      for (const s of sitesForDetail) {
        if (s.kwh != null) bump(usage, 'elec', s.kwhEstimated);
        if (s.dth != null) bump(usage, 'gas', s.thermsEstimated);
        if (s.electricCost != null) bump(cost, 'elec', s.electricCostEstimated);
        if (s.gasCost != null) bump(cost, 'gas', s.gasCostEstimated);
      }
      const writeQualityLine = (rowNum, label, c, noteTail) => {
        ws.mergeCells(rowNum, 1, rowNum, 9);
        const qLabel = ws.getCell(rowNum, 1);
        qLabel.value = label;
        qLabel.font = { name: 'Nunito Sans', bold: true, size: 12, color: { argb: SE_TEXT_DARK } };
        qLabel.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

        const qValue = ws.getCell(rowNum, 10);
        qValue.value = c.tot > 0 ? c.est / c.tot : 0;
        qValue.numFmt = '0%';
        qValue.font = { name: 'Nunito Sans', bold: true, size: 14, color: { argb: SE_EST } };
        qValue.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

        ws.mergeCells(rowNum, 11, rowNum, SPAN);
        const qNote = ws.getCell(rowNum, 11);
        qNote.value = c.tot > 0
          ? `Electric: ${c.elecEst} of ${c.elecTot} sites · Gas: ${c.gasEst} of ${c.gasTot} sites: ${noteTail}`
          : 'No data points available.';
        qNote.font = { name: 'Nunito Sans', italic: true, size: 10, color: { argb: SE_SLATE } };
        qNote.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
        ws.getRow(rowNum).height = 24;
      };
      writeQualityLine(
        summaryBandUsageQualityRow,
        'Estimated Usage Data (% of usage data points)',
        usage,
        'usage modeled from property type when none was uploaded.'
      );
      writeQualityLine(
        summaryBandCostQualityRow,
        'Estimated Cost Data (% of cost data points)',
        cost,
        'cost derived from indicative rates when no actual spend was uploaded.'
      );
    }

    sitesForDetail.forEach((s, idx) => {
      const dataRow = detailSheet.getRow(2 + idx);
      detailCols.forEach((c, i) => {
        const cell = dataRow.getCell(i + 1);
        const v = c.get(s);
        // Excel overflows long text from one cell into the next when
        // the next cell is empty. Every blank cell gets a single
        // space so long text in the cell to the LEFT can't overflow
        // into it. writeBlank also sets ignoredErrors on numeric-
        // formatted cells so Excel doesn't flag the space with the
        // green "number stored as text" triangle.
        if (v === '' || v == null) {
          writeBlank(cell, !!c.numFmt);
        } else if (c.dateColumn) {
          cell.value = toExcelDate(v);
        } else {
          cell.value = ceilForFmt(v, c.numFmt);
        }
        // Estimated / indicative values render italic + amber so the
        // user can see at a glance which numbers are modeled rather than
        // taken from the uploaded file. Skip the styling on blank cells.
        const isEst = !!c.estimated && c.estimated(s) && v !== '' && v != null;
        // Intensity variance gets a severity ramp instead of the
        // estimate styling: within 10% of the property-type estimate is
        // unremarkable, 10–25% is worth a look, and 25%+ means either
        // the consumption or the property type on that row is wrong —
        // exactly the rows this column exists to surface.
        const varianceColor = (c.varianceColor && typeof v === 'number' && Number.isFinite(v))
          ? (Math.abs(v) >= 0.25 ? SE_VAR_OFF : (Math.abs(v) >= 0.10 ? SE_EST : null))
          : null;
        cell.font = isEst
          ? { name: 'Nunito Sans', size: 10, italic: true, color: { argb: SE_EST } }
          : { name: 'Nunito Sans', size: 10, bold: !!varianceColor, color: { argb: varianceColor || SE_TEXT_DARK } };
        // Flags can carry multiple newline-separated lines; wrap so
        // the user sees both the Mexico flag and the property-type
        // warning when they fire on the same row. Other columns stay
        // single-line to keep the table compact.
        const isFlagsCol = c.label === 'Flags';
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: isFlagsCol };
        if (c.numFmt) cell.numFmt = c.numFmt;
        // Hair border on bottom (row separator) AND right (column
        // separator) so the table reads with light visible gridlines
        // even though the worksheet has showGridLines:false.
        cell.border = {
          bottom: { style: 'hair', color: { argb: SE_BORDER } },
          right:  { style: 'hair', color: { argb: SE_BORDER } },
        };
      });
      // Bump the row when Flags wraps to multiple lines so both
      // messages are visible without the user having to drag the row
      // open. 16 px per extra line is enough at the cell's 10 pt font.
      const flagLines = String(s.flags || '').split('\n').filter(Boolean).length;
      dataRow.height = flagLines > 1 ? 18 + (flagLines - 1) * 16 : 18;
    });
    if (sitesForDetail.length > 0) {
      detailSheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1 + sitesForDetail.length, column: detailCols.length },
      };
    }
    // Legend for the estimated-data call-out: one row below the table,
    // spanning the width so it reads as a footnote rather than data.
    {
      const legendRowIdx = 2 + sitesForDetail.length + 1;
      const legendRow = detailSheet.getRow(legendRowIdx);
      const legendCell = legendRow.getCell(1);
      legendCell.value = '† Columns that can contain estimated data. Italic amber values are estimated: annual consumption is modeled from the property type, costs are derived from indicative rates when no actual cost was provided, and the Est. rate columns are indicative ($/kWh and $/Dth), not billed tariffs. Upright black values come from the uploaded file.\n\nRates: Est. is the indicative market rate for the site’s state / country. Actual is the blended rate the uploaded numbers imply — annual spend ÷ annual consumption — and is shown only where the file supplied a real spend, since a cost this tool derived from the indicative rate would divide back out to that same rate. vs Est. is the signed gap: +20% means the site pays 20% more per unit than the market indication. Note the two are not like for like where the uploaded spend is all-in (supply plus delivery) and the indication is not.\n\nEnergy intensity: consumption ÷ Size (ft²), shown next to the per-ft² estimate the site’s property type carries (the reference profile’s consumption ÷ its reference size — unchanged by the site’s own square footage, since the estimate scales linearly). The vs Est. columns are the signed gap between the two: +30% means the site uses 30% more per ft² than its type suggests. Amber marks a 10–25% gap, red 25%+ — worth checking the consumption figure and the property type on that row. Total intensity is electric plus gas converted at 293.07 kWh per Dth, counting a commodity with no figure as zero, so an electric-only site reads low against a type whose estimate includes gas. Cells stay blank where the site has no square footage, or where its property type carries no consumption profile. Where the consumption itself was modeled (italic amber), the gap is 0% by construction.';
      legendCell.font = { name: 'Nunito Sans', size: 9, italic: true, color: { argb: SE_EST } };
      legendCell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 };
      detailSheet.mergeCells(legendRowIdx, 1, legendRowIdx, Math.min(detailCols.length, 8));
      legendRow.height = 165;
    }

    // ---- Third sheet: Monthly Savings Breakdown ---------------------
    // Per-site / per-commodity audit of how the by-state savings are
    // built. Each row carries the inputs (annual spend, savings band,
    // contract end), then 60 month columns with the contract-gated
    // mid savings for that site. Contract months sit at $0; the first
    // post-contract month flips on at annual_mid / 12. Year 1-5 totals
    // on the by-state sheet are simply column-sums of these rows
    // through month 12 / 24 / 36 / 48 / 60, so this sheet is the
    // ledger that explains those numbers.
    const allSiteRows = [...electricSiteRows, ...gasSiteRows]
      .filter(s => s.siteName || s.annualMid > 0 || s.fiveYearMid > 0)
      .sort((a, b) =>
        (a.state || '').localeCompare(b.state || '')
        || a.siteName.localeCompare(b.siteName)
        || a.commodity.localeCompare(b.commodity));

    if (allSiteRows.length > 0) {
      const monthlySheet = wb.addWorksheet('Monthly Savings', {
        // Hidden by default — a supporting per-site audit ledger for the
        // by-state numbers, surfaced only when a reader unhides it. Same
        // treatment as the Hedging Analysis / Gas Market Timing tabs.
        state: 'hidden',
        properties: { tabColor: { argb: SE_GREEN } },
        views: [{ showGridLines: false, state: 'frozen', ySplit: 2, xSplit: 3 }],
      });
      // Percentages stored as raw numbers (0.02) with a percent
      // format so Excel doesn't flag them as "number stored as text"
      // — same reason the other numeric columns avoid string values.
      // The Savings % column is scenario-aware: the by-state sheet's
      // toggle picks low / mid / high for each site's savings band.
      const sitePctTriple = (s) => (s.lowPct == null || s.highPct == null)
        ? null
        : { low: s.lowPct, mid: (s.lowPct + s.highPct) / 2, high: s.highPct };
      const fixedCols = [
        { label: 'Site Name', get: (s) => s.siteName, width: 28 },
        { label: 'ST / Prov / Country', get: (s) => s.state, width: 22 },
        { label: 'Commodity', get: (s) => s.commodity === 'electric' ? 'Electric' : 'Gas', width: 14 },
        // Why a row can sit at $0 for all 60 months with real spend on
        // it: no savings are projected onto a leased location.
        { label: 'Owned / Leased', get: (s) => s.ownership, width: 14 },
        { label: 'Utility', get: (s) => s.utility, width: 22 },
        { label: 'Supplier', get: (s) => s.supplier, width: 22 },
        { label: 'Contract Start', get: (s) => s.contractStart, width: 14, numFmt: 'm/d/yyyy', dateColumn: true },
        { label: 'Contract End', get: (s) => s.contractEnd, width: 14, numFmt: 'm/d/yyyy', dateColumn: true },
        { label: 'Annual Spend', get: (s) => s.annualSpend, numFmt: '"$"#,##0', width: 18 },
        { label: 'Low %', get: (s) => s.lowPct, numFmt: '0.0%', width: 9 },
        { label: 'High %', get: (s) => s.highPct, numFmt: '0.0%', width: 9 },
        { label: 'Savings %', scenario: true, get: sitePctTriple, numFmt: '0.0%', width: 11 },
        // Annual savings rate × spend, but follows the by-state
        // sheet's Savings Scenario toggle so picking Conservative /
        // Aggressive updates this cell too. The triple feeds
        // writeScenarioFormula which renders a cross-sheet IF formula
        // referencing the toggle on tab 1.
        { label: 'Current Scenario Savings/yr', scenario: true, get: (s) => ({ low: s.annualLow, mid: s.annualMid, high: s.annualHigh }), numFmt: '"$"#,##0', width: 22 },
        { label: '5-Year Mid Savings', get: (s) => Math.round(s.fiveYearMid), numFmt: '"$"#,##0', width: 16 },
      ];
      const monthCols = monthShortLabels.map((label, i) => ({
        label,
        // Raw mid savings; the year-gate IF wrapper added at write
        // time zeroes any month past the user's chosen term × 12.
        get: (s) => Math.round(s.monthlyMid[i] || 0),
        numFmt: '"$"#,##0',
        width: 11,
        sumKey: `m${i}`,
        monthGate: i + 1, // 1-indexed for the formula
      }));
      const cols = [...fixedCols, ...monthCols];

      monthlySheet.columns = cols.map(c => ({ width: c.width }));

      // Title row.
      monthlySheet.mergeCells(1, 1, 1, cols.length);
      const title = monthlySheet.getCell(1, 1);
      title.value = 'Monthly Savings Breakdown';
      title.font = { name: 'Nunito Sans', bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
      title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
      title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      monthlySheet.getRow(1).height = 28;

      // Header row.
      const hdr = monthlySheet.getRow(2);
      cols.forEach((c, i) => {
        const cell = hdr.getCell(i + 1);
        cell.value = c.label;
        cell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
        cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 };
        cell.border = {
          bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } },
          right:  { style: 'hair', color: { argb: 'FFFFFFFF' } },
        };
      });
      hdr.height = 32;

      // Per-site rows.
      allSiteRows.forEach((s, idx) => {
        const dataRow = monthlySheet.getRow(3 + idx);
        cols.forEach((c, i) => {
          const cell = dataRow.getCell(i + 1);
          const v = c.get(s);
          if (c.scenario) {
            // Every cell in this column gets a formula keyed off the
            // by-state sheet's toggle. The helper stamps the cell
            // with ignoredErrors so Excel won't show the green
            // "inconsistent formula" / "number stored as text"
            // chevrons even if the row has no savings band.
            if (v && typeof v === 'object') {
              writeScenarioFormula(cell, ceilForFmt(v.low, c.numFmt), ceilForFmt(v.mid, c.numFmt), ceilForFmt(v.high, c.numFmt), c.yearGate);
            } else {
              writeScenarioFormula(cell, 0, 0, 0, c.yearGate);
            }
          } else if (c.monthGate != null) {
            writeMonthGatedConstant(cell, ceilForFmt(v, c.numFmt), c.monthGate);
          } else if (c.yearGate != null) {
            writeYearGatedConstant(cell, ceilForFmt(v, c.numFmt), c.yearGate);
          } else if (v === '' || v == null) {
            writeBlank(cell, !!c.numFmt);
          } else if (c.dateColumn) {
            cell.value = toExcelDate(v);
          } else {
            cell.value = ceilForFmt(v, c.numFmt);
          }
          cell.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
          cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
          if (c.numFmt) cell.numFmt = c.numFmt;
          cell.border = {
            bottom: { style: 'hair', color: { argb: SE_BORDER } },
            right:  { style: 'hair', color: { argb: SE_BORDER } },
          };
        });
        dataRow.height = 18;
      });

      // Totals row — month columns use SUM() formulas pointing at
      // the data range above so flipping the term-length dropdown
      // (which zeroes individual month cells) automatically
      // re-totals the column. Non-month totals stay as static
      // numbers since they're not gated.
      const totalRowIdx = 3 + allSiteRows.length;
      const totalRow = monthlySheet.getRow(totalRowIdx);
      const lastDataRow = 2 + allSiteRows.length;
      const colLetter = (n) => {
        let s = '';
        let x = n;
        while (x > 0) {
          const r = (x - 1) % 26;
          s = String.fromCharCode(65 + r) + s;
          x = Math.floor((x - 1) / 26);
        }
        return s;
      };
      cols.forEach((c, i) => {
        const cell = totalRow.getCell(i + 1);
        if (i === 0) {
          cell.value = 'Total (all sites)';
        } else if (c.scenario) {
          // Scenario columns sum the low / mid / high triples across
          // every site, then write the same scenario formula so the
          // total follows the by-state sheet's toggle. Keeps the
          // column's formula shape uniform top-to-bottom (no
          // inconsistent-formula chevrons).
          let low = 0, mid = 0, high = 0;
          for (const s of allSiteRows) {
            const t = c.get(s);
            if (t && typeof t === 'object') {
              low += Number(t.low) || 0;
              mid += Number(t.mid) || 0;
              high += Number(t.high) || 0;
            }
          }
          writeScenarioFormula(cell, ceilForFmt(low, c.numFmt), ceilForFmt(mid, c.numFmt), ceilForFmt(high, c.numFmt), c.yearGate);
        } else if (c.monthGate != null && allSiteRows.length > 0) {
          const letter = colLetter(i + 1);
          cell.value = {
            formula: `SUM(${letter}3:${letter}${lastDataRow})`,
            result: 0,
          };
          cell.ignoredErrors = { formula: true, formulaRange: true, numberStoredAsText: true };
        } else if (c.label === 'Annual Spend') {
          cell.value = ceilForFmt(allSiteRows.reduce((a, s) => a + (s.annualSpend || 0), 0), c.numFmt);
        } else if (c.label === '5-Year Mid Savings') {
          cell.value = ceilForFmt(allSiteRows.reduce((a, s) => a + (s.fiveYearMid || 0), 0), c.numFmt);
        } else {
          writeBlank(cell, !!c.numFmt);
        }
        cell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: SE_GREEN_DARK } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        if (c.numFmt) cell.numFmt = c.numFmt;
        cell.border = {
          top:    { style: 'thin', color: { argb: SE_GREEN_DARK } },
          bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } },
        };
      });
      totalRow.height = 22;

      monthlySheet.autoFilter = {
        from: { row: 2, column: 1 },
        to: { row: 2 + allSiteRows.length, column: cols.length },
      };
    }

    // ---- Property Type Estimates (per site) -------------------------
    // Reference-table-driven estimate of annual consumption and the
    // expected utility-account count per commodity, keyed off the
    // Property Type column on the source sheet. Optional Size_ft2
    // column scales the consumption numbers proportionally to the
    // reference Size_ft2 baked into the table; account counts are
    // independent of size. Skips sites with no recognized property
    // type. These per-site rows are rendered as a section on the hidden
    // Methodology tab (no longer a standalone sheet).
    const propertyTypeSiteRows = rows
      .map((r) => {
        const canonicalType = r.__propertyType__;
        if (!canonicalType) return null;
        const sizeFt2 = r.__propertySizeFt2__;
        const cons = estimateConsumption(canonicalType, sizeFt2);
        const accounts = propertyTypeAccounts(canonicalType);
        return {
          siteName: siteNameColumn ? String(r[siteNameColumn] || '').trim() : '',
          state: r.__state__ || '',
          country: String(r.__country__ || '').trim(),
          rawPropertyType: r.__propertyTypeRaw__ || '',
          propertyType: canonicalType,
          category: cons?.category ?? '',
          sizeFt2: cons?.sizeFt2 ?? null,
          referenceSizeFt2: cons?.referenceSizeFt2 ?? null,
          electricKwh: cons?.electricKwh ?? null,
          gasDth: cons?.gasDth ?? null,
          gasKwh: cons?.gasKwh ?? null,
          totalKwh: cons?.totalKwh ?? null,
          accounts: accounts || null,
        };
      })
      .filter(Boolean);

    // ---- Contract Overview sheet ------------------------------------
    // One row per (site, commodity) where any contract field is filled
    // in — supplier, contract name, dates, or contract price. Sites
    // with zero contract signal across both commodities don't appear
    // here so the sheet stays readable when the source data is sparse.
    if (contractOverviewRows.length > 0) {
      const ws = wb.addWorksheet('Contract Overview', {
        properties: { tabColor: { argb: SE_GREEN } },
        views: [{ showGridLines: false, state: 'frozen', ySplit: 2 }],
      });
      const cols = [
        { label: 'Site',                key: 'Site',                width: 28 },
        { label: 'State',               key: 'State',               width: 9  },
        { label: 'Country',             key: 'Country',             width: 16 },
        { label: 'Commodity',           key: 'Commodity',           width: 12 },
        { label: 'Utility',             key: 'Utility',             width: 22 },
        { label: 'Supplier',            key: 'Supplier',            width: 22 },
        { label: 'Contract Name',       key: 'Contract Name',       width: 22 },
        { label: 'Product Type',        key: 'Product Type',        width: 16 },
        { label: 'Contract Start',      key: 'Contract Start',      width: 14, numFmt: 'm/d/yyyy', dateColumn: true },
        { label: 'Contract End',        key: 'Contract End',        width: 14, numFmt: 'm/d/yyyy', dateColumn: true },
        { label: 'Contract Price',      key: 'Contract Price',      width: 16, numFmt: '"$"0.0000' },
        { label: 'Price Unit',          key: 'Price Unit',          width: 11 },
        // Blank on every row of a clean portfolio; carries the unit caveat
        // where the source file quoted a price in something other than the
        // unit this sheet reads it in.
        { label: 'Price Unit Warning',  key: 'Price Unit Warning',  width: 46, warnColumn: true },
        { label: 'Annual Consumption',  key: 'Annual Consumption',  width: 18, numFmt: '#,##0' },
        { label: 'Consumption Unit',    key: 'Consumption Unit',    width: 14 },
        { label: 'Annual Cost',         key: 'Annual Cost',         width: 16, numFmt: '"$"#,##0' },
      ];
      ws.columns = cols.map(c => ({ width: c.width }));

      ws.mergeCells(1, 1, 1, cols.length);
      const title = ws.getCell(1, 1);
      title.value = 'Contract Overview';
      title.font = { name: 'Nunito Sans', bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
      title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
      title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(1).height = 28;

      const hdr = ws.getRow(2);
      cols.forEach((c, i) => {
        const cell = hdr.getCell(i + 1);
        cell.value = c.label;
        cell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
        cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 };
        cell.border = {
          bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } },
          right:  { style: 'hair', color: { argb: 'FFFFFFFF' } },
        };
      });
      hdr.height = 30;

      contractOverviewRows.forEach((r, idx) => {
        const dataRow = ws.getRow(3 + idx);
        cols.forEach((c, i) => {
          const cell = dataRow.getCell(i + 1);
          const v = r[c.key];
          if (v === '' || v == null) cell.value = ' ';
          else if (c.dateColumn) cell.value = toExcelDate(v);
          else cell.value = v;
          // A unit caveat has to read as one. In amber and bold it can't be
          // skimmed past on a sheet whose other columns are all plain data.
          const warn = c.warnColumn && v;
          cell.font = { name: 'Nunito Sans', size: 10, bold: !!warn, color: { argb: warn ? 'FF92400E' : SE_TEXT_DARK } };
          if (warn) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
          cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
          if (c.numFmt) cell.numFmt = c.numFmt;
          cell.border = {
            bottom: { style: 'hair', color: { argb: SE_BORDER } },
            right:  { style: 'hair', color: { argb: SE_BORDER } },
          };
        });
        dataRow.height = 18;
      });

      ws.autoFilter = {
        from: { row: 2, column: 1 },
        to:   { row: 2 + contractOverviewRows.length, column: cols.length },
      };
    }

    // ---- Hedging Strategy Example sheet -----------------------------
    // Interactive example. Two editable inputs (Annual Volume on E4,
    // Spot Reference on H4) plus per-tranche allocation (column C)
    // and locked price (column E) drive Excel formulas through the
    // Volume / Current Position Cost / Example Hedge Position Cost /
    // Saving columns, the totals row, and the Result block. The
    // Result block sits to the right of the tranche table (cols M-P)
    // and breaks Current vs Example vs Delta down by year so the
    // savings concentration reads at a glance.
    {
      const ws = wb.addWorksheet('Hedging Analysis', {
        // Hidden by default — supporting illustrative tab, surfaced only
        // when a reader unhides it. Same treatment as Gas Market Timing
        // and Floating vs Hedging Example.
        state: 'hidden',
        properties: { tabColor: { argb: SE_GREEN_DARK } },
        views: [{ showGridLines: false, state: 'frozen', ySplit: 6 }],
      });

      const TABLE_COLS = 11;
      // Result block is a year × {Current, Example, Delta} grid sitting
      // to the right of the tranche table. Four columns wide.
      const RESULT_FIRST_COL = 13;
      const RESULT_LAST_COL = 16;
      const COLS = RESULT_LAST_COL;
      // Column widths — width index matches column position 1..16.
      //   A #          | B Date     | C Hedge%(Cur) | D Hedge%(Ex)
      //   E Volume     | F Fixed    | G Index       | H Adders
      //   I Current    | J Example  | K Saving
      //   L gutter
      //   M Year       | N Current  | O Example     | P Delta
      // Cols Q-T (17-20) are chart-area padding so the Spot Price
      // Savings vs Current Hedging chart (anchored below the year-
      // result block at col M) renders over right-sized cells instead
      // of Excel's default-narrow columns.
      const widths = [10, 16, 12, 14.5, 19, 19, 14, 20, 18, 22, 18, 3, 10, 16, 18, 16, 12, 12, 12, 12];
      ws.columns = widths.map(w => ({ width: w }));

      const INPUT_FILL = 'FFFFF9C3';
      const INPUT_BORDER = 'FFCA8A04';
      const inputBorder = {
        top:    { style: 'thin', color: { argb: INPUT_BORDER } },
        bottom: { style: 'thin', color: { argb: INPUT_BORDER } },
        left:   { style: 'thin', color: { argb: INPUT_BORDER } },
        right:  { style: 'thin', color: { argb: INPUT_BORDER } },
      };

      ws.mergeCells(1, 1, 1, COLS);
      const title = ws.getCell(1, 1);
      title.value = 'Hedging Analysis';
      title.font = { name: 'Nunito Sans', bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
      title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
      title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(1).height = 30;

      // Row 2 is the single white spacer between the green title
      // band (row 1) and the tranche-table header (row 3). The
      // Annual Volume + Current Fixed Price inputs that used to sit
      // here have been inlined into the tranche formulas (volume =
      // 100,000 / 60 per tranche, fixed price = $75) so the sheet
      // stays slim.

      // Tranche-table headers sit on row 3, with one blank spacer
      // (row 2) above it.
      const HEADER_ROW = 3;
      const headers = [
        'Month', 'Execution Date', 'Hedge % (Current)', 'Hedge % (Example)',
        'Volume (MWh)', 'Fixed Position ($/MWh)', 'Index Price ($/MWh)',
        'Adders & Noncommodity Components ($/MWh)',
        'Current Position Cost', 'Example Hedge Position Cost', 'Saving vs Spot',
      ];
      const hr = ws.getRow(HEADER_ROW);
      headers.forEach((h, i) => {
        const c = hr.getCell(i + 1);
        c.value = h;
        c.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
        c.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
        c.border = { bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } } };
      });
      hr.height = 45;

      // Default tranche inputs — 60 monthly layers across 2026-2030.
      // Prices follow a plausible forward-curve shape with seasonal
      // cycling. Hedge % columns hold the cumulative hedge ratio for
      // each scenario; per-tranche allocation falls out of the row-
      // to-row delta. Current defaults to a full 100 % buildup
      // (1/60 per layer); the Example scenario defaults to a 50 %
      // buildup (1/120 per layer) so the side-by-side reads as
      // "full hedge vs partial hedge" out of the box.
      const hedges = [
        { date: '2026-01-14', price: 74.50 },
        { date: '2026-02-11', price: 71.25 },
        { date: '2026-03-18', price: 68.80 },
        { date: '2026-04-22', price: 67.40 },
        { date: '2026-05-13', price: 69.10 },
        { date: '2026-06-10', price: 72.30 },
        { date: '2026-07-15', price: 76.80 },
        { date: '2026-08-19', price: 78.40 },
        { date: '2026-09-16', price: 74.60 },
        { date: '2026-10-14', price: 73.20 },
        { date: '2026-11-11', price: 71.50 },
        { date: '2026-12-09', price: 70.40 },
        { date: '2027-01-13', price: 69.80 },
        { date: '2027-02-10', price: 68.50 },
        { date: '2027-03-17', price: 67.20 },
        { date: '2027-04-14', price: 66.90 },
        { date: '2027-05-12', price: 68.40 },
        { date: '2027-06-09', price: 71.50 },
        { date: '2027-07-14', price: 75.60 },
        { date: '2027-08-11', price: 77.20 },
        { date: '2027-09-15', price: 73.80 },
        { date: '2027-10-13', price: 72.40 },
        { date: '2027-11-10', price: 70.80 },
        { date: '2027-12-08', price: 69.50 },
        { date: '2028-01-12', price: 68.90 },
        { date: '2028-02-09', price: 67.30 },
        { date: '2028-03-15', price: 66.10 },
        { date: '2028-04-12', price: 65.80 },
        { date: '2028-05-10', price: 67.20 },
        { date: '2028-06-14', price: 70.40 },
        { date: '2028-07-12', price: 74.30 },
        { date: '2028-08-09', price: 75.90 },
        { date: '2028-09-13', price: 72.60 },
        { date: '2028-10-11', price: 71.30 },
        { date: '2028-11-08', price: 69.70 },
        { date: '2028-12-13', price: 68.40 },
        { date: '2029-01-10', price: 67.80 },
        { date: '2029-02-14', price: 66.20 },
        { date: '2029-03-14', price: 65.00 },
        { date: '2029-04-11', price: 64.70 },
        { date: '2029-05-09', price: 66.10 },
        { date: '2029-06-13', price: 69.30 },
        { date: '2029-07-11', price: 73.20 },
        { date: '2029-08-08', price: 74.80 },
        { date: '2029-09-12', price: 71.50 },
        { date: '2029-10-10', price: 70.20 },
        { date: '2029-11-14', price: 68.60 },
        { date: '2029-12-12', price: 67.30 },
        { date: '2030-01-09', price: 66.70 },
        { date: '2030-02-13', price: 65.10 },
        { date: '2030-03-13', price: 63.90 },
        { date: '2030-04-10', price: 63.60 },
        { date: '2030-05-08', price: 65.00 },
        { date: '2030-06-12', price: 68.20 },
        { date: '2030-07-10', price: 72.10 },
        { date: '2030-08-14', price: 73.70 },
        { date: '2030-09-11', price: 70.40 },
        { date: '2030-10-09', price: 69.10 },
        { date: '2030-11-13', price: 67.50 },
        { date: '2030-12-11', price: 66.20 },
      ];
      const CURRENT_STEP = 1 / hedges.length;        // 1/60 → 100% at end
      const PROPOSED_STEP = 1 / (hedges.length * 2); // 1/120 → 50% at end
      const TRANCHE_VOL = 100000 * CURRENT_STEP;

      hedges.forEach((h, i) => {
        const rowNum = HEADER_ROW + 1 + i;
        const r = ws.getRow(rowNum);
        r.getCell(1).value = i + 1;
        // Write the execution date as a real Date so Excel applies
        // the m/d/yyyy short-date format on column B.
        r.getCell(2).value = new Date(h.date + 'T00:00:00Z');
        // Columns C/D are direct cumulative-hedge inputs — user-
        // editable. The default ladders are linear to 100% (Current)
        // and 50% (Example); editing one cell only affects this
        // row's slice in that scenario, so the buildup can be
        // shaped however the user wants.
        r.getCell(3).value = (i + 1) * CURRENT_STEP;
        r.getCell(4).value = (i + 1) * PROPOSED_STEP;
        // Per-tranche volume (E) falls out of the Current cumulative
        // delta — for the first data row that delta is just C{row}.
        r.getCell(5).value = i === 0
          ? { formula: `100000*C${rowNum}`, result: TRANCHE_VOL }
          : { formula: `100000*(C${rowNum}-C${rowNum - 1})`, result: TRANCHE_VOL };
        r.getCell(6).value = 75;
        r.getCell(7).value = h.price;
        // Adders & Noncommodity Components ($/MWh) — user input, layered
        // on top of the per-row pricing for both the Current Position
        // Cost AND the Example Hedge Position Cost so the same
        // non-commodity charge hits both scenarios. Default 0 so the
        // column reads as opt-in.
        r.getCell(8).value = 0;
        // Current Position Cost — every tranche fully locked at the
        // Current Fixed Price + Adder, i.e. the baseline the user is
        // already on. Becomes the reference the Example scenario is
        // measured against.
        r.getCell(9).value = { formula: `(F${rowNum}+H${rowNum})*E${rowNum}`, result: 75 * TRANCHE_VOL };
        // Example Hedge Position Cost — for each tranche, the slice
        // hedged only in Current (C − D) takes the Index Price (G), and
        // the slice hedged in the Example scenario (D) takes the Fixed
        // Position (F). Adders ride on top of both legs so the non-
        // commodity charge hits whichever side carries the volume:
        //   ((C − D) × E) × (G + Adder)   (Current-only slice priced
        //                                  at Index + Adder)
        // + (D × E × (F + Adder))         (Example-hedged slice priced
        //                                  at Fixed + Adder)
        r.getCell(10).value = {
          formula: `((C${rowNum}-D${rowNum})*E${rowNum})*(G${rowNum}+H${rowNum})+(D${rowNum}*E${rowNum}*(F${rowNum}+H${rowNum}))`,
          result: ((CURRENT_STEP - PROPOSED_STEP) * TRANCHE_VOL) * h.price + (PROPOSED_STEP * TRANCHE_VOL * 75),
        };
        // Saving = Current − Example. Positive when the Example
        // scenario beats Current (Index pricing comes in below Fixed
        // on the un-hedged slice).
        r.getCell(11).value = { formula: `I${rowNum}-J${rowNum}`, result: (75 - h.price) * (CURRENT_STEP - PROPOSED_STEP) * TRANCHE_VOL };
        // Helper columns U (21) and V (22) feed the chart's
        // stacked-area "savings shading" between the Index Price and
        // the Current Fixed Price:
        //   U = MIN(index, fixed)    — invisible base of the stack
        //   V = MAX(fixed - index, 0) — the green band, only present
        //                               when index sits below fixed
        // Columns are hidden below; the chart references them and
        // renders the area via plotVisOnly=0 in the chart XML.
        r.getCell(21).value = { formula: `MIN(G${rowNum},F${rowNum})`, result: Math.min(h.price, 75) };
        r.getCell(22).value = { formula: `MAX(F${rowNum}-G${rowNum},0)`, result: Math.max(75 - h.price, 0) };
        r.getCell(21).numFmt = '"$"0.00';
        r.getCell(22).numFmt = '"$"0.00';

        for (let ci = 1; ci <= 11; ci++) {
          const c = r.getCell(ci);
          c.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
          c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
          c.border = {
            bottom: { style: 'hair', color: { argb: SE_BORDER } },
            right:  { style: 'hair', color: { argb: SE_BORDER } },
          };
        }
        r.getCell(2).numFmt = 'm/d/yyyy';
        r.getCell(3).numFmt = '0%';
        r.getCell(4).numFmt = '0%';
        r.getCell(5).numFmt = '#,##0';
        r.getCell(6).numFmt = '"$"0.00';
        r.getCell(7).numFmt = '"$"0.00';
        r.getCell(8).numFmt = '"$"0.00';
        r.getCell(9).numFmt = '"$"#,##0';
        r.getCell(10).numFmt = '"$"#,##0';
        r.getCell(11).numFmt = '"$"#,##0;[Red]("$"#,##0)';

        // Mark the editable cells (both Hedge % columns + Index Price
        // + Adders) yellow. Conditional formatting takes over Index
        // Price's color (green when it beats Fixed Position, red
        // when it lags).
        for (const col of [3, 4, 7, 8]) {
          const c = r.getCell(col);
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INPUT_FILL } };
        }
        r.height = 20;
      });

      // Totals via SUM formulas. The blended index price is the
      // weighted average (total locked cost / total volume).
      const FIRST_DATA_ROW = HEADER_ROW + 1;
      const TOTAL_ROW = FIRST_DATA_ROW + hedges.length;
      const LAST_DATA_ROW = TOTAL_ROW - 1;
      const dataRange = (col) => `${col}${FIRST_DATA_ROW}:${col}${LAST_DATA_ROW}`;
      // Plausible defaults that Excel will recompute on open.
      const sumPrices = hedges.reduce((a, h) => a + h.price, 0);
      const blendedPriceDefault = sumPrices / hedges.length;
      const totalLockedCostDefault = blendedPriceDefault * 100000;
      const totalSpotCostDefault = 75 * 100000;
      const tr = ws.getRow(TOTAL_ROW);
      tr.getCell(2).value = 'TOTAL';
      // C/D hold cumulative hedge ratios — the total is just the last
      // row's value, not a SUM.
      tr.getCell(3).value = { formula: `C${LAST_DATA_ROW}`, result: 1.0 };
      tr.getCell(4).value = { formula: `D${LAST_DATA_ROW}`, result: 0.5 };
      tr.getCell(5).value = { formula: `SUM(${dataRange('E')})`, result: 100000 };
      tr.getCell(6).value = 75;
      // Volume-weighted average Index Price and Adder for the totals
      // row. Locked / Spot now include Adder, so I/E would mix
      // commodity + non-commodity into the "Index Price" cell — use
      // SUMPRODUCT to keep the totals row honest about each piece.
      tr.getCell(7).value  = { formula: `SUMPRODUCT(${dataRange('G')},${dataRange('E')})/${`E${TOTAL_ROW}`}`, result: blendedPriceDefault };
      tr.getCell(8).value  = { formula: `SUMPRODUCT(${dataRange('H')},${dataRange('E')})/${`E${TOTAL_ROW}`}`, result: 0 };
      // Col I (Current Position Cost) totals to fixed × volume; col J
      // (Example Hedge Position Cost) totals to the index-weighted
      // result of the partial hedge. K (Saving) is Current − Example.
      tr.getCell(9).value  = { formula: `SUM(${dataRange('I')})`, result: totalSpotCostDefault };
      tr.getCell(10).value = { formula: `SUM(${dataRange('J')})`, result: totalLockedCostDefault };
      tr.getCell(11).value = { formula: `SUM(${dataRange('K')})`, result: totalSpotCostDefault - totalLockedCostDefault };
      for (let ci = 1; ci <= 11; ci++) {
        const c = tr.getCell(ci);
        c.font = { name: 'Nunito Sans', size: 11, bold: true, color: { argb: SE_TEXT_DARK } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        c.border = {
          top:    { style: 'thin', color: { argb: SE_GREEN_DARK } },
          bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } },
        };
      }
      tr.getCell(3).numFmt = '0%';
      tr.getCell(4).numFmt = '0%';
      tr.getCell(5).numFmt = '#,##0';
      tr.getCell(6).numFmt = '"$"0.00';
      tr.getCell(7).numFmt = '"$"0.00';
      tr.getCell(8).numFmt = '"$"0.00';
      tr.getCell(9).numFmt = '"$"#,##0';
      tr.getCell(10).numFmt = '"$"#,##0';
      tr.getCell(11).numFmt = '"$"#,##0;[Red]("$"#,##0)';
      tr.height = 26;

      // Index-Price color flips live via conditional formatting that
      // compares column G (Index Price) to column F (the per-row Fixed
      // Position formula). Green when the index beats the fixed
      // price, red when it lags.
      ws.addConditionalFormatting({
        ref: `G${FIRST_DATA_ROW}:G${LAST_DATA_ROW}`,
        rules: [
          {
            type: 'cellIs', operator: 'lessThan', formulae: [`F${FIRST_DATA_ROW}`], priority: 1,
            style: {
              fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFDCFCE7' } },
              font: { color: { argb: 'FF166534' }, bold: true },
            },
          },
          {
            type: 'cellIs', operator: 'greaterThanOrEqual', formulae: [`F${FIRST_DATA_ROW}`], priority: 2,
            style: {
              fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFEE2E2' } },
              font: { color: { argb: 'FF991B1B' }, bold: true },
            },
          },
        ],
      });

      ws.addConditionalFormatting({
        ref: `K${FIRST_DATA_ROW}:K${LAST_DATA_ROW}`,
        rules: [{
          type: 'dataBar',
          cfvo: [{ type: 'num', value: -50000 }, { type: 'num', value: 100000 }],
          color: { argb: 'FF22C55E' },
          showValue: true,
          gradient: false,
        }],
      });

      // Result block — sits to the RIGHT of the tranche table and
      // rolls the per-tranche Current / Example / Saving columns up
      // into rolling 12-month buckets (Year 1 = first 12 tranches,
      // Year 2 = next 12, …). Each value cell is a live SUM over the
      // bucket's I / J / K slice so the grid updates whenever the
      // user edits the tranche inputs.
      const RESULT_HEADER_ROW = HEADER_ROW;
      const dataRangeI = `$I$${FIRST_DATA_ROW}:$I$${LAST_DATA_ROW}`;
      const dataRangeJ = `$J$${FIRST_DATA_ROW}:$J$${LAST_DATA_ROW}`;
      const resultHeaders = ['Year', 'Current', 'Example', 'Delta'];
      const hr2 = ws.getRow(RESULT_HEADER_ROW);
      resultHeaders.forEach((h, i) => {
        const c = hr2.getCell(RESULT_FIRST_COL + i);
        c.value = h;
        c.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
        c.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'right', wrapText: true, indent: 1 };
        c.border = { bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } } };
      });

      // Bucket the tranches into rolling 12-month groups: rows 1-12
      // → Year 1, rows 13-24 → Year 2, etc. The labels are sequential
      // ("Year 1", "Year 2" …) instead of calendar years so the
      // breakdown stays meaningful even if the user shifts execution
      // dates around or runs the analysis off-calendar.
      const MONTHS_PER_YEAR = 12;
      const buckets = [];
      for (let start = 0; start < hedges.length; start += MONTHS_PER_YEAR) {
        const slice = hedges.slice(start, start + MONTHS_PER_YEAR);
        let current = 0;
        let example = 0;
        for (const h of slice) {
          // Current: (Fixed $75 + Adder $0) × per-tranche volume
          current += 75 * TRANCHE_VOL;
          // Example: ((C-D) × vol × (G + H)) + (D × vol × (F + H))
          example += ((CURRENT_STEP - PROPOSED_STEP) * TRANCHE_VOL) * h.price
            + (PROPOSED_STEP * TRANCHE_VOL * 75);
        }
        buckets.push({
          label: `Year ${buckets.length + 1}`,
          firstRow: FIRST_DATA_ROW + start,
          lastRow: FIRST_DATA_ROW + start + slice.length - 1,
          current,
          example,
        });
      }

      buckets.forEach((bucket, i) => {
        const rowIdx = RESULT_HEADER_ROW + 1 + i;
        const row = ws.getRow(rowIdx);
        const rangeI = `$I$${bucket.firstRow}:$I$${bucket.lastRow}`;
        const rangeJ = `$J$${bucket.firstRow}:$J$${bucket.lastRow}`;
        const rangeK = `$K$${bucket.firstRow}:$K$${bucket.lastRow}`;
        const yearCell = row.getCell(RESULT_FIRST_COL);
        yearCell.value = bucket.label;
        const currentCell = row.getCell(RESULT_FIRST_COL + 1);
        currentCell.value = { formula: `SUM(${rangeI})`, result: bucket.current };
        const exampleCell = row.getCell(RESULT_FIRST_COL + 2);
        exampleCell.value = { formula: `SUM(${rangeJ})`, result: bucket.example };
        const deltaCell = row.getCell(RESULT_FIRST_COL + 3);
        deltaCell.value = { formula: `SUM(${rangeK})`, result: bucket.current - bucket.example };
        for (let ci = 0; ci < 4; ci++) {
          const c = row.getCell(RESULT_FIRST_COL + ci);
          c.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
          c.alignment = { vertical: 'middle', horizontal: ci === 0 ? 'left' : 'right', indent: 1 };
          c.border = {
            bottom: { style: 'hair', color: { argb: SE_BORDER } },
          };
        }
        currentCell.numFmt = '"$"#,##0';
        exampleCell.numFmt = '"$"#,##0';
        deltaCell.numFmt = '"$"#,##0;[Red]("$"#,##0)';
        row.height = 20;
      });

      // TOTAL row at the bottom of the year grid — sums each column
      // across the buildup. Highlighted band so the headline savings
      // number reads at a glance.
      const yearTotalRowIdx = RESULT_HEADER_ROW + 1 + buckets.length;
      const yearTotalRow = ws.getRow(yearTotalRowIdx);
      const totalCurrentDefault = buckets.reduce((s, b) => s + b.current, 0);
      const totalExampleDefault = buckets.reduce((s, b) => s + b.example, 0);
      const totLabel = yearTotalRow.getCell(RESULT_FIRST_COL);
      totLabel.value = 'TOTAL';
      const totCurrent = yearTotalRow.getCell(RESULT_FIRST_COL + 1);
      totCurrent.value = { formula: `SUM(${dataRangeI})`, result: totalCurrentDefault };
      const totExample = yearTotalRow.getCell(RESULT_FIRST_COL + 2);
      totExample.value = { formula: `SUM(${dataRangeJ})`, result: totalExampleDefault };
      const totDelta = yearTotalRow.getCell(RESULT_FIRST_COL + 3);
      totDelta.value = { formula: `K${TOTAL_ROW}`, result: totalCurrentDefault - totalExampleDefault };
      for (let ci = 0; ci < 4; ci++) {
        const c = yearTotalRow.getCell(RESULT_FIRST_COL + ci);
        c.font = { name: 'Nunito Sans', size: 11, bold: true, color: { argb: SE_GREEN_DARK } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
        c.alignment = { vertical: 'middle', horizontal: ci === 0 ? 'left' : 'right', indent: 1 };
        c.border = {
          top: { style: 'thin', color: { argb: SE_GREEN_DARK } },
          bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } },
        };
      }
      totCurrent.numFmt = '"$"#,##0';
      totExample.numFmt = '"$"#,##0';
      totDelta.numFmt = '"$"#,##0;[Red]("$"#,##0)';
      yearTotalRow.height = 26;

      // Hide the chart-helper columns U + V so they don't clutter the
      // sheet but stay live for the chart (plotVisOnly=0 in the chart
      // XML lets Excel keep plotting hidden ranges).
      ws.getColumn(21).hidden = true;
      ws.getColumn(22).hidden = true;

      // Stash the row range so the chart injection at the end of the
      // export knows which cells to plot. The chart is injected after
      // wb.xlsx.writeBuffer() (ExcelJS has no chart API), so we ferry
      // these bounds out via closure.
      //
      // For the % of Portfolio Hedged chart we also zoom the Y axis to
      // 10 percentage points above the highest cumulative-hedge value
      // and 10 below the lowest (clamped at 0 on the bottom so the
      // axis never goes negative). With the linear ladder defaults
      // (Current: 1/60 → 100 %, Example: 1/120 → 50 %) this lands at
      // ~0 %–110 %; if the user re-shapes the ladders to a tighter
      // range, the export captures that as a tighter axis on next
      // export.
      const hedgePctValues = hedges.flatMap((_, i) => [
        (i + 1) * CURRENT_STEP,
        (i + 1) * PROPOSED_STEP,
      ]);
      const minHedge = Math.min(...hedgePctValues);
      const maxHedge = Math.max(...hedgePctValues);
      const PAD = 0.10;
      hedgingChartRange = {
        firstRow: FIRST_DATA_ROW,
        lastRow: LAST_DATA_ROW,
        hedgePctYMin: Math.max(0, minHedge - PAD),
        hedgePctYMax: maxHedge + PAD,
      };
    }

    // ---- Gas Market Timing sheet ------------------------------------
    // Compares two natural-gas procurement strategies across 60 months:
    //   1) "30-Day Arbitrary Buy" — equal 1/60 layering on a calendar
    //      cadence, ignoring market signals (the baseline).
    //   2) "Market-Timed Layered Hedge" — same total volume, but front-
    //      loaded into months where the forward curve sits below its
    //      long-run average and pulled back when it sits above.
    // Both strategies execute at the prevailing forward price each
    // month, so the savings story is purely "WHEN you buy" rather than
    // "fixed vs float". Layout mirrors the Hedging Analysis tab: yellow
    // editable cells for the cumulative allocation columns + forward
    // price + adders, conditional formatting on the forward-price column
    // (green below long-run average, red above), data-bar on the Saving
    // column, year-by-year result block at cols M-P, and two live Excel
    // charts (savings shading vs long-run average + cumulative
    // allocation curve per strategy).
    {
      const ws = wb.addWorksheet('Gas Market Timing', {
        // Hidden by default — supporting illustrative tab, surfaced only
        // when a reader unhides it.
        state: 'hidden',
        properties: { tabColor: { argb: SE_GREEN_DARK } },
        views: [{ showGridLines: false, state: 'frozen', ySplit: 6 }],
      });

      const TABLE_COLS = 11;
      const RESULT_FIRST_COL = 13;
      const RESULT_LAST_COL = 16;
      const COLS = RESULT_LAST_COL;
      // Column widths — width index matches column position 1..20.
      //   A #          | B Date     | C Alloc%(Arb) | D Alloc%(MT)
      //   E Vol(Arb)   | F Vol(MT)  | G Forward $   | H Adders
      //   I Arb Cost   | J MT Cost  | K Saving
      //   L gutter
      //   M Year       | N Arbitrary | O Market-Timed | P Delta
      // Cols Q-T (17-20) are chart-area padding so the charts anchored
      // below the year-result block render over right-sized cells.
      const widths = [10, 16, 14, 16, 16, 18, 16, 18, 18, 20, 18, 3, 10, 16, 18, 16, 12, 12, 12, 12];
      ws.columns = widths.map(w => ({ width: w }));

      const INPUT_FILL = 'FFFFF9C3';
      const INPUT_BORDER = 'FFCA8A04';

      ws.mergeCells(1, 1, 1, COLS);
      const title = ws.getCell(1, 1);
      title.value = 'Gas Market Timing Analysis';
      title.font = { name: 'Nunito Sans', bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
      title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
      title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(1).height = 30;

      ws.mergeCells(2, 1, 2, COLS);
      const sub = ws.getCell(2, 1);
      sub.value = 'Layered hedging weighted toward low-price months (Market-Timed) vs. equal 1/60 monthly layering (30-Day Arbitrary Buy). Both strategies buy 100,000 Dth at the forward price prevailing in each execution month: the only difference is timing. Edit the yellow cells (cumulative allocation %, forward price, adders) to model your own curve.';
      sub.font = { name: 'Nunito Sans', italic: true, size: 10, color: { argb: SE_SLATE } };
      sub.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
      ws.getRow(2).height = 42;

      const HEADER_ROW = 3;
      const headers = [
        'Month', 'Execution Date',
        'Allocation % (30-Day Arbitrary)', 'Allocation % (Market-Timed)',
        'Volume Arbitrary (Dth)', 'Volume Market-Timed (Dth)',
        'Forward Price ($/Dth)', 'Adders & Noncommodity ($/Dth)',
        'Arbitrary Buy Cost', 'Market-Timed Buy Cost', 'Saving vs Arbitrary',
      ];
      const hr = ws.getRow(HEADER_ROW);
      headers.forEach((h, i) => {
        const c = hr.getCell(i + 1);
        c.value = h;
        c.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
        c.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
        c.border = { bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } } };
      });
      hr.height = 45;

      // Plausible 60-month Henry Hub-like forward curve. Strong winter
      // peaks (Dec-Feb) and summer lows (May-Jul), trending mildly upward
      // year over year. Average across the 60 months lands at ~$3.75/Dth
      // — the value the Market-Timed strategy uses as its "buy more when
      // we're under, less when we're over" pivot.
      const gasHedges = [
        { date: '2026-01-14', price: 4.80 }, { date: '2026-02-11', price: 4.65 },
        { date: '2026-03-18', price: 3.85 }, { date: '2026-04-22', price: 3.20 },
        { date: '2026-05-13', price: 2.75 }, { date: '2026-06-10', price: 2.70 },
        { date: '2026-07-15', price: 2.85 }, { date: '2026-08-19', price: 3.05 },
        { date: '2026-09-16', price: 3.20 }, { date: '2026-10-14', price: 3.45 },
        { date: '2026-11-11', price: 4.10 }, { date: '2026-12-09', price: 4.75 },
        { date: '2027-01-13', price: 4.85 }, { date: '2027-02-10', price: 4.70 },
        { date: '2027-03-17', price: 3.90 }, { date: '2027-04-14', price: 3.25 },
        { date: '2027-05-12', price: 2.80 }, { date: '2027-06-09', price: 2.75 },
        { date: '2027-07-14', price: 2.90 }, { date: '2027-08-11', price: 3.10 },
        { date: '2027-09-15', price: 3.25 }, { date: '2027-10-13', price: 3.50 },
        { date: '2027-11-10', price: 4.15 }, { date: '2027-12-08', price: 4.80 },
        { date: '2028-01-12', price: 4.90 }, { date: '2028-02-09', price: 4.75 },
        { date: '2028-03-15', price: 3.95 }, { date: '2028-04-12', price: 3.30 },
        { date: '2028-05-10', price: 2.85 }, { date: '2028-06-14', price: 2.80 },
        { date: '2028-07-12', price: 2.95 }, { date: '2028-08-09', price: 3.15 },
        { date: '2028-09-13', price: 3.30 }, { date: '2028-10-11', price: 3.55 },
        { date: '2028-11-08', price: 4.20 }, { date: '2028-12-13', price: 4.85 },
        { date: '2029-01-10', price: 4.95 }, { date: '2029-02-14', price: 4.80 },
        { date: '2029-03-14', price: 4.00 }, { date: '2029-04-11', price: 3.35 },
        { date: '2029-05-09', price: 2.90 }, { date: '2029-06-13', price: 2.85 },
        { date: '2029-07-11', price: 3.00 }, { date: '2029-08-08', price: 3.20 },
        { date: '2029-09-12', price: 3.35 }, { date: '2029-10-10', price: 3.60 },
        { date: '2029-11-14', price: 4.25 }, { date: '2029-12-12', price: 4.90 },
        { date: '2030-01-09', price: 5.00 }, { date: '2030-02-13', price: 4.85 },
        { date: '2030-03-13', price: 4.05 }, { date: '2030-04-10', price: 3.40 },
        { date: '2030-05-08', price: 2.95 }, { date: '2030-06-12', price: 2.90 },
        { date: '2030-07-10', price: 3.05 }, { date: '2030-08-14', price: 3.25 },
        { date: '2030-09-11', price: 3.40 }, { date: '2030-10-09', price: 3.65 },
        { date: '2030-11-13', price: 4.30 }, { date: '2030-12-11', price: 4.95 },
      ];
      const TOTAL_VOLUME = 100000; // Dth
      const ARB_STEP = 1 / gasHedges.length; // uniform 1/60 per month
      const avgPrice = gasHedges.reduce((s, h) => s + h.price, 0) / gasHedges.length;
      // Inverse-price weighting: months below the long-run average get
      // a heavier allocation. Squaring sharpens the contrast so the
      // story reads clearly in the chart — flat weights would visually
      // collapse the two cumulative curves.
      const mtWeights = gasHedges.map(h => Math.pow(avgPrice / h.price, 2));
      const mtWeightSum = mtWeights.reduce((a, b) => a + b, 0);
      const mtSteps = mtWeights.map(w => w / mtWeightSum);

      // Precompute cumulative defaults so the closed-form row values
      // can seed Excel's recompute on open.
      const arbCum = gasHedges.map((_, i) => (i + 1) * ARB_STEP);
      const mtCum = [];
      let mtRun = 0;
      for (const s of mtSteps) { mtRun += s; mtCum.push(mtRun); }

      gasHedges.forEach((h, i) => {
        const rowNum = HEADER_ROW + 1 + i;
        const r = ws.getRow(rowNum);
        r.getCell(1).value = i + 1;
        r.getCell(2).value = new Date(h.date + 'T00:00:00Z');
        // C/D — cumulative allocation %, user-editable.
        r.getCell(3).value = arbCum[i];
        r.getCell(4).value = mtCum[i];
        // E/F — per-tranche volume = total × cumulative delta. First row
        // is just total × C{first} since there's no prior row to subtract.
        r.getCell(5).value = i === 0
          ? { formula: `${TOTAL_VOLUME}*C${rowNum}`, result: TOTAL_VOLUME * arbCum[0] }
          : { formula: `${TOTAL_VOLUME}*(C${rowNum}-C${rowNum - 1})`, result: TOTAL_VOLUME * ARB_STEP };
        r.getCell(6).value = i === 0
          ? { formula: `${TOTAL_VOLUME}*D${rowNum}`, result: TOTAL_VOLUME * mtCum[0] }
          : { formula: `${TOTAL_VOLUME}*(D${rowNum}-D${rowNum - 1})`, result: TOTAL_VOLUME * mtSteps[i] };
        r.getCell(7).value = h.price;
        r.getCell(8).value = 0;
        // Cost = volume × (forward price + adder). Same formula shape
        // for both strategies; the difference is which volume column
        // they reference.
        r.getCell(9).value  = { formula: `E${rowNum}*(G${rowNum}+H${rowNum})`, result: TOTAL_VOLUME * ARB_STEP * h.price };
        r.getCell(10).value = { formula: `F${rowNum}*(G${rowNum}+H${rowNum})`, result: TOTAL_VOLUME * mtSteps[i] * h.price };
        r.getCell(11).value = { formula: `I${rowNum}-J${rowNum}`, result: (ARB_STEP - mtSteps[i]) * TOTAL_VOLUME * h.price };
        // Helper columns for the savings chart's stacked-area shading.
        // U is the invisible base (MIN of forward vs long-run average);
        // V is the green band (positive when forward sits below average,
        // i.e. a favorable buying window). W carries the long-run
        // average as a horizontal reference line.
        r.getCell(21).value = { formula: `MIN(G${rowNum},$W$${rowNum})`, result: Math.min(h.price, avgPrice) };
        r.getCell(22).value = { formula: `MAX($W$${rowNum}-G${rowNum},0)`, result: Math.max(avgPrice - h.price, 0) };
        r.getCell(23).value = { formula: `AVERAGE($G$${HEADER_ROW + 1}:$G$${HEADER_ROW + gasHedges.length})`, result: avgPrice };
        r.getCell(21).numFmt = '"$"0.00';
        r.getCell(22).numFmt = '"$"0.00';
        r.getCell(23).numFmt = '"$"0.00';

        for (let ci = 1; ci <= 11; ci++) {
          const c = r.getCell(ci);
          c.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
          c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
          c.border = {
            bottom: { style: 'hair', color: { argb: SE_BORDER } },
            right:  { style: 'hair', color: { argb: SE_BORDER } },
          };
        }
        r.getCell(2).numFmt = 'm/d/yyyy';
        r.getCell(3).numFmt = '0.00%';
        r.getCell(4).numFmt = '0.00%';
        r.getCell(5).numFmt = '#,##0';
        r.getCell(6).numFmt = '#,##0';
        r.getCell(7).numFmt = '"$"0.00';
        r.getCell(8).numFmt = '"$"0.00';
        r.getCell(9).numFmt  = '"$"#,##0';
        r.getCell(10).numFmt = '"$"#,##0';
        r.getCell(11).numFmt = '"$"#,##0;[Red]("$"#,##0)';

        // Yellow editable cells: both cumulative allocation columns
        // plus forward price + adder.
        for (const col of [3, 4, 7, 8]) {
          const c = r.getCell(col);
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INPUT_FILL } };
        }
        r.height = 20;
      });

      const FIRST_DATA_ROW = HEADER_ROW + 1;
      const TOTAL_ROW = FIRST_DATA_ROW + gasHedges.length;
      const LAST_DATA_ROW = TOTAL_ROW - 1;
      const dataRange = (col) => `${col}${FIRST_DATA_ROW}:${col}${LAST_DATA_ROW}`;
      const sumArbCost = gasHedges.reduce((s, h) => s + h.price * ARB_STEP * TOTAL_VOLUME, 0);
      const sumMtCost = gasHedges.reduce((s, h, i) => s + h.price * mtSteps[i] * TOTAL_VOLUME, 0);
      const tr = ws.getRow(TOTAL_ROW);
      tr.getCell(2).value = 'TOTAL';
      tr.getCell(3).value = { formula: `C${LAST_DATA_ROW}`, result: 1.0 };
      tr.getCell(4).value = { formula: `D${LAST_DATA_ROW}`, result: 1.0 };
      tr.getCell(5).value = { formula: `SUM(${dataRange('E')})`, result: TOTAL_VOLUME };
      tr.getCell(6).value = { formula: `SUM(${dataRange('F')})`, result: TOTAL_VOLUME };
      // Volume-weighted average forward price + adder so the totals row
      // reads as "$ per Dth across the portfolio" rather than a flat
      // mean across the months.
      tr.getCell(7).value = { formula: `SUMPRODUCT(${dataRange('G')},${dataRange('E')})/${`E${TOTAL_ROW}`}`, result: avgPrice };
      tr.getCell(8).value = { formula: `SUMPRODUCT(${dataRange('H')},${dataRange('E')})/${`E${TOTAL_ROW}`}`, result: 0 };
      tr.getCell(9).value  = { formula: `SUM(${dataRange('I')})`, result: sumArbCost };
      tr.getCell(10).value = { formula: `SUM(${dataRange('J')})`, result: sumMtCost };
      tr.getCell(11).value = { formula: `SUM(${dataRange('K')})`, result: sumArbCost - sumMtCost };
      for (let ci = 1; ci <= 11; ci++) {
        const c = tr.getCell(ci);
        c.font = { name: 'Nunito Sans', size: 11, bold: true, color: { argb: SE_TEXT_DARK } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        c.border = {
          top:    { style: 'thin', color: { argb: SE_GREEN_DARK } },
          bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } },
        };
      }
      tr.getCell(3).numFmt = '0.00%';
      tr.getCell(4).numFmt = '0.00%';
      tr.getCell(5).numFmt = '#,##0';
      tr.getCell(6).numFmt = '#,##0';
      tr.getCell(7).numFmt = '"$"0.00';
      tr.getCell(8).numFmt = '"$"0.00';
      tr.getCell(9).numFmt = '"$"#,##0';
      tr.getCell(10).numFmt = '"$"#,##0';
      tr.getCell(11).numFmt = '"$"#,##0;[Red]("$"#,##0)';
      tr.height = 26;

      // Forward-price color flips against the long-run average (col W).
      // Green when the forward sits below the average → favorable
      // buying window; red when it sits above → market timing pulls
      // back. Comparison is against the per-row $W reference (a
      // constant equal to AVERAGE(G:G)) so the cells recolor whenever
      // the user edits the forward curve.
      ws.addConditionalFormatting({
        ref: `G${FIRST_DATA_ROW}:G${LAST_DATA_ROW}`,
        rules: [
          {
            type: 'cellIs', operator: 'lessThan', formulae: [`$W$${FIRST_DATA_ROW}`], priority: 1,
            style: {
              fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFDCFCE7' } },
              font: { color: { argb: 'FF166534' }, bold: true },
            },
          },
          {
            type: 'cellIs', operator: 'greaterThanOrEqual', formulae: [`$W$${FIRST_DATA_ROW}`], priority: 2,
            style: {
              fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFEE2E2' } },
              font: { color: { argb: 'FF991B1B' }, bold: true },
            },
          },
        ],
      });

      ws.addConditionalFormatting({
        ref: `K${FIRST_DATA_ROW}:K${LAST_DATA_ROW}`,
        rules: [{
          type: 'dataBar',
          cfvo: [{ type: 'num', value: -5000 }, { type: 'num', value: 5000 }],
          color: { argb: 'FF22C55E' },
          showValue: true,
          gradient: false,
        }],
      });

      // Result block — year × {Arbitrary, Market-Timed, Delta}. Each
      // value cell is a live SUM over the bucket's I / J / K slice so
      // the grid updates whenever the user edits the tranche inputs.
      const RESULT_HEADER_ROW = HEADER_ROW;
      const resultHeaders = ['Year', 'Arbitrary', 'Market-Timed', 'Delta'];
      const hr2 = ws.getRow(RESULT_HEADER_ROW);
      resultHeaders.forEach((h, i) => {
        const c = hr2.getCell(RESULT_FIRST_COL + i);
        c.value = h;
        c.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
        c.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'right', wrapText: true, indent: 1 };
        c.border = { bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } } };
      });

      const MONTHS_PER_YEAR = 12;
      const buckets = [];
      for (let start = 0; start < gasHedges.length; start += MONTHS_PER_YEAR) {
        const slice = gasHedges.slice(start, start + MONTHS_PER_YEAR);
        let arb = 0;
        let mt = 0;
        for (let k = 0; k < slice.length; k++) {
          arb += slice[k].price * ARB_STEP * TOTAL_VOLUME;
          mt += slice[k].price * mtSteps[start + k] * TOTAL_VOLUME;
        }
        buckets.push({
          label: `Year ${buckets.length + 1}`,
          firstRow: FIRST_DATA_ROW + start,
          lastRow: FIRST_DATA_ROW + start + slice.length - 1,
          arb,
          mt,
        });
      }

      buckets.forEach((bucket, i) => {
        const rowIdx = RESULT_HEADER_ROW + 1 + i;
        const row = ws.getRow(rowIdx);
        const rangeI = `$I$${bucket.firstRow}:$I$${bucket.lastRow}`;
        const rangeJ = `$J$${bucket.firstRow}:$J$${bucket.lastRow}`;
        const rangeK = `$K$${bucket.firstRow}:$K$${bucket.lastRow}`;
        const yearCell = row.getCell(RESULT_FIRST_COL);
        yearCell.value = bucket.label;
        const arbCell = row.getCell(RESULT_FIRST_COL + 1);
        arbCell.value = { formula: `SUM(${rangeI})`, result: bucket.arb };
        const mtCell = row.getCell(RESULT_FIRST_COL + 2);
        mtCell.value = { formula: `SUM(${rangeJ})`, result: bucket.mt };
        const deltaCell = row.getCell(RESULT_FIRST_COL + 3);
        deltaCell.value = { formula: `SUM(${rangeK})`, result: bucket.arb - bucket.mt };
        for (let ci = 0; ci < 4; ci++) {
          const c = row.getCell(RESULT_FIRST_COL + ci);
          c.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
          c.alignment = { vertical: 'middle', horizontal: ci === 0 ? 'left' : 'right', indent: 1 };
          c.border = { bottom: { style: 'hair', color: { argb: SE_BORDER } } };
        }
        arbCell.numFmt = '"$"#,##0';
        mtCell.numFmt = '"$"#,##0';
        deltaCell.numFmt = '"$"#,##0;[Red]("$"#,##0)';
        row.height = 20;
      });

      const yearTotalRowIdx = RESULT_HEADER_ROW + 1 + buckets.length;
      const yearTotalRow = ws.getRow(yearTotalRowIdx);
      const totArbDefault = buckets.reduce((s, b) => s + b.arb, 0);
      const totMtDefault = buckets.reduce((s, b) => s + b.mt, 0);
      yearTotalRow.getCell(RESULT_FIRST_COL).value = 'TOTAL';
      const totArbCell = yearTotalRow.getCell(RESULT_FIRST_COL + 1);
      totArbCell.value = { formula: `SUM($I$${FIRST_DATA_ROW}:$I$${LAST_DATA_ROW})`, result: totArbDefault };
      const totMtCell = yearTotalRow.getCell(RESULT_FIRST_COL + 2);
      totMtCell.value = { formula: `SUM($J$${FIRST_DATA_ROW}:$J$${LAST_DATA_ROW})`, result: totMtDefault };
      const totDeltaCell = yearTotalRow.getCell(RESULT_FIRST_COL + 3);
      totDeltaCell.value = { formula: `K${TOTAL_ROW}`, result: totArbDefault - totMtDefault };
      for (let ci = 0; ci < 4; ci++) {
        const c = yearTotalRow.getCell(RESULT_FIRST_COL + ci);
        c.font = { name: 'Nunito Sans', size: 11, bold: true, color: { argb: SE_GREEN_DARK } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
        c.alignment = { vertical: 'middle', horizontal: ci === 0 ? 'left' : 'right', indent: 1 };
        c.border = {
          top: { style: 'thin', color: { argb: SE_GREEN_DARK } },
          bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } },
        };
      }
      totArbCell.numFmt = '"$"#,##0';
      totMtCell.numFmt = '"$"#,##0';
      totDeltaCell.numFmt = '"$"#,##0;[Red]("$"#,##0)';
      yearTotalRow.height = 26;

      // Hide chart-helper columns U / V / W so they don't clutter the
      // sheet but stay live for the chart (plotVisOnly=0 in the chart
      // XML lets Excel keep plotting hidden ranges).
      ws.getColumn(21).hidden = true;
      ws.getColumn(22).hidden = true;
      ws.getColumn(23).hidden = true;

      // Y-axis bounds for the cumulative allocation chart — 10 pp above
      // the highest and 10 pp below the lowest, clamped at 0. Both
      // strategies converge at 100 % by the last row so max is always
      // ≥1.0.
      const allocValues = arbCum.concat(mtCum);
      const minAlloc = Math.min(...allocValues);
      const maxAlloc = Math.max(...allocValues);
      const PAD = 0.10;
      gasTimingChartRange = {
        firstRow: FIRST_DATA_ROW,
        lastRow: LAST_DATA_ROW,
        allocYMin: Math.max(0, minAlloc - PAD),
        allocYMax: maxAlloc + PAD,
      };
    }

    // ---- Floating vs Hedging Example sheet --------------------------
    // Interactive comparison of a fully-hedged annual contract vs a
    // pure float (index / spot) buy across 12 months. Inputs (yellow
    // cells): Annual Volume (E4), 100 % Hedged Price (H4), per-month
    // Load % (column C), per-month Spot Price (column E). Every other
    // column is an Excel formula so edits update live.
    {
      const ws = wb.addWorksheet('Floating vs Hedging Example', {
        // Hidden by default — supporting illustrative tab, surfaced only
        // when a reader unhides it.
        state: 'hidden',
        properties: { tabColor: { argb: SE_GREEN_DARK } },
        views: [{ showGridLines: false }],
      });

      const COLS = 9;
      const widths = [6, 14, 11, 14, 18, 18, 16, 16, 20];
      // Pad with a small spacer + chart-area columns so the chart
      // image (anchored at col 9.3) sits over right-sized cells
      // instead of Excel's default-narrow columns.
      const chartAreaWidths = [3, 12, 12, 12, 12, 12, 12, 12, 12, 12];
      ws.columns = [...widths, ...chartAreaWidths].map(w => ({ width: w }));

      const INPUT_FILL = 'FFFFF9C3';
      const INPUT_BORDER = 'FFCA8A04';
      const inputBorder = {
        top:    { style: 'thin', color: { argb: INPUT_BORDER } },
        bottom: { style: 'thin', color: { argb: INPUT_BORDER } },
        left:   { style: 'thin', color: { argb: INPUT_BORDER } },
        right:  { style: 'thin', color: { argb: INPUT_BORDER } },
      };

      ws.mergeCells(1, 1, 1, COLS);
      const title = ws.getCell(1, 1);
      title.value = 'Floating vs Hedging: Interactive Example';
      title.font = { name: 'Nunito Sans', bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
      title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
      title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(1).height = 30;

      ws.mergeCells(2, 1, 2, COLS);
      const sub = ws.getCell(2, 1);
      sub.value = 'Edit the yellow cells (Annual Volume on E4, 100 % Hedged Price on H4, plus per-month Load % in column C and Spot Price in column E) to model your portfolio. Load MWh / Float Cost / Hedge Cost / Saving and the totals + Result block are Excel formulas: they update live as inputs change. Positive Saving = floating the market beats locking 100 % at the hedged price.';
      sub.font = { name: 'Nunito Sans', italic: true, size: 10, color: { argb: SE_SLATE } };
      sub.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
      ws.getRow(2).height = 58;

      ws.mergeCells(3, 1, 3, COLS);
      const sh0 = ws.getCell(3, 1);
      sh0.value = 'Inputs (edit yellow cells)';
      sh0.font = { name: 'Nunito Sans', bold: true, size: 12, color: { argb: SE_GREEN_DARK } };
      sh0.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
      sh0.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(3).height = 22;

      ws.mergeCells(4, 1, 4, 4);
      ws.getCell(4, 1).value = 'Annual Volume (MWh)';
      ws.getCell(4, 1).font = { name: 'Nunito Sans', bold: true, size: 11, color: { argb: SE_SLATE } };
      ws.getCell(4, 1).alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
      const volInput = ws.getCell('E4');
      volInput.value = 100000;
      volInput.numFmt = '#,##0';
      volInput.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INPUT_FILL } };
      volInput.font = { name: 'Nunito Sans', bold: true, size: 11, color: { argb: SE_TEXT_DARK } };
      volInput.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
      volInput.border = inputBorder;

      ws.mergeCells(4, 6, 4, 7);
      ws.getCell(4, 6).value = '100 % Hedged Price ($/MWh)';
      ws.getCell(4, 6).font = { name: 'Nunito Sans', bold: true, size: 11, color: { argb: SE_SLATE } };
      ws.getCell(4, 6).alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
      const hedgeInput = ws.getCell('H4');
      hedgeInput.value = 75.00;
      hedgeInput.numFmt = '"$"0.00';
      hedgeInput.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INPUT_FILL } };
      hedgeInput.font = { name: 'Nunito Sans', bold: true, size: 11, color: { argb: SE_TEXT_DARK } };
      hedgeInput.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
      hedgeInput.border = inputBorder;
      ws.getRow(4).height = 22;

      ws.mergeCells(5, 1, 5, COLS);
      const sh1 = ws.getCell(5, 1);
      sh1.value = '12 Months: Float vs Hedge';
      sh1.font = { name: 'Nunito Sans', bold: true, size: 12, color: { argb: SE_GREEN_DARK } };
      sh1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
      sh1.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(5).height = 22;

      const headers = [
        '#', 'Month', 'Load %', 'Load (MWh)',
        'Spot Price ($/MWh)', 'Hedged ($/MWh)',
        'Float Cost', 'Hedge Cost', 'Saving vs Hedge',
      ];
      const hr = ws.getRow(6);
      headers.forEach((h, i) => {
        const c = hr.getCell(i + 1);
        c.value = h;
        c.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
        c.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
        c.border = { bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } } };
      });
      hr.height = 32;

      // Default monthly shape — flat 1/12 load so the example focuses
      // on the price story, plus a plausible winter-peak / summer-peak
      // spot curve that averages ~$72.67 → ~3 % savings vs the $75
      // hedge default. Users edit either column to model their
      // portfolio's actual seasonality + price expectations.
      const months = [
        { label: 'Jan', spot: 84.00 },
        { label: 'Feb', spot: 82.00 },
        { label: 'Mar', spot: 68.00 },
        { label: 'Apr', spot: 63.00 },
        { label: 'May', spot: 60.00 },
        { label: 'Jun', spot: 65.00 },
        { label: 'Jul', spot: 78.00 },
        { label: 'Aug', spot: 80.00 },
        { label: 'Sep', spot: 72.00 },
        { label: 'Oct', spot: 66.00 },
        { label: 'Nov', spot: 74.00 },
        { label: 'Dec', spot: 80.00 },
      ];
      const loadPct = 1 / 12;

      months.forEach((m, i) => {
        const rowNum = 7 + i;
        const r = ws.getRow(rowNum);
        r.getCell(1).value = i + 1;
        r.getCell(2).value = m.label;
        r.getCell(3).value = loadPct;
        r.getCell(4).value = { formula: `$E$4*C${rowNum}`, result: 100000 * loadPct };
        r.getCell(5).value = m.spot;
        r.getCell(6).value = { formula: '$H$4', result: 75 };
        r.getCell(7).value = { formula: `D${rowNum}*E${rowNum}`, result: 100000 * loadPct * m.spot };
        r.getCell(8).value = { formula: `D${rowNum}*F${rowNum}`, result: 100000 * loadPct * 75 };
        // Saving = Hedge Cost - Float Cost (positive = floating wins).
        r.getCell(9).value = { formula: `H${rowNum}-G${rowNum}`, result: 100000 * loadPct * (75 - m.spot) };
        // Helper columns U (21) and V (22) feed the chart's
        // stacked-area "savings shading" between spot and hedge:
        //   U = MIN(spot, hedge)    — invisible base of the stack
        //   V = MAX(hedge - spot, 0) — the green band, only present
        //                              when hedge sits above spot
        // The columns are hidden (see below); the chart references
        // them and renders the area via plotVisOnly=0.
        r.getCell(21).value = { formula: `MIN(E${rowNum},F${rowNum})`, result: Math.min(m.spot, 75) };
        r.getCell(22).value = { formula: `MAX(F${rowNum}-E${rowNum},0)`, result: Math.max(75 - m.spot, 0) };
        r.getCell(21).numFmt = '"$"0.00';
        r.getCell(22).numFmt = '"$"0.00';

        for (let ci = 1; ci <= COLS; ci++) {
          const c = r.getCell(ci);
          c.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
          c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
          c.border = {
            bottom: { style: 'hair', color: { argb: SE_BORDER } },
            right:  { style: 'hair', color: { argb: SE_BORDER } },
          };
        }
        r.getCell(3).numFmt = '0.00%';
        r.getCell(4).numFmt = '#,##0';
        r.getCell(5).numFmt = '"$"0.00';
        r.getCell(6).numFmt = '"$"0.00';
        r.getCell(7).numFmt = '"$"#,##0';
        r.getCell(8).numFmt = '"$"#,##0';
        r.getCell(9).numFmt = '"$"#,##0;[Red]("$"#,##0)';

        // Mark the editable cells (Load % + Spot Price) yellow.
        for (const col of [3, 5]) {
          const c = r.getCell(col);
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INPUT_FILL } };
        }
        r.height = 20;
      });

      // Hide the chart-helper columns U + V so they don't clutter the
      // sheet but stay live for the chart (plotVisOnly=0 in the chart
      // XML lets Excel keep plotting hidden ranges).
      ws.getColumn(21).hidden = true;
      ws.getColumn(22).hidden = true;

      // Totals row at 19. Blended float price is the weighted avg
      // (total float cost / total load MWh).
      const tr = ws.getRow(19);
      tr.getCell(2).value = 'TOTAL';
      tr.getCell(3).value = { formula: 'SUM(C7:C18)', result: 1.0 };
      tr.getCell(4).value = { formula: 'SUM(D7:D18)', result: 100000 };
      tr.getCell(5).value = { formula: 'G19/D19', result: 72.67 };
      tr.getCell(6).value = { formula: '$H$4', result: 75 };
      tr.getCell(7).value = { formula: 'SUM(G7:G18)', result: 7266667 };
      tr.getCell(8).value = { formula: 'SUM(H7:H18)', result: 7500000 };
      tr.getCell(9).value = { formula: 'SUM(I7:I18)', result: 233333 };
      for (let ci = 1; ci <= COLS; ci++) {
        const c = tr.getCell(ci);
        c.font = { name: 'Nunito Sans', size: 11, bold: true, color: { argb: SE_TEXT_DARK } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        c.border = {
          top:    { style: 'thin', color: { argb: SE_GREEN_DARK } },
          bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } },
        };
      }
      tr.getCell(3).numFmt = '0.00%';
      tr.getCell(4).numFmt = '#,##0';
      tr.getCell(5).numFmt = '"$"0.00';
      tr.getCell(6).numFmt = '"$"0.00';
      tr.getCell(7).numFmt = '"$"#,##0';
      tr.getCell(8).numFmt = '"$"#,##0';
      tr.getCell(9).numFmt = '"$"#,##0;[Red]("$"#,##0)';
      tr.height = 26;

      // Spot-vs-Hedge color: green when spot is below the hedged
      // price (floating wins that month), red when spot is above
      // (hedge wins). Compares column E to column F.
      ws.addConditionalFormatting({
        ref: 'E7:E18',
        rules: [
          {
            type: 'cellIs', operator: 'lessThan', formulae: ['F7'], priority: 1,
            style: {
              fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFDCFCE7' } },
              font: { color: { argb: 'FF166534' }, bold: true },
            },
          },
          {
            type: 'cellIs', operator: 'greaterThanOrEqual', formulae: ['F7'], priority: 2,
            style: {
              fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFEE2E2' } },
              font: { color: { argb: 'FF991B1B' }, bold: true },
            },
          },
        ],
      });

      // Data-bar on the Savings column (negative = hedge wins that
      // month, positive = floating wins). Centered on zero.
      ws.addConditionalFormatting({
        ref: 'I7:I18',
        rules: [{
          type: 'dataBar',
          cfvo: [{ type: 'num', value: -100000 }, { type: 'num', value: 100000 }],
          color: { argb: 'FF22C55E' },
          showValue: true,
          gradient: false,
        }],
      });

      ws.mergeCells(21, 1, 21, COLS);
      const rh = ws.getCell(21, 1);
      rh.value = 'Result';
      rh.font = { name: 'Nunito Sans', bold: true, size: 12, color: { argb: SE_GREEN_DARK } };
      rh.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
      rh.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(21).height = 22;

      const stats = [
        { label: 'Blended Float Price', formula: 'G19/D19', result: 72.67, fmt: '"$"0.00" / MWh"' },
        { label: '100 % Hedged Price', formula: '$H$4', result: 75, fmt: '"$"0.00" / MWh"' },
        { labelFormula: '"Total Float Cost ("&TEXT(D19,"#,##0")&" MWh)"', labelFallback: 'Total Float Cost', formula: 'G19', result: 7266667, fmt: '"$"#,##0' },
        { labelFormula: '"Total Hedge Cost ("&TEXT(D19,"#,##0")&" MWh)"', labelFallback: 'Total Hedge Cost', formula: 'H19', result: 7500000, fmt: '"$"#,##0' },
        { label: 'Saving (Float vs Hedge)', valueFormula: 'TEXT(I19,"$#,##0")&"   ("&TEXT(I19/H19,"0.00%")&")"', result: '$233,333   (3.11%)' },
      ];
      stats.forEach((s, i) => {
        const rowIdx = 22 + i;
        ws.mergeCells(rowIdx, 1, rowIdx, 4);
        ws.mergeCells(rowIdx, 5, rowIdx, COLS);
        const row = ws.getRow(rowIdx);
        const labelCell = row.getCell(1);
        const valCell = row.getCell(5);
        if (s.labelFormula) {
          labelCell.value = { formula: s.labelFormula, result: s.labelFallback };
        } else {
          labelCell.value = s.label;
        }
        if (s.valueFormula) {
          valCell.value = { formula: s.valueFormula, result: s.result };
        } else if (s.formula) {
          valCell.value = { formula: s.formula, result: s.result };
          if (s.fmt) valCell.numFmt = s.fmt;
        } else {
          valCell.value = s.result;
        }
        const isHighlight = i === stats.length - 1;
        labelCell.font = {
          name: 'Nunito Sans',
          size: isHighlight ? 12 : 11,
          bold: isHighlight,
          color: { argb: isHighlight ? SE_GREEN_DARK : SE_SLATE },
        };
        labelCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        valCell.font = {
          name: 'Nunito Sans',
          size: isHighlight ? 14 : 11,
          bold: isHighlight,
          color: { argb: isHighlight ? SE_GREEN_DARK : SE_TEXT_DARK },
        };
        valCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        if (isHighlight) {
          labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
          valCell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
        }
        row.height = isHighlight ? 30 : 20;
      });

      ws.mergeCells(28, 1, 28, COLS);
      const wh = ws.getCell(28, 1);
      wh.value = 'When floating wins: and when it doesn\'t';
      wh.font = { name: 'Nunito Sans', bold: true, size: 12, color: { argb: SE_GREEN_DARK } };
      wh.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
      wh.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(28).height = 22;

      const floatBullets = [
        'Floating pays the spot / index price every month: when the curve averages below the hedge price, that gap compounds across the year into the Saving figure above. The 100 % hedge locks the price at H4 regardless of where the market actually settles.',
        'Edit column C to weight months by your real load shape: a winter-peaking gas portfolio pays more for the January and February spot cells than a flat MWh assumption, which can flip the answer.',
        'Edit column E to model curve scenarios: a low-summer / high-winter shape (heating-led demand), an industrial flat curve, or a stressed winter where spot blows past the hedge for two months. Green spot cells beat the hedge, red cells lag.',
        'Reality is between the two extremes. Most portfolios use this comparison to decide a layered-hedge ratio (e.g. 60 / 40 hedged-to-float): see the Hedging Analysis tab for the layered approach.',
      ];
      floatBullets.forEach((b, i) => {
        const rowIdx = 29 + i;
        ws.mergeCells(rowIdx, 1, rowIdx, COLS);
        const cell = ws.getCell(rowIdx, 1);
        cell.value = `•  ${b}`;
        cell.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
        ws.getRow(rowIdx).height = 36;
      });

      // Native Excel line chart of Spot vs Hedge — injected after the
      // workbook is written (ExcelJS has no chart API). The chart
      // references the live cell ranges below, so edits to the yellow
      // input cells recompute the curve in Excel. See the
      // injectLiveLineChart call below.
    }

    // ---- Methodology sheet ------------------------------------------
    // Three stacked sections on a single sheet:
    //   1. Energy estimation methodology + the per-property-type
    //      reference consumption table (electric kWh, gas Dth, etc.).
    //   2. Account-number estimation methodology + the per-property-type
    //      expected utility-account counts.
    //   3. Country deregulation reference — every country's electric /
    //      gas / power-rate-optimization bucket.
    // No links to any other tab — read-only reference.
    {
      const ws = wb.addWorksheet('Methodology', {
        properties: { tabColor: { argb: SE_GREEN_DARK } },
        views: [{ showGridLines: false, state: 'frozen', ySplit: 1 }],
        // Hidden by default so the workbook opens on the headline
        // sheets. The user can right-click any visible tab → Unhide
        // → Methodology to see the reference tables when needed.
        state: 'hidden',
      });
      // 15 columns wide: the three reference sections use columns 1–10
      // (the energy table's per-ft² intensity columns run out to 10),
      // and the per-site Property Type Estimates section (section 4)
      // uses all 15. Title band + section banners merge across COLS so
      // they span the full width of the widest section.
      const COLS = 15;
      ws.columns = [38, 13, 17, 19, 17, 21, 24, 18, 22, 24, 13, 13, 14, 14, 13].map(w => ({ width: w }));

      let r = 1;

      // Row 1 — title band
      ws.mergeCells(r, 1, r, COLS);
      const title = ws.getCell(r, 1);
      title.value = 'Methodology & Reference Data';
      title.font = { name: 'Nunito Sans', bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
      title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
      title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(r).height = 30;
      r += 1;

      // Helpers — section banner, subtle paragraph, header row, data row.
      const sectionBanner = (text) => {
        ws.mergeCells(r, 1, r, COLS);
        const c = ws.getCell(r, 1);
        c.value = text;
        c.font = { name: 'Nunito Sans', bold: true, size: 13, color: { argb: SE_GREEN_DARK } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
        c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        ws.getRow(r).height = 24;
        r += 1;
      };
      const paragraph = (text) => {
        ws.mergeCells(r, 1, r, COLS);
        const c = ws.getCell(r, 1);
        c.value = text;
        c.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
        c.alignment = { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 };
        ws.getRow(r).height = Math.max(28, Math.min(110, Math.ceil(String(text).length / 110) * 16));
        r += 1;
      };
      const blank = () => { r += 1; };
      const headerRow = (labels) => {
        labels.forEach((label, i) => {
          const c = ws.getCell(r, i + 1);
          c.value = label;
          c.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
          c.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
          c.border = { bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } } };
        });
        ws.getRow(r).height = 28;
        r += 1;
      };
      const dataRow = (vals, numFmts) => {
        vals.forEach((v, i) => {
          const c = ws.getCell(r, i + 1);
          c.value = v === '' || v == null ? ' ' : v;
          c.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
          c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
          c.border = {
            bottom: { style: 'hair', color: { argb: SE_BORDER } },
            right:  { style: 'hair', color: { argb: SE_BORDER } },
          };
          if (numFmts && numFmts[i]) c.numFmt = numFmts[i];
        });
        ws.getRow(r).height = 18;
        r += 1;
      };

      // ---- Section 1: Energy estimation methodology ----
      sectionBanner('1. Energy Consumption Estimates');
      paragraph('Annual electric (kWh) and gas (Dth / kWh-equivalent) numbers are derived from a per-property-type reference profile. Each property type carries representative annual usage anchored to a reference square-footage. When a site\'s actual Size_ft² is provided, the reference values are scaled linearly: scaledValue = referenceValue × (actualSize / referenceSize). Sites without a size fall back to the reference values. Land and Debt property types have no consumption profile and are skipped. The last three columns restate the profile per square foot (reference consumption ÷ reference size). Because the scaling is linear these intensities hold for a site of any size, which is what the Site Detail tab benchmarks each building\'s measured kWh/ft² and Dth/ft² against. Total intensity converts gas at 293.07 kWh per Dth.');
      blank();
      headerRow([
        'Property Type', 'Category', 'Reference Size (ft²)',
        'Electric (kWh / yr)', 'Gas (Dth / yr)', 'Gas: kWh Equivalent', 'Total (kWh / yr)',
        'Electric Intensity (kWh / ft²)', 'Gas Intensity (Dth / ft²)', 'Total Intensity (kWh / ft²)',
      ]);
      const consumptionRows = Object.entries(CONSUMPTION_ESTIMATES)
        .filter(([, v]) => v.electricKwh != null)
        .sort((a, b) => (b[1].totalKwh || 0) - (a[1].totalKwh || 0));
      consumptionRows.forEach(([name]) => {
        const v = CONSUMPTION_ESTIMATES[name];
        // Per-ft² form of the same three numbers. Because the scaling is
        // linear these intensities apply to a site of any size, which is
        // what lets the Site Detail sheet hold a real building's kWh/ft²
        // against them.
        const i = propertyTypeIntensity(name);
        dataRow(
          [name, v.category, v.sizeFt2, v.electricKwh, v.gasDth, v.gasKwh, v.totalKwh,
            i?.electricKwhPerFt2 ?? '', i?.gasDthPerFt2 ?? '', i?.totalKwhPerFt2 ?? ''],
          [null, null, '#,##0', '#,##0', '#,##0', '#,##0', '#,##0', '#,##0.0', '#,##0.000', '#,##0.0']
        );
      });

      blank();
      blank();

      // ---- Section 2: Account-count methodology ----
      sectionBanner('2. Utility Account Number Estimates');
      paragraph('Per-site utility-account counts (Water / Steam / Gas / Electric / Waste) are looked up by property type from a reference table. "Multiple" is treated as 3 for roll-up totals; "0 – 1" ranges as 0.5. "N/A" cells contribute 0 to totals so they do not skew portfolio sums. The displayed cell preserves the original label ("Multiple", "0 – 1", "N/A") rather than substituting the numeric placeholder.');
      blank();
      headerRow(['Property Type', 'Water', 'Steam', 'Gas', 'Electric', 'Waste', '']);
      const accountRows = Object.entries(ACCOUNT_ESTIMATES);
      accountRows.forEach(([name, v]) => {
        dataRow([name, v.water?.label || '', v.steam?.label || '', v.gas?.label || '', v.electric?.label || '', v.waste?.label || '', '']);
      });

      blank();
      blank();

      // ---- Section 3: Country deregulation reference ----
      sectionBanner('3. Country Deregulation Reference');
      paragraph('Per-country bucket for each commodity. "Deregulated" / "Some deregulation" on Electric Power or Gas opens the commodity-savings motion (2 – 4 % on annual spend): except in European markets, which surface "TBD" rather than a committed range. "Deregulated" / "Some deregulation" on Power Rate Optimization opens the regulated-rate motion (0.25 % on regulated electric spend): the two motions are mutually exclusive per site, so a country whose Electric Power is already deregulated does not also earn reg-rate savings on top. "Unlikely" and "No opportunity" disqualify a country from each motion.');
      blank();
      headerRow(['Country', 'Region', 'Electric Power', 'Gas', 'Power Rate Optimization', '', '']);
      const countryRows = Object.entries(COUNTRY_DEREGULATION)
        .sort((a, b) => {
          const ra = a[1].region || '';
          const rb = b[1].region || '';
          if (ra !== rb) return ra.localeCompare(rb);
          return a[0].localeCompare(b[0]);
        });
      const statusFill = (s) => {
        if (s === 'Deregulated') return 'FFDCFCE7';
        if (s === 'Some deregulation') return 'FFFEF9C3';
        if (s === 'Unlikely') return 'FFFFEDD5';
        if (s === 'No opportunity') return 'FFFEE2E2';
        return null;
      };
      const statusFg = (s) => {
        if (s === 'Deregulated') return 'FF166534';
        if (s === 'Some deregulation') return 'FF92400E';
        if (s === 'Unlikely') return 'FF9A3412';
        if (s === 'No opportunity') return 'FF991B1B';
        return SE_TEXT_DARK;
      };
      countryRows.forEach(([country, v]) => {
        dataRow([country, v.region || '', v.electric || '', v.gas || '', v.powerRateOptimization || '', '', '']);
        // Re-style the three status cells on the just-written row.
        const rowIdx = r - 1;
        [3, 4, 5].forEach((col, k) => {
          const statusVal = [v.electric, v.gas, v.powerRateOptimization][k];
          const fg = statusFill(statusVal);
          if (!fg) return;
          const c = ws.getCell(rowIdx, col);
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fg } };
          c.font = { name: 'Nunito Sans', size: 10, bold: true, color: { argb: statusFg(statusVal) } };
        });
      });

      // Auto-filter on the country table so the reader can slice by
      // region / status without leaving the sheet.
      const countryTableHeaderRow = r - countryRows.length - 1;
      ws.autoFilter = {
        from: { row: countryTableHeaderRow, column: 1 },
        to:   { row: r - 1, column: 5 },
      };

      // ---- Section 4: Indicative savings range by state / province ----
      // The per-jurisdiction savings reference behind the Indicative
      // Savings (Power / Gas) tabs: each deregulated state / province and
      // the savings range applied to its deregulated annual spend. The
      // country-level equivalent lives in section 3 (Deregulated / Some
      // deregulation countries earn the flat 2 – 4 % motion).
      blank();
      blank();
      sectionBanner('4. Indicative Savings Range by State / Province');
      paragraph('Per-state / province deregulation status and the indicative savings range applied to that jurisdiction\'s deregulated annual spend on the Indicative Savings tabs. "Deregulated" markets earn the listed range; "Limited" / "Large load only" markets are surfaced for visibility but resolve to 0 %. States / provinces not listed are treated as regulated and earn no commodity savings. Country-level markets apply a flat 2 – 4 % when the country is Deregulated / Some deregulation (European markets surface "TBD" instead of a committed range): see section 3.');
      blank();

      const savingsStatusLabel = (s) => (s === 'yes' ? 'Deregulated' : s);
      const savingsRefRow = (code, entry) => dataRow(
        [code, savingsStatusLabel(entry.status), entry.range || '', entry.lowPct ?? '', entry.highPct ?? '', '', ''],
        [null, null, null, '0.0%', '0.0%', null, null]
      );

      // Electric power.
      headerRow(['State / Prov (Electric Power)', 'Deregulated Status', 'Indicative Savings Range', 'Low %', 'High %', '', '']);
      Object.entries(ELECTRIC_DEREGULATION)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .forEach(([code, entry]) => savingsRefRow(code, entry));

      blank();

      // Natural gas.
      headerRow(['State / Prov (Natural Gas)', 'Deregulated Status', 'Indicative Savings Range', 'Low %', 'High %', '', '']);
      Object.entries(GAS_DEREGULATION)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .forEach(([code, entry]) => savingsRefRow(code, entry));

      // ---- Section 5: Property Type Estimates (per site) ----
      // The per-site application of the section 1 & 2 reference profiles:
      // estimated annual consumption (scaled by Size_ft² when provided)
      // and expected utility-account counts for each site that carried a
      // recognized property type. Moved here from its own standalone tab.
      if (propertyTypeSiteRows.length > 0) {
        blank();
        blank();
        sectionBanner('5. Property Type Estimates: Per Site');
        paragraph('Per-site application of the reference profiles above: estimated annual consumption (scaled linearly by Size_ft² when provided) and expected utility-account counts. The Total row sums the numeric columns; account labels such as "Multiple" / "0 – 1" / "N/A" map to 3 / 0.5 / 0 for that roll-up while the per-site cell keeps the original label.');
        blank();
        const ptCols = [
          { label: 'Site Name',                     get: (s) => s.siteName },
          { label: 'ST / Prov / Country',           get: (s) => s.state || s.country },
          { label: 'Property Type',                 get: (s) => s.propertyType },
          { label: 'Category',                      get: (s) => s.category },
          { label: 'Size (ft²)',                    get: (s) => s.sizeFt2 ?? '', numFmt: '#,##0' },
          { label: 'Reference Size (ft²)',          get: (s) => s.referenceSizeFt2 ?? '', numFmt: '#,##0' },
          { label: 'Est. Annual Electric (kWh)',    get: (s) => s.electricKwh ?? '', numFmt: '#,##0' },
          { label: 'Est. Annual Gas (Dth)',         get: (s) => s.gasDth ?? '', numFmt: '#,##0' },
          { label: 'Est. Annual Gas (kWh equiv)',   get: (s) => s.gasKwh ?? '', numFmt: '#,##0' },
          { label: 'Est. Total Energy (kWh equiv)', get: (s) => s.totalKwh ?? '', numFmt: '#,##0' },
          { label: 'Water Accounts',    get: (s) => s.accounts?.water?.label ?? '',    sumValue: (s) => s.accounts?.water?.count ?? 0,    numFmt: '0.##' },
          { label: 'Steam Accounts',    get: (s) => s.accounts?.steam?.label ?? '',    sumValue: (s) => s.accounts?.steam?.count ?? 0,    numFmt: '0.##' },
          { label: 'Gas Accounts',      get: (s) => s.accounts?.gas?.label ?? '',      sumValue: (s) => s.accounts?.gas?.count ?? 0,      numFmt: '0.##' },
          { label: 'Electric Accounts', get: (s) => s.accounts?.electric?.label ?? '', sumValue: (s) => s.accounts?.electric?.count ?? 0, numFmt: '0.##' },
          { label: 'Waste Accounts',    get: (s) => s.accounts?.waste?.label ?? '',    sumValue: (s) => s.accounts?.waste?.count ?? 0,    numFmt: '0.##' },
        ];
        // Header row.
        ptCols.forEach((c, i) => {
          const cell = ws.getCell(r, i + 1);
          cell.value = c.label;
          cell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
          cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 };
          cell.border = {
            bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } },
            right:  { style: 'hair', color: { argb: 'FFFFFFFF' } },
          };
        });
        ws.getRow(r).height = 36;
        r += 1;
        // Per-site data rows.
        propertyTypeSiteRows.forEach((s) => {
          ptCols.forEach((c, i) => {
            const cell = ws.getCell(r, i + 1);
            const v = c.get(s);
            cell.value = (v === '' || v == null) ? ' ' : v;
            cell.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
            cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
            if (c.numFmt) cell.numFmt = c.numFmt;
            cell.border = {
              bottom: { style: 'hair', color: { argb: SE_BORDER } },
              right:  { style: 'hair', color: { argb: SE_BORDER } },
            };
          });
          ws.getRow(r).height = 18;
          r += 1;
        });
        // Totals row — "Multiple" counts as 3, "0 – 1" as 0.5, "N/A" as 0.
        ptCols.forEach((c, i) => {
          const cell = ws.getCell(r, i + 1);
          if (i === 0) {
            cell.value = 'Total';
          } else if (c.sumValue) {
            const sum = propertyTypeSiteRows.reduce((a, s) => a + (Number(c.sumValue(s)) || 0), 0);
            cell.value = Math.round(sum * 100) / 100;
          } else if (c.numFmt && c.label.startsWith('Est.')) {
            const sum = propertyTypeSiteRows.reduce((a, s) => {
              const v = c.get(s);
              return a + (Number.isFinite(Number(v)) ? Number(v) : 0);
            }, 0);
            cell.value = Math.round(sum);
          } else {
            cell.value = ' ';
          }
          cell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: SE_GREEN_DARK } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
          cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
          if (c.numFmt) cell.numFmt = c.numFmt;
          cell.border = {
            top:    { style: 'thin', color: { argb: SE_GREEN_DARK } },
            bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } },
          };
        });
        ws.getRow(r).height = 20;
        r += 1;
      }
    }

    // Findings & Recommendations rule catalog. Lists every alert
    // currently wired up — the per-state flags emitted into the
    // electricRows / gasRows arrays plus the portfolio-wide VPPA
    // signal — so the seller can hand the buyer (or themselves) a
    // single page that documents what each alert actually means and
    // when it fires. Independent of this run's results; this is a
    // reference of "what's mapped so far."
    {
      const SE_GREEN = 'FF3DCD58';
      const SE_GREEN_DARK = 'FF009530';
      const SE_GREEN_LIGHT = 'FFE6F7EC';
      const SE_TEXT_DARK = 'FF1E293B';
      const SE_BORDER = 'FFD4DDE1';
      const ws = wb.addWorksheet('Alerts Catalog', {
        properties: { tabColor: { argb: SE_GREEN } },
        views: [{ showGridLines: false, state: 'frozen', ySplit: 3 }],
        // Hidden by default (like the Methodology tab) so the workbook
        // opens on the headline sheets. Right-click any visible tab →
        // Unhide → Alerts Catalog to see the reference list.
        state: 'hidden',
      });
      const COLS = 5;
      ws.columns = [34, 12, 38, 24, 56].map(w => ({ width: w }));

      let r = 1;
      // Row 1 — title band
      ws.mergeCells(r, 1, r, COLS);
      const title = ws.getCell(r, 1);
      title.value = 'Findings & Recommendations: Alert Catalog';
      title.font = { name: 'Nunito Sans', bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
      title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
      title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(r).height = 30;
      r += 1;
      // Row 2 — subtitle paragraph
      ws.mergeCells(r, 1, r, COLS);
      const sub = ws.getCell(r, 1);
      sub.value = 'Every alert below feeds the Findings & Recommendations band at the top of the Indicative Savings sheet. Each row documents the alert name, which commodity it targets, the trigger threshold, and the action it suggests.';
      sub.font = { name: 'Nunito Sans', italic: true, size: 10, color: { argb: 'FF64748B' } };
      sub.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
      ws.getRow(r).height = 32;
      r += 1;
      // Row 3 — column headers
      const headers = ['Alert', 'Commodity', 'Trigger', 'Threshold', 'Recommendation'];
      headers.forEach((h, i) => {
        const c = ws.getCell(r, i + 1);
        c.value = h;
        c.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
        c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
        c.border = {
          top: { style: 'thin', color: { argb: SE_BORDER } },
          bottom: { style: 'thin', color: { argb: SE_BORDER } },
          left: { style: 'thin', color: { argb: SE_BORDER } },
          right: { style: 'thin', color: { argb: SE_BORDER } },
        };
      });
      ws.getRow(r).height = 24;
      r += 1;

      const catalog = [
        {
          alert: 'VPPA opportunity',
          commodity: 'Electric (portfolio)',
          trigger: 'Total North America electric consumption (all US states + Canadian provinces, regulated and deregulated combined)',
          threshold: '> 100,000 MWh / yr',
          action: 'A Virtual PPA should be explored: load is large enough to anchor an off-site renewable contract.',
        },
        {
          alert: 'Risk Management',
          commodity: 'Electric (per state, NAM only)',
          trigger: 'State-level deregulated electric consumption: NAM markets only (US states, Canadian provinces, Mexico); international markets are excluded',
          threshold: '> 10,000 MWh / yr',
          action: 'Risk Management strategy (hedge layering, structured product) should be considered.',
        },
        {
          alert: 'Wholesale Plus',
          commodity: 'Electric (per state)',
          trigger: 'State-level deregulated electric consumption',
          threshold: '> 44,000 MWh / yr',
          action: 'Wholesale Plus structured procurement should be explored: load justifies the product.',
        },
        {
          alert: 'Virginia large-load gating',
          commodity: 'Electric (Virginia)',
          trigger: 'Largest single VA site\'s annual consumption (no aggregation across sites)',
          threshold: '> 45,000 MWh / yr',
          action: 'Site meets Virginia\'s large-load retail-choice threshold and can leave the regulated tariff.',
        },
        {
          alert: 'Limited market (3rd-party supply only)',
          commodity: 'Electric (AZ, MI)',
          trigger: 'Any electric consumption on an AZ or MI site',
          threshold: '> 0 kWh',
          action: 'We can only support these customers when they already hold a third-party supply contract: surface the gating up front.',
        },
        {
          alert: 'Small electric market',
          commodity: 'Electric (per state)',
          trigger: 'State-level deregulated electric spend',
          threshold: '$0 < spend < $1M / yr',
          action: 'Small market: sourcing motion may not pencil out. Flag for review.',
        },
        {
          alert: 'Mexico sourcing opportunity',
          commodity: 'Electric (Mexico)',
          trigger: 'CFE-supplied Mexican site (Baja California / Baja California Sur excluded: separate grid)',
          threshold: '> 6,000,000 kWh / yr',
          action: 'Potential CFE sourcing opportunity: load is large enough to consider Mexican retail choice.',
        },
        {
          alert: 'Low gas spend',
          commodity: 'Natural gas (per state)',
          trigger: 'State-level deregulated gas spend',
          threshold: '$0 < spend < $30K / yr',
          action: 'Consumption might be too low for a gas sourcing motion. Flag for review.',
        },
      ];

      catalog.forEach((row, idx) => {
        const zebra = idx % 2 === 1;
        const cells = [row.alert, row.commodity, row.trigger, row.threshold, row.action];
        cells.forEach((v, i) => {
          const c = ws.getCell(r, i + 1);
          c.value = v;
          c.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK }, bold: i === 0 };
          c.alignment = { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 };
          c.border = {
            top:    { style: 'hair', color: { argb: SE_BORDER } },
            bottom: { style: 'hair', color: { argb: SE_BORDER } },
            left:   { style: 'hair', color: { argb: SE_BORDER } },
            right:  { style: 'hair', color: { argb: SE_BORDER } },
          };
          if (zebra) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
        });
        // Row height tuned to the widest free-text column (Recommendation
        // at 56 chars wide). Bumps up when the wrap would otherwise
        // truncate.
        const longest = Math.max(row.trigger.length, row.action.length);
        ws.getRow(r).height = Math.max(28, Math.ceil(longest / 50) * 16);
        r += 1;
      });
    }

    // Normalize every em dash (—) to a plain hyphen (-) across all
    // populated cells so the exported workbook never shows "—" — titles,
    // banners, table headers, summary lines, and placeholder values all
    // resolve to "-". Runs once over the finished workbook so new strings
    // added anywhere upstream are covered automatically.
    const dashFix = (s) => (typeof s === 'string' ? s.replace(/-/g, '-') : s);
    wb.eachSheet((ws) => {
      ws.eachRow({ includeEmpty: false }, (row) => {
        row.eachCell({ includeEmpty: false }, (cell) => {
          const v = cell.value;
          if (typeof v === 'string') {
            cell.value = dashFix(v);
          } else if (v && typeof v === 'object') {
            if (Array.isArray(v.richText)) {
              v.richText.forEach((run) => { run.text = dashFix(run.text); });
              cell.value = v;
            } else if (typeof v.text === 'string') {
              cell.value = { ...v, text: dashFix(v.text) };
            } else if (typeof v.result === 'string') {
              cell.value = { ...v, result: dashFix(v.result) };
            }
          }
        });
      });
    });

    // Native Excel charts are injected into the written .xlsx buffer
    // (ExcelJS has no chart API). Collect the injection descriptors here
    // and apply them after the workbook is written — in combined-export
    // mode the caller writes the merged workbook and applies these, so the
    // charts land on the same sheets inside the master file.
    const SHEET = 'Floating vs Hedging Example';
    // Combo chart on the Floating vs Hedging Example sheet: a stacked area
    // chart underneath supplies the green "savings" band wherever spot sits
    // below hedge (driven by hidden helper columns U + V), and a line chart
    // on top draws the Spot and Hedge series. Helper data and all series
    // resolve from live cell ranges so the chart recomputes as the user
    // edits the yellow inputs. Y-axis bounds are omitted so Excel
    // autoscales — a spot price beyond the default range expands the chart
    // instead of clipping.
    const chartInjections = [
      {
        sheetName: SHEET,
        title: 'Spot Price Savings vs. Current Hedging Scenario',
        catRef: `'${SHEET}'!$B$7:$B$18`,
        // Area series first → drawn underneath. Index 0 is the invisible
        // base (min of spot/hedge); index 1 is the green savings band
        // (hedge − spot, clipped to ≥0). Both share the category axis.
        areaSeries: [
          { name: '',        valRef: `'${SHEET}'!$U$7:$U$18`, noFill: true },
          { name: 'Savings', valRef: `'${SHEET}'!$V$7:$V$18`, color: '22C55E', alpha: 40000 },
        ],
        lineSeries: [
          { name: 'Spot Price',  color: 'F97316', marker: 'circle', markerSize: 6, valRef: `'${SHEET}'!$E$7:$E$18` },
          { name: '100 % Hedge', color: '1E40AF', dash: 'dash',                    valRef: `'${SHEET}'!$F$7:$F$18` },
        ],
        // The invisible base series would otherwise show up as a blank
        // chip in the legend — strip it.
        hideLegendIndices: [0],
        // ~640 × 340 px (1 px ≈ 9525 EMU), anchored just right of the
        // 9-column data table with a 0.2-col gutter. Row index is 0-based,
        // so row: 5 = Excel row 6.
        anchor: { col: 9, colOff: 190500, row: 5, rowOff: 0, cx: 6096000, cy: 3238500 },
      },
    ];

    // Mirror the same Spot Price Savings vs Current Hedging Scenario
    // chart onto the Hedging Analysis tab so the tranche table has the
    // same visual comparison. Spot = Index Price (col G), Hedge =
    // Current Fixed Price (col F, locked to $H$4), Savings band feeds
    // off hidden helper columns U + V on rows 7..LAST_DATA_ROW. No
    // explicit yMin/yMax → Excel autoscales the Y axis, so any tranche
    // value driven above or below the default range expands the chart
    // range automatically.
    if (hedgingChartRange) {
      const HSHEET = 'Hedging Analysis';
      const { firstRow, lastRow, hedgePctYMin, hedgePctYMax } = hedgingChartRange;
      chartInjections.push({
        sheetName: HSHEET,
        charts: [
          {
            title: 'Spot Price Savings vs. Current Hedging Scenario',
            catRef: `'${HSHEET}'!$B$${firstRow}:$B$${lastRow}`,
            areaSeries: [
              { name: '',        valRef: `'${HSHEET}'!$U$${firstRow}:$U$${lastRow}`, noFill: true },
              { name: 'Savings', valRef: `'${HSHEET}'!$V$${firstRow}:$V$${lastRow}`, color: '22C55E', alpha: 40000 },
            ],
            lineSeries: [
              { name: 'Index Price',          color: 'F97316', marker: 'circle', markerSize: 4, valRef: `'${HSHEET}'!$G$${firstRow}:$G$${lastRow}` },
              { name: 'Current Fixed Price',  color: '1E40AF', dash: 'dash',                    valRef: `'${HSHEET}'!$F$${firstRow}:$F$${lastRow}` },
            ],
            hideLegendIndices: [0],
            // Anchored at Excel col M (0-indexed 12), row 11 (0-indexed
            // 10) — sits below the Year-by-Year result block (rows 3–9)
            // and to the right of the 60-row tranche table. ~720 × 360 px.
            anchor: { col: 12, colOff: 0, row: 10, rowOff: 0, cx: 6858000, cy: 3429000 },
          },
          {
            // % of portfolio hedged over time — cumulative hedge ratio
            // from columns C (Current) and D (Example). The Y axis is
            // zoomed to 10 percentage points above the highest hedge
            // value and 10 below the lowest (clamped at 0). Major unit
            // is forced to 10 % so the new top tick label (e.g. 110 %)
            // actually renders — without it Excel rounds to "nice"
            // intervals and hides the extra padding in invisible
            // whitespace above the 100 % tick. Anchored immediately
            // below the Spot Price chart (row 11 + ~18 default-height
            // rows ≈ row 29).
            title: '% of Portfolio Hedged Over Time',
            catRef: `'${HSHEET}'!$B$${firstRow}:$B$${lastRow}`,
            lineSeries: [
              { name: 'Current Hedge %', color: '1E40AF', dash: 'dash',  valRef: `'${HSHEET}'!$C$${firstRow}:$C$${lastRow}` },
              { name: 'Example Hedge %', color: '22C55E', marker: 'circle', markerSize: 4, valRef: `'${HSHEET}'!$D$${firstRow}:$D$${lastRow}` },
            ],
            yMin: hedgePctYMin,
            yMax: hedgePctYMax,
            yMajorUnit: 0.10,
            numFmt: '0%',
            anchor: { col: 12, colOff: 0, row: 28, rowOff: 0, cx: 6858000, cy: 3429000 },
          },
        ],
      });
    }
    // Mirror the same two-chart layout onto the Gas Market Timing tab:
    // savings shading (forward price vs long-run average) on top, and a
    // cumulative allocation curve per strategy underneath. The savings
    // chart's reference line is the AVERAGE() formula in hidden col W,
    // so it tracks any edits to the forward-price column.
    if (gasTimingChartRange) {
      const GSHEET = 'Gas Market Timing';
      const { firstRow, lastRow, allocYMin, allocYMax } = gasTimingChartRange;
      chartInjections.push({
        sheetName: GSHEET,
        charts: [
          {
            title: 'Forward Curve vs Long-Run Average ($/Dth)',
            catRef: `'${GSHEET}'!$B$${firstRow}:$B$${lastRow}`,
            areaSeries: [
              { name: '',        valRef: `'${GSHEET}'!$U$${firstRow}:$U$${lastRow}`, noFill: true },
              { name: 'Favorable Buy Window', valRef: `'${GSHEET}'!$V$${firstRow}:$V$${lastRow}`, color: '22C55E', alpha: 40000 },
            ],
            lineSeries: [
              { name: 'Forward Price',     color: 'F97316', marker: 'circle', markerSize: 4, valRef: `'${GSHEET}'!$G$${firstRow}:$G$${lastRow}` },
              { name: 'Long-Run Average',  color: '1E40AF', dash: 'dash',                    valRef: `'${GSHEET}'!$W$${firstRow}:$W$${lastRow}` },
            ],
            hideLegendIndices: [0],
            numFmt: '"$"0.00',
            anchor: { col: 12, colOff: 0, row: 10, rowOff: 0, cx: 6858000, cy: 3429000 },
          },
          {
            title: 'Cumulative Allocation % - Market Timing vs 30-Day Buy',
            catRef: `'${GSHEET}'!$B$${firstRow}:$B$${lastRow}`,
            lineSeries: [
              { name: '30-Day Arbitrary Buy', color: '1E40AF', dash: 'dash',                    valRef: `'${GSHEET}'!$C$${firstRow}:$C$${lastRow}` },
              { name: 'Market-Timed Hedge',   color: '22C55E', marker: 'circle', markerSize: 4, valRef: `'${GSHEET}'!$D$${firstRow}:$D$${lastRow}` },
            ],
            yMin: allocYMin,
            yMax: allocYMax,
            yMajorUnit: 0.10,
            numFmt: '0%',
            anchor: { col: 12, colOff: 0, row: 28, rowOff: 0, cx: 6858000, cy: 3429000 },
          },
        ],
      });
    }
    // Name the file after the company when one is available — e.g.
    // "Acme Corp_Indicative Savings Analysis.xlsx". Falls back to a
    // dated generic name when no company name is mapped. A division
    // scope joins the company part, so a one-division export can't be
    // mistaken for the whole portfolio once it leaves the page.
    const exportCompany = sanitizeFileNamePart(
      [deriveExportCompanyName(companyName), activeDivisionLabel()].filter(Boolean).join(' - '),
    );
    const fileName = exportCompany
      ? `${exportCompany}_Indicative Savings Analysis.xlsx`
      : `Indicative Savings Analysis - ${new Date().toISOString().slice(0, 10)}.xlsx`;
    // Combined-export mode: hand the (already-added) sheets and the chart
    // descriptors back so the master export writes the merged workbook once
    // and injects the charts itself.
    if (targetWb) return { chartInjections, fileName };
    let buf = await wb.xlsx.writeBuffer();
    for (const injection of chartInjections) {
      buf = await injectLiveLineChart(buf, injection);
    }
    if (returnBuffer) return { buffer: buf, fileName };
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return null;
  }

  // Master Analysis export: one workbook combining the Utility Lookup
  // exports — Indicative Savings, the Building Compliance report (+ its Site
  // Detail), Corporate Compliance (company footprint + California ops), the
  // Compliance Report Methodology, and the Utility Mapping coverage analysis
  // (% of sites mapped to a known utility, % with utility interval data,
  // mapped and broken out by state). Each builder adds its sheets to a
  // shared ExcelJS workbook; the Indicative Savings native charts are
  // injected after the merged workbook is written (the compliance report's
  // Site Detail is renamed so it doesn't collide with Indicative Savings' own
  // Site Detail). Empty sections still emit their tab so the tab set stays
  // consistent.
  // Adds the two sheets that make an exported workbook re-importable:
  //
  //   Site List    — the uploaded rows with every resolved value baked
  //                  back in (per-row supplier edits, fuzzy-matched
  //                  supplier names, zip-derived state), plus derived
  //                  snapshot columns. Named "Site List" so the upload's
  //                  tab picker auto-selects it on the way back in.
  //   __rt_state__ — hidden single-cell JSON with the page state the
  //                  columns can't carry: the column mapping, vendor
  //                  accept/reject decisions, per-row supplier edits and
  //                  the mapped portfolio company. readRoundTripState
  //                  picks it up; parseAllSheets skips `__` sheets, so
  //                  it never shows up as an importable tab.
  //
  // Written by both the Site List export and the Master Analysis, so a
  // Master Analysis saved to a company can be pulled back onto the page
  // exactly as it left.

  // One flat record per site for the Master Analysis' Divisions tab: the
  // division it belongs to, the ISO / RTO its zip resolves to, its annual
  // consumption, and the two per-site verdicts the tab breaks down — its
  // utility-mapping / interval classification and its building-compliance
  // screening.
  //
  // Consumption travels per site rather than pre-rolled like the savings do,
  // because it needs no per-state table to work out: it is the same
  // __kwh__ / __therms__ every other sheet reports, summed. That also means
  // the consumption section fills in on a portfolio with no utility rates
  // file loaded, where the savings section can't.
  //
  // Both are joined onto `rows` by site id rather than recomputed, so the
  // Divisions tab reports the same answer for a site as the Utility Mapping
  // Site Detail and the Compliance Site Detail sheets do. `compliance` stays
  // null for a site the screening didn't cover — the screening runs on owned
  // buildings by default, and counting a leased site as screened-with-no-
  // mandates would read as a clean bill of health it was never given.
  // classifyMarket's answer as a tri-state boolean: true deregulated, false
  // regulated, null where it couldn't say.
  function marketVerdict(row, commodity) {
    const verdict = classifyMarket(row, commodity);
    if (verdict === 'Deregulated') return true;
    if (verdict === 'Regulated') return false;
    return null;
  }

  function collectDivisionSiteFacts(complianceResults, mappingSiteRows) {
    const mappingById = new Map();
    for (const m of (mappingSiteRows || [])) {
      if (m?.siteId != null) mappingById.set(m.siteId, m);
    }
    const complianceById = new Map();
    for (const c of (complianceResults || [])) {
      if (c?.id != null) complianceById.set(c.id, c);
    }
    return rows.map((r) => {
      const m = mappingById.get(r.id);
      const c = complianceById.get(r.id);
      let compliance = null;
      if (c) {
        let penalty = null;
        for (const cat of CATEGORIES) {
          if (c[cat]?.eligible !== true) continue;
          const p = c[cat].penalty;
          if (typeof p === 'number' && Number.isFinite(p)) penalty = (penalty ?? 0) + p;
        }
        compliance = {
          matched: !!c.matched,
          eligible: Object.fromEntries(CATEGORIES.map(cat => [cat, c[cat]?.eligible === true])),
          penalty,
        };
      }
      // Modelled means the figure came from the property-type estimate
      // rather than off the file — the same test the Site Detail sheet marks
      // its estimated cells with, so the two agree about which numbers are
      // measured.
      const kwh = (typeof r.__kwh__ === 'number' && Number.isFinite(r.__kwh__)) ? r.__kwh__ : null;
      const therms = (typeof r.__therms__ === 'number' && Number.isFinite(r.__therms__)) ? r.__therms__ : null;
      return {
        division: r.__division__ || '',
        iso: r.__iso__?.iso || null,
        mapped: m?.status === 'Mapped',
        interval: m?.intervalData === 'Yes' ? true : (m?.intervalData === 'No' ? false : null),
        compliance,
        energy: {
          kwh,
          therms,
          kwhModelled: kwh != null && !!r.__kwhFromEstimate__,
          thermsModelled: therms != null && !!r.__thermsFromEstimate__,
          // The page's own market classifier, per commodity, so the volume
          // the Divisions tab calls deregulated sits at exactly the sites
          // its Deregulated Sites column counts. Tri-state: classifyMarket
          // returns null for a site in a competitive state with no utility
          // and no supplier on file — an open question, not a No — and the
          // tab counts only a confirmed Deregulated.
          electricDeregulated: marketVerdict(r, 'electric'),
          gasDeregulated: marketVerdict(r, 'gas'),
        },
        // Where that consumption sits, in the same 'ST / Prov / Country'
        // spelling the Site Detail sheet uses: the 2-letter code in the US
        // and Canada, the country name everywhere else.
        state: r.__stateProvinceDisplay__ || r.__state__ || '',
      };
    });
  }

  // Gather everything the Corporate Compliance page knows about a company
  // into one blob for the export's round-trip sheet. Returns null when the
  // company has no research yet, so an export doesn't carry an empty
  // object that a later import would treat as "wipe what's there".
  function collectCompanyResearch(company) {
    const name = String(company || '').trim();
    if (!name) return null;
    const key = complianceKeyOf(name);
    const slug = companySlug(name);
    const payload = {
      company: name,
      // Both keys travel with the data: screening/notes/links/findings are
      // saved under the canonical key, revenue under the plain slug.
      key,
      slug,
      revenue: (settings?.companyRevenueResearch || {})[slug] || null,
      screening: (settings?.corporateComplianceScreening || {})[key] || null,
      complianceResearch: (settings?.companyComplianceResearch || {})[key] || null,
      complianceLinks: (settings?.companyComplianceLinks || {})[key] || null,
      complianceFindings: (settings?.companyComplianceFindings || {})[key] || null,
      // Reference links belong to the row rather than the company, so they
      // live in one page-level map. It travels whole — otherwise an analysis
      // exported today would arrive with an empty Reference column.
      complianceReferenceLinks: settings?.complianceReferenceLinks || null,
    };
    const hasAny = payload.revenue || payload.screening || payload.complianceResearch
      || payload.complianceLinks || payload.complianceFindings
      || payload.complianceReferenceLinks;
    return hasAny ? payload : null;
  }

  // Write a round-tripped research blob back into settings, under the keys
  // this account derives from the company name (rather than the exporting
  // account's, in case the name was edited in between). Only branches the
  // export actually carried are written, so importing an analysis that
  // predates one of these maps can't blank it out.
  function restoreCompanyResearch(research) {
    if (!research || !updateSettingsPath) return false;
    const name = String(research.company || '').trim();
    if (!name) return false;
    const key = complianceKeyOf(name);
    const slug = companySlug(name);
    const updates = {};
    if (research.revenue) updates[`companyRevenueResearch.${slug}`] = research.revenue;
    if (research.screening) updates[`corporateComplianceScreening.${key}`] = research.screening;
    if (research.complianceResearch) updates[`companyComplianceResearch.${key}`] = research.complianceResearch;
    if (research.complianceLinks) updates[`companyComplianceLinks.${key}`] = research.complianceLinks;
    if (research.complianceFindings) updates[`companyComplianceFindings.${key}`] = research.complianceFindings;
    // Shared reference links land row by row, and only where this account
    // has nothing already — an imported analysis fills gaps, it doesn't
    // overwrite the links whoever is importing has curated.
    if (research.complianceReferenceLinks && typeof research.complianceReferenceLinks === 'object') {
      const mine = settings?.complianceReferenceLinks || {};
      for (const [rowKey, url] of Object.entries(research.complianceReferenceLinks)) {
        if (!rowKey || typeof url !== 'string' || !url.trim() || mine[rowKey]) continue;
        updates[`complianceReferenceLinks.${rowKey}`] = url;
      }
    }
    if (Object.keys(updates).length === 0) return false;
    try {
      updateSettingsPath(updates);
      return true;
    } catch (e) {
      console.warn('Could not restore company research from the analysis:', e);
      return false;
    }
  }

  function addRoundTripSheets(wb) {
    const SE_GREEN = 'FF3DCD58';
    const SE_GREEN_DARK = 'FF009530';
    let sourceHeaders = [];
    if (cleanSitesData.length > 0) {
      sourceHeaders = Object.keys(cleanSitesData[0]);
      // Decide where the resolved supplier values go: overwrite the
      // mapped source column when present, else append a new one with
      // a name detectSitesMapping will recognize on re-upload.
      const electricSupplierCol = electricSupplierOverride || 'Electric Supplier';
      const gasSupplierCol = gasSupplierOverride || 'Gas Supplier';
      const stateCol = stateColumnOverride || 'State';
      const appended = [];
      const addAppended = (name) => {
        if (!sourceHeaders.includes(name) && !appended.includes(name)) appended.push(name);
      };
      addAppended(electricSupplierCol);
      addAppended(gasSupplierCol);
      addAppended(stateCol);
      // Informational snapshot columns — not mapping targets, so
      // they're dropped on re-import (the page re-derives them).
      const SNAPSHOT_UTILITY_ELECTRIC = 'Electric Utility';
      const SNAPSHOT_UTILITY_GAS = 'Gas Utility';
      const SNAPSHOT_RATE_ELECTRIC = 'Electric Rate ($/kWh)';
      const SNAPSHOT_RATE_GAS = 'Gas Rate ($/therm)';
      addAppended(SNAPSHOT_UTILITY_ELECTRIC);
      addAppended(SNAPSHOT_UTILITY_GAS);
      addAppended(SNAPSHOT_RATE_ELECTRIC);
      addAppended(SNAPSHOT_RATE_GAS);
      const inputHeaders = [...sourceHeaders, ...appended];

      // Build enriched rows from the derived rows so the baked-in values
      // reflect everything the page is showing — per-row supplier overrides,
      // fuzzy-match canonicalization, zip-derived state, rates-file utility
      // lookups. Keep the raw source values for every other column.
      //
      // `allRows`, not `rows`: the Site List tab carries the whole uploaded
      // file, not just whichever division is in scope on screen. The mapping
      // rides along in the round-trip state below, so an import restores the
      // same view rather than inheriting whatever scope the export was taken
      // under.
      const enrichedRows = allRows.map(r => {
        const out = {};
        for (const h of sourceHeaders) out[h] = r[h];
        const electricResolved = r.__electricSupplier__ || '';
        const gasResolved = r.__gasSupplier__ || '';
        if (electricResolved) out[electricSupplierCol] = electricResolved;
        else if (!(electricSupplierCol in out)) out[electricSupplierCol] = '';
        if (gasResolved) out[gasSupplierCol] = gasResolved;
        else if (!(gasSupplierCol in out)) out[gasSupplierCol] = '';
        const stateResolved = r.__state__ || '';
        if (stateResolved) out[stateCol] = stateResolved;
        else if (!(stateCol in out)) out[stateCol] = '';
        out[SNAPSHOT_UTILITY_ELECTRIC] = r.__electric__ || '';
        out[SNAPSHOT_UTILITY_GAS] = r.__gas__ || '';
        out[SNAPSHOT_RATE_ELECTRIC] = typeof r.__electricRate__ === 'number' ? r.__electricRate__ : '';
        out[SNAPSHOT_RATE_GAS] = typeof r.__gasRate__ === 'number' ? r.__gasRate__ : '';
        return out;
      });

      const inputWs = wb.addWorksheet('Site List', {
        properties: { tabColor: { argb: SE_GREEN } },
        views: [{ state: 'frozen', ySplit: 1 }],
      });
      inputWs.columns = inputHeaders.map(h => ({
        header: h,
        key: h,
        width: Math.max(String(h).length + 2, 14),
      }));
      for (const row of enrichedRows) inputWs.addRow(row);
      const hdr = inputWs.getRow(1);
      hdr.font = { name: 'Nunito Sans', bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
      hdr.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      hdr.height = 22;
      inputWs.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: inputHeaders.length } };
    }

    const stateWs = wb.addWorksheet('__rt_state__', { state: 'hidden' });
    stateWs.getCell('A1').value = JSON.stringify({
      version: 2,
      exportedAt: new Date().toISOString(),
      // Scoped to the source headers: the mapping only ever points at
      // columns that came from the upload, never at the derived
      // snapshot columns appended above.
      mapping: currentSitesMapping(sourceHeaders),
      vendorDecisions,
      supplierOverrides,
      portfolioCompanyName,
      // The company's researched facts — revenue/employees, the six
      // jurisdiction answers, the research notes + sources behind them,
      // and the reference links / findings recorded against each. None of
      // it lives in a column, so without this an imported analysis lands
      // on an account with the site list restored but every Corporate
      // Compliance card blank.
      companyResearch: collectCompanyResearch(portfolioCompanyName),
    });
  }

  async function exportMasterAnalysis({ returnBuffer = false, companyName = null } = {}) {
    if (!rows.length) {
      throw new Error('No sites available to export: re-check the uploaded file or the Site Name column mapping.');
    }
    const { Workbook } = await import('exceljs');
    const wb = new Workbook();
    wb.creator = 'Schneider Electric · Prospect Tracker';
    // One resolved company name for every sheet and the file name, so a
    // save bound to a specific company labels the whole workbook with it.
    const company = deriveExportCompanyName(companyName);

    // 1. Indicative Savings sheets (returns its native-chart descriptors).
    const indicative = await exportIndicativeSavings({ targetWb: wb });
    const chartInjections = indicative?.chartInjections || [];

    // 2. Building Compliance report + Site Detail, screened from the same
    //    site list the compliance subtabs use. Site Detail is renamed to
    //    avoid colliding with Indicative Savings' Site Detail sheet.
    //    Scoped to the same Owned / All-sites toggle the subtabs are on.
    const complianceResults = screenSites(complianceScopedSites, { ordinances });
    await exportComplianceReportXlsx(complianceResults, {
      targetWb: wb,
      generatedAt: new Date().toLocaleString('en-US'),
      siteCount: complianceScopedSites.length,
      siteDetailSheetName: 'Compliance Site Detail',
      companyName: company,
    });

    // 3. Corporate Compliance — company-level portfolio view (site footprint
    //    + California operations), Schneider-formatted.
    buildCorporateComplianceSheet(wb, complianceSites, {
      generatedAt: new Date().toLocaleString('en-US'),
      companyName: company,
      // Full per-company screening detail (jurisdiction answers, rationale,
      // regulation verdicts, narrative + sources) so the sheet can carry the
      // same analysis the Corporate Compliance page shows on its cards.
      screening: corporateComplianceSummary(),
    });

    // 4. Compliance Report Methodology — how the estimated fines were derived,
    //    by mandate, plus the per-jurisdiction penalty inputs behind them.
    buildComplianceMethodologySheet(wb, complianceResults, {
      generatedAt: new Date().toLocaleString('en-US'),
      companyName: company,
    });

    // 5. Utility Mapping coverage — the same analysis the Utility Mapping
    //    page exports: the NA coverage map, the per-state breakdown, and the
    //    per-site detail, headlined by the share of sites mapped to a known
    //    utility and the share with utility interval data. It reads the
    //    Utility Name Mapping list straight from IndexedDB so the sheets are
    //    there whether or not that tab has been opened this session. Tabs are
    //    renamed to avoid colliding with Indicative Savings' NAM / Site
    //    Detail sheets.
    const savedNameMap = await loadListFromIDB(NAME_MAP_LIST_KEY);
    const mappingCoverage = await exportUtilityMappingAnalysis(Array.isArray(savedNameMap) ? savedNameMap : [], {
      targetWb: wb,
      sheetNames: {
        nam: 'Utility Mapping',
        stateBreakdown: 'Utility Mapping by State',
        siteDetail: 'Utility Mapping Site Detail',
      },
    });

    // 5b. The same two coverage headlines on the Summary tab. They answer
    //     whether the interval data behind every savings figure on that tab
    //     actually exists, which is the first thing asked of the numbers above
    //     them — so they belong on the first sheet, not only on the Utility
    //     Mapping tab three sheets in.
    //
    //     Written here rather than with the rest of the Summary because the
    //     figures come out of step 5, which runs after Indicative Savings has
    //     already built that sheet. Appended below whatever it ended on.
    appendIntervalDataSummary(wb.getWorksheet('Summary'), mappingCoverage);

    // 6. Divisions — every sheet above, read one level below the company:
    //    the procurement savings opportunity, the compliance exposure, the
    //    interval-data coverage and the ISO / RTO footprint, per division.
    //    Runs here because it joins three things the steps above produced —
    //    the compliance screening (step 2), the per-site utility mapping
    //    (step 5) and the per-division savings roll-up — onto the division
    //    each site carries.
    buildDivisionsSheet(wb, summarizeDivisions(
      collectDivisionSiteFacts(complianceResults, mappingCoverage?.siteRows),
      divisionSavings,
    ), {
      generatedAt: new Date().toLocaleString('en-US'),
      companyName: company,
      scopeNote: divisionFilter
        ? `Scoped to ${activeDivisionLabel()} — clear the Division filter on the Utility Lookup page to export every division`
        : '',
    });

    // 7. Round-trip sheets — the Site List the whole workbook was built
    //    from, plus the hidden state sheet. These are what let the
    //    analysis be imported back onto the Utility Lookup page (and
    //    from there onto every subtab) later, from this company's
    //    saved copy.
    addRoundTripSheets(wb);

    // Write the merged workbook once, then inject the Indicative Savings
    // native charts (ExcelJS drops charts on re-load, so this must run on
    // the final buffer, last).
    let buf = await wb.xlsx.writeBuffer();
    for (const injection of chartInjections) {
      buf = await injectLiveLineChart(buf, injection);
    }

    const exportCompany = sanitizeFileNamePart(
      [company, activeDivisionLabel()].filter(Boolean).join(' - '),
    );
    const fileName = exportCompany
      ? `${exportCompany}_Master Analysis.xlsx`
      : `Master Analysis - ${new Date().toISOString().slice(0, 10)}.xlsx`;
    // Save-to-company mode: hand the workbook back instead of downloading.
    if (returnBuffer) return { buffer: buf, fileName };
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Styled multi-tab utility-mapping workbook, launched from the Utility
  // Mapping page's "Download Analysis" button. Sheets:
  //   1. NAM — a North-America choropleth: each state / province shaded by
  //      the share of its portfolio sites mapped to a known utility, with
  //      both headline coverage numbers (% mapped, % with interval data).
  //   2. State Breakdown — one row per state / province with mapping counts,
  //      unique-utility count, and the interval-data split (sorted by most
  //      sites with interval data).
  //   3. Site Detail — one row per site with its mapping state, zip, the
  //      matched uploaded name, mapped-to utility, Status, whether that
  //      status means we have interval data, and Requirements.
  // `nameMapList` is the Utility Name Mapping table passed up from
  // UtilityMappingView; each site's electric utility is classified against it.
  // With `targetWb` the sheets are added to an existing workbook (and nothing
  // is downloaded) — that's how the Master Analysis carries the same
  // analysis; `sheetNames` renames the tabs so they don't collide there.
  async function exportUtilityMappingAnalysis(nameMapList, { targetWb = null, sheetNames = {} } = {}) {
    if (!rows.length) {
      throw new Error('No sites available to export: re-check the uploaded file or the Site Name column mapping.');
    }
    // Classify each Utility-Lookup site's electric utility against the
    // Utility Name Mapping table: is its utility present in that table, and
    // is it mapped to one of the app's known utilities? Buckets:
    //   mapped     — utility found and mapped to a known utility
    //   unmapped   — utility found but not (yet) mapped to a known utility
    //   notInList  — utility absent from the mapping table (or site has none)
    const nameMapRows = Array.isArray(nameMapList) ? nameMapList : [];
    const mapNames = nameMapRows.map(x => x.name).filter(Boolean);
    const byName = new Map();
    for (const x of nameMapRows) if (x.name && !byName.has(x.name)) byName.set(x.name, x);
    const knownSet = new Set((knownUtilityNames || []).map(n => String(n || '').trim()).filter(Boolean));
    const classify = (utility) => {
      const u = String(utility || '').trim();
      if (!u) return { status: 'notInList', detail: 'No electric utility on the site', matched: '', mappedTo: '', rowStatus: '', requirements: '' };
      const hit = mapNames.length ? findFuzzyMatch(u, mapNames, { threshold: 40 }) : null;
      if (!hit) return { status: 'notInList', detail: 'Utility not in the Utility Name Mapping table', matched: '', mappedTo: '', rowStatus: '', requirements: '' };
      const row = byName.get(hit.name) || {};
      const mappedTo = String(row.mappedTo || '').trim();
      const rowStatus = String(row.status || '').trim();
      const requirements = String(row.requirements || '').trim();
      if (mappedTo && knownSet.has(mappedTo)) return { status: 'mapped', detail: 'Mapped to a known utility', matched: hit.name, mappedTo, rowStatus, requirements };
      if (mappedTo) return { status: 'unmapped', detail: 'Mapped value is not a known utility', matched: hit.name, mappedTo, rowStatus, requirements };
      return { status: 'unmapped', detail: 'In the mapping table but not yet mapped', matched: hit.name, mappedTo: '', rowStatus, requirements };
    };
    const bumpBucket = (b, status, interval) => {
      b.total++;
      if (status === 'mapped') b.mapped++;
      else if (status === 'unmapped') b.unmapped++;
      else b.notInList++;
      if (interval === true) b.intervalYes++;
      else if (interval === false) b.intervalNo++;
    };
    // A site has interval data when its utility's Status reads available /
    // positive; explicit negatives (no / not available / pending / …)
    // read as no interval data. Blank / unknown returns null and is left
    // out of both counts — those sites are neither confirmed nor ruled
    // out, so they only move the denominator.
    const statusHasIntervalData = (v) => {
      const s = String(v ?? '').trim().toLowerCase();
      if (!s) return null;
      if (/^(no|n|none|false|0|unavailable|not\s*available|no\s*access|n\/a|na|tbd|unknown|pending|-)$/.test(s)) return false;
      return true;
    };

    // Per-site detail rows + per-state (NAM) buckets for the choropleth.
    const detailRows = [];
    const buckets = new Map(); // key -> { center, total, mapped, unmapped, notInList, intervalYes, intervalNo, label, stateCode, countryLabel }
    const stateBuckets = new Map(); // `${country}|||${state}` -> { country, state, total, mapped, unmapped, notInList, intervalYes, intervalNo, utilities:Set, requirements:Set }
    const allUtilities = new Set(); // distinct electric utilities portfolio-wide (for the State Breakdown total row)
    let totMapped = 0, totUnmapped = 0, totNotInList = 0;
    let totIntervalYes = 0, totIntervalNo = 0;
    for (const r of rows) {
      const siteName = siteNameColumn ? String(r[siteNameColumn] || '').trim() : '';
      const electricUtility = String(r.__electric__ || '').trim();
      const utilityKey = electricUtility.toLowerCase();
      const rawCountry = String(r.__country__ || '').trim();
      const country = normalizeCountryName(rawCountry) || rawCountry;
      const isUS = /^(united states|usa|us)$/i.test(country);
      const isCA = /^(canada|ca)$/i.test(country);
      // US sites already resolve __state__ to a 2-letter code via the zip
      // lookup; Canadian sites keep whatever province string was uploaded
      // ("Ontario", "Québec", "ON"), so normalize it to the 2-letter postal
      // code the province-centre table and the admin-1 map polygons key on —
      // otherwise provinces never match a map bucket and stay unfilled.
      const rawState = String(r.__state__ || '').trim();
      const stateCode = isCA
        ? (normalizeProvince(r.__stateProvinceDisplay__) || normalizeProvince(rawState) || rawState.toUpperCase())
        : rawState.toUpperCase();
      const stateDisplay = r.__stateProvinceDisplay__ || stateCode || '-';
      const cls = classify(electricUtility);
      if (cls.status === 'mapped') totMapped++;
      else if (cls.status === 'unmapped') totUnmapped++;
      else totNotInList++;
      if (utilityKey) allUtilities.add(utilityKey);
      // Interval-data availability (from the utility's Status column) +
      // requirements text, surfaced per state on the State Breakdown tab.
      const interval = statusHasIntervalData(cls.rowStatus);
      if (interval === true) totIntervalYes++;
      else if (interval === false) totIntervalNo++;
      // State / province breakdown across the whole portfolio (NAM + intl).
      {
        const sKey = `${rawCountry}|||${stateDisplay}`;
        let sb = stateBuckets.get(sKey);
        if (!sb) { sb = { country: rawCountry, state: stateDisplay, total: 0, mapped: 0, unmapped: 0, notInList: 0, intervalYes: 0, intervalNo: 0, utilities: new Set(), requirements: new Set() }; stateBuckets.set(sKey, sb); }
        bumpBucket(sb, cls.status, interval);
        if (utilityKey) sb.utilities.add(utilityKey);
        if (cls.requirements) sb.requirements.add(cls.requirements);
      }
      detailRows.push({
        // Not columns on the Site Detail sheet (which lists its own): the
        // row's identity and division, so the Master Analysis' Divisions tab
        // can break this same classification down by division rather than
        // re-deriving it and risking a different answer.
        siteId: r.id,
        division: String(r.__division__ || '').trim(),
        siteName,
        state: stateDisplay,
        country: rawCountry,
        zip: r.__zipNorm__ || '',
        electricUtility,
        matched: cls.matched,
        mappedTo: cls.mappedTo,
        rowStatus: cls.rowStatus,
        requirements: cls.requirements,
        status: cls.status === 'mapped' ? 'Mapped' : (cls.status === 'unmapped' ? 'Unmapped' : 'Not in mapping list'),
        intervalData: interval === true ? 'Yes' : interval === false ? 'No' : 'Unknown',
        detail: cls.detail,
      });
      let center = null, label = '', countryLabel = '';
      if (isUS && US_STATE_CENTERS[stateCode]) { center = US_STATE_CENTERS[stateCode]; label = `${stateCode}, USA`; countryLabel = 'United States'; }
      else if (isCA && CANADA_PROVINCE_CENTERS[stateCode]) { center = CANADA_PROVINCE_CENTERS[stateCode]; label = `${stateCode}, Canada`; countryLabel = 'Canada'; }
      if (!center) continue;
      const key = `${isUS ? 'US' : 'CA'}/${stateCode}`;
      let b = buckets.get(key);
      if (!b) { b = { center, total: 0, mapped: 0, unmapped: 0, notInList: 0, intervalYes: 0, intervalNo: 0, label, stateCode, countryLabel }; buckets.set(key, b); }
      bumpBucket(b, cls.status, interval);
    }

    const SE_GREEN_DARK = 'FF009530';
    const SE_GREEN = 'FF3DCD58';
    const SE_GREEN_LIGHT = 'FFE6F7EC';
    const SE_TEXT_DARK = 'FF1E293B';
    const SE_BORDER = 'FFD4DDE1';
    const SE_SLATE = 'FF475569';
    let wb = targetWb;
    if (!wb) {
      const { Workbook } = await import('exceljs');
      wb = new Workbook();
      wb.creator = 'Schneider Electric · Prospect Tracker';
    }
    const namSheetName = sheetNames.nam || 'NAM';
    const stateSheetName = sheetNames.stateBreakdown || 'State Breakdown';
    const detailSheetName = sheetNames.siteDetail || 'Site Detail';
    // Headline coverage, shown wherever the analysis is summarised.
    const totalSites = totMapped + totUnmapped + totNotInList;
    const pctText = (n) => (totalSites ? `${Math.round((n / totalSites) * 100)}%` : '0%');
    const coverageLine = `${pctText(totMapped)} of sites mapped to a known utility · ${pctText(totIntervalYes)} with utility interval data`;

    // ---- Sheet 1: NAM utility-mapping dot map ----
    {
      const COLS = 16;
      const ws = wb.addWorksheet(namSheetName, {
        properties: { tabColor: { argb: SE_GREEN_DARK } },
        views: [{ showGridLines: false }],
      });
      ws.columns = Array.from({ length: COLS }, () => ({ width: 12 }));

      // Composite canvas — single NA panel with a gradient legend below.
      const MAP_W = 900, MAP_H = 520, PAD = 16, TITLE_H = 30, LEGEND_H = 70;
      const W = MAP_W + PAD * 2;
      const H = TITLE_H + MAP_H + LEGEND_H + PAD * 2;
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H);

      const NA_LNG_MIN = -170, NA_LNG_MAX = -52, NA_LAT_MIN = 18, NA_LAT_MAX = 84;
      const originX = PAD, originY = TITLE_H + PAD;
      const project = (lng, lat) => [
        originX + ((lng - NA_LNG_MIN) / (NA_LNG_MAX - NA_LNG_MIN)) * MAP_W,
        originY + ((NA_LAT_MAX - lat) / (NA_LAT_MAX - NA_LAT_MIN)) * MAP_H,
      ];
      // Split rings that cross the antimeridian (Alaska's Aleutians) so we
      // don't draw a connector across the whole panel.
      const drawFeature = (rings, fill, stroke) => {
        ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.lineWidth = 0.5;
        for (const ring of rings) {
          const subRings = []; let cur = []; let prevLng = null;
          for (const pt of ring) {
            if (prevLng !== null && Math.abs(pt[0] - prevLng) > 180) { if (cur.length > 2) subRings.push(cur); cur = []; }
            cur.push(pt); prevLng = pt[0];
          }
          if (cur.length > 2) subRings.push(cur);
          for (const sr of subRings) {
            ctx.beginPath();
            for (let i = 0; i < sr.length; i++) { const [px, py] = project(sr[i][0], sr[i][1]); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
            ctx.closePath(); ctx.fill(); ctx.stroke();
          }
        }
      };

      // Choropleth — each NA state / province is filled by the share of its
      // portfolio sites whose electric utility is mapped to a known utility
      // (light → dark green). States with no portfolio sites stay light grey.
      // Mirrors the filled-map style of the Indicative Savings export.
      const lerp = (a, b, t) => a + (b - a) * t;
      const GREEN_LIGHT = [220, 252, 231]; // #DCFCE7
      const GREEN_DARK = [4, 120, 87];     // #047857
      const NO_SITES_FILL = '#E5E7EB';
      const NO_SITES_STROKE = '#9CA3AF';
      const pctFill = (b) => {
        const t = b.total ? b.mapped / b.total : 0;
        return `rgb(${Math.round(lerp(GREEN_LIGHT[0], GREEN_DARK[0], t))},${Math.round(lerp(GREEN_LIGHT[1], GREEN_DARK[1], t))},${Math.round(lerp(GREEN_LIGHT[2], GREEN_DARK[2], t))})`;
      };

      ctx.save();
      ctx.beginPath(); ctx.rect(originX, originY, MAP_W, MAP_H); ctx.clip();
      // Uniform grey panel background — matches the Indicative Savings NAM
      // map. No ocean tint, so no-site land (notably the Canadian
      // territories above BC / AB / SK) blends into the background instead
      // of reading as a hard grey "cap" that makes the provinces look cut
      // off half-way up.
      ctx.fillStyle = NO_SITES_FILL; ctx.fillRect(originX, originY, MAP_W, MAP_H);
      const countryFeatures = getCountryFeatures();
      const naFeatures = getNAAdmin1Features();
      // Only Mexico from the country layer — the US + Canada landmass is the
      // admin-1 state / province polygons themselves, drawn next.
      for (const feat of countryFeatures) {
        if ((TOPO_NAME_TO_DEREG_KEY[feat.name] || feat.name) !== 'Mexico' && feat.name !== 'Mexico') continue;
        drawFeature(feat.rings, NO_SITES_FILL, NO_SITES_STROKE);
      }
      // States / provinces shaded by mapping coverage; hairline borders.
      for (const feat of naFeatures) {
        const b = buckets.get(`${feat.admin}/${feat.postal}`);
        drawFeature(feat.rings, b ? pctFill(b) : NO_SITES_FILL, NO_SITES_STROKE);
      }
      ctx.restore();

      // Legend — gradient bar (0–100 % mapped) + grey "no sites" swatch.
      const legendY = originY + MAP_H + PAD;
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.font = '13px Nunito Sans, Arial, sans-serif';
      const gradX = originX, gradW = 280, gradH = 16;
      const grad = ctx.createLinearGradient(gradX, 0, gradX + gradW, 0);
      grad.addColorStop(0, `rgb(${GREEN_LIGHT.join(',')})`);
      grad.addColorStop(1, `rgb(${GREEN_DARK.join(',')})`);
      ctx.fillStyle = grad; ctx.fillRect(gradX, legendY, gradW, gradH);
      ctx.strokeStyle = NO_SITES_STROKE; ctx.lineWidth = 0.8; ctx.strokeRect(gradX, legendY, gradW, gradH);
      ctx.fillStyle = '#0F172A';
      ctx.fillText('0%', gradX, legendY + gradH + 13);
      ctx.textAlign = 'right'; ctx.fillText('100 % mapped to a known utility', gradX + gradW, legendY + gradH + 13);
      ctx.textAlign = 'left';
      const gx = gradX + gradW + 48;
      ctx.fillStyle = NO_SITES_FILL; ctx.fillRect(gx, legendY, gradH, gradH);
      ctx.strokeStyle = NO_SITES_STROKE; ctx.strokeRect(gx, legendY, gradH, gradH);
      ctx.fillStyle = '#0F172A'; ctx.fillText('No portfolio sites', gx + gradH + 8, legendY + gradH / 2);

      const dataUrl = canvas.toDataURL('image/png');
      const imageId = wb.addImage({ base64: dataUrl, extension: 'png' });

      // Title + subtitle bands.
      ws.mergeCells(1, 1, 1, COLS);
      const title = ws.getCell(1, 1);
      title.value = 'Utility Mapping Coverage: North America';
      title.font = { name: 'Nunito Sans', bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
      title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
      title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(1).height = 30;

      ws.mergeCells(2, 1, 2, COLS);
      const sub = ws.getCell(2, 1);
      sub.value = `${nameMapRows.length === 0 ? 'No utility list is loaded on the Utility Name Mapping tab, so no site can be mapped or confirmed for interval data yet. ' : ''}${detailRows.length} site${detailRows.length === 1 ? '' : 's'} · ${coverageLine}. Mapping: ${totMapped} mapped to a known utility · ${totUnmapped} in the table but unmapped · ${totNotInList} not in the mapping list. Interval data: ${totIntervalYes} yes · ${totIntervalNo} no · ${totalSites - totIntervalYes - totIntervalNo} unknown (utility Status blank or not in the mapping list). Each NA state / province is shaded by the share of its portfolio sites whose electric utility is mapped to a known utility (light → dark green); states with no portfolio sites stay light grey.`;
      sub.font = { name: 'Nunito Sans', italic: true, size: 10, color: { argb: SE_SLATE } };
      sub.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
      ws.getRow(2).height = 36;

      // KPI band — the two headline percentages, one merged block each, so
      // the coverage read doesn't depend on reading the subtitle prose.
      {
        const half = Math.floor(COLS / 2);
        const kpis = [
          { from: 1, to: half, label: 'Sites mapped to a known utility', value: totalSites ? totMapped / totalSites : 0, sub: `${totMapped.toLocaleString()} of ${totalSites.toLocaleString()} sites` },
          { from: half + 1, to: COLS, label: 'Sites with utility interval data', value: totalSites ? totIntervalYes / totalSites : 0, sub: `${totIntervalYes.toLocaleString()} of ${totalSites.toLocaleString()} sites` },
        ];
        for (const k of kpis) {
          ws.mergeCells(3, k.from, 3, k.to);
          const cell = ws.getCell(3, k.from);
          cell.value = `${k.label}:  ${totalSites ? Math.round(k.value * 100) : 0}%   (${k.sub})`;
          cell.font = { name: 'Nunito Sans', bold: true, size: 11, color: { argb: SE_GREEN_DARK } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
          cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
          cell.border = { bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } }, right: { style: 'thin', color: { argb: 'FFFFFFFF' } } };
        }
        ws.getRow(3).height = 22;
      }

      ws.addImage(imageId, { tl: { col: 0, row: 4 }, ext: { width: W, height: H } });

      // Per-state breakdown table below the map.
      const SUMMARY_START = 4 + Math.ceil(H / 15) + 2;
      ws.mergeCells(SUMMARY_START, 1, SUMMARY_START, COLS);
      const sumHdr = ws.getCell(SUMMARY_START, 1);
      sumHdr.value = 'Utility Mapping by State / Province';
      sumHdr.font = { name: 'Nunito Sans', bold: true, size: 12, color: { argb: SE_GREEN_DARK } };
      sumHdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
      sumHdr.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(SUMMARY_START).height = 22;

      const tableHeaderRow = SUMMARY_START + 1;
      const breakdownCols = ['State / Prov', 'Country', 'Total Sites', 'Mapped', 'Unmapped', 'Not in List', '% Mapped', 'Interval Data', 'No Interval Data', '% Interval Data'];
      const hdr = ws.getRow(tableHeaderRow);
      breakdownCols.forEach((label, i) => {
        const cell = hdr.getCell(i + 1);
        cell.value = label;
        cell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
        cell.border = { bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } } };
      });
      hdr.height = 24;
      const breakdown = Array.from(buckets.values())
        .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
      breakdown.forEach((b, i) => {
        const row = ws.getRow(tableHeaderRow + 1 + i);
        const vals = [b.stateCode, b.countryLabel, b.total, b.mapped, b.unmapped, b.notInList, b.total ? b.mapped / b.total : 0, b.intervalYes, b.intervalNo, b.total ? b.intervalYes / b.total : 0];
        const fmts = [null, null, '#,##0', '#,##0', '#,##0', '#,##0', '0%', '#,##0', '#,##0', '0%'];
        vals.forEach((v, ci) => {
          const cell = row.getCell(ci + 1);
          cell.value = v;
          cell.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
          cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
          if (fmts[ci]) cell.numFmt = fmts[ci];
          cell.border = { bottom: { style: 'hair', color: { argb: SE_BORDER } } };
        });
        row.height = 18;
      });
      // Total row — portfolio-wide (including any sites outside NA, which
      // have no map bucket of their own).
      const total = totalSites;
      const totalRow = ws.getRow(tableHeaderRow + 1 + breakdown.length);
      const totVals = ['Total', '', total, totMapped, totUnmapped, totNotInList, total ? totMapped / total : 0, totIntervalYes, totIntervalNo, total ? totIntervalYes / total : 0];
      const totFmts = [null, null, '#,##0', '#,##0', '#,##0', '#,##0', '0%', '#,##0', '#,##0', '0%'];
      totVals.forEach((v, ci) => {
        const cell = totalRow.getCell(ci + 1);
        cell.value = v;
        cell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: SE_GREEN_DARK } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        if (totFmts[ci]) cell.numFmt = totFmts[ci];
        cell.border = { top: { style: 'thin', color: { argb: SE_GREEN_DARK } }, bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } } };
      });
      totalRow.height = 20;
    }

    // ---- Sheet 2: State Breakdown ----
    // One row per state / province (across every country in the portfolio)
    // with its utility-mapping coverage, so the user can scan jurisdictions
    // without reading the map.
    {
      const ws = wb.addWorksheet(stateSheetName, {
        properties: { tabColor: { argb: SE_GREEN } },
        views: [{ showGridLines: false, state: 'frozen', ySplit: 1 }],
      });
      const cols = [
        { label: 'ST / Prov', get: (s) => s.state, width: 16, numFmt: null },
        { label: 'Country', get: (s) => s.country, width: 18, numFmt: null },
        { label: 'Total Sites', get: (s) => s.total, width: 12, numFmt: '#,##0' },
        { label: 'Mapped', get: (s) => s.mapped, width: 12, numFmt: '#,##0' },
        { label: 'Unmapped', get: (s) => s.unmapped, width: 12, numFmt: '#,##0' },
        { label: 'Not in List', get: (s) => s.notInList, width: 12, numFmt: '#,##0' },
        { label: 'Unique Utilities', get: (s) => (s.utilities ? s.utilities.size : 0), width: 14, numFmt: '#,##0' },
        { label: '% Mapped', get: (s) => (s.total ? s.mapped / s.total : 0), width: 12, numFmt: '0%' },
        { label: 'Interval Data', get: (s) => s.intervalYes, width: 13, numFmt: '#,##0' },
        { label: 'No Interval Data', get: (s) => s.intervalNo, width: 15, numFmt: '#,##0' },
        { label: '% With Interval Data', get: (s) => (s.total ? s.intervalYes / s.total : 0), width: 17, numFmt: '0%' },
        { label: 'Requirements / Comments', get: (s) => [...s.requirements].map(x => `• ${x}`).join('\n'), width: 46, numFmt: null, wrap: true },
      ];
      ws.columns = cols.map(c => ({ width: c.width }));
      const head = ws.getRow(1);
      cols.forEach((c, i) => {
        const cell = head.getCell(i + 1);
        cell.value = c.label;
        cell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
        cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 };
        cell.border = { bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } }, right: { style: 'hair', color: { argb: 'FFFFFFFF' } } };
      });
      head.height = 28;
      // Sort by states with the most interval-data sites first, then by total
      // sites, then alphabetically.
      const stateRows = Array.from(stateBuckets.values()).sort((a, b) =>
        b.intervalYes - a.intervalYes ||
        b.total - a.total ||
        String(a.country).localeCompare(String(b.country)) ||
        String(a.state).localeCompare(String(b.state)));
      stateRows.forEach((s, ri) => {
        const row = ws.getRow(2 + ri);
        cols.forEach((c, i) => {
          const cell = row.getCell(i + 1);
          const v = c.get(s);
          cell.value = (v === '' || v == null) ? ' ' : v;
          cell.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
          cell.alignment = { vertical: c.wrap ? 'top' : 'middle', horizontal: 'left', indent: 1, wrapText: !!c.wrap };
          if (c.numFmt) cell.numFmt = c.numFmt;
          cell.border = { bottom: { style: 'hair', color: { argb: SE_BORDER } }, right: { style: 'hair', color: { argb: SE_BORDER } } };
        });
        // Grow the row when the requirements cell carries multiple
        // bullets so every line stays visible.
        const reqLines = s.requirements ? s.requirements.size : 0;
        row.height = reqLines > 1 ? Math.min(18 + (reqLines - 1) * 14, 120) : 18;
      });
      // Total row.
      const total = totalSites;
      const totalRow = ws.getRow(2 + stateRows.length);
      const totVals = ['Total', '', total, totMapped, totUnmapped, totNotInList, allUtilities.size, total ? totMapped / total : 0, totIntervalYes, totIntervalNo, total ? totIntervalYes / total : 0, ''];
      totVals.forEach((v, i) => {
        const cell = totalRow.getCell(i + 1);
        cell.value = v;
        cell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: SE_GREEN_DARK } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        if (cols[i].numFmt) cell.numFmt = cols[i].numFmt;
        cell.border = { top: { style: 'thin', color: { argb: SE_GREEN_DARK } }, bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } } };
      });
      totalRow.height = 20;
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    }

    // ---- Sheet 3: Site Detail ----
    {
      const ws = wb.addWorksheet(detailSheetName, {
        properties: { tabColor: { argb: SE_GREEN } },
        views: [{ showGridLines: false, state: 'frozen', ySplit: 1 }],
      });
      const cols = [
        { label: 'Site Name', get: (s) => s.siteName, width: 30 },
        { label: 'ST / Prov', get: (s) => s.state, width: 12 },
        { label: 'Country', get: (s) => s.country, width: 16 },
        { label: 'Zip', get: (s) => s.zip, width: 9 },
        { label: 'Electric Utility', get: (s) => s.electricUtility, width: 28 },
        { label: 'Matched Uploaded Name', get: (s) => s.matched, width: 28 },
        { label: 'Mapped-To Known Utility', get: (s) => s.mappedTo, width: 28 },
        { label: 'Status', get: (s) => s.rowStatus, width: 18 },
        { label: 'Interval Data', get: (s) => s.intervalData, width: 13 },
        { label: 'Requirements / Comments', get: (s) => s.requirements, width: 36 },
        { label: 'Mapping State', get: (s) => s.status, width: 18 },
        { label: 'Detail', get: (s) => s.detail, width: 34 },
      ];
      ws.columns = cols.map(c => ({ width: c.width }));
      const head = ws.getRow(1);
      cols.forEach((c, i) => {
        const cell = head.getCell(i + 1);
        cell.value = c.label;
        cell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
        cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 };
        cell.border = { bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } }, right: { style: 'hair', color: { argb: 'FFFFFFFF' } } };
      });
      head.height = 30;
      // Mapped → Unmapped → Not in mapping list, then site name.
      const order = { Mapped: 0, Unmapped: 1, 'Not in mapping list': 2 };
      const sorted = detailRows.slice().sort((a, b) =>
        (order[a.status] - order[b.status]) || String(a.siteName).localeCompare(String(b.siteName)));
      const STATUS_TEXT = { Mapped: 'FF166534', Unmapped: 'FF92400E', 'Not in mapping list': 'FFB91C1C' };
      const INTERVAL_TEXT = { Yes: 'FF166534', No: 'FFB91C1C', Unknown: 'FF92400E' };
      sorted.forEach((s, ri) => {
        const row = ws.getRow(2 + ri);
        cols.forEach((c, i) => {
          const cell = row.getCell(i + 1);
          const v = c.get(s);
          cell.value = (v === '' || v == null) ? ' ' : v;
          const isStatus = c.label === 'Mapping State';
          const isInterval = c.label === 'Interval Data';
          const color = isStatus
            ? (STATUS_TEXT[s.status] || SE_TEXT_DARK)
            : isInterval
              ? (INTERVAL_TEXT[s.intervalData] || SE_TEXT_DARK)
              : SE_TEXT_DARK;
          cell.font = { name: 'Nunito Sans', size: 10, bold: isStatus || isInterval, color: { argb: color } };
          cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
          cell.border = { bottom: { style: 'hair', color: { argb: SE_BORDER } }, right: { style: 'hair', color: { argb: SE_BORDER } } };
        });
        row.height = 18;
      });
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    }

    // Embedded in another workbook (Master Analysis): the caller writes and
    // downloads the merged file, so stop here.
    if (targetWb) {
      return {
        totalSites, mapped: totMapped, intervalYes: totIntervalYes, coverageLine,
        // Per-site mapping / interval classification, for callers that need
        // to cut it a different way (the Divisions tab).
        siteRows: detailRows,
      };
    }

    sanitizeExcelWorkbook(wb);
    const buf = await wb.xlsx.writeBuffer();
    const fileName = `${divisionScopedName('Utility Mapping Analysis')} - ${new Date().toISOString().slice(0, 10)}.xlsx`;
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Schneider Electric branded export — title band, green headers,
  // Nunito Sans everywhere, frozen header row, auto-filter, tab
  // colour. One sheet per overview plus the raw-data sheet.
  async function handleExport({ columns: exportColumns, rows: sortedRows, colNames, extraSheets }) {
    // The Mass Edit checkbox column is on screen, so the table offers it
    // here like any other. It carries no site data — an empty column in
    // the Raw Data sheet is all it could ever be.
    const visibleColumns = (exportColumns || []).filter(c => c.key !== '__select__');
    const { Workbook } = await import('exceljs');
    const SE_GREEN = 'FF3DCD58';
    const SE_GREEN_DARK = 'FF009530';
    const SE_TEXT_DARK = 'FF1E293B';
    const SE_BORDER = 'FFD4DDE1';
    // Deregulated markets = green, regulated = orange. "yes" and
    // "Limited" count as deregulated; "no" counts as regulated, to
    // cover both the site-level chip values (Regulated / Deregulated)
    // and the state-level overview values (yes / Limited / no).
    const MARKET_FILL = {
      Deregulated: 'FFDCFCE7',
      yes:         'FFDCFCE7',
      Limited:     'FFDCFCE7',
      Regulated:   'FFFFEDD5',
      no:          'FFFFEDD5',
    };
    const MARKET_FG = {
      Deregulated: 'FF166534',
      yes:         'FF166534',
      Limited:     'FF166534',
      Regulated:   'FF9A3412',
      no:          'FF9A3412',
    };

    const wb = new Workbook();
    wb.creator = 'Schneider Electric · Prospect Tracker';
    wb.created = new Date();

    function renderSheet(wsName, subtitle, headers, rowVals, opts = {}) {
      const ws = wb.addWorksheet(wsName, {
        properties: { tabColor: { argb: SE_GREEN } },
        views: [{ state: 'frozen', ySplit: 3 }],
      });
      const colCount = headers.length;
      const widths = opts.widths || headers.map(h => Math.max(String(h).length + 2, 14));
      ws.columns = widths.map(w => ({ width: w }));
      // Row 1: Title band
      ws.mergeCells(1, 1, 1, colCount);
      const title = ws.getCell(1, 1);
      title.value = 'Schneider Electric';
      title.font = { name: 'Nunito Sans', bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
      title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN } };
      title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(1).height = 30;
      // Row 2: Subtitle
      ws.mergeCells(2, 1, 2, colCount);
      const sub = ws.getCell(2, 1);
      sub.value = subtitle;
      sub.font = { name: 'Nunito Sans', italic: true, size: 10, color: { argb: 'FF64748B' } };
      sub.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(2).height = 20;
      // Row 3: Headers
      const headerRow = ws.getRow(3);
      headers.forEach((h, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = h;
        cell.font = { name: 'Nunito Sans', bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
        cell.border = {
          top: { style: 'thin', color: { argb: SE_BORDER } },
          bottom: { style: 'thin', color: { argb: SE_BORDER } },
          left: { style: 'thin', color: { argb: SE_BORDER } },
          right: { style: 'thin', color: { argb: SE_BORDER } },
        };
      });
      headerRow.height = 30;
      // Data rows
      rowVals.forEach((vals, rIdx) => {
        const row = ws.getRow(4 + rIdx);
        for (let i = 0; i < colCount; i++) {
          const cell = row.getCell(i + 1);
          const v = vals[i];
          cell.value = v === '' || v == null ? null : v;
          cell.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
          cell.alignment = { vertical: 'middle', horizontal: typeof v === 'number' ? 'right' : 'left', wrapText: false, indent: 1 };
          cell.border = {
            bottom: { style: 'thin', color: { argb: SE_BORDER } },
            left: { style: 'thin', color: { argb: SE_BORDER } },
            right: { style: 'thin', color: { argb: SE_BORDER } },
          };
          // Colour-code Regulated / Deregulated / yes / Limited / no
          // cells anywhere they appear.
          const asText = typeof v === 'string' ? v.trim() : '';
          if (asText && MARKET_FILL[asText]) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MARKET_FILL[asText] } };
            cell.font = { ...cell.font, bold: true, color: { argb: MARKET_FG[asText] } };
          }
          // Numeric formats for known column types. Spend and
          // consumption columns get ceiling-rounded so the displayed
          // whole number can't be less than the true value (the
          // user's analysis budgets should never under-report), and
          // both formats use comma thousands separators.
          const label = String(headers[i] || '').toLowerCase();
          if (typeof v === 'number') {
            if (/spend|cost|savings/.test(label)) {
              cell.value = Math.ceil(v);
              cell.numFmt = '"$"#,##0';
            } else if (/(rate|price)/.test(label)) {
              cell.numFmt = '"$"0.000';
            } else if (/(consumption|kwh|mwh|gwh|therm|mmbtu|dth|mcf|ccf|btu)/.test(label) && !/uom|unit/.test(label)) {
              cell.value = Math.ceil(v);
              cell.numFmt = '#,##0';
            }
          }
        }
        row.height = 18;
      });
      ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: colCount } };
      widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    }

    // Summary sheet: three stacked tables (Totals / Electric / Gas)
    // sharing the same SE styling. Uses native Excel tables so each
    // block gets its own header filter dropdowns, matching the look
    // the user wants on the first tab.
    function renderSummarySheet(summaryRows) {
      const ws = wb.addWorksheet('Summary', {
        properties: { tabColor: { argb: SE_GREEN } },
        views: [{ state: 'frozen', ySplit: 2 }],
      });
      const totalsCols    = ['Company', 'Total Sites', 'States Covered', 'Total Annual Spend', 'Total Savings Low', 'Total Savings High'];
      const electricCols  = ['Company', 'Total Sites', 'States Covered', 'Electric Deregulated Sites', 'Electric Annual Spend', 'Electric Savings Low', 'Electric Savings High'];
      const gasCols       = ['Company', 'Total Sites', 'States Covered', 'Gas Deregulated Sites', 'Gas Annual Spend', 'Gas Savings Low', 'Gas Savings High'];
      const maxCols = Math.max(totalsCols.length, electricCols.length, gasCols.length);

      // Column widths: first few wider, rest consistent.
      const widthFor = (colName) => {
        const name = String(colName || '');
        if (/company/i.test(name)) return 26;
        if (/states covered/i.test(name)) return 28;
        if (/spend|savings/i.test(name)) return 18;
        if (/total sites|deregulated sites/i.test(name)) return 14;
        return 18;
      };
      // Use the widest header set as the column-width reference.
      const widthRef = [...new Set([...totalsCols, ...electricCols, ...gasCols])];
      const baseWidths = new Array(maxCols).fill(0);
      // Set per-position widths based on the widest table at that
      // position; matters less since the three tables share the first
      // three columns (Company, Total Sites, States Covered) by design.
      for (let i = 0; i < maxCols; i++) {
        baseWidths[i] = widthFor(widthRef[i] || electricCols[i] || gasCols[i] || totalsCols[i]);
      }
      ws.columns = baseWidths.map(w => ({ width: w }));

      // Row 1: Title band (spans the widest block)
      ws.mergeCells(1, 1, 1, maxCols);
      const title = ws.getCell(1, 1);
      title.value = 'Schneider Electric';
      title.font = { name: 'Nunito Sans', bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
      title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN } };
      title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(1).height = 30;

      // Row 2: Subtitle
      ws.mergeCells(2, 1, 2, maxCols);
      const sub = ws.getCell(2, 1);
      sub.value = `Summary  ·  ${new Date().toLocaleDateString()}`;
      sub.font = { name: 'Nunito Sans', italic: true, size: 10, color: { argb: 'FF64748B' } };
      sub.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(2).height = 20;

      // Renders a single titled block starting at `startRow`. Returns
      // the next free row so the caller can stack additional blocks
      // below with a blank gutter row.
      function renderBlock(startRow, cols, rows) {
        const headerRow = ws.getRow(startRow);
        cols.forEach((h, i) => {
          const cell = headerRow.getCell(i + 1);
          cell.value = h;
          cell.font = { name: 'Nunito Sans', bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
          cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
          cell.border = {
            top:    { style: 'thin', color: { argb: SE_BORDER } },
            bottom: { style: 'thin', color: { argb: SE_BORDER } },
            left:   { style: 'thin', color: { argb: SE_BORDER } },
            right:  { style: 'thin', color: { argb: SE_BORDER } },
          };
        });
        headerRow.height = 26;
        rows.forEach((vals, rIdx) => {
          const row = ws.getRow(startRow + 1 + rIdx);
          for (let i = 0; i < cols.length; i++) {
            const cell = row.getCell(i + 1);
            const v = vals[i];
            cell.value = v === '' || v == null ? null : v;
            cell.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
            cell.alignment = { vertical: 'middle', horizontal: typeof v === 'number' ? 'right' : 'left', indent: 1 };
            cell.border = {
              bottom: { style: 'thin', color: { argb: SE_BORDER } },
              left:   { style: 'thin', color: { argb: SE_BORDER } },
              right:  { style: 'thin', color: { argb: SE_BORDER } },
            };
            const label = String(cols[i] || '').toLowerCase();
            if (typeof v === 'number') {
              if (/spend|savings/.test(label)) {
                cell.value = Math.ceil(v);
                cell.numFmt = '"$"#,##0';
              } else if (/sites/.test(label)) {
                cell.numFmt = '#,##0';
              } else if (/(consumption|kwh|mwh|gwh|therm|mmbtu|dth|mcf|ccf|btu)/.test(label) && !/uom|unit/.test(label)) {
                cell.value = Math.ceil(v);
                cell.numFmt = '#,##0';
              }
            }
          }
          row.height = 18;
        });
        return startRow + 1 + rows.length;
      }

      const totalsRows = summaryRows.map(r => [
        r.Company,
        r['Total Sites'],
        r['States Covered'],
        r['Total Annual Spend'],
        r['Total Savings Low'],
        r['Total Savings High'],
      ]);
      const electricRows = summaryRows.map(r => [
        r.Company,
        r['Total Sites'],
        r['States Covered'],
        r['Electric Deregulated Sites'],
        r['Electric Annual Spend'],
        r['Electric Savings Low'],
        r['Electric Savings High'],
      ]);
      const gasRows = summaryRows.map(r => [
        r.Company,
        r['Total Sites'],
        r['States Covered'],
        r['Gas Deregulated Sites'],
        r['Gas Annual Spend'],
        r['Gas Savings Low'],
        r['Gas Savings High'],
      ]);

      // Totals block at row 3 → Electric → Gas, each separated by 2
      // blank rows (one-cell gap + visual breathing room).
      let next = renderBlock(3, totalsCols, totalsRows);
      next += 2; // blank gutter
      next = renderBlock(next, electricCols, electricRows);
      next += 2;
      renderBlock(next, gasCols, gasRows);

      // Apply column widths authoritatively after all cells written.
      baseWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    }

    // Pull Summary out of extras; render it first as a three-block sheet.
    const summaryExtra = (extraSheets || []).find(s => s?.name === 'Summary');
    if (summaryExtra?.rows?.length) renderSummarySheet(summaryExtra.rows);

    // Sheet 2: Raw Data (from the on-screen table — respects sort,
    // visibility, and renames).
    const rawHeaders = visibleColumns.map(c => colNames[c.key] || c.label);
    const rawRows = sortedRows.map(row =>
      visibleColumns.map(col => {
        const v = typeof col.exportValue === 'function' ? col.exportValue(row) : row[col.key];
        if (Array.isArray(v)) return v.join(', ');
        return v ?? '';
      })
    );
    const subtitle = `Indicative Site Analysis  ·  ${new Date().toLocaleDateString()}`;
    renderSheet('Raw Data', subtitle, rawHeaders, rawRows);

    // Remaining extra sheets (Electric / Gas Overview) — come in as
    // array of plain row objects; we key them consistently and skip
    // the Summary since it was already rendered.
    for (const extra of extraSheets || []) {
      if (!extra?.rows?.length) continue;
      if (extra.name === 'Summary') continue;
      const headers = Object.keys(extra.rows[0]);
      const vals = extra.rows.map(r => headers.map(h => r[h]));
      renderSheet(extra.name, `${extra.name}  ·  ${new Date().toLocaleDateString()}`, headers, vals);
    }

    addRoundTripSheets(wb);

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${divisionScopedName('Indicative Site Analysis')} - ${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={styles.pageWrap}>
      <div className={styles.subtabBar}>
        <button
          type="button"
          className={mainTab === 'lookup' ? styles.subtabActive : styles.subtab}
          onClick={() => setMainTab('lookup')}
        >Site List</button>
        <button
          type="button"
          className={mainTab === 'mapping' ? styles.subtabActive : styles.subtab}
          onClick={() => setMainTab('mapping')}
        >Utility Mapping</button>
        <button
          type="button"
          className={mainTab === 'compliance' ? styles.subtabActive : styles.subtab}
          onClick={() => setMainTab('compliance')}
        >Compliance Screening</button>
        <button
          type="button"
          className={mainTab === 'roadmap' ? styles.subtabActive : styles.subtab}
          onClick={() => setMainTab('roadmap')}
        >Compliance Roadmap</button>
        <button
          type="button"
          className={mainTab === 'corporate' ? styles.subtabActive : styles.subtab}
          onClick={() => setMainTab('corporate')}
        >Corporate Compliance</button>
        {/* Division scope. Lives in the tab bar rather than inside the
            Site List page because it scopes every tab — the compliance
            tabs render instead of the Site List, so a control down there
            would be invisible exactly where the scope still applies.
            Only appears once the upload actually carries divisions. */}
        {divisionOptions.length > 0 && (
          <div
            style={{
              marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.4rem',
              paddingRight: '0.25rem',
            }}
          >
            <label
              htmlFor="sites-division-scope"
              style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-muted)' }}
            >Division/Portfolio Company</label>
            <select
              id="sites-division-scope"
              value={divisionFilter}
              onChange={(e) => setDivisionFilter(e.target.value)}
              title={divisionFilter
                ? `Every tab and every export on this page is scoped to ${activeDivisionLabel()}. Pick "All divisions" to widen it back out.`
                : 'Narrow every tab on this page — the site table, the compliance screening, the roadmap and all exports — to a single division.'}
              style={{
                maxWidth: 240, padding: '0.22rem 0.4rem', fontFamily: 'inherit',
                fontSize: '0.75rem', fontWeight: divisionFilter ? 700 : 500,
                borderRadius: 4, cursor: 'pointer',
                border: `1px solid ${divisionFilter ? '#7C3AED' : 'var(--color-border)'}`,
                background: divisionFilter ? '#F3E8FF' : 'var(--color-surface)',
                color: divisionFilter ? '#6B21A8' : 'var(--color-text)',
              }}
            >
              {/* "All divisions" named only half of what the picker now
                  covers, so it reads neutrally instead. */}
              <option value="">All ({divisionOptions.reduce((n, o) => n + o.count, 0)} sites)</option>
              {divisionOptions.map(o => (
                <option key={o.value} value={o.value}>{o.label} ({o.count})</option>
              ))}
            </select>
            {divisionFilter && (
              <button
                type="button"
                onClick={() => setDivisionFilter('')}
                title="Show every division again"
                style={{
                  border: '1px solid #E9D5FF', background: '#F3E8FF', color: '#6B21A8',
                  borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: '0.7rem', fontWeight: 700, padding: '0.18rem 0.4rem', lineHeight: 1.3,
                }}
              >Clear</button>
            )}
          </div>
        )}
      </div>
      {mainTab === 'corporate' ? (
        <CorporateCompliance sites={complianceSites} settings={settings} updateSettingsPath={updateSettingsPath} prospects={prospects} updateProspect={updateProspect} />
      ) : mainTab === 'roadmap' ? (
        <ComplianceRoadmap
          ordinances={ordinances}
          sites={complianceScopedSites}
          allSites={complianceSites}
          excludeLeased={complianceExcludeLeased}
          onExcludeLeasedChange={setComplianceExcludeLeased}
          settings={settings}
          scopeLabel={activeDivisionLabel()}
        />
      ) : mainTab === 'compliance' ? (
        <BuildingComplianceScreening
          ordinances={ordinances}
          overrides={ordinanceOverrides}
          onSaveOverride={saveOrdinanceOverride}
          sites={complianceScopedSites}
          allSites={complianceSites}
          excludeLeased={complianceExcludeLeased}
          onExcludeLeasedChange={setComplianceExcludeLeased}
          companyName={deriveExportCompanyName(null)}
          scopeLabel={activeDivisionLabel()}
        />
      ) : mainTab === 'mapping' ? (
        <UtilityMappingView siteUtilities={siteUtilities} referenceUtilityNames={knownUtilityNames} onExportSiteMapping={exportUtilityMappingAnalysis} />
      ) : (
    <div
      className={styles.wrapper}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragOver}
      onDragLeave={handleDragLeave}
      onPaste={handlePagePaste}
      style={dragOver ? { outline: '2px dashed var(--color-accent)', outlineOffset: -4, background: '#F0F9FF' } : undefined}
    >
      <div className={styles.header}>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap' }}>
            <h1 className={styles.title}>Utility Lookup</h1>
            <div className={styles.subtitle}>
            {rows.length} {rows.length === 1 ? 'site' : 'sites'}
            {sitesData.length > cleanSitesData.length && <span style={{ color: 'var(--color-text-muted)' }}> ({sitesData.length - cleanSitesData.length} blank-name row{sitesData.length - cleanSitesData.length === 1 ? '' : 's'} ignored)</span>}
            {/* Utility accounts — the other unit this page is read in: a
                data deal is priced per account per month, and the site count
                on its own doesn't say how many bills a portfolio carries.
                The estimate is per property type; the number can also be
                typed, and a typed one wins (see manualAccounts). */}
            {rows.length > 0 && (() => {
              const estimated = accountStats.total;
              const shown = manualAccounts != null ? manualAccounts : (estimated > 0 ? estimated : null);
              const label = manualAccounts != null ? 'Utility accounts' : 'Est. utility accounts';
              const whyNoEstimate = accountStats.withRawType > 0
                ? 'Utility accounts are estimated per property type, and none of this upload\u2019s property types is mapped to one of the reference types. Map them with the Property Types button, or type the total here.'
                : 'Utility accounts are estimated per property type, and no Property Type column is mapped on this upload. Map one with Update Column Mapping — or set it on the sites with Mass edit — or type the total here.';
              const title = [
                manualAccounts != null
                  ? `${manualAccounts.toLocaleString()} utility accounts, entered by hand${accountsCompany ? ` for ${accountsCompany}` : ''}. This is what the page shows and what Save to Company writes onto Number of Accounts.`
                  : estimated > 0
                    ? `${estimated.toLocaleString()} utility accounts (bills) estimated across ${accountStats.sites.toLocaleString()} site${accountStats.sites === 1 ? '' : 's'}, from each site\u2019s property type.`
                    : whyNoEstimate,
                manualAccounts != null && estimated > 0
                  ? `The property-type estimate for the sites loaded is ${estimated.toLocaleString()}.`
                  : '',
                manualAccounts == null && accountStats.unknown > 0
                  ? `Not counted: ${accountStats.unknown.toLocaleString()} site${accountStats.unknown === 1 ? '' : 's'} whose property type isn\u2019t mapped to one of the reference types.`
                  : '',
                manualAccounts == null && accountStats.byType.length
                  ? `Biggest contributors:\n${accountStats.byType.slice(0, 6).map(t => `  • ${t.name}: ${fmtAccounts(Math.round(t.accounts * 10) / 10)} across ${t.sites} site${t.sites === 1 ? '' : 's'}`).join('\n')}`
                  : '',
                accountsKey === UNFILED_ACCOUNTS_KEY
                  ? 'Click to type the real total. Nothing here names a company yet, so a typed total is held against this page rather than a company — set the Portfolio company (or map a Company Name column) and it files itself under that company instead.'
                  : `Click to type the real total; it is remembered for ${accountsCompany} across uploads. Clear the box to go back to the estimate.`,
              ].filter(Boolean).join('\n\n');
              return (
                <>
                  {' '}· {label}{' '}
                  {accountsDraft !== null ? (
                    <input
                      autoFocus
                      type="text"
                      inputMode="numeric"
                      value={accountsDraft}
                      onChange={(e) => setAccountsDraft(e.target.value)}
                      onBlur={commitAccountsDraft}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); commitAccountsDraft(); }
                        else if (e.key === 'Escape') { e.preventDefault(); setAccountsDraft(null); }
                      }}
                      placeholder={estimated > 0 ? String(estimated) : 'accounts'}
                      aria-label="Total utility accounts"
                      title="Type the portfolio\u2019s real account count. Enter saves, Esc cancels, an empty box goes back to the estimate."
                      style={{
                        width: 90, padding: '0.1rem 0.3rem', fontFamily: 'inherit', fontSize: '0.78rem',
                        fontWeight: 700, color: '#0F766E', border: '1px solid #0F766E', borderRadius: 4,
                        background: 'var(--color-surface)',
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setAccountsDraft(manualAccounts != null ? String(manualAccounts) : '')}
                      disabled={!updateSettingsPath}
                      title={title}
                      style={{
                        border: 'none', background: 'none', padding: 0, margin: 0, cursor: updateSettingsPath ? 'pointer' : 'default',
                        fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 700,
                        color: shown == null ? '#B45309' : '#0F766E',
                        textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 2,
                      }}
                    >{shown == null ? '—' : shown.toLocaleString()}</button>
                  )}
                  {manualAccounts != null ? (
                    <>
                      <span
                        title="Entered by hand — the property-type estimate is not being used."
                        style={{
                          marginLeft: 4, fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase',
                          letterSpacing: '0.03em', padding: '0.05rem 0.35rem', borderRadius: 999,
                          border: '1px solid #99F6E4', background: '#F0FDFA', color: '#0F766E', whiteSpace: 'nowrap',
                        }}
                      >entered</span>
                      {estimated > 0 && (
                        <button
                          type="button"
                          onClick={() => setManualAccounts(null)}
                          title={`Go back to the property-type estimate (${estimated.toLocaleString()})`}
                          style={{
                            marginLeft: 4, border: 'none', background: 'none', padding: 0, cursor: 'pointer',
                            fontFamily: 'inherit', fontSize: '0.62rem', color: 'var(--color-text-muted)',
                            textDecoration: 'underline',
                          }}
                        >use estimate</button>
                      )}
                    </>
                  ) : shown == null ? (
                    <span style={{ color: '#B45309' }}>
                      {' '}({accountStats.withRawType > 0 ? 'property types unmapped' : 'no property type on this upload'} — click to enter)
                    </span>
                  ) : accountStats.unknown > 0 ? (
                    <span style={{ color: '#B45309' }}>
                      {' '}({accountStats.unknown.toLocaleString()} site{accountStats.unknown === 1 ? '' : 's'} unmapped)
                    </span>
                  ) : null}
                </>
              );
            })()}
            {/* Sites an N/A property-type mapping leaves without a modelled
                usage figure. They're counted in the headline and carried
                through every export; this says which ones are contributing
                no consumption, and why. */}
            {unestimatedSites.total > 0 && (
              <span
                style={{ color: '#B45309' }}
                title={`No consumption estimated for these property types (they're still included everywhere): ${unestimatedSites.byType.map(t => `${t.raw} (${t.count})`).join(', ')}`}
              >
                {' '}(incl. {unestimatedSites.total.toLocaleString()} not estimated — N/A: {unestimatedSites.byType.slice(0, 3).map(t => t.raw).join(', ')}
                {unestimatedSites.byType.length > 3 ? ` +${unestimatedSites.byType.length - 3} more` : ''})
              </span>
            )}
            {/* Contract prices quoted in a unit nothing converts. Sits in the
                headline rather than inside a tab because the figure it
                affects is read from the Contract Overview and the Supplier
                Contracts rollup, neither of which is on screen here — by the
                time you're looking at one, nothing is left to tell you. */}
            {contractPriceUomFlags && (
              <span
                style={{
                  color: '#92400E', background: '#FEF3C7', border: '1px solid #FCD34D',
                  borderRadius: 999, padding: '0.05rem 0.5rem', fontWeight: 700,
                  marginLeft: '0.35rem', cursor: 'help', whiteSpace: 'nowrap',
                }}
                title={`${contractPriceUomFlags.detail}.\n\nContract prices are carried exactly as the file wrote them — nothing converts between units — but every column that reports one calls it ${priceUomLabel('electric')} or ${priceUomLabel('gas')}. A dekatherm is ten therms, so a $4.50/Dth price read as $/therm reports 10× the real rate; $45/MWh read as $/kWh reports 1000×. The Supplier Contracts rollup also averages prices across sites by consumption, which mixes units where they differ.\n\nRestate the affected prices in ${priceUomLabel('electric')} / ${priceUomLabel('gas')} in the source file, or read those columns as the units listed above.`}
              >
                ⚠ {contractPriceUomFlags.total.toLocaleString()} contract price{contractPriceUomFlags.total === 1 ? '' : 's'} not in {priceUomLabel('electric')} or {priceUomLabel('gas')}
              </span>
            )}
            {matchStats && (
              <>
                {' '}· <strong style={{ color: '#166534' }}>{matchStats.matched}</strong>/{matchStats.total} matched to utility lookup
                {matchStats.suggestedTotal > 0 && (
                  <>
                    {' '}· <strong
                      style={{ color: matchStats.suggestedPct === 100 ? '#166534' : '#92400E' }}
                      title={`${matchStats.suggestedDecided} of ${matchStats.suggestedTotal} unique fuzzy supplier suggestions accepted (✓) or rejected (✗). Use the ✓/✗ buttons in the supplier columns to decide the rest.`}
                    >{matchStats.suggestedDecided}</strong>/{matchStats.suggestedTotal} supplier suggestions mapped ({matchStats.suggestedPct}%)
                  </>
                )}
                {matchStats.costedSites > 0 && (
                  <>
                    {' '}· Est. annual spend <strong style={{ color: '#5B21B6' }}>{formatMoney(matchStats.totalCost)}</strong>
                    {' '}(<span style={{ color: '#92400E' }}>{formatMoney(matchStats.electricCost)} electric</span>
                    {' '}+ <span style={{ color: '#1E3A8A' }}>{formatMoney(matchStats.gasCost)} gas</span>)
                    {' '}across {matchStats.costedSites} site{matchStats.costedSites === 1 ? '' : 's'}
                  </>
                )}
              </>
            )}
            </div>
          </div>
          {cleanSitesData.length === 0 && (
            <div className={styles.subtitle}>
              Drop an Excel/CSV file or paste tab-separated rows (⌘V / Ctrl+V) anywhere on this page.
            </div>
          )}
          {missingStats.total > 0 && (
            <div style={{ marginTop: 4 }}>
              {missingStats.anyMissing > 0 ? (
                <span
                  title={`Missing breakdown:\n${[
                    missingStats.noZip > 0 ? `  • ${missingStats.noZip} no zip code` : null,
                    missingStats.noElectric > 0 ? `  • ${missingStats.noElectric} no electric consumption (actual or estimate)` : null,
                    missingStats.noGas > 0 ? `  • ${missingStats.noGas} no gas consumption (actual or estimate)` : null,
                  ].filter(Boolean).join('\n')}\n\nFirst ${missingStats.samples.length} site${missingStats.samples.length === 1 ? '' : 's'}:\n${missingStats.samples.join('\n')}`}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0.2rem 0.55rem', borderRadius: 999, background: '#FEF3C7', border: '1px solid #FCD34D', color: '#92400E', fontSize: '0.72rem', fontWeight: 600 }}
                >
                  <span aria-hidden="true">⚠</span>
                  <span>
                    {missingStats.anyMissing} of {missingStats.total} site{missingStats.total === 1 ? '' : 's'} missing data
                  </span>
                  <span style={{ color: '#78350F', fontWeight: 500 }}>
                    ({[
                      missingStats.noZip > 0 ? `${missingStats.noZip} no zip` : null,
                      missingStats.noElectric > 0 ? `${missingStats.noElectric} no electric consumption` : null,
                      missingStats.noGas > 0 ? `${missingStats.noGas} no gas consumption` : null,
                    ].filter(Boolean).join(' · ')})
                  </span>
                </span>
              ) : (
                <span
                  title="Every uploaded site has a zip code and a consumption value (actual or property-type estimate) for both electric and gas."
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0.2rem 0.55rem', borderRadius: 999, background: '#DCFCE7', border: '1px solid #86EFAC', color: '#166534', fontSize: '0.72rem', fontWeight: 600 }}
                >
                  <span aria-hidden="true">✓</span>
                  <span>All {missingStats.total} site{missingStats.total === 1 ? '' : 's'} have zip + electric + gas data</span>
                </span>
              )}
              {missingStats.estimatedZip > 0 && (
                <span
                  title={`${missingStats.estimatedZip} site${missingStats.estimatedZip === 1 ? '' : 's'} had no zip code, so a representative zip was estimated from the city + state using zips already in the utility lookup. Estimated zips show "(est)" in the zip column and drive the utility / state / rate match like a real zip.`}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 8, padding: '0.2rem 0.55rem', borderRadius: 999, background: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1E40AF', fontSize: '0.72rem', fontWeight: 600 }}
                >
                  <span aria-hidden="true">📍</span>
                  <span>{missingStats.estimatedZip} zip{missingStats.estimatedZip === 1 ? '' : 's'} estimated from city + state</span>
                </span>
              )}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input
            ref={sitesFileRef}
            type="file"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleSitesUpload}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            onClick={downloadSitesTemplate}
            title="Download a blank Excel template with every column the Utility Lookup page accepts, plus three sample rows and an Instructions tab. Required columns (Site Name, Zip) are highlighted in green."
            style={{ padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', background: '#fff', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit', color: '#1E293B' }}
          >
            ⬇ Template
          </button>
          <button
            type="button"
            onClick={() => sitesFileRef.current?.click()}
            title="Upload an Excel or CSV file of company sites. The first column matching a zip/postal header is used for utility lookup."
            style={{ padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', background: '#fff', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            {sitesData.length ? 'Replace Sites File' : 'Upload Sites File'}
          </button>
          <button
            type="button"
            onClick={() => setPropertyTypeModalOpen(true)}
            title="Map the Property Type values in your site list onto the types we support. Unmapped types get no consumption or account estimates; mappings are remembered and reused across uploads."
            style={{
              padding: '0.4rem 0.8rem', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit',
              border: unmappedPropertyTypes.length > 0 ? '1px solid #FCA5A5' : '1px solid var(--color-border)',
              background: unmappedPropertyTypes.length > 0 ? '#FEF2F2' : '#fff',
              color: unmappedPropertyTypes.length > 0 ? '#B91C1C' : '#1E293B',
              fontWeight: unmappedPropertyTypes.length > 0 ? 600 : 400,
            }}
          >
            🏷 Property Types{unmappedPropertyTypes.length > 0 ? ` (${unmappedPropertyTypes.length})` : ''}
          </button>
          {sitesData.length > 0 && (
            <button
              type="button"
              onClick={openUpdateColumnMapping}
              title="Re-open the column mapping modal against the currently loaded sites. Adjust which file column drives each Utility Lookup field without re-uploading. (Columns dropped on the original import aren't recoverable: re-upload the source file to bring them back.)"
              style={{ padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', background: '#fff', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Update Column Mapping
            </button>
          )}
          {/* Whether the leased locations in this list carry procurement
              savings. Sits with the export buttons because that's all it
              changes — the exports' savings figures — and only shows up
              when the list has leased sites to decide about. */}
          {sitesData.length > 0 && leasedSiteCount > 0 && (
            <SavingsScopeToggle
              count={leasedSiteCount}
              included={includeLeasedSavings}
              onChange={setIncludeLeasedSavings}
            />
          )}
          {sitesData.length > 0 && (
            <button
              type="button"
              onClick={async () => {
                // Surface failures: the export is a big async pipeline
                // (60+ tranches, multiple worksheets, a live chart
                // injection) and any thrown error inside it would
                // otherwise vanish into an unhandled promise rejection,
                // leaving the user staring at a button that "does
                // nothing." Console.error keeps the stack trace for
                // diagnosis; alert tells the user the export tripped.
                try {
                  await exportMasterAnalysis();
                } catch (err) {
                  console.error('Master Analysis export failed:', err);
                  alert(`Master Analysis export failed:\n\n${err?.message || err}`);
                }
              }}
              title="Download one master workbook that combines the Indicative Savings and Building Compliance (Excel) tabs plus a Corporate Compliance tab and a Compliance Report Methodology tab."
              style={{ padding: '0.4rem 0.8rem', border: '1px solid #005A9E', background: '#005A9E', color: '#fff', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}
            >
              ⬇ Master Analysis
            </button>
          )}
          {sitesData.length > 0 && (
            <button
              type="button"
              onClick={() => {
                // Default target: the company mapped to this page (the
                // portfolio company). If it resolves to a known prospect,
                // save straight to it — no picker. Only when nothing is
                // mapped (or the mapped name has no matching prospect) do
                // we fall back to the search picker, pre-seeded with the
                // mapped name so the user can confirm / pick.
                const mapped = portfolioCompanyName;
                if (mapped) {
                  const target = mapped.toLowerCase();
                  const match = (prospects || []).find(
                    (p) => p.company && p.company.trim().toLowerCase() === target,
                  );
                  if (match) {
                    saveMasterAnalysisToCompany(match);
                    return;
                  }
                }
                setSavePickerSearch(mapped || '');
                setSaveStatus({ state: 'idle', message: '' });
              }}
              title={savedAnalysis
                ? `Replace ${portfolioCompanyName}'s saved Master Analysis (last saved ${describeAnalysisSave(savedAnalysis)}) with the one currently on this page. The saved file shows up on that company's prospect / client popup and can be downloaded from there.`
                : "Save the current Master Analysis to the company mapped to this page. If no company is mapped, search for one. The saved file shows up on that company's prospect / client popup and can be downloaded from there."}
              style={{ padding: '0.4rem 0.8rem', border: '1px solid #009530', background: '#fff', color: '#009530', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}
            >
              💾 {portfolioCompanyName
                ? `${savedAnalysis ? 'Update' : 'Save to'} ${portfolioCompanyName}`
                : 'Save to Company'}
            </button>
          )}
          {/* This company already has one saved. Says so before the save is
              clicked, so a save that silently replaces the previous analysis
              isn't a surprise — and dates it, since "is what's saved current?"
              is the actual question. */}
          {sitesData.length > 0 && savedAnalysis && (
            <span
              title={`${portfolioCompanyName} has a Master Analysis saved${savedAnalysis.savedAt ? ` on ${new Date(savedAnalysis.savedAt).toLocaleString()}` : ''}.${savedAnalysis.fileName ? `\n${savedAnalysis.fileName}` : ''}${savedAnalysis.sizeBytes ? ` · ${(savedAnalysis.sizeBytes / (1024 * 1024)).toFixed(1)} MB` : ''}\n\nSaving again replaces it.`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                padding: '0.25rem 0.55rem', borderRadius: 999,
                background: '#DCFCE7', border: '1px solid #86EFAC', color: '#166534',
                fontSize: '0.72rem', fontWeight: 600, whiteSpace: 'nowrap',
              }}
            >
              ✓ Analysis saved {describeAnalysisSave(savedAnalysis)}
            </span>
          )}
          {sitesData.length > 0 && (
            <button
              type="button"
              onClick={handleRemoveSites}
              title="Remove the uploaded sites list"
              style={{ padding: '0.4rem 0.8rem', border: '1px solid #FCA5A5', background: '#fff', color: '#DC2626', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Remove Sites
            </button>
          )}
        </div>
        {saveStatus.state !== 'idle' && (
          <div style={{
            marginTop: '0.4rem',
            padding: '0.35rem 0.6rem',
            fontSize: '0.72rem',
            borderRadius: 6,
            background: saveStatus.state === 'success' ? '#DCFCE7' : saveStatus.state === 'error' ? '#FEE2E2' : '#F1F5F9',
            color: saveStatus.state === 'success' ? '#166534' : saveStatus.state === 'error' ? '#991B1B' : '#475569',
            fontFamily: 'inherit',
          }}>{saveStatus.message}</div>
        )}
      </div>

      <CompanySiteListLookup
        prospects={prospects}
        companySiteLists={settings?.companySiteLists || {}}
        onUseCompany={setPortfolioCompanyName}
        resetSignal={lookupResetSignal}
        activeCompany={portfolioCompanyName}
        onSelectProspect={onSelectProspect}
        onImportAnalysis={importMasterAnalysisFromCompany}
        importStatus={importStatus}
      />

      {propertyTypeModalOpen && (
        <PropertyTypeMappingModal
          items={propertyTypeMappingItems}
          value={propertyTypeMap}
          onClose={() => setPropertyTypeModalOpen(false)}
          onSave={(draft) => {
            // Merge rather than replace: mappings for values not in this
            // upload stay put, so a curated list builds up over time.
            const next = { ...propertyTypeMap };
            for (const [k, v] of Object.entries(draft)) {
              if (v) next[k] = v; else delete next[k];
            }
            persistPropertyTypeMap(next);
            setPropertyTypeModalOpen(false);
          }}
        />
      )}

      {savePickerSearch !== null && createPortal(
        <div
          onClick={() => setSavePickerSearch(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.4)', zIndex: 10000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 8, width: 'min(440px, 92vw)', maxHeight: '70vh',
              display: 'flex', flexDirection: 'column', boxShadow: '0 12px 40px rgba(15, 23, 42, 0.2)',
            }}
          >
            <div style={{ padding: '0.9rem 1rem 0.5rem', borderBottom: '1px solid #E2E8F0' }}>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0F172A' }}>Save Master Analysis to a Company</div>
              <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: '0.2rem' }}>Pick a company: the analysis appears on its prospect / client popup.</div>
              <input
                type="text"
                value={savePickerSearch}
                onChange={(e) => setSavePickerSearch(e.target.value)}
                placeholder="Search companies…"
                autoFocus
                style={{
                  marginTop: '0.6rem', width: '100%', padding: '0.45rem 0.6rem',
                  border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.8rem', fontFamily: 'inherit',
                }}
              />
            </div>
            <div style={{ overflowY: 'auto', flex: 1, padding: '0.3rem 0' }}>
              {(() => {
                const q = String(savePickerSearch || '').trim().toLowerCase();
                const list = (prospects || [])
                  .filter(p => p.company)
                  .filter(p => !q || p.company.toLowerCase().includes(q))
                  .sort((a, b) => a.company.localeCompare(b.company))
                  .slice(0, 60);
                if (list.length === 0) {
                  return <div style={{ padding: '0.6rem 1rem', fontSize: '0.72rem', color: '#94A3B8' }}>No matching companies.</div>;
                }
                return list.map(p => (
                  <div
                    key={p.id}
                    onClick={() => saveMasterAnalysisToCompany(p)}
                    style={{
                      padding: '0.4rem 1rem', fontSize: '0.78rem', color: '#1E293B', cursor: 'pointer',
                    }}
                    onMouseOver={(e) => e.currentTarget.style.background = '#F1F5F9'}
                    onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{ fontWeight: 600 }}>{p.company}</div>
                    {(p.status || p.cdm) && (
                      <div style={{ fontSize: '0.68rem', color: '#64748B', marginTop: '0.1rem' }}>
                        {[p.status, p.cdm].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </div>
                ));
              })()}
            </div>
            <div style={{ padding: '0.6rem 1rem', borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'flex-end', gap: '0.4rem' }}>
              <button
                type="button"
                onClick={() => setSavePickerSearch(null)}
                style={{ padding: '0.35rem 0.8rem', background: '#fff', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' }}
              >Cancel</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Collapsed by default: the data-source bars below are hidden until
          the user expands them. A compact summary keeps the loaded-state
          confirmation without the full Replace/Clear/Imported clutter. */}
      <div className={styles.utilityBar} style={{ padding: '0.4rem 1.25rem', justifyContent: 'flex-end' }}>
        {!showDataSources && (
          <span style={{ color: '#94A3B8', fontSize: '0.7rem' }}>
            {utilMeta
              ? `Utility lookup: ${utilMeta.zipCount?.toLocaleString() || '?'} zips`
              : 'No utility lookup'}
            {' · '}
            {zipFbMeta
              ? `Fallback zips: ${zipFbMeta.entryCount?.toLocaleString() || '?'}`
              : 'No fallback zips'}
          </span>
        )}
        <button
          type="button"
          className={styles.utilityBarButton}
          onClick={() => setShowDataSources(v => !v)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
        >
          <span style={{ fontSize: '0.6rem', lineHeight: 1 }}>{showDataSources ? '▾' : '▸'}</span>
          Data sources
        </button>
      </div>

      {showDataSources && (
      <>
      <div className={styles.utilityBar}>
        <input
          ref={utilityFileRef}
          type="file"
          accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={handleUtilityFileSelect}
          style={{ display: 'none' }}
        />
        {utilMeta ? (
          <>
            <span className={styles.utilityBarLoaded}>
              ✓ Utility lookup loaded: {utilMeta.zipCount?.toLocaleString() || '?'} zip codes
              {utilMeta.fileName && <> · <span style={{ color: '#64748B', fontWeight: 500 }}>{utilMeta.fileName}</span></>}
            </span>
            {/* A zip that appears under two countries can't say which one a
                site on it is in, so those keys carry no country and the site
                falls back to its own State / zip. Worth naming: it's the
                difference between "the file is fine" and "these zips are
                doing nothing for you". */}
            {utilMeta.conflictingCountryZips > 0 && (
              <span
                style={{ color: '#B45309', fontWeight: 600, fontSize: '0.72rem' }}
                title="These zips appear in the file under more than one country (US ZIPs and Mexican códigos postales are both five digits and overlap). Their country is left unset, so sites on them take the country from their own State / Country columns instead."
              >
                · {utilMeta.conflictingCountryZips.toLocaleString()} zip{utilMeta.conflictingCountryZips === 1 ? '' : 's'} listed under two countries
              </span>
            )}
            <button
              className={styles.utilityBarButton}
              onClick={() => utilityFileRef.current?.click()}
              disabled={utilityBusy}
            >Replace</button>
            <button className={styles.utilityBarDanger} onClick={handleClearUtility} disabled={utilityBusy}>Clear</button>
          </>
        ) : (
          <>
            <span className={styles.utilityBarEmpty}>
              No utility lookup loaded. Upload a file with Zip / Commodity Type / Utility columns (plus optional City / Country).
            </span>
            <button
              className={styles.utilityBarButton}
              onClick={() => utilityFileRef.current?.click()}
              disabled={utilityBusy}
            >{utilityBusy ? 'Working…' : 'Upload Utility Lookup'}</button>
          </>
        )}
        {utilityLoaded && utility && utilMeta?.importedAt && (
          <span style={{ color: '#94A3B8', fontSize: '0.7rem', marginLeft: 'auto' }}>
            Imported {new Date(utilMeta.importedAt).toLocaleDateString()}
          </span>
        )}
      </div>

      {/* Fallback zip table — supplies a zip for sites that arrive with a
          city + state but no zip, ahead of the zips inferred from the
          utility lookup. */}
      <div className={styles.utilityBar}>
        <input
          ref={zipFallbackFileRef}
          type="file"
          accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={handleZipFallbackFileSelect}
          style={{ display: 'none' }}
        />
        {zipFbMeta ? (
          <>
            <span className={styles.utilityBarLoaded}>
              ✓ Fallback zip list loaded: {zipFbMeta.entryCount?.toLocaleString() || '?'} city/state → zip entries
              {zipFbMeta.fileName && <> · <span style={{ color: '#64748B', fontWeight: 500 }}>{zipFbMeta.fileName}</span></>}
            </span>
            <button
              className={styles.utilityBarButton}
              onClick={() => zipFallbackFileRef.current?.click()}
              disabled={zipFallbackBusy}
            >Replace</button>
            <button className={styles.utilityBarDanger} onClick={handleClearZipFallback} disabled={zipFallbackBusy}>Clear</button>
          </>
        ) : (
          <>
            <span className={styles.utilityBarEmpty}>
              No fallback zip list loaded. Upload a file with City / State / Zip columns to estimate zips for sites missing one.
            </span>
            <button
              className={styles.utilityBarButton}
              onClick={() => zipFallbackFileRef.current?.click()}
              disabled={zipFallbackBusy}
            >{zipFallbackBusy ? 'Working…' : 'Upload Fallback Zips'}</button>
          </>
        )}
        {zipFbMeta?.importedAt && (
          <span style={{ color: '#94A3B8', fontSize: '0.7rem', marginLeft: 'auto' }}>
            Imported {new Date(zipFbMeta.importedAt).toLocaleDateString()}
          </span>
        )}
      </div>
      </>
      )}

      {/* The "Consumption columns" bar (Electric / Gas pickers) used to sit
          here. Removed — the same electric/gas column choices are set from
          the Update Column Mapping popup, so the bar was a duplicate. */}

      {uploadError && (
        <div style={{ margin: '0.5rem 1.25rem', padding: '0.5rem 0.75rem', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 6, color: '#991B1B', fontSize: '0.8rem' }}>
          {uploadError}
        </div>
      )}

      {/* Missing Tenure (Owned / Leased). Above the summary cards because
          it changes how every figure under it should be read: with no
          tenure on the upload, the compliance subtabs screen the whole
          list and the savings run on the full deregulated spend. */}
      {showTenureWarning && (
        <TenureWarningBanner
          coverage={tenureStats}
          mapped={!!ownershipOverride}
          onFixMapping={openUpdateColumnMapping}
          onDismiss={() => setTenureWarningDismissed(tenureWarningKey)}
        />
      )}

      {analysisSummary && (() => {
        const s = analysisSummary;
        const m = marketSummary || { total: s.total, electric: { deregulated: 0, regulated: 0, unknown: s.total }, gas: { deregulated: 0, regulated: 0, unknown: s.total } };
        const ELEC = '#92400E';
        const GAS = '#1E3A8A';
        const SLATE = '#475569';
        const MUTED = '#94A3B8';
        const cardStyle = { border: '1px solid #E2E8F0', borderRadius: 8, background: '#FFFFFF', padding: '0.65rem 0.85rem' };
        const cardTitleStyle = { fontSize: '0.72rem', fontWeight: 700, color: '#0F172A', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.45rem' };
        const rowStyle = { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.5rem', padding: '0.2rem 0', borderBottom: '1px dashed #F1F5F9' };
        // Tone per row — a tinted background and a left accent bar so the
        // shape of the portfolio reads at a glance. Green / amber / red
        // means best / qualified / worst in whatever that card measures:
        // actual vs estimated vs missing on Consumption and Cost, taken
        // from the source vs derived from the zip vs unknown on Utility
        // Companies, and deregulated (a sourcing opportunity) vs
        // regulated vs unknown on Market. Only applied when the row
        // actually carries a value; a zero row stays plain so empty
        // cards don't light up.
        const toneRowStyle = (bg, bar) => ({ ...rowStyle, background: bg, borderLeft: `3px solid ${bar}`, borderRadius: 4, padding: '0.2rem 0.4rem', margin: '0 -0.4rem' });
        const ROW_TONES = {
          good:   toneRowStyle('#F0FDF4', '#16A34A'),
          warn:   toneRowStyle('#FFFBEB', '#F59E0B'),
          danger: toneRowStyle('#FEF2F2', '#DC2626'),
        };
        const labelStyle = (color) => ({ fontSize: '0.72rem', color, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
        const valueStyle = { fontSize: '0.78rem', fontWeight: 600, color: '#0F172A', fontVariantNumeric: 'tabular-nums' };
        const subStyle = { fontSize: '0.65rem', color: MUTED, fontWeight: 500, marginLeft: '0.35rem' };
        const fmtInt = (n) => Math.round(n).toLocaleString();
        const fmtPct = (num, den) => den > 0 ? `${Math.round((num / den) * 100)}%` : '0%';
        // `tone` is 'good' | 'warn' | 'danger' | null. The commodity
        // colour stays on the label for good/warn so the electric / gas
        // distinction survives the tint; danger keeps its red label.
        const sumLine = (color, label, value, sub, tone = null) => (
          <div style={ROW_TONES[tone] || rowStyle}>
            <span style={labelStyle(tone === 'danger' ? '#991B1B' : color)}>{label}</span>
            <span>
              <span style={tone === 'danger' ? { ...valueStyle, color: '#991B1B' } : valueStyle}>{value}</span>
              {sub && <span style={subStyle}>{sub}</span>}
            </span>
          </div>
        );
        // Tone helpers: colour only once the row has something in it.
        const good = (n) => (n > 0 ? 'good' : null);
        const warn = (n) => (n > 0 ? 'warn' : null);
        const bad  = (n) => (n > 0 ? 'danger' : null);
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', margin: '0.5rem 1.25rem 0.75rem' }}>
            <div style={cardStyle}>
              <div style={cardTitleStyle}>Consumption</div>
              {sumLine(ELEC, 'Electric: Actual',    `${fmtInt(s.consumption.electric.actual)} kWh`,   `${s.consumption.electric.actualSites} site${s.consumption.electric.actualSites === 1 ? '' : 's'}`, good(s.consumption.electric.actual))}
              {sumLine(ELEC, 'Electric: Estimated', `${fmtInt(s.consumption.electric.est)} kWh`,      `${s.consumption.electric.estSites} site${s.consumption.electric.estSites === 1 ? '' : 's'}`, warn(s.consumption.electric.est))}
              {sumLine(SLATE, 'Electric: Missing',  `${fmtInt(s.consumption.electric.missingSites)} sites`, null, bad(s.consumption.electric.missingSites))}
              {sumLine(GAS,  'Gas: Actual',         `${fmtInt(s.consumption.gas.actual)} therms`,     `${s.consumption.gas.actualSites} site${s.consumption.gas.actualSites === 1 ? '' : 's'}`, good(s.consumption.gas.actual))}
              {sumLine(GAS,  'Gas: Estimated',      `${fmtInt(s.consumption.gas.est)} therms`,        `${s.consumption.gas.estSites} site${s.consumption.gas.estSites === 1 ? '' : 's'}`, warn(s.consumption.gas.est))}
              {sumLine(SLATE, 'Gas: Missing',       `${fmtInt(s.consumption.gas.missingSites)} sites`, null, bad(s.consumption.gas.missingSites))}
            </div>
            <div style={cardStyle}>
              <div style={cardTitleStyle}>Cost</div>
              {sumLine(ELEC, 'Electric: Actual',    formatMoney(s.cost.electric.actual), `${s.cost.electric.actualSites} site${s.cost.electric.actualSites === 1 ? '' : 's'}`, good(s.cost.electric.actual))}
              {sumLine(ELEC, 'Electric: Estimated', formatMoney(s.cost.electric.est),    `${s.cost.electric.estSites} site${s.cost.electric.estSites === 1 ? '' : 's'}`, warn(s.cost.electric.est))}
              {sumLine(SLATE, 'Electric: Missing',  `${fmtInt(s.cost.electric.missingSites)} sites`, null, bad(s.cost.electric.missingSites))}
              {sumLine(GAS,  'Gas: Actual',         formatMoney(s.cost.gas.actual),      `${s.cost.gas.actualSites} site${s.cost.gas.actualSites === 1 ? '' : 's'}`, good(s.cost.gas.actual))}
              {sumLine(GAS,  'Gas: Estimated',      formatMoney(s.cost.gas.est),         `${s.cost.gas.estSites} site${s.cost.gas.estSites === 1 ? '' : 's'}`, warn(s.cost.gas.est))}
              {sumLine(SLATE, 'Gas: Missing',       `${fmtInt(s.cost.gas.missingSites)} sites`, null, bad(s.cost.gas.missingSites))}
            </div>
            <div style={cardStyle}>
              <div style={cardTitleStyle} title="Source = the upload's supplier column named a utility we recognized. Zip lookup = no supplier in the source, utility derived from the rates file via zip code.">Utility Companies</div>
              {sumLine(ELEC, 'Electric: From Supplier',  fmtInt(s.utility.electric.fromSupplier), fmtPct(s.utility.electric.fromSupplier, s.total), good(s.utility.electric.fromSupplier))}
              {sumLine(ELEC, 'Electric: From Zip Lookup', fmtInt(s.utility.electric.fromZip),     fmtPct(s.utility.electric.fromZip, s.total), warn(s.utility.electric.fromZip))}
              {sumLine(SLATE, 'Electric: Unknown',        fmtInt(s.utility.electric.unknown),     fmtPct(s.utility.electric.unknown, s.total), bad(s.utility.electric.unknown))}
              {sumLine(GAS,  'Gas: From Supplier',        fmtInt(s.utility.gas.fromSupplier),     fmtPct(s.utility.gas.fromSupplier, s.total), good(s.utility.gas.fromSupplier))}
              {sumLine(GAS,  'Gas: From Zip Lookup',      fmtInt(s.utility.gas.fromZip),          fmtPct(s.utility.gas.fromZip, s.total), warn(s.utility.gas.fromZip))}
              {sumLine(SLATE, 'Gas: Unknown',             fmtInt(s.utility.gas.unknown),          fmtPct(s.utility.gas.unknown, s.total), bad(s.utility.gas.unknown))}
            </div>
            <div style={cardStyle}>
              <div style={cardTitleStyle} title="Market structure per site, on the same rule the Master Analysis uses: so these counts match its Deregulated Sites totals. US/CA: the state's deregulation map decides whether the market is competitive; inside a competitive state the site's utility (or a supplier on file) decides whether that site counts, so municipals and coops drop out. International sites follow the country reference. Deregulated = supplier choice, a sourcing opportunity. Regulated = single-utility market. Unknown = no recognized state or country, or a competitive state with no utility / supplier on file yet.">Market</div>
              {sumLine(ELEC, 'Electric: Deregulated', fmtInt(m.electric.deregulated), fmtPct(m.electric.deregulated, m.total), good(m.electric.deregulated))}
              {sumLine(ELEC, 'Electric: Regulated',   fmtInt(m.electric.regulated),   fmtPct(m.electric.regulated, m.total), warn(m.electric.regulated))}
              {sumLine(SLATE, 'Electric: Unknown',     fmtInt(m.electric.unknown),     fmtPct(m.electric.unknown, m.total), bad(m.electric.unknown))}
              {sumLine(GAS,  'Gas: Deregulated',       fmtInt(m.gas.deregulated),      fmtPct(m.gas.deregulated, m.total), good(m.gas.deregulated))}
              {sumLine(GAS,  'Gas: Regulated',         fmtInt(m.gas.regulated),        fmtPct(m.gas.regulated, m.total), warn(m.gas.regulated))}
              {sumLine(SLATE, 'Gas: Unknown',          fmtInt(m.gas.unknown),          fmtPct(m.gas.unknown, m.total), bad(m.gas.unknown))}
            </div>
          </div>
        );
      })()}

      <div className={styles.searchRow}>
        <input
          className={styles.searchInput}
          type="text"
          placeholder="Search sites..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && <span className={styles.resultCount}>{filtered.length} results</span>}
        {sitesData.length > 0 && (
          <button
            type="button"
            className={massEditOn ? styles.massToggleOn : styles.massToggle}
            onClick={() => setMassEditOn(v => !v)}
            title="Set one column to the same value across the sites you pick"
          >
            {massEditOn ? 'Done editing' : 'Mass edit'}
            {/* The count follows the button out of the mode: the
                selection survives the toggle, so hiding it would leave
                sites picked with nothing on screen saying so. */}
            {!massEditOn && selectedSiteIds.size > 0 && ` (${selectedSiteIds.size} selected)`}
          </button>
        )}
      </div>

      {massEditOn && sitesData.length > 0 && (
        <div className={styles.massBar}>
          <label className={styles.massSelectAll} title="Select every site the current search leaves on screen">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              ref={el => { if (el) el.indeterminate = selectedVisibleCount > 0 && !allVisibleSelected; }}
              disabled={selectableSiteIds.length === 0}
              onChange={toggleSelectAllVisible}
              style={{ cursor: 'pointer', accentColor: 'var(--color-accent)' }}
            />
            Select all ({selectableSiteIds.length})
          </label>
          <span className={styles.massCount} data-on={selectedSiteIds.size > 0 ? 'true' : 'false'}>
            {selectedSiteIds.size} selected
          </span>
          <select
            className={styles.massInput}
            value={massHeader}
            onChange={e => { setMassHeader(e.target.value); setMassValue(''); setMassStatus(null); }}
          >
            <option value="">Column to set…</option>
            {editableSiteColumns.map(c => (
              <option key={c.header} value={c.header}>
                {c.label}{c.sub ? ` — ${c.sub}` : ''}
              </option>
            ))}
          </select>
          {/* A closed list gets a picker: the page only understands the
              spellings its normalizers know, and a typed "Owned (mostly)"
              reads downstream as no answer at all. */}
          {massColumn && (massColumn.options ? (
            <select
              className={styles.massInput}
              value={massValue}
              onChange={e => setMassValue(e.target.value)}
            >
              <option value="">(blank)</option>
              {massColumn.options.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            /* Text even for the number columns, so a figure pasted the
               way a spreadsheet writes it ("1,250,000", "$18,400") isn't
               rejected by the browser before it can be parsed. */
            <input
              className={styles.massInput}
              type="text"
              inputMode={massColumn.type === 'number' ? 'decimal' : 'text'}
              value={massValue}
              onChange={e => setMassValue(e.target.value)}
              placeholder={massColumn.type === 'number' ? `New ${massColumn.label} (number)…` : `New ${massColumn.label}…`}
            />
          ))}
          <button
            type="button"
            className={styles.massApply}
            onClick={applySiteMassEdit}
            disabled={massBusy || !massColumn || selectedSiteIds.size === 0}
            title={massColumn
              ? `Write this value into the “${massColumn.sub || massColumn.label}” column on every selected site`
              : 'Pick a column to set'}
          >
            {massBusy ? 'Applying…' : `Apply to ${selectedSiteIds.size}`}
          </button>
          {selectedSiteIds.size > 0 && (
            <button
              type="button"
              className={styles.massClear}
              onClick={() => { setSelectedSiteIds(new Set()); setMassStatus(null); }}
            >Clear selection</button>
          )}
          {massStatus && (
            <span className={massStatus.type === 'error' ? styles.massError : styles.massOk}>
              {massStatus.message}
            </span>
          )}
          {/* Said once, here: the edit rewrites the uploaded rows, and
              every derived number on this page is computed from them. */}
          <span className={styles.massNote}>
            Writes into the uploaded site rows and saves — the utility, rate, cost and compliance
            figures re-derive from the new value.
          </span>
        </div>
      )}

      {!sitesLoaded ? (
        <div style={{ padding: '2rem 1.25rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
          Loading…
        </div>
      ) : sitesData.length === 0 ? (
        <div style={{ padding: '2rem 1.25rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
          No sites loaded. Click <strong>Upload Sites File</strong> or drop a Portfolio Companies workbook anywhere on this page: we'll pick up the <strong>Site List</strong> tab automatically.
          <div style={{ marginTop: '0.5rem', fontSize: '0.78rem' }}>
            The first column matching a "zip"/"postal" header drives the utility lookup.
          </div>
        </div>
      ) : (
        <DataTable
          key={tableId}
          tableId={tableId}
          columns={tableColumns}
          rows={filtered}
          alwaysVisible={alwaysVisible}
          emptyMessage="No matching sites"
          exportFileName={divisionScopedName('Indicative Site Analysis')}
          exportPrimarySheetName="Raw Data"
          exportExtraSheets={exportExtraSheets}
          onExport={handleExport}
          settings={settings}
          updateSettings={updateSettings}
        />
      )}

      {sitesMappingModal && createPortal(
        (() => {
          const TARGET_FIELDS = [
            { key: 'siteName', label: 'Site Name', required: true, hint: 'Row label / blank-row filter.' },
            { key: 'companyName', label: 'Company Name', required: false, hint: 'Company / portfolio the site belongs to. Surfaced as a column on the Utility Lookup page and used to name the Indicative Savings export file (e.g. "Acme Corp_Indicative Savings Analysis.xlsx").' },
            { key: 'division', label: 'Division/Portfolio Company', required: false, hint: 'Division / portfolio company / business unit / operating brand the site belongs to — one level under Company Name. Passthrough only; surfaced as its own column on the Utility Lookup page so a portfolio spanning several divisions can be read and filtered apart.' },
            { key: 'address', label: 'Address', required: false, hint: 'Street address of the site. Optional reference field: surfaced on the Site Detail and Contract Overview tabs of the Indicative Savings export.' },
            { key: 'city', label: 'City', required: false, hint: 'City / town of the site. Optional reference field. Falls back to the utility-rates file lookup when blank.' },
            { key: 'state', label: 'State / Province', required: false, hint: 'State or province. Optional reference field. Auto-derived from Zip for US / Canada sites when blank.' },
            { key: 'zip', label: 'Zip / Postal Code', required: false, hint: 'Required for US and Canada sites: drives the utility lookup. Leave blank on international rows; mapping the column at all is optional if the file has no US / Canada sites.' },
            { key: 'country', label: 'Country', required: false, hint: 'Country of the site. Falls back to the utility-rates file when blank.' },
            { key: 'propertyType', label: 'Property Type', required: false, hint: 'Building / use type (Office, Hospital, Warehouse, etc.): drives the per-property-type consumption + account-count estimates surfaced on the page and on the Indicative Savings export.' },
            { key: 'segment', label: 'Segment (Commercial / Industrial)', required: false, hint: 'Customer class for rate selection. Values like "Commercial"/"Industrial" (or C / I) override the segment otherwise inferred from Property Type. Industrial sites use the state industrial indicative rate; everything else uses commercial.' },
            { key: 'ownership', label: 'Ownership (Owned / Leased)', required: false, hint: 'Whether the building is owned or leased. Values like "Owned"/"Leased" (plus common variants ("Own", "Owner-Occupied", "Tenant", "Leasehold", "O"/"L")), are folded onto the two labels; anything else is shown as-is so nothing is lost.' },
            { key: 'siteDescription', label: 'Site Description', required: false, hint: 'Free-text annotation for the site (building name, internal code, notes). Passthrough only; surfaced next to Property Type on the Utility Lookup page.' },
            { key: 'propertySize', label: 'Size (ft²)', required: false, hint: 'Square footage of the site. Scales the property-type reference consumption linearly. Optional: when blank the reference size for the property type is used as-is.' },
            { key: 'electric', label: 'Annual Electric Consumption', required: false, hint: 'Annual electric usage. Pair with Electric UoM to control how the value is converted to kWh for cost estimates.' },
            { key: 'electricUom', label: 'Electric UoM', required: false, hint: 'Unit of measure for the Electric column (kWh / MWh / GWh). Overrides any unit baked into the header.' },
            { key: 'gas', label: 'Annual Gas Consumption', required: false, hint: 'Annual gas usage. Pair with Gas UoM to control how the value is converted to therms for cost estimates.' },
            { key: 'gasUom', label: 'Gas UoM', required: false, hint: 'Unit of measure for the Gas column (therms / MMBtu / Dth / Mcf / Ccf / BTU). Overrides any unit baked into the header.' },
            { key: 'electricCost', label: 'Total Electric Cost ($)', required: false, hint: 'Actual annual electric spend. Used in place of the kWh × rate estimate when present.' },
            { key: 'gasCost', label: 'Total Natural Gas Cost ($)', required: false, hint: 'Actual annual gas spend. Used in place of the Dth × rate estimate when present.' },
            { key: 'electricSupplier', label: 'Electric Supplier / Vendor', required: false, hint: 'If the value matches a known utility from the rates file it goes in the Electric Utility column; otherwise it lands in the Supplier column.' },
            { key: 'electricStart', label: 'Electric Contract Start', required: false, hint: 'Start date of the existing electric supply contract.' },
            { key: 'electricEnd', label: 'Electric Contract End', required: false, hint: 'End / expiration date of the existing electric supply contract.' },
            { key: 'electricContractPrice', label: 'Electric Contract Price ($/kWh)', required: false, hint: 'Per-kWh contract price from the existing electric supply agreement.' },
            { key: 'electricContractName', label: 'Electric Contract Name', required: false, hint: 'Human-readable identifier for the existing electric contract (e.g. "Constellation - Atlanta Cluster 2024").' },
            { key: 'electricProductType', label: 'Electric Product Type', required: false, hint: 'Pricing structure of the electric contract (Fixed, Index, Block & Index, Heat Rate, etc.).' },
            { key: 'gasSupplier', label: 'Gas Supplier / Vendor', required: false, hint: 'If the value matches a known utility from the rates file it goes in the Gas Utility column; otherwise it lands in the Supplier column.' },
            { key: 'gasStart', label: 'Gas Contract Start', required: false, hint: 'Start date of the existing gas supply contract.' },
            { key: 'gasEnd', label: 'Gas Contract End', required: false, hint: 'End / expiration date of the existing gas supply contract.' },
            { key: 'gasContractPrice', label: 'Gas Contract Price ($/therm)', required: false, hint: 'Per-therm contract price from the existing gas supply agreement.' },
            { key: 'gasContractName', label: 'Gas Contract Name', required: false, hint: 'Human-readable identifier for the existing gas contract.' },
            { key: 'gasProductType', label: 'Gas Product Type', required: false, hint: 'Pricing structure of the gas contract (Fixed, NYMEX + Basis, Index, etc.).' },
          ];
          // The full set of columns that show up on the Utility Lookup
          // table after import — split into the mapped inputs above
          // and the auto-derived / lookup-driven columns the page
          // generates for free.
          const DERIVED_COLUMNS = [
            { name: 'State', from: 'looked up from Zip' },
            { name: 'Electric Utility', from: 'rates file × Zip (or Supplier when known)' },
            { name: 'Electric Market', from: 'regulated vs. deregulated rule' },
            { name: 'Segment', from: 'Commercial / Industrial: from mapped column or property type' },
            { name: 'Electric Rate', from: 'state commercial / industrial average (by segment)' },
            { name: 'Total Electric Cost', from: 'actual cost when mapped, else kWh × rate' },
            { name: 'GAC Opportunity (Ontario)', from: 'Ontario sites only: tiered by annual kWh as a Class A proxy' },
            { name: 'Gas Utility', from: 'rates file × Zip (or Supplier when known)' },
            { name: 'Gas Market', from: 'regulated vs. deregulated rule' },
            { name: 'Gas Rate', from: 'state commercial / industrial average (by segment)' },
            { name: 'Total Natural Gas Cost', from: 'actual cost when mapped, else Dth × rate' },
            { name: 'Total Est. Cost', from: 'Electric + Gas cost' },
            { name: 'Water Utility', from: 'rates file × Zip' },
            { name: 'Lookup City', from: 'rates file × Zip' },
            { name: 'Lookup Country', from: 'rates file × Zip' },
          ];
          const active = sitesMappingModal.sheets[sitesMappingModal.selectedIdx];
          const targetForHeader = {};
          for (const t of TARGET_FIELDS) {
            const h = active.mapping[t.key];
            if (h) targetForHeader[h] = t.key;
          }
          function setTargetForHeader(header, targetKey) {
            setSitesMappingModal(m => {
              if (!m) return m;
              const idx = m.selectedIdx;
              const cur = m.sheets[idx];
              const next = { ...cur.mapping };
              for (const t of TARGET_FIELDS) {
                if (next[t.key] === header) next[t.key] = '';
              }
              if (targetKey) next[targetKey] = header;
              const sheets = m.sheets.slice();
              sheets[idx] = { ...cur, mapping: next };
              return { ...m, sheets };
            });
          }
          function selectSheet(idx) {
            setSitesMappingModal(m => (m ? { ...m, selectedIdx: idx } : m));
          }
          const missingRequired = TARGET_FIELDS
            .filter(t => t.required && !active.mapping[t.key])
            .map(t => t.label);
          // Consumption comes from a mapped electric/gas column, or — when
          // none is mapped — is modeled from Property Type. With neither,
          // every consumption (and therefore cost and savings) figure is
          // null, which is easy to miss until the table renders empty. All
          // three are optional, so this warns rather than blocks.
          const noConsumptionCols = !active.mapping.electric && !active.mapping.gas;
          const noPropertyType = !active.mapping.propertyType;
          const consumptionUnavailable = noConsumptionCols && noPropertyType;
          // Tenure (Owned / Leased) is optional too, and silently so: with
          // no Ownership column nothing is ever Leased, which the compliance
          // subtabs and the Master Analysis both read as "owned outright".
          // Flagged here, at the moment the mapping is being made, as well
          // as on the page after import.
          const noTenureCol = !active.mapping.ownership;
          // "Assume all owned / all leased" shortcut for a file with no
          // tenure column at all — a single-tenure portfolio (every site
          // owned, or every site leased) is common enough that making the
          // user add a column to the workbook and re-upload is the wrong
          // ask. The assumption is written onto the rows as a real column
          // and Ownership is mapped at it, so from the import onwards it
          // behaves exactly like a tenure column that arrived in the file:
          // it imports, exports, mass-edits and scopes the compliance
          // subtabs the same way. Values are the canonical 'Owned' /
          // 'Leased' the rest of the page matches on.
          const ASSUMED_TENURE_HEADER = 'Tenure (assumed)';
          const assumedTenure = active.mapping.ownership === ASSUMED_TENURE_HEADER
            ? (active.assumedTenure || null)
            : null;
          function assumeTenureForAll(value) {
            setSitesMappingModal(m => {
              if (!m) return m;
              const idx = m.selectedIdx;
              const cur = m.sheets[idx];
              const rows = cur.rows.map(r => ({ ...r, [ASSUMED_TENURE_HEADER]: value }));
              const headers = cur.headers.includes(ASSUMED_TENURE_HEADER)
                ? cur.headers
                : [...cur.headers, ASSUMED_TENURE_HEADER];
              // Same one-header-one-field rule the dropdowns follow: free
              // the column from anything else it was pointed at first.
              const mapping = { ...cur.mapping };
              for (const t of TARGET_FIELDS) {
                if (mapping[t.key] === ASSUMED_TENURE_HEADER) mapping[t.key] = '';
              }
              mapping.ownership = ASSUMED_TENURE_HEADER;
              const sheets = m.sheets.slice();
              sheets[idx] = { ...cur, rows, headers, mapping, assumedTenure: value };
              return { ...m, sheets };
            });
          }
          function clearAssumedTenure() {
            setSitesMappingModal(m => {
              if (!m) return m;
              const idx = m.selectedIdx;
              const cur = m.sheets[idx];
              const rows = cur.rows.map(r => {
                if (!(ASSUMED_TENURE_HEADER in r)) return r;
                const out = { ...r };
                delete out[ASSUMED_TENURE_HEADER];
                return out;
              });
              const headers = cur.headers.filter(h => h !== ASSUMED_TENURE_HEADER);
              const mapping = { ...cur.mapping };
              for (const t of TARGET_FIELDS) {
                if (mapping[t.key] === ASSUMED_TENURE_HEADER) mapping[t.key] = '';
              }
              const sheets = m.sheets.slice();
              sheets[idx] = { ...cur, rows, headers, mapping, assumedTenure: null };
              return { ...m, sheets };
            });
          }
          const targetLabel = (key) => TARGET_FIELDS.find(t => t.key === key)?.label || key;
          const colHeader = { fontSize: '0.7rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '0.5rem 0.75rem', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' };
          const cellBase = { padding: '0.4rem 0.75rem', borderBottom: '1px solid #F1F5F9', fontSize: '0.78rem' };
          const assumeBtn = { padding: '0.25rem 0.7rem', fontSize: '0.72rem', fontWeight: 700, border: '1px solid #F59E0B', borderRadius: 6, background: '#FFFFFF', color: '#92400E', cursor: 'pointer', whiteSpace: 'nowrap' };
          const tabBase = { padding: '0.35rem 0.7rem', fontSize: '0.75rem', fontWeight: 600, border: '1px solid #E2E8F0', borderBottom: 'none', borderTopLeftRadius: 6, borderTopRightRadius: 6, background: '#F8FAFC', color: '#475569', cursor: 'pointer', whiteSpace: 'nowrap' };
          const tabActive = { ...tabBase, background: '#FFFFFF', color: '#0F172A', borderColor: '#CBD5E1', boxShadow: 'inset 0 -2px 0 #2563EB' };
          return (
            <div className={styles.modalBackdrop} onClick={() => setSitesMappingModal(null)}>
              <div className={styles.modalCard} onClick={e => e.stopPropagation()} style={{ maxWidth: 1000, width: '95vw' }}>
                <div className={styles.modalHeader}>
                  <h3 className={styles.modalTitle}>{sitesMappingModal.mode === 'update' ? 'Update Column Mapping' : 'Sites File: Column Mapping'}</h3>
                  <button className={styles.modalClose} onClick={() => setSitesMappingModal(null)}>×</button>
                </div>
                {sitesMappingModal.sheets.length > 1 && (
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, margin: '0 0 0.5rem', borderBottom: '1px solid #E2E8F0', overflowX: 'auto' }}>
                    {sitesMappingModal.sheets.map((s, i) => (
                      <button
                        key={`${s.sheetName}-${i}`}
                        type="button"
                        style={i === sitesMappingModal.selectedIdx ? tabActive : tabBase}
                        onClick={() => selectSheet(i)}
                        title={`${s.rows.length.toLocaleString()} rows · ${s.headers.length} columns`}
                      >
                        {s.sheetName} <span style={{ color: '#94A3B8', fontWeight: 500 }}>({s.rows.length.toLocaleString()})</span>
                      </button>
                    ))}
                  </div>
                )}
                <p className={styles.modalHelp}>
                  {active.rows.length.toLocaleString()} rows found on tab "{active.sheetName}" in <code>{sitesMappingModal.fileName}</code>. The left side lists every column that shows up on the Utility Lookup page; the right side lists every column from this tab. Pick which file column should fill each Utility Lookup field.{sitesMappingModal.sheets.length > 1 ? ' Switch tabs above to map a different sheet: only the selected tab is imported.' : ''}
                </p>
                {missingRequired.length > 0 && (
                  <div style={{ margin: '0 0 0.5rem', padding: '0.4rem 0.6rem', background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 6, fontSize: '0.75rem', color: '#991B1B', fontWeight: 600 }}>
                    Still need to map: {missingRequired.join(', ')}
                  </div>
                )}
                {consumptionUnavailable && (
                  <div style={{ margin: '0 0 0.5rem', padding: '0.45rem 0.6rem', background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 6, fontSize: '0.75rem', color: '#991B1B' }}>
                    <strong>⚠ Consumption will not be available.</strong>{' '}
                    Nothing is mapped to <strong>Annual Electric Consumption</strong> or <strong>Annual Gas Consumption</strong>, and no <strong>Property Type</strong> column is mapped to estimate from. Without one or the other, consumption (and the cost and savings figures derived from it), will be blank for every site. Map a consumption column, or map Property Type to use modeled estimates.
                  </div>
                )}
                {noTenureCol && (
                  <div style={{ margin: '0 0 0.5rem', padding: '0.45rem 0.6rem', background: '#FFFBEB', border: '1px solid #F59E0B', borderRadius: 6, fontSize: '0.75rem', color: '#92400E' }}>
                    <strong>⚠ No Tenure (Owned / Leased) column mapped.</strong>{' '}
                    Nothing is mapped to <strong>Ownership (Owned / Leased)</strong>, so no site will carry a tenure status and the whole list reads as owned outright: the compliance subtabs will screen every building for obligations that fall on the owner, and the Master Analysis will project procurement savings on the full deregulated spend. Map the column if the file has one — this is a warning, not a blocker.
                    {/* No column to map, because the whole portfolio is one
                        tenure: say so here instead of editing the file. */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.45rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600 }}>Or assume one tenure for all {active.rows.length.toLocaleString()} rows:</span>
                      <button type="button" style={assumeBtn} onClick={() => assumeTenureForAll('Owned')} title={`Write "Owned" onto every row as a ${ASSUMED_TENURE_HEADER} column and map Ownership to it`}>
                        All sites Owned
                      </button>
                      <button type="button" style={assumeBtn} onClick={() => assumeTenureForAll('Leased')} title={`Write "Leased" onto every row as a ${ASSUMED_TENURE_HEADER} column and map Ownership to it`}>
                        All sites Leased
                      </button>
                    </div>
                  </div>
                )}
                {assumedTenure && (
                  <div style={{ margin: '0 0 0.5rem', padding: '0.45rem 0.6rem', background: '#ECFDF5', border: '1px solid #6EE7B7', borderRadius: 6, fontSize: '0.75rem', color: '#065F46', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ flex: 1, minWidth: 220 }}>
                      <strong>All {active.rows.length.toLocaleString()} rows assumed {assumedTenure}.</strong>{' '}
                      A <code>{ASSUMED_TENURE_HEADER}</code> column carrying "{assumedTenure}" is added to every row and mapped to <strong>Ownership (Owned / Leased)</strong>. Individual sites can still be changed afterwards with <strong>Mass edit</strong>.
                    </span>
                    <button type="button" style={assumeBtn} onClick={() => assumeTenureForAll(assumedTenure === 'Owned' ? 'Leased' : 'Owned')}>
                      Switch to all {assumedTenure === 'Owned' ? 'Leased' : 'Owned'}
                    </button>
                    <button type="button" style={{ ...assumeBtn, borderColor: '#CBD5E1', color: '#475569' }} onClick={clearAssumedTenure}>
                      Undo
                    </button>
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', maxHeight: '60vh' }}>
                  {/* LEFT — Utility Lookup page columns */}
                  <div style={{ border: '1px solid #E2E8F0', borderRadius: 6, overflow: 'auto' }}>
                    <div style={colHeader}>Utility Lookup page columns</div>
                    {TARGET_FIELDS.map(t => {
                      const header = active.mapping[t.key];
                      return (
                        <div key={t.key} style={{ ...cellBase, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.hint}>
                            {t.label}
                            {t.required && <span style={{ color: '#DC2626', marginLeft: 2 }}>*</span>}
                          </span>
                          {header ? (
                            <span style={{ background: '#DCFCE7', border: '1px solid #86EFAC', color: '#166534', padding: '1px 8px', borderRadius: 999, fontSize: '0.68rem', fontWeight: 600, maxWidth: '55%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`Mapped from "${header}"`}>
                              ← {header}
                            </span>
                          ) : (
                            <span style={{ color: t.required ? '#DC2626' : '#94A3B8', fontSize: '0.68rem', fontWeight: 600 }}>
                              {t.required ? '(not mapped)' : '(optional)'}
                            </span>
                          )}
                        </div>
                      );
                    })}
                    <div style={{ ...cellBase, fontSize: '0.66rem', color: '#64748B', fontStyle: 'italic', background: '#F8FAFC' }}>
                      Auto-derived columns (no mapping needed)
                    </div>
                    {DERIVED_COLUMNS.map(d => (
                      <div key={d.name} style={{ ...cellBase, display: 'flex', alignItems: 'center', gap: '0.4rem', background: '#FAFBFC' }}>
                        <span style={{ flex: 1, color: '#475569' }}>{d.name}</span>
                        <span style={{ color: '#94A3B8', fontSize: '0.66rem', fontStyle: 'italic' }}>{d.from}</span>
                      </div>
                    ))}
                  </div>
                  {/* RIGHT — file columns */}
                  <div style={{ border: '1px solid #E2E8F0', borderRadius: 6, overflow: 'auto' }}>
                    <div style={colHeader}>Columns on this tab ({active.headers.length})</div>
                    {active.headers.map(h => {
                      const target = targetForHeader[h] || '';
                      return (
                        <div key={h} style={{ ...cellBase, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={h}>
                            {h}
                          </span>
                          <span style={{ color: '#94A3B8', fontSize: '0.7rem' }}>→</span>
                          <select
                            className={`${styles.modalSelect} ${target ? styles.modalSelectMapped : ''}`}
                            value={target}
                            onChange={e => setTargetForHeader(h, e.target.value)}
                            style={{ minWidth: 170, maxWidth: 220 }}
                          >
                            <option value="">(Ignore)</option>
                            {TARGET_FIELDS.map(t => (
                              <option key={t.key} value={t.key}>
                                {t.label}{t.required ? ' *' : ''}
                              </option>
                            ))}
                          </select>
                          {target && <span style={{ color: '#10B981', fontSize: '0.75rem', fontWeight: 600 }} title={`Mapped to ${targetLabel(target)}`}>✓</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className={styles.modalActions}>
                  <button className={styles.modalCancel} onClick={() => setSitesMappingModal(null)}>Cancel</button>
                  <button
                    className={styles.modalConfirm}
                    onClick={executeSitesImport}
                    disabled={missingRequired.length > 0}
                  >
                    {sitesMappingModal.mode === 'update'
                      ? 'Update mapping'
                      : `Import ${active.rows.length.toLocaleString()} sites`}
                  </button>
                </div>
              </div>
            </div>
          );
        })(),
        document.body
      )}

      {mappingModal && createPortal(
        (() => {
          const TARGET_FIELDS = [
            { key: 'zip', label: 'Zip / Postal Code', required: true },
            { key: 'commodityType', label: 'Commodity Type', required: true },
            { key: 'utility', label: 'Utility', required: true },
            { key: 'city', label: 'City', required: false },
            { key: 'state', label: 'State', required: false },
            { key: 'country', label: 'Country', required: false },
            { key: 'uniqueLookup', label: 'Unique Lookup', required: false },
          ];
          const targetForHeader = {};
          for (const t of TARGET_FIELDS) {
            const h = mappingModal.mapping[t.key];
            if (h) targetForHeader[h] = t.key;
          }
          function setTargetForHeader(header, targetKey) {
            setMappingModal(m => {
              if (!m) return m;
              const next = { ...m.mapping };
              for (const t of TARGET_FIELDS) {
                if (next[t.key] === header) next[t.key] = '';
              }
              if (targetKey) next[targetKey] = header;
              return { ...m, mapping: next };
            });
          }
          const missingRequired = TARGET_FIELDS
            .filter(t => t.required && !mappingModal.mapping[t.key])
            .map(t => t.label);
          return (
            <div className={styles.modalBackdrop} onClick={() => !utilityBusy && setMappingModal(null)}>
              <div className={styles.modalCard} onClick={e => e.stopPropagation()} style={{ maxWidth: 720, width: '90vw' }}>
                <div className={styles.modalHeader}>
                  <h3 className={styles.modalTitle}>Utility Rates: Column Mapping</h3>
                  <button className={styles.modalClose} onClick={() => setMappingModal(null)} disabled={utilityBusy}>×</button>
                </div>
                <p className={styles.modalHelp}>
                  {mappingModal.rows.length.toLocaleString()} rows found{mappingModal.sheetName ? ` on sheet "${mappingModal.sheetName}"` : ''}. Every column from the file is listed below: pick the field each one should map into (or leave it on "Ignore"). Zip / Commodity Type / Utility are required.
                </p>
                {missingRequired.length > 0 && (
                  <div style={{ margin: '0 0 0.5rem', padding: '0.4rem 0.6rem', background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 6, fontSize: '0.75rem', color: '#991B1B', fontWeight: 600 }}>
                    Still need to map: {missingRequired.join(', ')}
                  </div>
                )}
                <div style={{ maxHeight: '60vh', overflowY: 'auto', border: '1px solid #E2E8F0', borderRadius: 6 }}>
                  {mappingModal.headers.map(h => {
                    const target = targetForHeader[h] || '';
                    return (
                      <div
                        key={h}
                        className={styles.modalRow}
                        style={{ borderBottom: '1px solid #F1F5F9', padding: '0.4rem 0.6rem' }}
                      >
                        <div className={styles.modalLabel} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={h}>
                          {h}
                        </div>
                        <span style={{ color: '#94A3B8', fontSize: '0.75rem' }}>→</span>
                        <select
                          className={`${styles.modalSelect} ${target ? styles.modalSelectMapped : ''}`}
                          value={target}
                          onChange={e => setTargetForHeader(h, e.target.value)}
                          disabled={utilityBusy}
                        >
                          <option value="">(Ignore)</option>
                          {TARGET_FIELDS.map(t => (
                            <option key={t.key} value={t.key}>
                              {t.label}{t.required ? ' *' : ''}
                            </option>
                          ))}
                        </select>
                        {target && <span style={{ color: '#10B981', fontSize: '0.75rem', fontWeight: 600 }}>✓</span>}
                      </div>
                    );
                  })}
                </div>
                <div className={styles.modalActions}>
                  <button className={styles.modalCancel} onClick={() => setMappingModal(null)} disabled={utilityBusy}>Cancel</button>
                  <button
                    className={styles.modalConfirm}
                    onClick={executeUtilityImport}
                    disabled={utilityBusy || missingRequired.length > 0}
                  >
                    {utilityBusy ? 'Importing…' : 'Import Utility Lookup'}
                  </button>
                </div>
              </div>
            </div>
          );
        })(),
        document.body
      )}

      {zipFbMappingModal && createPortal(
        (() => {
          const TARGET_FIELDS = [
            { key: 'city', label: 'City', required: true },
            { key: 'state', label: 'State', required: true },
            { key: 'zip', label: 'Zip / Postal Code', required: true },
          ];
          const targetForHeader = {};
          for (const t of TARGET_FIELDS) {
            const h = zipFbMappingModal.mapping[t.key];
            if (h) targetForHeader[h] = t.key;
          }
          function setTargetForHeader(header, targetKey) {
            setZipFbMappingModal(m => {
              if (!m) return m;
              const next = { ...m.mapping };
              for (const t of TARGET_FIELDS) {
                if (next[t.key] === header) next[t.key] = '';
              }
              if (targetKey) next[targetKey] = header;
              return { ...m, mapping: next };
            });
          }
          const missingRequired = TARGET_FIELDS
            .filter(t => t.required && !zipFbMappingModal.mapping[t.key])
            .map(t => t.label);
          return (
            <div className={styles.modalBackdrop} onClick={() => !zipFallbackBusy && setZipFbMappingModal(null)}>
              <div className={styles.modalCard} onClick={e => e.stopPropagation()} style={{ maxWidth: 720, width: '90vw' }}>
                <div className={styles.modalHeader}>
                  <h3 className={styles.modalTitle}>Fallback Zips: Column Mapping</h3>
                  <button className={styles.modalClose} onClick={() => setZipFbMappingModal(null)} disabled={zipFallbackBusy}>×</button>
                </div>
                <p className={styles.modalHelp}>
                  {zipFbMappingModal.rows.length.toLocaleString()} rows found{zipFbMappingModal.sheetName ? ` on sheet "${zipFbMappingModal.sheetName}"` : ''}. Pick which column maps to City, State, and Zip (or leave one on "Ignore"). All three are required to estimate zips for sites missing one.
                </p>
                {missingRequired.length > 0 && (
                  <div style={{ margin: '0 0 0.5rem', padding: '0.4rem 0.6rem', background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 6, fontSize: '0.75rem', color: '#991B1B', fontWeight: 600 }}>
                    Still need to map: {missingRequired.join(', ')}
                  </div>
                )}
                <div style={{ maxHeight: '60vh', overflowY: 'auto', border: '1px solid #E2E8F0', borderRadius: 6 }}>
                  {zipFbMappingModal.headers.map(h => {
                    const target = targetForHeader[h] || '';
                    return (
                      <div
                        key={h}
                        className={styles.modalRow}
                        style={{ borderBottom: '1px solid #F1F5F9', padding: '0.4rem 0.6rem' }}
                      >
                        <div className={styles.modalLabel} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={h}>
                          {h}
                        </div>
                        <span style={{ color: '#94A3B8', fontSize: '0.75rem' }}>→</span>
                        <select
                          className={`${styles.modalSelect} ${target ? styles.modalSelectMapped : ''}`}
                          value={target}
                          onChange={e => setTargetForHeader(h, e.target.value)}
                          disabled={zipFallbackBusy}
                        >
                          <option value="">(Ignore)</option>
                          {TARGET_FIELDS.map(t => (
                            <option key={t.key} value={t.key}>
                              {t.label}{t.required ? ' *' : ''}
                            </option>
                          ))}
                        </select>
                        {target && <span style={{ color: '#10B981', fontSize: '0.75rem', fontWeight: 600 }}>✓</span>}
                      </div>
                    );
                  })}
                </div>
                <div className={styles.modalActions}>
                  <button className={styles.modalCancel} onClick={() => setZipFbMappingModal(null)} disabled={zipFallbackBusy}>Cancel</button>
                  <button
                    className={styles.modalConfirm}
                    onClick={executeZipFallbackImport}
                    disabled={zipFallbackBusy || missingRequired.length > 0}
                  >
                    {zipFallbackBusy ? 'Importing…' : 'Import Fallback Zips'}
                  </button>
                </div>
              </div>
            </div>
          );
        })(),
        document.body
      )}
    </div>
      )}
    </div>
  );
}

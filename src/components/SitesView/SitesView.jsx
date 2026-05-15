import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
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
  toKwh,
  toTherms,
  stateRate,
  formatMoney,
  formatRate,
} from '../../utils/utilityRates';
import { parseAllSheets, parseBestSheet, parseSplitSitesTemplate, readRoundTripState, isIndicativeSavingsExport } from '../../utils/xlsxParse';
import { saveIndicativeAnalysis, deleteIndicativeAnalysis } from '../../utils/firestoreSync';
import { injectLiveLineChart } from '../../utils/xlsxLiveChart';
import { findFuzzyMatch } from '../../utils/utilityNameMatch';
import { ENERGY_SUPPLIERS } from '../../data/energySuppliers';
import { isRegulatedRateOpportunity } from '../../data/regulatedRateOpportunities';
import {
  normalizePropertyType,
  estimateConsumption,
  propertyTypeAccounts,
  CONSUMPTION_ESTIMATES,
  ACCOUNT_ESTIMATES,
  PROPERTY_TYPE_OPTIONS,
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
} from '../../data/naMarkets';
import {
  COUNTRY_CENTERS,
  US_STATE_CENTERS,
  CANADA_PROVINCE_CENTERS,
  statusTier,
  TIER_COLORS,
  TIER_LABELS,
  getCountryFeatures,
  getNAAdmin1Features,
  TOPO_NAME_TO_DEREG_KEY,
} from '../../data/worldGeo';
import {
  countryElectricRate,
  countryGasRatePerTherm,
  normalizeCountryRateName,
} from '../../data/countryRates';
import styles from './SitesView.module.css';

const SITES_STORAGE_KEY = 'sites-list-override';

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

function detectColumn(headers, patterns) {
  for (const pat of patterns) {
    const hit = headers.find(h => pat.test(String(h)));
    if (hit) return hit;
  }
  return '';
}

function pickZipColumn(headers) {
  if (!headers.length) return '';
  return detectColumn(headers, [/^zip\s*code$/i, /^postal\s*code$/i, /^zip$/i, /zip/i, /postal/i])
    || headers[0];
}

// Auto-detect every Utility-Lookup target field on a fresh sites
// header list. Ordered patterns inside each detectColumn call go from
// most-specific to most-generic so that e.g. "Annual Electric Spend ($)"
// wins over "Electricity" when picking the cost column.
function detectSitesMapping(headers) {
  if (!headers.length) return { siteName: '', zip: '' };
  const siteName = headers.find(h => /\b(site\s*name|site|property|location|facility|building|name)\b/i.test(String(h))) || headers[0];
  return {
    siteName,
    address: detectColumn(headers, [/^address$/i, /^street\s*address$/i, /street/i, /\baddress\b/i]) || '',
    city: detectColumn(headers, [/^city$/i, /^town$/i, /^municipality$/i, /\bcity\b/i]) || '',
    state: detectColumn(headers, [/^state$/i, /^province$/i, /^state\s*\/\s*province$/i, /\bstate\b/i, /\bregion\b/i]) || '',
    zip: pickZipColumn(headers),
    country: detectColumn(headers, [/^country$/i, /\bcountry\b/i, /\bnation\b/i]) || '',
    propertyType: detectColumn(headers, [/property\s*type/i, /building\s*type/i, /property\s*class/i, /asset\s*type/i, /^use$/i, /\buse\s*type\b/i, /\bsegment\b/i]) || '',
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
    electricContractPrice: detectColumn(headers, [/electric.*contract.*(price|rate)/i, /electric.*\$\s*\/\s*kwh/i, /electric.*supply\s*(price|rate)/i, /(power|electricity).*contract.*price/i]) || '',
    electricContractName: detectColumn(headers, [/electric.*contract.*name/i, /(power|electricity).*contract.*name/i, /electric.*deal\s*name/i]) || '',
    electricProductType: detectColumn(headers, [/electric.*product/i, /(power|electricity).*product/i, /electric.*structure/i]) || '',
    gasStart: detectColumn(headers, [/gas.*contract.*start/i, /gas.*start.*date/i, /gas.*begin/i]) || '',
    gasEnd: detectColumn(headers, [/gas.*contract.*end/i, /gas.*(end|expir).*date/i, /gas.*term.*end/i]) || '',
    gasContractPrice: detectColumn(headers, [/gas.*contract.*(price|rate)/i, /gas.*\$\s*\/\s*(therm|mmbtu|dth)/i, /gas.*supply\s*(price|rate)/i]) || '',
    gasContractName: detectColumn(headers, [/gas.*contract.*name/i, /gas.*deal\s*name/i]) || '',
    gasProductType: detectColumn(headers, [/gas.*product/i, /gas.*structure/i]) || '',
  };
}

// Classify a utility provider as "Regulated" (monopoly market — usually
// municipally owned, public power, or a cooperative) or "Deregulated"
// (competitive retail market). Based on the provider name only, since
// that's all we have in the lookup file today. Well-known municipal
// and coop utilities that don't follow the naming conventions get an
// explicit override so Austin Energy / LADWP / SMUD / TVA etc. are
// classified correctly.
const REGULATED_PATTERNS = [
  /^city of\b/i,
  /\bmunicipal\b/i,
  /\b(co-?op|cooperative)\b/i,
  /\bpublic power\b/i,
  /\bpublic utilit(y|ies)\b/i,
  /\b(power|electric|utility|utilities)\s+authority\b/i,
  /\b(p\.?u\.?d\.?)\b/i, // Public Utility District
  /\bmembership corp(oration)?\b/i, // Rural electric membership corps
  /\belectric (membership|cooperative)\b/i,
];
const REGULATED_OVERRIDES = [
  /^austin energy\b/i,
  /^ladwp\b/i,
  /\bdepartment of water( and|&) power\b/i,
  /^smud\b/i,
  /^sacramento municipal/i,
  /^seattle city light\b/i,
  /^tacoma power\b/i,
  /^cps energy\b/i, // San Antonio
  /^jea\b/i,         // Jacksonville
  /^ouc\b/i,         // Orlando Utilities Commission
  /^orlando utilities/i,
  /^long island power\b/i,
  /^lipa\b/i,
  /^nyseg\b/i,
  /^nebraska public power\b/i,
  /^omaha public power\b/i,
  /^salt river project\b/i,
  /^srp\b/i,
  /^colorado springs utilities\b/i,
  /^nashville electric\b/i,
  /^memphis light,?\s*gas/i,
  /^knoxville utilities\b/i,
  /^epb\b/i,                       // Chattanooga
  /^bonneville power\b/i,
  /^tva\b/i,
  /^tennessee valley authority\b/i,
  /^gainesville regional utilities\b/i,
  /^lakeland electric\b/i,
];
function classifyUtility(name) {
  if (!name) return null;
  const str = String(name).trim();
  if (!str) return null;
  if (REGULATED_OVERRIDES.some(r => r.test(str))) return 'Regulated';
  if (REGULATED_PATTERNS.some(r => r.test(str))) return 'Regulated';
  return 'Deregulated';
}

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
    return { tier: 'high', label: 'Yes — Class A potential' };
  }
  if (kwh != null && kwh >= GAC_REVIEW_KWH) {
    return { tier: 'mid', label: 'Maybe — verify peak demand' };
  }
  return { tier: 'low', label: 'Class B (small load)' };
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

export function SitesView({ settings, updateSettings, prospects = [] } = {}) {
  const [sitesData, setSitesData] = useState([]);
  const [sitesLoaded, setSitesLoaded] = useState(false);
  const [utility, setUtility] = useState(null); // { zipMap, meta }
  const [utilityLoaded, setUtilityLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [utilityBusy, setUtilityBusy] = useState(false);
  const [mappingModal, setMappingModal] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  // Picker for "Save to Company": null = closed, '' = open & empty,
  // string = open & user is typing. saveStatus drives the button
  // label / disabled state while the analysis blob is being built and
  // uploaded to Firestore.
  const [savePickerSearch, setSavePickerSearch] = useState(null);
  const [saveStatus, setSaveStatus] = useState({ state: 'idle', message: '' });
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
  const [addressOverride, setAddressOverride] = useState(null);
  const [cityOverride, setCityOverride] = useState(null);
  const [stateColumnOverride, setStateColumnOverride] = useState(null);
  // Optional Property Type + Size columns from the upload — drive the
  // per-property-type consumption / account-count estimates shown on
  // the Indicative Savings export's Property Type Estimates tab. Both
  // are optional; with only Property Type the export uses the
  // reference Size_ft2 for that type and skips per-site size scaling.
  const [propertyTypeOverride, setPropertyTypeOverride] = useState(null);
  const [siteDescriptionOverride, setSiteDescriptionOverride] = useState(null);
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
  // Column-mapping confirmation popup for the Sites File upload —
  // null when no upload is mid-flight; otherwise carries the parsed
  // rows + headers + auto-detected mapping the user can adjust before
  // committing.
  const [sitesMappingModal, setSitesMappingModal] = useState(null);
  // { rows, headers, mapping: { zip, electric, gas, water } }
  const sitesFileRef = useRef(null);
  const utilityFileRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [sites, util] = await Promise.all([
        loadListFromIDB(SITES_STORAGE_KEY),
        loadUtilityRates(),
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
        setSiteDescriptionOverride(m.siteDescription || null);
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

  // Commit the popup's chosen mapping, persist the data + override
  // settings, and close the modal. If the user blanks out the site
  // name or zip column we fall back to auto-detection so the lookup
  // can still try to match.
  async function executeSitesImport() {
    if (!sitesMappingModal) return;
    const active = sitesMappingModal.sheets[sitesMappingModal.selectedIdx];
    if (!active) return;
    const { rows, mapping } = active;
    setUploadError('');
    try {
      // Drop columns the user didn't assign a target — otherwise every
      // pass-through column ends up rendered on the Utility Lookup
      // table even though the user only wanted these specific fields.
      const TARGET_KEYS = [
        'siteName', 'address', 'city', 'state', 'zip', 'country',
        'propertyType', 'siteDescription', 'propertySize',
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
      // Wipe per-row supplier overrides from the previous sites list.
      // They're keyed by row index (e.g. `5_gas` -> "NRG Energy"), so
      // they bleed straight onto row 5 of the new list when row counts
      // overlap. Vendor-name decisions stay — those are brand-keyed and
      // still meaningful across uploads.
      setSupplierOverrides({});
      try { localStorage.removeItem('utility-lookup:supplier-overrides'); } catch {}
      setSiteNameOverride(mapping.siteName || null);
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
      setSiteDescriptionOverride(mapping.siteDescription || null);
      setPropertySizeOverride(mapping.propertySize || null);
      setElectricContractPriceOverride(mapping.electricContractPrice || null);
      setGasContractPriceOverride(mapping.gasContractPrice || null);
      setElectricContractNameOverride(mapping.electricContractName || null);
      setElectricProductTypeOverride(mapping.electricProductType || null);
      setGasContractNameOverride(mapping.gasContractName || null);
      setGasProductTypeOverride(mapping.gasProductType || null);
      // Restore round-trip state from an Indicative Savings export's
      // hidden sheet (vendor accept/reject decisions). Replaces — not
      // merges — to match the supplierOverrides "fresh slate" model:
      // an export-then-import flow is a session restore, not a merge
      // of two different sessions.
      const rt = sitesMappingModal.roundTripState;
      if (rt && rt.vendorDecisions && typeof rt.vendorDecisions === 'object') {
        setVendorDecisions(rt.vendorDecisions);
        try { localStorage.setItem('utility-lookup:vendor-decisions', JSON.stringify(rt.vendorDecisions)); } catch {}
      }
    } catch (err) {
      setUploadError(err?.message || 'Failed to save the sites file');
    }
    setSitesMappingModal(null);
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
    if (!window.confirm('Remove the uploaded sites list?')) return;
    await clearListFromIDB(SITES_STORAGE_KEY);
    setSitesData([]);
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
        if (mapping.country && !entry.country) {
          const country = String(r[mapping.country] ?? '').trim();
          if (country) entry.country = country;
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
    const match = headers.find(h => /\b(site\s*name|site|property|location|facility|building|name)\b/i.test(String(h)));
    return match || headers[0] || '';
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

  const siteHeaders = useMemo(() => sitesData.length ? Object.keys(sitesData[0]) : [], [sitesData]);

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

  const rows = useMemo(() => {
    return cleanSitesData.map((r, i) => {
      const zip = zipColumn ? normalizeZip(r[zipColumn]) : '';
      const match = utility?.zipMap && zip ? utility.zipMap[zip] : null;
      const state = match?.state || zipToState(zip);
      const stateElectricRate = state ? stateRate(state, 'electric') : null;
      const stateGasRate = state ? stateRate(state, 'gas') : null;
      const electricUomRaw = electricUomOverride ? r[electricUomOverride] : '';
      const gasUomRaw = gasUomOverride ? r[gasUomOverride] : '';
      const elec = pickFirstConsumption(r, consumption.electric, toKwh, normalizeElectricUom(electricUomRaw));
      const gas = pickFirstConsumption(r, consumption.gas, toTherms, normalizeGasUom(gasUomRaw));
      const inputCountry = countryOverride ? String(r[countryOverride] || '').trim() : '';
      // Country-rate fallback. When the state rate didn't resolve
      // (non-US sites, or US sites whose state code we couldn't
      // derive), look up an indicative commercial rate from the
      // country reference table and substitute it. Electric drops in
      // as $/kWh directly; gas converts from $/kWh-equiv to $/therm
      // via the 29.3001 kWh/therm energy-content factor so the cost
      // helpers downstream stay shape-compatible.
      const resolvedCountryForRate = inputCountry || match?.country || null;
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
      const inputPropertyType = propertyTypeOverride ? String(r[propertyTypeOverride] || '').trim() : '';
      const canonicalPropertyType = inputPropertyType ? normalizePropertyType(inputPropertyType) : null;
      const inputSiteDescription = siteDescriptionOverride ? String(r[siteDescriptionOverride] || '').trim() : '';
      // Loose numeric parse for the optional Size_ft2 column — strips
      // commas, "sf"/"sqft" suffixes, etc.
      const parseSize = (v) => {
        if (v == null || v === '') return null;
        const n = Number(String(v).replace(/[^0-9.]/g, ''));
        return Number.isFinite(n) && n > 0 ? n : null;
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
        if (/^[-—–_]+$/.test(t)) return true;
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
        const utility = !supplier ? matchVendorToUtility(raw) : null;
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
        __supplierSuggestions__: supplierSuggestions,
        __electric__: match?.electric || electricUtilityTokens[0]?.canonical || null,
        __gas__: match?.gas || gasUtilityTokens[0]?.canonical || null,
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
        __water__: match?.water,
        __address__: addressOverride ? String(r[addressOverride] || '').trim() || null : null,
        __city__: (cityOverride ? String(r[cityOverride] || '').trim() : '') || match?.city,
        __country__: inputCountry || match?.country,
        __state__: (stateColumnOverride ? String(r[stateColumnOverride] || '').trim() : '') || state,
        __propertyTypeRaw__: inputPropertyType || null,
        __propertyType__: canonicalPropertyType,
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
        __electricContractName__: electricContractNameOverride ? String(r[electricContractNameOverride] || '').trim() || null : null,
        __electricProductType__: electricProductTypeOverride ? String(r[electricProductTypeOverride] || '').trim() || null : null,
        __gasStart__: gasStartOverride ? parseSourceDate(r[gasStartOverride]) : null,
        __gasEnd__: gasEndOverride ? parseSourceDate(r[gasEndOverride]) : null,
        __gasContractPrice__: gasContractPrice,
        __gasContractName__: gasContractNameOverride ? String(r[gasContractNameOverride] || '').trim() || null : null,
        __gasProductType__: gasProductTypeOverride ? String(r[gasProductTypeOverride] || '').trim() || null : null,
        __matched__: !!match || electricUtilityTokens.length > 0 || gasUtilityTokens.length > 0,
      };
    });
  }, [cleanSitesData, zipColumn, utility, consumption, electricCostOverride, gasCostOverride, electricSupplierOverride, gasSupplierOverride, electricStartOverride, electricEndOverride, gasStartOverride, gasEndOverride, electricUomOverride, gasUomOverride, countryOverride, addressOverride, cityOverride, stateColumnOverride, propertyTypeOverride, siteDescriptionOverride, propertySizeOverride, electricContractPriceOverride, gasContractPriceOverride, electricContractNameOverride, electricProductTypeOverride, gasContractNameOverride, gasProductTypeOverride, knownUtilityNames, vendorDecisions, supplierOverrides]);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const term = search.toLowerCase();
    return rows.filter(r =>
      Object.entries(r).some(([k, v]) =>
        !k.startsWith('__') && String(v).toLowerCase().includes(term)
      )
    );
  }, [search, rows]);

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
          if (k === zipColumn && row.__zipNorm__) return row.__zipNorm__;
          if (v == null || v === '') return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
          return isDate ? fmtShortDate(v) : String(v);
        },
        exportValue: (row) => {
          if (k === zipColumn && row.__zipNorm__) return row.__zipNorm__;
          const v = row[k];
          if (isDate) return fmtShortDate(v);
          return v ?? '';
        },
      };
    });
    const makeUtilityCol = (key, label, color) => ({
      key,
      label,
      defaultWidth: 160,
      render: (row) => {
        if (!utility?.zipMap) {
          return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>no utility loaded</span>;
        }
        if (!row.__matched__) {
          return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>—</span>;
        }
        const val = row[`__${key}__`];
        if (val == null || val === '') return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>—</span>;
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
        if (!val) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>—</span>;
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
          return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>—</span>;
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
    // Free-text site annotation that lives next to Property Type. No
    // canonicalization or estimates — purely a passthrough column for
    // the user's notes / descriptions of each site.
    const siteDescriptionCol = {
      key: 'siteDescription',
      label: 'Site Description',
      defaultWidth: 220,
      render: (row) => {
        const v = row.__siteDescription__;
        if (!v) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>—</span>;
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
        if (v == null || !Number.isFinite(v)) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>—</span>;
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
        if (!utility?.zipMap || !row.__matched__) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>—</span>;
        const providerName = row[`__${utilityKey}__`];
        const classification = classifyUtility(providerName);
        if (!classification) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>—</span>;
        const isRegulated = classification === 'Regulated';
        // Deregulated = green (opportunity), Regulated = orange.
        const color = isRegulated
          ? { bg: '#FFEDD5', border: '#FDBA74', text: '#9A3412' }
          : { bg: '#DCFCE7', border: '#86EFAC', text: '#166534' };
        const ruleHint = isRegulated
          ? 'Municipal, public power, or cooperative — single-utility market.'
          : 'Competitive retail market — customers can choose a supplier.';
        return (
          <span
            title={`${label}: ${classification}. ${ruleHint} Provider: ${providerName}`}
            style={{ background: color.bg, border: `1px solid ${color.border}`, color: color.text, padding: '1px 8px', borderRadius: 999, fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap' }}
          >{classification}</span>
        );
      },
      exportValue: (row) => classifyUtility(row[`__${utilityKey}__`]) || '',
    });
    const makeGacOpportunityCol = () => ({
      key: 'gac_opportunity',
      label: 'GAC Opportunity (Ontario)',
      defaultWidth: 200,
      render: (row) => {
        const flag = gacOpportunity(row.__state__, row.__kwh__);
        if (!flag) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>—</span>;
        const colorByTier = {
          high: { bg: '#DCFCE7', border: '#86EFAC', text: '#166534' },
          mid:  { bg: '#FEF3C7', border: '#FCD34D', text: '#92400E' },
          low:  { bg: '#E2E8F0', border: '#CBD5E1', text: '#334155' },
        };
        const c = colorByTier[flag.tier];
        const tip = 'Ontario customers pay the Global Adjustment (GA). Class A (peak demand ≥ 1 MW, or ≥ 500 kW for select industries) can reduce GA by curtailing during the IESO\'s top-5 system-peak hours (ICI). Class B pays a flat per-kWh GA rate. Annual kWh is a coarse proxy for the peak-demand threshold — confirm with metered demand.';
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
        : <span style={{ color: 'var(--color-text-muted)', fontSize: '0.72rem' }}>—</span>,
      exportValue: (row) => row.__state__ || '',
    });
    const makeRateCol = (commodity, label) => ({
      key: `${commodity}_rate`,
      label,
      defaultWidth: 110,
      render: (row) => {
        const val = row[`__${commodity}Rate__`];
        if (val == null) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>—</span>;
        const source = row[`__${commodity}RateSource__`];
        const tip = source === 'country'
          ? `${row.__rateCountry__ || 'country'} indicative commercial rate. Drops in when no state rate resolves and no actual cost was provided. Indicative only — not a tariff rate.`
          : `${row.__state__ || 'unknown state'} commercial average. Indicative only — not a tariff rate.`;
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
        if (val == null) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>—</span>;
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
          if (raw == null) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>—</span>;
          const val = isElectric ? raw : raw / 10; // therms → Dth
          const fromEstimate = isElectric ? row.__kwhFromEstimate__ : row.__thermsFromEstimate__;
          const sourceHeader = isElectric ? row.__kwhSource__ : row.__thermsSource__;
          // Italicized + muted when the value came from the property-
          // type reference rather than the uploaded data, so the user
          // can tell modeled rows from measured ones at a glance.
          const tip = fromEstimate
            ? `Estimated from Property Type "${row.__propertyType__}" — no actual ${isElectric ? 'electric' : 'gas'} consumption in the upload`
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
        : `Supplier: ${raw} (not matched to a known utility or supplier — treated as a competitive retailer)`;
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
            >— {editButton}</span>
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
        if (val == null || val === '') return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>—</span>;
        return (
          <span style={{ fontSize: '0.72rem', color, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{fmtShortDate(val)}</span>
        );
      },
      exportValue: (row) => fmtShortDate(row[`__${key}__`]),
    });
    return [
      ...base,
      makeStateCol(),
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
      siteDescriptionCol,
      propertySizeCol,
      // Property-type-based estimates — always show the reference
      // figure regardless of whether the upload also carried actual
      // values, so the user can spot under- / over-reported sites by
      // comparing the actual columns against these.
      ...(() => {
        const muted = { color: 'var(--color-text-muted)', fontSize: '0.7rem' };
        const dash = <span style={muted}>—</span>;
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
            defaultWidth: 200,
            render: (row) => {
              const canonical = row.__propertyType__;
              if (!canonical) return dash;
              const acc = propertyTypeAccounts(canonical);
              if (!acc) return dash;
              const text = [
                acc.electric ? `Elec ${acc.electric.label}` : null,
                acc.gas ? `Gas ${acc.gas.label}` : null,
                acc.water ? `Water ${acc.water.label}` : null,
                acc.waste ? `Waste ${acc.waste.label}` : null,
                acc.steam && acc.steam.label !== '0' ? `Steam ${acc.steam.label}` : null,
              ].filter(Boolean).join(' · ');
              return <span style={{ fontSize: '0.68rem', color: 'var(--color-text-secondary)' }} title={text}>{text || '—'}</span>;
            },
            exportValue: (row) => {
              const canonical = row.__propertyType__;
              if (!canonical) return '';
              const acc = propertyTypeAccounts(canonical);
              if (!acc) return '';
              return [
                acc.electric ? `Elec ${acc.electric.label}` : null,
                acc.gas ? `Gas ${acc.gas.label}` : null,
                acc.water ? `Water ${acc.water.label}` : null,
                acc.waste ? `Waste ${acc.waste.label}` : null,
                acc.steam && acc.steam.label !== '0' ? `Steam ${acc.steam.label}` : null,
              ].filter(Boolean).join(' · ');
            },
          },
        ];
      })(),
    ];
  }, [sitesData, zipColumn, utility, supplierOverrides, editingSupplier, electricStartOverride, electricEndOverride, gasStartOverride, gasEndOverride]);

  const alwaysVisible = useMemo(() => {
    if (!columns.length) return [];
    return [
      columns[0].key,
      'propertyType',
      'siteDescription',
      'propertySize',
      'electric', 'electric_market', 'electric_rate', 'electricCost',
      'gas', 'gas_market', 'gas_rate', 'gasCost',
      'totalCost',
      'water',
    ];
  }, [columns]);

  const tableId = useMemo(
    () => `sites-list:${columns.map(c => c.key).sort().join('|')}`,
    [columns]
  );

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
      }
      if (r.__thermsSource__ && typeof r.__therms__ === 'number' && Number.isFinite(r.__therms__)) {
        gasActualTherms += r.__therms__; gasActualThermsSites++;
      } else if (r.__thermsFromEstimate__ && typeof r.__therms__ === 'number' && Number.isFinite(r.__therms__)) {
        gasEstTherms += r.__therms__; gasEstThermsSites++;
      }
      if (typeof r.__electricCostActual__ === 'number' && Number.isFinite(r.__electricCostActual__)) {
        elecActualCost += r.__electricCostActual__; elecActualCostSites++;
      } else if (typeof r.__electricCostEstimated__ === 'number' && Number.isFinite(r.__electricCostEstimated__)) {
        elecEstCost += r.__electricCostEstimated__; elecEstCostSites++;
      }
      if (typeof r.__gasCostActual__ === 'number' && Number.isFinite(r.__gasCostActual__)) {
        gasActualCost += r.__gasCostActual__; gasActualCostSites++;
      } else if (typeof r.__gasCostEstimated__ === 'number' && Number.isFinite(r.__gasCostEstimated__)) {
        gasEstCost += r.__gasCostEstimated__; gasEstCostSites++;
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
        electric: { actual: elecActualKwh, actualSites: elecActualKwhSites, est: elecEstKwh, estSites: elecEstKwhSites },
        gas:      { actual: gasActualTherms, actualSites: gasActualThermsSites, est: gasEstTherms, estSites: gasEstThermsSites },
      },
      cost: {
        electric: { actual: elecActualCost, actualSites: elecActualCostSites, est: elecEstCost, estSites: elecEstCostSites },
        gas:      { actual: gasActualCost, actualSites: gasActualCostSites, est: gasEstCost, estSites: gasEstCostSites },
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

  const utilMeta = utility?.meta || null;

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
    // programs are narrow enough (Direct Access only in CA, heavy-load
    // gating in VA, opt-in pilots in MI / WA, prior-3rd-party gating
    // in AZ) that the standard 2-4 % commodity savings doesn't apply.
    // Surfaced as 0 - 0 % so the Indicative Savings tab still lists
    // them (Status stays "Limited" so they aren't filtered out as
    // regulated) but every savings column resolves to $0.
    AZ: { status: 'Limited', range: '0 - 0%', lowPct: 0, highPct: 0 },
    CA: { status: 'Limited', range: '0 - 0%', lowPct: 0, highPct: 0 },
    MI: { status: 'Limited', range: '0 - 0%', lowPct: 0, highPct: 0 },
    VA: { status: 'Limited', range: '0 - 0%', lowPct: 0, highPct: 0 },
    WA: { status: 'Limited', range: '0 - 0%', lowPct: 0, highPct: 0 },
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
  const GAS_DEREGULATION = {
    AK: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    AL: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    CT: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    CO: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    DC: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    DE: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    IL: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    FL: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    GA: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    ID: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    MA: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    IN: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    KS: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    KY: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    LA: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    MD: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    ME: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    NH: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    NJ: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    MS: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    NB: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    ND: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    NE: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    NY: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    OH: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    ON: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    OR: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    PA: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    RI: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    TX: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    QC: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    CA: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    SC: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    SD: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    SK: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    MI: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    UT: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    VA: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    WA: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
    AB: { status: 'Large load only', range: '0 - 0%', lowPct: 0, highPct: 0 },
    AR: { status: 'Large load only', range: '0 - 0%', lowPct: 0, highPct: 0 },
    AZ: { status: 'Large load only', range: '0 - 0%', lowPct: 0, highPct: 0 },
    BC: { status: 'Large load only', range: '0 - 0%', lowPct: 0, highPct: 0 },
    IA: { status: 'Large load only', range: '0 - 0%', lowPct: 0, highPct: 0 },
    MB: { status: 'Large load only', range: '0 - 0%', lowPct: 0, highPct: 0 },
    MN: { status: 'Large load only', range: '0 - 0%', lowPct: 0, highPct: 0 },
    MO: { status: 'Large load only', range: '0 - 0%', lowPct: 0, highPct: 0 },
    MT: { status: 'Large load only', range: '0 - 0%', lowPct: 0, highPct: 0 },
    NC: { status: 'Large load only', range: '0 - 0%', lowPct: 0, highPct: 0 },
    NM: { status: 'Large load only', range: '0 - 0%', lowPct: 0, highPct: 0 },
    NV: { status: 'Large load only', range: '0 - 0%', lowPct: 0, highPct: 0 },
    OK: { status: 'Large load only', range: '0 - 0%', lowPct: 0, highPct: 0 },
    TN: { status: 'Large load only', range: '0 - 0%', lowPct: 0, highPct: 0 },
    WI: { status: 'Large load only', range: '0 - 0%', lowPct: 0, highPct: 0 },
    WV: { status: 'Large load only', range: '0 - 0%', lowPct: 0, highPct: 0 },
    WY: { status: 'Large load only', range: '0 - 0%', lowPct: 0, highPct: 0 },
  };

  // Detect a company column on the uploaded sites sheet so we can
  // group the overview by (company, state). Falls back to the sticky
  // first column when no company-like header exists.
  const siteCompanyColumn = useMemo(() => {
    if (!sitesData.length) return '';
    const headers = Object.keys(sitesData[0]);
    const match = headers.find(h => /company|portfolio|parent|owner|account/i.test(String(h)));
    return match || headers[0] || '';
  }, [sitesData]);

  // Build per-commodity overview rows grouped by (company, state).
  // Each row summarizes sites, deregulated-only consumption/spend,
  // and an indicative savings range.
  const overviewByCommodity = useMemo(() => {
    if (!utility?.zipMap || !rows.length || !siteCompanyColumn) {
      return { electric: [], gas: [] };
    }

    function buildFor(commodity) {
      const providerKey = `__${commodity}__`;
      const consumptionKey = commodity === 'electric' ? '__kwh__' : '__therms__';
      const costKey = `__${commodity}Cost__`;
      const groups = new Map();
      for (const r of rows) {
        const company = String(r[siteCompanyColumn] ?? '').trim();
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
          };
          groups.set(key, g);
        }
        g.totalSites++;
        const stateIsDeregulated = commodity === 'electric'
          ? !!ELECTRIC_DEREGULATION[state]
          : true; // no curated list for gas — rely on provider-level only
        if (!stateIsDeregulated) continue;
        const provider = r[providerKey];
        const classification = classifyUtility(provider);
        if (classification !== 'Deregulated') continue;
        g.deregulatedSites++;
        const consumption = r[consumptionKey];
        if (typeof consumption === 'number' && Number.isFinite(consumption)) {
          g.deregulatedConsumption += consumption;
        }
        const cost = r[costKey];
        if (typeof cost === 'number' && Number.isFinite(cost)) {
          g.deregulatedSpend += cost;
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
        // lowPct/highPct nulls resolve to blanks below.
        const low = (lowPct != null && g.deregulatedSpend > 0)
          ? Math.round(g.deregulatedSpend * lowPct * 100) / 100
          : (lowPct != null ? 0 : '');
        const high = (highPct != null && g.deregulatedSpend > 0)
          ? Math.round(g.deregulatedSpend * highPct * 100) / 100
          : (highPct != null ? 0 : '');
        out.push({
          Company: g.company,
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
        if (a.Company !== b.Company) return a.Company.localeCompare(b.Company);
        return a['ST/Prov'].localeCompare(b['ST/Prov']);
      });
      return out;
    }

    return { electric: buildFor('electric'), gas: buildFor('gas') };
  }, [rows, utility, siteCompanyColumn]);

  // Combined Summary: one row per company, rolling up both electric
  // and gas across every state the company operates in. State-level
  // detail stays on the per-commodity overview tabs; this view is
  // the executive roll-up.
  const summaryRows = useMemo(() => {
    const byKey = new Map();
    const toNum = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : 0;
    function ensureRow(company) {
      if (!byKey.has(company)) {
        byKey.set(company, {
          Company: company,
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
    // Track per-company total-site counts by state so we don't
    // double-count when a company appears in both the electric and
    // gas overviews for the same state.
    const siteTotalsByCompanyState = new Map();
    function recordSites(company, state, total) {
      const key = `${company}||${state}`;
      if (!siteTotalsByCompanyState.has(key)) {
        siteTotalsByCompanyState.set(key, toNum(total));
      }
    }
    for (const e of overviewByCommodity.electric) {
      const row = ensureRow(e.Company);
      row['States Covered'].add(e['ST/Prov'] || '—');
      row['Electric Deregulated Sites'] += toNum(e['Deregulated Sites']);
      row['Electric Annual Spend']      += toNum(e['Annual Deregulated Spend']);
      row['Electric Savings Low']       += toNum(e['Indicative Savings Low']);
      row['Electric Savings High']      += toNum(e['Indicative Savings High']);
      recordSites(e.Company, e['ST/Prov'] || '—', e['Total Sites']);
    }
    for (const g of overviewByCommodity.gas) {
      const row = ensureRow(g.Company);
      row['States Covered'].add(g['ST/Prov'] || '—');
      row['Gas Deregulated Sites'] += toNum(g['Deregulated Sites']);
      row['Gas Annual Spend']      += toNum(g['Annual Deregulated Spend']);
      row['Gas Savings Low']       += toNum(g['Indicative Savings Low']);
      row['Gas Savings High']      += toNum(g['Indicative Savings High']);
      recordSites(g.Company, g['ST/Prov'] || '—', g['Total Sites']);
    }
    // Fold per-(company, state) site totals back into each company row.
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
    out.sort((a, b) => a.Company.localeCompare(b.Company));
    return out;
  }, [overviewByCommodity]);

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
          'State': r.__state__ || '',
          'Country': r.__country__ || '',
          'Commodity': 'Electric',
          'Utility': r.__electric__ || '',
          'Supplier': r.__electricSupplier__ || '',
          'Contract Name': r.__electricContractName__ || '',
          'Product Type': r.__electricProductType__ || '',
          'Contract Start': r.__electricStart__ || '',
          'Contract End': r.__electricEnd__ || '',
          'Contract Price': r.__electricContractPrice__ ?? '',
          'Price Unit': r.__electricContractPrice__ != null ? '$/kWh' : '',
          'Annual Consumption': r.__kwh__ ?? '',
          'Consumption Unit': r.__kwh__ != null ? 'kWh' : '',
          'Annual Cost': r.__electricCost__ ?? '',
        });
      }
      if (hasAny(r.__gasSupplier__, r.__gasContractName__, r.__gasProductType__, r.__gasStart__, r.__gasEnd__, r.__gasContractPrice__)) {
        out.push({
          'Site': name,
          'State': r.__state__ || '',
          'Country': r.__country__ || '',
          'Commodity': 'Gas',
          'Utility': r.__gas__ || '',
          'Supplier': r.__gasSupplier__ || '',
          'Contract Name': r.__gasContractName__ || '',
          'Product Type': r.__gasProductType__ || '',
          'Contract Start': r.__gasStart__ || '',
          'Contract End': r.__gasEnd__ || '',
          'Contract Price': r.__gasContractPrice__ ?? '',
          'Price Unit': r.__gasContractPrice__ != null ? '$/therm' : '',
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
    const upsert = (commodity, supplier, contractName, productType, start, end, price, consumption, cost, consumptionUnit, priceUnit, company) => {
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
      }
      if (!g.productType && productType) g.productType = productType;
    };

    for (const r of rows) {
      const company = String(r[siteCompanyColumn] ?? '').trim();
      if (!company) continue;
      upsert('Electric',
        r.__electricSupplier__, r.__electricContractName__, r.__electricProductType__,
        r.__electricStart__, r.__electricEnd__, r.__electricContractPrice__,
        r.__kwh__, r.__electricCost__, 'kWh', '$/kWh', company);
      upsert('Gas',
        r.__gasSupplier__, r.__gasContractName__, r.__gasProductType__,
        r.__gasStart__, r.__gasEnd__, r.__gasContractPrice__,
        r.__therms__, r.__gasCost__, 'therms', '$/therm', company);
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
    const COUNTRY_OPTIONS = ['United States', 'Canada', 'Mexico', 'United Kingdom', 'Germany', 'France', 'Spain', 'Italy', 'Netherlands', 'Australia'];
    const CURRENCY_OPTIONS = ['USD', 'CAD', 'MXN', 'GBP', 'EUR', 'AUD'];
    const ELECTRIC_PRODUCT_OPTIONS = ['Fixed', 'Index', 'Block & Index', 'Heat Rate', 'Hybrid', 'Pass-through', 'Utility Default'];
    const GAS_PRODUCT_OPTIONS = ['Fixed', 'Index', 'NYMEX + Basis', 'Block & Index', 'Hybrid', 'Flexible', 'Pass-through', 'Utility Default'];

    const COMMON_FIELDS = [
      { label: 'Site Name', required: true, hint: 'Row label. Required so the row isn\'t filtered as blank. Enter on the Electric Power tab — the Gas tab pulls Site Name from there via formula.' },
      { label: 'Address', greenHeader: true, hint: 'Street address of the site. Optional reference field. Enter on the Electric Power tab — the Gas tab pulls from there via formula.' },
      { label: 'City', greenHeader: true, hint: 'City / town of the site. Optional reference field. Enter on the Electric Power tab — the Gas tab pulls from there via formula.' },
      { label: 'State / Province', greenHeader: true, hint: 'State or province. Optional reference field — auto-derived from Zip for US / Canada when blank. Enter on the Electric Power tab — the Gas tab pulls from there via formula.' },
      { label: 'Zip / Postal Code', greenHeader: true, hint: 'Required for US and Canada sites — drives the utility lookup and state derivation. Leave blank for sites outside US / Canada. Enter on the Electric Power tab; the Gas tab pulls from there via formula.' },
      { label: 'Country', greenHeader: true, hint: 'Country of the site. Pick from the dropdown on the Electric Power tab — the Gas tab pulls from there via formula. Falls back to the utility-rates file when blank.', validation: { type: 'list', options: COUNTRY_OPTIONS } },
      { label: 'Currency', greenHeader: true, hint: 'Currency the site reports costs in. Pick from the dropdown on the Electric Power tab — the Gas tab pulls from there via formula.', validation: { type: 'list', options: CURRENCY_OPTIONS } },
      { label: 'Property Type', greenHeader: true, hint: 'Building / use type. Drives the per-property-type consumption + account-count estimates surfaced on the page and on the Indicative Savings export. Pick from the dropdown on the Electric Power tab — the Gas tab pulls from there via formula.', validation: { type: 'list', options: PROPERTY_TYPE_OPTIONS } },
      { label: 'Site Description', greenHeader: true, hint: 'Free-text annotation for the site — building name, internal code, notes, anything that helps identify the row. Passthrough only; shown next to Property Type on the Utility Lookup page. Enter on the Electric Power tab — the Gas tab pulls from there via formula.' },
      { label: 'Size (ft²)', greenHeader: true, hint: 'Square footage of the site. Scales the property-type reference consumption linearly. Optional — when blank the reference size for the property type is used as-is. Enter on the Electric Power tab — the Gas tab pulls from there via formula.' },
    ];
    const ELECTRIC_FIELDS = [
      { label: 'Annual Electric Consumption', required: false, hint: 'Annual electricity usage. Pair with Electric UoM so the tool can convert to kWh for cost estimates. Used when Total Electric Cost is blank.' },
      { label: 'Electric UoM', required: false, hint: 'Unit of measure for the Electric Consumption column. Pick from the dropdown — defaults to kWh when blank.', validation: { type: 'list', options: ELECTRIC_UOM_OPTIONS } },
      { label: 'Total Electric Cost ($)', required: false, hint: 'Actual annual electric spend. Overrides the consumption × rate estimate when provided.' },
      { label: 'Electric Supplier / Vendor', required: false, hint: 'If the value matches a utility from the rates file it lands in the Electric Utility column; otherwise it lands in the Supplier column.' },
      { label: 'Electric Contract Start', required: false, hint: 'Start date of the existing electric supply contract. Formatted as Excel Short Date.', dateColumn: true },
      { label: 'Electric Contract End', required: false, hint: 'End / expiration date of the existing electric supply contract. Formatted as Excel Short Date.', dateColumn: true },
      { label: 'Electric Contract Price', required: false, hint: 'Price under the existing electric supply contract. Numeric — pair with Electric Contract Price UoM to indicate whether the figure is per kWh or per MWh.', priceColumn: 'kwh' },
      { label: 'Electric Contract Price UoM', required: false, hint: 'Per-unit denominator the Electric Contract Price is quoted against. Pick from the dropdown — defaults to kWh when blank.', validation: { type: 'list', options: ELECTRIC_PRICE_UOM_OPTIONS } },
      { label: 'Electric Contract Name', required: false, hint: 'Human-readable identifier for the existing electric contract.' },
      { label: 'Electric Product Type', required: false, hint: 'Pricing structure of the electric contract — pick from the dropdown or type a custom value.', validation: { type: 'list', options: ELECTRIC_PRODUCT_OPTIONS } },
    ];
    const GAS_FIELDS = [
      { label: 'Annual Gas Consumption', required: false, hint: 'Annual gas usage. Pair with Gas UoM so the tool can convert to therms. Used when Total Natural Gas Cost is blank.' },
      { label: 'Gas UoM', required: false, hint: 'Unit of measure for the Gas Consumption column. Pick from the dropdown — defaults to therms when blank.', validation: { type: 'list', options: GAS_UOM_OPTIONS } },
      { label: 'Total Natural Gas Cost ($)', required: false, hint: 'Actual annual gas spend. Overrides the consumption × rate estimate when provided.' },
      { label: 'Gas Supplier / Vendor', required: false, hint: 'If the value matches a utility from the rates file it lands in the Gas Utility column; otherwise it lands in the Supplier column.' },
      { label: 'Gas Contract Start', required: false, hint: 'Start date of the existing gas supply contract. Formatted as Excel Short Date.', dateColumn: true },
      { label: 'Gas Contract End', required: false, hint: 'End / expiration date of the existing gas supply contract. Formatted as Excel Short Date.', dateColumn: true },
      { label: 'Gas Contract Price', required: false, hint: 'Price under the existing gas supply contract. Numeric — pair with Gas Contract Price UoM to indicate whether the figure is per therm, Dth, MMBtu, Mcf, Ccf, or MWh.', priceColumn: 'therm' },
      { label: 'Gas Contract Price UoM', required: false, hint: 'Per-unit denominator the Gas Contract Price is quoted against. Pick from the dropdown — defaults to therm when blank.', validation: { type: 'list', options: GAS_PRICE_UOM_OPTIONS } },
      { label: 'Gas Contract Name', required: false, hint: 'Human-readable identifier for the existing gas contract.' },
      { label: 'Gas Product Type', required: false, hint: 'Pricing structure of the gas contract — pick from the dropdown or type a custom value.', validation: { type: 'list', options: GAS_PRODUCT_OPTIONS } },
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
    intro.value = 'Fill in the Electric Power tab and the Gas tab separately. Use the SAME Site Name on both tabs for each site — the importer joins the two tabs together by Site Name on upload. Site Name and Zip / Postal Code are required on each tab the site appears on. Everything else is optional. The Utility Lookup page derives State, Utility, Market, Rate, and Total Cost automatically from the rates file. Use the Electric UoM / Gas UoM dropdowns to choose what unit your consumption values are in; the tool converts to kWh / therms internally.';
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

  async function saveIndicativeSavingsToCompany(prospect) {
    if (!prospect?.id) return;
    setSaveStatus({ state: 'saving', message: `Saving to ${prospect.company || 'company'}…` });
    try {
      const result = await exportIndicativeSavings({ returnBuffer: true });
      if (!result) {
        setSaveStatus({ state: 'error', message: 'Nothing to save — load sites first.' });
        return;
      }
      const { buffer, fileName } = result;
      const dataBase64 = arrayBufferToBase64(buffer);
      // Firestore single-document limit is 1 MiB; warn the user well
      // below that since the wrapper metadata adds a few KB on top.
      if (dataBase64.length > 950_000) {
        setSaveStatus({ state: 'error', message: 'Analysis is too large for a single Firestore doc (> ~700 KB raw). Trim sites and retry.' });
        return;
      }
      // Wipe any prior saved analysis on this prospect before writing
      // the new one, so the save is a clean replace rather than relying
      // solely on setDoc semantics — guards against any stale field
      // surviving an interrupted prior write.
      try { await deleteIndicativeAnalysis(prospect.id); } catch { /* nothing to delete is fine */ }
      await saveIndicativeAnalysis(prospect.id, {
        fileName,
        dataBase64,
        sizeBytes: buffer.byteLength,
      });
      setSaveStatus({ state: 'success', message: `Saved to ${prospect.company || 'company'}.` });
      setSavePickerSearch(null);
      setTimeout(() => setSaveStatus({ state: 'idle', message: '' }), 4000);
    } catch (err) {
      console.error('Save indicative analysis failed:', err);
      setSaveStatus({ state: 'error', message: err?.message || 'Save failed.' });
    }
  }

  async function exportIndicativeSavings({ returnBuffer = false } = {}) {
    if (!rows.length) return null;
    const { Workbook } = await import('exceljs');
    const SE_GREEN_DARK = 'FF009530';
    const SE_GREEN_LIGHT = 'FFE6F7EC';
    const SE_TEXT_DARK = 'FF1E293B';
    const SE_BORDER = 'FFD4DDE1';
    const SE_GREEN = 'FF3DCD58';
    const SE_SLATE = 'FF475569';

    // Mexico-specific helpers. Baja California / Baja California Sur
    // run on a grid separate from CFE's national system, so they
    // never count as a CFE sourcing opportunity. CFE is the only
    // viable counterparty for the rest of Mexico — other utilities
    // are private generators or self-supply and aren't a target.
    // Threshold: 6 GWh/yr (6,000,000 kWh) per site for the
    // procurement opportunity to be worth pursuing.
    const MEXICO_CFE_KWH_THRESHOLD = 6_000_000;
    const isMexico = (country) => /^mexic/i.test(String(country || ''));
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
      if (/^[-—–_]+$/.test(t)) return true; // dashes / em / en / underscore
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
        const state = r.__state__ || '';
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
            bandStatus = entry?.status || 'no';
            bandRange = entry?.range ?? '';
            bandLowPct = entry?.lowPct ?? null;
            bandHighPct = entry?.highPct ?? null;
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
            regulatedRateOpportunitySites: 0,
            regulatedRateOpportunitySpend: 0,
            consumption: 0,
            spend: 0,
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
              if (typeof regCost === 'number' && Number.isFinite(regCost)) {
                g.regulatedRateOpportunitySpend += regCost;
              }
            }
          } else if (isRegulatedRateOpportunity(state, provider)) {
            g.regulatedRateOpportunitySites += 1;
            const regCost = r[costKey];
            if (typeof regCost === 'number' && Number.isFinite(regCost)) {
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
          && !isBajaState(r.__state__)
          && isCFE(r.__electric__)) {
          const kwh = (typeof r.__kwh__ === 'number' && Number.isFinite(r.__kwh__)) ? r.__kwh__ : 0;
          if (kwh > MEXICO_CFE_KWH_THRESHOLD) g.hasMexicoSourcing = true;
        }
        // Country buckets defer to the country reference for the dereg
        // classification — the per-utility classifier is keyed off US
        // naming patterns and would mis-classify international utilities.
        const isDereg = isCountryBucket
          ? (g.status === 'Deregulated' || g.status === 'Some deregulation')
          : (classifyUtility(provider) === 'Deregulated' || !!r[supplierKey]);
        if (!isDereg) continue;
        g.deregulatedSites += 1;
        const consumption = r[consumptionKey];
        if (typeof consumption === 'number' && Number.isFinite(consumption)) {
          // Gas: kWh-equivalent therms → Dth (÷10) for the export column.
          g.consumption += commodity === 'gas' ? consumption / 10 : consumption;
        }
        const cost = r[costKey];
        const spend = (typeof cost === 'number' && Number.isFinite(cost)) ? cost : 0;
        if (spend) g.spend += spend;
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
        const annualLow = (spend > 0 && lowPct != null) ? spend * lowPct : 0;
        const annualHigh = (spend > 0 && highPct != null) ? spend * highPct : 0;
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
          annualSpend: Math.round(spend),
          lowPct,
          highPct,
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
          regulatedRateOpportunitySites: g.regulatedRateOpportunitySites,
          regulatedRateOpportunitySpend: Math.round(g.regulatedRateOpportunitySpend),
          regRateSavings,
          consumption: Math.round(g.consumption),
          spend: Math.round(g.spend),
          range,
          // Per-state flags joined with newlines so the cell wraps
          // visibly on the by-state sheet. Electric: small market
          // (< $1M dereg spend), Risk Management consideration
          // (> 10,000 MWh dereg consumption — kWh > 10M), Mexico
          // sourcing opportunity (any Mexican site with > 1 MWh).
          // Gas: too-low-for-sourcing (< $30K dereg spend).
          flags: (() => {
            const out = [];
            if (commodity === 'electric') {
              if (g.spend > 0 && g.spend < 1_000_000) out.push('⚠ Spend < $1M — small electric market');
              // g.consumption is the sum of every site's __kwh__ in
              // this state (kilowatt-hours per year). Divide by 1000
              // to convert to MWh before comparing to the 10,000 MWh
              // Risk Management threshold.
              const consumptionMWh = g.consumption / 1000;
              if (consumptionMWh > 10_000) out.push('⚠ Risk Management should be considered (>10,000 MWh)');
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
                out.push('★ Virginia site exceeds 45,000 MWh/yr — large-load deregulation threshold met');
              }
              // Arizona / Michigan: limited retail-choice markets where
              // we can only support a customer if they already have a
              // third-party supply contract in place. Fires on any
              // electric load — even regulated sites — so the seller
              // sees the gating up front.
              if ((g.state === 'AZ' || g.state === 'MI') && g.anyConsumption > 0) {
                out.push('⚠ Limited market — can only help if 3rd-party supply is already in place');
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

    const wb = new Workbook();
    wb.creator = 'Schneider Electric · Prospect Tracker';
    wb.created = new Date();

    // ---- Portfolio Overview sheet -----------------------------------
    // World map + per-bucket dot rendering. Each dot is split
    // vertically — left half colored by electric deregulation tier,
    // right half by gas — so the user can read both commodities at
    // once. Sites bucket by US state / Canadian province / country;
    // dot radius scales with site count. Map is rendered to a canvas
    // and embedded as a PNG because ExcelJS doesn't write charts.
    {
      const ws = wb.addWorksheet('Portfolio Overview', {
        properties: { tabColor: { argb: SE_GREEN_DARK } },
        views: [{ showGridLines: false }],
      });
      // COLS covers the map image (≈ cols 1-14) plus a few extra
      // columns to the right that host the legend block.
      const MAP_COLS = 14;
      const LEGEND_COLS = 4;
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
        { width: 4 },  // gutter between map and legend
        { width: 6 },  // saturated swatch
        { width: 6 },  // (kept for legacy header alignment)
        { width: 28 }, // tier label
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
          elecTier = e?.status === 'yes' ? 'dereg' : (e?.status === 'large' ? 'some' : 'reg');
          gasTier  = g?.status === 'yes' ? 'dereg' : (g?.status === 'large' ? 'some' : 'reg');
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

      // Tier totals across mapped buckets for the Overview table.
      // Site count rolls up per-bucket; load + cost aggregate over
      // the original rows array so we get per-site precision. Cost
      // uses the actual upload value when present and falls back to
      // the consumption × rate estimate.
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
      // Per-tier load + cost — keyed by the same tier label the
      // Overview table uses. `electric` tracks electric-tier
      // attribution (kWh + electric cost); `gas` tracks gas-tier
      // attribution (therms + gas cost).
      const blankTierAgg = () => ({ kwh: 0, therms: 0, cost: 0 });
      const electricTierAgg = { dereg: blankTierAgg(), some: blankTierAgg(), reg: blankTierAgg(), mixed: blankTierAgg(), unknown: blankTierAgg() };
      const gasTierAgg      = { dereg: blankTierAgg(), some: blankTierAgg(), reg: blankTierAgg(), mixed: blankTierAgg(), unknown: blankTierAgg() };
      const rowTierFor = (commodity, country, stateCode, isUS, isCA) => {
        if (isUS && US_STATE_CENTERS[stateCode]) {
          const m = commodity === 'electric' ? ELECTRIC_DEREGULATION[stateCode] : GAS_DEREGULATION[stateCode];
          return m?.status === 'yes' ? 'dereg' : (m?.status === 'large' ? 'some' : 'reg');
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

      // Canvas render — equirectangular projection. The map itself
      // is now drawn from the bundled world-atlas TopoJSON
      // (src/data/countries-110m.json) so each country can be filled
      // independently by its deregulation tier. Lat/lng → pixel uses
      // the same linear projection the dots use.
      const W = 1200, H = 600;
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      // Ocean background.
      ctx.fillStyle = '#F1F5F9';
      ctx.fillRect(0, 0, W, H);

      const project = (lng, lat) => [((lng + 180) / 360) * W, ((90 - lat) / 180) * H];

      // Choropleth fills — every country's color comes from its
      // COUNTRY_DEREGULATION entry so the map matches the Country
      // level view table below. Portfolio has sites → saturated
      // tier color; no sites → uniform light gray so the sites-
      // having countries dominate visually. No more "Mixed" tier;
      // US and Canada read their country reference directly.
      const NO_SITES_FILL = '#E2E8F0';
      const countryFeatures = getCountryFeatures();
      for (const feat of countryFeatures) {
        const derGKey = TOPO_NAME_TO_DEREG_KEY[feat.name] || feat.name;
        const c = COUNTRY_DEREGULATION[derGKey];
        const tier = c ? statusTier(c.electric) : 'unknown';
        const hasSites = countryAggs.has(derGKey);
        ctx.fillStyle = hasSites ? TIER_COLORS[tier] : NO_SITES_FILL;
        ctx.strokeStyle = '#94A3B8';
        ctx.lineWidth = 0.5;
        // Antimeridian-aware sub-ring splitting: countries that
        // cross the date line (Russia, Fiji, the Aleutians) have
        // adjacent ring points whose longitudes jump by ~360°.
        // Drawing those connectors straight in equirectangular space
        // streaks a long line across the entire map. Splitting the
        // ring at each big jump and drawing each sub-ring as its
        // own closed polygon keeps the fill intact without the
        // wraparound artifact.
        for (const ring of feat.rings) {
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
      }

      // Plot dots — radius scales with sqrt(count) so a 100-site
      // bucket isn't 100× the area of a 1-site bucket.
      const maxCount = Math.max(1, ...Array.from(buckets.values()).map(b => b.count));
      const dots = Array.from(buckets.values());
      // Larger dots first so smaller dots don't get hidden underneath.
      dots.sort((a, b) => b.count - a.count);
      for (const b of dots) {
        const [x, y] = project(b.location[0], b.location[1]);
        const r = 6 + Math.sqrt(b.count / maxCount) * 18;
        // Two-tone fill: electric (left half) + gas (right half).
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, r, Math.PI / 2, (3 * Math.PI) / 2, false);
        ctx.closePath();
        ctx.fillStyle = TIER_COLORS[b.elecTier];
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, r, -Math.PI / 2, Math.PI / 2, false);
        ctx.closePath();
        ctx.fillStyle = TIER_COLORS[b.gasTier];
        ctx.fill();
        ctx.restore();
        // Site-count number — no ring outline so each dot reads as a
        // clean two-tone fill against the choropleth.
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = '#0F172A';
        ctx.font = `bold ${Math.max(10, Math.min(16, Math.round(r * 0.9)))}px Nunito Sans, Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeText(String(b.count), x, y + 4);
        ctx.fillText(String(b.count), x, y + 4);
      }

      // Legend is rendered as Excel cells to the RIGHT of the map
      // image (further down) so the user gets searchable, copyable,
      // resizable swatches instead of pixels burned into the PNG.

      const dataUrl = canvas.toDataURL('image/png');
      const imageId = wb.addImage({ base64: dataUrl, extension: 'png' });

      // Title band.
      ws.mergeCells(1, 1, 1, COLS);
      const title = ws.getCell(1, 1);
      title.value = 'Portfolio Overview — Site Distribution by Market';
      title.font = { name: 'Nunito Sans', bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
      title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
      title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(1).height = 30;

      ws.mergeCells(2, 1, 2, COLS);
      const sub = ws.getCell(2, 1);
      const subtotal = mappedSites;
      const skippedNote = skippedCount > 0 ? ` (${skippedCount} site${skippedCount === 1 ? '' : 's'} skipped — country not in the geographic reference)` : '';
      sub.value = `${subtotal} site${subtotal === 1 ? '' : 's'} plotted across ${buckets.size} bucket${buckets.size === 1 ? '' : 's'}. Dots are split vertically — left half is the Electric deregulation tier, right half is the Gas tier. Dot size scales with the number of sites in that state / country.${skippedNote}`;
      sub.font = { name: 'Nunito Sans', italic: true, size: 10, color: { argb: SE_SLATE } };
      sub.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
      ws.getRow(2).height = 36;

      // Anchor the image starting at row 4. Image dimensions are in
      // pixels; cell-grid sizing scales it visually.
      ws.addImage(imageId, {
        tl: { col: 0, row: 3 },
        ext: { width: W, height: H },
      });

      // Legend block — rendered as Excel cells to the right of the
      // map image. The swatch sits in the swatch column; the tier
      // label sits in the label column. Single swatch per tier
      // (countries with sites only); a final gray row marks the
      // no-sites fill.
      const legendStart = 4; // 1-indexed row
      const swatchCol = MAP_COLS + 2;
      const labelCol = MAP_COLS + 4;

      ws.mergeCells(legendStart, swatchCol, legendStart, labelCol);
      const legTitle = ws.getCell(legendStart, swatchCol);
      legTitle.value = 'Legend';
      legTitle.font = { name: 'Nunito Sans', bold: true, size: 12, color: { argb: SE_GREEN_DARK } };
      legTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
      legTitle.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(legendStart).height = 22;

      ws.mergeCells(legendStart + 1, swatchCol, legendStart + 1, labelCol);
      const legCap = ws.getCell(legendStart + 1, swatchCol);
      legCap.value = 'Country fill = deregulation tier. Countries with no portfolio sites are grayed out.';
      legCap.font = { name: 'Nunito Sans', italic: true, size: 9, color: { argb: SE_SLATE } };
      legCap.alignment = { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 };
      ws.getRow(legendStart + 1).height = 36;

      // One row per tier: tier-color swatch + tier label. Plus a
      // final gray "No sites" row that matches the no-sites fill.
      const hexToArgb = (hex) => 'FF' + String(hex).replace(/^#/, '').toUpperCase();
      const swatchBorder = {
        top:    { style: 'thin', color: { argb: 'FF94A3B8' } },
        bottom: { style: 'thin', color: { argb: 'FF94A3B8' } },
        left:   { style: 'thin', color: { argb: 'FF94A3B8' } },
        right:  { style: 'thin', color: { argb: 'FF94A3B8' } },
      };
      const legendEntries = [
        ['dereg',  TIER_COLORS.dereg, TIER_LABELS.dereg],
        ['some',   TIER_COLORS.some,  TIER_LABELS.some],
        ['reg',    TIER_COLORS.reg,   TIER_LABELS.reg],
        ['nosite', NO_SITES_FILL,     'No sites'],
      ];
      legendEntries.forEach(([_t, color, label], i) => {
        const rowIdx = legendStart + 2 + i;
        const sw = ws.getCell(rowIdx, swatchCol);
        sw.value = '';
        sw.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hexToArgb(color) } };
        sw.border = swatchBorder;
        const lbl = ws.getCell(rowIdx, labelCol);
        lbl.value = label;
        lbl.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
        lbl.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        ws.getRow(rowIdx).height = 18;
      });

      // Caption explaining the dot encoding sits below the tier list.
      const dotsCapRow = legendStart + 2 + legendEntries.length + 1;
      ws.mergeCells(dotsCapRow, swatchCol, dotsCapRow, labelCol);
      const dotsCap = ws.getCell(dotsCapRow, swatchCol);
      dotsCap.value = 'Each site dot — left half = Electric tier, right half = Gas tier. Dot size scales with the number of sites in that bucket.';
      dotsCap.font = { name: 'Nunito Sans', italic: true, size: 9, color: { argb: SE_SLATE } };
      dotsCap.alignment = { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 };
      ws.getRow(dotsCapRow).height = 42;

      // Overview table sits just below the map image. Anchored at
      // row 30 so the table starts before the image bleeds into
      // taller cell heights below it — the Country level view
      // follows immediately underneath (the country header recalcs
      // its row offset from this constant).
      const SUMMARY_START = 30;
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
        ['Deregulated',          'dereg',   elecDereg,   gasDereg],
        ['Some deregulation',    'some',    elecSome,    gasSome],
        ['Regulated / unlikely', 'reg',     elecReg,     gasReg],
        ['No data',              'unknown', elecUnknown, gasUnknown],
      ];
      const pct = (n) => mappedSites > 0 ? n / mappedSites : 0;
      tierRows.forEach((tr, i) => {
        const r = ws.getRow(tableHeaderRow + 1 + i);
        const [label, tierKey, eSites, gSites] = tr;
        const kwh = electricTierAgg[tierKey]?.kwh || 0;
        const therms = gasTierAgg[tierKey]?.therms || 0;
        const cost = (electricTierAgg[tierKey]?.cost || 0) + (gasTierAgg[tierKey]?.cost || 0);
        r.getCell(1).value = label;
        r.getCell(2).value = eSites;
        r.getCell(3).value = pct(eSites);
        r.getCell(4).value = gSites;
        r.getCell(5).value = pct(gSites);
        r.getCell(6).value = Math.round(kwh);
        r.getCell(7).value = Math.round(therms / 10); // therms → Dth
        r.getCell(8).value = Math.round(cost);
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

      // ---- Country breakdown table -----------------------------
      // One row per country in the portfolio: dereg status, site
      // count, load (kWh + Dth), cost (actual + estimated). Sorted
      // by descending site count so the heaviest concentrations
      // sit at the top.
      if (countryRows.length > 0) {
        const countryHdrRow = tableHeaderRow + tierRows.length + 3;
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
      const ws = wb.addWorksheet('North America Overview', {
        properties: { tabColor: { argb: SE_GREEN_DARK } },
        views: [{ showGridLines: false }],
      });
      const MAP_COLS = 14;
      const LEGEND_COLS = 4;
      const COLS = MAP_COLS + LEGEND_COLS;
      const NUMERIC_WIDE_COLS = new Set([5, 6, 7, 8]);
      ws.columns = [
        ...Array.from({ length: MAP_COLS }, (_, i) => ({
          width: NUMERIC_WIDE_COLS.has(i + 1) ? 17 : 12,
        })),
        { width: 4 },
        { width: 6 },
        { width: 6 },
        { width: 28 },
      ];

      // Bucket NA sites by (state | province). Non-NA rows are
      // skipped — they're already covered on the Portfolio Overview
      // sheet, so dropping them here keeps this view focused.
      const buckets = new Map();
      let skippedCount = 0;
      let naSiteCount = 0;
      for (const r of rows) {
        const rawCountry = String(r.__country__ || '').trim();
        const country = normalizeCountryName(rawCountry) || rawCountry;
        const stateCode = String(r.__state__ || '').trim().toUpperCase();
        const isUS = /^(united states|usa|us)$/i.test(country);
        const isCA = /^(canada|ca)$/i.test(country);
        if (!isUS && !isCA) continue;
        naSiteCount++;
        let key, location, elecTier, gasTier, label;
        if (isUS && US_STATE_CENTERS[stateCode]) {
          key = `US/${stateCode}`;
          location = US_STATE_CENTERS[stateCode];
          label = `${stateCode}, USA`;
          const e = ELECTRIC_DEREGULATION[stateCode];
          const g = GAS_DEREGULATION[stateCode];
          elecTier = e?.status === 'yes' ? 'dereg' : (e?.status === 'large' ? 'some' : 'reg');
          gasTier  = g?.status === 'yes' ? 'dereg' : (g?.status === 'large' ? 'some' : 'reg');
        } else if (isCA && CANADA_PROVINCE_CENTERS[stateCode]) {
          key = `CA/${stateCode}`;
          location = CANADA_PROVINCE_CENTERS[stateCode];
          label = `${stateCode}, Canada`;
          elecTier = 'dereg';
          gasTier = 'dereg';
        } else {
          // NA row whose state code we don't have a centroid for
          // (rare — usually a malformed state). Counts towards the
          // total but doesn't get a dot.
          skippedCount++;
          continue;
        }
        if (!buckets.has(key)) {
          buckets.set(key, { location, elecTier, gasTier, label, count: 0, stateCode, country: isUS ? 'United States' : 'Canada' });
        }
        buckets.get(key).count++;
      }

      // Tier roll-up — sites bucket by tier on the map, load + cost
      // attribute per-row.
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
      const blankTierAgg = () => ({ kwh: 0, therms: 0, cost: 0 });
      const electricTierAgg = { dereg: blankTierAgg(), some: blankTierAgg(), reg: blankTierAgg(), mixed: blankTierAgg(), unknown: blankTierAgg() };
      const gasTierAgg      = { dereg: blankTierAgg(), some: blankTierAgg(), reg: blankTierAgg(), mixed: blankTierAgg(), unknown: blankTierAgg() };
      const rowTierFor = (commodity, country, stateCode, isUS, isCA) => {
        if (isUS && US_STATE_CENTERS[stateCode]) {
          const m = commodity === 'electric' ? ELECTRIC_DEREGULATION[stateCode] : GAS_DEREGULATION[stateCode];
          return m?.status === 'yes' ? 'dereg' : (m?.status === 'large' ? 'some' : 'reg');
        }
        if (isCA && CANADA_PROVINCE_CENTERS[stateCode]) return 'dereg';
        return 'unknown';
      };
      // Per-state aggregation for the breakdown table at the bottom.
      const stateAggs = new Map();
      for (const r of rows) {
        const rawCountry = String(r.__country__ || '').trim();
        const country = normalizeCountryName(rawCountry) || rawCountry;
        const stateCode = String(r.__state__ || '').trim().toUpperCase();
        const isUS = /^(united states|usa|us)$/i.test(country);
        const isCA = /^(canada|ca)$/i.test(country);
        if (!isUS && !isCA) continue;
        const eTier = rowTierFor('electric', country, stateCode, isUS, isCA);
        const gTier = rowTierFor('gas',      country, stateCode, isUS, isCA);
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
        const key = `${isUS ? 'US' : 'CA'}/${stateCode || '—'}`;
        let agg = stateAggs.get(key);
        if (!agg) {
          const eDereg = ELECTRIC_DEREGULATION[stateCode];
          const gDereg = GAS_DEREGULATION[stateCode];
          agg = {
            label: stateCode || '—',
            country: isUS ? 'United States' : 'Canada',
            elecStatus: isCA ? 'Deregulated' : (eDereg?.status === 'yes' ? 'Deregulated' : (eDereg?.status === 'large' ? 'Some deregulation' : 'Regulated')),
            gasStatus:  isCA ? 'Deregulated' : (gDereg?.status === 'yes' ? 'Deregulated' : (gDereg?.status === 'large' ? 'Some deregulation' : 'Regulated')),
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

      // Canvas — NA-bounded equirectangular projection so the map
      // fills the canvas with the US + Canada landmass. Lat range
      // covers from northern Canada down to the southern US border;
      // longitude covers Alaska through Newfoundland.
      const W = 1200, H = 600;
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#F1F5F9';
      ctx.fillRect(0, 0, W, H);

      const NA_LNG_MIN = -170;
      const NA_LNG_MAX = -52;
      const NA_LAT_MIN = 18;
      const NA_LAT_MAX = 75;
      const project = (lng, lat) => [
        ((lng - NA_LNG_MIN) / (NA_LNG_MAX - NA_LNG_MIN)) * W,
        ((NA_LAT_MAX - lat) / (NA_LAT_MAX - NA_LAT_MIN)) * H,
      ];

      // Canvas helper — draws a feature's rings with antimeridian-
      // aware sub-ring splitting (Alaska's Aleutian chain crosses
      // -180°, otherwise the polygon streaks a connector all the way
      // across the canvas). Shared by both the Mexico landmass pass
      // and the per-state / per-province admin-1 pass below.
      const drawFeature = (rings) => {
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

      // Pass 1 — Mexico landmass at the southern edge. Drawn first
      // (under the admin-1 polygons) and tinted with the no-sites
      // gray so the map has a soft southern boundary instead of a
      // hard cutoff at the US border. Pulled from the country
      // TopoJSON; the admin-1 layer doesn't carry Mexican states.
      const NO_SITES_FILL = '#E2E8F0';
      ctx.strokeStyle = '#94A3B8';
      ctx.lineWidth = 0.5;
      ctx.fillStyle = NO_SITES_FILL;
      const countryFeatures = getCountryFeatures();
      for (const feat of countryFeatures) {
        const derGKey = TOPO_NAME_TO_DEREG_KEY[feat.name] || feat.name;
        if (derGKey !== 'Mexico' && feat.name !== 'Mexico') continue;
        drawFeature(feat.rings);
      }

      // Pass 2 — choropleth at the state / province level. Each US
      // state + DC and each Canadian province is filled with its
      // NA_CATEGORIES color (matching the Markets Legend in the
      // sidebar). States / provinces without an explicit category
      // default to the regulated (NG & EP) bucket so every polygon
      // carries a fill. The map uses a darker tone for the
      // regulated bucket than the table cells do — without that,
      // the northern Canadian territories (mostly REG_NG_EP) blend
      // into the pale-blue ocean instead of reading as land.
      const naMarketByPostal = new Map();
      for (const m of US_MARKETS) naMarketByPostal.set(`US/${m.code}`, m);
      for (const m of CA_MARKETS) naMarketByPostal.set(`CA/${m.code}`, m);
      const naFeatures = getNAAdmin1Features();
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = '#94A3B8';
      const hexToCanvas = (argb) => '#' + String(argb).replace(/^FF/i, '');
      const MAP_REG_FILL = '#9CA3AF';
      for (const feat of naFeatures) {
        const marketKey = `${feat.admin}/${feat.postal}`;
        const m = naMarketByPostal.get(marketKey);
        const cat = m ? NA_CATEGORIES[m.category] : null;
        if (!cat || cat.key === 'REG_NG_EP') {
          ctx.fillStyle = MAP_REG_FILL;
        } else {
          ctx.fillStyle = hexToCanvas(cat.fill);
        }
        drawFeature(feat.rings);
      }

      // Site dots — same two-tone (electric left half / gas right
      // half) treatment as the Portfolio Overview map.
      const maxCount = Math.max(1, ...Array.from(buckets.values()).map(b => b.count));
      const dots = Array.from(buckets.values()).sort((a, b) => b.count - a.count);
      for (const b of dots) {
        const [x, y] = project(b.location[0], b.location[1]);
        const r = 6 + Math.sqrt(b.count / maxCount) * 18;
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, r, Math.PI / 2, (3 * Math.PI) / 2, false);
        ctx.closePath();
        ctx.fillStyle = TIER_COLORS[b.elecTier];
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, r, -Math.PI / 2, Math.PI / 2, false);
        ctx.closePath();
        ctx.fillStyle = TIER_COLORS[b.gasTier];
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = '#0F172A';
        ctx.font = `bold ${Math.max(10, Math.min(16, Math.round(r * 0.9)))}px Nunito Sans, Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeText(String(b.count), x, y + 4);
        ctx.fillText(String(b.count), x, y + 4);
      }

      const dataUrl = canvas.toDataURL('image/png');
      const imageId = wb.addImage({ base64: dataUrl, extension: 'png' });

      ws.mergeCells(1, 1, 1, COLS);
      const title = ws.getCell(1, 1);
      title.value = 'North America Overview — US + Canada Site Distribution';
      title.font = { name: 'Nunito Sans', bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
      title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
      title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(1).height = 30;

      ws.mergeCells(2, 1, 2, COLS);
      const sub = ws.getCell(2, 1);
      const skippedNote = skippedCount > 0 ? ` (${skippedCount} site${skippedCount === 1 ? '' : 's'} skipped — state / province code not in the geographic reference)` : '';
      sub.value = `${naSiteCount} North America site${naSiteCount === 1 ? '' : 's'} plotted across ${buckets.size} state/province bucket${buckets.size === 1 ? '' : 's'}. Dots split vertically — left half is the Electric deregulation tier, right half is the Gas tier. Dot size scales with the site count.${skippedNote}`;
      sub.font = { name: 'Nunito Sans', italic: true, size: 10, color: { argb: SE_SLATE } };
      sub.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
      ws.getRow(2).height = 36;

      ws.addImage(imageId, {
        tl: { col: 0, row: 3 },
        ext: { width: W, height: H },
      });

      // Markets Legend — top-right of the map. Lists every NA market
      // category with its swatch + label so the user reads the map
      // and the legend side-by-side without scrolling. Same display
      // order the SE deregulation reference uses top-to-bottom.
      const legendStart = 4;
      const swatchCol = MAP_COLS + 2;
      const labelCol = MAP_COLS + 4;
      ws.mergeCells(legendStart, swatchCol, legendStart, labelCol);
      const legTitle = ws.getCell(legendStart, swatchCol);
      legTitle.value = 'North America Markets Legend';
      legTitle.font = { name: 'Nunito Sans', bold: true, size: 12, color: { argb: SE_GREEN_DARK } };
      legTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
      legTitle.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(legendStart).height = 22;

      const legendOrder = [
        'REG_NG_EP', 'DEREG_NG', 'DEREG_NG_EP',
        'DEREG_NG_LIMITED_EP', 'DEREG_NG_HEAVY_EP',
        'LIMITED_EP', 'DIRECT_ACCESS_EP', 'HEAVY_EP',
        'CA_LIMITED_NG_DEREG_EP', 'CA_LIMITED_NG_REG_EP',
      ];
      const swatchBorder = {
        top:    { style: 'thin', color: { argb: SE_BORDER } },
        bottom: { style: 'thin', color: { argb: SE_BORDER } },
        left:   { style: 'thin', color: { argb: SE_BORDER } },
        right:  { style: 'thin', color: { argb: SE_BORDER } },
      };
      legendOrder.forEach((key, idx) => {
        const cat = NA_CATEGORIES[key];
        if (!cat) return;
        const rowIdx = legendStart + 1 + idx;
        const sw = ws.getCell(rowIdx, swatchCol);
        sw.value = '';
        sw.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cat.fill } };
        sw.border = swatchBorder;
        const lbl = ws.getCell(rowIdx, labelCol);
        lbl.value = cat.label;
        lbl.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
        lbl.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
        ws.getRow(rowIdx).height = 28;
      });

      const dotsCapRow = legendStart + 1 + legendOrder.length + 1;
      ws.mergeCells(dotsCapRow, swatchCol, dotsCapRow, labelCol);
      const dotsCap = ws.getCell(dotsCapRow, swatchCol);
      dotsCap.value = 'Site dots — left half = Electric tier, right half = Gas tier. Dot size scales with the number of sites. Mexico is gray for geographic context only.';
      dotsCap.font = { name: 'Nunito Sans', italic: true, size: 9, color: { argb: SE_SLATE } };
      dotsCap.alignment = { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 };
      ws.getRow(dotsCapRow).height = 56;

      // Overview table — same tier rollup as Portfolio Overview but
      // scoped to NA sites only.
      const SUMMARY_START = 30;
      ws.mergeCells(SUMMARY_START, 1, SUMMARY_START, COLS);
      const sumHdr = ws.getCell(SUMMARY_START, 1);
      sumHdr.value = 'NA Overview';
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
        ['Deregulated',          'dereg',   elecDereg,   gasDereg],
        ['Some deregulation',    'some',    elecSome,    gasSome],
        ['Regulated / unlikely', 'reg',     elecReg,     gasReg],
        ['No data',              'unknown', elecUnknown, gasUnknown],
      ];
      const pct = (n) => mappedSites > 0 ? n / mappedSites : 0;
      tierRows.forEach((tr, i) => {
        const r = ws.getRow(tableHeaderRow + 1 + i);
        const [label, tierKey, eSites, gSites] = tr;
        const kwh = electricTierAgg[tierKey]?.kwh || 0;
        const therms = gasTierAgg[tierKey]?.therms || 0;
        const cost = (electricTierAgg[tierKey]?.cost || 0) + (gasTierAgg[tierKey]?.cost || 0);
        r.getCell(1).value = label;
        r.getCell(2).value = eSites;
        r.getCell(3).value = pct(eSites);
        r.getCell(4).value = gSites;
        r.getCell(5).value = pct(gSites);
        r.getCell(6).value = Math.round(kwh);
        r.getCell(7).value = Math.round(therms / 10);
        r.getCell(8).value = Math.round(cost);
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

      // Per state / per province deregulation reference. Sourced from
      // the same US_MARKETS + CA_MARKETS dataset that drives the
      // North America Markets sheet, so the two tabs stay in sync.
      // Portfolio site counts + load + cost roll in from stateAggs;
      // states / provinces with no sites still render with zeros so
      // the user gets a full reference without flipping tabs. The
      // Markets legend is appended directly below the table.
      {
        const stateHdrRow = tableHeaderRow + tierRows.length + 3;
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

        // Rank by Annual Cost descending — largest portfolio markets
        // at the top, states / provinces with no sites (cost = 0)
        // fall to the bottom sorted alphabetically by code.
        const marketRows = [
          ...US_MARKETS.map(m => ({ ...m, country: 'United States', countryKey: 'US' })),
          ...CA_MARKETS.map(m => ({ ...m, country: 'Canada',        countryKey: 'CA' })),
        ].sort((a, b) => {
          const aCost = stateAggs.get(`${a.countryKey}/${a.code}`)?.cost || 0;
          const bCost = stateAggs.get(`${b.countryKey}/${b.code}`)?.cost || 0;
          if (bCost !== aCost) return bCost - aCost;
          return String(a.code).localeCompare(String(b.code));
        });
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
          rr.getCell(6).value = cat?.label || 'Regulated — NG & EP';
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
          if (sites > 0) {
            rr.getCell(7).font = { name: 'Nunito Sans', size: 10, bold: true, color: { argb: SE_TEXT_DARK } };
          }
          rr.height = 20;
        });
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
    const SPAN = 26;
    const widths = [
      22, 14, 11, 13, 16, 18, 16,        // ST/Prov/Country..Range (7)
      11,                                // Savings % (scenario, 1)
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
    toggleHint.value = 'Conservative = low end of the savings range · Base = average · Aggressive = high end. # of Years controls how far the savings extend — Year N columns zero out below it. The Low % and High % cells per state are editable (yellow) — type a new range and Savings %, Indicative Annual Savings, and Year 1–5 Cumulative all recompute live.';
    toggleHint.font = { name: 'Nunito Sans', italic: true, size: 10, color: { argb: SE_TEXT_DARK } };
    toggleHint.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
    toggleHint.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
    ws.getRow(3).height = 30;

    let r = 5;
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
        return flags.includes('small electric market') || flags.includes('too low for sourcing');
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
            if (typeof v === 'number' && Number.isFinite(v)) cell.value = v;
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
            if (lowRef && highRef && !row.isParent) {
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
            if (spendRef && pctRef && !row.isParent) {
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
            if (annualRef && N && !row.isParent) {
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
      const dataEndRow = r - 1;
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

    const electricCols = [
      { label: 'ST / Prov / Country', get: (g) => g.state },
      { label: 'Deregulated Status', get: (g) => g.status },
      { label: 'Total Sites', get: (g) => g.totalSites, numFmt: '#,##0', sumKey: 'totalSites' },
      { label: 'Deregulated Sites', get: (g) => g.deregulatedSites, numFmt: '#,##0', sumKey: 'deregulatedSites' },
      { label: 'Deregulated Consumption kWh/yr', get: (g) => g.consumption, numFmt: '#,##0', sumKey: 'consumption' },
      { label: 'Deregulated Spend/yr', tag: 'spend', get: (g) => g.spend, numFmt: '"$"#,##0', sumKey: 'spend' },
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
      { label: 'Deregulated Status', get: (g) => g.status },
      { label: 'Sites', get: (g) => g.totalSites, numFmt: '#,##0', sumKey: 'totalSites' },
      { label: 'Deregulated Sites', get: (g) => g.deregulatedSites, numFmt: '#,##0', sumKey: 'deregulatedSites' },
      { label: 'Deregulated Consumption Dth/yr', get: (g) => g.consumption, numFmt: '#,##0', sumKey: 'consumption' },
      { label: 'Deregulated Spend/yr', tag: 'spend', get: (g) => g.spend, numFmt: '"$"#,##0', sumKey: 'spend' },
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
      summaryFindings.push(`A VPPA should be explored — North America electric consumption ${Math.round(naElectricMWh).toLocaleString()} MWh exceeds 100,000 MWh threshold`);
    }
    if (riskMgmtStates.length) {
      summaryFindings.push(`Risk Management should be considered (>10,000 MWh) — ${riskMgmtStates.join(', ')}`);
    }
    if (wholesalePlusStates.length) {
      summaryFindings.push(`Wholesale Plus should be explored (>44,000 MWh) — ${wholesalePlusStates.join(', ')}`);
    }
    if (vaHeavyLoadStates.length) {
      summaryFindings.push('Virginia site exceeds 45,000 MWh/yr — large-load deregulation threshold met');
    }
    if (limitedSupplyStates.length) {
      summaryFindings.push(`Limited market — can only help if 3rd-party supply is already in place — ${limitedSupplyStates.join(', ')}`);
    }
    if (smallElectricStates.length) {
      summaryFindings.push(`Small electric market — Deregulated spend < $1M — ${smallElectricStates.join(', ')}`);
    }
    if (mexicoStates.length) {
      summaryFindings.push(`Potential Mexico sourcing opportunity — ${mexicoStates.join(', ')}`);
    }
    if (smallGasStates.length) {
      summaryFindings.push(`Natural gas consumption might be too low for sourcing (<$30K) — ${smallGasStates.join(', ')}`);
    }

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
          regulatedRateOpportunitySites: sum('regulatedRateOpportunitySites'),
          regulatedRateOpportunitySpend: sum('regulatedRateOpportunitySpend'),
          regRateSavings: sum('regRateSavings'),
          consumption: sum('consumption'),
          spend: sum('spend'),
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

    // ---- Second sheet: Site Detail ---------------------------------
    // Flat per-site listing so the user can see the underlying data
    // that rolled up into the by-state summary above.
    const detailSheet = wb.addWorksheet('Site Detail', {
      properties: { tabColor: { argb: SE_GREEN } },
      views: [{ showGridLines: false, state: 'frozen', ySplit: 1 }],
    });
    const detailCols = [
      { label: 'Site Name', get: (s) => s.siteName, width: 28 },
      { label: 'ST / Prov', get: (s) => s.state, width: 14 },
      { label: 'Country', get: (s) => s.country, width: 18 },
      { label: 'Zip', get: (s) => s.zip, width: 9 },
      { label: 'Electric Utility', get: (s) => s.electricUtility, width: 22 },
      { label: 'Electric Supplier', get: (s) => s.electricSupplier, width: 22 },
      { label: 'Reg. Rate Savings Opportunity', get: (s) => s.regRateOpportunity, width: 28 },
      { label: 'Annual Electric (kWh)', get: (s) => s.kwh, numFmt: '#,##0', width: 18 },
      { label: 'Total Electric Cost', get: (s) => s.electricCost, numFmt: '"$"#,##0', width: 16 },
      { label: 'Electric Contract Start', get: (s) => s.electricStart, width: 18, numFmt: 'm/d/yyyy', dateColumn: true },
      { label: 'Electric Contract End', get: (s) => s.electricEnd, width: 18, numFmt: 'm/d/yyyy', dateColumn: true },
      { label: 'Gas Utility', get: (s) => s.gasUtility, width: 22 },
      { label: 'Gas Supplier', get: (s) => s.gasSupplier, width: 22 },
      { label: 'Annual Gas (Dth)', get: (s) => s.dth, numFmt: '#,##0', width: 16 },
      { label: 'Total Natural Gas Cost', get: (s) => s.gasCost, numFmt: '"$"#,##0', width: 18 },
      { label: 'Gas Contract Start', get: (s) => s.gasStart, width: 18, numFmt: 'm/d/yyyy', dateColumn: true },
      { label: 'Gas Contract End', get: (s) => s.gasEnd, width: 18, numFmt: 'm/d/yyyy', dateColumn: true },
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
      cell.value = c.label;
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
        const stateCode = r.__state__ || '';
        const rawCountry = String(r.__country__ || '').trim();
        // Use the canonical country label when there's no state so the
        // ST / Prov / Country column on Site Detail matches the by-
        // state sheet's bucket labels for international sites.
        const canonicalCountry = stateCode ? '' : (normalizeCountryName(rawCountry) || rawCountry);
        // US/CA reg-rate motion is per-utility curated; country sites
        // pick up the reg-rate flag from the Power Rate Optimization
        // column on the country reference instead.
        const isRegRateOpportunity = stateCode
          ? (!!electricUtility && isRegulatedRateOpportunity(stateCode, electricUtility))
          : countryHasRegulatedRateOpportunity(rawCountry);
        const country = rawCountry;
        const kwh = typeof r.__kwh__ === 'number' ? Math.round(r.__kwh__) : null;
        // Mexico flag: Baja sites are off CFE's grid so they don't
        // get tagged at all. Other Mexican sites get either the
        // sourcing-opportunity flag (CFE + > 6 GWh/yr) or the
        // too-low-consumption flag (< 6 GWh/yr).
        const mxFlag = mexicoSiteFlag(country, stateCode, electricUtility, kwh);
        // Property-type mapping flag: when the upload carried a raw
        // property-type value but normalizePropertyType couldn't
        // resolve it to a canonical entry, the per-property-type
        // consumption / account estimates can't run for this site.
        // Surface the unrecognized string so the user knows which
        // rows need an alias added in propertyTypeEstimates.js
        // (or a corrected source value).
        const propertyTypeFlag = (r.__propertyTypeRaw__ && !r.__propertyType__)
          ? `⚠ Property type "${r.__propertyTypeRaw__}" not recognized — estimates will not run for this site. Add an alias in propertyTypeEstimates.js or correct the source value.`
          : '';
        const allFlags = [mxFlag, propertyTypeFlag].filter(Boolean).join('\n');
        return {
          siteName: siteNameColumn ? String(r[siteNameColumn] || '').trim() : '',
          state: stateCode || canonicalCountry,
          zip: r.__zipNorm__ || '',
          country,
          electricUtility,
          electricSupplier,
          regRateOpportunity: isRegRateOpportunity ? 'Yes' : '',
          kwh,
          electricCost: typeof r.__electricCost__ === 'number' ? Math.round(r.__electricCost__) : null,
          electricStart: tbdIfMissing(r.__electricStart__, !!electricSupplier),
          electricEnd: tbdIfMissing(r.__electricEnd__, !!electricSupplier),
          gasUtility,
          gasSupplier,
          dth,
          gasCost: typeof r.__gasCost__ === 'number' ? Math.round(r.__gasCost__) : null,
          gasStart: tbdIfMissing(r.__gasStart__, !!gasSupplier),
          gasEnd: tbdIfMissing(r.__gasEnd__, !!gasSupplier),
          flags: allFlags,
        };
      })
      .filter(s => s.siteName)
      .sort((a, b) => (a.state || '').localeCompare(b.state || '') || a.siteName.localeCompare(b.siteName));

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
        cell.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
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
      const monthlySheet = wb.addWorksheet('Deregulated Monthly Savings', {
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
      title.value = 'Deregulated Monthly Savings Breakdown';
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

    // ---- Property Type Estimates sheet ------------------------------
    // Reference-table-driven estimate of annual consumption and the
    // expected utility-account count per commodity, keyed off the
    // Property Type column on the source sheet. Optional Size_ft2
    // column scales the consumption numbers proportionally to the
    // reference Size_ft2 baked into the table; account counts are
    // independent of size. Skips sites with no recognized property
    // type, and skips the whole sheet when no site carried one.
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

    if (propertyTypeSiteRows.length > 0) {
      const ws = wb.addWorksheet('Property Type Estimates', {
        properties: { tabColor: { argb: SE_GREEN } },
        views: [{ showGridLines: false, state: 'frozen', ySplit: 2, xSplit: 1 }],
      });
      const ptCols = [
        { label: 'Site Name',                  width: 28, get: (s) => s.siteName },
        { label: 'ST / Prov / Country',        width: 22, get: (s) => s.state || s.country },
        { label: 'Property Type',              width: 30, get: (s) => s.propertyType },
        { label: 'Category',                   width: 11, get: (s) => s.category },
        { label: 'Size (ft²)',                 width: 13, get: (s) => s.sizeFt2 ?? '', numFmt: '#,##0' },
        { label: 'Reference Size (ft²)',       width: 16, get: (s) => s.referenceSizeFt2 ?? '', numFmt: '#,##0' },
        { label: 'Est. Annual Electric (kWh)', width: 22, get: (s) => s.electricKwh ?? '', numFmt: '#,##0' },
        { label: 'Est. Annual Gas (Dth)',      width: 18, get: (s) => s.gasDth ?? '', numFmt: '#,##0' },
        { label: 'Est. Annual Gas (kWh equiv)', width: 22, get: (s) => s.gasKwh ?? '', numFmt: '#,##0' },
        { label: 'Est. Total Energy (kWh equiv)', width: 24, get: (s) => s.totalKwh ?? '', numFmt: '#,##0' },
        { label: 'Water Accounts',    width: 13, get: (s) => s.accounts?.water?.label ?? '',    sumValue: (s) => s.accounts?.water?.count ?? 0,    numFmt: '0.##' },
        { label: 'Steam Accounts',    width: 13, get: (s) => s.accounts?.steam?.label ?? '',    sumValue: (s) => s.accounts?.steam?.count ?? 0,    numFmt: '0.##' },
        { label: 'Gas Accounts',      width: 14, get: (s) => s.accounts?.gas?.label ?? '',      sumValue: (s) => s.accounts?.gas?.count ?? 0,      numFmt: '0.##' },
        { label: 'Electric Accounts', width: 14, get: (s) => s.accounts?.electric?.label ?? '', sumValue: (s) => s.accounts?.electric?.count ?? 0, numFmt: '0.##' },
        { label: 'Waste Accounts',    width: 13, get: (s) => s.accounts?.waste?.label ?? '',    sumValue: (s) => s.accounts?.waste?.count ?? 0,    numFmt: '0.##' },
      ];
      ws.columns = ptCols.map((c) => ({ width: c.width }));

      ws.mergeCells(1, 1, 1, ptCols.length);
      const ptTitle = ws.getCell(1, 1);
      ptTitle.value = 'Property Type Estimates';
      ptTitle.font = { name: 'Nunito Sans', bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
      ptTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
      ptTitle.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(1).height = 28;

      const ptHdr = ws.getRow(2);
      ptCols.forEach((c, i) => {
        const cell = ptHdr.getCell(i + 1);
        cell.value = c.label;
        cell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
        cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 };
        cell.border = {
          bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } },
          right:  { style: 'hair', color: { argb: 'FFFFFFFF' } },
        };
      });
      ptHdr.height = 36;

      propertyTypeSiteRows.forEach((s, idx) => {
        const dataRow = ws.getRow(3 + idx);
        ptCols.forEach((c, i) => {
          const cell = dataRow.getCell(i + 1);
          const v = c.get(s);
          if (v === '' || v == null) {
            writeBlank(cell, !!c.numFmt);
          } else {
            cell.value = v;
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

      // Totals row — sum the numeric columns (consumption + the
      // count-fields-via-sumValue accessor for accounts). "Multiple"
      // is treated as 3 for totals; the label still reads "Multiple"
      // on the per-site row so the user keeps the qualitative signal.
      const totalIdx = 3 + propertyTypeSiteRows.length;
      const totalRow = ws.getRow(totalIdx);
      ptCols.forEach((c, i) => {
        const cell = totalRow.getCell(i + 1);
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
      totalRow.height = 20;

      ws.autoFilter = {
        from: { row: 2, column: 1 },
        to:   { row: 2 + propertyTypeSiteRows.length, column: ptCols.length },
      };
    }

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

      ws.autoFilter = {
        from: { row: 2, column: 1 },
        to:   { row: 2 + contractOverviewRows.length, column: cols.length },
      };
    }

    // ---- Hedging Strategy Example sheet -----------------------------
    // Interactive example. Two editable inputs (Annual Volume on E4,
    // Spot Reference on H4) plus per-tranche allocation (column C)
    // and locked price (column E) drive Excel formulas through the
    // Volume / Locked Cost / Spot Cost / Saving columns, the totals
    // row, and the Result block. Edit any yellow cell and Excel
    // recomputes the analysis live.
    {
      const ws = wb.addWorksheet('Hedging Strategy Example', {
        properties: { tabColor: { argb: SE_GREEN_DARK } },
        views: [{ showGridLines: false, state: 'frozen', ySplit: 6 }],
      });

      const COLS = 10;
      const widths = [6, 16, 11, 14, 19, 19, 14, 16, 16, 18];
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
      title.value = 'Layered Hedging Strategy — Interactive Example';
      title.font = { name: 'Nunito Sans', bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
      title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
      title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(1).height = 30;

      ws.mergeCells(2, 1, 2, COLS);
      const sub = ws.getCell(2, 1);
      sub.value = 'Edit the yellow cells (Annual Volume on E4, Spot Reference on H4, plus per-tranche allocation in column C and locked price in column E) to recompute the analysis. Volume / Locked Cost / Spot Cost / Saving and the totals + Result block are Excel formulas — they update live as inputs change.';
      sub.font = { name: 'Nunito Sans', italic: true, size: 10, color: { argb: SE_SLATE } };
      sub.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
      ws.getRow(2).height = 46;

      ws.mergeCells(3, 1, 3, COLS);
      const sh0 = ws.getCell(3, 1);
      sh0.value = 'Inputs (edit yellow cells)';
      sh0.font = { name: 'Nunito Sans', bold: true, size: 12, color: { argb: SE_GREEN_DARK } };
      sh0.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
      sh0.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(3).height = 22;

      // Row 4 — two label / value pairs on one row.
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
      ws.getCell(4, 6).value = 'Spot Reference ($/MWh)';
      ws.getCell(4, 6).font = { name: 'Nunito Sans', bold: true, size: 11, color: { argb: SE_SLATE } };
      ws.getCell(4, 6).alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
      const spotInput = ws.getCell('H4');
      spotInput.value = 75.00;
      spotInput.numFmt = '"$"0.00';
      spotInput.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INPUT_FILL } };
      spotInput.font = { name: 'Nunito Sans', bold: true, size: 11, color: { argb: SE_TEXT_DARK } };
      spotInput.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
      spotInput.border = inputBorder;
      ws.getRow(4).height = 22;

      ws.mergeCells(5, 1, 5, COLS);
      const sh1 = ws.getCell(5, 1);
      sh1.value = '10 Hedge Layers Executed Across the Year';
      sh1.font = { name: 'Nunito Sans', bold: true, size: 12, color: { argb: SE_GREEN_DARK } };
      sh1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
      sh1.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(5).height = 22;

      const headers = [
        '#', 'Execution Date', 'Tranche %', 'Cumulative %',
        'Locked Price ($/MWh)', 'Spot Ref. ($/MWh)', 'Volume (MWh)',
        'Locked Cost', 'Spot Cost', 'Saving vs Spot',
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

      // Default tranche inputs — prices follow a plausible 2026
      // forward-curve shape; allocations default to 10 % each so the
      // user sees a clean 100 % baseline.
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
      ];

      hedges.forEach((h, i) => {
        const rowNum = 7 + i;
        const r = ws.getRow(rowNum);
        r.getCell(1).value = i + 1;
        // Write the execution date as a real Date so Excel applies
        // the m/d/yyyy short-date format on column B.
        r.getCell(2).value = new Date(h.date + 'T00:00:00Z');
        r.getCell(3).value = 0.10;
        r.getCell(4).value = i === 0
          ? { formula: `C${rowNum}`, result: 0.10 }
          : { formula: `D${rowNum - 1}+C${rowNum}`, result: (i + 1) * 0.10 };
        r.getCell(5).value = h.price;
        r.getCell(6).value = { formula: '$H$4', result: 75 };
        r.getCell(7).value = { formula: `$E$4*C${rowNum}`, result: 100000 * 0.10 };
        r.getCell(8).value = { formula: `E${rowNum}*G${rowNum}`, result: h.price * 10000 };
        r.getCell(9).value = { formula: `F${rowNum}*G${rowNum}`, result: 75 * 10000 };
        r.getCell(10).value = { formula: `I${rowNum}-H${rowNum}`, result: (75 - h.price) * 10000 };

        for (let ci = 1; ci <= 10; ci++) {
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
        r.getCell(5).numFmt = '"$"0.00';
        r.getCell(6).numFmt = '"$"0.00';
        r.getCell(7).numFmt = '#,##0';
        r.getCell(8).numFmt = '"$"#,##0';
        r.getCell(9).numFmt = '"$"#,##0';
        r.getCell(10).numFmt = '"$"#,##0;[Red]("$"#,##0)';

        // Mark the editable cells (tranche % + locked price) yellow
        // so the user sees where input is welcome. Conditional
        // formatting takes over the locked-price color (green when
        // it beats Spot Ref, red when it lags).
        for (const col of [3, 5]) {
          const c = r.getCell(col);
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INPUT_FILL } };
        }
        r.height = 20;
      });

      // Row 17 — totals via SUM formulas. The blended price is the
      // weighted average (total locked cost / total volume).
      const tr = ws.getRow(17);
      tr.getCell(2).value = 'TOTAL';
      tr.getCell(4).value = { formula: 'SUM(C7:C16)', result: 1.0 };
      tr.getCell(5).value = { formula: 'H17/G17', result: 72.635 };
      tr.getCell(6).value = { formula: '$H$4', result: 75 };
      tr.getCell(7).value = { formula: 'SUM(G7:G16)', result: 100000 };
      tr.getCell(8).value = { formula: 'SUM(H7:H16)', result: 7263500 };
      tr.getCell(9).value = { formula: 'SUM(I7:I16)', result: 7500000 };
      tr.getCell(10).value = { formula: 'SUM(J7:J16)', result: 236500 };
      for (let ci = 1; ci <= 10; ci++) {
        const c = tr.getCell(ci);
        c.font = { name: 'Nunito Sans', size: 11, bold: true, color: { argb: SE_TEXT_DARK } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        c.border = {
          top:    { style: 'thin', color: { argb: SE_GREEN_DARK } },
          bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } },
        };
      }
      tr.getCell(4).numFmt = '0%';
      tr.getCell(5).numFmt = '"$"0.00';
      tr.getCell(6).numFmt = '"$"0.00';
      tr.getCell(7).numFmt = '#,##0';
      tr.getCell(8).numFmt = '"$"#,##0';
      tr.getCell(9).numFmt = '"$"#,##0';
      tr.getCell(10).numFmt = '"$"#,##0;[Red]("$"#,##0)';
      tr.height = 26;

      // Locked-Price color flips live via conditional formatting that
      // compares column E to column F (the per-row spot ref formula).
      ws.addConditionalFormatting({
        ref: 'E7:E16',
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

      ws.addConditionalFormatting({
        ref: 'J7:J16',
        rules: [{
          type: 'dataBar',
          cfvo: [{ type: 'num', value: -50000 }, { type: 'num', value: 100000 }],
          color: { argb: 'FF22C55E' },
          showValue: true,
          gradient: false,
        }],
      });

      ws.mergeCells(19, 1, 19, COLS);
      const rh = ws.getCell(19, 1);
      rh.value = 'Result';
      rh.font = { name: 'Nunito Sans', bold: true, size: 12, color: { argb: SE_GREEN_DARK } };
      rh.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
      rh.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(19).height = 22;

      // Rows 20-24 — label / value pairs. Each value is a live
      // formula referencing the inputs / totals so the user sees the
      // result update when they tweak any yellow cell.
      const stats = [
        { label: 'Blended Hedged Price', formula: 'H17/G17', result: 72.635, fmt: '"$"0.00" / MWh"' },
        { label: 'Spot-Only Reference Price', formula: '$H$4', result: 75, fmt: '"$"0.00" / MWh"' },
        { labelFormula: '"Total Hedged Cost ("&TEXT(G17,"#,##0")&" MWh)"', labelFallback: 'Total Hedged Cost', formula: 'H17', result: 7263500, fmt: '"$"#,##0' },
        { labelFormula: '"Total Spot Cost ("&TEXT(G17,"#,##0")&" MWh)"', labelFallback: 'Total Spot Cost', formula: 'I17', result: 7500000, fmt: '"$"#,##0' },
        { label: 'Savings vs Spot', valueFormula: 'TEXT(J17,"$#,##0")&"   ("&TEXT(J17/I17,"0.00%")&")"', result: '$236,500   (3.15%)' },
      ];
      stats.forEach((s, i) => {
        const rowIdx = 20 + i;
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

      ws.mergeCells(26, 1, 26, COLS);
      const wh = ws.getCell(26, 1);
      wh.value = 'Why layering works';
      wh.font = { name: 'Nunito Sans', bold: true, size: 12, color: { argb: SE_GREEN_DARK } };
      wh.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
      wh.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(26).height = 22;

      const bullets = [
        'Splitting the buy into tranches catches multiple points on the forward curve instead of betting on a single execution date.',
        'Edit the locked prices in column E to model different curve scenarios. Green cells beat the spot reference, red cells lag — each tranche\'s drag or gain is weighted by its allocation in column C.',
        'Adjust the Annual Volume input on E4 to size the analysis to a specific customer (industrial, multi-site portfolio, etc.). The same approach applies to natural gas — swap MWh for MMBtu / Dth and the variance-reduction benefit is identical.',
      ];
      bullets.forEach((b, i) => {
        const rowIdx = 27 + i;
        ws.mergeCells(rowIdx, 1, rowIdx, COLS);
        const cell = ws.getCell(rowIdx, 1);
        cell.value = `•  ${b}`;
        cell.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
        ws.getRow(rowIdx).height = 32;
      });
    }

    // ---- Floating vs Hedging Example sheet --------------------------
    // Interactive comparison of a fully-hedged annual contract vs a
    // pure float (index / spot) buy across 12 months. Inputs (yellow
    // cells): Annual Volume (E4), 100 % Hedged Price (H4), per-month
    // Load % (column C), per-month Spot Price (column E). Every other
    // column is an Excel formula so edits update live.
    {
      const ws = wb.addWorksheet('Floating vs Hedging Example', {
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
      title.value = 'Floating vs Hedging — Interactive Example';
      title.font = { name: 'Nunito Sans', bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
      title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
      title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(1).height = 30;

      ws.mergeCells(2, 1, 2, COLS);
      const sub = ws.getCell(2, 1);
      sub.value = 'Edit the yellow cells (Annual Volume on E4, 100 % Hedged Price on H4, plus per-month Load % in column C and Spot Price in column E) to model your portfolio. Load MWh / Float Cost / Hedge Cost / Saving and the totals + Result block are Excel formulas — they update live as inputs change. Positive Saving = floating the market beats locking 100 % at the hedged price.';
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
      sh1.value = '12 Months — Float vs Hedge';
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
      wh.value = 'When floating wins — and when it doesn\'t';
      wh.font = { name: 'Nunito Sans', bold: true, size: 12, color: { argb: SE_GREEN_DARK } };
      wh.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
      wh.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(28).height = 22;

      const floatBullets = [
        'Floating pays the spot / index price every month — when the curve averages below the hedge price, that gap compounds across the year into the Saving figure above. The 100 % hedge locks the price at H4 regardless of where the market actually settles.',
        'Edit column C to weight months by your real load shape — a winter-peaking gas portfolio pays more for the January and February spot cells than a flat MWh assumption, which can flip the answer.',
        'Edit column E to model curve scenarios: a low-summer / high-winter shape (heating-led demand), an industrial flat curve, or a stressed winter where spot blows past the hedge for two months. Green spot cells beat the hedge, red cells lag.',
        'Reality is between the two extremes. Most portfolios use this comparison to decide a layered-hedge ratio (e.g. 60 / 40 hedged-to-float) — see the Hedging Strategy Example tab for the layered approach.',
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
      const COLS = 7;
      ws.columns = [38, 13, 17, 19, 17, 21, 24].map(w => ({ width: w }));

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
      paragraph('Annual electric (kWh) and gas (Dth / kWh-equivalent) numbers are derived from a per-property-type reference profile. Each property type carries representative annual usage anchored to a reference square-footage. When a site\'s actual Size_ft² is provided, the reference values are scaled linearly: scaledValue = referenceValue × (actualSize / referenceSize). Sites without a size fall back to the reference values. Land and Debt property types have no consumption profile and are skipped.');
      blank();
      headerRow(['Property Type', 'Category', 'Reference Size (ft²)', 'Electric (kWh / yr)', 'Gas (Dth / yr)', 'Gas — kWh Equivalent', 'Total (kWh / yr)']);
      const consumptionRows = Object.entries(CONSUMPTION_ESTIMATES)
        .filter(([, v]) => v.electricKwh != null)
        .sort((a, b) => (b[1].totalKwh || 0) - (a[1].totalKwh || 0));
      consumptionRows.forEach(([name, v]) => {
        dataRow(
          [name, v.category, v.sizeFt2, v.electricKwh, v.gasDth, v.gasKwh, v.totalKwh],
          [null, null, '#,##0', '#,##0', '#,##0', '#,##0', '#,##0']
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
      paragraph('Per-country bucket for each commodity. "Deregulated" / "Some deregulation" on Electric Power or Gas opens the commodity-savings motion (2 – 4 % on annual spend). "Deregulated" / "Some deregulation" on Power Rate Optimization opens the regulated-rate motion (0.25 % on regulated electric spend) — the two motions are mutually exclusive per site, so a country whose Electric Power is already deregulated does not also earn reg-rate savings on top. "Unlikely" and "No opportunity" disqualify a country from each motion.');
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
    }

    const rawBuf = await wb.xlsx.writeBuffer();
    // Inject a native Excel chart into the Floating vs Hedging Example
    // sheet. Combo chart: a stacked area chart underneath supplies the
    // green "savings" band wherever spot sits below hedge (driven by
    // hidden helper columns U + V), and a line chart on top draws the
    // Spot and Hedge series. Helper data, axis bounds, and all series
    // resolve from live cell ranges so the chart recomputes as the
    // user edits the yellow inputs.
    const SHEET = 'Floating vs Hedging Example';
    // Y axis bounds derived from the *default* dataset so the axis
    // stays tight (≤30 % padding above/below the data range) without
    // depending on Excel's autoscale.
    const _spotDefaults = [84,82,68,63,60,65,78,80,72,66,74,80];
    const _hedgeDefault = 75;
    const _dataMin = Math.min(_hedgeDefault, ..._spotDefaults);
    const _dataMax = Math.max(_hedgeDefault, ..._spotDefaults);
    const yMin = Math.floor(_dataMin * 0.7);
    const yMax = Math.ceil(_dataMax * 1.3);
    const buf = await injectLiveLineChart(rawBuf, {
      sheetName: SHEET,
      title: 'Spot Price Savings vs. Current Hedging Scenario',
      catRef: `'${SHEET}'!$B$7:$B$18`,
      // Area series first → drawn underneath. Index 0 is the
      // invisible base (min of spot/hedge); index 1 is the green
      // savings band (hedge − spot, clipped to ≥0). Both share the
      // category axis with the lines.
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
      yMin,
      yMax,
      // ~640 × 340 px (1 px ≈ 9525 EMU), anchored just right of the
      // 9-column data table with a 0.2-col gutter so the chart sits
      // beside the inputs instead of overlapping them. Row index is
      // 0-based, so row: 5 = Excel row 6.
      anchor: { col: 9, colOff: 190500, row: 5, rowOff: 0, cx: 6096000, cy: 3238500 },
    });
    const fileName = `Indicative Savings by State - ${new Date().toISOString().slice(0, 10)}.xlsx`;
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

  // Schneider Electric branded export — title band, green headers,
  // Nunito Sans everywhere, frozen header row, auto-filter, tab
  // colour. One sheet per overview plus the raw-data sheet.
  async function handleExport({ columns: visibleColumns, rows: sortedRows, colNames, extraSheets }) {
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

    // Site List tab — round-trippable input. Bakes resolved /
    // manually-edited supplier values back into the source supplier
    // columns (or appends new columns if the source had none), and
    // appends derived snapshot columns (State, Electric/Gas Utility,
    // Electric/Gas Rate). Named "Site List" so the upload's tab
    // picker auto-selects this tab when the workbook is dropped back
    // onto the Utility Lookup page.
    if (cleanSitesData.length > 0) {
      const sourceHeaders = Object.keys(cleanSitesData[0]);
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

      // Build enriched rows from the derived `rows` array so the
      // baked-in values reflect everything the page is showing —
      // per-row supplier overrides, fuzzy-match canonicalization,
      // zip-derived state, rates-file utility lookups. Keep the raw
      // source values for every other column.
      const enrichedRows = rows.map(r => {
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

    // Hidden round-trip state sheet — single JSON blob at A1 carrying
    // page state that doesn't live in the column data (vendor
    // accept/reject decisions). readRoundTripState picks this up on
    // re-upload; the user never sees it in Excel because the sheet is
    // hidden and starts with `__` so parseAllSheets skips it.
    {
      const stateWs = wb.addWorksheet('__rt_state__', { state: 'hidden' });
      stateWs.getCell('A1').value = JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        vendorDecisions,
      });
    }

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Indicative Site Analysis - ${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
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
          <h1 className={styles.title}>Utility Lookup</h1>
          {cleanSitesData.length === 0 && (
            <div className={styles.subtitle}>
              Drop an Excel/CSV file or paste tab-separated rows (⌘V / Ctrl+V) anywhere on this page.
            </div>
          )}
          <div className={styles.subtitle}>
            {cleanSitesData.length} {cleanSitesData.length === 1 ? 'site' : 'sites'}
            {sitesData.length > cleanSitesData.length && <span style={{ color: 'var(--color-text-muted)' }}> ({sitesData.length - cleanSitesData.length} blank-name row{sitesData.length - cleanSitesData.length === 1 ? '' : 's'} ignored)</span>}
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
          {sitesData.length > 0 && (
            <button
              type="button"
              onClick={() => exportIndicativeSavings()}
              title="Download an Indicative Savings by State workbook (Schneider-branded). Aggregates the loaded sites by state with 2 % – 4 % savings on the deregulated spend, plus supplier name + contract dates."
              style={{ padding: '0.4rem 0.8rem', border: '1px solid #009530', background: '#009530', color: '#fff', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}
            >
              ⬇ Indicative Savings
            </button>
          )}
          {sitesData.length > 0 && (
            <button
              type="button"
              onClick={() => { setSavePickerSearch(''); setSaveStatus({ state: 'idle', message: '' }); }}
              title="Save the current Indicative Savings analysis against a specific company. The saved file shows up on that company's prospect / client popup and can be downloaded from there."
              style={{ padding: '0.4rem 0.8rem', border: '1px solid #009530', background: '#fff', color: '#009530', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}
            >
              💾 Save to Company
            </button>
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
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0F172A' }}>Save Indicative Savings to a Company</div>
              <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: '0.2rem' }}>Pick a company — the analysis appears on its prospect / client popup.</div>
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
                    onClick={() => saveIndicativeSavingsToCompany(p)}
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

      {sitesData.length > 0 && (
        <div className={styles.utilityBar} style={{ background: '#F1F5F9' }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Consumption columns:</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', color: 'var(--color-text-secondary)' }}>
            <span>Electric</span>
            <select
              value={electricColOverride ?? (detectedConsumption.electric[0]?.header || '')}
              onChange={e => setElectricColOverride(e.target.value || '__none__')}
              style={{ padding: '0.2rem 0.4rem', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.72rem', fontFamily: 'inherit', background: '#fff' }}
            >
              <option value="__none__">— None —</option>
              {siteHeaders.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
            {detectedConsumption.electric.length > 1 && !electricColOverride && (
              <span style={{ fontSize: '0.65rem', color: '#64748B' }}>
                (auto — uses first valid of {detectedConsumption.electric.length} cols)
              </span>
            )}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', color: 'var(--color-text-secondary)' }}>
            <span>Gas</span>
            <select
              value={gasColOverride ?? (detectedConsumption.gas[0]?.header || '')}
              onChange={e => setGasColOverride(e.target.value || '__none__')}
              style={{ padding: '0.2rem 0.4rem', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.72rem', fontFamily: 'inherit', background: '#fff' }}
            >
              <option value="__none__">— None —</option>
              {siteHeaders.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
            {detectedConsumption.gas.length > 1 && !gasColOverride && (
              <span style={{ fontSize: '0.65rem', color: '#64748B' }}>
                (auto — uses first valid of {detectedConsumption.gas.length} cols)
              </span>
            )}
          </label>
          {(consumption.electric.length === 0 && consumption.gas.length === 0) && (
            <span style={{ fontSize: '0.7rem', color: '#92400E', fontWeight: 600 }}>
              No consumption columns matched — pick yours from the dropdowns.
            </span>
          )}
        </div>
      )}

      {uploadError && (
        <div style={{ margin: '0.5rem 1.25rem', padding: '0.5rem 0.75rem', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 6, color: '#991B1B', fontSize: '0.8rem' }}>
          {uploadError}
        </div>
      )}

      {analysisSummary && (() => {
        const s = analysisSummary;
        const ELEC = '#92400E';
        const GAS = '#1E3A8A';
        const SLATE = '#475569';
        const MUTED = '#94A3B8';
        const cardStyle = { border: '1px solid #E2E8F0', borderRadius: 8, background: '#FFFFFF', padding: '0.65rem 0.85rem' };
        const cardTitleStyle = { fontSize: '0.72rem', fontWeight: 700, color: '#0F172A', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.45rem' };
        const rowStyle = { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.5rem', padding: '0.2rem 0', borderBottom: '1px dashed #F1F5F9' };
        const labelStyle = (color) => ({ fontSize: '0.72rem', color, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
        const valueStyle = { fontSize: '0.78rem', fontWeight: 600, color: '#0F172A', fontVariantNumeric: 'tabular-nums' };
        const subStyle = { fontSize: '0.65rem', color: MUTED, fontWeight: 500, marginLeft: '0.35rem' };
        const fmtInt = (n) => Math.round(n).toLocaleString();
        const fmtPct = (num, den) => den > 0 ? `${Math.round((num / den) * 100)}%` : '0%';
        const sumLine = (color, label, value, sub) => (
          <div style={rowStyle}>
            <span style={labelStyle(color)}>{label}</span>
            <span>
              <span style={valueStyle}>{value}</span>
              {sub && <span style={subStyle}>{sub}</span>}
            </span>
          </div>
        );
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', margin: '0.5rem 1.25rem 0.75rem' }}>
            <div style={cardStyle}>
              <div style={cardTitleStyle}>Consumption</div>
              {sumLine(ELEC, 'Electric — Actual',    `${fmtInt(s.consumption.electric.actual)} kWh`,   `${s.consumption.electric.actualSites} site${s.consumption.electric.actualSites === 1 ? '' : 's'}`)}
              {sumLine(ELEC, 'Electric — Estimated', `${fmtInt(s.consumption.electric.est)} kWh`,      `${s.consumption.electric.estSites} site${s.consumption.electric.estSites === 1 ? '' : 's'}`)}
              {sumLine(GAS,  'Gas — Actual',         `${fmtInt(s.consumption.gas.actual)} therms`,     `${s.consumption.gas.actualSites} site${s.consumption.gas.actualSites === 1 ? '' : 's'}`)}
              {sumLine(GAS,  'Gas — Estimated',      `${fmtInt(s.consumption.gas.est)} therms`,        `${s.consumption.gas.estSites} site${s.consumption.gas.estSites === 1 ? '' : 's'}`)}
            </div>
            <div style={cardStyle}>
              <div style={cardTitleStyle}>Cost</div>
              {sumLine(ELEC, 'Electric — Actual',    formatMoney(s.cost.electric.actual), `${s.cost.electric.actualSites} site${s.cost.electric.actualSites === 1 ? '' : 's'}`)}
              {sumLine(ELEC, 'Electric — Estimated', formatMoney(s.cost.electric.est),    `${s.cost.electric.estSites} site${s.cost.electric.estSites === 1 ? '' : 's'}`)}
              {sumLine(GAS,  'Gas — Actual',         formatMoney(s.cost.gas.actual),      `${s.cost.gas.actualSites} site${s.cost.gas.actualSites === 1 ? '' : 's'}`)}
              {sumLine(GAS,  'Gas — Estimated',      formatMoney(s.cost.gas.est),         `${s.cost.gas.estSites} site${s.cost.gas.estSites === 1 ? '' : 's'}`)}
            </div>
            <div style={cardStyle}>
              <div style={cardTitleStyle} title="Source = the upload's supplier column named a utility we recognized. Zip lookup = no supplier in the source, utility derived from the rates file via zip code.">Utility Companies</div>
              {sumLine(ELEC, 'Electric — From Supplier',  fmtInt(s.utility.electric.fromSupplier), fmtPct(s.utility.electric.fromSupplier, s.total))}
              {sumLine(ELEC, 'Electric — From Zip Lookup', fmtInt(s.utility.electric.fromZip),     fmtPct(s.utility.electric.fromZip, s.total))}
              {sumLine(SLATE, 'Electric — Unknown',        fmtInt(s.utility.electric.unknown),     fmtPct(s.utility.electric.unknown, s.total))}
              {sumLine(GAS,  'Gas — From Supplier',        fmtInt(s.utility.gas.fromSupplier),     fmtPct(s.utility.gas.fromSupplier, s.total))}
              {sumLine(GAS,  'Gas — From Zip Lookup',      fmtInt(s.utility.gas.fromZip),          fmtPct(s.utility.gas.fromZip, s.total))}
              {sumLine(SLATE, 'Gas — Unknown',             fmtInt(s.utility.gas.unknown),          fmtPct(s.utility.gas.unknown, s.total))}
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
      </div>

      {!sitesLoaded ? (
        <div style={{ padding: '2rem 1.25rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
          Loading…
        </div>
      ) : sitesData.length === 0 ? (
        <div style={{ padding: '2rem 1.25rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
          No sites loaded. Click <strong>Upload Sites File</strong> or drop a Portfolio Companies workbook anywhere on this page — we'll pick up the <strong>Site List</strong> tab automatically.
          <div style={{ marginTop: '0.5rem', fontSize: '0.78rem' }}>
            The first column matching a "zip"/"postal" header drives the utility lookup.
          </div>
        </div>
      ) : (
        <DataTable
          key={tableId}
          tableId={tableId}
          columns={columns}
          rows={filtered}
          alwaysVisible={alwaysVisible}
          emptyMessage="No matching sites"
          exportFileName="Indicative Site Analysis"
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
            { key: 'address', label: 'Address', required: false, hint: 'Street address of the site. Optional reference field — surfaced on the Site Detail and Contract Overview tabs of the Indicative Savings export.' },
            { key: 'city', label: 'City', required: false, hint: 'City / town of the site. Optional reference field. Falls back to the utility-rates file lookup when blank.' },
            { key: 'state', label: 'State / Province', required: false, hint: 'State or province. Optional reference field. Auto-derived from Zip for US / Canada sites when blank.' },
            { key: 'zip', label: 'Zip / Postal Code', required: false, hint: 'Required for US and Canada sites — drives the utility lookup. Leave blank on international rows; mapping the column at all is optional if the file has no US / Canada sites.' },
            { key: 'country', label: 'Country', required: false, hint: 'Country of the site. Falls back to the utility-rates file when blank.' },
            { key: 'propertyType', label: 'Property Type', required: false, hint: 'Building / use type (Office, Hospital, Warehouse, etc.) — drives the per-property-type consumption + account-count estimates surfaced on the page and on the Indicative Savings export.' },
            { key: 'siteDescription', label: 'Site Description', required: false, hint: 'Free-text annotation for the site (building name, internal code, notes). Passthrough only; surfaced next to Property Type on the Utility Lookup page.' },
            { key: 'propertySize', label: 'Size (ft²)', required: false, hint: 'Square footage of the site. Scales the property-type reference consumption linearly. Optional — when blank the reference size for the property type is used as-is.' },
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
            { name: 'Electric Rate', from: 'state commercial average' },
            { name: 'Total Electric Cost', from: 'actual cost when mapped, else kWh × rate' },
            { name: 'GAC Opportunity (Ontario)', from: 'Ontario sites only — tiered by annual kWh as a Class A proxy' },
            { name: 'Gas Utility', from: 'rates file × Zip (or Supplier when known)' },
            { name: 'Gas Market', from: 'regulated vs. deregulated rule' },
            { name: 'Gas Rate', from: 'state commercial average' },
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
          const targetLabel = (key) => TARGET_FIELDS.find(t => t.key === key)?.label || key;
          const colHeader = { fontSize: '0.7rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '0.5rem 0.75rem', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' };
          const cellBase = { padding: '0.4rem 0.75rem', borderBottom: '1px solid #F1F5F9', fontSize: '0.78rem' };
          const tabBase = { padding: '0.35rem 0.7rem', fontSize: '0.75rem', fontWeight: 600, border: '1px solid #E2E8F0', borderBottom: 'none', borderTopLeftRadius: 6, borderTopRightRadius: 6, background: '#F8FAFC', color: '#475569', cursor: 'pointer', whiteSpace: 'nowrap' };
          const tabActive = { ...tabBase, background: '#FFFFFF', color: '#0F172A', borderColor: '#CBD5E1', boxShadow: 'inset 0 -2px 0 #2563EB' };
          return (
            <div className={styles.modalBackdrop} onClick={() => setSitesMappingModal(null)}>
              <div className={styles.modalCard} onClick={e => e.stopPropagation()} style={{ maxWidth: 1000, width: '95vw' }}>
                <div className={styles.modalHeader}>
                  <h3 className={styles.modalTitle}>Sites File — Column Mapping</h3>
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
                  {active.rows.length.toLocaleString()} rows found on tab "{active.sheetName}" in <code>{sitesMappingModal.fileName}</code>. The left side lists every column that shows up on the Utility Lookup page; the right side lists every column from this tab. Pick which file column should fill each Utility Lookup field.{sitesMappingModal.sheets.length > 1 ? ' Switch tabs above to map a different sheet — only the selected tab is imported.' : ''}
                </p>
                {missingRequired.length > 0 && (
                  <div style={{ margin: '0 0 0.5rem', padding: '0.4rem 0.6rem', background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 6, fontSize: '0.75rem', color: '#991B1B', fontWeight: 600 }}>
                    Still need to map: {missingRequired.join(', ')}
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
                              {t.required ? '— not mapped —' : '— optional —'}
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
                            <option value="">— Ignore —</option>
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
                    Import {active.rows.length.toLocaleString()} sites
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
                  <h3 className={styles.modalTitle}>Utility Rates — Column Mapping</h3>
                  <button className={styles.modalClose} onClick={() => setMappingModal(null)} disabled={utilityBusy}>×</button>
                </div>
                <p className={styles.modalHelp}>
                  {mappingModal.rows.length.toLocaleString()} rows found{mappingModal.sheetName ? ` on sheet "${mappingModal.sheetName}"` : ''}. Every column from the file is listed below — pick the field each one should map into (or leave it on "Ignore"). Zip / Commodity Type / Utility are required.
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
                          <option value="">— Ignore —</option>
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
    </div>
  );
}

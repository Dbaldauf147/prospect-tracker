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
import { parseBestSheet, parseSplitSitesTemplate } from '../../utils/xlsxParse';
import { findFuzzyMatch } from '../../utils/utilityNameMatch';
import { ENERGY_SUPPLIERS } from '../../data/energySuppliers';
import { isRegulatedRateOpportunity } from '../../data/regulatedRateOpportunities';
import styles from './SitesView.module.css';

const SITES_STORAGE_KEY = 'sites-list-override';

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
    zip: pickZipColumn(headers),
    country: detectColumn(headers, [/^country$/i, /\bcountry\b/i, /\bnation\b/i]) || '',
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

export function SitesView({ settings, updateSettings } = {}) {
  const [sitesData, setSitesData] = useState([]);
  const [sitesLoaded, setSitesLoaded] = useState(false);
  const [utility, setUtility] = useState(null); // { zipMap, meta }
  const [utilityLoaded, setUtilityLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [utilityBusy, setUtilityBusy] = useState(false);
  const [mappingModal, setMappingModal] = useState(null);
  const [dragOver, setDragOver] = useState(false);
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
      // First try the two-tab template (Electric Power + Gas merged by
      // Site Name). Falls through to parseBestSheet for any workbook
      // that doesn't have both tabs — Portfolio Companies workbooks,
      // CSVs, or single-sheet sites tables.
      let parsed = parseSplitSitesTemplate(bytes);
      if (!parsed) {
        parsed = parseBestSheet(bytes, {
          preferSheetName: /site\s*list|^\s*sites?\s*$/i,
        });
      }
      const { rows, sheetName } = parsed;
      const headers = rows.length ? Object.keys(rows[0]) : [];
      setSitesMappingModal({
        rows,
        headers,
        sheetName,
        fileName: file.name,
        mapping: detectSitesMapping(headers),
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
    const { rows, mapping, sheetName } = sitesMappingModal;
    setUploadError('');
    try {
      // Drop columns the user didn't assign a target — otherwise every
      // pass-through column ends up rendered on the Utility Lookup
      // table even though the user only wanted these specific fields.
      const TARGET_KEYS = [
        'siteName', 'zip', 'country',
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
      setElectricContractPriceOverride(mapping.electricContractPrice || null);
      setGasContractPriceOverride(mapping.gasContractPrice || null);
      setElectricContractNameOverride(mapping.electricContractName || null);
      setElectricProductTypeOverride(mapping.electricProductType || null);
      setGasContractNameOverride(mapping.gasContractName || null);
      setGasProductTypeOverride(mapping.gasProductType || null);
      if (sheetName && !/site/i.test(sheetName)) {
        setUploadError(`No tab named "Site List" found — loaded sheet "${sheetName}" instead (${rows.length.toLocaleString()} rows). Rename the tab or drop a different file if that's not what you wanted.`);
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
      rows,
      headers,
      sheetName: '',
      fileName: `(pasted ${rows.length.toLocaleString()} row${rows.length === 1 ? '' : 's'})`,
      mapping: detectSitesMapping(headers),
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
      const electricRate = state ? stateRate(state, 'electric') : null;
      const gasRate = state ? stateRate(state, 'gas') : null;
      const electricUomRaw = electricUomOverride ? r[electricUomOverride] : '';
      const gasUomRaw = gasUomOverride ? r[gasUomOverride] : '';
      const elec = pickFirstConsumption(r, consumption.electric, toKwh, normalizeElectricUom(electricUomRaw));
      const gas = pickFirstConsumption(r, consumption.gas, toTherms, normalizeGasUom(gasUomRaw));
      const inputCountry = countryOverride ? String(r[countryOverride] || '').trim() : '';
      const parseRate = (v) => {
        if (v == null || v === '') return null;
        const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
        return Number.isFinite(n) && n > 0 ? n : null;
      };
      const electricContractPrice = electricContractPriceOverride ? parseRate(r[electricContractPriceOverride]) : null;
      const gasContractPrice = gasContractPriceOverride ? parseRate(r[gasContractPriceOverride]) : null;
      const estElectricCost = electricRate != null && elec.value != null ? electricRate * elec.value : null;
      const estGasCost = gasRate != null && gas.value != null ? gasRate * gas.value : null;
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
        __city__: match?.city,
        __country__: inputCountry || match?.country,
        __state__: state,
        __kwh__: elec.value,
        __therms__: gas.value,
        __kwhSource__: elec.sourceHeader,
        __thermsSource__: gas.sourceHeader,
        __electricRate__: electricRate,
        __gasRate__: gasRate,
        __electricCost__: electricCost,
        __gasCost__: gasCost,
        __electricCostActual__: actualElectricCost,
        __gasCostActual__: actualGasCost,
        __electricCostEstimated__: estElectricCost,
        __gasCostEstimated__: estGasCost,
        __totalCost__: (electricCost != null || gasCost != null) ? totalCost : null,
        __electricSupplier__: supplierOverrides[`${i}_electric`] || electricSupplierResolved,
        __gasSupplier__: supplierOverrides[`${i}_gas`] || gasSupplierResolved,
        __electricStart__: electricStartOverride ? r[electricStartOverride] : null,
        __electricEnd__: electricEndOverride ? r[electricEndOverride] : null,
        __electricContractPrice__: electricContractPrice,
        __electricContractName__: electricContractNameOverride ? String(r[electricContractNameOverride] || '').trim() || null : null,
        __electricProductType__: electricProductTypeOverride ? String(r[electricProductTypeOverride] || '').trim() || null : null,
        __gasStart__: gasStartOverride ? r[gasStartOverride] : null,
        __gasEnd__: gasEndOverride ? r[gasEndOverride] : null,
        __gasContractPrice__: gasContractPrice,
        __gasContractName__: gasContractNameOverride ? String(r[gasContractNameOverride] || '').trim() || null : null,
        __gasProductType__: gasProductTypeOverride ? String(r[gasProductTypeOverride] || '').trim() || null : null,
        __matched__: !!match || electricUtilityTokens.length > 0 || gasUtilityTokens.length > 0,
      };
    });
  }, [cleanSitesData, zipColumn, utility, consumption, electricCostOverride, gasCostOverride, electricSupplierOverride, gasSupplierOverride, electricStartOverride, electricEndOverride, gasStartOverride, gasEndOverride, electricUomOverride, gasUomOverride, countryOverride, electricContractPriceOverride, gasContractPriceOverride, electricContractNameOverride, electricProductTypeOverride, gasContractNameOverride, gasProductTypeOverride, knownUtilityNames, vendorDecisions, supplierOverrides]);

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
    const base = headers.map((k, i) => ({
      key: k,
      label: k,
      defaultWidth: i === 0 ? 220 : 140,
      ...(i === 0 ? { sticky: true } : {}),
      render: (row) => {
        const v = row[k];
        if (k === zipColumn && row.__zipNorm__) return row.__zipNorm__;
        return v == null || v === '' ? <span style={{ color: 'var(--color-text-muted)' }}>—</span> : String(v);
      },
      exportValue: (row) => {
        if (k === zipColumn && row.__zipNorm__) return row.__zipNorm__;
        return row[k] ?? '';
      },
    }));
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
        return (
          <span
            title={`${row.__state__ || 'unknown state'} commercial average. Indicative only — not a tariff rate.`}
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
          const sourceHeader = isElectric ? row.__kwhSource__ : row.__thermsSource__;
          const tip = sourceHeader ? `From "${sourceHeader}" column` : `${isElectric ? 'kWh' : 'Dth'} pulled from the uploaded sites file`;
          return (
            <span
              title={tip}
              style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
            >{Math.round(val).toLocaleString()}</span>
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
    // Contract dates from the file — pass through as text since the
    // file may already contain a friendly format the user prefers.
    const makeDateCol = (key, label, color) => ({
      key,
      label,
      defaultWidth: 120,
      render: (row) => {
        const val = row[`__${key}__`];
        if (val == null || val === '') return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>—</span>;
        return (
          <span style={{ fontSize: '0.72rem', color, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{String(val)}</span>
        );
      },
      exportValue: (row) => row[`__${key}__`] ?? '',
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
    ];
  }, [sitesData, zipColumn, utility, supplierOverrides, editingSupplier]);

  const alwaysVisible = useMemo(() => {
    if (!columns.length) return [];
    return [
      columns[0].key,
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
    CA: { status: 'Limited', range: '0 - 4%',  lowPct: 0,    highPct: 0.04 },
    MI: { status: 'Limited', range: '',        lowPct: null, highPct: null },
    VA: { status: 'Limited', range: '',        lowPct: null, highPct: null },
    WA: { status: 'Limited', range: '',        lowPct: null, highPct: null },
  };
  // Flat savings range applied to any deregulated natural-gas site.
  const GAS_SAVINGS = { range: '2 - 4%', lowPct: 0.02, highPct: 0.04 };
  // Per-state natural-gas deregulation status + savings range. States
  // marked "Large load only" mean retail choice is restricted to
  // industrial / large-volume customers, so the standard 2-4 %
  // doesn't apply — the range stays blank and lowPct/highPct are
  // null. Anything not in this map falls through to status 'no'.
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
    AB: { status: 'Large load only', range: '', lowPct: null, highPct: null },
    AR: { status: 'Large load only', range: '', lowPct: null, highPct: null },
    AZ: { status: 'Large load only', range: '', lowPct: null, highPct: null },
    BC: { status: 'Large load only', range: '', lowPct: null, highPct: null },
    IA: { status: 'Large load only', range: '', lowPct: null, highPct: null },
    MB: { status: 'Large load only', range: '', lowPct: null, highPct: null },
    MN: { status: 'Large load only', range: '', lowPct: null, highPct: null },
    MO: { status: 'Large load only', range: '', lowPct: null, highPct: null },
    MT: { status: 'Large load only', range: '', lowPct: null, highPct: null },
    NC: { status: 'Large load only', range: '', lowPct: null, highPct: null },
    NM: { status: 'Large load only', range: '', lowPct: null, highPct: null },
    NV: { status: 'Large load only', range: '', lowPct: null, highPct: null },
    OK: { status: 'Large load only', range: '', lowPct: null, highPct: null },
    TN: { status: 'Large load only', range: '', lowPct: null, highPct: null },
    WI: { status: 'Large load only', range: '', lowPct: null, highPct: null },
    WV: { status: 'Large load only', range: '', lowPct: null, highPct: null },
    WY: { status: 'Large load only', range: '', lowPct: null, highPct: null },
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
    const SE_GREEN_LIGHT = 'FFE6F7EC';
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
    const ELECTRIC_PRODUCT_OPTIONS = ['Fixed', 'Index', 'Block & Index', 'Heat Rate', 'Hybrid', 'Pass-through', 'Utility Default'];
    const GAS_PRODUCT_OPTIONS = ['Fixed', 'Index', 'NYMEX + Basis', 'Block & Index', 'Hybrid', 'Flexible', 'Pass-through', 'Utility Default'];

    const COMMON_FIELDS = [
      { label: 'Site Name', required: true, hint: 'Row label. Required so the row isn\'t filtered as blank. Enter on the Electric Power tab — the Gas tab pulls Site Name from there via formula.' },
      { label: 'Address', hint: 'Street address of the site. Optional reference field. Enter on the Electric Power tab — the Gas tab pulls from there via formula.' },
      { label: 'Zip / Postal Code', required: true, hint: 'US/Canadian zip or postal code — drives the utility lookup and state derivation. Enter on the Electric Power tab; the Gas tab pulls from there via formula.' },
      { label: 'Country', greenHeader: true, hint: 'Country of the site. Pick from the dropdown on the Electric Power tab — the Gas tab pulls from there via formula. Falls back to the utility-rates file when blank.', validation: { type: 'list', options: COUNTRY_OPTIONS } },
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

    // Display-only tab illustrating a 10-layer hedging strategy.
    // Standalone — no formula links to Electric Power / Gas — kept
    // here so it ships with the template the user hands to clients.
    function renderHedgingExampleSheet() {
      const ws = wb.addWorksheet('Hedging Strategy Example', {
        properties: { tabColor: { argb: SE_GREEN_DARK } },
        views: [{ showGridLines: false, state: 'frozen', ySplit: 7 }],
      });

      const COLS = 10;
      const widths = [6, 16, 11, 14, 19, 19, 14, 16, 16, 18];
      ws.columns = widths.map(w => ({ width: w }));

      // Row 1 — title band
      ws.mergeCells(1, 1, 1, COLS);
      const title = ws.getCell(1, 1);
      title.value = 'Layered Hedging Strategy — Illustrative Example';
      title.font = { name: 'Nunito Sans', bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
      title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
      title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(1).height = 30;

      // Row 2 — subtitle
      ws.mergeCells(2, 1, 2, COLS);
      const sub = ws.getCell(2, 1);
      sub.value = 'Display only — independent of the Electric Power and Gas tabs. Shows how splitting an annual electric (or gas) buy into 10 layered hedges across the year can deliver a better blended price than buying everything at delivery-year spot.';
      sub.font = { name: 'Nunito Sans', italic: true, size: 10, color: { argb: SE_SLATE } };
      sub.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
      ws.getRow(2).height = 38;

      // Row 3 — scenario assumptions
      ws.mergeCells(3, 1, 3, COLS);
      const scn = ws.getCell(3, 1);
      scn.value = 'Scenario: Industrial buyer, 100,000 MWh/year electric load, 2027 delivery year. Forward-curve prices observed at 10 execution windows during 2026. Spot-only reference: $75.00 / MWh annual average for 2027 deliveries.';
      scn.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
      scn.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
      scn.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      ws.getRow(3).height = 32;

      // Row 5 — section header
      ws.mergeCells(5, 1, 5, COLS);
      const sh1 = ws.getCell(5, 1);
      sh1.value = '10 Hedge Layers Executed Across the Year';
      sh1.font = { name: 'Nunito Sans', bold: true, size: 12, color: { argb: SE_GREEN_DARK } };
      sh1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
      sh1.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(5).height = 22;

      // Row 6 — table header
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

      // Rows 7-16 — 10 hedge tranches. Each tranche = 10,000 MWh
      // (10 % of the 100,000 MWh annual load). Spot reference is a
      // constant $75 / MWh annual average for 2027; the hedge prices
      // walk through a plausible forward-curve shape across 2026
      // (dip in spring, peak in summer, settle in fall).
      const SPOT_REF = 75.00;
      const VOLUME = 10000;
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
        const r = ws.getRow(7 + i);
        const cumPct = ((i + 1) * 10) / 100;
        const lockedCost = h.price * VOLUME;
        const spotCost = SPOT_REF * VOLUME;
        const saving = spotCost - lockedCost;

        const vals = [i + 1, h.date, 0.10, cumPct, h.price, SPOT_REF, VOLUME, lockedCost, spotCost, saving];
        vals.forEach((v, ci) => {
          const c = r.getCell(ci + 1);
          c.value = v;
          c.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
          c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
          c.border = {
            bottom: { style: 'hair', color: { argb: SE_BORDER } },
            right:  { style: 'hair', color: { argb: SE_BORDER } },
          };
        });

        r.getCell(3).numFmt = '0%';
        r.getCell(4).numFmt = '0%';
        r.getCell(5).numFmt = '"$"0.00';
        r.getCell(6).numFmt = '"$"0.00';
        r.getCell(7).numFmt = '#,##0';
        r.getCell(8).numFmt = '"$"#,##0';
        r.getCell(9).numFmt = '"$"#,##0';
        r.getCell(10).numFmt = '"$"#,##0;[Red]("$"#,##0)';

        // Green when the hedge beat spot, red when it missed — the
        // point of layering is that the misses still pull average
        // variance down vs an all-or-nothing buy.
        const lockedCell = r.getCell(5);
        const beatSpot = h.price < SPOT_REF;
        lockedCell.fill = {
          type: 'pattern', pattern: 'solid',
          fgColor: { argb: beatSpot ? 'FFDCFCE7' : 'FFFEE2E2' },
        };
        lockedCell.font = {
          name: 'Nunito Sans', size: 10, bold: true,
          color: { argb: beatSpot ? 'FF166534' : 'FF991B1B' },
        };

        r.height = 20;
      });

      // Row 17 — totals
      const totalLockedCost = hedges.reduce((s, h) => s + h.price * VOLUME, 0);
      const totalVolume = VOLUME * hedges.length;
      const totalSpotCost = SPOT_REF * totalVolume;
      const totalSaving = totalSpotCost - totalLockedCost;
      const blendedPrice = totalLockedCost / totalVolume;

      const tr = ws.getRow(17);
      const totalVals = [null, 'TOTAL', null, 1.0, blendedPrice, SPOT_REF, totalVolume, totalLockedCost, totalSpotCost, totalSaving];
      totalVals.forEach((v, ci) => {
        const c = tr.getCell(ci + 1);
        c.value = v;
        c.font = { name: 'Nunito Sans', size: 11, bold: true, color: { argb: SE_TEXT_DARK } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        c.border = {
          top:    { style: 'thin', color: { argb: SE_GREEN_DARK } },
          bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } },
        };
      });
      tr.getCell(4).numFmt = '0%';
      tr.getCell(5).numFmt = '"$"0.00';
      tr.getCell(6).numFmt = '"$"0.00';
      tr.getCell(7).numFmt = '#,##0';
      tr.getCell(8).numFmt = '"$"#,##0';
      tr.getCell(9).numFmt = '"$"#,##0';
      tr.getCell(10).numFmt = '"$"#,##0;[Red]("$"#,##0)';
      tr.height = 26;

      // Per-row data bars on the Saving column so the visual story
      // (longer bar = bigger tranche contribution) jumps out at a
      // glance. ExcelJS supports dataBar conditional formatting.
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

      // Row 19 — Result header
      ws.mergeCells(19, 1, 19, COLS);
      const rh = ws.getCell(19, 1);
      rh.value = 'Result';
      rh.font = { name: 'Nunito Sans', bold: true, size: 12, color: { argb: SE_GREEN_DARK } };
      rh.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
      rh.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(19).height = 22;

      // Rows 20-24 — label/value pairs. Last row highlights the headline saving.
      const fmtMoney = (n) => `$${Math.round(n).toLocaleString()}`;
      const stats = [
        ['Blended Hedged Price', `$${blendedPrice.toFixed(2)} / MWh`],
        ['Spot-Only Reference Price', `$${SPOT_REF.toFixed(2)} / MWh`],
        [`Total Hedged Cost (${totalVolume.toLocaleString()} MWh)`, fmtMoney(totalLockedCost)],
        [`Total Spot Cost (${totalVolume.toLocaleString()} MWh)`, fmtMoney(totalSpotCost)],
        ['Savings vs Spot', `${fmtMoney(totalSaving)}   (${((totalSaving / totalSpotCost) * 100).toFixed(2)} %)`],
      ];
      stats.forEach((s, i) => {
        const rowIdx = 20 + i;
        ws.mergeCells(rowIdx, 1, rowIdx, 4);
        ws.mergeCells(rowIdx, 5, rowIdx, COLS);
        const row = ws.getRow(rowIdx);
        const labelCell = row.getCell(1);
        const valCell = row.getCell(5);
        labelCell.value = s[0];
        valCell.value = s[1];
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

      // Row 26 — "Why layering works" explainer
      ws.mergeCells(26, 1, 26, COLS);
      const wh = ws.getCell(26, 1);
      wh.value = 'Why layering works';
      wh.font = { name: 'Nunito Sans', bold: true, size: 12, color: { argb: SE_GREEN_DARK } };
      wh.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
      wh.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(26).height = 22;

      const bullets = [
        'Splitting the buy into 10 tranches catches multiple points on the forward curve instead of betting on a single execution date.',
        'Tranches 2–5 captured the spring price dip; tranches 7–8 came in above spot, but their drag is more than offset by the gains on the dips.',
        'The same approach applies to natural gas — substitute $/MMBtu (or $/Dth) and gas volumes for the figures above. The mechanic and the variance-reduction benefit are identical.',
      ];
      bullets.forEach((b, i) => {
        const rowIdx = 27 + i;
        ws.mergeCells(rowIdx, 1, rowIdx, COLS);
        const cell = ws.getCell(rowIdx, 1);
        cell.value = `•  ${b}`;
        cell.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
        ws.getRow(rowIdx).height = 28;
      });
    }
    renderHedgingExampleSheet();

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
  async function exportIndicativeSavings() {
    if (!rows.length) return;
    const { Workbook } = await import('exceljs');
    const SE_GREEN_DARK = 'FF009530';
    const SE_GREEN_LIGHT = 'FFE6F7EC';
    const SE_TEXT_DARK = 'FF1E293B';
    const SE_BORDER = 'FFD4DDE1';
    const SE_GREEN = 'FF3DCD58';
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
      const pctsFor = (state) => {
        const entry = commodity === 'electric'
          ? ELECTRIC_DEREGULATION[state]
          : GAS_DEREGULATION[state];
        return { lowPct: entry?.lowPct ?? null, highPct: entry?.highPct ?? null };
      };
      const states = new Map();
      // Per-site detail kept for the Monthly Savings Breakdown sheet.
      const siteRows = [];
      for (const r of rows) {
        const state = r.__state__ || '';
        if (!state) continue;
        let g = states.get(state);
        if (!g) {
          g = {
            state,
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
          };
          states.set(state, g);
        }
        g.totalSites += 1;
        const provider = r[providerKey];
        // Track the regulated utility for every site (not just the
        // deregulated ones) so the Utility column captures PG&E /
        // ComEd / Dominion etc. even on regulated rows.
        if (provider) g.utilities.push(provider);
        // Electric sites whose utility is on the regulated-rate
        // opportunity list count toward the new Reg-rate column,
        // and their full electric spend feeds the 0.25 % savings line.
        if (commodity === 'electric' && isRegulatedRateOpportunity(state, provider)) {
          g.regulatedRateOpportunitySites += 1;
          const regCost = r[costKey];
          if (typeof regCost === 'number' && Number.isFinite(regCost)) {
            g.regulatedRateOpportunitySpend += regCost;
          }
        }
        // Mexico tracking: any electric site in this state with a
        // Mexico country tag and over 1 MWh of consumption flags the
        // state as a potential sourcing opportunity. Runs before the
        // dereg gate so a regulated Mexican site still surfaces.
        if (commodity === 'electric'
          && /^mexic/i.test(String(r.__country__ || ''))) {
          const kwh = (typeof r.__kwh__ === 'number' && Number.isFinite(r.__kwh__)) ? r.__kwh__ : 0;
          if (kwh > 1000) g.hasMexicoSourcing = true;
        }
        const isDereg = classifyUtility(provider) === 'Deregulated' || !!r[supplierKey];
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
        const { lowPct, highPct } = pctsFor(state);
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
          state,
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
      const out = [...states.values()].sort((a, b) => a.state.localeCompare(b.state));
      const stateRows = out.map(g => {
        // Electric: per-state curated status / range / pct from
        // ELECTRIC_DEREGULATION. Gas: per-state map of the same shape
        // — see GAS_DEREGULATION above. States not in the map land as
        // 'no' with no savings.
        const entry = commodity === 'electric'
          ? ELECTRIC_DEREGULATION[g.state]
          : GAS_DEREGULATION[g.state];
        const status = entry?.status || 'no';
        const range = entry?.range ?? '';
        const { lowPct, highPct } = pctsFor(g.state);
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
              if (g.hasMexicoSourcing) out.push('★ Potential Mexico sourcing opportunity');
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
    const ws = wb.addWorksheet('Indicative Savings by State', {
      properties: { tabColor: { argb: SE_GREEN } },
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
      10, 14, 11, 13, 16, 18, 16,        // ST/Prov..Range (7)
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
    const SCENARIO_SHEET_NAME = 'Indicative Savings by State';
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
    title.value = 'Indicative Savings by State';
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
    toggleHint.value = 'Conservative = low end of the savings range · Base = average · Aggressive = high end. # of Years controls how far the savings extend — Year N columns and any month past N×12 zero out below it. Every savings number on this sheet recalculates from these cells.';
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
      // Data rows — every cell left-aligned regardless of type so the
      // sheet reads as a flat report rather than a finance ledger.
      // Scenario columns get a formula (low / mid / high inlined) so
      // the toggle at the top recalculates the whole sheet.
      for (const row of sectionRows) {
        const dataRow = ws.getRow(r);
        columnDefs.forEach((c, i) => {
          const cell = dataRow.getCell(i + 1);
          if (c.spacer) return;
          const v = c.get(row);
          if (c.scenario) {
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
          } else {
            cell.value = ceilForFmt(v, c.numFmt);
          }
          cell.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
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
      for (const c of columnDefs) {
        if (!c.sumKey) continue;
        if (c.scenario) {
          let low = 0, mid = 0, high = 0;
          for (const row of sectionRows) {
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
          for (const row of sectionRows) s += Number(c.get(row)) || 0;
          scalarTotals[c.sumKey] = s;
        }
      }
      columnDefs.forEach((c, i) => {
        const cell = totalRow.getCell(i + 1);
        if (c.spacer) return;
        if (i === 0) {
          cell.value = 'Total';
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
      { label: 'ST/Prov', get: (g) => g.state },
      { label: 'Deregulated Status', get: (g) => g.status },
      { label: 'Total Sites', get: (g) => g.totalSites, numFmt: '#,##0', sumKey: 'totalSites' },
      { label: 'Deregulated Sites', get: (g) => g.deregulatedSites, numFmt: '#,##0', sumKey: 'deregulatedSites' },
      { label: 'Deregulated Consumption kWh/yr', get: (g) => g.consumption, numFmt: '#,##0', sumKey: 'consumption' },
      { label: 'Deregulated Spend/yr', get: (g) => g.spend, numFmt: '"$"#,##0', sumKey: 'spend' },
      { label: 'Indicative Savings Range', get: (g) => g.range },
      // Savings % follows the toggle: Conservative shows the low end
      // of the range, Base shows the average, Aggressive shows the
      // high end. Stored as a raw decimal so '0.0%' format renders
      // it correctly.
      { label: 'Savings %', scenario: true, get: (g) => g.savingsPct, numFmt: '0.0%' },
      // Annual + Year 1-5 cumulative for the deregulated motion only —
      // each cell is a scenario-aware formula keyed off the toggle.
      // Reg-rate savings live in their own block to the right.
      { label: 'Indicative Annual Savings', scenario: true, get: (g) => g.annualSavings, numFmt: '"$"#,##0', sumKey: 'annualSavings' },
      { label: 'Year 1 Cumulative', scenario: true, yearGate: 1, get: (g) => g.year1, numFmt: '"$"#,##0', sumKey: 'year1' },
      { label: 'Year 2 Cumulative', scenario: true, yearGate: 2, get: (g) => g.year2, numFmt: '"$"#,##0', sumKey: 'year2' },
      { label: 'Year 3 Cumulative', scenario: true, yearGate: 3, get: (g) => g.year3, numFmt: '"$"#,##0', sumKey: 'year3' },
      { label: 'Year 4 Cumulative', scenario: true, yearGate: 4, get: (g) => g.year4, numFmt: '"$"#,##0', sumKey: 'year4' },
      { label: 'Year 5 Cumulative', scenario: true, yearGate: 5, get: (g) => g.year5, numFmt: '"$"#,##0', sumKey: 'year5' },
      { label: 'Utility Vendor(s)', get: (g) => g.utilities },
      { label: 'Supplier Name(s)', get: (g) => g.suppliers },
      { label: 'Contract Start', get: (g) => g.earliestStart },
      { label: 'Contract End', get: (g) => g.latestEnd },
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
      { label: 'ST/Prov', get: (g) => g.state },
      { label: 'Deregulated Status', get: (g) => g.status },
      { label: 'Sites', get: (g) => g.totalSites, numFmt: '#,##0', sumKey: 'totalSites' },
      { label: 'Deregulated Sites', get: (g) => g.deregulatedSites, numFmt: '#,##0', sumKey: 'deregulatedSites' },
      { label: 'Deregulated Consumption Dth/yr', get: (g) => g.consumption, numFmt: '#,##0', sumKey: 'consumption' },
      { label: 'Deregulated Spend/yr', get: (g) => g.spend, numFmt: '"$"#,##0', sumKey: 'spend' },
      { label: 'Indicative Savings Range', get: (g) => g.range },
      // Savings % mirrors the electric column — toggle picks low /
      // mid / high from the state's gas deregulation band.
      { label: 'Savings %', scenario: true, get: (g) => g.savingsPct, numFmt: '0.0%' },
      // Year 1-5 cumulative savings on the gas side use the same
      // scenario toggle as electric — there's no gas reg-rate motion.
      { label: 'Indicative Annual Savings', scenario: true, get: (g) => g.annualSavings, numFmt: '"$"#,##0', sumKey: 'annualSavings' },
      { label: 'Year 1 Cumulative', scenario: true, yearGate: 1, get: (g) => g.year1, numFmt: '"$"#,##0', sumKey: 'year1' },
      { label: 'Year 2 Cumulative', scenario: true, yearGate: 2, get: (g) => g.year2, numFmt: '"$"#,##0', sumKey: 'year2' },
      { label: 'Year 3 Cumulative', scenario: true, yearGate: 3, get: (g) => g.year3, numFmt: '"$"#,##0', sumKey: 'year3' },
      { label: 'Year 4 Cumulative', scenario: true, yearGate: 4, get: (g) => g.year4, numFmt: '"$"#,##0', sumKey: 'year4' },
      { label: 'Year 5 Cumulative', scenario: true, yearGate: 5, get: (g) => g.year5, numFmt: '"$"#,##0', sumKey: 'year5' },
      { label: 'Utility Vendor(s)', get: (g) => g.utilities },
      { label: 'Supplier Name(s)', get: (g) => g.suppliers },
      { label: 'Contract Start', get: (g) => g.earliestStart },
      { label: 'Contract End', get: (g) => g.latestEnd },
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
    const smallElectricStates = collectStates(electricRows, 'Spend < $1M');
    const mexicoStates = collectStates(electricRows, 'Mexico sourcing');
    const smallGasStates = collectStates(gasRows, 'too low for sourcing');
    if (riskMgmtStates.length) {
      summaryFindings.push(`Risk Management should be considered (>10,000 MWh) — ${riskMgmtStates.join(', ')}`);
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

    writeSection('Electric Power', electricRows, electricCols);
    writeSection('Natural Gas', gasRows, gasCols);

    // ---- Second sheet: Site Detail ---------------------------------
    // Flat per-site listing so the user can see the underlying data
    // that rolled up into the by-state summary above.
    const detailSheet = wb.addWorksheet('Site Detail', {
      properties: { tabColor: { argb: SE_GREEN } },
      views: [{ showGridLines: false, state: 'frozen', ySplit: 2 }],
    });
    const detailCols = [
      { label: 'Site Name', get: (s) => s.siteName, width: 28 },
      { label: 'ST/Prov', get: (s) => s.state, width: 9 },
      { label: 'Zip', get: (s) => s.zip, width: 9 },
      { label: 'Electric Utility', get: (s) => s.electricUtility, width: 22 },
      { label: 'Electric Supplier', get: (s) => s.electricSupplier, width: 22 },
      { label: 'Reg. Rate Savings Opportunity', get: (s) => s.regRateOpportunity, width: 28 },
      { label: 'Annual Electric (kWh)', get: (s) => s.kwh, numFmt: '#,##0', width: 18 },
      { label: 'Total Electric Cost', get: (s) => s.electricCost, numFmt: '"$"#,##0', width: 16 },
      { label: 'Electric Contract Start', get: (s) => s.electricStart, width: 18 },
      { label: 'Electric Contract End', get: (s) => s.electricEnd, width: 18 },
      { label: 'Gas Utility', get: (s) => s.gasUtility, width: 22 },
      { label: 'Gas Supplier', get: (s) => s.gasSupplier, width: 22 },
      { label: 'Annual Gas (Dth)', get: (s) => s.dth, numFmt: '#,##0', width: 16 },
      { label: 'Total Natural Gas Cost', get: (s) => s.gasCost, numFmt: '"$"#,##0', width: 18 },
      { label: 'Gas Contract Start', get: (s) => s.gasStart, width: 18 },
      { label: 'Gas Contract End', get: (s) => s.gasEnd, width: 18 },
      // Per-site Mexico-sourcing flag (any Mexican site with > 1 MWh
      // of electric consumption). Other site-level flags can plug in
      // here later without growing the column.
      { label: 'Flags', get: (s) => s.flags, width: 36 },
    ];
    detailSheet.columns = detailCols.map(c => ({ width: c.width }));

    // Title band — same Schneider green as the by-state sheet.
    detailSheet.mergeCells(1, 1, 1, detailCols.length);
    const detailTitle = detailSheet.getCell(1, 1);
    detailTitle.value = 'Site Detail';
    detailTitle.font = { name: 'Nunito Sans', bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    detailTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
    detailTitle.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    detailSheet.getRow(1).height = 28;

    // Header row. Borders on bottom + right so the column separators
    // continue down through the data rows.
    const detailHeader = detailSheet.getRow(2);
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
          const trimmed = String(date || '').trim();
          if (trimmed) return trimmed;
          return supplierPresent ? 'TBD' : '';
        };
        const stateCode = r.__state__ || '';
        const isRegRateOpportunity = !!electricUtility
          && isRegulatedRateOpportunity(stateCode, electricUtility);
        const country = String(r.__country__ || '').trim();
        const kwh = typeof r.__kwh__ === 'number' ? Math.round(r.__kwh__) : null;
        // Mexico sourcing flag: any site in Mexico with > 1 MWh of
        // electric consumption (1 MWh = 1,000 kWh) is a potential
        // sourcing target, so it carries a per-site flag here so the
        // user can pull the list straight off Site Detail.
        const isMexicoSourcing = /^mexic/i.test(country) && (kwh ?? 0) > 1000;
        return {
          siteName: siteNameColumn ? String(r[siteNameColumn] || '').trim() : '',
          state: stateCode,
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
          flags: isMexicoSourcing ? '★ Potential Mexico sourcing opportunity' : '',
        };
      })
      .filter(s => s.siteName)
      .sort((a, b) => (a.state || '').localeCompare(b.state || '') || a.siteName.localeCompare(b.siteName));

    sitesForDetail.forEach((s, idx) => {
      const dataRow = detailSheet.getRow(3 + idx);
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
        } else {
          cell.value = ceilForFmt(v, c.numFmt);
        }
        cell.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        if (c.numFmt) cell.numFmt = c.numFmt;
        // Hair border on bottom (row separator) AND right (column
        // separator) so the table reads with light visible gridlines
        // even though the worksheet has showGridLines:false.
        cell.border = {
          bottom: { style: 'hair', color: { argb: SE_BORDER } },
          right:  { style: 'hair', color: { argb: SE_BORDER } },
        };
      });
      dataRow.height = 18;
    });
    if (sitesForDetail.length > 0) {
      detailSheet.autoFilter = {
        from: { row: 2, column: 1 },
        to: { row: 2 + sitesForDetail.length, column: detailCols.length },
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
        { label: 'ST/Prov', get: (s) => s.state, width: 9 },
        { label: 'Commodity', get: (s) => s.commodity === 'electric' ? 'Electric' : 'Gas', width: 14 },
        { label: 'Utility', get: (s) => s.utility, width: 22 },
        { label: 'Supplier', get: (s) => s.supplier, width: 22 },
        { label: 'Contract Start', get: (s) => s.contractStart, width: 14 },
        { label: 'Contract End', get: (s) => s.contractEnd, width: 14 },
        { label: 'Annual Spend', get: (s) => s.annualSpend, numFmt: '"$"#,##0', width: 14 },
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

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Indicative Savings by State - ${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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

    // Site List tab — clean, re-uploadable raw input. Plain styling
    // (no merged title rows) with headers in row 1 so parseBestSheet's
    // header detector reads them straight, and named "Site List" so
    // the upload's preferSheetName regex auto-picks this tab when the
    // workbook is dropped back onto the Utility Lookup page.
    if (cleanSitesData.length > 0) {
      const inputHeaders = Object.keys(cleanSitesData[0]);
      const inputWs = wb.addWorksheet('Site List', {
        properties: { tabColor: { argb: SE_GREEN } },
        views: [{ state: 'frozen', ySplit: 1 }],
      });
      inputWs.columns = inputHeaders.map(h => ({
        header: h,
        key: h,
        width: Math.max(String(h).length + 2, 14),
      }));
      for (const row of cleanSitesData) inputWs.addRow(row);
      const hdr = inputWs.getRow(1);
      hdr.font = { name: 'Nunito Sans', bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
      hdr.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      hdr.height = 22;
      inputWs.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: inputHeaders.length } };
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
              onClick={exportIndicativeSavings}
              title="Download an Indicative Savings by State workbook (Schneider-branded). Aggregates the loaded sites by state with 2 % – 4 % savings on the deregulated spend, plus supplier name + contract dates."
              style={{ padding: '0.4rem 0.8rem', border: '1px solid #009530', background: '#009530', color: '#fff', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}
            >
              ⬇ Indicative Savings
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
      </div>

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
            { key: 'zip', label: 'Zip / Postal Code', required: true, hint: 'Drives the utility lookup.' },
            { key: 'country', label: 'Country', required: false, hint: 'Country of the site. Falls back to the utility-rates file when blank.' },
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
          const targetForHeader = {};
          for (const t of TARGET_FIELDS) {
            const h = sitesMappingModal.mapping[t.key];
            if (h) targetForHeader[h] = t.key;
          }
          function setTargetForHeader(header, targetKey) {
            setSitesMappingModal(m => {
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
            .filter(t => t.required && !sitesMappingModal.mapping[t.key])
            .map(t => t.label);
          const targetLabel = (key) => TARGET_FIELDS.find(t => t.key === key)?.label || key;
          const colHeader = { fontSize: '0.7rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '0.5rem 0.75rem', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' };
          const cellBase = { padding: '0.4rem 0.75rem', borderBottom: '1px solid #F1F5F9', fontSize: '0.78rem' };
          return (
            <div className={styles.modalBackdrop} onClick={() => setSitesMappingModal(null)}>
              <div className={styles.modalCard} onClick={e => e.stopPropagation()} style={{ maxWidth: 1000, width: '95vw' }}>
                <div className={styles.modalHeader}>
                  <h3 className={styles.modalTitle}>Sites File — Column Mapping</h3>
                  <button className={styles.modalClose} onClick={() => setSitesMappingModal(null)}>×</button>
                </div>
                <p className={styles.modalHelp}>
                  {sitesMappingModal.rows.length.toLocaleString()} rows found{sitesMappingModal.sheetName ? ` on sheet "${sitesMappingModal.sheetName}"` : ''} in <code>{sitesMappingModal.fileName}</code>. The left side lists every column that shows up on the Utility Lookup page; the right side lists every column from your file. Pick which file column should fill each Utility Lookup field.
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
                      const header = sitesMappingModal.mapping[t.key];
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
                    <div style={colHeader}>Columns in your file ({sitesMappingModal.headers.length})</div>
                    {sitesMappingModal.headers.map(h => {
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
                    Import {sitesMappingModal.rows.length.toLocaleString()} sites
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

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
  toKwh,
  toTherms,
  stateRate,
  formatMoney,
  formatRate,
} from '../../utils/utilityRates';
import { parseBestSheet } from '../../utils/xlsxParse';
import { findFuzzyMatch } from '../../utils/utilityNameMatch';
import { ENERGY_SUPPLIERS } from '../../data/energySuppliers';
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
    electric: detectColumn(headers, [/electric.*kwh|kwh.*electric/i, /annual.*electric.*kwh/i, /annual.*kwh/i, /^kwh$/i, /electric.*usage/i, /electric.*consumption/i]) || '',
    gas: detectColumn(headers, [/gas.*therm|therm.*gas/i, /annual.*gas.*(therm|dth|mmbtu)/i, /natural\s*gas.*usage/i, /gas.*usage/i, /gas.*consumption/i, /^therms?$/i, /^dth$/i, /^mmbtu$/i]) || '',
    electricCost: detectColumn(headers, [/electric.*(actual|annual).*(cost|spend|amount|\$)/i, /(actual|annual).*electric.*(cost|spend)/i, /electric.*cost/i, /electric.*spend/i, /electric.*\$/i]) || '',
    gasCost: detectColumn(headers, [/gas.*(actual|annual).*(cost|spend|amount|\$)/i, /(actual|annual).*gas.*(cost|spend)/i, /gas.*cost/i, /gas.*spend/i, /gas.*\$/i]) || '',
    electricSupplier: detectColumn(headers, [/electric.*(supplier|provider|vendor)/i, /(supplier|provider|vendor).*electric/i]) || '',
    gasSupplier: detectColumn(headers, [/gas.*(supplier|provider|vendor)/i, /(supplier|provider|vendor).*gas/i]) || '',
    electricStart: detectColumn(headers, [/electric.*contract.*start/i, /electric.*start.*date/i, /electric.*begin/i]) || '',
    electricEnd: detectColumn(headers, [/electric.*contract.*end/i, /electric.*(end|expir).*date/i, /electric.*term.*end/i]) || '',
    gasStart: detectColumn(headers, [/gas.*contract.*start/i, /gas.*start.*date/i, /gas.*begin/i]) || '',
    gasEnd: detectColumn(headers, [/gas.*contract.*end/i, /gas.*(end|expir).*date/i, /gas.*term.*end/i]) || '',
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
      // A Portfolio Companies workbook has several tabs (main portfolio,
      // Top 5 Overview, Top 5 Deep Dives, Site List). Prefer the one
      // that actually lists sites; fall back to the raw best-scoring
      // sheet for spreadsheets that only contain a sites table.
      const { rows, sheetName } = parseBestSheet(new Uint8Array(buf), {
        preferSheetName: /site\s*list|^\s*sites?\s*$/i,
      });
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
        'siteName', 'zip', 'electric', 'gas',
        'electricCost', 'gasCost',
        'electricSupplier', 'gasSupplier',
        'electricStart', 'electricEnd', 'gasStart', 'gasEnd',
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
  const pickFirstConsumption = (row, candidates, toUnit) => {
    for (const { header, unit } of candidates) {
      const raw = row[header];
      const converted = toUnit(raw, unit);
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
      const elec = pickFirstConsumption(r, consumption.electric, toKwh);
      const gas = pickFirstConsumption(r, consumption.gas, toTherms);
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
      const electricVendorRaw = electricSupplierOverride ? String(r[electricSupplierOverride] || '').trim() : '';
      const gasVendorRaw = gasSupplierOverride ? String(r[gasSupplierOverride] || '').trim() : '';
      const electricSupplierMatch = matchVendorToSupplier(electricVendorRaw);
      const gasSupplierMatch = matchVendorToSupplier(gasVendorRaw);
      const electricUtilityMatch = !electricSupplierMatch ? matchVendorToUtility(electricVendorRaw) : null;
      const gasUtilityMatch = !gasSupplierMatch ? matchVendorToUtility(gasVendorRaw) : null;
      const electricVendorIsUtility = !!electricUtilityMatch;
      const gasVendorIsUtility = !!gasUtilityMatch;
      // Supplier column gets the canonical brand from the suppliers
      // list when matched; otherwise falls through to the raw vendor
      // (only if the vendor wasn't classified as a utility).
      const electricSupplierResolved = electricSupplierMatch?.canonical
        || (!electricVendorIsUtility && electricVendorRaw ? electricVendorRaw : null);
      const gasSupplierResolved = gasSupplierMatch?.canonical
        || (!gasVendorIsUtility && gasVendorRaw ? gasVendorRaw : null);
      return {
        ...r,
        id: i,
        __zipNorm__: zip,
        __electric__: electricVendorIsUtility ? electricUtilityMatch.canonical : match?.electric,
        __gas__: gasVendorIsUtility ? gasUtilityMatch.canonical : match?.gas,
        __electricVendorRaw__: electricVendorRaw || null,
        __electricVendorMatchScore__: (electricSupplierMatch || electricUtilityMatch)?.score || null,
        __electricVendorMatchKind__: electricSupplierMatch ? 'supplier' : (electricUtilityMatch ? 'utility' : null),
        __gasVendorRaw__: gasVendorRaw || null,
        __gasVendorMatchScore__: (gasSupplierMatch || gasUtilityMatch)?.score || null,
        __gasVendorMatchKind__: gasSupplierMatch ? 'supplier' : (gasUtilityMatch ? 'utility' : null),
        __water__: match?.water,
        __city__: match?.city,
        __country__: match?.country,
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
        __electricSupplier__: electricSupplierResolved,
        __gasSupplier__: gasSupplierResolved,
        __electricStart__: electricStartOverride ? r[electricStartOverride] : null,
        __electricEnd__: electricEndOverride ? r[electricEndOverride] : null,
        __gasStart__: gasStartOverride ? r[gasStartOverride] : null,
        __gasEnd__: gasEndOverride ? r[gasEndOverride] : null,
        __matched__: !!match || electricVendorIsUtility || gasVendorIsUtility,
      };
    });
  }, [cleanSitesData, zipColumn, utility, consumption, electricCostOverride, gasCostOverride, electricSupplierOverride, gasSupplierOverride, electricStartOverride, electricEndOverride, gasStartOverride, gasEndOverride, knownUtilityNames]);

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
    // Existing supplier (competitive retailer) — only populated when
    // the file's vendor column held a name we don't recognize as a
    // utility from the loaded utility-rates lookup.
    const makeSupplierCol = (commodity, label) => ({
      key: `${commodity}_supplier`,
      label,
      defaultWidth: 160,
      render: (row) => {
        const val = commodity === 'electric' ? row.__electricSupplier__ : row.__gasSupplier__;
        if (!val) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>—</span>;
        const vendorRaw = commodity === 'electric' ? row.__electricVendorRaw__ : row.__gasVendorRaw__;
        const matchKind = commodity === 'electric' ? row.__electricVendorMatchKind__ : row.__gasVendorMatchKind__;
        const matchScore = commodity === 'electric' ? row.__electricVendorMatchScore__ : row.__gasVendorMatchScore__;
        const canonicalized = matchKind === 'supplier' && vendorRaw && String(vendorRaw).toLowerCase() !== String(val).toLowerCase();
        const tip = canonicalized
          ? `${label}: ${val} · canonicalized from vendor "${vendorRaw}" via the bundled supplier list (fuzzy score ${matchScore}/100)`
          : matchKind === 'supplier'
          ? `${label}: ${val} · matched against the bundled supplier list (fuzzy score ${matchScore}/100)`
          : `${label}: ${val} (not matched to a known utility or supplier — treated as a competitive retailer)`;
        return (
          <span
            title={tip}
            style={{ background: '#F5F3FF', border: '1px solid #C4B5FD', color: '#5B21B6', padding: '1px 8px', borderRadius: 999, fontSize: '0.7rem', fontWeight: 600, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}
          >{String(val)}</span>
        );
      },
      exportValue: (row) => (commodity === 'electric' ? row.__electricSupplier__ : row.__gasSupplier__) || '',
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
  }, [sitesData, zipColumn, utility]);

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
    for (const r of rows) {
      if (r.__matched__) matched++;
      if (r.__electricCost__ != null) electricCost += r.__electricCost__;
      if (r.__gasCost__ != null) gasCost += r.__gasCost__;
      if (r.__totalCost__ != null) costedSites++;
    }
    return {
      matched,
      total: rows.length,
      electricCost,
      gasCost,
      totalCost: electricCost + gasCost,
      costedSites,
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
    CA: { status: 'Limited', range: '1 - 4%',  lowPct: 0.01, highPct: 0.04 },
    MI: { status: 'Limited', range: '',        lowPct: null, highPct: null },
    VA: { status: 'Limited', range: '',        lowPct: null, highPct: null },
    WA: { status: 'Limited', range: '',        lowPct: null, highPct: null },
  };
  // Flat savings range applied to any deregulated natural-gas site.
  const GAS_SAVINGS = { range: '2 - 4%', lowPct: 0.02, highPct: 0.04 };

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

  const exportExtraSheets = useMemo(() => {
    const sheets = [];
    if (overviewByCommodity.electric.length) {
      sheets.push({ name: 'Electric Overview', rows: overviewByCommodity.electric });
    }
    if (overviewByCommodity.gas.length) {
      sheets.push({ name: 'Gas Overview', rows: overviewByCommodity.gas });
    }
    if (summaryRows.length) {
      sheets.push({ name: 'Summary', rows: summaryRows });
    }
    return sheets;
  }, [overviewByCommodity, summaryRows]);

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
    // Gas keeps a flat 2 % – 4 % across the board; electric uses a
    // per-state curated range (see ELECTRIC_DEREGULATION above) so
    // CA / TX / etc. land at the right percentages.
    const GAS_LOW = 0.02;
    const GAS_HIGH = 0.04;
    const GAS_SAVINGS_RANGE = '2% - 4%';

    // Distinct list joined with ", "; trims to a sensible cap so a
    // state with dozens of suppliers doesn't blow up the cell.
    const joinDistinct = (vals, max = 5) => {
      const seen = new Set();
      const out = [];
      for (const v of vals) {
        const t = String(v ?? '').trim();
        if (!t) continue;
        const k = t.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(t);
        if (out.length >= max) break;
      }
      const trailing = vals.length - out.length;
      return trailing > 0 ? `${out.join(', ')} +${trailing} more` : out.join(', ');
    };
    const parseDate = (v) => {
      if (!v) return null;
      const t = Date.parse(v);
      return Number.isNaN(t) ? null : new Date(t);
    };
    const fmtDate = (d) => d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

    function buildBucket(commodity) {
      const providerKey = `__${commodity}__`;
      const consumptionKey = commodity === 'electric' ? '__kwh__' : '__therms__';
      const costKey = `__${commodity}Cost__`;
      const supplierKey = commodity === 'electric' ? '__electricSupplier__' : '__gasSupplier__';
      const startKey = commodity === 'electric' ? '__electricStart__' : '__gasStart__';
      const endKey = commodity === 'electric' ? '__electricEnd__' : '__gasEnd__';
      const states = new Map();
      for (const r of rows) {
        const state = r.__state__ || '';
        if (!state) continue;
        let g = states.get(state);
        if (!g) {
          g = {
            state,
            totalSites: 0,
            deregulatedSites: 0,
            consumption: 0,
            spend: 0,
            utilities: [],
            suppliers: [],
            starts: [],
            ends: [],
          };
          states.set(state, g);
        }
        g.totalSites += 1;
        const provider = r[providerKey];
        // Track the regulated utility for every site (not just the
        // deregulated ones) so the Utility column captures PG&E /
        // ComEd / Dominion etc. even on regulated rows.
        if (provider) g.utilities.push(provider);
        const isDereg = classifyUtility(provider) === 'Deregulated' || !!r[supplierKey];
        if (!isDereg) continue;
        g.deregulatedSites += 1;
        const consumption = r[consumptionKey];
        if (typeof consumption === 'number' && Number.isFinite(consumption)) {
          // Gas: kWh-equivalent therms → Dth (÷10) for the export column.
          g.consumption += commodity === 'gas' ? consumption / 10 : consumption;
        }
        const cost = r[costKey];
        if (typeof cost === 'number' && Number.isFinite(cost)) g.spend += cost;
        if (r[supplierKey]) g.suppliers.push(r[supplierKey]);
        else if (provider) g.suppliers.push(provider);
        const ds = parseDate(r[startKey]);
        const de = parseDate(r[endKey]);
        if (ds) g.starts.push(ds);
        if (de) g.ends.push(de);
      }
      const out = [...states.values()].sort((a, b) => a.state.localeCompare(b.state));
      return out.map(g => {
        // Electric: per-state curated status / range / pct from
        // ELECTRIC_DEREGULATION. Gas: flat 2 % – 4 % whenever any
        // deregulated activity is on the row.
        let status;
        let range;
        let lowPct;
        let highPct;
        if (commodity === 'electric') {
          const entry = ELECTRIC_DEREGULATION[g.state];
          status = entry?.status || 'no';
          range = entry?.range ?? '';
          lowPct = entry?.lowPct;
          highPct = entry?.highPct;
        } else {
          if (g.deregulatedSites > 0) {
            status = g.deregulatedSites === g.totalSites ? 'yes' : 'Limited';
            range = GAS_SAVINGS_RANGE;
            lowPct = GAS_LOW;
            highPct = GAS_HIGH;
          } else {
            status = 'no';
            range = '';
            lowPct = null;
            highPct = null;
          }
        }
        const low = (lowPct != null && g.spend > 0) ? Math.round(g.spend * lowPct) : (lowPct != null ? 0 : '');
        const high = (highPct != null && g.spend > 0) ? Math.round(g.spend * highPct) : (highPct != null ? 0 : '');
        const earliest = g.starts.length ? new Date(Math.min(...g.starts.map(d => d.getTime()))) : null;
        const latest = g.ends.length ? new Date(Math.max(...g.ends.map(d => d.getTime()))) : null;
        return {
          state: g.state,
          status,
          totalSites: g.totalSites,
          deregulatedSites: g.deregulatedSites,
          consumption: Math.round(g.consumption),
          spend: Math.round(g.spend),
          range,
          low,
          high,
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
    }

    const electricRows = buildBucket('electric');
    const gasRows = buildBucket('gas');

    const wb = new Workbook();
    wb.creator = 'Schneider Electric · Prospect Tracker';
    wb.created = new Date();
    const ws = wb.addWorksheet('Indicative Savings by State', {
      properties: { tabColor: { argb: SE_GREEN } },
      views: [{ showGridLines: false }],
    });

    const SPAN = 13;
    const widths = [10, 14, 11, 13, 18, 16, 14, 14, 14, 24, 24, 14, 14];
    ws.columns = widths.map(w => ({ width: w }));

    // Title row — Schneider green band, white text.
    ws.mergeCells(1, 1, 1, SPAN);
    const title = ws.getCell(1, 1);
    title.value = 'Indicative Savings by State';
    title.font = { name: 'Nunito Sans', bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
    title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(1).height = 28;

    let r = 3;
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
      // Column headers — solid green band, white text.
      const headerRow = ws.getRow(r);
      columnDefs.forEach((c, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = c.label;
        cell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
        cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 };
        cell.border = { bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } } };
      });
      headerRow.height = 32;
      r += 1;
      // Data rows — every cell left-aligned regardless of type so the
      // sheet reads as a flat report rather than a finance ledger.
      for (const row of sectionRows) {
        const dataRow = ws.getRow(r);
        columnDefs.forEach((c, i) => {
          const cell = dataRow.getCell(i + 1);
          const v = c.get(row);
          cell.value = (v === '' || v == null) ? null : v;
          cell.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
          cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
          if (c.numFmt) cell.numFmt = c.numFmt;
          cell.border = { bottom: { style: 'hair', color: { argb: SE_BORDER } } };
        });
        dataRow.height = 18;
        r += 1;
      }
      // Total row — green double rule above and below.
      const totalRow = ws.getRow(r);
      const totals = sectionRows.reduce((acc, row) => {
        for (const c of columnDefs) {
          if (!c.sumKey) continue;
          acc[c.sumKey] = (acc[c.sumKey] || 0) + (Number(c.get(row)) || 0);
        }
        return acc;
      }, {});
      columnDefs.forEach((c, i) => {
        const cell = totalRow.getCell(i + 1);
        let v = '';
        if (i === 0) v = 'Total';
        else if (c.sumKey) v = totals[c.sumKey] || 0;
        cell.value = v === '' ? null : v;
        cell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: SE_GREEN_DARK } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        if (c.numFmt) cell.numFmt = c.numFmt;
        cell.border = {
          top: { style: 'thin', color: { argb: SE_GREEN_DARK } },
          bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } },
        };
      });
      totalRow.height = 20;
      r += 2;
    }

    const electricCols = [
      { label: 'ST/Prov', get: (g) => g.state },
      { label: 'Deregulated Status', get: (g) => g.status },
      { label: 'Total Sites', get: (g) => g.totalSites, numFmt: '#,##0', sumKey: 'totalSites' },
      { label: 'Deregulated Sites', get: (g) => g.deregulatedSites, numFmt: '#,##0', sumKey: 'deregulatedSites' },
      { label: 'Annual Deregulated Consumption kWh', get: (g) => g.consumption, numFmt: '#,##0', sumKey: 'consumption' },
      { label: 'Annual Deregulated Spend', get: (g) => g.spend, numFmt: '"$"#,##0', sumKey: 'spend' },
      { label: 'Indicative Savings Range', get: (g) => g.range },
      { label: 'Indicative Savings Low', get: (g) => g.low, numFmt: '"$"#,##0', sumKey: 'low' },
      { label: 'Indicative Savings High', get: (g) => g.high, numFmt: '"$"#,##0', sumKey: 'high' },
      { label: 'Utility Vendor', get: (g) => g.utilities },
      { label: 'Supplier Name', get: (g) => g.suppliers },
      { label: 'Contract Start', get: (g) => g.earliestStart },
      { label: 'Contract End', get: (g) => g.latestEnd },
    ];
    const gasCols = [
      { label: 'ST/Prov', get: (g) => g.state },
      { label: 'Deregulated Status', get: (g) => g.status },
      { label: 'Sites', get: (g) => g.totalSites, numFmt: '#,##0', sumKey: 'totalSites' },
      { label: 'Deregulated Sites', get: (g) => g.deregulatedSites, numFmt: '#,##0', sumKey: 'deregulatedSites' },
      { label: 'Consumption Dth', get: (g) => g.consumption, numFmt: '#,##0', sumKey: 'consumption' },
      { label: 'Spend', get: (g) => g.spend, numFmt: '"$"#,##0', sumKey: 'spend' },
      { label: 'Indicative Savings Range', get: (g) => g.range },
      { label: 'Indicative Savings Low', get: (g) => g.low, numFmt: '"$"#,##0', sumKey: 'low' },
      { label: 'Indicative Savings High', get: (g) => g.high, numFmt: '"$"#,##0', sumKey: 'high' },
      { label: 'Utility Vendor', get: (g) => g.utilities },
      { label: 'Supplier Name', get: (g) => g.suppliers },
      { label: 'Contract Start', get: (g) => g.earliestStart },
      { label: 'Contract End', get: (g) => g.latestEnd },
    ];

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

    // Header row.
    const detailHeader = detailSheet.getRow(2);
    detailCols.forEach((c, i) => {
      const cell = detailHeader.getCell(i + 1);
      cell.value = c.label;
      cell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
      cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 };
      cell.border = { bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } } };
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
        return {
          siteName: siteNameColumn ? String(r[siteNameColumn] || '').trim() : '',
          state: r.__state__ || '',
          zip: r.__zipNorm__ || '',
          electricUtility,
          electricSupplier,
          kwh: typeof r.__kwh__ === 'number' ? Math.round(r.__kwh__) : null,
          electricCost: typeof r.__electricCost__ === 'number' ? Math.round(r.__electricCost__) : null,
          electricStart: tbdIfMissing(r.__electricStart__, !!electricSupplier),
          electricEnd: tbdIfMissing(r.__electricEnd__, !!electricSupplier),
          gasUtility,
          gasSupplier,
          dth,
          gasCost: typeof r.__gasCost__ === 'number' ? Math.round(r.__gasCost__) : null,
          gasStart: tbdIfMissing(r.__gasStart__, !!gasSupplier),
          gasEnd: tbdIfMissing(r.__gasEnd__, !!gasSupplier),
        };
      })
      .filter(s => s.siteName)
      .sort((a, b) => (a.state || '').localeCompare(b.state || '') || a.siteName.localeCompare(b.siteName));

    sitesForDetail.forEach((s, idx) => {
      const dataRow = detailSheet.getRow(3 + idx);
      detailCols.forEach((c, i) => {
        const cell = dataRow.getCell(i + 1);
        const v = c.get(s);
        cell.value = (v === '' || v == null) ? null : v;
        cell.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        if (c.numFmt) cell.numFmt = c.numFmt;
        cell.border = { bottom: { style: 'hair', color: { argb: SE_BORDER } } };
      });
      dataRow.height = 18;
    });
    if (sitesForDetail.length > 0) {
      detailSheet.autoFilter = {
        from: { row: 2, column: 1 },
        to: { row: 2 + sitesForDetail.length, column: detailCols.length },
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
          // Numeric formats for known column types
          const label = String(headers[i] || '').toLowerCase();
          if (typeof v === 'number') {
            if (/spend|cost|savings/.test(label)) cell.numFmt = '"$"#,##0';
            else if (/rate/.test(label)) cell.numFmt = '$0.000';
            else if (/kwh|therm|consumption/.test(label)) cell.numFmt = '#,##0';
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
              if (/spend|savings/.test(label)) cell.numFmt = '"$"#,##0';
              else if (/sites/.test(label)) cell.numFmt = '#,##0';
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
            { key: 'electric', label: 'Annual Electric (kWh)', required: false, hint: 'Annual electric usage for cost estimates.' },
            { key: 'gas', label: 'Annual Gas (therms / MMBtu / Dth)', required: false, hint: 'Annual gas usage for cost estimates.' },
            { key: 'electricCost', label: 'Total Electric Cost ($)', required: false, hint: 'Actual annual electric spend. Used in place of the kWh × rate estimate when present.' },
            { key: 'gasCost', label: 'Total Natural Gas Cost ($)', required: false, hint: 'Actual annual gas spend. Used in place of the Dth × rate estimate when present.' },
            { key: 'electricSupplier', label: 'Electric Supplier / Vendor', required: false, hint: 'If the value matches a known utility from the rates file it goes in the Electric Utility column; otherwise it lands in the Supplier column.' },
            { key: 'electricStart', label: 'Electric Contract Start', required: false, hint: 'Start date of the existing electric supply contract.' },
            { key: 'electricEnd', label: 'Electric Contract End', required: false, hint: 'End / expiration date of the existing electric supply contract.' },
            { key: 'gasSupplier', label: 'Gas Supplier / Vendor', required: false, hint: 'If the value matches a known utility from the rates file it goes in the Gas Utility column; otherwise it lands in the Supplier column.' },
            { key: 'gasStart', label: 'Gas Contract Start', required: false, hint: 'Start date of the existing gas supply contract.' },
            { key: 'gasEnd', label: 'Gas Contract End', required: false, hint: 'End / expiration date of the existing gas supply contract.' },
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

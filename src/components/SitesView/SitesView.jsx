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

export function SitesView() {
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
      setSitesData(Array.isArray(sites) ? sites : []);
      setSitesLoaded(true);
      setUtility(util);
      setUtilityLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

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
      await saveListToIDB(SITES_STORAGE_KEY, rows);
      setSitesData(rows);
      if (sheetName && !/site/i.test(sheetName)) {
        // Helpful nudge when we grabbed something that wasn't a sites
        // tab — e.g. user dropped a file that has no Site List tab.
        setUploadError(`No tab named "Site List" found — loaded sheet "${sheetName}" instead (${rows.length.toLocaleString()} rows). Rename the tab or drop a different file if that's not what you wanted.`);
      }
    } catch (err) {
      setUploadError(err?.message || 'Failed to read the sites file');
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
    return pickZipColumn(Object.keys(sitesData[0]));
  }, [sitesData]);

  // Detect the column that holds the site name so we can drop blank
  // rows. Falls back to the sticky first column if no obvious
  // name/site/location header shows up.
  const siteNameColumn = useMemo(() => {
    if (!sitesData.length) return '';
    const headers = Object.keys(sitesData[0]);
    const match = headers.find(h => /\b(site\s*name|site|property|location|facility|building|name)\b/i.test(String(h)));
    return match || headers[0] || '';
  }, [sitesData]);

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
    if (!sitesData.length) return { electric: [], gas: [] };
    const headers = Object.keys(sitesData[0]);
    const mk = (commodity) => detectConsumptionColumns(headers, commodity)
      .map(header => ({ header, unit: detectConsumptionUnit(header, commodity) }));
    return { electric: mk('electric'), gas: mk('gas') };
  }, [sitesData]);
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

  const pickMinConsumption = (row, candidates, toUnit) => {
    let best = null;
    let bestHeader = null;
    for (const { header, unit } of candidates) {
      const raw = row[header];
      const converted = toUnit(raw, unit);
      if (converted == null || !Number.isFinite(converted) || converted <= 0) continue;
      if (best == null || converted < best) {
        best = converted;
        bestHeader = header;
      }
    }
    return { value: best, sourceHeader: bestHeader };
  };

  const rows = useMemo(() => {
    return cleanSitesData.map((r, i) => {
      const zip = zipColumn ? normalizeZip(r[zipColumn]) : '';
      const match = utility?.zipMap && zip ? utility.zipMap[zip] : null;
      const state = match?.state || zipToState(zip);
      const electricRate = state ? stateRate(state, 'electric') : null;
      const gasRate = state ? stateRate(state, 'gas') : null;
      const elec = pickMinConsumption(r, consumption.electric, toKwh);
      const gas = pickMinConsumption(r, consumption.gas, toTherms);
      const electricCost = electricRate != null && elec.value != null ? electricRate * elec.value : null;
      const gasCost = gasRate != null && gas.value != null ? gasRate * gas.value : null;
      const totalCost = (electricCost ?? 0) + (gasCost ?? 0);
      return {
        ...r,
        id: i,
        __zipNorm__: zip,
        __electric__: match?.electric,
        __gas__: match?.gas,
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
        __totalCost__: (electricCost != null || gasCost != null) ? totalCost : null,
        __matched__: !!match,
      };
    });
  }, [cleanSitesData, zipColumn, utility, consumption]);

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
        return (
          <span
            title={`${label} · ${text}${row.__city__ ? ` · ${row.__city__}` : ''}${row.__country__ ? ` · ${row.__country__}` : ''}`}
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
        if (key === 'electricCost' && row.__kwh__ != null) {
          title = `${row.__kwh__.toLocaleString()} kWh × ${formatRate(row.__electricRate__, 'electric')}${row.__kwhSource__ ? ` · min of matching columns ("${row.__kwhSource__}")` : ''}`;
        } else if (key === 'gasCost' && row.__therms__ != null) {
          title = `${Math.round(row.__therms__).toLocaleString()} therms × ${formatRate(row.__gasRate__, 'gas')}${row.__thermsSource__ ? ` · min of matching columns ("${row.__thermsSource__}")` : ''}`;
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
    return [
      ...base,
      makeStateCol(),
      makeUtilityCol('electric', 'Electric Utility', { bg: '#FEF3C7', border: '#FCD34D', text: '#92400E' }),
      makeMarketCol('electric', 'Electric Market'),
      makeRateCol('electric', 'Electric Rate'),
      makeCostCol('electricCost', 'Electric Cost', { bg: '#FEF3C7', border: '#FCD34D', text: '#92400E' }),
      makeUtilityCol('gas', 'Gas Utility', { bg: '#DBEAFE', border: '#93C5FD', text: '#1E3A8A' }),
      makeMarketCol('gas', 'Gas Market'),
      makeRateCol('gas', 'Gas Rate'),
      makeCostCol('gasCost', 'Gas Cost', { bg: '#DBEAFE', border: '#93C5FD', text: '#1E3A8A' }),
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

  const exportExtraSheets = useMemo(() => {
    const sheets = [];
    if (overviewByCommodity.electric.length) {
      sheets.push({ name: 'Electric Overview', rows: overviewByCommodity.electric });
    }
    if (overviewByCommodity.gas.length) {
      sheets.push({ name: 'Gas Overview', rows: overviewByCommodity.gas });
    }
    return sheets;
  }, [overviewByCommodity]);

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

    // Sheet 1: Raw Data (from the on-screen table — respects sort,
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

    // Extra sheets (Electric / Gas Overview) — come in as array of
    // plain row objects; we key them consistently.
    for (const extra of extraSheets || []) {
      if (!extra?.rows?.length) continue;
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
      style={dragOver ? { outline: '2px dashed var(--color-accent)', outlineOffset: -4, background: '#F0F9FF' } : undefined}
    >
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Utility Lookup</h1>
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
                (auto — min of {detectedConsumption.electric.length} cols)
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
                (auto — min of {detectedConsumption.gas.length} cols)
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
        />
      )}

      {mappingModal && createPortal(
        <div className={styles.modalBackdrop} onClick={() => !utilityBusy && setMappingModal(null)}>
          <div className={styles.modalCard} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Utility Rates — Column Mapping</h3>
              <button className={styles.modalClose} onClick={() => setMappingModal(null)} disabled={utilityBusy}>×</button>
            </div>
            <p className={styles.modalHelp}>
              {mappingModal.rows.length.toLocaleString()} rows found{mappingModal.sheetName ? ` on sheet "${mappingModal.sheetName}"` : ''}. Each row is one (zip, commodity) combination. Zip / Commodity Type / Utility are required; the rest are optional.
            </p>
            {[
              { key: 'zip', label: 'Zip / Postal Code', required: true },
              { key: 'commodityType', label: 'Commodity Type', required: true },
              { key: 'utility', label: 'Utility', required: true },
              { key: 'city', label: 'City', required: false },
              { key: 'state', label: 'State', required: false },
              { key: 'country', label: 'Country', required: false },
              { key: 'uniqueLookup', label: 'Unique Lookup', required: false },
            ].map(({ key, label, required }) => {
              const val = mappingModal.mapping[key];
              return (
                <div key={key} className={styles.modalRow}>
                  <div className={styles.modalLabel}>
                    {label}
                    {required && <span style={{ color: '#DC2626', marginLeft: 2 }}>*</span>}
                  </div>
                  <span style={{ color: '#94A3B8', fontSize: '0.75rem' }}>→</span>
                  <select
                    className={`${styles.modalSelect} ${val ? styles.modalSelectMapped : (required ? styles.modalSelectUnmapped : '')}`}
                    value={val}
                    onChange={e => setMappingModal(m => ({ ...m, mapping: { ...m.mapping, [key]: e.target.value } }))}
                  >
                    <option value="">— Not mapped —</option>
                    {mappingModal.headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                  {val && <span style={{ color: '#10B981', fontSize: '0.75rem', fontWeight: 600 }}>✓</span>}
                </div>
              );
            })}
            <div className={styles.modalActions}>
              <button className={styles.modalCancel} onClick={() => setMappingModal(null)} disabled={utilityBusy}>Cancel</button>
              <button
                className={styles.modalConfirm}
                onClick={executeUtilityImport}
                disabled={utilityBusy || !mappingModal.mapping.zip || !mappingModal.mapping.commodityType || !mappingModal.mapping.utility}
              >
                {utilityBusy ? 'Importing…' : 'Import Utility Lookup'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

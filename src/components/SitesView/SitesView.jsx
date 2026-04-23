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

  const rows = useMemo(() => {
    return sitesData.map((r, i) => {
      const zip = zipColumn ? normalizeZip(r[zipColumn]) : '';
      const match = utility?.zipMap && zip ? utility.zipMap[zip] : null;
      return {
        ...r,
        id: i,
        __zipNorm__: zip,
        __electric__: match?.electric,
        __gas__: match?.gas,
        __water__: match?.water,
        __city__: match?.city,
        __country__: match?.country,
        __matched__: !!match,
      };
    });
  }, [sitesData, zipColumn, utility]);

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
        const color = isRegulated
          ? { bg: '#DCFCE7', border: '#86EFAC', text: '#166534' }
          : { bg: '#FFEDD5', border: '#FDBA74', text: '#9A3412' };
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
    });
    return [
      ...base,
      makeUtilityCol('electric', 'Electric Utility', { bg: '#FEF3C7', border: '#FCD34D', text: '#92400E' }),
      makeMarketCol('electric', 'Electric Market'),
      makeUtilityCol('gas', 'Gas Utility', { bg: '#DBEAFE', border: '#93C5FD', text: '#1E3A8A' }),
      makeMarketCol('gas', 'Gas Market'),
      makeUtilityCol('water', 'Water Utility', { bg: '#DCFCE7', border: '#86EFAC', text: '#166534' }),
      makeLocationCol('city', 'Lookup City'),
      makeLocationCol('country', 'Lookup Country'),
    ];
  }, [sitesData, zipColumn, utility]);

  const alwaysVisible = useMemo(() => {
    if (!columns.length) return [];
    return [columns[0].key, 'electric', 'electric_market', 'gas', 'gas_market', 'water'];
  }, [columns]);

  const tableId = useMemo(
    () => `sites-list:${columns.map(c => c.key).sort().join('|')}`,
    [columns]
  );

  const matchStats = useMemo(() => {
    if (!utility?.zipMap || !rows.length) return null;
    let matched = 0;
    for (const r of rows) if (r.__matched__) matched++;
    return { matched, total: rows.length };
  }, [rows, utility]);

  const utilMeta = utility?.meta || null;

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
            {sitesData.length} {sitesData.length === 1 ? 'site' : 'sites'}
            {matchStats && (
              <> · <strong style={{ color: '#166534' }}>{matchStats.matched}</strong>/{matchStats.total} matched to utility lookup</>
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

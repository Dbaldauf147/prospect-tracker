import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
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
import styles from './SitesView.module.css';

const SITES_STORAGE_KEY = 'sites-list-override';

function detectColumn(headers, patterns) {
  for (const pat of patterns) {
    const hit = headers.find(h => pat.test(String(h)));
    if (hit) return hit;
  }
  return '';
}

function formatRate(value) {
  if (value == null || value === '') return null;
  const num = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(num)) return String(value);
  if (num === 0) return '0';
  if (Math.abs(num) < 1) return num.toFixed(4);
  if (Math.abs(num) < 100) return num.toFixed(2);
  return num.toLocaleString();
}

function pickZipColumn(headers) {
  if (!headers.length) return '';
  return detectColumn(headers, [/^zip\s*code$/i, /^postal\s*code$/i, /^zip$/i, /zip/i, /postal/i])
    || headers[0];
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

  async function handleSitesUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadError('');
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error('Workbook has no sheets');
      const parsed = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('No rows parsed');
      await saveListToIDB(SITES_STORAGE_KEY, parsed);
      setSitesData(parsed);
    } catch (err) {
      setUploadError(err?.message || 'Failed to read the sites file');
    }
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
      const wb = XLSX.read(buf);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error('Workbook has no sheets');
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (!rows.length) throw new Error('No rows parsed');
      const headers = Object.keys(rows[0]);
      const mapping = {
        zip: detectColumn(headers, [/^zip\s*code$/i, /^postal\s*code$/i, /^zip$/i, /zip/i, /postal/i]),
        electric: detectColumn(headers, [/electric/i, /elec/i, /kwh/i]),
        gas: detectColumn(headers, [/gas/i, /natural\s*gas/i, /therm/i]),
        water: detectColumn(headers, [/water/i, /h2o/i]),
      };
      setMappingModal({ rows, headers, mapping, fileName: file.name });
    } catch (err) {
      setUploadError(err?.message || 'Failed to read the utility file');
    } finally {
      setUtilityBusy(false);
    }
  }

  async function executeUtilityImport() {
    if (!mappingModal) return;
    const { rows, mapping, fileName } = mappingModal;
    if (!mapping.zip) { setUploadError('Zip column is required'); return; }
    setUtilityBusy(true);
    try {
      // Build zip → { electric, gas, water }. Later rows for the same
      // zip overwrite earlier ones — matches the user picking the first
      // match by default, which is the common "duplicate" case in
      // utility-rate tables (by ZIP+carrier).
      const zipMap = {};
      let valid = 0;
      for (const r of rows) {
        const zip = normalizeZip(r[mapping.zip]);
        if (!zip) continue;
        valid++;
        const entry = {};
        if (mapping.electric) entry.electric = r[mapping.electric];
        if (mapping.gas) entry.gas = r[mapping.gas];
        if (mapping.water) entry.water = r[mapping.water];
        zipMap[zip] = entry;
      }
      const uniqueZips = Object.keys(zipMap).length;
      await saveUtilityRates(zipMap, {
        fileName,
        rowCount: rows.length,
        zipCount: uniqueZips,
        validRows: valid,
        columns: mapping,
        importedAt: Date.now(),
      });
      setUtility({ zipMap, meta: {
        fileName,
        rowCount: rows.length,
        zipCount: uniqueZips,
        validRows: valid,
        columns: mapping,
        importedAt: Date.now(),
      }});
      setMappingModal(null);
    } catch (err) {
      setUploadError(err?.message || 'Failed to save utility rates');
    } finally {
      setUtilityBusy(false);
    }
  }

  async function handleClearUtility() {
    if (!window.confirm('Remove the uploaded utility rates?')) return;
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
    const makeRate = (key, label, color) => ({
      key,
      label,
      defaultWidth: 120,
      render: (row) => {
        if (!utility?.zipMap) {
          return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>no rates loaded</span>;
        }
        if (!row.__matched__) {
          return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>—</span>;
        }
        const val = row[`__${key}__`];
        if (val == null || val === '') return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>—</span>;
        const formatted = formatRate(val);
        return (
          <span style={{ background: color.bg, border: `1px solid ${color.border}`, color: color.text, padding: '1px 8px', borderRadius: 999, fontSize: '0.7rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
            {formatted}
          </span>
        );
      },
    });
    return [
      ...base,
      makeRate('electric', 'Electric', { bg: '#FEF3C7', border: '#FCD34D', text: '#92400E' }),
      makeRate('gas', 'Gas', { bg: '#DBEAFE', border: '#93C5FD', text: '#1E3A8A' }),
      makeRate('water', 'Water', { bg: '#DCFCE7', border: '#86EFAC', text: '#166534' }),
    ];
  }, [sitesData, zipColumn, utility]);

  const alwaysVisible = useMemo(() => {
    if (!columns.length) return [];
    return [columns[0].key, 'electric', 'gas', 'water'];
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
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Sites</h1>
          <div className={styles.subtitle}>
            {sitesData.length} {sitesData.length === 1 ? 'site' : 'sites'}
            {matchStats && (
              <> · <strong style={{ color: '#166534' }}>{matchStats.matched}</strong>/{matchStats.total} matched to utility rates</>
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
              ✓ Utility rates loaded: {utilMeta.zipCount?.toLocaleString() || '?'} zip codes
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
              No utility rates loaded. Upload a file with zip code + electric/gas/water columns.
            </span>
            <button
              className={styles.utilityBarButton}
              onClick={() => utilityFileRef.current?.click()}
              disabled={utilityBusy}
            >{utilityBusy ? 'Working…' : 'Upload Utility Rates'}</button>
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
          No sites loaded. Click <strong>Upload Sites File</strong> to add your list.
          <div style={{ marginTop: '0.5rem', fontSize: '0.78rem' }}>
            The first column matching a "zip"/"postal" header is used to look up utility rates.
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
              {mappingModal.rows.length.toLocaleString()} rows found. Map at least the zip code column; the three rate columns are optional (you can load just the ones you have).
            </p>
            {['zip', 'electric', 'gas', 'water'].map(field => {
              const val = mappingModal.mapping[field];
              const required = field === 'zip';
              return (
                <div key={field} className={styles.modalRow}>
                  <div className={styles.modalLabel}>
                    {field === 'zip' ? 'Zip Code' : field.charAt(0).toUpperCase() + field.slice(1)}
                    {required && <span style={{ color: '#DC2626', marginLeft: 2 }}>*</span>}
                  </div>
                  <span style={{ color: '#94A3B8', fontSize: '0.75rem' }}>→</span>
                  <select
                    className={`${styles.modalSelect} ${val ? styles.modalSelectMapped : (required ? styles.modalSelectUnmapped : '')}`}
                    value={val}
                    onChange={e => setMappingModal(m => ({ ...m, mapping: { ...m.mapping, [field]: e.target.value } }))}
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
                disabled={utilityBusy || !mappingModal.mapping.zip}
              >
                {utilityBusy ? 'Importing…' : 'Import Rates'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

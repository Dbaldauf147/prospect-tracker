import { useState, useMemo, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { DataTable } from '../common/DataTable';
import styles from './UploadedListView.module.css';

function loadList(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return { data: parsed, source: 'override' };
    }
  } catch {}
  return { data: [], source: 'empty' };
}

function buildColumns(data) {
  if (!data.length) return [];
  const keys = new Set();
  for (const row of data) for (const k of Object.keys(row)) if (k !== 'id') keys.add(k);
  return [...keys].map((k, i) => ({
    key: k,
    label: k,
    defaultWidth: i === 0 ? 240 : 140,
    ...(i === 0 ? { sticky: true } : {}),
  }));
}

export function UploadedListView({
  storageKey,
  title,
  tableIdPrefix,
  singular = 'entry',
  plural = 'entries',
}) {
  const [{ data, source }, setStore] = useState(() => loadList(storageKey));
  const [search, setSearch] = useState('');
  const [uploadError, setUploadError] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => { setStore(loadList(storageKey)); setSearch(''); setUploadError(null); }, [storageKey]);

  useEffect(() => {
    function onStorage(e) {
      if (e.key === storageKey) setStore(loadList(storageKey));
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [storageKey]);

  const rows = useMemo(() => data.map((r, i) => ({ ...r, id: i })), [data]);
  const columns = useMemo(() => buildColumns(rows), [rows]);
  const tableId = useMemo(
    () => `${tableIdPrefix}:` + columns.map(c => c.key).sort().join('|'),
    [columns, tableIdPrefix]
  );
  const alwaysVisible = useMemo(() => {
    const first = columns[0];
    return first ? [first.key] : [];
  }, [columns]);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const term = search.toLowerCase();
    return rows.filter(r =>
      Object.values(r).some(v => String(v).toLowerCase().includes(term))
    );
  }, [search, rows]);

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadError(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error('Workbook has no sheets');
      const parsed = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('No rows parsed');
      localStorage.setItem(storageKey, JSON.stringify(parsed));
      setStore(loadList(storageKey));
    } catch (err) {
      const msg = err?.name === 'QuotaExceededError'
        ? 'Upload too large for browser storage (max ~5 MB). Try trimming unused columns.'
        : (err?.message || 'Failed to read file');
      setUploadError(msg);
    }
  }

  function handleRevert() {
    if (!window.confirm(`Remove the uploaded ${title} list?`)) return;
    localStorage.removeItem(storageKey);
    setStore(loadList(storageKey));
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{title}</h1>
          <div className={styles.subtitle}>
            {rows.length} {rows.length === 1 ? singular : plural}{source === 'override' ? ' · uploaded list active' : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleUpload}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title={`Upload an Excel file to populate the ${title} table.`}
            style={{ padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', background: 'white', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Upload Excel
          </button>
          {source === 'override' && (
            <button
              type="button"
              onClick={handleRevert}
              title={`Remove the uploaded ${title} list`}
              style={{ padding: '0.4rem 0.8rem', border: '1px solid #FCA5A5', background: 'white', color: '#DC2626', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Remove list
            </button>
          )}
        </div>
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
          placeholder={`Search ${title}...`}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && <span className={styles.resultCount}>{filtered.length} results</span>}
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: '2rem 1.25rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
          No {title} loaded. Click <strong>Upload Excel</strong> to add your list.
        </div>
      ) : (
        <DataTable
          key={tableId}
          tableId={tableId}
          columns={columns}
          rows={filtered}
          alwaysVisible={alwaysVisible}
          emptyMessage={`No matching ${plural} found`}
        />
      )}
    </div>
  );
}

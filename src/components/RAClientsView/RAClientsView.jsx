import { useState, useMemo, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { DataTable } from '../common/DataTable';
import { loadEffectiveRaClients, saveRaClientsOverride, clearRaClientsOverride } from '../../utils/raClientsStore';
import styles from './RAClientsView.module.css';

const COLUMNS = [
  { key: 'MDM Name', label: 'MDM Name', defaultWidth: 220, sticky: true },
  { key: 'Client Added', label: 'Client Added', defaultWidth: 110 },
  { key: 'First Activity', label: 'First Activity', defaultWidth: 110 },
  { key: 'Recent Activity', label: 'Recent Activity', defaultWidth: 120 },
  { key: 'Years with Access', label: 'Years w/ Access', defaultWidth: 100 },
  { key: 'RA Completeness', label: 'RA Completeness', defaultWidth: 115 },
  { key: 'Users', label: 'Users', defaultWidth: 70 },
  { key: 'Sites', label: 'Sites', defaultWidth: 70 },
  { key: 'IDM Portfolio', label: 'IDM Portfolio', defaultWidth: 100 },
  { key: 'Projects', label: 'Projects', defaultWidth: 80 },
  { key: 'AV Apps', label: 'AV Apps', defaultWidth: 75 },
  { key: 'Surveys', label: 'Surveys', defaultWidth: 80 },
  { key: 'Corporate HQ', label: 'Corporate HQ', defaultWidth: 120 },
  { key: 'Global Footprint', label: 'Global Footprint', defaultWidth: 110 },
  { key: 'Average Site Cost', label: 'Avg Site Cost', defaultWidth: 120,
    render: (row) => {
      const v = row['Average Site Cost'];
      if (v == null || v === '' || v === '-') return '—';
      return '$' + Number(v).toLocaleString();
    },
  },
  { key: 'Client Management Team', label: 'Client Mgmt Team', defaultWidth: 180 },
];

export function RAClientsView() {
  const [{ data, source }, setStore] = useState(() => loadEffectiveRaClients());
  const [search, setSearch] = useState('');
  const [uploadError, setUploadError] = useState(null);
  const fileInputRef = useRef(null);

  // Keep data fresh if another tab writes to the override key
  useEffect(() => {
    function onStorage(e) {
      if (e.key === 'ra-clients-override') setStore(loadEffectiveRaClients());
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const rows = useMemo(() => data.map((r, i) => ({ ...r, id: i })), [data]);

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
      const hasMdmName = parsed.some(r => Object.keys(r).some(k => k.trim().toLowerCase() === 'mdm name'));
      if (!hasMdmName) throw new Error('No "MDM Name" column found — required for matching on Portfolio Companies.');
      saveRaClientsOverride(parsed);
      setStore(loadEffectiveRaClients());
    } catch (err) {
      const msg = err?.name === 'QuotaExceededError'
        ? 'Upload too large for browser storage (max ~5 MB). Try trimming unused columns.'
        : (err?.message || 'Failed to read file');
      setUploadError(msg);
    }
  }

  function handleRevert() {
    if (!window.confirm('Revert to the bundled RA Clients list? Your uploaded version will be removed.')) return;
    clearRaClientsOverride();
    setStore(loadEffectiveRaClients());
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>RA Clients</h1>
          <div className={styles.subtitle}>
            {rows.length} clients{source === 'override' ? ' · uploaded override active' : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleUpload}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Replace the RA Clients table by uploading a new Excel file. Must include an 'MDM Name' column."
            style={{ padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', background: 'white', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Upload Excel
          </button>
          {source === 'override' && (
            <button
              type="button"
              onClick={handleRevert}
              title="Restore the bundled RA Clients list"
              style={{ padding: '0.4rem 0.8rem', border: '1px solid #FCA5A5', background: 'white', color: '#DC2626', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Revert to default
            </button>
          )}
        </div>
      </div>
      {uploadError && (
        <div style={{ margin: '0.5rem 0', padding: '0.5rem 0.75rem', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 6, color: '#991B1B', fontSize: '0.8rem' }}>
          {uploadError}
        </div>
      )}
      <div className={styles.searchRow}>
        <input
          className={styles.searchInput}
          type="text"
          placeholder="Search clients..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && <span className={styles.resultCount}>{filtered.length} results</span>}
      </div>
      <DataTable
        tableId="ra-clients"
        columns={COLUMNS}
        rows={filtered}
        alwaysVisible={['MDM Name']}
        emptyMessage="No matching RA clients found"
      />
    </div>
  );
}

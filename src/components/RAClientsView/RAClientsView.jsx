import { useState, useMemo, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { DataTable } from '../common/DataTable';
import { loadEffectiveRaClients, saveRaClientsOverride, clearRaClientsOverride, raClientName } from '../../utils/raClientsStore';
import styles from './RAClientsView.module.css';

// Column definitions used only when the uploaded/bundled data already has these keys.
// Anything else we encounter gets rendered with a sensible default width.
const KNOWN_COLUMN_META = {
  'MDM Name': { label: 'MDM Name', defaultWidth: 220, sticky: true },
  'Client Name': { label: 'Client Name', defaultWidth: 240, sticky: true },
  'CM': { label: 'CM', defaultWidth: 160 },
  'Client Added': { label: 'Client Added', defaultWidth: 110 },
  'First Activity': { label: 'First Activity', defaultWidth: 110 },
  'Recent Activity': { label: 'Recent Activity', defaultWidth: 120 },
  'Years with Access': { label: 'Years w/ Access', defaultWidth: 100 },
  'RA Completeness': { label: 'RA Completeness', defaultWidth: 115 },
  'Users': { label: 'Users', defaultWidth: 70 },
  'Sites': { label: 'Sites', defaultWidth: 70 },
  'IDM Portfolio': { label: 'IDM Portfolio', defaultWidth: 100 },
  'Projects': { label: 'Projects', defaultWidth: 80 },
  'AV Apps': { label: 'AV Apps', defaultWidth: 75 },
  'Surveys': { label: 'Surveys', defaultWidth: 80 },
  'Corporate HQ': { label: 'Corporate HQ', defaultWidth: 120 },
  'Global Footprint': { label: 'Global Footprint', defaultWidth: 110 },
  'Average Site Cost': { label: 'Avg Site Cost', defaultWidth: 120,
    render: (row) => {
      const v = row['Average Site Cost'];
      if (v == null || v === '' || v === '-') return '—';
      return '$' + Number(v).toLocaleString();
    },
  },
  'Client Management Team': { label: 'Client Mgmt Team', defaultWidth: 180 },
};

function buildColumns(data) {
  const keys = new Set();
  for (const row of data) for (const k of Object.keys(row)) if (k !== 'id') keys.add(k);
  // Put the name column first, then CM, then the rest of known cols, then any extras
  const ordered = [];
  if (keys.has('Client Name')) ordered.push('Client Name');
  if (keys.has('MDM Name') && !ordered.includes('MDM Name')) ordered.push('MDM Name');
  if (keys.has('CM')) ordered.push('CM');
  for (const k of Object.keys(KNOWN_COLUMN_META)) {
    if (keys.has(k) && !ordered.includes(k)) ordered.push(k);
  }
  for (const k of keys) if (!ordered.includes(k)) ordered.push(k);
  return ordered.map(k => {
    const meta = KNOWN_COLUMN_META[k] || { label: k, defaultWidth: 140 };
    return { key: k, ...meta };
  });
}

export function RAClientsView() {
  const [{ data, source }, setStore] = useState(() => loadEffectiveRaClients());
  const [search, setSearch] = useState('');
  const [uploadError, setUploadError] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    function onStorage(e) {
      if (e.key === 'ra-clients-override') setStore(loadEffectiveRaClients());
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const rows = useMemo(() => data.map((r, i) => ({ ...r, id: i })), [data]);
  const columns = useMemo(() => buildColumns(rows), [rows]);
  // Namespace the table by the column-key signature so that uploading a
  // different-shape file doesn't inherit stale hidden-columns state.
  const tableId = useMemo(
    () => 'ra-clients:' + columns.map(c => c.key).sort().join('|'),
    [columns]
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
      // Must have a usable name column
      const first = parsed[0] || {};
      const hasName = Object.keys(first).some(k => {
        const lk = k.trim().toLowerCase();
        return lk === 'client name' || lk === 'mdm name';
      });
      if (!hasName) throw new Error('No "Client Name" (or "MDM Name") column found — required for matching on Portfolio Companies.');
      // Drop fully-empty rows
      const cleaned = parsed.filter(r => raClientName(r));
      if (cleaned.length === 0) throw new Error('All rows are missing a client name.');
      saveRaClientsOverride(cleaned);
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
            title="Replace the RA Clients table by uploading a new Excel file. Must include a 'Client Name' or 'MDM Name' column; include a 'CM' column to auto-fill Client Manager on Portfolio Companies."
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
        key={tableId}
        tableId={tableId}
        columns={columns}
        rows={filtered}
        alwaysVisible={alwaysVisible}
        emptyMessage="No matching RA clients found"
      />
    </div>
  );
}

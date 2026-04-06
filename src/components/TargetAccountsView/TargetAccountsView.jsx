import { useState, useMemo, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { DataTable } from '../common/DataTable';
import styles from './TargetAccountsView.module.css';

function FilterDrop({ label, options, selected, onToggle }) {
  const [open, setOpen] = useState(false);
  const [filterSearch, setFilterSearch] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const count = selected.length;
  const shown = filterSearch.trim() ? options.filter(o => o.toLowerCase().includes(filterSearch.toLowerCase())) : options;
  return (
    <div className={styles.filterGroup} ref={ref}>
      <button className={count > 0 ? styles.filterBtnActive : styles.filterBtn} onClick={() => { setOpen(p => !p); setFilterSearch(''); }}>
        {label}{count > 0 && <span className={styles.filterCount}>{count}</span>}
      </button>
      {open && (
        <div className={styles.filterDropdown}>
          {options.length > 8 && (
            <input className={styles.filterSearch} type="text" placeholder="Search..." value={filterSearch} onChange={e => setFilterSearch(e.target.value)} autoFocus />
          )}
          {shown.length === 0 && <div className={styles.filterEmpty}>No matches</div>}
          {shown.map(opt => (
            <label key={opt} className={styles.filterItem}>
              <input type="checkbox" checked={selected.includes(opt)} onChange={() => onToggle(opt)} style={{ accentColor: 'var(--color-accent)' }} />
              {opt}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

const DB_NAME = 'prospect-tracker-db';
const STORE_NAME = 'target-accounts';
const DB_VERSION = 2;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      if (!db.objectStoreNames.contains('opps-cache')) db.createObjectStore('opps-cache');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadCache() {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get('data');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

async function saveCache(data) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(data, 'data');
  } catch (err) {
    console.error('Failed to save to IndexedDB:', err);
  }
}

// Firestore persistence for target accounts
async function loadFromFirestore(userId) {
  try {
    const ref = doc(db, 'targetAccounts', userId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const raw = snap.data();
      // Data is stored as JSON string to handle large payloads
      if (raw.json) return JSON.parse(raw.json);
      return raw;
    }
  } catch (err) {
    console.error('Failed to load target accounts from Firestore:', err);
  }
  return null;
}

async function saveToFirestore(userId, data) {
  try {
    const ref = doc(db, 'targetAccounts', userId);
    // Store as JSON string to avoid Firestore nested field limits
    await setDoc(ref, { json: JSON.stringify(data), updatedAt: new Date().toISOString() });
    console.log('Target accounts saved to Firestore');
  } catch (err) {
    console.error('Failed to save target accounts to Firestore:', err);
    alert('Failed to save Target Accounts to cloud: ' + err.message);
  }
}

// Load target accounts: try Firestore first, fall back to IndexedDB
export async function loadTargetAccountsFromDB(userId) {
  if (userId) {
    const firestoreData = await loadFromFirestore(userId);
    if (firestoreData) {
      // Also cache in IndexedDB for faster loads
      saveCache(firestoreData);
      return firestoreData;
    }
  }
  // Fall back to IndexedDB
  return loadCache();
}

function InlineEditCell({ value, rowIndex, colKey, onSave }) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  function startEdit() { setEditValue(value || ''); setEditing(true); }
  function save() {
    setEditing(false);
    if (editValue !== (value || '')) onSave(rowIndex, colKey, editValue);
  }

  if (editing) {
    return <input
      style={{ width: '100%', padding: '0.2rem 0.3rem', border: '1px solid var(--color-accent)', borderRadius: '4px', fontSize: 'var(--font-size-sm)', fontFamily: 'inherit' }}
      value={editValue}
      onChange={e => setEditValue(e.target.value)}
      onBlur={save}
      onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
      autoFocus
    />;
  }
  return <span style={{ cursor: 'default', padding: '1px 3px', borderRadius: '4px' }} onDoubleClick={startEdit}>{value || '—'}</span>;
}

export function TargetAccountsView({ onDataLoaded }) {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  const [search, setSearch] = useState('');
  const [activeSheet, setActiveSheet] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [filters, setFilters] = useState({});
  const fileRef = useRef(null);

  // Load from Firestore (then IndexedDB fallback) on mount
  useEffect(() => {
    loadTargetAccountsFromDB(user?.uid).then(cached => {
      if (cached) {
        setData(cached);
        if (onDataLoaded) onDataLoaded(cached);
        if (cached.sheetNames?.length > 0) setActiveSheet(cached.sheetNames[0]);
      }
      setLoading(false);
    });
  }, [user]);

  function processFile(file) {
    if (!file) return;
    setLoading(true);
    setError(null);
    setStatus(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const arrayBuffer = e.target.result;
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });

        const sheets = {};
        for (const sheetName of workbook.SheetNames) {
          const ws = workbook.Sheets[sheetName];
          const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
          if (json.length < 2) continue;

          const headers = json[0].map(h => String(h || '').trim());
          const records = [];
          for (let i = 1; i < json.length; i++) {
            const row = json[i];
            const record = { _id: i };
            let hasData = false;
            for (let j = 0; j < headers.length; j++) {
              const h = headers[j];
              if (!h) continue;
              const val = row[j] != null ? String(row[j]).trim() : '';
              record[h] = val;
              if (val) hasData = true;
            }
            if (hasData) records.push(record);
          }

          if (records.length > 0) {
            sheets[sheetName] = { headers, records };
          }
        }

        const sheetNames = Object.keys(sheets);
        if (sheetNames.length === 0) {
          setError('No data found in the file');
          setLoading(false);
          return;
        }

        const result = {
          fileName: file.name,
          sheets,
          sheetNames,
          uploadedAt: new Date().toISOString(),
        };

        setData(result);
        saveCache(result);
        if (user?.uid) saveToFirestore(user.uid, result);
        if (onDataLoaded) onDataLoaded(result);
        setActiveSheet(sheetNames[0]);
        setStatus(`Uploaded "${file.name}" — ${sheetNames.length} sheet${sheetNames.length > 1 ? 's' : ''}, ${sheetNames.map(n => `${sheets[n].records.length} rows in ${n}`).join(', ')}`);
      } catch (err) {
        setError(`Failed to parse file: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };
    reader.onerror = () => { setError('Failed to read file'); setLoading(false); };
    reader.readAsArrayBuffer(file);
  }

  function handleFileChange(e) {
    processFile(e.target.files?.[0]);
    e.target.value = '';
  }

  function handleCellEdit(rowIndex, colKey, newValue) {
    setData(prev => {
      if (!prev?.sheets || !activeSheet) return prev;
      const sheet = prev.sheets[activeSheet];
      const updated = { ...prev, sheets: { ...prev.sheets, [activeSheet]: { ...sheet, records: sheet.records.map((r, i) => i === rowIndex ? { ...r, [colKey]: newValue } : r) } } };
      saveCache(updated);
      if (user?.uid) saveToFirestore(user.uid, updated);
      if (onDataLoaded) onDataLoaded(updated);
      return updated;
    });
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }

  // Current sheet data
  const currentSheet = data?.sheets?.[activeSheet || data?.sheetNames?.[0]];
  const headers = currentSheet?.headers || [];
  const records = currentSheet?.records || [];

  // Build columns from headers — all cells are editable
  const columns = useMemo(() => {
    const seen = new Set();
    return headers
      .filter(h => { if (!h || seen.has(h)) return false; seen.add(h); return true; })
      .map(h => ({
        key: h,
        label: h,
        defaultWidth: h.length > 25 ? 180 : h.length > 15 ? 140 : 110,
        sticky: h === headers[0],
        render: (row) => <InlineEditCell value={row[h]} rowIndex={row._id - 1} colKey={h} onSave={handleCellEdit} />,
      }));
  }, [headers]);

  // Detect filterable columns (those with <=50 unique non-empty values)
  const filterableColumns = useMemo(() => {
    const result = [];
    for (const h of headers) {
      if (!h) continue;
      const vals = new Set();
      for (const r of records) {
        const v = (r[h] || '').trim();
        if (v && v !== '-' && v !== '#N/A') vals.add(v);
        if (vals.size > 50) break;
      }
      if (vals.size > 1 && vals.size <= 50) {
        result.push({ key: h, options: [...vals].sort() });
      }
    }
    return result;
  }, [headers, records]);

  // Reset filters when sheet changes
  useEffect(() => { setFilters({}); }, [activeSheet]);

  function toggleFilter(key, value) {
    setFilters(prev => {
      const arr = prev[key] || [];
      return { ...prev, [key]: arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value] };
    });
  }

  const activeFilterCount = Object.values(filters).reduce((s, a) => s + a.length, 0);

  // Filtered records
  const filtered = useMemo(() => {
    let result = records;
    // Apply column filters
    for (const [key, values] of Object.entries(filters)) {
      if (values.length > 0) {
        result = result.filter(r => values.includes((r[key] || '').trim()));
      }
    }
    // Apply text search
    if (search.trim()) {
      const term = search.toLowerCase();
      result = result.filter(r =>
        Object.values(r).some(v => v && String(v).toLowerCase().includes(term))
      );
    }
    return result;
  }, [records, search, filters]);

  // Set active sheet on first load
  if (data && !activeSheet && data.sheetNames?.length > 0) {
    setActiveSheet(data.sheetNames[0]);
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Target Accounts List</h2>
          {data?.uploadedAt && (
            <span className={styles.lastUpload}>
              {data.fileName} — uploaded {new Date(data.uploadedAt).toLocaleString()}
            </span>
          )}
        </div>
        <div className={styles.headerActions}>
          <label className={styles.uploadBtn}>
            Upload Excel / CSV
            <input ref={fileRef} className={styles.fileInput} type="file" accept=".xlsx,.xls,.csv,.tsv" onChange={handleFileChange} />
          </label>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {status && <div className={styles.success}>{status}</div>}

      {!data && !loading && (
        <>
          <div
            className={`${styles.dropZone} ${dragOver ? styles.dropZoneActive : ''}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
          >
            <div className={styles.dropTitle}>Drop your Excel or CSV file here</div>
            <div className={styles.dropSub}>or click to browse — supports .xlsx, .xls, .csv</div>
          </div>
          <div style={{ marginTop: '1rem', padding: '1rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px' }}>
            <h3 style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text)', marginTop: 0, marginBottom: '0.5rem' }}>Expected Format</h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)', margin: '0 0 0.5rem 0' }}>
              Your Excel file should have columns matching these names (flexible matching — exact names not required):
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                <thead>
                  <tr style={{ background: '#F8FAFC' }}>
                    <th style={{ padding: '0.4rem 0.6rem', textAlign: 'left', borderBottom: '1px solid var(--color-border)', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Column</th>
                    <th style={{ padding: '0.4rem 0.6rem', textAlign: 'left', borderBottom: '1px solid var(--color-border)', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Required</th>
                    <th style={{ padding: '0.4rem 0.6rem', textAlign: 'left', borderBottom: '1px solid var(--color-border)', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Example Values</th>
                    <th style={{ padding: '0.4rem 0.6rem', textAlign: 'left', borderBottom: '1px solid var(--color-border)', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Matches</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Account / Company Name', 'Yes', 'CBRE, Prologis, Simon Property Group', 'Account, Company, Name, Client'],
                    ['CDM / Salesperson', 'Yes', 'Dan Baldauf', 'CDM, Salesperson, Sales Rep, Account Owner, Rep'],
                    ['Tier', 'Yes', 'Tier 1, Tier 2, 1, 2', 'Tier, Account Tier, Target'],
                  ].map(([col, req, example, matches], i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                      <td style={{ padding: '0.35rem 0.6rem', fontWeight: 600, color: 'var(--color-text)' }}>{col}</td>
                      <td style={{ padding: '0.35rem 0.6rem', color: req === 'Yes' ? '#DC2626' : 'var(--color-text-secondary)', fontWeight: req === 'Yes' ? 600 : 400 }}>{req}</td>
                      <td style={{ padding: '0.35rem 0.6rem', color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>{example}</td>
                      <td style={{ padding: '0.35rem 0.6rem', color: '#6B7280', fontSize: '0.7rem' }}>{matches}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: '0.72rem', color: '#9CA3AF', margin: '0.5rem 0 0 0' }}>
              Additional columns are preserved and displayed. Multiple sheets are supported — each sheet is shown as a separate tab.
            </p>
            <button
              onClick={() => {
                const wb = XLSX.utils.book_new();
                const wsData = [
                  ['Account Name', 'CDM', 'Tier'],
                  ['CBRE', 'Dan Baldauf', 'Tier 1'],
                  ['Prologis', 'Dan Baldauf', 'Tier 1'],
                  ['Simon Property Group', 'Dan Baldauf', 'Tier 2'],
                ];
                const ws = XLSX.utils.aoa_to_sheet(wsData);
                XLSX.utils.book_append_sheet(wb, ws, 'Target Accounts');
                XLSX.writeFile(wb, 'Target_Accounts_Template.xlsx');
              }}
              style={{ marginTop: '0.6rem', padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', borderRadius: '6px', background: 'var(--color-surface)', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-accent)' }}
            >
              Download Template (.xlsx)
            </button>
          </div>
        </>
      )}

      {loading && <div className={styles.loading}>Processing file...</div>}

      {data && data.sheetNames?.length > 1 && (
        <div className={styles.sheetTabs}>
          {data.sheetNames.map(name => (
            <button
              key={name}
              className={activeSheet === name ? styles.sheetTabActive : styles.sheetTab}
              onClick={() => setActiveSheet(name)}
            >
              {name}
              <span className={styles.tabCount}>{data.sheets[name]?.records.length}</span>
            </button>
          ))}
        </div>
      )}

      {data && (
        <>
          <div className={styles.searchRow}>
            <input
              className={styles.searchInput}
              type="text"
              placeholder="Search..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {filterableColumns.map(fc => (
              <FilterDrop key={fc.key} label={fc.key} options={fc.options} selected={filters[fc.key] || []} onToggle={v => toggleFilter(fc.key, v)} />
            ))}
            {activeFilterCount > 0 && <button className={styles.clearBtn} onClick={() => setFilters({})}>Clear all</button>}
            <span className={styles.resultCount}>{filtered.length} of {records.length}</span>
            <label className={styles.uploadBtn} style={{ marginLeft: 'auto', fontSize: 'var(--font-size-xs)', padding: '0.3rem 0.6rem' }}>
              Re-upload
              <input className={styles.fileInput} type="file" accept=".xlsx,.xls,.csv,.tsv" onChange={handleFileChange} />
            </label>
          </div>
          <DataTable
            tableId="target-accounts"
            columns={columns}
            rows={filtered}
            alwaysVisible={[]}
            emptyMessage="No records found"
          />
        </>
      )}
    </div>
  );
}

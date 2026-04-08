import { useState, useEffect, useMemo } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { DataTable } from '../common/DataTable';
import styles from './OppsView.module.css';

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1ee0OREqA25jzDaR6xRDSrj_ZIZDymQjf1k2Z2_ajVKw/export?format=csv&gid=0';
const DB_NAME = 'prospect-tracker-db';
const DB_STORE = 'opps-cache';
const DB_VERSION = 3; // bump version to add clients-cache store

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('target-accounts')) db.createObjectStore('target-accounts');
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      if (!db.objectStoreNames.contains('clients-cache')) db.createObjectStore('clients-cache');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadCacheAsync() {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const store = tx.objectStore(DB_STORE);
      const req = store.get('data');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

async function saveCacheAsync(data) {
  try {
    const db = await openDB();
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(data, 'data');
  } catch (err) {
    console.error('Failed to save opps to IndexedDB:', err);
  }
}

function parseCsv(text) {
  const rows = [];
  let current = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { current.push(field); field = ''; }
      else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
        current.push(field); field = '';
        if (ch === '\r') i++;
        rows.push(current); current = [];
      } else field += ch;
    }
  }
  if (field || current.length > 0) { current.push(field); rows.push(current); }
  return rows;
}

// Key columns to show by default (the rest are available via Columns toggle)
const KEY_COLS = [
  'Account', 'Contact', 'Stage', 'Scope', 'Source', 'Type',
  'Start Date', 'Status', 'Quoted Amount', 'Sites', 'Age',
  'Last Client Heard From Us', 'Follow Up', 'Notes',
  'Competition', 'Waiting On', 'Close Date',
];

// Legacy localStorage fallback for reading old cache
function loadCacheLegacy() {
  try { return JSON.parse(localStorage.getItem('opps-cache')); } catch { return null; }
}

async function loadFromFirestore(userId) {
  try {
    const ref = doc(db, 'oppsData', userId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const raw = snap.data();
      if (raw.json) return JSON.parse(raw.json);
    }
  } catch (err) { console.error('Failed to load opps from Firestore:', err); }
  return null;
}

async function saveToFirestore(userId, data) {
  try {
    const ref = doc(db, 'oppsData', userId);
    await setDoc(ref, { json: JSON.stringify(data), updatedAt: new Date().toISOString() });
  } catch (err) { console.error('Failed to save opps to Firestore:', err); }
}

export function OppsView() {
  const { user } = useAuth();
  const [data, setData] = useState(loadCacheLegacy);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  async function fetchOpps() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(SHEET_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const csvText = await res.text();
      const rows = parseCsv(csvText);
      if (rows.length < 2) throw new Error('No data found');

      const headers = rows[0].map(h => h.trim());
      const records = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const record = { _id: i };
        let hasData = false;
        for (let j = 0; j < headers.length; j++) {
          const h = headers[j];
          if (!h) continue;
          const val = (row[j] || '').trim();
          // For duplicate headers, keep the first non-empty value
          if (record[h] !== undefined && record[h] !== '' && record[h] !== '-' && record[h] !== '#N/A') continue;
          record[h] = val;
          if (val && val !== '-' && val !== '#N/A') hasData = true;
        }
        if (hasData && record['Account']) records.push(record);
      }

      const result = { headers, records, fetchedAt: new Date().toISOString() };
      setData(result);
      saveCacheAsync(result);
      if (user?.uid) saveToFirestore(user.uid, result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Load from Firestore (then IndexedDB fallback) on mount
  useEffect(() => {
    (async () => {
      // Try Firestore first
      if (user?.uid) {
        const firestoreData = await loadFromFirestore(user.uid);
        if (firestoreData) {
          setData(firestoreData);
          saveCacheAsync(firestoreData); // also cache locally
          return;
        }
      }
      // Fall back to IndexedDB
      const cached = await loadCacheAsync();
      if (cached) setData(cached);
    })();
  }, [user]);

  // Read frequency and paused state from sync settings
  function getOppsSettings() {
    try {
      const s = JSON.parse(localStorage.getItem('prospect-sync-settings'));
      return { freq: s?.oppsFreq ?? 5, paused: !!s?.oppsPaused };
    } catch { return { freq: 5, paused: false }; }
  }

  // Auto-fetch on mount if stale
  useEffect(() => {
    const { freq: freqMin, paused } = getOppsSettings();
    if (paused || freqMin === 0) return;
    const staleMs = freqMin * 60 * 1000;
    const isStale = !data?.fetchedAt || (Date.now() - new Date(data.fetchedAt).getTime()) > staleMs;
    if (isStale) fetchOpps();
  }, []);

  // Poll at configured frequency
  useEffect(() => {
    const { freq: freqMin, paused } = getOppsSettings();
    if (paused || freqMin === 0) return;
    const interval = setInterval(fetchOpps, freqMin * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const headers = data?.headers || [];
  const records = data?.records || [];

  // Build columns from headers
  const columns = useMemo(() => {
    const seen = new Set();
    return headers
      .filter(h => {
        if (!h || seen.has(h)) return false;
        seen.add(h);
        return true;
      })
      .map(h => ({
        key: h,
        label: h,
        defaultWidth: h === 'Notes' ? 250 : h === 'Account' ? 200 : h === 'BFO Link' ? 180 : h.length > 20 ? 160 : 120,
        sticky: h === 'Account',
        render: h === 'BFO Link' ? (row) => {
          const url = row[h];
          if (!url || url === '-' || url === '#N/A') return '—';
          return <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-accent)', fontSize: 'var(--font-size-xs)' }}>Open</a>;
        } : undefined,
      }));
  }, [headers]);

  const filtered = useMemo(() => {
    if (!search.trim()) return records;
    const term = search.toLowerCase();
    return records.filter(r =>
      Object.values(r).some(v => v && String(v).toLowerCase().includes(term))
    );
  }, [records, search]);

  // Stage counts for summary
  const stageCounts = useMemo(() => {
    const counts = {};
    for (const r of records) {
      const stage = r['Stage'] || 'Unknown';
      counts[stage] = (counts[stage] || 0) + 1;
    }
    return counts;
  }, [records]);

  const stageOrder = ['Lead', 'Not Started', 'Qualifying', 'Quoting', 'Quoted', 'Verbal', 'Sold', 'Not Sold'];

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Opps</h2>
          {data?.fetchedAt && <span className={styles.lastSync}>Last fetched: {new Date(data.fetchedAt).toLocaleString()}</span>}
        </div>
        <button className={styles.syncBtn} onClick={fetchOpps} disabled={loading}>
          {loading ? 'Fetching...' : 'Refresh'}
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.summary}>
        {stageOrder.filter(s => stageCounts[s]).map(stage => (
          <div key={stage} className={styles.summaryChip}>
            <span className={styles.summaryChipValue}>{stageCounts[stage]}</span>
            <span className={styles.summaryChipLabel}>{stage}</span>
          </div>
        ))}
        {Object.keys(stageCounts).filter(s => !stageOrder.includes(s) && s !== 'Unknown').map(stage => (
          <div key={stage} className={styles.summaryChip}>
            <span className={styles.summaryChipValue}>{stageCounts[stage]}</span>
            <span className={styles.summaryChipLabel}>{stage}</span>
          </div>
        ))}
      </div>

      <div className={styles.searchRow}>
        <input
          className={styles.searchInput}
          type="text"
          placeholder="Search opps..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <span className={styles.resultCount}>{filtered.length} of {records.length}</span>
      </div>

      {loading && !data ? (
        <div className={styles.loading}>Loading from Google Sheets...</div>
      ) : (
        <DataTable
          tableId="opps"
          columns={columns}
          rows={filtered}
          alwaysVisible={['Account']}
          emptyMessage="No opportunities found"
        />
      )}
    </div>
  );
}

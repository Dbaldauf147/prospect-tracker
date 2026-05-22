import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { DataTable } from '../common/DataTable';
import { dbGet, dbPut } from '../../utils/db';
import { OPPS_CACHE_UPDATED_EVENT } from '../../utils/oppsCache';
import styles from './OppsView.module.css';

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1ee0OREqA25jzDaR6xRDSrj_ZIZDymQjf1k2Z2_ajVKw/export?format=csv&gid=0';
const DB_STORE = 'opps-cache';

async function loadCacheAsync() {
  try { return (await dbGet(DB_STORE, 'data')) || null; }
  catch { return null; }
}

async function saveCacheAsync(data) {
  try { await dbPut(DB_STORE, data, 'data'); }
  catch (err) { console.error('Failed to save opps to IndexedDB:', err); }
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

export function OppsView({ settings, updateSettings } = {}) {
  const { user } = useAuth();
  const [data, setData] = useState(loadCacheLegacy);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('opps');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [activityFilter, setActivityFilter] = useState('all');
  // First time the user opens the By Service tab, flip the Show filter to
  // "Active only" since that's the useful default for that view. A ref so
  // we only auto-apply once and don't clobber later deliberate changes.
  const servicesDefaultAppliedRef = useRef(false);
  useEffect(() => {
    if (activeTab === 'services' && !servicesDefaultAppliedRef.current) {
      servicesDefaultAppliedRef.current = true;
      setActivityFilter(prev => (prev === 'all' ? 'active' : prev));
    }
  }, [activeTab]);
  const [hiddenServices, setHiddenServices] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('opps-services-hidden')) || []); }
    catch { return new Set(); }
  });
  const [showHidden, setShowHidden] = useState(false);

  const toggleHideService = useCallback((scope) => {
    setHiddenServices(prev => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope); else next.add(scope);
      localStorage.setItem('opps-services-hidden', JSON.stringify([...next]));
      return next;
    });
  }, []);

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
      // Notify the Opps 2 view (and any other listener) so it can
      // additively merge any new rows from this fetch into its own
      // store. Opps is being phased out in favour of Opps 2 — see
      // src/utils/oppsCache.js.
      try {
        window.dispatchEvent(new CustomEvent(OPPS_CACHE_UPDATED_EVENT, {
          detail: { fetchedAt: result.fetchedAt },
        }));
      } catch { /* ignore */ }
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
  // Ignore any opp row that doesn't have an Open Year value.
  const records = useMemo(() => {
    const raw = data?.records || [];
    return raw.filter(r => {
      const v = String(r['Open Year'] ?? '').trim();
      return v && v !== '-' && v !== '#N/A';
    });
  }, [data]);

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
        label: h === 'BFO Link' ? 'BFO Opportunity Name' : h,
        defaultWidth: h === 'Notes' ? 250 : h === 'Account' ? 200 : h === 'BFO Link' ? 220 : h.length > 20 ? 160 : 120,
        sticky: h === 'Account',
        render: h === 'BFO Link' ? (row) => {
          // Cell stores the BFO Opportunity Name (the column label was
          // renamed but the data key is still "BFO Link"). Render the
          // raw value as text — no hyperlink — so users can read /
          // copy the opportunity name directly.
          const value = row[h];
          if (!value || value === '-' || value === '#N/A') return '—';
          return <span style={{ fontSize: 'var(--font-size-xs)' }}>{value}</span>;
        } : undefined,
      }));
  }, [headers]);

  const stageOrder = ['Lead', 'Not Started', 'Qualifying', 'Quoting', 'Quoted', 'Verbal', 'Sold', 'Not Sold'];
  const CLOSED_STAGES = useMemo(() => new Set(['Sold', 'Not Sold']), []);

  // Unique Status values across all records (for dropdown)
  const statusOptions = useMemo(() => {
    const set = new Set();
    for (const r of records) {
      const v = (r['Status'] || '').trim();
      if (v && v !== '-' && v !== '#N/A') set.add(v);
    }
    return Array.from(set).sort();
  }, [records]);

  // Apply date / status / activity filters (shared by both tabs)
  const prefiltered = useMemo(() => {
    const fromTs = dateFrom ? Date.parse(dateFrom) : null;
    const toTs = dateTo ? Date.parse(dateTo) + 86399999 : null;
    return records.filter(r => {
      // Date range on Start Date
      if (fromTs != null || toTs != null) {
        const raw = r['Start Date'];
        const ts = raw ? Date.parse(raw) : NaN;
        if (isNaN(ts)) return false;
        if (fromTs != null && ts < fromTs) return false;
        if (toTs != null && ts > toTs) return false;
      }
      // Status filter
      if (statusFilter !== 'all' && (r['Status'] || '').trim() !== statusFilter) return false;
      // Active / Closed
      const stage = (r['Stage'] || '').trim();
      if (activityFilter === 'active' && CLOSED_STAGES.has(stage)) return false;
      if (activityFilter === 'closed' && !CLOSED_STAGES.has(stage)) return false;
      return true;
    });
  }, [records, dateFrom, dateTo, statusFilter, activityFilter, CLOSED_STAGES]);

  // Global search across every column on each record — Object.values
  // walks the entire shape, so the user can type any value (Account,
  // Status, Stage, Scope, Notes, BFO Address, etc.) and the row that
  // contains it surfaces. Term is trimmed + lowercased so accidental
  // whitespace and casing don't break matches.
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return prefiltered;
    return prefiltered.filter(r =>
      Object.values(r).some(v => v != null && v !== '' && String(v).toLowerCase().includes(term))
    );
  }, [prefiltered, search]);

  // Stage counts for summary (respects filters)
  const stageCounts = useMemo(() => {
    const counts = {};
    for (const r of prefiltered) {
      const stage = r['Stage'] || 'Unknown';
      counts[stage] = (counts[stage] || 0) + 1;
    }
    return counts;
  }, [prefiltered]);

  // Service (Scope) breakdown: split each opp's Scope by comma and count
  // each individual service. One opp with "A, B, C" contributes 1 to each of A, B, C.
  // Also tracks Sold / Not Sold per service so we can show win rate.
  const serviceBreakdown = useMemo(() => {
    const stats = {}; // scope -> { total, wins, losses }
    const totalOpps = prefiltered.length;
    for (const r of prefiltered) {
      const raw = (r['Scope'] || '').trim();
      const cleaned = raw && raw !== '-' && raw !== '#N/A' ? raw : '';
      const services = cleaned
        ? cleaned.split(',').map(s => s.trim()).filter(Boolean)
        : ['(Unspecified)'];
      const stage = (r['Stage'] || '').trim();
      const isWin = stage === 'Sold';
      const isLoss = stage === 'Not Sold';
      const seen = new Set();
      for (const s of services) {
        if (seen.has(s)) continue;
        seen.add(s);
        if (!stats[s]) stats[s] = { total: 0, wins: 0, losses: 0 };
        stats[s].total += 1;
        if (isWin) stats[s].wins += 1;
        else if (isLoss) stats[s].losses += 1;
      }
    }
    const rows = Object.entries(stats)
      .map(([scope, s]) => {
        const decided = s.wins + s.losses;
        return {
          scope,
          count: s.total,
          wins: s.wins,
          winRate: decided > 0 ? (s.wins / decided) * 100 : null,
          percent: totalOpps > 0 ? (s.total / totalOpps) * 100 : 0,
        };
      })
      .sort((a, b) => b.count - a.count);
    return { rows, total: totalOpps };
  }, [prefiltered]);

  const filtersActive = !!(dateFrom || dateTo || statusFilter !== 'all' || activityFilter !== 'all');
  const clearFilters = () => {
    setDateFrom(''); setDateTo(''); setStatusFilter('all'); setActivityFilter('all');
  };

  const servicesColumns = useMemo(() => [
    { key: 'scope', label: 'Service (Scope)', defaultWidth: 260 },
    {
      key: 'wins',
      label: 'Wins',
      defaultWidth: 90,
      render: (row) => <div style={{ textAlign: 'right' }}>{row.wins}</div>,
    },
    {
      key: 'winRate',
      label: 'Win Rate',
      defaultWidth: 110,
      render: (row) => (
        <div style={{ textAlign: 'right' }}>
          {row.winRate == null ? '—' : `${row.winRate.toFixed(1)}%`}
        </div>
      ),
    },
    {
      key: 'percent',
      label: '% of Total',
      defaultWidth: 220,
      render: (row) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ minWidth: '48px', textAlign: 'right' }}>{row.percent.toFixed(1)}%</span>
          <div className={styles.serviceBar} style={{ flex: 1 }}>
            <div className={styles.serviceBarFill} style={{ width: `${row.percent}%` }} />
          </div>
        </div>
      ),
    },
    {
      key: 'count',
      label: 'Total Opps',
      defaultWidth: 110,
      render: (row) => (
        <div style={{ textAlign: 'right', fontWeight: 600 }}>{row.count}</div>
      ),
    },
    {
      key: '_actions',
      label: '',
      defaultWidth: 90,
      render: (row) => (
        <button
          className={styles.hideServiceBtn}
          onClick={(e) => { e.stopPropagation(); toggleHideService(row.scope); }}
          title={row._hidden ? 'Unhide service' : 'Hide service'}
        >
          {row._hidden ? 'Unhide' : 'Hide'}
        </button>
      ),
    },
  ], [toggleHideService]);

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

      <div className={styles.tabs}>
        <button
          className={activeTab === 'opps' ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab('opps')}
        >Opportunities</button>
        <button
          className={activeTab === 'services' ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab('services')}
        >By Service</button>
      </div>

      <div className={styles.filterRow}>
        <label className={styles.filterLabel}>
          Start Date from
          <input
            type="date"
            className={styles.filterInput}
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
          />
        </label>
        <label className={styles.filterLabel}>
          to
          <input
            type="date"
            className={styles.filterInput}
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
          />
        </label>
        <label className={styles.filterLabel}>
          Status
          <select
            className={styles.filterInput}
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
          >
            <option value="all">All</option>
            {statusOptions.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className={styles.filterLabel}>
          Show
          <select
            className={styles.filterInput}
            value={activityFilter}
            onChange={e => setActivityFilter(e.target.value)}
          >
            <option value="active">Active only</option>
            <option value="closed">Closed only</option>
            <option value="all">All</option>
          </select>
        </label>
        {filtersActive && (
          <button className={styles.clearFiltersBtn} onClick={clearFilters}>Clear filters</button>
        )}
      </div>

      {activeTab === 'opps' ? (
        <>
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
              placeholder="Search across all columns (Account, Stage, Scope, Notes, BFO Address, …)"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <span className={styles.resultCount}>{filtered.length} of {prefiltered.length}{filtersActive && prefiltered.length !== records.length ? ` (filtered from ${records.length})` : ''}</span>
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
              settings={settings}
              updateSettings={updateSettings}
            />
          )}
        </>
      ) : (
        <>
          <div className={styles.searchRow}>
            <span className={styles.resultCount}>
              {(() => {
                const visibleCount = serviceBreakdown.rows.filter(r => showHidden || !hiddenServices.has(r.scope)).length;
                return `${visibleCount} service${visibleCount === 1 ? '' : 's'} · ${serviceBreakdown.total} total opps`;
              })()}
            </span>
            {hiddenServices.size > 0 && (
              <label className={styles.showHiddenLabel}>
                <input
                  type="checkbox"
                  checked={showHidden}
                  onChange={e => setShowHidden(e.target.checked)}
                />
                Show {hiddenServices.size} hidden
              </label>
            )}
          </div>
          <DataTable
            tableId="opps-services"
            columns={servicesColumns}
            rows={serviceBreakdown.rows
              .filter(r => showHidden || !hiddenServices.has(r.scope))
              .map(r => ({ ...r, id: r.scope, _hidden: hiddenServices.has(r.scope) }))}
            alwaysVisible={['scope']}
            rowStyle={(row) => row._hidden ? { opacity: 0.5 } : undefined}
            emptyMessage="No services to display."
            settings={settings}
            updateSettings={updateSettings}
          />
        </>
      )}
    </div>
  );
}

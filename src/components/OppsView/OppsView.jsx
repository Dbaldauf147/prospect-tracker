import { useState, useEffect, useMemo, useCallback } from 'react';
import { DataTable } from '../common/DataTable';
import { dbGet, dbPut } from '../../utils/db';
import { userLsGet } from '../../utils/userLs';
import { readSheetSync } from '../../utils/sheetSyncSettings';
import { getOppsSheetCsvUrl } from '../../utils/oppsSheetUrl';
import { useAuth } from '../../contexts/AuthContext';
import styles from './OppsView.module.css';

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

// Legacy localStorage fallback for reading old cache. Per-user scoped
// so a fresh non-admin doesn't inherit the admin's Opps sheet snapshot.
function loadCacheLegacy() {
  try { return JSON.parse(userLsGet('opps-cache')); } catch { return null; }
}

export function OppsView({ settings, updateSettings } = {}) {
  const { isAdmin } = useAuth();
  const [data, setData] = useState(loadCacheLegacy);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('opps');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [activityFilter, setActivityFilter] = useState('all');
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
    const sheetUrl = getOppsSheetCsvUrl({ isAdmin, settings });
    if (!sheetUrl) {
      setError('No Opps sheet configured. Set settings.oppsSheetUrl to enable.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(sheetUrl);
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
        // Keep every row that has at least one populated cell. The
        // earlier "must have an Account" guard silently dropped sheet
        // rows where the Account column was left blank, which the user
        // could see in the source Google Sheet but not on the Opps tab.
        if (hasData) records.push(record);
      }

      const result = { headers, records, fetchedAt: new Date().toISOString() };
      setData(result);
      saveCacheAsync(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Hydrate from IndexedDB on mount. The legacy Opps tab is just a
  // read-only mirror of a public Google Sheet, so the local cache is
  // enough — the sheet auto-fetch below repopulates if it's stale.
  useEffect(() => {
    (async () => {
      const cached = await loadCacheAsync();
      if (cached) setData(cached);
    })();
  }, []);

  // Read frequency and paused state from the sheet-sync config. It moved
  // from this browser's localStorage onto the settings document, so the
  // schedule set in the Sync Panel is the same one on every computer.
  function getOppsSettings() {
    const s = readSheetSync(settings);
    return { freq: s.oppsFreq ?? 5, paused: !!s.oppsPaused };
  }

  // Auto-fetch on mount if stale. Skip silently when no Opps sheet
  // URL is configured for this user (non-admin without an opts-in).
  useEffect(() => {
    if (!getOppsSheetCsvUrl({ isAdmin, settings })) return;
    const { freq: freqMin, paused } = getOppsSettings();
    if (paused || freqMin === 0) return;
    const staleMs = freqMin * 60 * 1000;
    const isStale = !data?.fetchedAt || (Date.now() - new Date(data.fetchedAt).getTime()) > staleMs;
    if (isStale) fetchOpps();
  }, [isAdmin, settings?.oppsSheetUrl]);

  // Poll at configured frequency
  useEffect(() => {
    if (!getOppsSheetCsvUrl({ isAdmin, settings })) return undefined;
    const { freq: freqMin, paused } = getOppsSettings();
    if (paused || freqMin === 0) return undefined;
    const interval = setInterval(fetchOpps, freqMin * 60 * 1000);
    return () => clearInterval(interval);
  }, [isAdmin, settings?.oppsSheetUrl]);

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
          if (!value || value === '-' || value === '#N/A') return '-';
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

  // Base set for the By Service breakdown. Honors the date + status
  // filters but deliberately IGNORES the active/closed "Show" toggle so
  // the breakdown can always show both Active and Historical side by side.
  const serviceBase = useMemo(() => {
    const fromTs = dateFrom ? Date.parse(dateFrom) : null;
    const toTs = dateTo ? Date.parse(dateTo) + 86399999 : null;
    return records.filter(r => {
      if (fromTs != null || toTs != null) {
        const raw = r['Start Date'];
        const ts = raw ? Date.parse(raw) : NaN;
        if (isNaN(ts)) return false;
        if (fromTs != null && ts < fromTs) return false;
        if (toTs != null && ts > toTs) return false;
      }
      if (statusFilter !== 'all' && (r['Status'] || '').trim() !== statusFilter) return false;
      return true;
    });
  }, [records, dateFrom, dateTo, statusFilter]);

  // Service (Scope) breakdown: split each opp's Scope by comma and count
  // each individual service. One opp with "A, B, C" contributes 1 to each of A, B, C.
  // Each service's opps are split into Active (open) vs Historical (closed:
  // Sold / Not Sold) so both are visible at once; wins / losses come from
  // the historical (closed) opps.
  const serviceBreakdown = useMemo(() => {
    const stats = {}; // scope -> { active, historical, wins, losses }
    const totalOpps = serviceBase.length;
    for (const r of serviceBase) {
      const raw = (r['Scope'] || '').trim();
      const cleaned = raw && raw !== '-' && raw !== '#N/A' ? raw : '';
      const services = cleaned
        ? cleaned.split(',').map(s => s.trim()).filter(Boolean)
        : ['(Unspecified)'];
      const stage = (r['Stage'] || '').trim();
      const isClosed = CLOSED_STAGES.has(stage);
      const isWin = stage === 'Sold';
      const isLoss = stage === 'Not Sold';
      const seen = new Set();
      for (const s of services) {
        if (seen.has(s)) continue;
        seen.add(s);
        if (!stats[s]) stats[s] = { active: 0, historical: 0, wins: 0, losses: 0 };
        if (isClosed) stats[s].historical += 1;
        else stats[s].active += 1;
        if (isWin) stats[s].wins += 1;
        else if (isLoss) stats[s].losses += 1;
      }
    }
    const rows = Object.entries(stats)
      .map(([scope, s]) => {
        const count = s.active + s.historical;
        const decided = s.wins + s.losses;
        return {
          scope,
          active: s.active,
          historical: s.historical,
          count,
          wins: s.wins,
          winRate: decided > 0 ? (s.wins / decided) * 100 : null,
          percent: totalOpps > 0 ? (count / totalOpps) * 100 : 0,
        };
      })
      .sort((a, b) => b.count - a.count);
    return { rows, total: totalOpps };
  }, [serviceBase, CLOSED_STAGES]);

  const filtersActive = !!(dateFrom || dateTo || statusFilter !== 'all' || activityFilter !== 'all');
  const clearFilters = () => {
    setDateFrom(''); setDateTo(''); setStatusFilter('all'); setActivityFilter('all');
  };

  const servicesColumns = useMemo(() => [
    { key: 'scope', label: 'Service (Scope)', defaultWidth: 260 },
    {
      key: 'active',
      label: 'Active',
      defaultWidth: 90,
      render: (row) => <div style={{ textAlign: 'right' }}>{row.active}</div>,
    },
    {
      key: 'historical',
      label: 'Historical',
      defaultWidth: 100,
      render: (row) => <div style={{ textAlign: 'right' }}>{row.historical}</div>,
    },
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
          {row.winRate == null ? '-' : `${row.winRate.toFixed(1)}%`}
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
          <h2 className={styles.title}>Opps - Old</h2>
          {data?.fetchedAt && <span className={styles.lastSync}>Last fetched: {new Date(data.fetchedAt).toLocaleString()}</span>}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className={styles.syncBtn}
            disabled={!filtered?.length}
            title={filtered?.length ? 'Download every visible row with every Google-Sheet column' : 'No rows to export'}
            onClick={async () => {
              // Build the export from the Google Sheet's raw headers +
              // the currently-filtered rows. Skips internal bookkeeping
              // fields (_id) that aren't in the sheet's header set.
              const exportHeaders = (headers || []).filter(Boolean);
              const data = filtered.map(row => {
                const obj = {};
                for (const h of exportHeaders) obj[h] = row[h] ?? '';
                return obj;
              });
              // Pulled in on use — the spreadsheet library is ~140 KB
              // gzipped and this page only needs it to export.
              const XLSX = await import('xlsx');
              const ws = XLSX.utils.json_to_sheet(data, { header: exportHeaders });
              ws['!cols'] = exportHeaders.map(h => ({ wch: Math.max(String(h).length + 2, 14) }));
              const wb = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(wb, ws, 'Opps');
              const stamp = new Date().toISOString().slice(0, 10);
              XLSX.writeFile(wb, `opps-${stamp}.xlsx`);
            }}
          >
            Export to Excel
          </button>
          <button className={styles.syncBtn} onClick={fetchOpps} disabled={loading}>
            {loading ? 'Fetching...' : 'Refresh'}
          </button>
        </div>
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
        {activeTab !== 'services' && (
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
        )}
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

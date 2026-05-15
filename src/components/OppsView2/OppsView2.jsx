import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { DataTable } from '../common/DataTable';
import { dbGet } from '../../utils/db';
import styles from './OppsView2.module.css';

// Second Opps tab — sandbox copy of OppsView. Intentionally NOT wired up
// to Google Sheets, Firestore, IndexedDB, or any shared cache. Starts
// empty so the original Opps tab and this one stay fully isolated while
// the UI is being explored.

// Default column set, seeded so the table has columns to show / sort /
// filter / hide / resize even before any data exists.
const DEFAULT_HEADERS = [
  'Account', 'Open Year', 'Contact', 'Stage', 'Scope', 'Source', 'Type',
  'Start Date', 'Status', 'Quoted Amount', 'Sites', 'Age',
  'Last Client Heard From Us', 'Follow Up', 'Notes',
  'Competition', 'Waiting On', 'Close Date', 'BFO Link',
];

// Key columns to show by default (the rest are available via Columns toggle)
const KEY_COLS = [
  'Account', 'Contact', 'Stage', 'Scope', 'Source', 'Type',
  'Start Date', 'Status', 'Quoted Amount', 'Sites', 'Age',
  'Last Client Heard From Us', 'Follow Up', 'Notes',
  'Competition', 'Waiting On', 'Close Date',
];

// Columns the user wants treated as dates — rendered with a calendar
// popup cell (HTML5 date input) and pre-populated with today on new
// opps so a fresh entry shows useful defaults instead of blanks.
const DATE_COLUMNS = new Set(['Start Date', 'Last Client Heard From Us', 'Follow Up']);

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function makeBlankOpp(id, headers, accountOverride) {
  const row = { _id: id, id }; // id mirrored so DataTable's row key stays stable across edits
  const cols = (Array.isArray(headers) && headers.length) ? headers : DEFAULT_HEADERS;
  for (const h of cols) row[h] = '';
  // Leave Account blank when there's no override so the inline cell
  // autocomplete (fed from Table View companies) starts surfacing
  // matches the moment the user types — instead of having to first
  // clear a placeholder string.
  row['Account'] = typeof accountOverride === 'string' && accountOverride.trim() ? accountOverride.trim() : '';
  row['Open Year'] = String(new Date().getFullYear());
  row['Stage'] = 'Not Started';
  // Default the three date columns the user tracks day-to-day to
  // today's date. Stored as ISO (YYYY-MM-DD) so the HTML5 date input
  // accepts it directly; DateCell displays a localized format.
  const today = todayISO();
  for (const dateCol of DATE_COLUMNS) {
    if (cols.includes(dateCol)) row[dateCol] = today;
  }
  return row;
}

// Header combobox — same prefix-then-substring autocomplete as the
// Account-column EditableCell, but committing a value creates a brand
// new opp pre-filled with that company name instead of mutating a
// single cell. Lets the user surface an existing company by typing a
// few letters; typing something brand-new and pressing Enter still
// works and creates an opp with that new account name.
function AddCompanyCombobox({ suggestions, onCommit, placeholder = 'Add company…' }) {
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const [hoverIdx, setHoverIdx] = useState(0);
  const wrapRef = useRef(null);

  const matches = useMemo(() => {
    if (!suggestions?.length) return [];
    const q = String(draft || '').trim().toLowerCase();
    // No query yet — show the first 8 suggestions alphabetically so
    // the dropdown signals "predictive text is available" as soon as
    // the user clicks into the field.
    if (!q) return suggestions.slice(0, 8);
    const prefix = [];
    const sub = [];
    for (const s of suggestions) {
      const lower = String(s).toLowerCase();
      if (lower === q) continue;
      if (lower.startsWith(q)) prefix.push(s);
      else if (lower.includes(q)) sub.push(s);
      if (prefix.length + sub.length >= 25) break;
    }
    return [...prefix, ...sub].slice(0, 8);
  }, [draft, suggestions]);

  function commit(picked) {
    const v = (picked == null ? draft : picked).trim();
    if (!v) return;
    onCommit(v);
    setDraft('');
    setOpen(false);
    setHoverIdx(0);
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        type="text"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => { setDraft(e.target.value); setOpen(true); setHoverIdx(0); }}
        onFocus={() => { if (draft) setOpen(true); }}
        onBlur={() => {
          requestAnimationFrame(() => {
            if (!wrapRef.current?.contains(document.activeElement)) setOpen(false);
          });
        }}
        onKeyDown={(e) => {
          if (open && matches.length > 0) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHoverIdx(i => (i + 1) % matches.length); return; }
            if (e.key === 'ArrowUp')   { e.preventDefault(); setHoverIdx(i => (i - 1 + matches.length) % matches.length); return; }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              commit(matches[hoverIdx] || matches[0]);
              return;
            }
            if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
          } else if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            setDraft('');
            setOpen(false);
          }
        }}
        style={{
          width: 240,
          padding: '0.4rem 0.6rem',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          fontSize: 'var(--font-size-sm)',
          fontFamily: 'inherit',
          color: 'var(--color-text)',
          background: 'var(--color-bg)',
        }}
      />
      {open && matches.length > 0 && (
        <div
          onMouseDown={(e) => e.preventDefault()}
          style={{
            position: 'absolute', top: '100%', left: 0, minWidth: '100%',
            zIndex: 50, background: '#fff', border: '1px solid var(--color-border)',
            borderRadius: 4, boxShadow: '0 8px 20px rgba(15, 23, 42, 0.12)',
            maxHeight: 240, overflowY: 'auto', fontSize: '0.82rem', marginTop: 2,
          }}
        >
          {matches.map((m, i) => (
            <div
              key={m + i}
              onClick={() => commit(m)}
              onMouseEnter={() => setHoverIdx(i)}
              style={{
                padding: '0.35rem 0.6rem', cursor: 'pointer',
                background: i === hoverIdx ? '#DCFCE7' : 'transparent',
                color: i === hoverIdx ? '#166534' : '#1E293B',
                fontWeight: i === hoverIdx ? 700 : 500,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >{m}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// Click-to-edit cell. Plain text by default; on click flips into an
// input that commits on Enter or blur and reverts on Escape. When
// `suggestions` is provided, the input also shows a prefix-then-
// substring autocomplete dropdown so the user can pick an existing
// company name (used for the Account column on Opps 2).
// Date cell — renders the value as M/D/YYYY for display, and pops a
// native HTML5 date input (calendar) on click so the user can pick a
// new value. Stores the chosen date as ISO (YYYY-MM-DD) so it round-
// trips cleanly through the same `<input type="date">` later.
function toISODate(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s);
  if (isNaN(t)) return '';
  const d = new Date(t);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDateDisplay(raw) {
  const iso = toISODate(raw);
  if (!iso) return String(raw || '');
  // Render as M/D/YYYY without time-zone offset surprises (parse the
  // ISO string in local time, not UTC).
  const [y, m, d] = iso.split('-').map(n => parseInt(n, 10));
  return `${m}/${d}/${y}`;
}

function DateCell({ value, onChange }) {
  const [editing, setEditing] = useState(false);
  const iso = toISODate(value);
  if (!editing) {
    const isEmpty = !value;
    return (
      <span
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        style={{
          display: 'block', cursor: 'pointer', minHeight: '1em',
          padding: '1px 2px',
          color: isEmpty ? 'var(--color-text-muted)' : 'inherit',
        }}
        title="Click to pick a date"
      >
        {isEmpty ? '—' : formatDateDisplay(value)}
      </span>
    );
  }
  return (
    <input
      autoFocus
      type="date"
      value={iso}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => setEditing(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || e.key === 'Enter') {
          e.preventDefault();
          setEditing(false);
        }
      }}
      onClick={(e) => e.stopPropagation()}
      style={{
        width: '100%', boxSizing: 'border-box',
        border: '1px solid var(--color-accent)', borderRadius: 3,
        padding: '1px 4px',
        fontSize: 'inherit', fontFamily: 'inherit', color: 'var(--color-text)',
        background: '#fff',
      }}
    />
  );
}

function EditableCell({ value, onChange, suggestions }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [open, setOpen] = useState(false);
  const [hoverIdx, setHoverIdx] = useState(0);
  const wrapRef = useRef(null);
  useEffect(() => { if (!editing) setDraft(value ?? ''); }, [value, editing]);

  const matches = useMemo(() => {
    if (!suggestions?.length) return [];
    const q = String(draft || '').trim().toLowerCase();
    // No query yet — surface the first 8 suggestions alphabetically
    // so the dropdown shows as soon as the cell is focused, instead
    // of staying invisible until the user starts typing.
    if (!q) return suggestions.slice(0, 8);
    const prefix = [];
    const sub = [];
    for (const s of suggestions) {
      const lower = String(s).toLowerCase();
      if (lower === q) continue;
      if (lower.startsWith(q)) prefix.push(s);
      else if (lower.includes(q)) sub.push(s);
      if (prefix.length + sub.length >= 25) break;
    }
    return [...prefix, ...sub].slice(0, 8);
  }, [draft, suggestions]);

  function commit(next) {
    const v = next == null ? draft : next;
    setEditing(false);
    setOpen(false);
    if ((v ?? '') !== (value ?? '')) onChange(v);
  }

  if (!editing) {
    const isEmpty = value === '' || value == null;
    return (
      <span
        onClick={(e) => { e.stopPropagation(); setEditing(true); setOpen(!!suggestions?.length); }}
        style={{
          display: 'block', cursor: 'text', minHeight: '1em',
          padding: '1px 2px',
          color: isEmpty ? 'var(--color-text-muted)' : 'inherit',
        }}
        title="Click to edit"
      >
        {isEmpty ? '—' : String(value)}
      </span>
    );
  }
  return (
    <div ref={wrapRef} style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
      <input
        autoFocus
        type="text"
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setOpen(true); setHoverIdx(0); }}
        onFocus={() => { if (suggestions?.length) setOpen(true); }}
        onBlur={() => {
          // Defer so a click on a suggestion lands first.
          requestAnimationFrame(() => {
            if (!wrapRef.current?.contains(document.activeElement)) commit();
          });
        }}
        onKeyDown={(e) => {
          if (open && matches.length > 0) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHoverIdx(i => (i + 1) % matches.length); return; }
            if (e.key === 'ArrowUp')   { e.preventDefault(); setHoverIdx(i => (i - 1 + matches.length) % matches.length); return; }
            if (e.key === 'Tab')       { e.preventDefault(); const pick = matches[hoverIdx] || matches[0]; setDraft(pick); commit(pick); return; }
            if (e.key === 'Enter')     { e.preventDefault(); const pick = matches[hoverIdx] || matches[0]; setDraft(pick); commit(pick); return; }
            if (e.key === 'Escape')    { e.preventDefault(); setDraft(value ?? ''); setEditing(false); setOpen(false); return; }
          } else {
            if (e.key === 'Enter')  { e.preventDefault(); e.currentTarget.blur(); }
            if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false); }
          }
        }}
        style={{
          width: '100%', boxSizing: 'border-box',
          border: '1px solid var(--color-accent)', borderRadius: 3,
          padding: '1px 4px',
          fontSize: 'inherit', fontFamily: 'inherit', color: 'var(--color-text)',
          background: '#fff',
        }}
      />
      {open && matches.length > 0 && (
        <div
          onMouseDown={(e) => e.preventDefault()}
          style={{
            position: 'absolute', top: '100%', left: 0, minWidth: '100%',
            zIndex: 50, background: '#fff', border: '1px solid var(--color-border)',
            borderRadius: 4, boxShadow: '0 8px 20px rgba(15, 23, 42, 0.12)',
            maxHeight: 220, overflowY: 'auto', fontSize: '0.78rem',
          }}
        >
          {matches.map((m, i) => (
            <div
              key={m + i}
              onClick={() => { setDraft(m); commit(m); }}
              onMouseEnter={() => setHoverIdx(i)}
              style={{
                padding: '0.3rem 0.55rem', cursor: 'pointer',
                background: i === hoverIdx ? '#DCFCE7' : 'transparent',
                color: i === hoverIdx ? '#166534' : '#1E293B',
                fontWeight: i === hoverIdx ? 700 : 500,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >{m}</div>
          ))}
        </div>
      )}
    </div>
  );
}

export function OppsView2({ settings, updateSettings, prospects = [] } = {}) {
  // Local-only state. No fetch, no cache, no sync.
  const [data, setData] = useState({ headers: DEFAULT_HEADERS, records: [] });
  const [loading] = useState(false);
  const [error] = useState(null);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('opps');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [activityFilter, setActivityFilter] = useState('all');
  const servicesDefaultAppliedRef = useRef(false);
  useEffect(() => {
    if (activeTab === 'services' && !servicesDefaultAppliedRef.current) {
      servicesDefaultAppliedRef.current = true;
      setActivityFilter(prev => (prev === 'all' ? 'active' : prev));
    }
  }, [activeTab]);
  const [hiddenServices, setHiddenServices] = useState(() => new Set());
  const [showHidden, setShowHidden] = useState(false);

  // One-time read of the original Opps tab's IndexedDB cache so the
  // column order here mirrors the live Opps tab exactly. Read-only,
  // no writes, no subscriptions — Opps 2 stays isolated otherwise.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cached = await dbGet('opps-cache', 'data');
        if (cancelled) return;
        const cachedHeaders = cached?.headers;
        if (Array.isArray(cachedHeaders) && cachedHeaders.length > 0) {
          setData(prev => {
            // Only overwrite the seed headers; never replace user-created
            // records or wipe a header set the user already extended.
            const recordsAreSeed = !prev?.records || prev.records.length === 0;
            if (!recordsAreSeed) return prev;
            const seen = new Set();
            const dedup = [];
            for (const h of cachedHeaders) {
              const t = String(h || '').trim();
              if (!t || seen.has(t)) continue;
              seen.add(t);
              dedup.push(t);
            }
            return { ...prev, headers: dedup };
          });
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  const addNewOpp = useCallback((accountName) => {
    setData(prev => {
      const records = prev?.records || [];
      const headers = prev?.headers?.length ? prev.headers : DEFAULT_HEADERS;
      const nextId = records.reduce((m, r) => Math.max(m, r._id || 0), 0) + 1;
      return { ...prev, headers, records: [makeBlankOpp(nextId, headers, accountName), ...records] };
    });
  }, []);

  const updateOppField = useCallback((id, field, value) => {
    setData(prev => {
      const records = prev?.records || [];
      return {
        ...prev,
        records: records.map(r => r._id === id ? { ...r, [field]: value } : r),
      };
    });
  }, []);

  const toggleHideService = useCallback((scope) => {
    setHiddenServices(prev => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope); else next.add(scope);
      return next;
    });
  }, []);

  const headers = data?.headers || [];
  const records = useMemo(() => {
    const raw = data?.records || [];
    return raw.filter(r => {
      const v = String(r['Open Year'] ?? '').trim();
      return v && v !== '-' && v !== '#N/A';
    });
  }, [data]);

  // Sorted, deduped list of company names — fed into the Account
  // column's autocomplete. Pulls from Table View prospects first
  // (the user's authoritative customer list); also folds in any
  // Account names already present in this tab's opps so adding a
  // follow-up opp for an existing account still autocompletes even
  // when the Table View hasn't loaded.
  const companySuggestions = useMemo(() => {
    const seen = new Set();
    const out = [];
    const push = (name) => {
      const c = String(name || '').trim();
      if (!c) return;
      const k = c.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push(c);
    };
    for (const p of (prospects || [])) push(p?.company);
    for (const r of (data?.records || [])) push(r?.Account);
    out.sort((a, b) => a.localeCompare(b));
    return out;
  }, [prospects, data?.records]);

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
        // Every cell is click-to-edit so a freshly created opp can be
        // filled in directly. getFilterValue exposes the raw text to
        // the per-column filter so search keeps working on the value
        // the user sees, not the rendered <input>.
        getFilterValue: (row) => row[h] ?? '',
        render: (row) => (
          DATE_COLUMNS.has(h)
            ? <DateCell value={row[h]} onChange={(v) => updateOppField(row._id, h, v)} />
            : <EditableCell
                value={row[h]}
                onChange={(v) => updateOppField(row._id, h, v)}
                suggestions={h === 'Account' ? companySuggestions : undefined}
              />
        ),
      }));
  }, [headers, updateOppField, companySuggestions]);

  const stageOrder = ['Lead', 'Not Started', 'Qualifying', 'Quoting', 'Quoted', 'Verbal', 'Sold', 'Not Sold'];
  const CLOSED_STAGES = useMemo(() => new Set(['Sold', 'Not Sold']), []);

  const statusOptions = useMemo(() => {
    const set = new Set();
    for (const r of records) {
      const v = (r['Status'] || '').trim();
      if (v && v !== '-' && v !== '#N/A') set.add(v);
    }
    return Array.from(set).sort();
  }, [records]);

  const prefiltered = useMemo(() => {
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
      const stage = (r['Stage'] || '').trim();
      if (activityFilter === 'active' && CLOSED_STAGES.has(stage)) return false;
      if (activityFilter === 'closed' && !CLOSED_STAGES.has(stage)) return false;
      return true;
    });
  }, [records, dateFrom, dateTo, statusFilter, activityFilter, CLOSED_STAGES]);

  const filtered = useMemo(() => {
    if (!search.trim()) return prefiltered;
    const term = search.toLowerCase();
    return prefiltered.filter(r =>
      Object.values(r).some(v => v && String(v).toLowerCase().includes(term))
    );
  }, [prefiltered, search]);

  const stageCounts = useMemo(() => {
    const counts = {};
    for (const r of prefiltered) {
      const stage = r['Stage'] || 'Unknown';
      counts[stage] = (counts[stage] || 0) + 1;
    }
    return counts;
  }, [prefiltered]);

  const serviceBreakdown = useMemo(() => {
    const stats = {};
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
          <h2 className={styles.title}>Opps 2</h2>
          <span className={styles.lastSync}>Sandbox copy — not connected to any data source</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <AddCompanyCombobox
            suggestions={companySuggestions}
            onCommit={(name) => addNewOpp(name)}
          />
          <button className={styles.syncBtn} onClick={() => addNewOpp()}>+ New Opp</button>
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
              placeholder="Search opps..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <span className={styles.resultCount}>{filtered.length} of {prefiltered.length}{filtersActive && prefiltered.length !== records.length ? ` (filtered from ${records.length})` : ''}</span>
          </div>

          {loading && !data ? (
            <div className={styles.loading}>Loading...</div>
          ) : (
            <DataTable
              tableId="opps2"
              columns={columns}
              rows={filtered}
              alwaysVisible={['Account']}
              enableColumnFilters
              emptyMessage="No opps yet — click + New Opp to create one."
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
            tableId="opps2-services"
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

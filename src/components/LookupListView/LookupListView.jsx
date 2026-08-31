import { useState, useEffect, useMemo, useRef } from 'react';
import { DataTable } from '../common/DataTable';
import {
  saveList as saveListToIDB,
  loadList as loadListFromIDB,
  clearList as clearListFromIDB,
} from '../../utils/uploadedListStore';
import { parseBestSheet } from '../../utils/xlsxParse';
import styles from './LookupListView.module.css';

const CORP_SUFFIXES = /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|lp|llp|sa|ag|gmbh|nv|bv|oy|ab|spa|kk|pty|holdings|group|grp)\b\.?/g;
function normalizeCompany(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(CORP_SUFFIXES, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickNameKey(headers) {
  const key = headers.find(k => /company|name|organi[sz]ation|signatory|entity|\bfirm\b/i.test(k));
  return key || headers[0];
}

// Returns a lookup of normalizedName -> uploadedRow, plus an index of
// normalized names for substring-fallback matching. Keeps the match
// pass O(prospects + rows) rather than O(prospects * rows) — that's
// the difference between responsive and frozen for a 20k+ list.
function buildLookup(rows) {
  const byNorm = new Map();
  const norms = [];
  if (!rows?.length) return { byNorm, norms, nameKey: '' };
  const headers = Object.keys(rows[0]);
  const nameKey = pickNameKey(headers);
  for (const row of rows) {
    const raw = String(row[nameKey] || '').trim();
    if (!raw) continue;
    const norm = normalizeCompany(raw);
    if (!norm) continue;
    if (!byNorm.has(norm)) byNorm.set(norm, row);
    norms.push({ norm, row });
  }
  return { byNorm, norms, nameKey };
}

function findMatch(companyName, lookup) {
  const norm = normalizeCompany(companyName);
  if (!norm) return null;
  const exact = lookup.byNorm.get(norm);
  if (exact) return exact;
  let best = null;
  for (const { norm: ln, row } of lookup.norms) {
    if (ln === norm) return row;
    if (ln.length < 3) continue;
    if (norm.includes(ln) || ln.includes(norm)) {
      if (!best || ln.length < best.ln.length) best = { ln, row };
    }
  }
  return best?.row || null;
}

export function LookupListView({
  storageKey,
  tableIdPrefix,
  title,
  singular = 'company',
  plural = 'companies',
  prospects = [],
  onSelectProspect,
  // Columns from the uploaded list to surface on the match row. If
  // empty, we show the first 4 non-name columns.
  previewColumns,
}) {
  const [store, setStore] = useState({ data: [], source: 'empty' });
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState('all'); // 'all' | 'matched' | 'unmatched'
  const [scopeMode, setScopeMode] = useState('myAccounts'); // 'myAccounts' | 'all'
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loadedData = await loadListFromIDB(storageKey);
      if (cancelled) return;
      const arr = Array.isArray(loadedData) ? loadedData : [];
      setStore(arr.length > 0 ? { data: arr, source: 'override' } : { data: [], source: 'empty' });
      setLoaded(true);
    })();
    setSearch('');
    setFilterMode('all');
    setUploadError('');
    return () => { cancelled = true; };
  }, [storageKey]);

  const lookup = useMemo(() => buildLookup(store.data), [store.data]);

  // Scope: My Accounts (Dan Baldauf's CDM) or everyone in the Table
  // View. Default to My Accounts since that's where the user spends
  // most of their attention.
  const scopedProspects = useMemo(() => {
    if (scopeMode === 'all') return prospects;
    return prospects.filter(p => (p.cdm || '').toLowerCase().includes('baldauf'));
  }, [prospects, scopeMode]);

  const rows = useMemo(() => {
    return scopedProspects.map(p => {
      const match = findMatch(p.company, lookup);
      return { ...p, __match__: match, __matched__: !!match };
    });
  }, [scopedProspects, lookup]);

  const filtered = useMemo(() => {
    let out = rows;
    if (filterMode === 'matched') out = out.filter(r => r.__matched__);
    else if (filterMode === 'unmatched') out = out.filter(r => !r.__matched__);
    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter(r => {
        if (String(r.company || '').toLowerCase().includes(q)) return true;
        if (r.__match__) {
          return Object.values(r.__match__).some(v => String(v).toLowerCase().includes(q));
        }
        return false;
      });
    }
    return out;
  }, [rows, filterMode, search]);

  const matchStats = useMemo(() => {
    let matched = 0;
    for (const r of rows) if (r.__matched__) matched++;
    return { matched, total: rows.length };
  }, [rows]);

  const previewKeys = useMemo(() => {
    if (!lookup.norms.length) return [];
    const sampleRow = lookup.norms[0].row;
    const allKeys = Object.keys(sampleRow).filter(k => k !== lookup.nameKey);
    if (previewColumns && previewColumns.length) {
      // Case-insensitive match, preserve the configured order, and drop
      // anything that's not actually in the file.
      const lowerKeys = new Map(allKeys.map(k => [k.toLowerCase(), k]));
      return previewColumns
        .map(c => lowerKeys.get(c.toLowerCase()))
        .filter(Boolean);
    }
    return allKeys.slice(0, 4);
  }, [lookup, previewColumns]);

  const columns = useMemo(() => {
    const base = [
      {
        key: 'company',
        label: 'Company',
        defaultWidth: 220,
        sticky: true,
        render: (row) => (
          <span
            style={{ fontWeight: 600, color: 'var(--color-text)', cursor: onSelectProspect ? 'pointer' : 'default' }}
            onClick={(e) => { if (onSelectProspect) { e.stopPropagation(); onSelectProspect(row); } }}
          >{row.company}</span>
        ),
      },
      {
        key: 'tier',
        label: 'Tier',
        defaultWidth: 90,
        render: (row) => row.tier
          ? <span style={{ fontSize: '0.7rem', fontWeight: 600, color: row.tier === 'Tier 1' ? '#991B1B' : row.tier === 'Tier 2' ? '#1E3A8A' : '#475569' }}>{row.tier}</span>
          : <span style={{ color: 'var(--color-text-muted)' }}>-</span>,
      },
      {
        key: 'status',
        label: 'Status',
        defaultWidth: 120,
        render: (row) => row.status || <span style={{ color: 'var(--color-text-muted)' }}>-</span>,
      },
      {
        key: 'cdm',
        label: 'CDM',
        defaultWidth: 120,
        render: (row) => row.cdm || <span style={{ color: 'var(--color-text-muted)' }}>-</span>,
      },
      {
        key: '__matchIndicator__',
        label: `On ${title}?`,
        defaultWidth: 90,
        render: (row) => row.__matched__
          ? <span style={{ background: '#DCFCE7', border: '1px solid #86EFAC', color: '#166534', fontWeight: 700, fontSize: '0.7rem', padding: '1px 8px', borderRadius: 999 }}>✓ Yes</span>
          : <span style={{ color: 'var(--color-text-muted)', fontSize: '0.72rem' }}>-</span>,
      },
    ];
    const extras = previewKeys.map(k => ({
      key: `__preview_${k}__`,
      label: k,
      defaultWidth: 160,
      render: (row) => {
        if (!row.__match__) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.72rem' }}>-</span>;
        const val = row.__match__[k];
        if (val == null || val === '') return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.72rem' }}>-</span>;
        return <span style={{ fontSize: '0.72rem' }}>{String(val)}</span>;
      },
    }));
    return [...base, ...extras];
  }, [previewKeys, title, onSelectProspect]);

  const alwaysVisible = useMemo(() => ['company', '__matchIndicator__'], []);
  // Per lookup list, but no longer per column lineup — see the note on
  // DealsView's tableId.
  const tableId = `${tableIdPrefix}:lookup`;

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadError('');
    try {
      const buf = await file.arrayBuffer();
      const { rows: parsed } = parseBestSheet(new Uint8Array(buf));
      await saveListToIDB(storageKey, parsed);
      setStore({ data: parsed, source: 'override' });
    } catch (err) {
      const msg = err?.name === 'QuotaExceededError'
        ? 'Upload exceeded the browser storage quota. Try a smaller file or trim unused columns.'
        : (err?.message || 'Failed to read file');
      setUploadError(msg);
    }
  }

  async function handleRevert() {
    if (!window.confirm(`Remove the uploaded ${title} list?`)) return;
    await clearListFromIDB(storageKey);
    setStore({ data: [], source: 'empty' });
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{title}</h1>
          <div className={styles.subtitle}>
            {store.data.length > 0
              ? `${store.data.length.toLocaleString()} ${store.data.length === 1 ? singular : plural} in uploaded ${title} list`
              : `No ${title} list loaded`}
            {store.data.length > 0 && (
              <> · Checking <strong>{matchStats.total}</strong> {scopeMode === 'myAccounts' ? 'My Accounts' : 'prospects'}
              {' '}· <strong style={{ color: '#166534' }}>{matchStats.matched}</strong> on {title}</>
            )}
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
            title={`Upload an Excel file with the ${title} ${plural}. The file is stored locally; we only use it to look up your accounts.`}
            style={{ padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', background: '#fff', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            {store.data.length > 0 ? `Replace ${title} list` : `Upload ${title} list`}
          </button>
          {store.source === 'override' && (
            <button
              type="button"
              onClick={handleRevert}
              title={`Remove the uploaded ${title} list`}
              style={{ padding: '0.4rem 0.8rem', border: '1px solid #FCA5A5', background: '#fff', color: '#DC2626', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
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

      <div className={styles.filterRow}>
        <input
          className={styles.searchInput}
          type="text"
          placeholder={`Search your accounts or ${title} data…`}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className={styles.toggleGroup}>
          {[
            { v: 'myAccounts', label: 'My Accounts' },
            { v: 'all', label: 'All prospects' },
          ].map(opt => (
            <button
              key={opt.v}
              type="button"
              onClick={() => setScopeMode(opt.v)}
              className={scopeMode === opt.v ? styles.toggleActive : styles.toggle}
            >{opt.label}</button>
          ))}
        </div>
        <div className={styles.toggleGroup}>
          {[
            { v: 'all', label: 'All' },
            { v: 'matched', label: `On ${title}` },
            { v: 'unmatched', label: 'Not on list' },
          ].map(opt => (
            <button
              key={opt.v}
              type="button"
              onClick={() => setFilterMode(opt.v)}
              className={filterMode === opt.v ? styles.toggleActive : styles.toggle}
            >{opt.label}</button>
          ))}
        </div>
        <span className={styles.resultCount}>{filtered.length} shown</span>
      </div>

      {!loaded ? (
        <div style={{ padding: '2rem 1.25rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
          Loading…
        </div>
      ) : store.data.length === 0 ? (
        <div style={{ padding: '2rem 1.25rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
          No {title} list loaded. Click <strong>Upload {title} list</strong> to check your accounts against it.
        </div>
      ) : (
        <DataTable
          key={tableId}
          tableId={tableId}
          // tableId is the prefix plus every column key — not a file name.
          exportFileName={`${title} export`}
          columns={columns}
          rows={filtered}
          alwaysVisible={alwaysVisible}
          emptyMessage="No matching rows"
        />
      )}
    </div>
  );
}

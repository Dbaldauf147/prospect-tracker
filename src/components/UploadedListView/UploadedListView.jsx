import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import { DataTable } from '../common/DataTable';
import { saveList as saveListToIDB, loadList as loadListFromIDB, clearList as clearListFromIDB } from '../../utils/uploadedListStore';
import styles from './UploadedListView.module.css';

function loadMapping(key) {
  if (!key) return {};
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) || {}) : {};
  } catch { return {}; }
}

// Normalize a company name for fuzzy matching:
// lowercase, strip accents, drop punctuation, collapse whitespace, drop
// common corporate suffixes. Two names that normalize to the same token
// are treated as the same company.
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
  const key = headers.find(k => /company|name|organi[sz]ation|signatory|entity/i.test(k));
  return key || headers[0];
}

function buildColumns(data, prospectsByNorm, prospectSuggestionFor, myAccountSuggestionFor, mapping, dismissed, onPick, onDismiss) {
  if (!data.length) return [];
  const keys = new Set();
  for (const row of data) for (const k of Object.keys(row)) if (k !== 'id' && k !== '__matchKey__') keys.add(k);
  const baseCols = [...keys].map((k, i) => ({
    key: k,
    label: k,
    defaultWidth: i === 0 ? 240 : 140,
    ...(i === 0 ? { sticky: true } : {}),
  }));
  const myAccountsCol = {
    key: '__myAccountsList__',
    label: 'My Accounts',
    defaultWidth: 200,
    render: (row) => {
      const suggestion = myAccountSuggestionFor(row.__rawName__ || '');
      if (!suggestion) {
        return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.72rem' }}>—</span>;
      }
      return (
        <span
          style={{ display: 'inline-block', background: '#DBEAFE', border: '1px solid #93C5FD', borderRadius: 999, padding: '1px 8px', fontSize: '0.7rem', color: '#1E3A8A', fontWeight: 600, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          title={`Matches "${suggestion.company}" on My Accounts`}
        >★ {suggestion.company}</span>
      );
    },
  };
  const matchCol = {
    key: '__myAccount__',
    label: 'Table View Mapping',
    defaultWidth: 240,
    render: (row) => {
      const matchKey = row.__matchKey__;
      const confirmed = mapping[matchKey];
      const prospect = confirmed
        ? prospectsByNorm.get(normalizeCompany(confirmed))
        : null;
      const handleClick = (e) => onPick(row, e.currentTarget);
      if (prospect) {
        return (
          <button
            type="button"
            onClick={handleClick}
            style={{ background: '#DCFCE7', border: '1px solid #86EFAC', borderRadius: 999, padding: '1px 8px', fontSize: '0.7rem', color: '#166534', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title="Mapped to a Table View prospect · click to change"
          >✓ {prospect.company}</button>
        );
      }
      const isDismissed = dismissed[matchKey];
      if (!isDismissed) {
        const suggestion = prospectSuggestionFor(row.__rawName__ || '');
        if (suggestion) {
          return (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, maxWidth: '100%' }}>
              <button
                type="button"
                onClick={handleClick}
                style={{ background: '#FEF3C7', border: '1px dashed #F59E0B', borderRadius: 999, padding: '1px 8px', fontSize: '0.7rem', color: '#92400E', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', maxWidth: 'calc(100% - 20px)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title="Suggested Table View match · click to confirm or pick a different prospect"
              >? {suggestion.company}</button>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onDismiss(matchKey); }}
                title="Dismiss this suggestion"
                style={{ background: 'transparent', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: '0.85rem', lineHeight: 1, padding: '0 4px' }}
                onMouseEnter={e => e.currentTarget.style.color = '#DC2626'}
                onMouseLeave={e => e.currentTarget.style.color = '#94A3B8'}
              >×</button>
            </span>
          );
        }
      }
      return (
        <button
          type="button"
          onClick={handleClick}
          style={{ background: 'transparent', border: '1px dashed #CBD5E1', borderRadius: 999, padding: '1px 8px', fontSize: '0.7rem', color: '#64748B', fontWeight: 400, cursor: 'pointer', fontFamily: 'inherit' }}
          title="Click to map to a Table View prospect"
        >— Map —</button>
      );
    },
  };
  return [...baseCols, myAccountsCol, matchCol];
}

export function UploadedListView({
  storageKey,
  title,
  tableIdPrefix,
  singular = 'entry',
  plural = 'entries',
  prospects = [],
  onSelectProspect,
}) {
  const [store, setStore] = useState({ data: [], source: 'empty' });
  const mappingKey = storageKey ? `${storageKey}:account-mapping` : '';
  const dismissedKey = storageKey ? `${storageKey}:account-dismissed` : '';
  const [mapping, setMapping] = useState(() => loadMapping(mappingKey));
  const [dismissed, setDismissed] = useState(() => loadMapping(dismissedKey));
  const [search, setSearch] = useState('');
  const [suggestedOnly, setSuggestedOnly] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [picker, setPicker] = useState(null); // { matchKey, raw, query }
  const fileInputRef = useRef(null);
  const { data, source } = store;

  // Load list from IDB whenever the tab (storageKey) changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await loadListFromIDB(storageKey);
      if (!cancelled) {
        setStore(Array.isArray(loaded) && loaded.length > 0
          ? { data: loaded, source: 'override' }
          : { data: [], source: 'empty' });
      }
    })();
    setMapping(loadMapping(`${storageKey}:account-mapping`));
    setDismissed(loadMapping(`${storageKey}:account-dismissed`));
    setSearch('');
    setSuggestedOnly(false);
    setUploadError(null);
    setPicker(null);
    return () => { cancelled = true; };
  }, [storageKey]);

  // Cross-tab sync is limited to the mapping + dismissed set
  // (localStorage). The list itself is in IDB so storage events don't
  // fire — that's fine, user re-uploads from the current tab anyway.
  useEffect(() => {
    function onStorage(e) {
      if (e.key === mappingKey) setMapping(loadMapping(mappingKey));
      if (e.key === dismissedKey) setDismissed(loadMapping(dismissedKey));
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [mappingKey, dismissedKey]);

  // Persist mapping + dismissed set back to localStorage whenever
  // either changes.
  useEffect(() => {
    if (!mappingKey) return;
    try {
      if (Object.keys(mapping).length === 0) localStorage.removeItem(mappingKey);
      else localStorage.setItem(mappingKey, JSON.stringify(mapping));
    } catch {}
  }, [mapping, mappingKey]);
  useEffect(() => {
    if (!dismissedKey) return;
    try {
      if (Object.keys(dismissed).length === 0) localStorage.removeItem(dismissedKey);
      else localStorage.setItem(dismissedKey, JSON.stringify(dismissed));
    } catch {}
  }, [dismissed, dismissedKey]);

  // Close the picker dropdown when clicking outside it.
  useEffect(() => {
    if (!picker) return;
    function onDocClick(e) {
      if (e.target.closest('[data-picker="my-account"]')) return;
      // Any click on a different "My Account" cell button replaces this
      // picker rather than just closing it — letting the button handler
      // run is fine, openPicker will set new state.
      if (e.target.closest('button[title*="Table View"], button[title*="prospect"], button[title*="map to a Table View"]')) return;
      setPicker(null);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [picker]);

  // Build normalized prospect lookup + a list of normalized names for
  // substring fallbacks. Keeps the matching O(rows + prospects) rather
  // than O(rows * prospects).
  const { prospectsByNorm, prospectNorms } = useMemo(() => {
    const byNorm = new Map();
    const norms = [];
    for (const p of prospects) {
      const name = (p.company || '').trim();
      if (!name) continue;
      const norm = normalizeCompany(name);
      if (!norm) continue;
      if (!byNorm.has(norm)) byNorm.set(norm, p);
      norms.push({ norm, prospect: p });
    }
    return { prospectsByNorm: byNorm, prospectNorms: norms };
  }, [prospects]);

  // Restrict to Dan Baldauf's accounts — this is the ~100 companies that
  // appear on the My Accounts tab.
  const { myAccountsByNorm, myAccountNorms } = useMemo(() => {
    const byNorm = new Map();
    const norms = [];
    for (const p of prospects) {
      if (!(p.cdm || '').toLowerCase().includes('baldauf')) continue;
      const name = (p.company || '').trim();
      if (!name) continue;
      const norm = normalizeCompany(name);
      if (!norm) continue;
      if (!byNorm.has(norm)) byNorm.set(norm, p);
      norms.push({ norm, prospect: p });
    }
    return { myAccountsByNorm: byNorm, myAccountNorms: norms };
  }, [prospects]);

  function suggestFrom(raw, byNorm, norms) {
    const norm = normalizeCompany(raw);
    if (!norm) return null;
    const exact = byNorm.get(norm);
    if (exact) return exact;
    let best = null;
    for (const { norm: pn, prospect } of norms) {
      if (pn === norm) return prospect;
      if (pn.length < 3) continue;
      if (norm.includes(pn) || pn.includes(norm)) {
        if (!best || pn.length < best.pn.length) best = { pn, prospect };
      }
    }
    return best?.prospect || null;
  }

  const prospectSuggestionFor = useMemo(
    () => (raw) => suggestFrom(raw, prospectsByNorm, prospectNorms),
    [prospectsByNorm, prospectNorms]
  );

  const myAccountSuggestionFor = useMemo(
    () => (raw) => suggestFrom(raw, myAccountsByNorm, myAccountNorms),
    [myAccountsByNorm, myAccountNorms]
  );

  const rows = useMemo(() => {
    if (!data.length) return [];
    const headers = [];
    const seen = new Set();
    for (const row of data) for (const k of Object.keys(row)) {
      if (!seen.has(k)) { seen.add(k); headers.push(k); }
    }
    const nameKey = pickNameKey(headers);
    return data.map((r, i) => {
      const rawName = nameKey ? String(r[nameKey] || '') : '';
      // Match key is the normalized company name — survives a re-upload
      // with different row ordering or added/removed rows. Falls back
      // to the row index when we can't extract a name so each row is
      // still unique.
      const norm = normalizeCompany(rawName);
      const matchKey = norm ? `name::${norm}` : `row::${i}`;
      return { ...r, id: i, __rawName__: rawName, __matchKey__: matchKey };
    });
  }, [data]);

  function openPicker(row, anchorEl) {
    const rect = anchorEl?.getBoundingClientRect?.();
    const width = 320;
    const pos = rect
      ? {
          top: Math.min(rect.bottom + 4, window.innerHeight - 380),
          left: Math.min(rect.left, window.innerWidth - width - 8),
        }
      : { top: 80, left: 80 };
    setPicker({ matchKey: row.__matchKey__, raw: row.__rawName__ || '', query: '', pos, width });
  }
  function confirmMapping(matchKey, prospectCompany) {
    setMapping(prev => ({ ...prev, [matchKey]: prospectCompany }));
    // Confirming implicitly un-dismisses, so switching accounts later
    // still shows suggestions.
    setDismissed(prev => {
      if (!prev[matchKey]) return prev;
      const next = { ...prev };
      delete next[matchKey];
      return next;
    });
    setPicker(null);
  }
  function clearMapping(matchKey) {
    setMapping(prev => {
      const next = { ...prev };
      delete next[matchKey];
      return next;
    });
    setPicker(null);
  }
  function dismissSuggestion(matchKey) {
    setDismissed(prev => ({ ...prev, [matchKey]: true }));
  }

  const columns = useMemo(
    () => buildColumns(rows, prospectsByNorm, prospectSuggestionFor, myAccountSuggestionFor, mapping, dismissed, openPicker, dismissSuggestion),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, prospectsByNorm, prospectSuggestionFor, myAccountSuggestionFor, mapping, dismissed]
  );
  const tableId = useMemo(
    () => `${tableIdPrefix}:` + columns.map(c => c.key).sort().join('|'),
    [columns, tableIdPrefix]
  );
  const alwaysVisible = useMemo(() => {
    const first = columns[0];
    const keys = [];
    if (first) keys.push(first.key);
    for (const c of columns) {
      if (c.key === '__myAccountsList__' || c.key === '__myAccount__') keys.push(c.key);
    }
    return keys;
  }, [columns]);

  const filtered = useMemo(() => {
    let result = rows;
    if (search.trim()) {
      const term = search.toLowerCase();
      result = result.filter(r =>
        Object.entries(r).some(([k, v]) => k !== '__matchKey__' && String(v).toLowerCase().includes(term))
      );
    }
    if (suggestedOnly) {
      result = result.filter(r => !!myAccountSuggestionFor(r.__rawName__ || ''));
    }
    return result;
  }, [search, suggestedOnly, rows, myAccountSuggestionFor]);

  const myAccountsMatchCount = useMemo(
    () => rows.reduce((n, r) => n + (myAccountSuggestionFor(r.__rawName__ || '') ? 1 : 0), 0),
    [rows, myAccountSuggestionFor]
  );

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

  const matchStats = useMemo(() => {
    // Only count mappings whose row is actually in the current list —
    // an older mapping for a company that's no longer uploaded should
    // still be preserved in storage but doesn't belong in the count.
    let confirmed = 0;
    let suggested = 0;
    for (const r of rows) {
      if (mapping[r.__matchKey__]) { confirmed++; continue; }
      if (dismissed[r.__matchKey__]) continue;
      if (r.__rawName__ && prospectSuggestionFor(r.__rawName__)) suggested++;
    }
    return { confirmed, suggested };
  }, [rows, mapping, dismissed, prospectSuggestionFor]);

  // Picker search results — top 30 prospects matching the query, or the
  // auto-suggestion + first 30 prospects when the query is empty.
  const pickerResults = useMemo(() => {
    if (!picker) return [];
    const q = (picker.query || '').toLowerCase().trim();
    const auto = picker.raw ? prospectSuggestionFor(picker.raw) : null;
    const list = prospects.filter(p => p.company && (!q || p.company.toLowerCase().includes(q)));
    list.sort((a, b) => a.company.localeCompare(b.company));
    const out = [];
    const seen = new Set();
    if (auto && !q) { out.push(auto); seen.add(auto.id); }
    for (const p of list) {
      if (seen.has(p.id)) continue;
      out.push(p);
      seen.add(p.id);
      if (out.length >= 30) break;
    }
    return out;
  }, [picker, prospects, prospectSuggestionFor]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{title}</h1>
          <div className={styles.subtitle}>
            {rows.length} {rows.length === 1 ? singular : plural}{source === 'override' ? ' · uploaded list active' : ''}
            {rows.length > 0 && (
              <span style={{ marginLeft: '0.75rem', color: 'var(--color-text-muted)' }}>
                · <strong style={{ color: '#166534' }}>{matchStats.confirmed}</strong> mapped
                {matchStats.suggested > 0 && (
                  <> · <strong style={{ color: '#92400E' }}>{matchStats.suggested}</strong> suggested</>
                )}
              </span>
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
        <button
          type="button"
          onClick={() => setSuggestedOnly(v => !v)}
          title="Show only rows that match a company on My Accounts"
          style={{
            padding: '0.35rem 0.7rem',
            border: `1px solid ${suggestedOnly ? '#3B82F6' : 'var(--color-border)'}`,
            borderRadius: 6,
            background: suggestedOnly ? '#DBEAFE' : '#fff',
            color: suggestedOnly ? '#1E3A8A' : 'var(--color-text-secondary)',
            fontSize: '0.75rem',
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
            whiteSpace: 'nowrap',
          }}
        >
          {suggestedOnly ? '★ My Accounts only' : '★ Suggested only'}
          {myAccountsMatchCount > 0 && (
            <span style={{ marginLeft: 6, fontSize: '0.68rem', color: suggestedOnly ? '#1E3A8A' : '#94A3B8' }}>
              {myAccountsMatchCount}
            </span>
          )}
        </button>
        {(search || suggestedOnly) && <span className={styles.resultCount}>{filtered.length} results</span>}
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
      {picker && createPortal(
        <div
          data-picker="my-account"
          style={{ position: 'fixed', top: picker.pos.top, left: picker.pos.left, width: picker.width, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', padding: '0.3rem', maxHeight: 350, zIndex: 9999, display: 'flex', flexDirection: 'column' }}
          onClick={e => e.stopPropagation()}
        >
          <input
            autoFocus
            value={picker.query}
            onChange={e => setPicker(p => ({ ...p, query: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Escape') setPicker(null); }}
            placeholder="Search your accounts..."
            style={{ width: '100%', padding: '0.3rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.75rem', fontFamily: 'inherit', marginBottom: '0.25rem', boxSizing: 'border-box' }}
          />
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {pickerResults.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => confirmMapping(picker.matchKey, p.company)}
                style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '0.35rem 0.5rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.75rem', fontFamily: 'inherit' }}
                onMouseEnter={e => e.currentTarget.style.background = '#F1F5F9'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                <div style={{ fontWeight: 600, color: 'var(--color-text)' }}>{p.company}</div>
                {(p.tier || p.cdm) && (
                  <div style={{ fontSize: '0.65rem', color: '#64748B', marginTop: 1 }}>
                    {[p.tier, p.cdm].filter(Boolean).join(' · ')}
                  </div>
                )}
              </button>
            ))}
            {pickerResults.length === 0 && (
              <div style={{ padding: '0.75rem', fontSize: '0.75rem', color: '#64748B', textAlign: 'center' }}>
                No matching accounts found.
              </div>
            )}
          </div>
          {mapping[picker.matchKey] && (
            <button
              type="button"
              onClick={() => clearMapping(picker.matchKey)}
              style={{ marginTop: '0.25rem', padding: '0.3rem 0.5rem', background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontSize: '0.7rem', fontFamily: 'inherit', textAlign: 'left' }}
            >Clear mapping</button>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

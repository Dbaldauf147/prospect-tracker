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

function buildColumns(data, prospectsByNorm, prospectSuggestionFor, mapping, onPick) {
  if (!data.length) return [];
  const keys = new Set();
  for (const row of data) for (const k of Object.keys(row)) if (k !== 'id') keys.add(k);
  const baseCols = [...keys].map((k, i) => ({
    key: k,
    label: k,
    defaultWidth: i === 0 ? 240 : 140,
    ...(i === 0 ? { sticky: true } : {}),
  }));
  // Key column — the one used as the canonical company-name source. Falls
  // back to the first column if we can't find one named "company"-ish.
  const nameKey = baseCols.find(c => /company|name|organi[sz]ation|signatory|entity/i.test(c.key))?.key
    || baseCols[0]?.key;
  const matchCol = {
    key: '__myAccount__',
    label: 'My Account',
    defaultWidth: 220,
    render: (row) => {
      const raw = row[nameKey] || '';
      const confirmed = mapping[row.__matchKey__];
      const prospect = confirmed
        ? prospectsByNorm.get(normalizeCompany(confirmed))
        : null;
      if (prospect) {
        return (
          <button
            type="button"
            onClick={() => onPick(row)}
            style={{ background: '#DCFCE7', border: '1px solid #86EFAC', borderRadius: 999, padding: '1px 8px', fontSize: '0.7rem', color: '#166534', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title="Mapped to one of your accounts · click to change"
          >✓ {prospect.company}</button>
        );
      }
      const suggestion = prospectSuggestionFor(raw);
      if (suggestion) {
        return (
          <button
            type="button"
            onClick={() => onPick(row)}
            style={{ background: '#FEF3C7', border: '1px dashed #F59E0B', borderRadius: 999, padding: '1px 8px', fontSize: '0.7rem', color: '#92400E', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title="Suggested match · click to confirm or pick a different account"
          >? {suggestion.company}</button>
        );
      }
      return (
        <button
          type="button"
          onClick={() => onPick(row)}
          style={{ background: 'transparent', border: '1px dashed #CBD5E1', borderRadius: 999, padding: '1px 8px', fontSize: '0.7rem', color: '#64748B', fontWeight: 400, cursor: 'pointer', fontFamily: 'inherit' }}
          title="Click to map to one of your accounts"
        >— Map —</button>
      );
    },
  };
  return [...baseCols, matchCol];
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
  const [{ data, source }, setStore] = useState(() => loadList(storageKey));
  const mappingKey = storageKey ? `${storageKey}:account-mapping` : '';
  const [mapping, setMapping] = useState(() => loadMapping(mappingKey));
  const [search, setSearch] = useState('');
  const [uploadError, setUploadError] = useState(null);
  const [picker, setPicker] = useState(null); // { matchKey, raw, query }
  const fileInputRef = useRef(null);

  useEffect(() => {
    setStore(loadList(storageKey));
    setMapping(loadMapping(`${storageKey}:account-mapping`));
    setSearch('');
    setUploadError(null);
    setPicker(null);
  }, [storageKey]);

  useEffect(() => {
    function onStorage(e) {
      if (e.key === storageKey) setStore(loadList(storageKey));
      if (e.key === mappingKey) setMapping(loadMapping(mappingKey));
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [storageKey, mappingKey]);

  // Persist mapping back to localStorage whenever it changes.
  useEffect(() => {
    if (!mappingKey) return;
    try {
      if (Object.keys(mapping).length === 0) localStorage.removeItem(mappingKey);
      else localStorage.setItem(mappingKey, JSON.stringify(mapping));
    } catch {}
  }, [mapping, mappingKey]);

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

  const prospectSuggestionFor = useMemo(() => (raw) => {
    const norm = normalizeCompany(raw);
    if (!norm) return null;
    const exact = prospectsByNorm.get(norm);
    if (exact) return exact;
    // Substring match — prefer the shortest normalized-name prospect so
    // short names don't swallow longer ones ("ge" shouldn't hijack "ge
    // aerospace" if both exist in the prospect list).
    let best = null;
    for (const { norm: pn, prospect } of prospectNorms) {
      if (pn === norm) return prospect;
      if (pn.length < 3) continue;
      if (norm.includes(pn) || pn.includes(norm)) {
        if (!best || pn.length < best.pn.length) best = { pn, prospect };
      }
    }
    return best?.prospect || null;
  }, [prospectsByNorm, prospectNorms]);

  const rows = useMemo(() => data.map((r, i) => {
    const canonKey = Object.keys(r)[0];
    const nameForKey = canonKey ? String(r[canonKey] || '') : '';
    return { ...r, id: i, __matchKey__: `${i}::${normalizeCompany(nameForKey)}` };
  }), [data]);

  function openPicker(row) {
    setPicker({ matchKey: row.__matchKey__, raw: Object.values(row)[1] || Object.values(row)[0] || '', query: '' });
  }
  function confirmMapping(matchKey, prospectCompany) {
    setMapping(prev => ({ ...prev, [matchKey]: prospectCompany }));
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

  const columns = useMemo(
    () => buildColumns(rows, prospectsByNorm, prospectSuggestionFor, mapping, openPicker),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, prospectsByNorm, prospectSuggestionFor, mapping]
  );
  const tableId = useMemo(
    () => `${tableIdPrefix}:` + columns.map(c => c.key).sort().join('|'),
    [columns, tableIdPrefix]
  );
  const alwaysVisible = useMemo(() => {
    const first = columns[0];
    const last = columns[columns.length - 1];
    const keys = [];
    if (first) keys.push(first.key);
    if (last && last.key === '__myAccount__') keys.push(last.key);
    return keys;
  }, [columns]);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const term = search.toLowerCase();
    return rows.filter(r =>
      Object.entries(r).some(([k, v]) => k !== '__matchKey__' && String(v).toLowerCase().includes(term))
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

  const matchStats = useMemo(() => {
    const confirmed = Object.keys(mapping).length;
    let suggested = 0;
    for (const r of rows) {
      if (mapping[r.__matchKey__]) continue;
      const raw = Object.values(r).find(v => typeof v === 'string' && v.trim());
      if (raw && prospectSuggestionFor(raw)) suggested++;
    }
    return { confirmed, suggested };
  }, [rows, mapping, prospectSuggestionFor]);

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
      {picker && (
        <div
          onClick={() => setPicker(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', width: 'min(480px, 100%)', maxHeight: '80vh', display: 'flex', flexDirection: 'column', fontFamily: 'inherit' }}
          >
            <div style={{ padding: '0.8rem 1rem', borderBottom: '1px solid var(--color-border-light)' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text)' }}>
                Map <em>{picker.raw || '(this row)'}</em> to a My Account
              </div>
              <input
                autoFocus
                value={picker.query}
                onChange={e => setPicker(p => ({ ...p, query: e.target.value }))}
                placeholder="Search your accounts..."
                style={{ marginTop: '0.5rem', width: '100%', padding: '0.4rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: '0.82rem', fontFamily: 'inherit' }}
              />
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {pickerResults.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => confirmMapping(picker.matchKey, p.company)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '0.5rem 1rem', borderBottom: '1px solid #F1F5F9', cursor: 'pointer', fontSize: '0.82rem', fontFamily: 'inherit' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#F8FAFC'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  <div style={{ fontWeight: 600, color: 'var(--color-text)' }}>{p.company}</div>
                  {(p.tier || p.cdm) && (
                    <div style={{ fontSize: '0.7rem', color: '#64748B', marginTop: 2 }}>
                      {[p.tier, p.cdm].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </button>
              ))}
              {pickerResults.length === 0 && (
                <div style={{ padding: '1rem', fontSize: '0.8rem', color: '#64748B', textAlign: 'center' }}>
                  No matching accounts found.
                </div>
              )}
            </div>
            <div style={{ padding: '0.5rem 1rem', borderTop: '1px solid var(--color-border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              {mapping[picker.matchKey] ? (
                <button
                  type="button"
                  onClick={() => clearMapping(picker.matchKey)}
                  style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontSize: '0.78rem', fontFamily: 'inherit' }}
                >Clear mapping</button>
              ) : <span />}
              <button
                type="button"
                onClick={() => setPicker(null)}
                style={{ padding: '0.3rem 0.7rem', border: '1px solid var(--color-border)', background: 'white', borderRadius: 5, cursor: 'pointer', fontSize: '0.78rem', fontFamily: 'inherit' }}
              >Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

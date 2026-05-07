import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { CommitOnBlurInput } from '../common/CommitOnBlurInput';

// Headers as specified by the user. The user typed "Webiste" in their
// note — we use the canonical "Website" spelling on the column header
// since both the export and any downstream parsing expect that.
// The first four columns are the canonical "Zoom Info" payload — the
// CSV export grabs them in this order. CDM / Tier come after so they
// stay visible alongside the company without contaminating the export.
const COLUMNS = [
  { key: 'company',      label: 'Company',           width: '20%' },
  { key: 'zoomId',       label: 'Zoom Company ID',   width: '16%' },
  { key: 'zoomName',     label: 'Zoom Company Name', width: '20%' },
  { key: 'zoomWebsite',  label: 'Zoom Website',      width: '22%' },
  { key: 'cdm',          label: 'CDM',               width: '12%' },
  { key: 'tier',         label: 'Tier',              width: '10%' },
];

const EXPORT_COLUMN_KEYS = ['company', 'zoomId', 'zoomName', 'zoomWebsite'];

// Minimum number of rows visible in the table. Empty padding rows fill
// in when the persisted list is shorter so the user always has scratch
// space — typing into a padding cell promotes that row into the
// persisted list on commit.
const MIN_VISIBLE_ROWS = 50;

function makeId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function emptyRow() {
  return { id: makeId(), company: '', zoomId: '', zoomName: '', zoomWebsite: '', cdm: '', tier: '' };
}

// Tab / comma / semicolon-tolerant split for clipboard paste — handles
// both Excel ("Acme<TAB>123<TAB>Acme Corp<TAB>acme.com") and the
// occasional CSV that leaks in from a spreadsheet export.
function splitPasteRow(line) {
  if (line.includes('\t')) return line.split('\t');
  return line.split(/,(?![^"]*"\s*(?:,|$))|;/).map(s => s.replace(/^"|"$/g, ''));
}

// Inline autocomplete used for the Company cell. Filters the supplied
// suggestion list by case-insensitive prefix-then-substring as the user
// types; ↑ / ↓ navigates, Enter or click commits, Escape cancels back
// to the original value. Pure local state until commit so the parent
// table doesn't re-render on every keystroke.
const CompanyAutocomplete = memo(function CompanyAutocomplete({
  value, onCommit, suggestions, placeholder, style,
}) {
  const [draft, setDraft] = useState(value ?? '');
  const [open, setOpen] = useState(false);
  const [hoverIdx, setHoverIdx] = useState(0);
  const wrapRef = useRef(null);
  const lastExternal = useRef(value ?? '');

  useEffect(() => {
    const v = value ?? '';
    if (v !== lastExternal.current) {
      lastExternal.current = v;
      setDraft(v);
    }
  }, [value]);

  // Close dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    function onDocDown(e) {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  const matches = useMemo(() => {
    const q = draft.trim().toLowerCase();
    if (!q || !suggestions?.length) return [];
    const prefix = [];
    const sub = [];
    for (const s of suggestions) {
      const lower = String(s).toLowerCase();
      if (lower === q) continue; // Skip an exact match — nothing to suggest.
      if (lower.startsWith(q)) prefix.push(s);
      else if (lower.includes(q)) sub.push(s);
      if (prefix.length + sub.length >= 25) break;
    }
    return [...prefix, ...sub].slice(0, 8);
  }, [draft, suggestions]);

  function commit(v) {
    const next = (v ?? draft);
    if (next !== lastExternal.current) {
      lastExternal.current = next;
      onCommit(next);
    }
    setOpen(false);
  }

  function handleKey(e) {
    if (open && matches.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHoverIdx(i => (i + 1) % matches.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setHoverIdx(i => (i - 1 + matches.length) % matches.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const pick = matches[hoverIdx] || matches[0];
        setDraft(pick);
        commit(pick);
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
    }
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        type="text"
        value={draft}
        onChange={e => { setDraft(e.target.value); setOpen(true); setHoverIdx(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Defer so a click on the popover lands first.
          requestAnimationFrame(() => {
            if (!wrapRef.current?.contains(document.activeElement)) commit();
          });
        }}
        onKeyDown={handleKey}
        placeholder={placeholder}
        style={style}
      />
      {open && matches.length > 0 && (
        <div
          onMouseDown={e => e.preventDefault()}
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 5,
            background: '#fff', border: '1px solid var(--color-border)',
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
});

export function ZoomInfoView({ prospects = [], settings, updateSettings }) {
  const persistedRows = useMemo(() => {
    const arr = Array.isArray(settings?.zoomInfo) ? settings.zoomInfo : [];
    return arr.map(r => ({ ...emptyRow(), ...r, id: r.id || makeId() }));
  }, [settings]);

  const [search, setSearch] = useState('');

  // Index every Table View prospect by lower-cased company so a row's
  // committed company instantly resolves to its zoom fields. Strips
  // common corp suffixes so "Acme Inc" still matches "Acme".
  const prospectIndex = useMemo(() => {
    const strip = (s) => String(s || '').toLowerCase()
      .replace(/[.,]/g, '')
      .replace(/\b(inc|llc|ltd|corp|co|lp|gmbh|plc|sa|ag)\b/g, '')
      .replace(/\s+/g, ' ').trim();
    const map = new Map();
    for (const p of prospects) {
      const key = String(p?.company || '').toLowerCase().trim();
      if (key) map.set(key, p);
      const norm = strip(p?.company);
      if (norm && !map.has(norm)) map.set(norm, p);
    }
    return { map, strip };
  }, [prospects]);

  const companyOptions = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const p of prospects) {
      const c = (p?.company || '').trim();
      if (!c) continue;
      const k = c.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(c);
    }
    return out.sort((a, b) => a.localeCompare(b));
  }, [prospects]);

  function findProspectByCompany(company) {
    if (!company) return null;
    const direct = prospectIndex.map.get(String(company).toLowerCase().trim());
    if (direct) return direct;
    const norm = prospectIndex.strip(company);
    return norm ? prospectIndex.map.get(norm) || null : null;
  }

  // Visible list = persisted rows + synthetic "padding" rows up to 50.
  // Padding rows have ids prefixed with "__pad_" so updateCell can
  // detect a first-touch promotion to the persisted set.
  const visibleRows = useMemo(() => {
    const padding = Math.max(0, MIN_VISIBLE_ROWS - persistedRows.length);
    const padRows = Array.from({ length: padding }, (_, i) => ({
      id: `__pad_${i}`, company: '', zoomId: '', zoomName: '', zoomWebsite: '', cdm: '', tier: '',
    }));
    return [...persistedRows, ...padRows];
  }, [persistedRows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return visibleRows;
    return visibleRows.filter(r =>
      COLUMNS.some(c => String(r[c.key] || '').toLowerCase().includes(q))
    );
  }, [visibleRows, search]);

  function persist(next) {
    updateSettings({ zoomInfo: next });
  }

  // Returns the row with auto-fill applied: when company is non-empty
  // and matches a Table View prospect, fill any blank zoom fields from
  // that prospect. Existing values on the row are never overwritten.
  function withAutofill(row) {
    if (!row.company) return row;
    const match = findProspectByCompany(row.company);
    if (!match) return row;
    return {
      ...row,
      zoomId:      row.zoomId || match.zoomCompanyId || '',
      zoomName:    row.zoomName || match.zoomCompanyName || '',
      zoomWebsite: row.zoomWebsite || match.website || '',
      cdm:         row.cdm || match.cdm || '',
      tier:        row.tier || match.tier || '',
    };
  }

  function updateCell(rowId, key, value) {
    // Synthetic padding row → only persist when the user typed
    // something. Empty commits stay ephemeral so a tab-through doesn't
    // pollute the saved list with blank rows.
    if (String(rowId).startsWith('__pad_')) {
      if (!String(value || '').trim()) return;
      const fresh = { ...emptyRow(), [key]: value };
      persist([...persistedRows, withAutofill(fresh)]);
      return;
    }
    const updated = persistedRows.map(r => {
      if (r.id !== rowId) return r;
      const next = { ...r, [key]: value };
      return key === 'company' ? withAutofill(next) : next;
    });
    persist(updated);
  }

  function addRow() {
    persist([...persistedRows, emptyRow()]);
  }

  function deleteRow(id) {
    if (String(id).startsWith('__pad_')) return; // nothing to delete
    persist(persistedRows.filter(r => r.id !== id));
  }

  // Excel paste: turn a tab-separated block into rows. Maps the first
  // four columns onto Company / Zoom ID / Zoom Name / Zoom Website in
  // that order. Skips entirely empty lines, trims whitespace per cell.
  function handlePaste(e) {
    const tag = (e.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    const text = e.clipboardData?.getData('text/plain') || '';
    if (!text.trim() || !text.includes('\t')) return;
    e.preventDefault();
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    const incoming = [];
    for (const line of lines) {
      const cols = splitPasteRow(line).map(c => (c || '').trim());
      if (cols.every(c => !c)) continue;
      if (/^company$/i.test(cols[0]) && /zoom/i.test(cols[1] || '')) continue;
      incoming.push(withAutofill({
        id: makeId(),
        company: cols[0] || '',
        zoomId: cols[1] || '',
        zoomName: cols[2] || '',
        zoomWebsite: cols[3] || '',
      }));
    }
    if (!incoming.length) return;
    persist([...persistedRows, ...incoming]);
  }

  function copyToClipboard() {
    const lines = [COLUMNS.map(c => c.label).join('\t')];
    for (const r of persistedRows) lines.push(COLUMNS.map(c => r[c.key] || '').join('\t'));
    navigator.clipboard?.writeText(lines.join('\n')).catch(() => {});
  }

  // RFC-4180-ish CSV escape: wrap any field containing a comma, quote,
  // or newline in double quotes and double-up any embedded quotes.
  function csvEscape(value) {
    const s = String(value ?? '');
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function exportCsv() {
    const exportCols = EXPORT_COLUMN_KEYS.map(k => COLUMNS.find(c => c.key === k));
    const lines = [exportCols.map(c => csvEscape(c.label)).join(',')];
    for (const r of persistedRows) {
      // Skip entirely-empty saved rows so the CSV doesn't carry blank lines.
      if (EXPORT_COLUMN_KEYS.every(k => !String(r[k] || '').trim())) continue;
      lines.push(EXPORT_COLUMN_KEYS.map(k => csvEscape(r[k] || '')).join(','));
    }
    // Prepend a UTF-8 BOM so Excel auto-detects the encoding when the
    // user double-clicks the file on Windows.
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Zoom Info - ${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    requestAnimationFrame(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    });
  }

  const cellInputStyle = {
    width: '100%',
    border: 'none',
    padding: '0.45rem 0.6rem',
    fontFamily: 'inherit',
    fontSize: '0.8rem',
    background: 'transparent',
    boxSizing: 'border-box',
    outline: 'none',
  };

  return (
    <div onPaste={handlePaste} style={{ padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--color-text)' }}>Zoom Info</h2>
        <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
          {persistedRows.length.toLocaleString()} {persistedRows.length === 1 ? 'company' : 'companies'} saved
        </span>
        <div style={{ flex: 1 }} />
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search…"
          style={{ padding: '0.35rem 0.55rem', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.8rem', minWidth: 200 }}
        />
        <button
          type="button"
          onClick={addRow}
          style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem', border: 'none', background: '#009530', color: '#fff', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
        >+ Add Row</button>
        <button
          type="button"
          onClick={copyToClipboard}
          title="Copy the entire table (all columns) as tab-separated values, ready to paste into Excel."
          style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', background: '#fff', color: 'var(--color-text)', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
        >Copy as TSV</button>
        <button
          type="button"
          onClick={exportCsv}
          title="Download the first four columns (Company, Zoom Company ID, Zoom Company Name, Zoom Website) as a CSV file."
          style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', background: '#fff', color: 'var(--color-text)', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
        >Export CSV</button>
      </div>
      <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
        Tip: type in the Company column to search the Table View — pick a match and the Zoom ID / Name / Website auto-fill from that account. Paste a tab-separated block anywhere on this page (outside an input) to bulk-add rows.
      </div>

      <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--color-border)', borderRadius: 4 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', tableLayout: 'fixed' }}>
          <thead>
            <tr>
              {COLUMNS.map(c => (
                <th key={c.key} style={{
                  width: c.width,
                  textAlign: 'left',
                  padding: '0.45rem 0.6rem',
                  background: '#F1F5F9',
                  fontWeight: 700,
                  fontSize: '0.72rem',
                  color: '#475569',
                  borderBottom: '1px solid var(--color-border)',
                  position: 'sticky',
                  top: 0,
                  zIndex: 1,
                }}>{c.label}</th>
              ))}
              <th style={{ width: 44, background: '#F1F5F9', borderBottom: '1px solid var(--color-border)', position: 'sticky', top: 0, zIndex: 1 }} />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length + 1} style={{ padding: '1.2rem', textAlign: 'center', color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: '0.78rem' }}>
                  No matches for the current search.
                </td>
              </tr>
            )}
            {filtered.map(r => {
              const isPad = String(r.id).startsWith('__pad_');
              return (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border-light)' }}>
                  {COLUMNS.map(c => (
                    <td key={c.key} style={{ padding: 0, verticalAlign: 'top' }}>
                      {c.key === 'company' ? (
                        <CompanyAutocomplete
                          value={r[c.key] || ''}
                          onCommit={v => updateCell(r.id, c.key, v)}
                          suggestions={companyOptions}
                          placeholder={isPad ? 'Type a company…' : '—'}
                          style={cellInputStyle}
                        />
                      ) : (
                        <CommitOnBlurInput
                          value={r[c.key] || ''}
                          onCommit={v => updateCell(r.id, c.key, v)}
                          placeholder="—"
                          style={cellInputStyle}
                        />
                      )}
                    </td>
                  ))}
                  <td style={{ padding: '0.2rem', textAlign: 'center' }}>
                    {!isPad && (
                      <button
                        type="button"
                        onClick={() => deleteRow(r.id)}
                        title="Delete row"
                        style={{ border: 'none', background: 'transparent', color: '#94A3B8', fontSize: '1rem', cursor: 'pointer', padding: '0 6px', lineHeight: 1 }}
                        onMouseEnter={e => e.currentTarget.style.color = '#DC2626'}
                        onMouseLeave={e => e.currentTarget.style.color = '#94A3B8'}
                      >×</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

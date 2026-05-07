import { useMemo, useState } from 'react';
import { CommitOnBlurInput } from '../common/CommitOnBlurInput';

// Headers as specified by the user. The user typed "Webiste" in their
// note — we use the canonical "Website" spelling on the column header
// since both the export and any downstream parsing expect that.
const COLUMNS = [
  { key: 'company',      label: 'Company',           width: '24%' },
  { key: 'zoomId',       label: 'Zoom Company ID',   width: '20%' },
  { key: 'zoomName',     label: 'Zoom Company Name', width: '24%' },
  { key: 'zoomWebsite',  label: 'Zoom Website',      width: '28%' },
];

function makeId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function emptyRow() {
  return { id: makeId(), company: '', zoomId: '', zoomName: '', zoomWebsite: '' };
}

// Tab / comma / semicolon-tolerant split for clipboard paste — handles
// both Excel ("Acme<TAB>123<TAB>Acme Corp<TAB>acme.com") and the
// occasional CSV that leaks in from a spreadsheet export.
function splitPasteRow(line) {
  if (line.includes('\t')) return line.split('\t');
  // Naive CSV split — good enough for the small lists pasted into this
  // table; quoted commas inside fields aren't expected.
  return line.split(/,(?![^"]*"\s*(?:,|$))|;/).map(s => s.replace(/^"|"$/g, ''));
}

export function ZoomInfoView({ settings, updateSettings }) {
  const rows = useMemo(() => {
    const arr = Array.isArray(settings?.zoomInfo) ? settings.zoomInfo : [];
    return arr.map(r => ({ ...emptyRow(), ...r, id: r.id || makeId() }));
  }, [settings]);

  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      COLUMNS.some(c => String(r[c.key] || '').toLowerCase().includes(q))
    );
  }, [rows, search]);

  function persist(next) {
    updateSettings({ zoomInfo: next });
  }

  function updateCell(id, key, value) {
    const next = rows.map(r => (r.id === id ? { ...r, [key]: value } : r));
    persist(next);
  }

  function addRow() {
    persist([...rows, emptyRow()]);
  }

  function deleteRow(id) {
    persist(rows.filter(r => r.id !== id));
  }

  // Excel paste: turn a tab-separated block into rows. Maps the first
  // four columns onto Company / Zoom ID / Zoom Name / Zoom Website in
  // that order. Skips entirely empty lines, trims whitespace per cell.
  function handlePaste(e) {
    // Only intercept when the focus isn't inside a real input — paste
    // into individual cells should still flow through to the cell.
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
      // Skip a header row if the first cell looks like the literal label.
      if (/^company$/i.test(cols[0]) && /zoom/i.test(cols[1] || '')) continue;
      incoming.push({
        id: makeId(),
        company: cols[0] || '',
        zoomId: cols[1] || '',
        zoomName: cols[2] || '',
        zoomWebsite: cols[3] || '',
      });
    }
    if (!incoming.length) return;
    persist([...rows, ...incoming]);
  }

  function copyToClipboard() {
    const lines = [COLUMNS.map(c => c.label).join('\t')];
    for (const r of rows) lines.push(COLUMNS.map(c => r[c.key] || '').join('\t'));
    navigator.clipboard?.writeText(lines.join('\n')).catch(() => {});
  }

  return (
    <div onPaste={handlePaste} style={{ padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--color-text)' }}>Zoom Info</h2>
        <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
          {rows.length.toLocaleString()} {rows.length === 1 ? 'company' : 'companies'}
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
          title="Copy the entire table as tab-separated values (paste into Excel)."
          style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', background: '#fff', color: 'var(--color-text)', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
        >Copy as TSV</button>
      </div>
      <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
        Tip: paste a block from Excel anywhere on this page (outside an input) to bulk-add rows. The first 4 columns are mapped to Company / Zoom ID / Zoom Name / Zoom Website.
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
                  {rows.length === 0
                    ? 'No companies yet. Click "+ Add Row" or paste a block from Excel.'
                    : 'No matches for the current search.'}
                </td>
              </tr>
            )}
            {filtered.map(r => (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border-light)' }}>
                {COLUMNS.map(c => (
                  <td key={c.key} style={{ padding: 0, verticalAlign: 'top' }}>
                    <CommitOnBlurInput
                      value={r[c.key] || ''}
                      onCommit={v => updateCell(r.id, c.key, v)}
                      placeholder="—"
                      style={{
                        width: '100%',
                        border: 'none',
                        padding: '0.45rem 0.6rem',
                        fontFamily: 'inherit',
                        fontSize: '0.8rem',
                        background: 'transparent',
                        boxSizing: 'border-box',
                      }}
                    />
                  </td>
                ))}
                <td style={{ padding: '0.2rem', textAlign: 'center' }}>
                  <button
                    type="button"
                    onClick={() => deleteRow(r.id)}
                    title="Delete row"
                    style={{ border: 'none', background: 'transparent', color: '#94A3B8', fontSize: '1rem', cursor: 'pointer', padding: '0 6px', lineHeight: 1 }}
                    onMouseEnter={e => e.currentTarget.style.color = '#DC2626'}
                    onMouseLeave={e => e.currentTarget.style.color = '#94A3B8'}
                  >×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

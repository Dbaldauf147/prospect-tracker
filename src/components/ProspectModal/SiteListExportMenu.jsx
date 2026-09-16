import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  siteListColumns, downloadSiteListExcel, downloadSiteListCsv,
} from '../../utils/siteListExport.js';

// Export the company's saved Site List, by the columns you pick.
//
// A saved list carries whatever the source file had, which on a Utility
// Look Up save is twenty-odd columns: the site, its address, the division
// twice (raw and as the analysis read it), the property type twice, the
// tenure, the market. Handing all of that to somebody who asked for "the
// sites and the cities" is the same problem as handing them nothing, so
// the columns are ticked rather than assumed.
//
// Everything starts ticked, because the common case is the whole list and
// a panel that opens empty makes you click before it will do anything.
// The picks are this popup's, not the company's: they reset when the list
// is replaced (its columns may be different ones) and are not worth a
// settings write.
export function SiteListExportMenu({ list, company }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const btnRef = useRef(null);
  const panelRef = useRef(null);

  const columns = useMemo(() => siteListColumns(list), [list]);
  const columnKey = columns.join('|');
  const rowCount = (list?.rows || []).length;

  // The pick is stamped with the columns it was made against: a replaced
  // list is a different table, and carrying the old ticks across would
  // silently drop columns the new one has. Read here rather than reset in
  // an effect so the first render after a replace is already right.
  const selectedSet = new Set(picked?.key === columnKey ? picked.cols : columns);
  const chosen = columns.filter(c => selectedSet.has(c));
  const pick = (cols) => setPicked({ key: columnKey, cols });

  function toggle() {
    if (open) { setOpen(false); return; }
    const width = 300;
    const r = btnRef.current?.getBoundingClientRect?.();
    setPos(r
      ? {
        top: r.bottom + 6,
        left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
        width,
      }
      : { top: 80, left: 80, width });
    setError('');
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return undefined;
    function onDocClick(e) {
      if (panelRef.current?.contains(e.target)) return;
      if (btnRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!list || rowCount === 0 || columns.length === 0) return null;

  function toggleColumn(col) {
    const next = new Set(chosen);
    if (next.has(col)) next.delete(col); else next.add(col);
    pick(columns.filter(c => next.has(c)));
  }

  async function run(kind) {
    if (chosen.length === 0) return;
    setBusy(kind);
    setError('');
    try {
      if (kind === 'xlsx') await downloadSiteListExcel(list, chosen, company);
      else downloadSiteListCsv(list, chosen, company);
      setOpen(false);
    } catch (err) {
      setError(err?.message || 'Export failed');
    }
    setBusy('');
  }

  const linkButton = (label, onClick, title) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        background: 'transparent', border: 'none', padding: 0,
        fontSize: '0.68rem', fontWeight: 600, color: 'var(--color-accent)',
        cursor: 'pointer', fontFamily: 'inherit',
      }}
    >{label}</button>
  );

  const fileButton = (label, kind, title) => {
    const disabled = chosen.length === 0 || !!busy;
    return (
      <button
        type="button"
        onClick={() => run(kind)}
        disabled={disabled}
        title={chosen.length === 0 ? 'Tick at least one column' : title}
        style={{
          flex: 1,
          padding: '0.32rem 0.6rem',
          border: kind === 'xlsx' ? 'none' : '1px solid var(--color-border)',
          borderRadius: 6,
          background: kind === 'xlsx' ? (disabled ? '#94A3B8' : 'var(--color-accent)') : 'var(--color-surface)',
          color: kind === 'xlsx' ? '#fff' : (disabled ? 'var(--color-text-muted)' : 'var(--color-accent)'),
          fontSize: '0.72rem',
          fontWeight: 600,
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit',
          whiteSpace: 'nowrap',
        }}
      >{busy === kind ? 'Preparing…' : label}</button>
    );
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        title={`Export these ${rowCount} site${rowCount === 1 ? '' : 's'} to Excel or CSV, by the columns you pick`}
        style={{
          fontSize: '0.75rem', padding: '0.35rem 0.7rem', borderRadius: 6,
          border: '1px solid var(--color-border)',
          background: open ? '#EFF6FF' : 'var(--color-surface)',
          color: 'var(--color-accent)', cursor: 'pointer', fontWeight: 600,
          display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
        }}
      >
        ↓ Export
        <span aria-hidden="true" style={{ fontSize: '0.6rem', color: '#64748B' }}>{'▾'}</span>
      </button>
      {open && pos && createPortal(
        <div
          ref={panelRef}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed', top: pos.top, left: pos.left, width: pos.width,
            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
            borderRadius: 8, boxShadow: '0 12px 32px rgba(15,23,42,0.18)',
            zIndex: 10000, padding: '0.65rem 0.8rem', fontFamily: 'inherit',
          }}
        >
          <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Export site list
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.5rem', marginTop: '0.25rem' }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--color-text)' }}>
              {rowCount} {rowCount === 1 ? 'row' : 'rows'} · {chosen.length} of {columns.length} columns
            </span>
            <span style={{ display: 'inline-flex', gap: '0.5rem' }}>
              {linkButton('All', () => pick(columns), 'Tick every column')}
              {linkButton('None', () => pick([]), 'Untick every column')}
            </span>
          </div>
          <div
            style={{
              marginTop: '0.45rem', maxHeight: 220, overflowY: 'auto',
              border: '1px solid var(--color-border-light)', borderRadius: 6,
              padding: '0.25rem 0.1rem',
            }}
          >
            {columns.map(col => (
              <label
                key={col}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.4rem',
                  padding: '0.18rem 0.45rem', fontSize: '0.73rem',
                  color: 'var(--color-text)', cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedSet.has(col)}
                  onChange={() => toggleColumn(col)}
                />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={col}>{col}</span>
              </label>
            ))}
          </div>
          {error && <div style={{ fontSize: '0.68rem', color: '#B91C1C', marginTop: '0.35rem' }}>{error}</div>}
          <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.55rem' }}>
            {fileButton('Excel', 'xlsx', `Download ${chosen.length} column${chosen.length === 1 ? '' : 's'} as .xlsx`)}
            {fileButton('CSV', 'csv', `Download ${chosen.length} column${chosen.length === 1 ? '' : 's'} as .csv`)}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

export default SiteListExportMenu;

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

// Multi-tag selector with an optional "add new" affordance. Mirrors the
// ProspectModal's MultiSelectDropdown (chips + portal popover checklist
// with search) but adds the ability to create a brand-new tag inline:
// when the search box holds a value that matches no existing option and
// `onAddNew` is supplied, a "+ Add" row appears that persists the tag and
// selects it. Shared so the PE Firm sub-tab cell and the company popup
// edit strategies through exactly the same control.
export function TagMultiSelect({ options = [], selected = [], onToggle, onAddNew, placeholder = 'Select…' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, up: false });
  const [filter, setFilter] = useState('');
  const ref = useRef(null);
  const dropRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => {
      if (ref.current?.contains(e.target)) return;
      if (dropRef.current?.contains(e.target)) return;
      setOpen(false); setFilter('');
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  useEffect(() => {
    if (!open || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const up = spaceBelow < 260;
    setPos({
      top: up ? rect.top - 2 : rect.bottom + 2,
      left: rect.left,
      width: rect.width,
      up,
    });
  }, [open, filter]);

  const term = filter.trim();
  const filtered = term ? options.filter(o => o.toLowerCase().includes(term.toLowerCase())) : options;
  // Offer the add-new row only when there's a typed term that doesn't
  // already exist (case-insensitive) anywhere in the vocabulary.
  const canAdd = !!onAddNew && term.length > 0 &&
    !options.some(o => o.toLowerCase() === term.toLowerCase());

  const addNew = () => {
    if (!canAdd) return;
    onAddNew(term);
    if (!selected.some(s => s.toLowerCase() === term.toLowerCase())) onToggle(term);
    setFilter('');
  };

  return (
    <div ref={ref}>
      <div
        onClick={() => { setOpen(o => !o); setFilter(''); }}
        style={{
          display: 'flex', flexWrap: 'wrap', gap: '0.3rem', padding: '0.3rem 0.45rem',
          border: '1px solid var(--color-border, #CBD5E1)', borderRadius: 6, minHeight: 32,
          alignItems: 'center', cursor: 'pointer', background: 'var(--color-bg, #fff)',
        }}
      >
        {selected.length === 0 && <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted, #94A3B8)' }}>{placeholder}</span>}
        {selected.map(v => (
          <span key={v} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', padding: '0.1rem 0.45rem', background: '#EDE9FE', border: '1px solid #C4B5FD', borderRadius: 999, fontSize: '0.68rem', color: '#5B21B6', fontWeight: 600 }}>
            {v}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggle(v); }}
              style={{ background: 'none', border: 'none', color: '#A78BFA', fontSize: '0.78rem', cursor: 'pointer', padding: '0 1px', lineHeight: 1 }}
            >&times;</button>
          </span>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: '0.6rem', color: 'var(--color-text-muted, #94A3B8)' }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && createPortal(
        <div ref={dropRef} style={{
          position: 'fixed',
          top: pos.up ? undefined : pos.top,
          bottom: pos.up ? (window.innerHeight - pos.top) : undefined,
          left: pos.left,
          width: Math.max(pos.width, 260),
          zIndex: 10001,
          background: '#fff', border: '1px solid #E2E8F0', borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)', maxHeight: 260, display: 'flex', flexDirection: 'column',
        }}>
          <input
            type="text"
            placeholder={onAddNew ? 'Search or add…' : 'Search…'}
            value={filter}
            onChange={e => setFilter(e.target.value)}
            onClick={e => e.stopPropagation()}
            onKeyDown={e => { if (e.key === 'Enter' && canAdd) { e.preventDefault(); addNew(); } }}
            autoFocus
            style={{ margin: '0.3rem', padding: '0.3rem 0.5rem', border: '1px solid #E2E8F0', borderRadius: 4, fontSize: '0.72rem', fontFamily: 'inherit', outline: 'none' }}
          />
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.map(opt => (
              <label
                key={opt}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.6rem', fontSize: '0.72rem', cursor: 'pointer', color: '#1E293B' }}
                onMouseOver={e => e.currentTarget.style.background = '#F1F5F9'}
                onMouseOut={e => e.currentTarget.style.background = ''}
              >
                <input type="checkbox" checked={selected.includes(opt)} onChange={() => onToggle(opt)} style={{ accentColor: '#7C3AED' }} />
                {opt}
              </label>
            ))}
            {filtered.length === 0 && !canAdd && <div style={{ padding: '0.4rem 0.6rem', fontSize: '0.7rem', color: '#94A3B8' }}>No matches</div>}
            {canAdd && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); addNew(); }}
                style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', width: '100%', textAlign: 'left', padding: '0.35rem 0.6rem', fontSize: '0.72rem', fontWeight: 600, color: '#7C3AED', background: '#F5F3FF', border: 'none', borderTop: '1px solid #EDE9FE', cursor: 'pointer', fontFamily: 'inherit' }}
              >+ Add “{term}”</button>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

import { useState, useRef, useMemo, useLayoutEffect, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { pickHubspotCompanies } from '../../utils/hubspotMapping';

// The HubSpot Company cell's picker on the Hubspot Mapping subtab: type any
// part of a HubSpot company's name or website and pick it to link the
// account to it (the same link the Possible Match column's Map makes).
//
// With nothing typed it offers the row's possible matches. A company some
// other account already has says so, but can still be picked. The list is
// portalled to <body> with a fixed position so the table cell's overflow
// doesn't clip it.
//
// Keyboard: Down/Up walk the list, Enter takes the highlighted company,
// Escape closes it.
export function HubspotCompanyPicker({ companies, suggestedIds = [], claimedBy, onPick, onCancel, autoFocus = false, placeholder = 'Pick HubSpot company...' }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(autoFocus);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const list = useMemo(() => pickHubspotCompanies(companies, q, { suggestedIds }), [companies, q, suggestedIds]);
  const activeIdx = Math.min(active, list.length - 1);

  useLayoutEffect(() => {
    if (!open || !inputRef.current) return;
    const place = () => {
      const r = inputRef.current?.getBoundingClientRect();
      if (r) setPos({ left: r.left, top: r.bottom + 2, width: Math.max(r.width, 320) });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open]);

  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);

  const pick = (c) => { setOpen(false); setQ(''); onPick(c); };
  const close = () => { setOpen(false); setQ(''); onCancel?.(); };

  return (
    <>
      <input
        ref={inputRef}
        value={q}
        placeholder={placeholder}
        onChange={e => { setQ(e.target.value); setActive(0); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={e => { if (!listRef.current?.contains(e.relatedTarget)) close(); }}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(i => Math.min(i + 1, list.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
          else if (e.key === 'Enter' && open && list[activeIdx]) { e.preventDefault(); pick(list[activeIdx]); }
          else if (e.key === 'Escape') { e.preventDefault(); close(); inputRef.current?.blur(); }
        }}
        style={{ width: '100%', minWidth: 120, boxSizing: 'border-box', padding: '2px 6px', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: '0.75rem', fontFamily: 'inherit', background: '#fff' }}
      />
      {open && pos && createPortal(
        <div ref={listRef} tabIndex={-1}
          style={{ position: 'fixed', left: pos.left, top: pos.top, width: pos.width, maxHeight: 300, overflowY: 'auto', background: '#fff', border: '1px solid #CBD5E1', borderRadius: 6, boxShadow: '0 8px 24px rgba(15,23,42,0.15)', zIndex: 2000, fontSize: '0.75rem' }}
        >
          {list.length === 0 ? (
            <div style={{ padding: '6px 10px', color: '#64748B' }}>{q.trim() ? 'No HubSpot company matches.' : 'Type a name or website.'}</div>
          ) : list.map((c, i) => {
            const other = claimedBy?.get(String(c.id));
            return (
              <button key={c.id} type="button" tabIndex={-1}
                onMouseDown={e => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(c)}
                title={`Link to HubSpot's ${c.name} (${c.id})`}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 10px', border: 'none', background: i === activeIdx ? '#EFF6FF' : '#fff', fontFamily: 'inherit', fontSize: 'inherit', cursor: 'pointer', color: '#0F172A' }}
              >
                <span style={{ fontWeight: 600 }}>{c.name}</span>
                {c.domain && <span style={{ color: '#64748B' }}> - {c.domain}</span>}
                {suggestedIds.includes(String(c.id)) && !q.trim() && <span style={{ color: '#15803D', fontSize: '0.68rem' }}> (possible match)</span>}
                {other && <div style={{ color: '#B45309', fontSize: '0.68rem' }}>Already mapped to {other}</div>}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

// A multi-value field on the company card (aliases, HubSpot names, other
// BFO names, email domains) shown as one compact line instead of a box of
// chips that grows down the page. The line names the first value and how
// many more there are; clicking it opens a popup holding the full editor.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function PopupListField({ title, items = [], placeholder = 'None', badge = null, tone = 'default', hint, children }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
    };
    // Capture, so Escape closes this popup rather than the company card under it.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  const border = tone === 'missing' ? '#FCA5A5' : tone === 'estimated' ? '#FCD34D' : 'var(--color-border)';
  const first = items[0];
  const more = items.length - 1;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={hint || (items.length ? items.join('\n') : `Click to add ${title.toLowerCase()}`)}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.35rem', width: '100%', minHeight: '28px',
          padding: '0.15rem 0.5rem', border: `1px solid ${border}`, borderRadius: 'var(--radius-md)',
          background: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.78rem', textAlign: 'left',
        }}
      >
        {badge}
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: first ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
          {first || placeholder}
        </span>
        {more > 0 && (
          <span style={{ flexShrink: 0, padding: '0 0.45rem', borderRadius: 999, background: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1E40AF', fontSize: '0.68rem', fontWeight: 600 }}>
            +{more} more
          </span>
        )}
        <span aria-hidden="true" style={{ flexShrink: 0, color: '#94A3B8', fontSize: '0.7rem' }}>&#9998;</span>
      </button>
      {open && createPortal(
        <div
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}
        >
          <div
            role="dialog"
            aria-label={title}
            style={{ width: 'min(560px, 100%)', maxHeight: '85vh', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 8, boxShadow: '0 12px 32px rgba(0,0,0,0.25)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 0.9rem', borderBottom: '1px solid #E2E8F0' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0F172A' }}>
                {title}{items.length > 0 ? ` (${items.length})` : ''}
              </span>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: '1.1rem', lineHeight: 1, color: '#64748B', cursor: 'pointer' }}
              >&times;</button>
            </div>
            <div style={{ padding: '0.8rem 0.9rem', overflowY: 'auto' }}>
              {children}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0.5rem 0.9rem', borderTop: '1px solid #E2E8F0' }}>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{ padding: '0.25rem 0.8rem', border: '1px solid #2563EB', borderRadius: 4, background: '#2563EB', color: '#fff', fontSize: '0.75rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}
              >Done</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

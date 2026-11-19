import { useEffect, useRef, useState } from 'react';

// Bulk Add's "NOT titles" toggle: narrows the queue to the contacts whose
// job title contains a Not term from the Titles page, so the ones a search
// would have ruled out can be looked over and removed together.
//
// A split button. The main half switches the filter on and off; the caret
// opens the Not lists it reads (the general one and each search's own),
// each of which can be left out.
export function NotTitlesFilter({ sources, off, onToggleSource, active, onToggleActive, matchCount, sourceCounts }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const none = sources.length === 0;
  const border = active ? '#F87171' : 'var(--color-border)';
  const half = {
    padding: '0.3rem 0.6rem',
    border: `1px solid ${border}`,
    background: active ? '#FEF2F2' : '#fff',
    color: active ? '#B91C1C' : 'var(--color-text-secondary)',
    fontSize: '0.72rem',
    fontWeight: 600,
    cursor: none ? 'not-allowed' : 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    opacity: none ? 0.55 : 1,
  };

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        disabled={none}
        aria-pressed={active}
        onClick={onToggleActive}
        title={none
          ? 'The Titles page has no Not terms yet. Add some there to filter by them here.'
          : 'Show only the contacts whose job title contains a Not term from the Titles page'}
        style={{ ...half, borderRadius: '6px 0 0 6px', borderRight: 'none' }}
      >
        {active ? 'Showing NOT titles' : 'NOT titles'} ({matchCount})
      </button>
      <button
        type="button"
        disabled={none}
        aria-label="Choose which Not lists to use"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        title="Choose which Not lists from the Titles page to use"
        style={{ ...half, borderRadius: '0 6px 6px 0', padding: '0.3rem 0.4rem' }}
      >▾</button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 40,
            minWidth: 280, maxWidth: 360, maxHeight: 360, overflowY: 'auto',
            background: '#fff', border: '1px solid var(--color-border)', borderRadius: 8,
            boxShadow: '0 8px 24px rgba(15, 23, 42, 0.14)', padding: '0.5rem',
          }}
        >
          <div style={{ fontSize: '0.68rem', color: '#64748B', padding: '0 0.25rem 0.4rem' }}>
            Not lists from the Titles page. A contact matches when its job title contains any term of a ticked list.
          </div>
          {sources.map(s => {
            const on = !off.has(s.key);
            return (
              <label
                key={s.key}
                title={s.terms.join(', ')}
                style={{ display: 'flex', alignItems: 'flex-start', gap: '0.45rem', padding: '0.3rem 0.25rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.74rem' }}
              >
                <input type="checkbox" checked={on} onChange={() => onToggleSource(s.key)} style={{ marginTop: 2 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{s.label}</span>
                  <span style={{ color: '#64748B' }}> · {s.terms.length} term{s.terms.length === 1 ? '' : 's'}</span>
                  <span style={{ display: 'block', color: '#94A3B8', fontSize: '0.68rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.terms.join(', ')}
                  </span>
                </span>
                <span style={{ color: '#64748B', fontVariantNumeric: 'tabular-nums' }}>{sourceCounts[s.key] || 0}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

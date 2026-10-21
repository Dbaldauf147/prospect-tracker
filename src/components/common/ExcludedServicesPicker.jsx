import { useEffect, useMemo, useState } from 'react';

// The Services picker: which services a page's Biggest Deal leaves out
// (utils/prospectingDeals withoutExcludedServices). A checklist of every
// service on the rate card, ticked = included, with a search box for a long
// card. Every change goes to onChange straight away; `title` is the button's
// tooltip and `hint` the line over the list, both saying which page it is.
export function ExcludedServicesPicker({ names, excluded, onChange, title, hint }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!e.target.closest?.('[data-excluded-services]')) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const sorted = useMemo(() => [...new Set(names)].sort((a, b) => a.localeCompare(b)), [names]);
  const shownNames = q.trim() ? sorted.filter(n => n.toLowerCase().includes(q.trim().toLowerCase())) : sorted;
  // Only names still on the card count: an exclusion for a service since
  // removed changes nothing, so it isn't reported as one.
  const count = sorted.filter(n => excluded.has(n)).length;
  const toggle = (name) => {
    if (!onChange) return;
    const next = new Set(excluded);
    if (next.has(name)) next.delete(name); else next.add(name);
    onChange(next);
  };
  return (
    <div data-excluded-services style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title={title}
        style={{
          padding: '0.35rem 0.7rem', borderRadius: 6, fontSize: '0.74rem', fontFamily: 'inherit', fontWeight: 600, cursor: 'pointer',
          border: `1px solid ${count ? '#F59E0B' : '#CBD5E1'}`, background: count ? '#FFFBEB' : '#fff', color: count ? '#92400E' : '#475569',
        }}
      >{count ? `Services: ${count} excluded` : 'Services: all included'}</button>
      {open && (
        <div
          role="dialog"
          aria-label="Services in the analysis"
          style={{
            position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 50, width: 300, maxHeight: 380,
            display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8,
            boxShadow: '0 8px 24px rgba(15,23,42,0.15)', fontSize: '0.74rem', color: '#334155',
          }}
        >
          <div style={{ padding: '0.5rem 0.6rem', borderBottom: '1px solid #F1F5F9', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ color: '#64748B', fontSize: '0.68rem' }}>{hint}{onChange ? '' : ' (Read-only here.)'}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="search"
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Find a service"
                style={{ flex: 1, minWidth: 0, padding: '0.3rem 0.5rem', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: '0.72rem', fontFamily: 'inherit' }}
              />
              {count > 0 && onChange && (
                <button
                  type="button"
                  onClick={() => onChange(new Set())}
                  style={{ padding: '0.2rem 0.5rem', borderRadius: 6, border: '1px solid #CBD5E1', background: '#fff', fontSize: '0.68rem', fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' }}
                >Include all</button>
              )}
            </div>
          </div>
          <div style={{ overflowY: 'auto', padding: '0.25rem 0' }}>
            {shownNames.map(name => (
              <label key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.25rem 0.75rem', cursor: onChange ? 'pointer' : 'default', color: excluded.has(name) ? '#94A3B8' : '#1E293B' }}>
                <input type="checkbox" checked={!excluded.has(name)} disabled={!onChange} onChange={() => toggle(name)} style={{ margin: 0 }} />
                <span style={{ textDecoration: excluded.has(name) ? 'line-through' : 'none' }}>{name}</span>
              </label>
            ))}
            {shownNames.length === 0 && <div style={{ padding: '0.5rem 0.75rem', color: '#94A3B8' }}>No services match</div>}
          </div>
        </div>
      )}
    </div>
  );
}

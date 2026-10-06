import { useMemo, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { companiesMatch } from '../../utils/listFlags';

// Ties one Portfolio Companies row to a Table View company: either an
// existing record (picked from a search over the whole roster) or a new one
// created from the row. Opened from the link button beside a row's name when
// the row doesn't resolve to anything on Table View by name.
//
// Rendered into document.body as a centred dialog: the portfolio table sits
// in a horizontal scroller that would clip anything anchored to the cell.
export function PortfolioCompanyLinkPicker({ rowName = '', firmName = '', prospects = [], creating = false, error = '', onMap, onCreate, onClose }) {
  const [query, setQuery] = useState(rowName);
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Ranked: a fuzzy company match on the full query first (the usual
  // reason a row didn't link is "Triumph" vs "Triumph Group"), then a
  // name that starts with it, then one that contains it, then one that
  // contains every word of it.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const words = q.split(/\s+/).filter(Boolean);
    const scored = [];
    for (const p of prospects) {
      const name = String(p?.company || '').trim();
      if (!name || !p.id) continue;
      const lower = name.toLowerCase();
      let score = 99;
      if (companiesMatch(name, query)) score = 0;
      else if (lower.startsWith(q)) score = 1;
      else if (lower.includes(q)) score = 2;
      else if (words.every(w => lower.includes(w))) score = 3;
      if (score < 99) scored.push({ p, score, name });
    }
    scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
    return scored.slice(0, 12).map(s => s.p);
  }, [prospects, query]);

  const name = rowName.trim();

  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.35)', zIndex: 10050, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div role="dialog" aria-label={`Link ${name || 'portfolio company'} to Table View`} style={{ background: '#fff', borderRadius: 10, width: 'min(460px, 100%)', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 32px rgba(0,0,0,0.2)', fontFamily: 'inherit' }}>
        <div style={{ padding: '0.9rem 1rem 0.5rem' }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0F172A' }}>
            Link “{name || 'this company'}” to Table View
          </div>
          <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 4 }}>
            Not found on Table View by name. Map it to a company that is already there, or create it.
          </div>
        </div>

        <div style={{ padding: '0 1rem' }}>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search Table View companies"
            style={{ width: '100%', boxSizing: 'border-box', padding: '0.4rem 0.55rem', border: '1px solid var(--color-border, #CBD5E1)', borderRadius: 6, fontSize: '0.8rem', fontFamily: 'inherit' }}
          />
        </div>

        <div style={{ overflowY: 'auto', padding: '0.4rem 0.5rem', minHeight: 60 }}>
          {query.trim() && matches.length === 0 && (
            <div style={{ fontSize: '0.75rem', color: '#94A3B8', padding: '0.4rem 0.5rem' }}>
              No Table View company matches “{query.trim()}”.
            </div>
          )}
          {matches.map(p => (
            <button
              key={p.id}
              type="button"
              disabled={creating}
              onClick={() => onMap?.(p)}
              title={`Map this row to "${p.company}"${firmName ? ` and add ${firmName} to its PE Owner` : ''}`}
              style={{ display: 'flex', width: '100%', alignItems: 'baseline', gap: 8, textAlign: 'left', padding: '0.4rem 0.5rem', border: 'none', borderRadius: 6, background: 'transparent', cursor: creating ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: '0.8rem', color: '#0F172A' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#F1F5F9'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ fontWeight: 600 }}>{p.company}</span>
              <span style={{ fontSize: '0.68rem', color: '#94A3B8', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                {[p.status, p.peOwner].filter(Boolean).join(' · ')}
              </span>
            </button>
          ))}
        </div>

        {error && (
          <div style={{ padding: '0 1rem 0.4rem', fontSize: '0.72rem', color: '#B91C1C', fontWeight: 600 }}>{error}</div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.7rem 1rem', borderTop: '1px solid var(--color-border-light, #E2E8F0)' }}>
          <button
            type="button"
            disabled={!name || creating}
            onClick={() => onCreate?.()}
            title={name
              ? `Add "${name}" to Table View${firmName ? ` with ${firmName} as its PE Owner` : ''}, and link this row to it.`
              : 'Give the row a company name first.'}
            style={{ padding: '0.4rem 0.75rem', border: 'none', borderRadius: 6, background: !name || creating ? '#94A3B8' : 'var(--color-accent, #3B7DDD)', color: '#fff', fontSize: '0.78rem', fontWeight: 600, cursor: !name || creating ? 'default' : 'pointer', fontFamily: 'inherit' }}
          >
            {creating ? 'Creating…' : `+ Create “${name || 'company'}”`}
          </button>
          <button
            type="button"
            onClick={() => onClose?.()}
            style={{ marginLeft: 'auto', padding: '0.4rem 0.75rem', border: '1px solid var(--color-border, #CBD5E1)', borderRadius: 6, background: '#fff', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

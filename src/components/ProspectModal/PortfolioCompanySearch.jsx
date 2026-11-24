import { useEffect, useMemo, useRef, useState } from 'react';
import { rankTableViewCompanies } from '../../utils/rankTableViewCompanies';

// Type-ahead above the Portfolio Companies table: search Table View as you
// type and pick a company to add it to this firm's portfolio, already
// mapped to that record. Companies the table already holds stay in the
// list, marked, so it is plain why picking them does nothing. A name that
// is not on Table View can still be added as a plain row (it then gets the
// row's usual "+ Link" button).
//
// Keyboard: Up/Down moves through the list, Enter picks, Escape closes.
export function PortfolioCompanySearch({ prospects = [], linkedIds, onPickProspect, onAddName }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  const matches = useMemo(() => rankTableViewCompanies(prospects, query, 10), [prospects, query]);
  const q = query.trim();
  const exact = matches.some(p => String(p.company || '').trim().toLowerCase() === q.toLowerCase());
  // Every choice in display order: the Table View matches, then the free
  // text add when the query isn't already one of them by exact name.
  const options = useMemo(() => {
    const out = matches.map(p => ({ kind: 'prospect', p, taken: !!linkedIds?.has(p.id) }));
    if (q && !exact && onAddName) out.push({ kind: 'name', name: q });
    return out;
  }, [matches, linkedIds, q, exact, onAddName]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // The highlighted choice, skipping ones already in the table so the
  // default Enter lands on something it can add.
  const selectable = (i) => options[i] && !(options[i].kind === 'prospect' && options[i].taken);
  function step(from, dir) {
    for (let i = from; i >= 0 && i < options.length; i += dir) if (selectable(i)) return i;
    return -1;
  }
  const activeIdx = selectable(active) ? active : step(active, 1);

  function choose(opt) {
    if (!opt || (opt.kind === 'prospect' && opt.taken)) return;
    if (opt.kind === 'prospect') onPickProspect?.(opt.p);
    else onAddName?.(opt.name);
    setQuery('');
    setOpen(false);
    inputRef.current?.focus();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      if (open && q) { e.stopPropagation(); setOpen(false); }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      const n = step(activeIdx + 1, 1);
      if (n >= 0) setActive(n);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const n = step(activeIdx - 1, -1);
      if (n >= 0) setActive(n);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(options[activeIdx]);
    }
  }

  const showList = open && q.length > 0;

  return (
    <div ref={wrapRef} style={{ position: 'relative', flex: '1 1 260px', minWidth: 200, maxWidth: 420 }}>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={e => { setQuery(e.target.value); setActive(0); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search Table View to add a portfolio company..."
        aria-label="Search Table View companies to add to the portfolio"
        aria-expanded={showList}
        aria-autocomplete="list"
        role="combobox"
        style={{ width: '100%', boxSizing: 'border-box', padding: '0.3rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: '5px', fontSize: '0.72rem', fontFamily: 'inherit' }}
      />
      {showList && (
        <div
          role="listbox"
          style={{ position: 'absolute', top: 'calc(100% + 3px)', left: 0, right: 0, zIndex: 30, background: '#fff', border: '1px solid var(--color-border, #CBD5E1)', borderRadius: 6, boxShadow: '0 8px 20px rgba(15, 23, 42, 0.14)', maxHeight: 300, overflowY: 'auto', padding: 3 }}
        >
          {options.length === 0 && (
            <div style={{ fontSize: '0.72rem', color: '#94A3B8', padding: '0.4rem 0.5rem' }}>
              No Table View company matches "{q}".
            </div>
          )}
          {options.map((opt, idx) => {
            const isActive = idx === activeIdx;
            if (opt.kind === 'name') {
              return (
                <div
                  key="__add_name"
                  role="option"
                  aria-selected={isActive}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => choose(opt)}
                  onMouseEnter={() => setActive(idx)}
                  title={`Add "${opt.name}" as a new row. It isn't on Table View; use the row's + Link to map or create it later.`}
                  style={{ padding: '0.35rem 0.5rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.74rem', color: 'var(--color-accent, #3B7DDD)', fontWeight: 600, background: isActive ? '#F1F5F9' : 'transparent', borderTop: matches.length ? '1px solid #E2E8F0' : 'none' }}
                >
                  + Add "{opt.name}" as a new row
                </div>
              );
            }
            const { p, taken } = opt;
            return (
              <div
                key={p.id}
                role="option"
                aria-selected={isActive}
                aria-disabled={taken}
                onMouseDown={e => e.preventDefault()}
                onClick={() => choose(opt)}
                onMouseEnter={() => setActive(idx)}
                title={taken ? `"${p.company}" is already in this portfolio.` : `Add "${p.company}" to this portfolio, mapped to its Table View record.`}
                style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '0.35rem 0.5rem', borderRadius: 4, cursor: taken ? 'default' : 'pointer', fontSize: '0.74rem', color: taken ? '#94A3B8' : '#0F172A', background: isActive && !taken ? '#F1F5F9' : 'transparent' }}
              >
                <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.company}</span>
                <span style={{ fontSize: '0.66rem', color: '#94A3B8', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                  {taken ? 'Already added' : [p.status, p.peOwner].filter(Boolean).join(' · ')}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

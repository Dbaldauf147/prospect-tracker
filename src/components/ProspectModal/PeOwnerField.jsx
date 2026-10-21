import { useEffect, useState } from 'react';
import { splitPeOwners, joinPeOwners } from '../../utils/peOwners';
import styles from './ProspectModal.module.css';

// The company card's PE Owner/Parent Company field. `value` is the
// comma-separated owners string (prospect.peOwner, utils/peOwners); each
// owner shows as a chip with an x, and the box under them adds another,
// picked off the company list (Private Equity first) or typed and ended
// with Enter or a comma. `onChange` gets the whole string back.
export function PeOwnerField({ value, onChange, prospects = [], company = '' }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');

  // Close the list on a click anywhere outside it.
  useEffect(() => {
    if (!open) return undefined;
    const h = e => {
      const t = e.target;
      if (t instanceof Element && t.closest('[data-pe-picker]')) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  // Pull candidates from the full Table View / prospects list, not just Type=PE.
  const allCompanies = (prospects || [])
    .filter(p => p.company && p.company !== company);
  const owners = splitPeOwners(value);
  const ownerSet = new Set(owners.map(o => o.toLowerCase()));
  const q = draft.toLowerCase().trim();
  const addOwner = (name) => {
    const n = String(name || '').trim().replace(/[,;]+$/, '').trim();
    setDraft('');
    if (!n || ownerSet.has(n.toLowerCase())) return;
    onChange(joinPeOwners([...owners, n]));
  };
  const removeOwner = (name) => onChange(joinPeOwners(owners.filter(o => o !== name)));
  // When user is typing, show matches anywhere. Prefer Private Equity type matches first.
  function score(p) {
    const name = (p.company || '').toLowerCase();
    if (!q) return p.type === 'Private Equity' ? 0 : 1;
    if (name.startsWith(q)) return p.type === 'Private Equity' ? 0 : 2;
    if (name.includes(q)) return p.type === 'Private Equity' ? 1 : 3;
    return 99;
  }
  const filtered = allCompanies
    .filter(p => !q || (p.company || '').toLowerCase().includes(q))
    .sort((a, b) => {
      const sa = score(a), sb = score(b);
      if (sa !== sb) return sa - sb;
      return (a.company || '').localeCompare(b.company || '');
    })
    .slice(0, 50);
  return (
    <div style={{ position: 'relative' }} data-pe-picker>
      {owners.length > 0 && (
        <div data-pe-owner-chips style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
          {owners.map(o => (
            <span key={o} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 4px 1px 8px', borderRadius: 999, fontSize: '0.74rem', fontWeight: 600, background: '#F3E8FF', color: '#6D28D9', border: '1px solid #DDD6FE' }}>
              {o}
              <button
                type="button"
                onClick={() => removeOwner(o)}
                title={`Remove ${o}`}
                aria-label={`Remove ${o}`}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, lineHeight: 1, fontSize: '0.8rem', color: '#7C3AED', fontFamily: 'inherit' }}
              >×</button>
            </span>
          ))}
        </div>
      )}
      <input
        className={styles.input}
        value={draft}
        aria-label="Add a PE owner"
        onChange={e => {
          const v = e.target.value;
          // A comma ends the name being typed, like Enter.
          if (/[,;]$/.test(v)) addOwner(v); else setDraft(v);
          setOpen(true);
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); addOwner(draft); }
          else if (e.key === 'Escape') { setDraft(''); setOpen(false); }
        }}
        // A name typed and left is still an owner added.
        onBlur={() => { if (draft.trim()) addOwner(draft); }}
        onFocus={() => setOpen(true)}
        placeholder={owners.length ? '+ Add another owner…' : 'Type a company name…'}
      />
      {open && allCompanies.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 2, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', maxHeight: 260, overflowY: 'auto', zIndex: 100 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '0.5rem 0.75rem', fontSize: '0.72rem', color: '#94A3B8', fontStyle: 'italic' }}>No companies match &quot;{q}&quot;</div>
          ) : filtered.map(p => {
            const isPE = p.type === 'Private Equity';
            const isPicked = ownerSet.has((p.company || '').toLowerCase());
            return (
              <button
                key={p.id}
                type="button"
                onMouseDown={e => { e.preventDefault(); addOwner(p.company); setOpen(false); }}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', width: '100%', padding: '0.4rem 0.75rem', border: 'none', background: isPicked ? '#EFF6FF' : '#fff', textAlign: 'left', cursor: 'pointer', fontSize: '0.78rem', fontFamily: 'inherit', color: '#1E293B' }}
                onMouseEnter={e => { if (!isPicked) e.currentTarget.style.background = '#F8FAFC'; }}
                onMouseLeave={e => { e.currentTarget.style.background = isPicked ? '#EFF6FF' : '#fff'; }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.company}</span>
                {isPE && <span style={{ flexShrink: 0, fontSize: '0.6rem', fontWeight: 700, padding: '1px 6px', borderRadius: 999, background: '#F3E8FF', color: '#7C3AED' }}>PE</span>}
              </button>
            );
          })}
          {!q && allCompanies.length > 50 && (
            <div style={{ padding: '0.35rem 0.75rem', fontSize: '0.65rem', color: '#94A3B8', fontStyle: 'italic', borderTop: '1px solid #F1F5F9' }}>
              Showing first 50 of {allCompanies.length}. Type to narrow.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

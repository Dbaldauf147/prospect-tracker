import { useEffect, useMemo, useState } from 'react';
import { searchOppIndex } from '../../utils/commissionOppMatch';

// Pick the Opps row a commission row is for. Opens on the opps whose BFO
// Opportunity Name best matches the row's Project Name, best first; the
// search box widens it to any opp by Account, name, Scope or Stage.
// Picking one hands it back to the Commissions tab, which fills the row's
// Account Name and BFO Name from it (Scope follows from the BFO Name).
export function CommissionOppPicker({ projectName, current = {}, index, onPick, onClose }) {
  const [term, setTerm] = useState('');
  const results = useMemo(
    () => searchOppIndex(index, term, projectName, { limit: 25 }),
    [index, term, projectName],
  );

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const currentBfo = String(current['BFO Name'] || '').trim().toLowerCase();
  const loaded = !!index?.entries?.length;

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
    >
      <div
        role="dialog"
        aria-label="Pick the opp for this commission"
        onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 10, width: 'min(720px, 94vw)', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 32px rgba(15, 23, 42, 0.25)' }}
      >
        <div style={{ padding: '0.9rem 1rem 0.6rem', borderBottom: '1px solid #E2E8F0' }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0F172A' }}>Pick the opp for this commission</div>
          <div style={{ marginTop: 2, fontSize: '0.75rem', color: '#64748B' }}>
            Project: <span style={{ color: '#0F172A', fontWeight: 600 }}>{projectName || '(no project name)'}</span>
          </div>
          <div style={{ marginTop: 2, fontSize: '0.7rem', color: '#94A3B8' }}>
            Fills Account Name and BFO Name from the opp you pick; Scope follows from the BFO Name.
          </div>
          <input
            autoFocus
            type="text"
            value={term}
            onChange={e => setTerm(e.target.value)}
            placeholder="Search opps by account, BFO opportunity name, scope or stage..."
            style={{ marginTop: '0.6rem', width: '100%', boxSizing: 'border-box', padding: '0.4rem 0.6rem', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: '0.8rem', fontFamily: 'inherit' }}
          />
        </div>
        <div style={{ overflowY: 'auto', padding: '0.4rem 0.5rem' }}>
          {!loaded ? (
            <div style={{ padding: '0.8rem', fontSize: '0.8rem', color: '#B45309' }}>
              Opps data isn't loaded yet: open the Opps tab once, then come back.
            </div>
          ) : results.length === 0 ? (
            <div style={{ padding: '0.8rem', fontSize: '0.8rem', color: '#64748B' }}>
              {term.trim()
                ? 'No opps match that search.'
                : 'No opp has a BFO Opportunity Name close to this project. Search above to find it.'}
            </div>
          ) : (
            <>
              {!term.trim() && (
                <div style={{ padding: '0.2rem 0.5rem 0.4rem', fontSize: '0.68rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Suggested from the BFO opportunity name
                </div>
              )}
              {results.map(({ opp, name, score }) => {
                const isCurrent = name.toLowerCase() === currentBfo;
                const pct = Math.round(score * 100);
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => onPick(opp)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.6rem', width: '100%', textAlign: 'left',
                      padding: '0.45rem 0.55rem', marginBottom: 2, borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                      border: isCurrent ? '1px solid #93C5FD' : '1px solid transparent',
                      background: isCurrent ? '#EFF6FF' : 'transparent',
                    }}
                    onMouseEnter={e => { if (!isCurrent) e.currentTarget.style.background = '#F8FAFC'; }}
                    onMouseLeave={e => { if (!isCurrent) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={name}>
                        {name}{isCurrent && <span style={{ marginLeft: 6, fontSize: '0.65rem', color: '#2563EB' }}>current</span>}
                      </span>
                      <span style={{ display: 'block', fontSize: '0.7rem', color: '#64748B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {[opp.Account || 'No account', opp.Scope || 'No scope', opp.Stage].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    {score > 0 && (
                      <span
                        title="How closely this opp's BFO Opportunity Name matches the project name"
                        style={{
                          flexShrink: 0, fontSize: '0.65rem', fontWeight: 700, padding: '1px 7px', borderRadius: 999,
                          background: pct >= 85 ? '#DCFCE7' : pct >= 60 ? '#FEF9C3' : '#F1F5F9',
                          color: pct >= 85 ? '#166534' : pct >= 60 ? '#854D0E' : '#475569',
                        }}
                      >{pct}% match</span>
                    )}
                  </button>
                );
              })}
            </>
          )}
        </div>
        <div style={{ padding: '0.6rem 1rem', borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            style={{ padding: '0.35rem 0.9rem', border: '1px solid #CBD5E1', background: '#fff', borderRadius: 6, fontSize: '0.78rem', fontFamily: 'inherit', cursor: 'pointer', color: '#334155' }}
          >Cancel</button>
        </div>
      </div>
    </div>
  );
}

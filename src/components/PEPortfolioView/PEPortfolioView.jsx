import { useMemo, useState } from 'react';
import { useUserSettings } from '../../hooks/useUserSettings';
import { useAuth } from '../../contexts/AuthContext';

// Match the stage set used on the company popup's Opportunities list.
const STAGES = ['New', 'Qualifying', 'Proposed', 'Quoting', 'Verbal', 'Won', 'Lost', 'Hold'];
const INACTIVE_STAGES = new Set(['Won', 'Lost', 'Hold']);

function companySlug(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '-');
}

export function PEPortfolioView({ prospects = [], onSelectProspect }) {
  const { user } = useAuth();
  const { settings } = useUserSettings(user);
  const [showInactive, setShowInactive] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [query, setQuery] = useState('');

  const peFirms = useMemo(() => (
    prospects
      .filter(p => p.type === 'Private Equity')
      .sort((a, b) => (a.company || '').localeCompare(b.company || ''))
  ), [prospects]);

  const portfolioByPe = useMemo(() => {
    const map = new Map();
    for (const p of prospects) {
      const owner = (p.peOwner || '').trim().toLowerCase();
      if (!owner) continue;
      if (!map.has(owner)) map.set(owner, []);
      map.get(owner).push(p);
    }
    return map;
  }, [prospects]);

  const deals = settings.companyDeals || {};

  function dealsFor(prospect) {
    return deals[companySlug(prospect.company)] || [];
  }

  function toggle(peId) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(peId)) next.delete(peId);
      else next.add(peId);
      return next;
    });
  }

  const q = query.trim().toLowerCase();
  const filteredFirms = q
    ? peFirms.filter(p => (p.company || '').toLowerCase().includes(q))
    : peFirms;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ padding: '1rem 1.25rem 0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexShrink: 0 }}>
        <div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1E293B', margin: 0 }}>PE Portfolio</h2>
          <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 2, maxWidth: 620 }}>
            Every prospect in My Accounts with Type = <code>Private Equity</code>, with their portfolio companies and opportunities grouped by sales stage.
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.72rem', color: '#475569', cursor: 'pointer' }}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
          <span>Include Won / Lost / Hold</span>
        </label>
      </div>

      <div style={{ padding: '0 1.25rem 0.5rem', flexShrink: 0 }}>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={`Search ${peFirms.length} PE firm${peFirms.length === 1 ? '' : 's'}…`}
          style={{ width: '100%', maxWidth: 400, padding: '0.4rem 0.6rem', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.78rem', fontFamily: 'inherit' }}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 1.25rem 1.25rem', minHeight: 0 }}>
        {filteredFirms.length === 0 ? (
          <div style={{ padding: '1.25rem', textAlign: 'center', background: '#fff', border: '2px dashed #CBD5E1', borderRadius: 8, color: '#475569' }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>
              {peFirms.length === 0 ? 'No PE firms found' : `No firms match "${query}"`}
            </div>
            <div style={{ fontSize: '0.78rem' }}>
              {peFirms.length === 0
                ? <>Scanned {prospects.length} prospect{prospects.length === 1 ? '' : 's'}. Set a prospect's <strong>Type</strong> to <code>Private Equity</code> to list it here.</>
                : `${peFirms.length} total PE firms loaded — adjust your search.`}
            </div>
          </div>
        ) : filteredFirms.map(pe => {
          const portfolio = portfolioByPe.get((pe.company || '').toLowerCase()) || [];
          const allDeals = portfolio.flatMap(p => (dealsFor(p) || []).map(d => ({ ...d, _company: p.company, _prospectId: p.id })));
          const visibleDeals = showInactive ? allDeals : allDeals.filter(d => !INACTIVE_STAGES.has(d.stage));
          const dealsByStage = new Map();
          for (const d of visibleDeals) {
            const key = d.stage || 'New';
            if (!dealsByStage.has(key)) dealsByStage.set(key, []);
            dealsByStage.get(key).push(d);
          }
          const isExpanded = expanded.has(pe.id);
          return (
            <div key={pe.id} style={{ background: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: 8, overflow: 'hidden', marginBottom: '0.5rem' }}>
              <button
                type="button"
                onClick={() => toggle(pe.id)}
                style={{ width: '100%', padding: '0.7rem 1rem', background: '#F8FAFC', border: 'none', borderBottom: isExpanded ? '1px solid #E2E8F0' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
              >
                <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={pe.company}>{pe.company}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.72rem', color: '#64748B', whiteSpace: 'nowrap' }}>
                  <span>{portfolio.length} portfolio {portfolio.length === 1 ? 'company' : 'companies'}</span>
                  <span>·</span>
                  <span>{visibleDeals.length} {visibleDeals.length === 1 ? 'opportunity' : 'opportunities'}</span>
                  <span style={{ marginLeft: '0.4rem', color: '#94A3B8' }}>{isExpanded ? '▾' : '▸'}</span>
                </div>
              </button>

              {isExpanded && (
                <div style={{ padding: '0.75rem 1rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {portfolio.length === 0 ? (
                    <div style={{ fontSize: '0.78rem', color: '#64748B', fontStyle: 'italic' }}>
                      No portfolio companies point to this PE firm. Open a portfolio company's popup and set its <strong>PE Owner</strong> to &quot;{pe.company}&quot;.
                    </div>
                  ) : (
                    <>
                      {STAGES.filter(s => showInactive || !INACTIVE_STAGES.has(s)).map(stage => {
                        const list = dealsByStage.get(stage) || [];
                        if (list.length === 0) return null;
                        return (
                          <div key={stage} style={{ background: '#FBFBFB', border: '1px solid #E2E8F0', borderRadius: 6, padding: '0.55rem 0.75rem' }}>
                            <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#475569', marginBottom: '0.4rem' }}>
                              {stage} <span style={{ color: '#94A3B8', fontWeight: 500 }}>({list.length})</span>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '0.4rem' }}>
                              {list.map(d => {
                                const parent = prospects.find(p => p.id === d._prospectId);
                                return (
                                  <div
                                    key={`${d._prospectId}-${d.id}`}
                                    onClick={() => parent && onSelectProspect?.(parent)}
                                    style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 4, padding: '0.45rem 0.6rem', cursor: 'pointer' }}
                                    onMouseEnter={e => e.currentTarget.style.borderColor = '#3B82F6'}
                                    onMouseLeave={e => e.currentTarget.style.borderColor = '#E2E8F0'}
                                  >
                                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title || '(Untitled opportunity)'}</div>
                                    <div style={{ fontSize: '0.68rem', color: '#3B82F6', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d._company}</div>
                                    {d.value && <div style={{ fontSize: '0.72rem', color: '#059669', fontWeight: 600 }}>${d.value}</div>}
                                    {d.closeDate && <div style={{ fontSize: '0.65rem', color: '#94A3B8' }}>Close: {d.closeDate}</div>}
                                    {d.description && <div style={{ fontSize: '0.68rem', color: '#475569', marginTop: 2, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{d.description}</div>}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                      {visibleDeals.length === 0 && (
                        <div style={{ fontSize: '0.78rem', color: '#64748B', fontStyle: 'italic' }}>
                          No {showInactive ? '' : 'active '}opportunities yet on this PE firm's portfolio.
                        </div>
                      )}
                      <div style={{ paddingTop: '0.4rem', borderTop: '1px dashed #E2E8F0' }}>
                        <div style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94A3B8', marginBottom: '0.3rem' }}>
                          Linked portfolio companies
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                          {portfolio.map(p => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => onSelectProspect?.(p)}
                              style={{ padding: '2px 10px', background: '#EFF6FF', color: '#3B82F6', border: '1px solid #3B82F6', borderRadius: 999, fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                              onMouseEnter={e => { e.currentTarget.style.background = '#3B82F6'; e.currentTarget.style.color = '#fff'; }}
                              onMouseLeave={e => { e.currentTarget.style.background = '#EFF6FF'; e.currentTarget.style.color = '#3B82F6'; }}
                            >{p.company}</button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

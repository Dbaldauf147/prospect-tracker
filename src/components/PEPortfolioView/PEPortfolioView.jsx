import { useMemo, useState } from 'react';
import { useUserSettings } from '../../hooks/useUserSettings';
import { useAuth } from '../../contexts/AuthContext';
import styles from './PEPortfolioView.module.css';

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

  // Every prospect in My Accounts whose Type is Private Equity shows up here,
  // regardless of status — "active" here refers to the linked opportunities, not the PE firm itself.
  const peFirms = useMemo(() => (
    prospects
      .filter(p => p.type === 'Private Equity')
      .sort((a, b) => (a.company || '').localeCompare(b.company || ''))
  ), [prospects]);

  // peOwner (string) -> array of portfolio prospects. Case-insensitive match on company name.
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

  // For each portfolio company, grab its deals from settings.companyDeals[slug].
  function dealsFor(prospect) {
    const slug = companySlug(prospect.company);
    return deals[slug] || [];
  }

  function toggle(peId) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(peId)) next.delete(peId);
      else next.add(peId);
      return next;
    });
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden', background: '#F8FAFC' }}>
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

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 1.25rem 1.25rem', minHeight: 0 }}>
        <div style={{ padding: '0.5rem 0.75rem', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 6, marginBottom: '0.5rem', fontSize: '0.72rem', color: '#92400E' }}>
          Debug: {prospects.length} total prospects loaded, {peFirms.length} with Type = &quot;Private Equity&quot;.
        </div>
        {peFirms.length === 0 ? (
          <div style={{ padding: '1.25rem', textAlign: 'center', background: '#fff', border: '2px dashed #CBD5E1', borderRadius: 8, color: '#475569' }}>
            <div style={{ marginBottom: '0.5rem', fontWeight: 600, fontSize: '0.9rem' }}>No PE firms found</div>
            <div style={{ fontSize: '0.78rem' }}>
              Scanned {prospects.length} prospect{prospects.length === 1 ? '' : 's'} in My Accounts — none had Type set to <code>Private Equity</code>.
              Open a PE firm's popup and set its <strong>Type</strong> field to <code>Private Equity</code> to make it appear here.
            </div>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: '0.5rem', fontSize: '0.75rem', color: '#DC2626', fontWeight: 700 }}>
              Rendering {peFirms.length} PE firm{peFirms.length === 1 ? '' : 's'}…
            </div>
            {peFirms.slice(0, 20).map((pe, i) => (
              <div key={pe.id || `pe-${i}`} style={{ padding: '0.5rem 0.75rem', background: '#FFFFFF', border: '2px solid #3B82F6', borderRadius: 6, marginBottom: '0.35rem', color: '#1E293B', fontSize: '0.85rem', fontWeight: 600 }}>
                {i + 1}. {pe.company || '(no company name)'} — id: {String(pe.id || 'missing')}
              </div>
            ))}
            {peFirms.length > 20 && (
              <div style={{ fontSize: '0.7rem', color: '#64748B', fontStyle: 'italic' }}>
                …and {peFirms.length - 20} more. Limiting to first 20 for now while we debug rendering.
              </div>
            )}
          </>
        )}
        {false && peFirms.map(pe => {
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
            <div key={pe.id} style={{ background: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.05)', marginBottom: '0.5rem' }}>
              <button
                type="button"
                onClick={() => toggle(pe.id)}
                style={{ width: '100%', padding: '0.7rem 1rem', background: '#F8FAFC', border: 'none', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
              >
                <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={pe.company}>{pe.company}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.72rem', color: '#64748B', whiteSpace: 'nowrap' }}>
                  <span>{portfolio.length} portfolio {portfolio.length === 1 ? 'company' : 'companies'}</span>
                  <span>·</span>
                  <span>{visibleDeals.length} {visibleDeals.length === 1 ? 'opportunity' : 'opportunities'}</span>
                  <span style={{ marginLeft: '0.4rem', color: '#94A3B8' }}>{isExpanded ? '▾' : '▸'}</span>
                </div>
              </button>

              {isExpanded && (
                <div className={styles.peBody}>
                  {portfolio.length === 0 ? (
                    <div className={styles.noneNote}>
                      No portfolio companies point to this PE firm. Open a portfolio company's popup and set its <strong>PE Owner</strong>.
                    </div>
                  ) : (
                    <>
                      {STAGES.filter(s => showInactive || !INACTIVE_STAGES.has(s)).map(stage => {
                        const list = dealsByStage.get(stage) || [];
                        if (list.length === 0) return null;
                        return (
                          <div key={stage} className={styles.stageBlock}>
                            <div className={styles.stageLabel}>{stage} <span className={styles.stageCount}>({list.length})</span></div>
                            <div className={styles.stageGrid}>
                              {list.map(d => {
                                const parent = prospects.find(p => p.id === d._prospectId);
                                return (
                                  <div key={`${d._prospectId}-${d.id}`} className={styles.dealCard}
                                    onClick={() => parent && onSelectProspect?.(parent)}
                                  >
                                    <div className={styles.dealTitle}>{d.title || '(Untitled opportunity)'}</div>
                                    <div className={styles.dealCompany}>{d._company}</div>
                                    {d.value && <div className={styles.dealValue}>${d.value}</div>}
                                    {d.closeDate && <div className={styles.dealDate}>Close: {d.closeDate}</div>}
                                    {d.description && <div className={styles.dealDescription}>{d.description}</div>}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                      {visibleDeals.length === 0 && (
                        <div className={styles.noneNote}>
                          No {showInactive ? '' : 'active '}opportunities yet. Open a portfolio company and add one under its <strong>Opportunities</strong> section.
                        </div>
                      )}
                      <div className={styles.portfolioList}>
                        <div className={styles.portfolioHeader}>Linked portfolio companies</div>
                        <div className={styles.portfolioRow}>
                          {portfolio.map(p => (
                            <button
                              key={p.id}
                              type="button"
                              className={styles.portfolioChip}
                              onClick={() => onSelectProspect?.(p)}
                            >
                              {p.company}
                            </button>
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

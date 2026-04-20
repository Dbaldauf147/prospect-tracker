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

function isActiveProspect(p) {
  return p.status && p.status !== 'Lost - Not Sold';
}

export function PEPortfolioView({ prospects = [], onSelectProspect }) {
  const { user } = useAuth();
  const { settings } = useUserSettings(user);
  const [showInactive, setShowInactive] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());

  // All active PE firms from the prospects list.
  const peFirms = useMemo(() => (
    prospects
      .filter(p => p.type === 'Private Equity' && isActiveProspect(p))
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
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>PE Portfolio</h2>
          <div className={styles.subtitle}>
            Active Private Equity firms from My Accounts, with their portfolio companies and live opportunities grouped by sales stage.
          </div>
        </div>
        <label className={styles.inactiveToggle}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
          <span>Include Won / Lost / Hold</span>
        </label>
      </div>

      <div className={styles.body}>
        {peFirms.length === 0 ? (
          <div className={styles.empty}>
            No active PE firms found. Set a prospect's <strong>Type</strong> to <code>Private Equity</code> in My Accounts to see it here.
          </div>
        ) : peFirms.map(pe => {
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
            <div key={pe.id} className={styles.peCard}>
              <button
                type="button"
                className={styles.peHeader}
                onClick={() => toggle(pe.id)}
              >
                <div className={styles.peName} title={pe.company}>{pe.company}</div>
                <div className={styles.peMeta}>
                  <span>{portfolio.length} portfolio {portfolio.length === 1 ? 'company' : 'companies'}</span>
                  <span>·</span>
                  <span>{visibleDeals.length} {visibleDeals.length === 1 ? 'opportunity' : 'opportunities'}</span>
                  <span className={styles.expandArrow}>{isExpanded ? '▾' : '▸'}</span>
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

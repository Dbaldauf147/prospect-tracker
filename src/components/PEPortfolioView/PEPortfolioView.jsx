import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';

// Closed/invalid stages from the Opps tab — these shouldn't count toward "active pipeline".
const CLOSED_STAGES = new Set(['Sold', 'Not Sold', 'Closed', 'Lost']);
const INVALID_STAGES = new Set(['#N/A', '#REF!', '#VALUE!', '#ERROR!', 'N/A', 'n/a', '-', '']);

// Same fuzzy match the My Accounts table uses, so the Opps column here agrees with that one.
function companiesMatch(a, b) {
  const na = (a || '').toLowerCase().trim();
  const nb = (b || '').toLowerCase().trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length >= nb.length ? nb : na;
  if (shorter.length >= 4 && shorter.length >= longer.length * 0.6 && longer.includes(shorter)) return true;
  const strip = s => s.replace(/\b(inc|llc|ltd|corp|co|lp)\b\.?/gi, '').replace(/[^a-z0-9 ]/g, '').trim();
  const sa = strip(na);
  const sb = strip(nb);
  if (sa === sb) return true;
  const sLonger = sa.length >= sb.length ? sa : sb;
  const sShorter = sa.length >= sb.length ? sb : sa;
  if (sShorter.length >= 4 && sShorter.length >= sLonger.length * 0.6 && sLonger.includes(sShorter)) return true;
  return false;
}

// Matches the fallback chain MyAccountsView uses: version-agnostic
// IndexedDB open (so a settings-backups VersionError doesn't wipe us
// out), then localStorage, then the user's Firestore oppsData doc.
// Without the Firestore tier this view was showing "No Opps data loaded"
// even when the other tabs had synced fine from Firestore.
function useOppsRecords(userId) {
  const [records, setRecords] = useState([]);
  useEffect(() => {
    let cancelled = false;
    function loadFromIndexedDB() {
      return new Promise((resolve) => {
        try {
          const req = indexedDB.open('prospect-tracker-db');
          req.onsuccess = () => {
            const idb = req.result;
            if (!idb.objectStoreNames.contains('opps-cache')) return resolve(null);
            const tx = idb.transaction('opps-cache', 'readonly');
            const store = tx.objectStore('opps-cache');
            const getReq = store.get('data');
            getReq.onsuccess = () => resolve(getReq.result?.records || null);
            getReq.onerror = () => resolve(null);
          };
          req.onerror = () => resolve(null);
        } catch { resolve(null); }
      });
    }
    function loadFromLocalStorage() {
      try {
        const cache = JSON.parse(localStorage.getItem('opps-cache'));
        return cache?.records || null;
      } catch { return null; }
    }
    async function loadFromFirestore() {
      if (!userId) return null;
      try {
        const ref = doc(db, 'oppsData', userId);
        const snap = await getDoc(ref);
        if (!snap.exists()) return null;
        const raw = snap.data();
        if (!raw?.json) return null;
        const parsed = JSON.parse(raw.json);
        return parsed?.records || null;
      } catch { return null; }
    }
    (async () => {
      let recs = await loadFromIndexedDB();
      if (!recs || recs.length === 0) recs = loadFromLocalStorage();
      if (!recs || recs.length === 0) recs = await loadFromFirestore();
      if (!cancelled && recs && recs.length > 0) setRecords(recs);
    })();
    return () => { cancelled = true; };
  }, [userId]);
  return records;
}

export function PEPortfolioView({ prospects = [], onSelectProspect }) {
  const { user } = useAuth();
  const [showClosed, setShowClosed] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [query, setQuery] = useState('');
  const oppsRecords = useOppsRecords(user?.uid);

  const peFirms = useMemo(() => (
    prospects
      .filter(p => p.type === 'Private Equity')
      .sort((a, b) => (a.company || '').localeCompare(b.company || ''))
  ), [prospects]);

  // Portfolio company → PE firm (lowercased name) lookup, from each prospect's peOwner field.
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

  // Bucket each Opps row into a portfolio company (using fuzzy account-name match).
  // Produces: Map<prospectId, Array<oppRecord>>
  const oppsByProspectId = useMemo(() => {
    const map = new Map();
    if (oppsRecords.length === 0) return map;
    // Narrow search to only prospects that are tagged as portfolio companies
    const portfolioProspects = prospects.filter(p => (p.peOwner || '').trim());
    for (const p of portfolioProspects) {
      const list = [];
      const name = (p.company || '').toLowerCase();
      if (!name) continue;
      for (const r of oppsRecords) {
        const acct = (r['Account'] || '').toLowerCase();
        if (companiesMatch(name, acct)) list.push(r);
      }
      if (list.length > 0) map.set(p.id, list);
    }
    return map;
  }, [prospects, oppsRecords]);

  const firmOppCount = useMemo(() => {
    const counts = new Map();
    for (const pe of peFirms) {
      const portfolio = portfolioByPe.get((pe.company || '').trim().toLowerCase()) || [];
      let n = 0;
      for (const p of portfolio) {
        const opps = oppsByProspectId.get(p.id) || [];
        for (const r of opps) {
          const stage = (r['Stage'] || '').trim();
          if (INVALID_STAGES.has(stage)) continue;
          if (!showClosed && CLOSED_STAGES.has(stage)) continue;
          n += 1;
        }
      }
      counts.set(pe.id, n);
    }
    return counts;
  }, [peFirms, portfolioByPe, oppsByProspectId, showClosed]);

  // Per-firm open / closed opp counts — used as columns on each firm
  // card so you can see at a glance which PE firms have a history
  // (open, closed, or both) without expanding anything.
  const oppStateByFirm = useMemo(() => {
    const out = new Map();
    for (const pe of peFirms) {
      const portfolio = portfolioByPe.get((pe.company || '').trim().toLowerCase()) || [];
      let open = 0;
      let closed = 0;
      for (const p of portfolio) {
        const opps = oppsByProspectId.get(p.id) || [];
        for (const r of opps) {
          const stage = (r['Stage'] || '').trim();
          if (INVALID_STAGES.has(stage)) continue;
          if (CLOSED_STAGES.has(stage)) closed++;
          else open++;
        }
      }
      out.set(pe.id, { open, closed });
    }
    return out;
  }, [peFirms, portfolioByPe, oppsByProspectId]);

  const sortedPeFirms = useMemo(() => (
    [...peFirms].sort((a, b) => {
      const ca = firmOppCount.get(a.id) || 0;
      const cb = firmOppCount.get(b.id) || 0;
      if (ca !== cb) return cb - ca;
      return (a.company || '').localeCompare(b.company || '');
    })
  ), [peFirms, firmOppCount]);

  const q = query.trim().toLowerCase();
  const filteredFirms = q
    ? sortedPeFirms.filter(p => (p.company || '').toLowerCase().includes(q))
    : sortedPeFirms;

  function toggle(peId) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(peId)) next.delete(peId);
      else next.add(peId);
      return next;
    });
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ padding: '1rem 1.25rem 0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexShrink: 0 }}>
        <div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1E293B', margin: 0 }}>PE Portfolio</h2>
          <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 2, maxWidth: 640 }}>
            Every prospect with Type = <code>Private Equity</code>, sorted by pipeline from their portfolio companies. Opportunity counts come from the <strong>Opps</strong> tab (same as the Opps column in My Accounts).
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.72rem', color: '#475569', cursor: 'pointer' }}>
          <input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} />
          <span>Include closed (Sold / Not Sold / Lost)</span>
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
        {oppsRecords.length === 0 && (
          <div style={{ padding: '0.6rem 0.8rem', marginBottom: '0.5rem', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 6, fontSize: '0.72rem', color: '#92400E' }}>
            No Opps data loaded. Open the <strong>Opps</strong> tab once to sync it from Google Sheets; counts will populate here afterwards.
          </div>
        )}
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
          const portfolio = portfolioByPe.get((pe.company || '').trim().toLowerCase()) || [];
          const allOpps = portfolio.flatMap(p => (oppsByProspectId.get(p.id) || []).map(r => ({ ...r, _company: p.company, _prospectId: p.id })));
          const visibleOpps = allOpps.filter(r => {
            const stage = (r['Stage'] || '').trim();
            if (INVALID_STAGES.has(stage)) return false;
            if (!showClosed && CLOSED_STAGES.has(stage)) return false;
            return true;
          });
          const oppsByStage = new Map();
          for (const r of visibleOpps) {
            const key = (r['Stage'] || 'Unspecified').trim() || 'Unspecified';
            if (!oppsByStage.has(key)) oppsByStage.set(key, []);
            oppsByStage.get(key).push(r);
          }
          const stageOrder = Array.from(oppsByStage.keys()).sort((a, b) => a.localeCompare(b));
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
                  <span>{visibleOpps.length} {visibleOpps.length === 1 ? 'opportunity' : 'opportunities'}</span>
                  <span>·</span>
                  {(() => {
                    const state = oppStateByFirm.get(pe.id) || { open: 0, closed: 0 };
                    return (
                      <>
                        <span
                          title={state.open > 0
                            ? `${state.open} open ${state.open === 1 ? 'opportunity' : 'opportunities'} in progress`
                            : 'No open opportunities on this firm\'s portfolio'}
                          style={{
                            padding: '1px 8px',
                            borderRadius: 999,
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            background: state.open > 0 ? '#DCFCE7' : '#F1F5F9',
                            color: state.open > 0 ? '#166534' : '#94A3B8',
                            border: `1px solid ${state.open > 0 ? '#86EFAC' : '#E2E8F0'}`,
                          }}
                        >Open {state.open}</span>
                        <span
                          title={state.closed > 0
                            ? `${state.closed} closed ${state.closed === 1 ? 'opportunity' : 'opportunities'} (Sold / Not Sold / Lost)`
                            : 'No closed opportunities on this firm\'s portfolio'}
                          style={{
                            padding: '1px 8px',
                            borderRadius: 999,
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            background: state.closed > 0 ? '#FEE2E2' : '#F1F5F9',
                            color: state.closed > 0 ? '#991B1B' : '#94A3B8',
                            border: `1px solid ${state.closed > 0 ? '#FCA5A5' : '#E2E8F0'}`,
                          }}
                        >Closed {state.closed}</span>
                      </>
                    );
                  })()}
                  <span>·</span>
                  {(() => {
                    const uploadedCount = Array.isArray(pe.portfolioCompanies) ? pe.portfolioCompanies.length : 0;
                    const hasUploaded = uploadedCount > 0;
                    return (
                      <span
                        title={hasUploaded
                          ? `Popup page has ${uploadedCount} uploaded portfolio ${uploadedCount === 1 ? 'company' : 'companies'}`
                          : 'No portfolio companies uploaded on this firm\'s popup page yet'}
                        style={{
                          padding: '1px 8px',
                          borderRadius: 999,
                          fontSize: '0.65rem',
                          fontWeight: 700,
                          background: hasUploaded ? '#EDE9FE' : '#F1F5F9',
                          color: hasUploaded ? '#5B21B6' : '#64748B',
                          border: `1px solid ${hasUploaded ? '#C4B5FD' : '#CBD5E1'}`,
                        }}
                      >{hasUploaded ? `◆ ${uploadedCount} uploaded` : '◇ none uploaded'}</span>
                    );
                  })()}
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
                      {stageOrder.map(stage => {
                        const list = oppsByStage.get(stage) || [];
                        return (
                          <div key={stage} style={{ background: '#FBFBFB', border: '1px solid #E2E8F0', borderRadius: 6, padding: '0.55rem 0.75rem' }}>
                            <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#475569', marginBottom: '0.4rem' }}>
                              {stage} <span style={{ color: '#94A3B8', fontWeight: 500 }}>({list.length})</span>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.4rem' }}>
                              {list.map((r, idx) => {
                                const parent = prospects.find(p => p.id === r._prospectId);
                                const title = r['Opportunity Name'] || r['Opportunity'] || r['Name'] || r['Description'] || '(Unnamed opportunity)';
                                const value = r['Amount'] || r['Value'] || r['$'] || '';
                                const closeDate = r['Close Date'] || r['Est. Close'] || r['Target Close'] || '';
                                return (
                                  <div
                                    key={`${r._prospectId}-${idx}`}
                                    onClick={() => parent && onSelectProspect?.(parent)}
                                    style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 4, padding: '0.45rem 0.6rem', cursor: 'pointer' }}
                                    onMouseEnter={e => e.currentTarget.style.borderColor = '#3B82F6'}
                                    onMouseLeave={e => e.currentTarget.style.borderColor = '#E2E8F0'}
                                  >
                                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
                                    <div style={{ fontSize: '0.68rem', color: '#3B82F6', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r._company}</div>
                                    {value && <div style={{ fontSize: '0.72rem', color: '#059669', fontWeight: 600 }}>{String(value).startsWith('$') ? value : `$${value}`}</div>}
                                    {closeDate && <div style={{ fontSize: '0.65rem', color: '#94A3B8' }}>Close: {closeDate}</div>}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                      {visibleOpps.length === 0 && (
                        <div style={{ fontSize: '0.78rem', color: '#64748B', fontStyle: 'italic' }}>
                          No {showClosed ? '' : 'active '}opportunities on this PE firm's portfolio in the Opps tab.
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

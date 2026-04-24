import { useEffect, useMemo, useState, useRef } from 'react';
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
  // Persisted column widths + sort so the layout survives reloads.
  const DEFAULT_COL_WIDTHS = { company: 240, dm: 170, met: 170, mapping: 110, opps: 100, ratio: 120, clients: 110 };
  const [colWidths, setColWidths] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('pe-portfolio:col-widths')) || {};
      return { ...DEFAULT_COL_WIDTHS, ...saved };
    } catch { return DEFAULT_COL_WIDTHS; }
  });
  const [sortKey, setSortKey] = useState(() => localStorage.getItem('pe-portfolio:sort-key') || 'ratio');
  const [sortDir, setSortDir] = useState(() => localStorage.getItem('pe-portfolio:sort-dir') || 'desc');
  useEffect(() => {
    try { localStorage.setItem('pe-portfolio:col-widths', JSON.stringify(colWidths)); } catch {}
  }, [colWidths]);
  useEffect(() => {
    try { localStorage.setItem('pe-portfolio:sort-key', sortKey); } catch {}
  }, [sortKey]);
  useEffect(() => {
    try { localStorage.setItem('pe-portfolio:sort-dir', sortDir); } catch {}
  }, [sortDir]);
  const resizingRef = useRef(null);
  function startResize(colKey, e) {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { key: colKey, startX: e.clientX, startWidth: colWidths[colKey] || 100 };
    const onMove = (ev) => {
      if (!resizingRef.current) return;
      const delta = ev.clientX - resizingRef.current.startX;
      const next = Math.max(60, resizingRef.current.startWidth + delta);
      setColWidths(prev => ({ ...prev, [resizingRef.current.key]: next }));
    };
    const onUp = () => {
      resizingRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }
  function toggleSort(key) {
    setSortDir(prev => (sortKey === key ? (prev === 'asc' ? 'desc' : 'asc') : 'desc'));
    setSortKey(key);
  }
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

  // HubSpot decision-maker lookup — replicates MyAccountsView's rule
  // (contact has a 'decision maker' tag, not hidden). Keyed by the
  // lower-cased company name in the contact record; each entry is an
  // array of { name, metInPerson, city } so the PE Portfolio table
  // can show the met-in-person ratio and a NYC breakdown.
  const decisionMakerByCompany = useMemo(() => {
    const map = new Map();
    try {
      const cache = JSON.parse(localStorage.getItem('hubspot-sync-cache'));
      for (const c of (cache?.contacts || [])) {
        const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
        if (tags.includes('hide')) continue;
        if (!tags.includes('decision maker')) continue;
        const lower = (c.company || '').toLowerCase().trim();
        if (!lower) continue;
        if (!map.has(lower)) map.set(lower, []);
        const name = [c.firstname, c.lastname].filter(Boolean).join(' ') || c.email || 'Unknown';
        const metInPerson = tags.includes('met in person');
        const city = String(c.city || '').trim();
        map.get(lower).push({ name, metInPerson, city });
      }
    } catch {}
    return map;
  }, []);

  // Per-firm stage stats — the row-level data behind the stages table.
  //   decisionMakerNames  : DM contacts on this PE firm (or its PCs)
  //   pcMappingCount      : portfolio companies linked via peOwner
  //   pcOppsCount         : PCs that have ≥1 opp (any stage)
  //   activeOpps, totalOpps : aggregated across the PE firm + all PCs,
  //                           active = non-closed non-invalid stage;
  //                           total = every non-invalid stage
  //   pcClientCount       : PCs where status === 'Client'
  const stageStatsByFirm = useMemo(() => {
    const out = new Map();
    for (const pe of peFirms) {
      const portfolio = portfolioByPe.get((pe.company || '').trim().toLowerCase()) || [];
      const firmName = (pe.company || '').trim().toLowerCase();
      // DM: match on the firm name OR any portfolio company name.
      // Each entry is { name, metInPerson, city } so the stages table
      // can show a met-in-person ratio + NYC count.
      const dmEntries = [];
      const dmSeen = new Set();
      const dmCandidates = [firmName, ...portfolio.map(p => (p.company || '').toLowerCase().trim()).filter(Boolean)];
      for (const [dmCompany, items] of decisionMakerByCompany.entries()) {
        if (dmCandidates.some(n => companiesMatch(n, dmCompany))) {
          for (const item of items) {
            if (!dmSeen.has(item.name)) { dmSeen.add(item.name); dmEntries.push(item); }
          }
        }
      }
      const dmNames = dmEntries.map(e => e.name);
      const metInPersonCount = dmEntries.filter(e => e.metInPerson).length;
      const nycCount = dmEntries.filter(e => /(new york|nyc)/i.test(e.city || '')).length;

      // PC Opps — PCs with ≥1 opp.
      let pcOppsCount = 0;
      for (const p of portfolio) {
        if ((oppsByProspectId.get(p.id) || []).length > 0) pcOppsCount++;
      }

      // Aggregate opps for the PE firm itself + every portfolio company.
      // We re-scan the Opps records so we also catch opps that land
      // directly on the PE firm's account name (not just its PCs).
      let active = 0;
      let total = 0;
      const oppsNames = [firmName, ...portfolio.map(p => (p.company || '').toLowerCase().trim()).filter(Boolean)];
      for (const r of oppsRecords) {
        const stage = (r['Stage'] || '').trim();
        if (INVALID_STAGES.has(stage)) continue;
        const acct = (r['Account'] || '').toLowerCase();
        if (!acct) continue;
        if (!oppsNames.some(n => companiesMatch(n, acct))) continue;
        total++;
        if (!CLOSED_STAGES.has(stage)) active++;
      }

      // PCs that have converted to Clients.
      const pcClientCount = portfolio.filter(p => p.status === 'Client').length;

      out.set(pe.id, {
        decisionMakerNames: dmNames,
        decisionMakerEntries: dmEntries,
        metInPersonCount,
        nycCount,
        pcMappingCount: portfolio.length,
        pcOppsCount,
        activeOpps: active,
        totalOpps: total,
        pcClientCount,
      });
    }
    return out;
  }, [peFirms, portfolioByPe, oppsByProspectId, decisionMakerByCompany, oppsRecords]);

  const sortedPeFirms = useMemo(() => {
    const arr = [...peFirms];
    arr.sort((a, b) => {
      const sa = stageStatsByFirm.get(a.id) || {};
      const sb = stageStatsByFirm.get(b.id) || {};
      let cmp = 0;
      switch (sortKey) {
        case 'company':
          cmp = (a.company || '').localeCompare(b.company || '');
          break;
        case 'dm':
          cmp = ((sa.decisionMakerNames || []).length) - ((sb.decisionMakerNames || []).length);
          break;
        case 'met':
          cmp = (sa.metInPersonCount || 0) - (sb.metInPersonCount || 0);
          if (cmp === 0) cmp = (sa.nycCount || 0) - (sb.nycCount || 0);
          break;
        case 'mapping':
          cmp = (sa.pcMappingCount || 0) - (sb.pcMappingCount || 0);
          break;
        case 'opps':
          cmp = (sa.pcOppsCount || 0) - (sb.pcOppsCount || 0);
          break;
        case 'ratio':
          cmp = (sa.activeOpps || 0) - (sb.activeOpps || 0);
          if (cmp === 0) cmp = (sa.totalOpps || 0) - (sb.totalOpps || 0);
          break;
        case 'clients':
          cmp = (sa.pcClientCount || 0) - (sb.pcClientCount || 0);
          break;
        default:
          cmp = 0;
      }
      if (sortDir === 'desc') cmp = -cmp;
      if (cmp === 0) cmp = (a.company || '').localeCompare(b.company || '');
      return cmp;
    });
    return arr;
  }, [peFirms, stageStatsByFirm, sortKey, sortDir]);

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
        ) : (() => {
          const GRID = `${colWidths.company}px ${colWidths.dm}px ${colWidths.met}px ${colWidths.mapping}px ${colWidths.opps}px ${colWidths.ratio}px ${colWidths.clients}px 28px`;
          const HEADER_COLUMNS = [
            { key: 'company', label: 'PE firm', align: 'left',   tip: 'Sort by company name' },
            { key: 'dm',      label: 'Decision Maker Found?', align: 'left', tip: 'Sort by number of decision makers found on HubSpot' },
            { key: 'met',     label: 'Met in Person', align: 'left', tip: 'Met-in-person count / total decision makers, plus how many of them list New York / NYC as their city' },
            { key: 'mapping', label: 'PC Mapping', align: 'center', tip: 'Count of portfolio companies linked to this PE firm via the peOwner field' },
            { key: 'opps',    label: 'PC Opps', align: 'center',    tip: 'Count of portfolio companies that have at least one opportunity in the Opps tab' },
            { key: 'ratio',   label: 'PC Opps 2/4', align: 'center', tip: 'Active / total opps aggregated across the PE firm plus every portfolio company' },
            { key: 'clients', label: 'PC Clients', align: 'center',  tip: 'Portfolio companies currently set to status = Client' },
          ];
          const SORT_GLYPH = (key) => sortKey === key ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '';
          const RESIZE_HANDLE = { position: 'absolute', top: 0, right: 0, bottom: 0, width: 6, cursor: 'col-resize', userSelect: 'none' };
          return (
            <div style={{ background: '#fff', border: '1px solid #CBD5E1', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: GRID, background: '#F1F5F9', borderBottom: '1px solid #CBD5E1', position: 'sticky', top: 0, zIndex: 1 }}>
                {HEADER_COLUMNS.map(c => (
                  <div
                    key={c.key}
                    onClick={() => toggleSort(c.key)}
                    title={c.tip}
                    style={{
                      position: 'relative',
                      padding: '0.35rem 0.6rem',
                      fontSize: '0.62rem',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      color: sortKey === c.key ? '#1E293B' : '#475569',
                      textAlign: c.align,
                      cursor: 'pointer',
                      userSelect: 'none',
                      background: sortKey === c.key ? '#E2E8F0' : 'transparent',
                      borderRight: '1px solid #E2E8F0',
                    }}
                  >
                    {c.label}{SORT_GLYPH(c.key)}
                    <span
                      onMouseDown={e => startResize(c.key, e)}
                      onClick={e => e.stopPropagation()}
                      style={RESIZE_HANDLE}
                      title="Drag to resize"
                    />
                  </div>
                ))}
                <div style={{ padding: '0.35rem 0.6rem' }}></div>
              </div>

              {filteredFirms.map((pe, rowIdx) => {
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
                const stats = stageStatsByFirm.get(pe.id) || {};
                const dmFound = (stats.decisionMakerNames || []).length > 0;
                return (
                  <div key={pe.id} style={{ borderTop: rowIdx === 0 ? 'none' : '1px solid #E2E8F0' }}>
                    <button
                      type="button"
                      onClick={() => toggle(pe.id)}
                      style={{ width: '100%', padding: 0, background: isExpanded ? '#F8FAFC' : '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', display: 'grid', gridTemplateColumns: GRID, alignItems: 'center' }}
                    >
                      <div
                        style={{ padding: '0.55rem 0.6rem', fontSize: '0.82rem', fontWeight: 700, color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={pe.company}
                        onClick={e => { e.stopPropagation(); onSelectProspect?.(pe); }}
                      >{pe.company}</div>

                      <div style={{ padding: '0.55rem 0.6rem' }}>
                        <span
                          title={dmFound ? (stats.decisionMakerNames || []).join(', ') : 'No HubSpot contact tagged "decision maker" for this firm or its portfolio companies'}
                          style={{
                            padding: '1px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700,
                            background: dmFound ? '#DCFCE7' : '#FEE2E2',
                            color:      dmFound ? '#166534' : '#991B1B',
                            border: `1px solid ${dmFound ? '#86EFAC' : '#FCA5A5'}`,
                          }}
                        >{dmFound ? `✓ ${(stats.decisionMakerNames || []).length} found` : '✗ Not found'}</span>
                      </div>

                      {(() => {
                        const dmTotal = (stats.decisionMakerNames || []).length;
                        const met = stats.metInPersonCount || 0;
                        const nyc = stats.nycCount || 0;
                        if (dmTotal === 0) {
                          return (
                            <div style={{ padding: '0.55rem 0.6rem', fontSize: '0.72rem', color: '#CBD5E1' }}>—</div>
                          );
                        }
                        const nycList = (stats.decisionMakerEntries || [])
                          .filter(e => /(new york|nyc)/i.test(e.city || ''))
                          .map(e => `${e.name}${e.city ? ` (${e.city})` : ''}`)
                          .join(', ');
                        const metList = (stats.decisionMakerEntries || [])
                          .filter(e => e.metInPerson)
                          .map(e => e.name)
                          .join(', ');
                        const tipParts = [];
                        if (met > 0) tipParts.push(`Met in person: ${metList}`);
                        else tipParts.push('No decision makers tagged "met in person" yet');
                        if (nyc > 0) tipParts.push(`In NY: ${nycList}`);
                        return (
                          <div style={{ padding: '0.55rem 0.6rem', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: '0.72rem' }} title={tipParts.join('\n')}>
                            <span
                              style={{
                                padding: '1px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700,
                                background: met > 0 ? '#DCFCE7' : '#F1F5F9',
                                color:      met > 0 ? '#166534' : '#94A3B8',
                                border: `1px solid ${met > 0 ? '#86EFAC' : '#E2E8F0'}`,
                              }}
                            >{met}/{dmTotal}</span>
                            {nyc > 0 && (
                              <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#5B21B6' }}>
                                ({nyc} in New York)
                              </span>
                            )}
                          </div>
                        );
                      })()}

                      <div style={{ padding: '0.55rem 0.6rem', textAlign: 'center', fontSize: '0.78rem', fontWeight: 700, color: (stats.pcMappingCount || 0) > 0 ? '#1E293B' : '#CBD5E1' }}>
                        {stats.pcMappingCount || 0}
                      </div>

                      <div style={{ padding: '0.55rem 0.6rem', textAlign: 'center', fontSize: '0.78rem', fontWeight: 700, color: (stats.pcOppsCount || 0) > 0 ? '#7C3AED' : '#CBD5E1' }}>
                        {stats.pcOppsCount || 0}
                      </div>

                      <div style={{ padding: '0.55rem 0.6rem', textAlign: 'center', fontSize: '0.78rem', fontWeight: 700, color: (stats.activeOpps || 0) > 0 ? '#7C3AED' : (stats.totalOpps || 0) > 0 ? '#64748B' : '#CBD5E1' }} title="active / total opportunities across this firm and its portfolio companies">
                        {(stats.activeOpps || 0)}/{(stats.totalOpps || 0)}
                      </div>

                      <div style={{ padding: '0.55rem 0.6rem', textAlign: 'center', fontSize: '0.78rem', fontWeight: 700, color: (stats.pcClientCount || 0) > 0 ? '#10B981' : '#CBD5E1' }}>
                        {stats.pcClientCount || 0}
                      </div>

                      <div style={{ padding: '0.55rem 0.2rem', textAlign: 'center', color: '#94A3B8', fontSize: '0.8rem' }}>
                        {isExpanded ? '▾' : '▸'}
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
          );
        })()}
      </div>
    </div>
  );
}

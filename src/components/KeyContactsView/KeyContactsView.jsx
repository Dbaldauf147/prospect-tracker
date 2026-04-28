import { useEffect, useMemo, useState, useRef } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { getHubspotCache } from '../../utils/hubspotContactsCache';
import { dbGet } from '../../utils/db';
import { formatAum } from '../../utils/formatters';

const CLOSED_STAGES = new Set(['Sold', 'Not Sold', 'Closed', 'Lost']);
const INVALID_STAGES = new Set(['#N/A', '#REF!', '#VALUE!', '#ERROR!', 'N/A', 'n/a', '-', '']);

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
  const tokensOf = (s) => s.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const sTokens = tokensOf(shorter);
  if (sTokens.length === 1 && sTokens[0].length >= 3) {
    if (tokensOf(longer).includes(sTokens[0])) return true;
  }
  return false;
}

function useOppsRecords(userId) {
  const [records, setRecords] = useState([]);
  useEffect(() => {
    let cancelled = false;
    async function loadFromIndexedDB() {
      try { const data = await dbGet('opps-cache', 'data'); return data?.records || null; } catch { return null; }
    }
    function loadFromLocalStorage() {
      try { const cache = JSON.parse(localStorage.getItem('opps-cache')); return cache?.records || null; } catch { return null; }
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

export function KeyContactsView({ prospects = [], onSelectProspect }) {
  const { user } = useAuth();
  const [showClosed, setShowClosed] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [query, setQuery] = useState('');
  const [hubspotCache, setHubspotCacheState] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => { getHubspotCache().then(c => { if (!cancelled) setHubspotCacheState(c); }).catch(() => {}); };
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, []);

  const DEFAULT_COL_WIDTHS = { company: 260, aum: 100, type: 120, status: 130, keyContacts: 130, dm: 150, met: 130, ratio: 110 };
  const [colWidths, setColWidths] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('key-contacts:col-widths')) || {};
      return { ...DEFAULT_COL_WIDTHS, ...saved };
    } catch { return DEFAULT_COL_WIDTHS; }
  });
  const [sortKey, setSortKey] = useState(() => localStorage.getItem('key-contacts:sort-key') || 'keyContacts');
  const [sortDir, setSortDir] = useState(() => localStorage.getItem('key-contacts:sort-dir') || 'desc');
  useEffect(() => { try { localStorage.setItem('key-contacts:col-widths', JSON.stringify(colWidths)); } catch {} }, [colWidths]);
  useEffect(() => { try { localStorage.setItem('key-contacts:sort-key', sortKey); } catch {} }, [sortKey]);
  useEffect(() => { try { localStorage.setItem('key-contacts:sort-dir', sortDir); } catch {} }, [sortDir]);

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

  const FREE_MAIL = useMemo(() => new Set([
    'gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com',
    'aol.com', 'me.com', 'proton.me', 'protonmail.com', 'live.com', 'msn.com',
  ]), []);

  // Pull domain off a prospect — manual emailDomain entries plus website hostname.
  const collectProspectDomains = (p, into) => {
    if (!p) return;
    if (p.emailDomain) {
      for (const entry of String(p.emailDomain).split(/[\n;,]+/).map(s => s.trim()).filter(Boolean)) {
        const at = entry.lastIndexOf('@');
        const d = (at >= 0 ? entry.slice(at + 1) : entry).toLowerCase().trim();
        if (d) into.add(d);
      }
    }
    if (p.website) {
      const d = String(p.website).replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '').toLowerCase().trim();
      if (d) into.add(d);
    }
  };

  // Every contact tagged "Dan Key Target" (excluding hidden). One entry per contact;
  // we'll bucket them by company below.
  const keyContacts = useMemo(() => {
    const out = [];
    for (const c of (hubspotCache?.contacts || [])) {
      const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
      if (tags.includes('hide')) continue;
      if (!tags.includes('dan key target')) continue;
      const company = (c.company || '').trim();
      const email = (c.email || '').toLowerCase().trim();
      const at = email.lastIndexOf('@');
      const rawDomain = at >= 0 ? email.slice(at + 1).trim() : '';
      const domain = rawDomain && !FREE_MAIL.has(rawDomain) ? rawDomain : '';
      out.push({
        id: c.id || `${c.email || ''}|${c.firstname || ''}|${c.lastname || ''}`,
        name: [c.firstname, c.lastname].filter(Boolean).join(' ') || c.email || 'Unknown',
        firstname: c.firstname || '',
        lastname: c.lastname || '',
        email: c.email || '',
        phone: c.phone || '',
        jobtitle: c.jobtitle || '',
        linkedin: c.hs_linkedin_url || '',
        city: String(c.city || '').trim(),
        state: String(c.state || '').trim(),
        metInPerson: tags.includes('met in person'),
        company,
        domain,
      });
    }
    return out;
  }, [hubspotCache, FREE_MAIL]);

  // Decision-maker contacts — used for the per-company DM column. Mirrors
  // the equivalent flat-list pattern from the PE Portfolio view.
  const decisionMakers = useMemo(() => {
    const out = [];
    for (const c of (hubspotCache?.contacts || [])) {
      const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
      if (tags.includes('hide')) continue;
      if (!tags.includes('decision maker')) continue;
      const company = (c.company || '').toLowerCase().trim();
      const email = (c.email || '').toLowerCase().trim();
      const at = email.lastIndexOf('@');
      const rawDomain = at >= 0 ? email.slice(at + 1).trim() : '';
      const domain = rawDomain && !FREE_MAIL.has(rawDomain) ? rawDomain : '';
      out.push({
        name: [c.firstname, c.lastname].filter(Boolean).join(' ') || c.email || 'Unknown',
        company,
        domain,
        metInPerson: tags.includes('met in person'),
        city: String(c.city || '').trim(),
      });
    }
    return out;
  }, [hubspotCache, FREE_MAIL]);

  // Build one row per distinct company that has ≥1 Dan Key Target contact.
  // Each row is anchored to a prospect when one matches by name OR domain;
  // otherwise we surface the raw HubSpot company name so contacts on
  // companies that aren't yet prospect records still show up.
  const rows = useMemo(() => {
    if (keyContacts.length === 0) return [];

    // Each row keyed by either prospect.id or `raw:<lowercased company>`.
    const byKey = new Map();

    for (const kc of keyContacts) {
      // Try to find a matching prospect: company-name match first,
      // then domain match.
      let match = null;
      if (kc.company) {
        match = prospects.find(p => companiesMatch(p.company, kc.company));
      }
      if (!match && kc.domain) {
        match = prospects.find(p => {
          const ds = new Set();
          collectProspectDomains(p, ds);
          return ds.has(kc.domain);
        });
      }

      const key = match ? `pid:${match.id}` : `raw:${(kc.company || '(no company)').toLowerCase()}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          key,
          prospect: match || null,
          rawCompany: match ? null : (kc.company || '(no company)'),
          contacts: [],
        });
      }
      byKey.get(key).contacts.push(kc);
    }

    // Compute per-row stats: opps, decision makers, etc.
    const out = [];
    for (const row of byKey.values()) {
      const p = row.prospect;
      const companyName = p?.company || row.rawCompany || '';
      const lowerName = companyName.toLowerCase();

      const domains = new Set();
      if (p) collectProspectDomains(p, domains);
      // Also add the contacts' own domains to widen the DM/opps match —
      // contacts on the same company often share the corporate domain even
      // if no prospect record carries it yet.
      for (const c of row.contacts) {
        if (c.domain) domains.add(c.domain);
      }

      // Decision makers on this company (by name or domain).
      const dmSeen = new Set();
      const dmEntries = [];
      for (const dm of decisionMakers) {
        const matches =
          (dm.company && lowerName && companiesMatch(lowerName, dm.company)) ||
          (dm.domain && domains.has(dm.domain));
        if (!matches) continue;
        if (dmSeen.has(dm.name)) continue;
        dmSeen.add(dm.name);
        dmEntries.push(dm);
      }

      // Opps on this company (any stage; closed filtered later).
      const opps = [];
      for (const r of oppsRecords) {
        const stage = (r['Stage'] || '').trim();
        if (INVALID_STAGES.has(stage)) continue;
        const acct = (r['Account'] || '').toLowerCase();
        if (!acct || !lowerName) continue;
        if (!companiesMatch(lowerName, acct)) continue;
        opps.push(r);
      }
      const activeOpps = opps.filter(r => !CLOSED_STAGES.has((r['Stage'] || '').trim())).length;
      const totalOpps = opps.length;

      // Choose an AUM to display: peAum if set, else reAum.
      const aum = p ? (p.peAum || p.reAum || 0) : 0;

      out.push({
        ...row,
        companyName,
        aum,
        type: p?.type || '',
        status: p?.status || '',
        decisionMakerEntries: dmEntries,
        metInPersonCount: dmEntries.filter(e => e.metInPerson).length,
        nycCount: dmEntries.filter(e => /(new york|nyc)/i.test(e.city || '')).length,
        opps,
        activeOpps,
        totalOpps,
      });
    }
    return out;
  }, [keyContacts, prospects, decisionMakers, oppsRecords]);

  const sortedRows = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'company':
          cmp = (a.companyName || '').localeCompare(b.companyName || '');
          break;
        case 'aum':
          cmp = (a.aum || 0) - (b.aum || 0);
          break;
        case 'type':
          cmp = (a.type || '').localeCompare(b.type || '');
          break;
        case 'status':
          cmp = (a.status || '').localeCompare(b.status || '');
          break;
        case 'keyContacts':
          cmp = a.contacts.length - b.contacts.length;
          break;
        case 'dm':
          cmp = a.decisionMakerEntries.length - b.decisionMakerEntries.length;
          break;
        case 'met':
          cmp = (a.metInPersonCount || 0) - (b.metInPersonCount || 0);
          if (cmp === 0) cmp = (a.nycCount || 0) - (b.nycCount || 0);
          break;
        case 'ratio':
          cmp = (a.activeOpps || 0) - (b.activeOpps || 0);
          if (cmp === 0) cmp = (a.totalOpps || 0) - (b.totalOpps || 0);
          break;
        default:
          cmp = 0;
      }
      if (sortDir === 'desc') cmp = -cmp;
      if (cmp === 0) cmp = (a.companyName || '').localeCompare(b.companyName || '');
      return cmp;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  const q = query.trim().toLowerCase();
  const filteredRows = q
    ? sortedRows.filter(r => (r.companyName || '').toLowerCase().includes(q))
    : sortedRows;

  function toggle(key) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ padding: '1rem 1.25rem 0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexShrink: 0 }}>
        <div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1E293B', margin: 0 }}>Key Contacts</h2>
          <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 2, maxWidth: 720 }}>
            Every company that has at least one HubSpot contact tagged <code>Dan Key Target</code>. Sorted by number of key contacts. Expand a row to see the contacts and any opportunities on that account.
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
          placeholder={`Search ${rows.length} compan${rows.length === 1 ? 'y' : 'ies'}…`}
          style={{ width: '100%', maxWidth: 400, padding: '0.4rem 0.6rem', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.78rem', fontFamily: 'inherit' }}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 1.25rem 1.25rem', minHeight: 0 }}>
        {!hubspotCache && (
          <div style={{ padding: '0.6rem 0.8rem', marginBottom: '0.5rem', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 6, fontSize: '0.72rem', color: '#92400E' }}>
            Loading HubSpot contacts… open the <strong>HubSpot Contacts</strong> tab once if this doesn't populate.
          </div>
        )}
        {filteredRows.length === 0 ? (
          <div style={{ padding: '1.25rem', textAlign: 'center', background: '#fff', border: '2px dashed #CBD5E1', borderRadius: 8, color: '#475569' }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>
              {rows.length === 0 ? 'No "Dan Key Target" contacts found' : `No companies match "${query}"`}
            </div>
            <div style={{ fontSize: '0.78rem' }}>
              {rows.length === 0
                ? <>Tag a HubSpot contact with <code>Dan Key Target</code> in the HubSpot Contacts tab and they'll show up here, grouped by company.</>
                : `${rows.length} total companies — adjust your search.`}
            </div>
          </div>
        ) : (() => {
          const GRID = `${colWidths.company}px ${colWidths.aum}px ${colWidths.type}px ${colWidths.status}px ${colWidths.keyContacts}px ${colWidths.dm}px ${colWidths.met}px ${colWidths.ratio}px 28px`;
          const HEADER_COLUMNS = [
            { key: 'company',     label: 'Company',         align: 'left',   tip: 'Sort by company name' },
            { key: 'aum',         label: 'AUM',             align: 'right',  tip: 'PE AUM, falling back to RE AUM, from the prospect\'s Table View record' },
            { key: 'type',        label: 'Type',            align: 'left',   tip: 'Prospect type — Private Equity, Real Estate, etc.' },
            { key: 'status',      label: 'Status',          align: 'left',   tip: 'Prospect status — Client, Inside Sales, Qualifying, etc.' },
            { key: 'keyContacts', label: 'Key Contacts',    align: 'center', tip: 'Number of HubSpot contacts at this company tagged "Dan Key Target"' },
            { key: 'dm',          label: 'Decision Makers', align: 'center', tip: 'Number of HubSpot contacts at this company tagged "decision maker"' },
            { key: 'met',         label: 'Met in Person',   align: 'left',   tip: 'Met-in-person count / total decision makers, plus how many of them list New York / NYC' },
            { key: 'ratio',       label: 'Opps 2/4',        align: 'center', tip: 'Active / total opportunities for this company in the Opps tab' },
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

              {filteredRows.map((row, rowIdx) => {
                const isExpanded = expanded.has(row.key);
                const dmTotal = row.decisionMakerEntries.length;
                const met = row.metInPersonCount || 0;
                const nyc = row.nycCount || 0;
                const visibleOpps = (row.opps || []).filter(r => {
                  const stage = (r['Stage'] || '').trim();
                  if (!showClosed && CLOSED_STAGES.has(stage)) return false;
                  return true;
                });
                const oppsByStage = new Map();
                for (const r of visibleOpps) {
                  const k = (r['Stage'] || 'Unspecified').trim() || 'Unspecified';
                  if (!oppsByStage.has(k)) oppsByStage.set(k, []);
                  oppsByStage.get(k).push(r);
                }
                const stageOrder = Array.from(oppsByStage.keys()).sort((a, b) => a.localeCompare(b));

                return (
                  <div key={row.key} style={{ borderTop: rowIdx === 0 ? 'none' : '1px solid #E2E8F0' }}>
                    <button
                      type="button"
                      onClick={() => toggle(row.key)}
                      style={{ width: '100%', padding: 0, background: isExpanded ? '#F8FAFC' : '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', display: 'grid', gridTemplateColumns: GRID, alignItems: 'center' }}
                    >
                      <div
                        style={{ padding: '0.55rem 0.6rem', fontSize: '0.82rem', fontWeight: 700, color: row.prospect ? '#1E293B' : '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={row.prospect ? row.companyName : `${row.companyName} (no matching prospect)`}
                        onClick={e => { e.stopPropagation(); if (row.prospect) onSelectProspect?.(row.prospect); }}
                      >
                        {row.companyName}
                        {!row.prospect && (
                          <span style={{ marginLeft: 6, padding: '1px 6px', fontSize: '0.55rem', fontWeight: 700, color: '#92400E', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 999 }}>NO PROSPECT</span>
                        )}
                      </div>

                      <div
                        style={{ padding: '0.55rem 0.6rem', textAlign: 'right', fontSize: '0.78rem', fontWeight: 600, color: row.aum ? '#1E293B' : '#CBD5E1' }}
                        title={row.aum ? `AUM: $${row.aum}B` : 'No AUM set on this prospect record'}
                      >
                        {formatAum(row.aum)}
                      </div>

                      <div style={{ padding: '0.55rem 0.6rem', fontSize: '0.72rem', color: row.type ? '#475569' : '#CBD5E1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.type || '—'}
                      </div>

                      <div style={{ padding: '0.55rem 0.6rem', fontSize: '0.72rem', color: row.status ? '#475569' : '#CBD5E1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.status || '—'}
                      </div>

                      <div
                        style={{ padding: '0.55rem 0.6rem', textAlign: 'center' }}
                        title={row.contacts.map(c => c.name + (c.jobtitle ? ` (${c.jobtitle})` : '')).join('\n')}
                      >
                        <span style={{
                          padding: '1px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700,
                          background: '#CFFAFE', color: '#0E7490', border: '1px solid #67E8F9',
                        }}>{row.contacts.length}</span>
                      </div>

                      <div style={{ padding: '0.55rem 0.6rem', textAlign: 'center' }}>
                        {dmTotal > 0 ? (
                          <span
                            title={row.decisionMakerEntries.map(e => e.name).join(', ')}
                            style={{ padding: '1px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700, background: '#DCFCE7', color: '#166534', border: '1px solid #86EFAC' }}
                          >✓ {dmTotal}</span>
                        ) : (
                          <span style={{ padding: '1px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700, background: '#FEE2E2', color: '#991B1B', border: '1px solid #FCA5A5' }}>✗ 0</span>
                        )}
                      </div>

                      {(() => {
                        if (dmTotal === 0) return <div style={{ padding: '0.55rem 0.6rem', fontSize: '0.72rem', color: '#CBD5E1' }}>—</div>;
                        const nycList = row.decisionMakerEntries
                          .filter(e => /(new york|nyc)/i.test(e.city || ''))
                          .map(e => `${e.name}${e.city ? ` (${e.city})` : ''}`)
                          .join(', ');
                        const metList = row.decisionMakerEntries.filter(e => e.metInPerson).map(e => e.name).join(', ');
                        const tipParts = [];
                        if (met > 0) tipParts.push(`Met in person: ${metList}`);
                        else tipParts.push('No decision makers tagged "met in person" yet');
                        if (nyc > 0) tipParts.push(`In NY: ${nycList}`);
                        return (
                          <div style={{ padding: '0.55rem 0.6rem', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: '0.72rem' }} title={tipParts.join('\n')}>
                            <span style={{
                              padding: '1px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700,
                              background: met > 0 ? '#DCFCE7' : '#F1F5F9',
                              color:      met > 0 ? '#166534' : '#94A3B8',
                              border: `1px solid ${met > 0 ? '#86EFAC' : '#E2E8F0'}`,
                            }}>{met}/{dmTotal}</span>
                            {nyc > 0 && (
                              <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#5B21B6' }}>({nyc} in NY)</span>
                            )}
                          </div>
                        );
                      })()}

                      <div
                        style={{ padding: '0.55rem 0.6rem', textAlign: 'center', fontSize: '0.78rem', fontWeight: 700, color: (row.activeOpps || 0) > 0 ? '#7C3AED' : (row.totalOpps || 0) > 0 ? '#64748B' : '#CBD5E1' }}
                        title="active / total opportunities for this company"
                      >
                        {(row.activeOpps || 0)}/{(row.totalOpps || 0)}
                      </div>

                      <div style={{ padding: '0.55rem 0.2rem', textAlign: 'center', color: '#94A3B8', fontSize: '0.8rem' }}>
                        {isExpanded ? '▾' : '▸'}
                      </div>
                    </button>

                    {isExpanded && (
                      <div style={{ padding: '0.75rem 1rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <div style={{ background: '#FBFBFB', border: '1px solid #E2E8F0', borderRadius: 6, padding: '0.55rem 0.75rem' }}>
                          <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#475569', marginBottom: '0.4rem' }}>
                            Key Target contacts <span style={{ color: '#94A3B8', fontWeight: 500 }}>({row.contacts.length})</span>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.4rem' }}>
                            {row.contacts.map(c => (
                              <div
                                key={c.id}
                                style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 4, padding: '0.45rem 0.6rem' }}
                              >
                                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1E293B' }}>{c.name}</div>
                                {c.jobtitle && <div style={{ fontSize: '0.7rem', color: '#475569' }}>{c.jobtitle}</div>}
                                {c.email && <div style={{ fontSize: '0.68rem', color: '#3B82F6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email}</div>}
                                {c.phone && <div style={{ fontSize: '0.68rem', color: '#64748B' }}>{c.phone}</div>}
                                {(c.city || c.state) && <div style={{ fontSize: '0.65rem', color: '#94A3B8' }}>{[c.city, c.state].filter(Boolean).join(', ')}</div>}
                                {c.linkedin && <a href={c.linkedin} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.65rem', color: '#0A66C2', textDecoration: 'none' }} onClick={e => e.stopPropagation()}>LinkedIn ↗</a>}
                                {c.metInPerson && (
                                  <div style={{ marginTop: 4, display: 'inline-block', padding: '1px 6px', fontSize: '0.6rem', fontWeight: 700, background: '#DCFCE7', color: '#166534', border: '1px solid #86EFAC', borderRadius: 999 }}>Met in person</div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>

                        {stageOrder.length > 0 && (
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
                                      const title = r['Opportunity Name'] || r['Opportunity'] || r['Name'] || r['Description'] || '(Unnamed opportunity)';
                                      const value = r['Amount'] || r['Value'] || r['$'] || '';
                                      const closeDate = r['Close Date'] || r['Est. Close'] || r['Target Close'] || '';
                                      return (
                                        <div
                                          key={`${row.key}-${idx}`}
                                          onClick={() => row.prospect && onSelectProspect?.(row.prospect)}
                                          style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 4, padding: '0.45rem 0.6rem', cursor: row.prospect ? 'pointer' : 'default' }}
                                          onMouseEnter={e => { if (row.prospect) e.currentTarget.style.borderColor = '#3B82F6'; }}
                                          onMouseLeave={e => { e.currentTarget.style.borderColor = '#E2E8F0'; }}
                                        >
                                          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
                                          <div style={{ fontSize: '0.68rem', color: '#3B82F6', fontWeight: 600 }}>{r['Account'] || ''}</div>
                                          {value && <div style={{ fontSize: '0.72rem', color: '#059669', fontWeight: 600 }}>{String(value).startsWith('$') ? value : `$${value}`}</div>}
                                          {closeDate && <div style={{ fontSize: '0.65rem', color: '#94A3B8' }}>Close: {closeDate}</div>}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })}
                          </>
                        )}

                        {visibleOpps.length === 0 && (
                          <div style={{ fontSize: '0.72rem', color: '#94A3B8', fontStyle: 'italic' }}>
                            No {showClosed ? '' : 'active '}opportunities for this company in the Opps tab.
                          </div>
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

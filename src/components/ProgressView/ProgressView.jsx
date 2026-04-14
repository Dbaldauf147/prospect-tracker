import { useState, useEffect, useMemo } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { LineChart, Line, BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';

function ProgressChart({ title, data, series, isPct, viewType }) {
  const yProps = isPct
    ? { domain: [0, 100], tickFormatter: v => `${v}%` }
    : { allowDecimals: false };
  const tooltipFmt = isPct ? (v => `${v}%`) : undefined;
  const stacked = viewType === 'stackedBar' || viewType === 'stackedArea';
  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', padding: '1rem' }}>
      <h3 style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text)', margin: '0 0 0.75rem 0' }}>{title}</h3>
      <ResponsiveContainer width="100%" height={250}>
        {viewType === 'bar' || viewType === 'stackedBar' ? (
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey="weekLabel" fontSize={11} tick={{ fill: '#64748B' }} />
            <YAxis fontSize={11} tick={{ fill: '#64748B' }} {...yProps} />
            <Tooltip formatter={tooltipFmt} />
            <Legend />
            {series.map(s => (
              <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} stackId={stacked ? 'a' : undefined} />
            ))}
          </BarChart>
        ) : viewType === 'area' || viewType === 'stackedArea' ? (
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey="weekLabel" fontSize={11} tick={{ fill: '#64748B' }} />
            <YAxis fontSize={11} tick={{ fill: '#64748B' }} {...yProps} />
            <Tooltip formatter={tooltipFmt} />
            <Legend />
            {series.map(s => (
              <Area key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} fill={s.color} fillOpacity={0.3} stackId={stacked ? 'a' : undefined} />
            ))}
          </AreaChart>
        ) : (
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey="weekLabel" fontSize={11} tick={{ fill: '#64748B' }} />
            <YAxis fontSize={11} tick={{ fill: '#64748B' }} {...yProps} />
            <Tooltip formatter={tooltipFmt} />
            <Legend />
            {series.map(s => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={{ r: 4 }} />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

function loadOppsFromIndexedDB() {
  return new Promise(resolve => {
    try {
      const req = indexedDB.open('prospect-tracker-db', 3);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('target-accounts')) d.createObjectStore('target-accounts');
        if (!d.objectStoreNames.contains('opps-cache')) d.createObjectStore('opps-cache');
        if (!d.objectStoreNames.contains('clients-cache')) d.createObjectStore('clients-cache');
      };
      req.onsuccess = () => {
        const d = req.result;
        const tx = d.transaction('opps-cache', 'readonly');
        const store = tx.objectStore('opps-cache');
        const getReq = store.get('data');
        getReq.onsuccess = () => resolve(getReq.result?.records || []);
        getReq.onerror = () => resolve([]);
      };
      req.onerror = () => resolve([]);
    } catch { resolve([]); }
  });
}

function getWeekKey(date) {
  let d;
  if (typeof date === 'string') {
    const [y, m, day] = date.split('-').map(Number);
    d = new Date(y, m - 1, day);
  } else {
    d = new Date(date);
  }
  const dow = d.getDay();
  const diff = d.getDate() - dow + (dow === 0 ? -6 : 1); // Monday
  d.setDate(diff);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function companiesMatch(a, b) {
  const na = (a || '').toLowerCase().trim();
  const nb = (b || '').toLowerCase().trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length >= nb.length ? nb : na;
  if (shorter.length >= 4 && shorter.length >= longer.length * 0.6 && longer.includes(shorter)) return true;
  return false;
}

export function ProgressView({ prospects, settings }) {
  const { user } = useAuth();
  const [history, setHistory] = useState([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [oppsRecordsState, setOppsRecordsState] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedCard, setExpandedCard] = useState(null);
  const [editingWeek, setEditingWeek] = useState(null);
  const [saveStatus, setSaveStatus] = useState('');
  const [chartView, setChartView] = useState('line');

  // Load history from Firestore + opps data
  useEffect(() => {
    if (!user?.uid) return;
    (async () => {
      try {
        const ref = doc(db, 'progressHistory', user.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const weeks = snap.data().weeks || [];
          console.log('[ProgressView] Firestore progressHistory loaded:', weeks.length, 'weeks:', weeks.map(w => w.week));
          setHistory(weeks);
          setHistoryLoaded(true);
        } else {
          console.log('[ProgressView] Firestore progressHistory doc does NOT exist for user', user.uid);
          setHistoryLoaded(true);
        }
      } catch (err) {
        console.error('[ProgressView] Failed to load progress — auto-save disabled to avoid overwrite:', err);
      }

      // Load opps: try Google Sheet directly, then Firestore, then IndexedDB, then localStorage
      let records = [];
      try {
        const sheetRes = await fetch('https://docs.google.com/spreadsheets/d/1ee0OREqA25jzDaR6xRDSrj_ZIZDymQjf1k2Z2_ajVKw/export?format=csv&gid=0');
        if (sheetRes.ok) {
          const csvText = await sheetRes.text();
          const lines = csvText.split('\n');
          if (lines.length > 1) {
            // Parse CSV
            function parseLine(line) {
              const fields = []; let current = ''; let inQ = false;
              for (let i = 0; i < line.length; i++) {
                const ch = line[i];
                if (ch === '"') { inQ = !inQ; continue; }
                if (ch === ',' && !inQ) { fields.push(current.trim()); current = ''; continue; }
                current += ch;
              }
              fields.push(current.trim());
              return fields;
            }
            const headers = parseLine(lines[0]);
            for (let i = 1; i < lines.length; i++) {
              if (!lines[i].trim()) continue;
              const vals = parseLine(lines[i]);
              const obj = {};
              let hasData = false;
              headers.forEach((h, j) => {
                const val = (vals[j] || '').trim();
                // For duplicate headers, keep the first non-empty value
                if (obj[h] !== undefined && obj[h] !== '' && obj[h] !== '-' && obj[h] !== '#N/A') return;
                obj[h] = val;
                if (val && val !== '-' && val !== '#N/A') hasData = true;
              });
              // Use first Stage column (skip duplicate)
              if (hasData && obj['Account']) records.push(obj);
            }
          }
        }
      } catch {}
      if (records.length === 0) {
        try {
          const oppsRef = doc(db, 'oppsData', user.uid);
          const oppsSnap = await getDoc(oppsRef);
          if (oppsSnap.exists()) {
            const raw = oppsSnap.data();
            const parsed = raw.json ? JSON.parse(raw.json) : raw;
            records = parsed?.records || [];
          }
        } catch {}
      }
      if (records.length === 0) {
        records = await loadOppsFromIndexedDB();
      }
      if (records.length === 0) {
        try {
          const cache = JSON.parse(localStorage.getItem('opps-cache'));
          records = cache?.records || [];
        } catch {}
      }
      console.log(`Progress: loaded ${records.length} opps records`);
      setOppsRecordsState(records);
      setLoading(false);
    })();
  }, [user]);

  // Compute current week's snapshot
  const currentSnapshot = useMemo(() => {
    const targetMap = settings?.targetMap || {};
    // Only count Baldauf's accounts (same filter as My Accounts)
    const myProspects = prospects.filter(p => {
      const cdm = (p.cdm || '').toLowerCase().trim();
      return cdm.includes('baldauf') || cdm.includes('dan b');
    });
    const t1 = myProspects.filter(p => p.tier === 'Tier 1');
    const t2 = myProspects.filter(p => p.tier === 'Tier 2');
    const t3 = myProspects.filter(p => p.tier === 'Tier 3');

    // Load HubSpot cache for contact data
    let hubspotContacts = [];
    try {
      const cache = JSON.parse(localStorage.getItem('hubspot-sync-cache'));
      hubspotContacts = cache?.contacts || [];
    } catch {}

    const contactCompanies = new Set();
    for (const c of hubspotContacts) {
      const co = (c.company || '').toLowerCase();
      if (co) contactCompanies.add(co);
    }

    // Use opps data loaded from Firestore/IndexedDB/localStorage
    // Build totalOppsByAccount the same way as My Accounts
    const oppsRecords = oppsRecordsState;
    const invalidStages = new Set(['#N/A', '#REF!', '#VALUE!', '#ERROR!', 'N/A', 'n/a', '-', '']);
    const closedStages = new Set(['Sold', 'Not Sold', 'Closed', 'Lost']);
    const totalOppsByAccount = {};
    for (const r of oppsRecords) {
      const account = (r['Account'] || '').toLowerCase();
      const stage = (r['Stage'] || '').trim();
      if (!account || invalidStages.has(stage)) continue;
      totalOppsByAccount[account] = (totalOppsByAccount[account] || 0) + 1;
    }

    function hasContact(company) {
      const lower = (company || '').toLowerCase();
      for (const co of contactCompanies) {
        if (companiesMatch(lower, co)) return true;
      }
      return false;
    }

    // Match the Opps column logic: account has opps if totalOppsByAccount > 0 (fuzzy match)
    function hasOpp(company) {
      const lower = (company || '').toLowerCase().trim();
      // Exact match
      if (totalOppsByAccount[lower] > 0) return true;
      // Fuzzy match + parent company match (e.g. "Brookfield Asset Management" matches "Brookfield (X)")
      const firstWord = lower.split(/\s/)[0];
      for (const [oppsCompany, count] of Object.entries(totalOppsByAccount)) {
        if (count <= 0) continue;
        if (companiesMatch(lower, oppsCompany)) return true;
        // Check if they share the same parent name (first word match + one starts with the other's first word)
        if (firstWord.length >= 4 && oppsCompany.startsWith(firstWord)) return true;
      }
      return false;
    }

    // Build DM companies set — companies with at least one contact tagged as Decision Maker
    const dmCompanies = new Set();
    for (const c of hubspotContacts) {
      const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
      if (tags.includes('decision maker')) {
        const co = (c.company || '').toLowerCase();
        if (co) dmCompanies.add(co);
      }
    }

    function hasDM(company) {
      const lower = (company || '').toLowerCase();
      for (const co of dmCompanies) {
        if (companiesMatch(lower, co)) return true;
      }
      // Also check first-word match for parent companies
      const firstWord = lower.split(/\s/)[0];
      if (firstWord.length >= 4) {
        for (const co of dmCompanies) {
          if (co.startsWith(firstWord)) return true;
        }
      }
      return false;
    }

    const inactiveStatuses = new Set(['Lost - Not Sold', 'Hold Off', 'Old Client']);

    const t1Total = t1.length;
    const t2Total = t2.length;
    const t1WithContactsList = t1.filter(p => hasContact(p.company));
    const t2WithContactsList = t2.filter(p => hasContact(p.company));
    const t1WithDMList = t1.filter(p => hasDM(p.company));
    const t2WithDMList = t2.filter(p => hasDM(p.company));
    const t1ConnectedList = t1.filter(p => hasOpp(p.company));
    const t2ConnectedList = t2.filter(p => hasOpp(p.company));
    const t1InactiveList = t1.filter(p => inactiveStatuses.has(p.status));
    const t2InactiveList = t2.filter(p => inactiveStatuses.has(p.status));
    const t1WithContacts = t1WithContactsList.length;
    const t2WithContacts = t2WithContactsList.length;
    const t1WithDM = t1WithDMList.length;
    const t2WithDM = t2WithDMList.length;
    const t1Connected = t1ConnectedList.length;
    const t2Connected = t2ConnectedList.length;
    const t1Inactive = t1InactiveList.length;
    const t2Inactive = t2InactiveList.length;

    // Also build "not" lists
    const t1NoContacts = t1.filter(p => !hasContact(p.company));
    const t2NoContacts = t2.filter(p => !hasContact(p.company));
    const t1NoDM = t1.filter(p => !hasDM(p.company));
    const t2NoDM = t2.filter(p => !hasDM(p.company));
    const t1NotConnected = t1.filter(p => !hasOpp(p.company));
    const t2NotConnected = t2.filter(p => !hasOpp(p.company));

    return {
      week: getWeekKey(new Date()),
      t1Total, t2Total, t3Total: t3.length,
      tierCounts: { t1: t1.length, t2: t2.length, t3: t3.length },
      t1WithContacts, t2WithContacts,
      t1WithDM, t2WithDM,
      t1Connected, t2Connected,
      t1Inactive, t2Inactive,
      t1ContactPct: t1Total > 0 ? Math.round((t1WithContacts / t1Total) * 100) : 0,
      t2ContactPct: t2Total > 0 ? Math.round((t2WithContacts / t2Total) * 100) : 0,
      t1DMPct: t1Total > 0 ? Math.round((t1WithDM / t1Total) * 100) : 0,
      t2DMPct: t2Total > 0 ? Math.round((t2WithDM / t2Total) * 100) : 0,
      t1ConnectedPct: t1Total > 0 ? Math.round((t1Connected / t1Total) * 100) : 0,
      t2ConnectedPct: t2Total > 0 ? Math.round((t2Connected / t2Total) * 100) : 0,
      t1InactivePct: t1Total > 0 ? Math.round((t1Inactive / t1Total) * 100) : 0,
      t2InactivePct: t2Total > 0 ? Math.round((t2Inactive / t2Total) * 100) : 0,
      // Detail lists for drill-down
      details: {
        t1WithContacts: t1WithContactsList.map(p => p.company),
        t1NoContacts: t1NoContacts.map(p => p.company),
        t2WithContacts: t2WithContactsList.map(p => p.company),
        t2NoContacts: t2NoContacts.map(p => p.company),
        t1WithDM: t1WithDMList.map(p => p.company),
        t1NoDM: t1NoDM.map(p => p.company),
        t2WithDM: t2WithDMList.map(p => p.company),
        t2NoDM: t2NoDM.map(p => p.company),
        t1Connected: t1ConnectedList.map(p => p.company),
        t1NotConnected: t1NotConnected.map(p => p.company),
        t2Connected: t2ConnectedList.map(p => p.company),
        t2NotConnected: t2NotConnected.map(p => p.company),
        t1Inactive: t1InactiveList.map(p => ({ company: p.company, status: p.status })),
        t2Inactive: t2InactiveList.map(p => ({ company: p.company, status: p.status })),
      },
    };
  }, [prospects, settings, oppsRecordsState]);

  // Auto-save snapshot if current week hasn't been saved yet
  useEffect(() => {
    if (!user?.uid || loading || !historyLoaded || !currentSnapshot.t1Total) return;
    const alreadySaved = history.find(h => h.week === currentSnapshot.week);
    if (!alreadySaved) {
      saveSnapshot();
    }
  }, [user, loading, historyLoaded, currentSnapshot.week, history.length]);

  // Save current week snapshot — re-reads Firestore first to avoid overwriting
  // entries saved from another device or missed by a failed load.
  async function saveSnapshot() {
    if (!user?.uid) {
      console.warn('[ProgressView] saveSnapshot: no user uid, bailing');
      setSaveStatus('Not signed in');
      setTimeout(() => setSaveStatus(''), 3000);
      return;
    }
    console.log('[ProgressView] saveSnapshot: starting for week', currentSnapshot.week);
    setSaveStatus('Saving…');
    try {
      const ref = doc(db, 'progressHistory', user.uid);
      const snap = await getDoc(ref);
      const remoteWeeks = snap.exists() ? (snap.data().weeks || []) : [];
      const merged = [...remoteWeeks];
      for (const h of history) {
        if (!merged.find(m => m.week === h.week)) merged.push(h);
      }
      const idx = merged.findIndex(h => h.week === currentSnapshot.week);
      // Strip undefined values (Firestore rejects them)
      const clean = JSON.parse(JSON.stringify(currentSnapshot));
      if (idx >= 0) merged[idx] = clean;
      else merged.push(clean);
      merged.sort((a, b) => a.week.localeCompare(b.week));
      setHistory(merged);
      await setDoc(ref, { weeks: merged, updatedAt: new Date().toISOString() });
      console.log('[ProgressView] saveSnapshot: saved', merged.length, 'weeks');
      setSaveStatus(`Saved ✓ (${merged.length} week${merged.length === 1 ? '' : 's'})`);
      setTimeout(() => setSaveStatus(''), 3000);
    } catch (err) {
      console.error('[ProgressView] Failed to save progress:', err);
      setSaveStatus('Save failed: ' + (err?.message || err));
      setTimeout(() => setSaveStatus(''), 5000);
    }
  }

  const chartData = useMemo(() => {
    const data = [...history];
    // Add current week if not already saved
    if (!data.find(h => h.week === currentSnapshot.week)) {
      data.push(currentSnapshot);
    } else {
      // Update current week with live data
      const idx = data.findIndex(h => h.week === currentSnapshot.week);
      data[idx] = currentSnapshot;
    }
    return data.map(d => ({
      ...d,
      weekLabel: new Date(d.week + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    }));
  }, [history, currentSnapshot]);

  function fmtWeek(w) {
    return new Date(w + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  if (loading) return <div style={{ padding: '2rem', color: 'var(--color-text-muted)' }}>Loading...</div>;

  return (
    <div style={{ padding: '1.5rem', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>Weekly Progress</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          {saveStatus && (
            <span style={{ fontSize: '0.75rem', color: saveStatus.startsWith('Saved') ? '#10B981' : saveStatus.startsWith('Sav') ? 'var(--color-text-secondary)' : '#DC2626', fontWeight: 600 }}>
              {saveStatus}
            </span>
          )}
          <button
            onClick={saveSnapshot}
            style={{
              padding: '0.4rem 0.8rem', border: 'none', borderRadius: '6px',
              background: 'var(--color-accent)', color: '#fff', fontSize: '0.8rem',
              fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
            }}
          >
            Save This Week's Snapshot
          </button>
        </div>
      </div>

      {/* Current stats */}
      {(() => {
        const cards = [
          { key: 'contacts', label: 'Accounts with Contacts', color: '#3B82F6', t1: currentSnapshot.t1WithContacts, t2: currentSnapshot.t2WithContacts, t1Pct: currentSnapshot.t1ContactPct, t2Pct: currentSnapshot.t2ContactPct,
            t1Yes: currentSnapshot.details?.t1WithContacts || [], t1No: currentSnapshot.details?.t1NoContacts || [],
            t2Yes: currentSnapshot.details?.t2WithContacts || [], t2No: currentSnapshot.details?.t2NoContacts || [] },
          { key: 'dm', label: 'Decision Maker Identified', color: '#7C3AED', t1: currentSnapshot.t1WithDM || 0, t2: currentSnapshot.t2WithDM || 0, t1Pct: currentSnapshot.t1DMPct || 0, t2Pct: currentSnapshot.t2DMPct || 0,
            t1Yes: currentSnapshot.details?.t1WithDM || [], t1No: currentSnapshot.details?.t1NoDM || [],
            t2Yes: currentSnapshot.details?.t2WithDM || [], t2No: currentSnapshot.details?.t2NoDM || [] },
          { key: 'connected', label: 'Connected (Had Opp)', color: '#10B981', t1: currentSnapshot.t1Connected, t2: currentSnapshot.t2Connected, t1Pct: currentSnapshot.t1ConnectedPct, t2Pct: currentSnapshot.t2ConnectedPct,
            t1Yes: currentSnapshot.details?.t1Connected || [], t1No: currentSnapshot.details?.t1NotConnected || [],
            t2Yes: currentSnapshot.details?.t2Connected || [], t2No: currentSnapshot.details?.t2NotConnected || [] },
          { key: 'inactive', label: 'Inactive (Lost/Hold/Old)', color: '#F59E0B', t1: currentSnapshot.t1Inactive, t2: currentSnapshot.t2Inactive, t1Pct: currentSnapshot.t1InactivePct, t2Pct: currentSnapshot.t2InactivePct,
            t1Yes: (currentSnapshot.details?.t1Inactive || []).map(x => typeof x === 'string' ? x : `${x.company} (${x.status})`),
            t1No: [], t2Yes: (currentSnapshot.details?.t2Inactive || []).map(x => typeof x === 'string' ? x : `${x.company} (${x.status})`), t2No: [] },
        ];
        return (
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', flex: expandedCard ? '0 0 55%' : '1' }}>
              {cards.map(card => (
                <div key={card.key} onClick={() => setExpandedCard(expandedCard === card.key ? null : card.key)}
                  style={{ padding: '0.75rem', background: expandedCard === card.key ? '#F0F9FF' : 'var(--color-surface)', border: expandedCard === card.key ? '2px solid ' + card.color : '1px solid var(--color-border)', borderRadius: '8px', borderLeft: `3px solid ${card.color}`, cursor: 'pointer' }}>
                  <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{card.label}</div>
                  <div style={{ display: 'flex', gap: '1rem', marginTop: '0.3rem' }}>
                    <div><span style={{ fontSize: '1.2rem', fontWeight: 700, color: '#DC2626' }}>{card.t1Pct}%</span> <span style={{ fontSize: '0.65rem', color: 'var(--color-text-secondary)' }}>T1 ({card.t1}/{currentSnapshot.t1Total})</span></div>
                    <div><span style={{ fontSize: '1.2rem', fontWeight: 700, color: '#3B82F6' }}>{card.t2Pct}%</span> <span style={{ fontSize: '0.65rem', color: 'var(--color-text-secondary)' }}>T2 ({card.t2}/{currentSnapshot.t2Total})</span></div>
                  </div>
                </div>
              ))}
            </div>
            {expandedCard && (() => {
              const card = cards.find(c => c.key === expandedCard);
              if (!card) return null;
              return (
                <div style={{ flex: '0 0 50%', border: '1px solid var(--color-border)', borderRadius: '8px', padding: '0.75rem', maxHeight: '300px', overflowY: 'auto' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <h4 style={{ margin: 0, fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-text)' }}>{card.label}</h4>
                    <button onClick={e => { e.stopPropagation(); setExpandedCard(null); }} style={{ background: 'none', border: 'none', color: '#94A3B8', fontSize: '1rem', cursor: 'pointer' }}>&times;</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <div>
                      <div style={{ fontSize: '0.65rem', fontWeight: 600, color: '#DC2626', textTransform: 'uppercase', marginBottom: '0.3rem' }}>Tier 1 — Yes ({card.t1Yes.length})</div>
                      {card.t1Yes.map((c, i) => <div key={i} style={{ fontSize: '0.72rem', color: 'var(--color-text)', padding: '1px 0' }}>{c}</div>)}
                      {card.key !== 'inactive' && card.t1No.length > 0 && (
                        <>
                          <div style={{ fontSize: '0.65rem', fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', marginTop: '0.5rem', marginBottom: '0.3rem' }}>Tier 1 — No ({card.t1No.length})</div>
                          {card.t1No.map((c, i) => <div key={i} style={{ fontSize: '0.72rem', color: '#9CA3AF', padding: '1px 0' }}>{c}</div>)}
                        </>
                      )}
                    </div>
                    <div>
                      <div style={{ fontSize: '0.65rem', fontWeight: 600, color: '#3B82F6', textTransform: 'uppercase', marginBottom: '0.3rem' }}>Tier 2 — Yes ({card.t2Yes.length})</div>
                      {card.t2Yes.map((c, i) => <div key={i} style={{ fontSize: '0.72rem', color: 'var(--color-text)', padding: '1px 0' }}>{c}</div>)}
                      {card.key !== 'inactive' && card.t2No.length > 0 && (
                        <>
                          <div style={{ fontSize: '0.65rem', fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', marginTop: '0.5rem', marginBottom: '0.3rem' }}>Tier 2 — No ({card.t2No.length})</div>
                          {card.t2No.map((c, i) => <div key={i} style={{ fontSize: '0.72rem', color: '#9CA3AF', padding: '1px 0' }}>{c}</div>)}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })()}

      {/* Chart view toggle */}
      {chartData.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>View:</span>
          {[
            { key: 'line', label: 'Line' },
            { key: 'bar', label: 'Bar' },
            { key: 'stackedBar', label: 'Stacked Bar' },
            { key: 'area', label: 'Area' },
            { key: 'stackedArea', label: 'Stacked Area' },
          ].map(opt => (
            <button
              key={opt.key}
              onClick={() => setChartView(opt.key)}
              style={{
                padding: '0.25rem 0.6rem',
                border: '1px solid var(--color-border)',
                borderRadius: '6px',
                background: chartView === opt.key ? 'var(--color-accent)' : 'var(--color-surface)',
                color: chartView === opt.key ? '#fff' : 'var(--color-text)',
                fontSize: '0.72rem',
                fontWeight: 600,
                fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* Charts */}
      {chartData.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <ProgressChart
            title="% of Accounts with HubSpot Contacts"
            data={chartData}
            series={[{ key: 't1ContactPct', name: 'Tier 1', color: '#DC2626' }, { key: 't2ContactPct', name: 'Tier 2', color: '#3B82F6' }]}
            isPct
            viewType={chartView}
          />
          <ProgressChart
            title="% of Accounts with Decision Maker Identified"
            data={chartData}
            series={[{ key: 't1DMPct', name: 'Tier 1', color: '#DC2626' }, { key: 't2DMPct', name: 'Tier 2', color: '#3B82F6' }]}
            isPct
            viewType={chartView}
          />
          <ProgressChart
            title="% of Accounts Connected (Had Opportunity)"
            data={chartData}
            series={[{ key: 't1ConnectedPct', name: 'Tier 1', color: '#DC2626' }, { key: 't2ConnectedPct', name: 'Tier 2', color: '#3B82F6' }]}
            isPct
            viewType={chartView}
          />
          <ProgressChart
            title="% of Accounts Inactive (Lost / Hold Off / Old Client)"
            data={chartData}
            series={[{ key: 't1InactivePct', name: 'Tier 1', color: '#DC2626' }, { key: 't2InactivePct', name: 'Tier 2', color: '#3B82F6' }]}
            isPct
            viewType={chartView}
          />
          <ProgressChart
            title="My Accounts by Tier"
            data={chartData}
            series={[
              { key: 't1Total', name: 'Tier 1', color: '#DC2626' },
              { key: 't2Total', name: 'Tier 2', color: '#3B82F6' },
              { key: 't3Total', name: 'Tier 3', color: '#F59E0B' },
            ]}
            viewType={chartView}
          />

          {/* History table */}
          {chartData.length > 0 && (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', overflow: 'hidden' }}>
              <h3 style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text)', margin: 0, padding: '0.75rem 1rem', borderBottom: '1px solid var(--color-border)' }}>Weekly History</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                <thead>
                  <tr style={{ background: 'var(--color-surface-alt)' }}>
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'left', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '0.68rem', textTransform: 'uppercase', borderBottom: '1px solid var(--color-border)' }}>Week</th>
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'center', fontWeight: 600, color: '#DC2626', fontSize: '0.68rem', borderBottom: '1px solid var(--color-border)' }}>T1</th>
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'center', fontWeight: 600, color: '#3B82F6', fontSize: '0.68rem', borderBottom: '1px solid var(--color-border)' }}>T2</th>
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'center', fontWeight: 600, color: '#F59E0B', fontSize: '0.68rem', borderBottom: '1px solid var(--color-border)' }}>T3</th>
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'center', fontWeight: 600, color: '#DC2626', fontSize: '0.68rem', borderBottom: '1px solid var(--color-border)' }}>T1 Contacts</th>
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'center', fontWeight: 600, color: '#3B82F6', fontSize: '0.68rem', borderBottom: '1px solid var(--color-border)' }}>T2 Contacts</th>
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'center', fontWeight: 600, color: '#DC2626', fontSize: '0.68rem', borderBottom: '1px solid var(--color-border)' }}>T1 Connected</th>
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'center', fontWeight: 600, color: '#3B82F6', fontSize: '0.68rem', borderBottom: '1px solid var(--color-border)' }}>T2 Connected</th>
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'center', fontWeight: 600, color: '#DC2626', fontSize: '0.68rem', borderBottom: '1px solid var(--color-border)' }}>T1 Inactive</th>
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'center', fontWeight: 600, color: '#3B82F6', fontSize: '0.68rem', borderBottom: '1px solid var(--color-border)' }}>T2 Inactive</th>
                    <th style={{ padding: '0.45rem 0.6rem', width: '36px', borderBottom: '1px solid var(--color-border)' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {[...chartData].reverse().map((h, i) => (
                    <tr key={h.week} style={{ borderBottom: '1px solid var(--color-border-light)' }}>
                      <td style={{ padding: '0.4rem 0.6rem', fontWeight: 600, color: 'var(--color-text)' }}>
                        {editingWeek === h.week ? (
                          <input
                            type="date"
                            defaultValue={h.week}
                            autoFocus
                            style={{ fontSize: '0.75rem', fontWeight: 600, border: '1px solid var(--color-border)', borderRadius: '4px', padding: '2px 4px', background: 'var(--color-surface)', color: 'var(--color-text)' }}
                            onBlur={async (e) => {
                              const newDate = e.target.value;
                              setEditingWeek(null);
                              if (!newDate || newDate === h.week) return;
                              const newWeek = getWeekKey(newDate);
                              if (newWeek === h.week) return;
                              if (history.find(x => x.week === newWeek)) {
                                alert('A snapshot for that week already exists.');
                                return;
                              }
                              const inHistory = history.find(x => x.week === h.week);
                              let updated;
                              if (inHistory) {
                                updated = history.map(x => x.week === h.week ? { ...x, week: newWeek } : x);
                              } else {
                                // Editing the not-yet-saved current-week row: create a new history entry
                                const clean = JSON.parse(JSON.stringify(currentSnapshot));
                                updated = [...history, { ...clean, week: newWeek }];
                              }
                              updated.sort((a, b) => a.week.localeCompare(b.week));
                              setHistory(updated);
                              setSaveStatus('Saving…');
                              try {
                                const ref = doc(db, 'progressHistory', user.uid);
                                await setDoc(ref, { weeks: updated, updatedAt: new Date().toISOString() });
                                setSaveStatus('Saved ✓');
                                setTimeout(() => setSaveStatus(''), 3000);
                              } catch (err) {
                                console.error('[ProgressView] Failed to save week edit:', err);
                                setSaveStatus('Save failed: ' + (err?.message || err));
                                setTimeout(() => setSaveStatus(''), 5000);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.target.blur();
                              if (e.key === 'Escape') setEditingWeek(null);
                            }}
                          />
                        ) : (
                          <span
                            style={{ cursor: 'pointer', borderBottom: '1px dashed var(--color-border)' }}
                            onClick={() => setEditingWeek(h.week)}
                            title="Click to change week"
                          >
                            {fmtWeek(h.week)}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '0.4rem 0.6rem', textAlign: 'center', fontWeight: 600, color: '#DC2626' }}>{h.t1Total ?? '—'}</td>
                      <td style={{ padding: '0.4rem 0.6rem', textAlign: 'center', fontWeight: 600, color: '#3B82F6' }}>{h.t2Total ?? '—'}</td>
                      <td style={{ padding: '0.4rem 0.6rem', textAlign: 'center', fontWeight: 600, color: '#F59E0B' }}>{h.t3Total ?? '—'}</td>
                      <td style={{ padding: '0.4rem 0.6rem', textAlign: 'center' }}>{h.t1ContactPct}%</td>
                      <td style={{ padding: '0.4rem 0.6rem', textAlign: 'center' }}>{h.t2ContactPct}%</td>
                      <td style={{ padding: '0.4rem 0.6rem', textAlign: 'center' }}>{h.t1ConnectedPct}%</td>
                      <td style={{ padding: '0.4rem 0.6rem', textAlign: 'center' }}>{h.t2ConnectedPct}%</td>
                      <td style={{ padding: '0.4rem 0.6rem', textAlign: 'center' }}>{h.t1InactivePct}%</td>
                      <td style={{ padding: '0.4rem 0.6rem', textAlign: 'center' }}>{h.t2InactivePct}%</td>
                      <td style={{ padding: '0.4rem 0.3rem', textAlign: 'center' }}>
                        <button
                          onClick={() => {
                            const updated = history.filter((_, j) => j !== history.length - 1 - i);
                            setHistory(updated);
                            const ref = doc(db, 'progressHistory', user.uid);
                            setDoc(ref, { weeks: updated, updatedAt: new Date().toISOString() });
                          }}
                          style={{ background: 'none', border: 'none', color: '#CBD5E1', fontSize: '0.85rem', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
                          onMouseEnter={e => e.target.style.color = '#EF4444'}
                          onMouseLeave={e => e.target.style.color = '#CBD5E1'}
                        >&times;</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

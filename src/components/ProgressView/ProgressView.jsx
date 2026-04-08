import { useState, useEffect, useMemo } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

function getWeekKey(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().slice(0, 10);
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
  const [loading, setLoading] = useState(true);

  // Load history from Firestore
  useEffect(() => {
    if (!user?.uid) return;
    (async () => {
      try {
        const ref = doc(db, 'progressHistory', user.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          setHistory(snap.data().weeks || []);
        }
      } catch (err) { console.error('Failed to load progress:', err); }
      setLoading(false);
    })();
  }, [user]);

  // Compute current week's snapshot
  const currentSnapshot = useMemo(() => {
    const targetMap = settings?.targetMap || {};
    const t1 = prospects.filter(p => p.tier === 'Tier 1');
    const t2 = prospects.filter(p => p.tier === 'Tier 2');

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

    // Load opps for "connected" metric
    let oppsRecords = [];
    try {
      const cache = JSON.parse(localStorage.getItem('opps-cache'));
      oppsRecords = cache?.records || [];
    } catch {}
    // Also try IndexedDB data that might have been loaded
    const oppsCompanies = new Set();
    for (const r of oppsRecords) {
      const account = (r['Account'] || '').toLowerCase();
      if (account) oppsCompanies.add(account);
    }

    function hasContact(company) {
      const lower = (company || '').toLowerCase();
      for (const co of contactCompanies) {
        if (companiesMatch(lower, co)) return true;
      }
      return false;
    }

    function hasOpp(company) {
      const lower = (company || '').toLowerCase();
      for (const co of oppsCompanies) {
        if (companiesMatch(lower, co)) return true;
      }
      return false;
    }

    const inactiveStatuses = new Set(['Lost - Not Sold', 'Hold Off', 'Old Client']);

    const t1Total = t1.length;
    const t2Total = t2.length;
    const t1WithContacts = t1.filter(p => hasContact(p.company)).length;
    const t2WithContacts = t2.filter(p => hasContact(p.company)).length;
    const t1Connected = t1.filter(p => hasOpp(p.company)).length;
    const t2Connected = t2.filter(p => hasOpp(p.company)).length;
    const t1Inactive = t1.filter(p => inactiveStatuses.has(p.status)).length;
    const t2Inactive = t2.filter(p => inactiveStatuses.has(p.status)).length;

    return {
      week: getWeekKey(new Date()),
      t1Total, t2Total,
      t1WithContacts, t2WithContacts,
      t1Connected, t2Connected,
      t1Inactive, t2Inactive,
      t1ContactPct: t1Total > 0 ? Math.round((t1WithContacts / t1Total) * 100) : 0,
      t2ContactPct: t2Total > 0 ? Math.round((t2WithContacts / t2Total) * 100) : 0,
      t1ConnectedPct: t1Total > 0 ? Math.round((t1Connected / t1Total) * 100) : 0,
      t2ConnectedPct: t2Total > 0 ? Math.round((t2Connected / t2Total) * 100) : 0,
      t1InactivePct: t1Total > 0 ? Math.round((t1Inactive / t1Total) * 100) : 0,
      t2InactivePct: t2Total > 0 ? Math.round((t2Inactive / t2Total) * 100) : 0,
    };
  }, [prospects, settings]);

  // Save current week snapshot
  async function saveSnapshot() {
    if (!user?.uid) return;
    const existing = history.findIndex(h => h.week === currentSnapshot.week);
    const updated = existing >= 0
      ? history.map((h, i) => i === existing ? currentSnapshot : h)
      : [...history, currentSnapshot];
    updated.sort((a, b) => a.week.localeCompare(b.week));
    setHistory(updated);
    try {
      const ref = doc(db, 'progressHistory', user.uid);
      await setDoc(ref, { weeks: updated, updatedAt: new Date().toISOString() });
    } catch (err) { console.error('Failed to save progress:', err); }
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

      {/* Current stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <div style={{ padding: '0.75rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', borderLeft: '3px solid #3B82F6' }}>
          <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Accounts with Contacts</div>
          <div style={{ display: 'flex', gap: '1rem', marginTop: '0.3rem' }}>
            <div><span style={{ fontSize: '1.2rem', fontWeight: 700, color: '#DC2626' }}>{currentSnapshot.t1ContactPct}%</span> <span style={{ fontSize: '0.65rem', color: 'var(--color-text-secondary)' }}>T1 ({currentSnapshot.t1WithContacts}/{currentSnapshot.t1Total})</span></div>
            <div><span style={{ fontSize: '1.2rem', fontWeight: 700, color: '#3B82F6' }}>{currentSnapshot.t2ContactPct}%</span> <span style={{ fontSize: '0.65rem', color: 'var(--color-text-secondary)' }}>T2 ({currentSnapshot.t2WithContacts}/{currentSnapshot.t2Total})</span></div>
          </div>
        </div>
        <div style={{ padding: '0.75rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', borderLeft: '3px solid #10B981' }}>
          <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Connected (Had Opp)</div>
          <div style={{ display: 'flex', gap: '1rem', marginTop: '0.3rem' }}>
            <div><span style={{ fontSize: '1.2rem', fontWeight: 700, color: '#DC2626' }}>{currentSnapshot.t1ConnectedPct}%</span> <span style={{ fontSize: '0.65rem', color: 'var(--color-text-secondary)' }}>T1 ({currentSnapshot.t1Connected}/{currentSnapshot.t1Total})</span></div>
            <div><span style={{ fontSize: '1.2rem', fontWeight: 700, color: '#3B82F6' }}>{currentSnapshot.t2ConnectedPct}%</span> <span style={{ fontSize: '0.65rem', color: 'var(--color-text-secondary)' }}>T2 ({currentSnapshot.t2Connected}/{currentSnapshot.t2Total})</span></div>
          </div>
        </div>
        <div style={{ padding: '0.75rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', borderLeft: '3px solid #F59E0B' }}>
          <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Inactive (Lost/Hold/Old)</div>
          <div style={{ display: 'flex', gap: '1rem', marginTop: '0.3rem' }}>
            <div><span style={{ fontSize: '1.2rem', fontWeight: 700, color: '#DC2626' }}>{currentSnapshot.t1InactivePct}%</span> <span style={{ fontSize: '0.65rem', color: 'var(--color-text-secondary)' }}>T1 ({currentSnapshot.t1Inactive}/{currentSnapshot.t1Total})</span></div>
            <div><span style={{ fontSize: '1.2rem', fontWeight: 700, color: '#3B82F6' }}>{currentSnapshot.t2InactivePct}%</span> <span style={{ fontSize: '0.65rem', color: 'var(--color-text-secondary)' }}>T2 ({currentSnapshot.t2Inactive}/{currentSnapshot.t2Total})</span></div>
          </div>
        </div>
      </div>

      {/* Charts */}
      {chartData.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Chart 1: Accounts with Contacts */}
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', padding: '1rem' }}>
            <h3 style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text)', margin: '0 0 0.75rem 0' }}>% of Accounts with HubSpot Contacts</h3>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="weekLabel" fontSize={11} tick={{ fill: '#64748B' }} />
                <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} fontSize={11} tick={{ fill: '#64748B' }} />
                <Tooltip formatter={v => `${v}%`} />
                <Legend />
                <Line type="monotone" dataKey="t1ContactPct" name="Tier 1" stroke="#DC2626" strokeWidth={2} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="t2ContactPct" name="Tier 2" stroke="#3B82F6" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Chart 2: Connected (Had Opp) */}
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', padding: '1rem' }}>
            <h3 style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text)', margin: '0 0 0.75rem 0' }}>% of Accounts Connected (Had Opportunity)</h3>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="weekLabel" fontSize={11} tick={{ fill: '#64748B' }} />
                <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} fontSize={11} tick={{ fill: '#64748B' }} />
                <Tooltip formatter={v => `${v}%`} />
                <Legend />
                <Line type="monotone" dataKey="t1ConnectedPct" name="Tier 1" stroke="#DC2626" strokeWidth={2} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="t2ConnectedPct" name="Tier 2" stroke="#3B82F6" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Chart 3: Inactive */}
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', padding: '1rem' }}>
            <h3 style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text)', margin: '0 0 0.75rem 0' }}>% of Accounts Inactive (Lost / Hold Off / Old Client)</h3>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="weekLabel" fontSize={11} tick={{ fill: '#64748B' }} />
                <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} fontSize={11} tick={{ fill: '#64748B' }} />
                <Tooltip formatter={v => `${v}%`} />
                <Legend />
                <Line type="monotone" dataKey="t1InactivePct" name="Tier 1" stroke="#DC2626" strokeWidth={2} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="t2InactivePct" name="Tier 2" stroke="#3B82F6" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* History table */}
          {history.length > 0 && (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                <thead>
                  <tr style={{ background: 'var(--color-surface-alt)' }}>
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'left', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '0.68rem', textTransform: 'uppercase', borderBottom: '1px solid var(--color-border)' }}>Week</th>
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
                  {[...history].reverse().map((h, i) => (
                    <tr key={h.week} style={{ borderBottom: '1px solid var(--color-border-light)' }}>
                      <td style={{ padding: '0.4rem 0.6rem', fontWeight: 600, color: 'var(--color-text)' }}>{fmtWeek(h.week)}</td>
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

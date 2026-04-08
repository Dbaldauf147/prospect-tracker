import { useState, useEffect } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';

export function EmailCampaignView() {
  const { user } = useAuth();
  const [subject, setSubject] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState(null);
  const [savedCampaigns, setSavedCampaigns] = useState([]);
  const [viewingSaved, setViewingSaved] = useState(null); // index of saved campaign being viewed
  const [saving, setSaving] = useState(false);

  // Load saved campaigns from Firestore
  useEffect(() => {
    if (!user?.uid) return;
    (async () => {
      try {
        const ref = doc(db, 'emailCampaigns', user.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data();
          setSavedCampaigns(data.campaigns || []);
        }
      } catch (err) { console.error('Failed to load campaigns:', err); }
    })();
  }, [user]);

  async function saveCampaigns(campaigns) {
    setSavedCampaigns(campaigns);
    if (!user?.uid) return;
    try {
      const ref = doc(db, 'emailCampaigns', user.uid);
      await setDoc(ref, { campaigns, updatedAt: new Date().toISOString() });
    } catch (err) { console.error('Failed to save campaigns:', err); }
  }

  async function handleSearch() {
    if (!subject.trim()) return;
    setLoading(true);
    setError('');
    setResults(null);
    setViewingSaved(null);
    try {
      const res = await fetch('/api/email-campaign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: subject.trim() }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setResults(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!results) return;
    setSaving(true);
    const campaign = {
      subject: results.subject,
      savedAt: new Date().toISOString(),
      uniqueRecipients: results.uniqueRecipients,
      uniqueRepliers: results.uniqueRepliers,
      responseRate: results.responseRate,
      totalEmails: results.totalEmails,
      sent: results.sent,
      replies: results.replies,
      contacts: results.contacts,
    };
    // Replace if same subject exists, otherwise add
    const existing = savedCampaigns.findIndex(c => c.subject === campaign.subject);
    const updated = existing >= 0
      ? savedCampaigns.map((c, i) => i === existing ? campaign : c)
      : [campaign, ...savedCampaigns];
    await saveCampaigns(updated);
    setSaving(false);
  }

  function deleteCampaign(index) {
    const updated = savedCampaigns.filter((_, i) => i !== index);
    saveCampaigns(updated);
    if (viewingSaved === index) { setViewingSaved(null); setResults(null); }
    else if (viewingSaved > index) setViewingSaved(viewingSaved - 1);
  }

  function viewCampaign(index) {
    const c = savedCampaigns[index];
    setResults(c);
    setSubject(c.subject);
    setViewingSaved(index);
  }

  function fmtDate(d) {
    if (!d) return '—';
    const dt = new Date(d);
    if (isNaN(dt)) return '—';
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  const displayResults = results;

  return (
    <div style={{ padding: '1.5rem', maxWidth: '1000px' }}>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-text)', marginTop: 0, marginBottom: '1rem' }}>Email Campaign Tracker</h2>

      {/* Search */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <input
          type="text"
          placeholder="Enter email subject line..."
          value={subject}
          onChange={e => setSubject(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
          style={{ flex: 1, padding: '0.5rem 0.75rem', border: '1px solid var(--color-border)', borderRadius: '6px', fontSize: '0.85rem', fontFamily: 'inherit' }}
        />
        <button
          onClick={handleSearch}
          disabled={loading || !subject.trim()}
          style={{
            padding: '0.5rem 1rem', border: 'none', borderRadius: '6px',
            background: 'var(--color-accent)', color: '#fff', fontSize: '0.85rem',
            fontWeight: 600, fontFamily: 'inherit', cursor: loading ? 'wait' : 'pointer',
            opacity: !subject.trim() ? 0.5 : 1,
          }}
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
      </div>

      {error && <div style={{ padding: '0.5rem 0.75rem', background: '#FEF2F2', borderRadius: '6px', fontSize: '0.8rem', color: '#DC2626', marginBottom: '1rem' }}>{error}</div>}

      {/* Results */}
      {displayResults && (
        <div>
          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div style={{ padding: '0.75rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', borderLeft: '3px solid var(--color-accent)' }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Emails Sent</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--color-text)' }}>{displayResults.sent}</div>
            </div>
            <div style={{ padding: '0.75rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', borderLeft: '3px solid #10B981' }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Replies</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#10B981' }}>{displayResults.uniqueRepliers}</div>
            </div>
            <div style={{ padding: '0.75rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', borderLeft: '3px solid #7C3AED' }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Response Rate</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: displayResults.responseRate >= 20 ? '#10B981' : displayResults.responseRate >= 10 ? '#F59E0B' : '#DC2626' }}>{displayResults.responseRate}%</div>
            </div>
            <div style={{ padding: '0.75rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', borderLeft: '3px solid #94A3B8' }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total Emails</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--color-text)' }}>{displayResults.totalEmails}</div>
            </div>
          </div>

          {/* Subject + Save button */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
              Matching subject: <strong>"{displayResults.subject}"</strong>
              {viewingSaved !== null && <span style={{ marginLeft: '0.5rem', padding: '1px 6px', borderRadius: '999px', fontSize: '0.6rem', fontWeight: 600, background: '#DBEAFE', color: '#1E40AF' }}>Saved</span>}
            </div>
            {viewingSaved === null && (
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  padding: '0.35rem 0.75rem', border: 'none', borderRadius: '6px',
                  background: saving ? '#10B981' : 'var(--color-accent)', color: '#fff',
                  fontSize: '0.75rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
                }}
              >
                {saving ? '✓ Saved!' : 'Save Campaign'}
              </button>
            )}
          </div>

          {/* Contact table */}
          {displayResults.contacts && displayResults.contacts.length > 0 && (
            <div style={{ border: '1px solid var(--color-border)', borderRadius: '8px', overflow: 'hidden', maxHeight: '500px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ background: 'var(--color-surface-alt)', position: 'sticky', top: 0, zIndex: 1 }}>
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'left', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid var(--color-border)' }}>Sent To</th>
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'left', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid var(--color-border)' }}>Sent Date</th>
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'left', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid var(--color-border)' }}>Status</th>
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'left', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid var(--color-border)' }}>Replied By</th>
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'left', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid var(--color-border)' }}>Reply Date</th>
                  </tr>
                </thead>
                <tbody>
                  {displayResults.contacts.map((c, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--color-border-light)' }}>
                      <td style={{ padding: '0.4rem 0.6rem', color: 'var(--color-text)' }}>
                        <div style={{ fontWeight: 600 }}>{c.email}</div>
                        {c.recipientCount > 1 && <div style={{ fontSize: '0.6rem', color: 'var(--color-text-muted)' }}>{c.recipientCount} recipients</div>}
                      </td>
                      <td style={{ padding: '0.4rem 0.6rem', color: 'var(--color-text-secondary)' }}>{fmtDate(c.sentDate)}</td>
                      <td style={{ padding: '0.4rem 0.6rem' }}>
                        {c.replied
                          ? <span style={{ padding: '1px 6px', borderRadius: '999px', fontSize: '0.65rem', fontWeight: 600, background: '#DCFCE7', color: '#166534' }}>Replied</span>
                          : <span style={{ padding: '1px 6px', borderRadius: '999px', fontSize: '0.65rem', fontWeight: 600, background: '#F3F4F6', color: '#6B7280' }}>No Reply</span>
                        }
                      </td>
                      <td style={{ padding: '0.4rem 0.6rem', color: 'var(--color-text-secondary)', fontWeight: c.replied ? 600 : 400 }}>{c.repliedBy || '—'}</td>
                      <td style={{ padding: '0.4rem 0.6rem', color: 'var(--color-text-secondary)' }}>{c.replied ? fmtDate(c.replyDate) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Saved Campaigns */}
      {savedCampaigns.length > 0 && (
        <div style={{ marginTop: '1.5rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.5rem' }}>Saved Campaigns</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {savedCampaigns.map((c, i) => (
              <div
                key={i}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '0.5rem 0.7rem', border: viewingSaved === i ? '1px solid var(--color-accent)' : '1px solid var(--color-border)', borderRadius: '6px',
                  background: viewingSaved === i ? '#EFF6FF' : 'var(--color-surface)', cursor: 'pointer',
                }}
                onClick={() => viewCampaign(i)}
              >
                <div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text)' }}>{c.subject}</div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
                    Saved {fmtDate(c.savedAt)} — {c.uniqueRecipients} sent, {c.uniqueRepliers} replies
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
                  <span style={{ fontSize: '1rem', fontWeight: 700, color: c.responseRate >= 20 ? '#10B981' : c.responseRate >= 10 ? '#F59E0B' : '#DC2626' }}>{c.responseRate}%</span>
                  <button
                    onClick={e => { e.stopPropagation(); deleteCampaign(i); }}
                    style={{ background: 'none', border: 'none', color: '#CBD5E1', fontSize: '1rem', cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}
                    onMouseEnter={e => e.target.style.color = '#EF4444'}
                    onMouseLeave={e => e.target.style.color = '#CBD5E1'}
                    title="Delete campaign"
                  >&times;</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

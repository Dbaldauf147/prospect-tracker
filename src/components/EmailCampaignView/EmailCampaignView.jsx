import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../../utils/apiFetch';
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
  const [editingIndex, setEditingIndex] = useState(null); // index of saved campaign being edited
  const [editTitle, setEditTitle] = useState('');
  const [editSubject, setEditSubject] = useState('');
  const [refreshing, setRefreshing] = useState(false); // auto-refresh of an opened saved campaign in flight
  // Identifies the most recent "open a saved campaign" request so a slow
  // refresh for a campaign the user has since navigated away from can't stomp
  // the currently-shown one.
  const viewTokenRef = useRef(0);

  // Load saved campaigns from Firestore
  useEffect(() => {
    if (!user?.uid) return;
    (async () => {
      try {
        const ref = doc(db, 'emailCampaigns', user.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data();
          const campaigns = data.campaigns || [];
          console.log(`Loaded ${campaigns.length} saved campaigns from Firestore`);
          setSavedCampaigns(campaigns);
        } else {
          console.log('No saved campaigns found in Firestore');
        }
      } catch (err) { console.error('Failed to load campaigns:', err); }
    })();
  }, [user]);

  async function saveCampaigns(campaigns) {
    setSavedCampaigns(campaigns);
    if (!user?.uid) {
      console.error('Cannot save campaigns: no user');
      return;
    }
    try {
      const ref = doc(db, 'emailCampaigns', user.uid);
      await setDoc(ref, { campaigns, updatedAt: new Date().toISOString() });
      console.log(`Saved ${campaigns.length} campaigns to Firestore`);
    } catch (err) {
      console.error('Failed to save campaigns:', err);
      setError('Failed to save campaign: ' + (err.message || 'Unknown error'));
    }
  }

  // Pull the current activity for a subject line from the live source. Shared
  // by the manual Search and the automatic refresh that runs when a saved
  // campaign is opened.
  async function fetchCampaignActivity(subjectLine) {
    const res = await apiFetch('/api/email-campaign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: subjectLine.trim() }),
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    return json;
  }

  async function handleSearch() {
    if (!subject.trim()) return;
    setLoading(true);
    setError('');
    setResults(null);
    setViewingSaved(null);
    try {
      setResults(await fetchCampaignActivity(subject));
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
      // Title is the campaign's display name; subject is the email subject
      // line matched against sent mail. A freshly-searched campaign has no
      // separate title yet, so seed it from the subject — the user can split
      // them later by editing the saved campaign.
      title: results.title || results.subject,
      subject: results.subject,
      savedAt: new Date().toISOString(),
      uniqueRecipients: results.uniqueRecipients,
      uniqueRepliers: results.uniqueRepliers,
      responseRate: results.responseRate,
      totalEmails: results.totalEmails,
      sent: results.sent,
      replies: results.replies,
      autoRepliesSuppressed: results.autoRepliesSuppressed || 0,
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

  function removeContact(index) {
    if (!results) return;
    const updated = results.contacts.filter((_, i) => i !== index);
    const totalSends = updated.length;
    const totalReplied = updated.filter(c => c.replied).length;
    const responseRate = totalSends > 0 ? parseFloat(((totalReplied / totalSends) * 100).toFixed(1)) : 0;
    setResults({
      ...results,
      contacts: updated,
      sent: totalSends,
      replies: totalReplied,
      uniqueRecipients: totalSends,
      uniqueRepliers: totalReplied,
      responseRate,
    });
  }

  function deleteCampaign(index) {
    const updated = savedCampaigns.filter((_, i) => i !== index);
    saveCampaigns(updated);
    if (viewingSaved === index) { setViewingSaved(null); setResults(null); }
    else if (viewingSaved > index) setViewingSaved(viewingSaved - 1);
  }

  async function viewCampaign(index) {
    const c = savedCampaigns[index];
    if (!c) return;
    // Show the saved snapshot immediately for instant feedback, then pull the
    // latest activity in the background so the user never has to hit a refresh.
    setResults(c);
    setSubject(c.subject);
    setViewingSaved(index);
    setError('');
    if (!c.subject) return;
    const token = ++viewTokenRef.current;
    setRefreshing(true);
    try {
      const json = await fetchCampaignActivity(c.subject);
      // Drop the result if the user has since opened a different campaign.
      if (viewTokenRef.current !== token) return;
      // Keep the campaign's own title/subject; refresh only the activity.
      setResults({ ...json, title: c.title || c.subject, subject: c.subject });
      // Persist the fresher numbers so the saved list reflects them too, but
      // only when something actually changed — no needless Firestore writes.
      const changed =
        c.sent !== json.sent ||
        c.uniqueRecipients !== json.uniqueRecipients ||
        c.uniqueRepliers !== json.uniqueRepliers ||
        c.responseRate !== json.responseRate ||
        c.replies !== json.replies;
      if (changed) {
        const merged = {
          ...c,
          uniqueRecipients: json.uniqueRecipients,
          uniqueRepliers: json.uniqueRepliers,
          responseRate: json.responseRate,
          totalEmails: json.totalEmails,
          sent: json.sent,
          replies: json.replies,
          autoRepliesSuppressed: json.autoRepliesSuppressed || 0,
          contacts: json.contacts,
          refreshedAt: new Date().toISOString(),
        };
        saveCampaigns(savedCampaigns.map((x, i) => (i === index ? merged : x)));
      }
    } catch (err) {
      // Keep the saved snapshot on screen; just note the refresh didn't land.
      if (viewTokenRef.current === token) {
        setError('Couldn’t refresh the latest activity (' + (err.message || 'unknown error') + ') — showing the last saved numbers.');
      }
    } finally {
      if (viewTokenRef.current === token) setRefreshing(false);
    }
  }

  function startEdit(index, e) {
    if (e) e.stopPropagation();
    setError('');
    const c = savedCampaigns[index];
    setEditingIndex(index);
    setEditTitle(c?.title || c?.subject || '');
    setEditSubject(c?.subject || '');
  }

  function cancelEdit(e) {
    if (e) e.stopPropagation();
    setEditingIndex(null);
    setEditTitle('');
    setEditSubject('');
  }

  // Edit a saved campaign's two fields: the Title (display name) and the
  // Subject line (the email subject matched against sent mail). Subject stays
  // the campaign's identity, so it must be non-empty and can't collide with
  // another campaign's subject. Persists to Firestore and keeps the open
  // campaign + the search box in sync when the edited one is being viewed.
  async function commitEdit() {
    const idx = editingIndex;
    if (idx == null) return;
    const current = savedCampaigns[idx];
    if (!current) { cancelEdit(); return; }
    const subject = editSubject.trim();
    const title = editTitle.trim() || subject;
    if (!subject) {
      setError('Subject line can’t be empty.');
      return;
    }
    if (savedCampaigns.some((c, i) => i !== idx && String(c.subject || '').trim().toLowerCase() === subject.toLowerCase())) {
      setError(`Another campaign already uses the subject "${subject}" — choose a different one.`);
      return;
    }
    if (subject === current.subject && title === (current.title || current.subject)) { cancelEdit(); return; }
    setError('');
    const updated = savedCampaigns.map((c, i) => (i === idx ? { ...c, title, subject } : c));
    await saveCampaigns(updated);
    if (viewingSaved === idx) {
      setSubject(subject);
      setResults(r => (r ? { ...r, title, subject } : r));
    }
    setEditingIndex(null);
    setEditTitle('');
    setEditSubject('');
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
              {(displayResults.title && displayResults.title !== displayResults.subject) && (
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-text)', marginBottom: '2px' }}>{displayResults.title}</div>
              )}
              Matching subject: <strong>"{displayResults.subject}"</strong>
              {viewingSaved !== null && <span style={{ marginLeft: '0.5rem', padding: '1px 6px', borderRadius: '999px', fontSize: '0.6rem', fontWeight: 600, background: '#DBEAFE', color: '#1E40AF' }}>Saved</span>}
              {refreshing && <span style={{ marginLeft: '0.5rem', fontSize: '0.6rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>↻ Refreshing…</span>}
              {displayResults.autoRepliesSuppressed > 0 && (
                <span
                  title="Out-of-office, vacation, and delivery-failure replies are excluded from the response count."
                  style={{ marginLeft: '0.5rem', padding: '1px 6px', borderRadius: '999px', fontSize: '0.6rem', fontWeight: 600, background: '#F1F5F9', color: '#475569' }}
                >{displayResults.autoRepliesSuppressed} auto-reply{displayResults.autoRepliesSuppressed === 1 ? '' : 's'} suppressed</span>
              )}
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
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'center', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '0.68rem', borderBottom: '1px solid var(--color-border)', width: '36px' }}></th>
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
                      <td style={{ padding: '0.4rem 0.3rem', textAlign: 'center' }}>
                        <button
                          onClick={() => removeContact(i)}
                          style={{ background: 'none', border: 'none', color: '#CBD5E1', fontSize: '0.85rem', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
                          onMouseEnter={e => e.target.style.color = '#EF4444'}
                          onMouseLeave={e => e.target.style.color = '#CBD5E1'}
                          title="Remove from list"
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

      {/* Saved Campaigns */}
      {savedCampaigns.length > 0 && (
        <div style={{ marginTop: '1.5rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.5rem' }}>Saved Campaigns</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {savedCampaigns.map((c, i) => {
              const isEditing = editingIndex === i;
              return (
              <div
                key={i}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '0.5rem 0.7rem', border: viewingSaved === i ? '1px solid var(--color-accent)' : '1px solid var(--color-border)', borderRadius: '6px',
                  background: viewingSaved === i ? '#EFF6FF' : 'var(--color-surface)', cursor: isEditing ? 'default' : 'pointer',
                }}
                onClick={isEditing ? undefined : () => viewCampaign(i)}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  {isEditing ? (
                    <div onClick={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--color-text-secondary)', marginBottom: '2px' }}>Title</label>
                        <input
                          autoFocus
                          type="text"
                          value={editTitle}
                          onChange={e => setEditTitle(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
                            else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                          }}
                          placeholder="Campaign title"
                          style={{ width: '100%', boxSizing: 'border-box', padding: '0.3rem 0.5rem', border: '1px solid var(--color-accent)', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 600, fontFamily: 'inherit' }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--color-text-secondary)', marginBottom: '2px' }}>Subject line</label>
                        <input
                          type="text"
                          value={editSubject}
                          onChange={e => setEditSubject(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
                            else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                          }}
                          placeholder="Email subject line"
                          style={{ width: '100%', boxSizing: 'border-box', padding: '0.3rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: '4px', fontSize: '0.78rem', fontFamily: 'inherit', color: 'var(--color-text-secondary)' }}
                        />
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title || c.subject}</div>
                      {(c.title && c.title !== c.subject) && (
                        <div style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', marginTop: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.subject}>Subject: {c.subject}</div>
                      )}
                    </>
                  )}
                  <div style={{ fontSize: '0.65rem', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
                    Saved {fmtDate(c.savedAt)} — {c.uniqueRecipients} sent, {c.uniqueRepliers} replies
                    {c.refreshedAt && <span style={{ color: 'var(--color-text-muted)' }}> · updated {fmtDate(c.refreshedAt)}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0, marginLeft: '0.5rem' }}>
                  {isEditing ? (
                    <>
                      <button
                        onClick={e => { e.stopPropagation(); commitEdit(); }}
                        style={{ border: 'none', background: 'var(--color-accent)', color: '#fff', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', padding: '0.25rem 0.6rem' }}
                        title="Save changes"
                      >Save</button>
                      <button
                        onClick={cancelEdit}
                        style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', padding: '0.25rem 0.55rem' }}
                        title="Cancel"
                      >Cancel</button>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: '1rem', fontWeight: 700, color: c.responseRate >= 20 ? '#10B981' : c.responseRate >= 10 ? '#F59E0B' : '#DC2626' }}>{c.responseRate}%</span>
                      <button
                        onClick={e => startEdit(i, e)}
                        style={{ background: 'none', border: 'none', color: '#94A3B8', fontSize: '0.85rem', cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}
                        onMouseEnter={e => e.currentTarget.style.color = 'var(--color-accent)'}
                        onMouseLeave={e => e.currentTarget.style.color = '#94A3B8'}
                        title="Edit title & subject"
                      >✎</button>
                      <button
                        onClick={e => { e.stopPropagation(); deleteCampaign(i); }}
                        style={{ background: 'none', border: 'none', color: '#CBD5E1', fontSize: '1rem', cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}
                        onMouseEnter={e => e.currentTarget.style.color = '#EF4444'}
                        onMouseLeave={e => e.currentTarget.style.color = '#CBD5E1'}
                        title="Delete campaign"
                      >&times;</button>
                    </>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

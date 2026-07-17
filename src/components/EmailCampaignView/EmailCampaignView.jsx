import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../../utils/apiFetch';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { addQueuedRecipients } from '../../utils/draftRecipientsQueue';

export function EmailCampaignView() {
  const { user } = useAuth();
  const [subject, setSubject] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Transient success line for the "Add unsent to Draft" action.
  const [notice, setNotice] = useState('');
  const [results, setResults] = useState(null);
  const [savedCampaigns, setSavedCampaigns] = useState([]);
  const [viewingSaved, setViewingSaved] = useState(null); // index of saved campaign being viewed
  const [saving, setSaving] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null); // index of saved campaign being edited
  const [editTitle, setEditTitle] = useState('');
  const [editSubject, setEditSubject] = useState('');
  const [refreshing, setRefreshing] = useState(false); // auto-refresh of an opened saved campaign in flight
  const [refreshingAll, setRefreshingAll] = useState(false); // "Refresh all" sweep in flight
  // Which column the contact table is sorted by, and the direction. key === null
  // leaves the table in its natural (roster) order.
  const [sortConfig, setSortConfig] = useState({ key: null, dir: 'asc' });
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

  // A contact has actually been emailed once HubSpot reports a send for it
  // (they carry a sentDate). Roster members added to a campaign but not yet
  // emailed have an empty sentDate — they stay in the list as "Not Sent".
  function wasSent(c) { return !!(c && c.sentDate); }

  // Derive the summary counts from the campaign's own roster so the numbers
  // reflect everyone in the campaign, not just whoever the live search
  // returned. Response rate is measured against the contacts actually emailed.
  function deriveCounts(contacts) {
    const list = contacts || [];
    const totalContacts = list.length;
    const sent = list.filter(wasSent).length;
    const replies = list.filter(c => c.replied).length;
    const responseRate = sent > 0 ? parseFloat(((replies / sent) * 100).toFixed(1)) : 0;
    return { totalContacts, sent, replies, uniqueRecipients: sent, uniqueRepliers: replies, responseRate };
  }

  const normEmail = (e) => String(e || '').toLowerCase().trim();

  // Layer freshly-fetched HubSpot activity onto a campaign's own roster,
  // matched by email. Roster members who haven't been emailed yet stay in the
  // list; recipients found in HubSpot that aren't already in the roster get
  // appended; and anyone the user manually removed (tombstoned in
  // removedEmails) stays out. This is what makes contacts "stick" to a
  // campaign instead of the list being replaced by each live search.
  function mergeContacts(savedContacts, fetchedContacts, removedEmails) {
    const removed = new Set((removedEmails || []).map(normEmail).filter(Boolean));
    // Index fetched activity by each individual recipient email.
    const activityByEmail = new Map();
    for (const fc of (fetchedContacts || [])) {
      for (const e of String(fc.email || '').split(';').map(normEmail).filter(Boolean)) {
        if (!activityByEmail.has(e)) activityByEmail.set(e, fc);
      }
    }
    const rosterEmails = new Set();
    const merged = [];
    for (const rc of (savedContacts || [])) {
      const key = normEmail(rc.email);
      if (key && removed.has(key)) continue; // manually removed — stay gone
      if (key) rosterEmails.add(key);
      const act = activityByEmail.get(key);
      if (act) {
        // Keep the roster entry's identity + event status; refresh send/reply.
        merged.push({ ...rc, sentDate: act.sentDate, replied: !!act.replied, replyDate: act.replyDate, repliedBy: act.repliedBy, recipientCount: act.recipientCount || 1 });
      } else {
        merged.push({ ...rc });
      }
    }
    // Append recipients HubSpot returned that aren't already in the roster
    // and weren't manually removed.
    for (const fc of (fetchedContacts || [])) {
      const emails = String(fc.email || '').split(';').map(normEmail).filter(Boolean);
      if (emails.length === 0) continue;
      if (emails.some(e => rosterEmails.has(e) || removed.has(e))) continue;
      merged.push({ ...fc, eventStatus: fc.eventStatus || '' });
      emails.forEach(e => rosterEmails.add(e));
    }
    return merged;
  }

  // Fold freshly-fetched activity into a saved campaign, preserving its own
  // identity/edits (title, subject, savedAt), its roster, its event statuses,
  // and its manual removals, and stamping when it refreshed.
  function mergeActivity(c, json) {
    const contacts = mergeContacts(c.contacts, json.contacts, c.removedEmails);
    return {
      ...c,
      ...deriveCounts(contacts),
      totalEmails: json.totalEmails,
      autoRepliesSuppressed: json.autoRepliesSuppressed || 0,
      contacts,
      refreshedAt: new Date().toISOString(),
    };
  }

  // Re-pull activity for every saved campaign at once. Campaigns that fail to
  // refresh keep their last saved numbers; everything is persisted in a single
  // write, and the open campaign (if any) is updated to match.
  async function refreshAllCampaigns() {
    if (refreshingAll || savedCampaigns.length === 0) return;
    setRefreshingAll(true);
    setError('');
    const current = savedCampaigns;
    const outcomes = await Promise.all(current.map(async (c) => {
      if (!c.subject) return { campaign: c, ok: true };
      try {
        return { campaign: mergeActivity(c, await fetchCampaignActivity(c.subject)), ok: true };
      } catch {
        return { campaign: c, ok: false };
      }
    }));
    const updated = outcomes.map(o => o.campaign);
    await saveCampaigns(updated);
    // Keep the open campaign's view in sync with its refreshed numbers.
    if (viewingSaved != null && updated[viewingSaved]) {
      const c = updated[viewingSaved];
      setResults({ ...c, title: c.title || c.subject, subject: c.subject });
    }
    const failedNames = outcomes.filter(o => !o.ok).map(o => o.campaign.title || o.campaign.subject || '(untitled)');
    if (failedNames.length > 0) {
      setError(`Refreshed ${updated.length - failedNames.length} of ${updated.length} campaigns — couldn’t reach ${failedNames.length} (kept last saved numbers): ${failedNames.join(', ')}.`);
    }
    setRefreshingAll(false);
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
      ...deriveCounts(results.contacts),
      totalEmails: results.totalEmails,
      autoRepliesSuppressed: results.autoRepliesSuppressed || 0,
      removedEmails: results.removedEmails || [],
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

  // Push every "Not Sent" contact (in the campaign roster but never emailed)
  // into the shared Draft Emails recipients queue, so they can be dropped into
  // the composer's To section on the Draft Emails page. Multi-recipient cells
  // are split into individual addresses; deduped by email in the queue.
  function queueUnsentToDraft() {
    const list = displayResults?.contacts || [];
    const recipients = [];
    for (const c of list) {
      if (c.sentDate) continue; // only the "Not Sent" rows
      const emails = String(c.email || '').split(';').map(e => e.trim()).filter(Boolean);
      emails.forEach((email) => {
        const raw = emails.length === 1 ? String(c.name || '').trim() : '';
        const name = raw || email.split('@')[0].replace(/[._]+/g, ' ').replace(/\b\w/g, m => m.toUpperCase());
        const parts = name.split(/\s+/).filter(Boolean);
        recipients.push({
          id: `campaign:${email.toLowerCase()}`,
          email,
          name,
          firstName: parts[0] || '',
          lastName: parts.slice(1).join(' '),
          company: c.company || '',
        });
      });
    }
    if (recipients.length === 0) {
      setNotice('No unsent contacts — everyone in this campaign has already been emailed.');
      setTimeout(() => setNotice(''), 5000);
      return;
    }
    const added = addQueuedRecipients(recipients);
    const dupes = recipients.length - added;
    setNotice(
      `Queued ${added} recipient${added === 1 ? '' : 's'} for Draft Emails${dupes > 0 ? ` (${dupes} already queued)` : ''}. `
      + 'Open Draft Emails → "From Email Campaigns" → "Add all to draft" to drop them into the To section.',
    );
    setTimeout(() => setNotice(''), 9000);
  }

  // Remove a contact from the campaign. The removal is recorded as a tombstone
  // (removedEmails) so a later refresh won't re-add them from the live search —
  // "sticks unless I manually remove them." Persisted for saved campaigns.
  function removeContact(index) {
    if (!results) return;
    const removedContact = results.contacts[index];
    const updated = results.contacts.filter((_, i) => i !== index);
    const removedEmails = Array.from(new Set([
      ...(results.removedEmails || []),
      ...String(removedContact?.email || '').split(';').map(normEmail).filter(Boolean),
    ]));
    const counts = deriveCounts(updated);
    setResults({ ...results, contacts: updated, removedEmails, ...counts });
    if (viewingSaved != null) {
      saveCampaigns(savedCampaigns.map((c, i) => (i === viewingSaved
        ? { ...c, contacts: updated, removedEmails, ...counts }
        : c)));
    }
  }

  // Mark a contact's RSVP for the campaign's event (going / not going / maybe).
  // Stored on the contact and preserved across refreshes; persisted for saved
  // campaigns.
  function setEventStatus(index, value) {
    if (!results) return;
    const updated = results.contacts.map((c, i) => (i === index ? { ...c, eventStatus: value } : c));
    setResults({ ...results, contacts: updated });
    if (viewingSaved != null) {
      saveCampaigns(savedCampaigns.map((c, i) => (i === viewingSaved ? { ...c, contacts: updated } : c)));
    }
  }

  // A contact's identity for duplicate detection: its recipient set, normalized
  // and order-independent so "a@x.com; b@x.com" and "b@x.com; a@x.com" match.
  const contactKey = (c) => String(c?.email || '').split(';').map(normEmail).filter(Boolean).sort().join(',');

  // How much real information a row carries — used to pick which copy of a
  // duplicate to keep: a replied row beats a sent row beats one with just an
  // event status.
  function contactInfoScore(c) {
    return (c?.replied ? 4 : 0) + (c?.sentDate ? 2 : 0) + (c?.eventStatus ? 1 : 0);
  }

  // Flag contacts that appear more than once in the campaign (by recipient
  // set). Returns the set of duplicated keys plus how many extra rows exist so
  // the UI can both badge the rows and offer to collapse them.
  function findDuplicates(contacts) {
    const counts = new Map();
    for (const c of (contacts || [])) {
      const k = contactKey(c);
      if (k) counts.set(k, (counts.get(k) || 0) + 1);
    }
    const dupKeys = new Set();
    let extraRows = 0;
    for (const [k, n] of counts) {
      if (n > 1) { dupKeys.add(k); extraRows += n - 1; }
    }
    return { dupKeys, extraRows };
  }

  // Collapse duplicates to one row each, keeping the copy with the most
  // information and carrying over an event status from a discarded copy if the
  // kept one has none. This is a de-dup, not a manual removal, so it does NOT
  // tombstone emails — the surviving copy shares the same address.
  function removeDuplicates() {
    if (!results) return;
    const byKey = new Map(); // key -> index in kept
    const kept = [];
    for (const c of results.contacts) {
      const k = contactKey(c);
      if (!k) { kept.push(c); continue; }
      if (!byKey.has(k)) { byKey.set(k, kept.length); kept.push(c); continue; }
      const idx = byKey.get(k);
      const winner = contactInfoScore(c) > contactInfoScore(kept[idx]) ? { ...c } : { ...kept[idx] };
      if (!winner.eventStatus) winner.eventStatus = kept[idx].eventStatus || c.eventStatus || '';
      kept[idx] = winner;
    }
    if (kept.length === results.contacts.length) return; // nothing to collapse
    const counts = deriveCounts(kept);
    setResults({ ...results, contacts: kept, ...counts });
    if (viewingSaved != null) {
      saveCampaigns(savedCampaigns.map((c, i) => (i === viewingSaved ? { ...c, contacts: kept, ...counts } : c)));
    }
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
    // Re-derive counts from the roster so the numbers reflect everyone in the
    // campaign right away, even before the background refresh lands.
    setResults({ ...c, ...deriveCounts(c.contacts) });
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
      // Merge the live activity into the campaign's roster (keep the
      // campaign's own title/subject) rather than replacing the contact list —
      // so unsent roster members and event statuses survive the refresh.
      const merged = mergeActivity(c, json);
      setResults({ ...merged, title: c.title || c.subject, subject: c.subject });
      // Persist the fresher numbers so the saved list reflects them too, but
      // only when something actually changed — no needless Firestore writes.
      const changed =
        JSON.stringify(c.contacts || []) !== JSON.stringify(merged.contacts) ||
        c.sent !== merged.sent ||
        c.uniqueRepliers !== merged.uniqueRepliers ||
        c.responseRate !== merged.responseRate;
      if (changed) {
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

  // Click a column header to sort by it; click again to flip direction. A new
  // column starts ascending.
  function toggleSort(key) {
    setSortConfig(prev => (prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'asc' }));
  }

  // Where a contact falls in the send/reply lifecycle, used to sort the Status
  // column meaningfully: Not Sent < No Reply < Replied.
  function statusRank(c) {
    if (c.replied) return 2;
    if (c.sentDate) return 1;
    return 0;
  }

  // The comparable value for a contact in a given column. Dates become numeric
  // timestamps and text is lowercased so sorting is case-insensitive; missing
  // values sort to one end consistently.
  function sortValue(c, key) {
    switch (key) {
      case 'email': return String(c.email || '').toLowerCase();
      case 'sentDate': return c.sentDate ? (new Date(c.sentDate).getTime() || 0) : 0;
      case 'status': return statusRank(c);
      case 'repliedBy': return String(c.repliedBy || '').toLowerCase();
      case 'replyDate': return c.replied && c.replyDate ? (new Date(c.replyDate).getTime() || 0) : 0;
      case 'eventStatus': return String(c.eventStatus || '');
      default: return '';
    }
  }

  const displayResults = results;
  const { dupKeys, extraRows } = findDuplicates(displayResults?.contacts);

  // Rows to render, carrying each contact's ORIGINAL index so the row actions
  // (remove, event status) keep pointing at the right entry in
  // results.contacts even after the display order changes. A stable sort falls
  // back to the original index to keep equal rows in their prior order.
  const sortedContacts = (() => {
    const list = (displayResults?.contacts || []).map((c, i) => ({ c, i }));
    if (!sortConfig.key) return list;
    const dir = sortConfig.dir === 'asc' ? 1 : -1;
    return list.slice().sort((a, b) => {
      const va = sortValue(a.c, sortConfig.key);
      const vb = sortValue(b.c, sortConfig.key);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return a.i - b.i;
    });
  })();

  const SORT_HEADER_STYLE = { padding: '0.45rem 0.6rem', textAlign: 'left', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid var(--color-border)', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' };
  function SortHeader({ label, sortKey }) {
    const active = sortConfig.key === sortKey;
    return (
      <th onClick={() => toggleSort(sortKey)} style={SORT_HEADER_STYLE} title={`Sort by ${label}`}>
        {label}
        <span style={{ marginLeft: '0.3rem', fontSize: '0.7rem', opacity: active ? 1 : 0.3 }}>
          {active ? (sortConfig.dir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </th>
    );
  }

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
              <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total Contacts</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--color-text)' }}>{displayResults.totalContacts ?? displayResults.contacts?.length ?? displayResults.totalEmails}</div>
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
            <div style={{ display: 'inline-flex', gap: '0.5rem', flexShrink: 0 }}>
              {(() => {
                const unsent = (displayResults.contacts || []).filter(c => !c.sentDate).length;
                return (
                  <button
                    onClick={queueUnsentToDraft}
                    disabled={unsent === 0}
                    title={unsent === 0
                      ? 'No unsent contacts — everyone has been emailed'
                      : 'Queue every "Not Sent" contact for the Draft Emails composer'}
                    style={{
                      padding: '0.35rem 0.75rem', border: '1px solid #1D4ED8', borderRadius: '6px',
                      background: unsent === 0 ? '#F1F5F9' : '#fff', color: unsent === 0 ? '#94A3B8' : '#1D4ED8',
                      fontSize: '0.75rem', fontWeight: 600, fontFamily: 'inherit', cursor: unsent === 0 ? 'default' : 'pointer',
                    }}
                  >
                    Add unsent to Draft{unsent > 0 ? ` (${unsent})` : ''}
                  </button>
                );
              })()}
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
          </div>

          {notice && (
            <div style={{ padding: '0.5rem 0.75rem', background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: '6px', fontSize: '0.78rem', color: '#065F46', marginBottom: '0.75rem' }}>
              {notice}
            </div>
          )}

          {/* Duplicate contacts warning */}
          {dupKeys.size > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0.75rem', marginBottom: '0.5rem', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: '6px', fontSize: '0.78rem', color: '#92400E' }}>
              <span>
                <strong>⚠ {dupKeys.size} duplicate contact{dupKeys.size === 1 ? '' : 's'}</strong> in this campaign
                {extraRows > 0 && <> — {extraRows} extra row{extraRows === 1 ? '' : 's'}</>}. Duplicated rows are flagged below.
              </span>
              <button
                onClick={removeDuplicates}
                style={{ flexShrink: 0, padding: '0.3rem 0.7rem', border: 'none', borderRadius: '6px', background: '#D97706', color: '#fff', fontSize: '0.72rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}
                title="Collapse each duplicated contact to a single row, keeping the copy with the most activity"
              >Remove duplicates</button>
            </div>
          )}

          {/* Contact table */}
          {displayResults.contacts && displayResults.contacts.length > 0 && (
            <div style={{ border: '1px solid var(--color-border)', borderRadius: '8px', overflow: 'hidden', maxHeight: '500px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ background: 'var(--color-surface-alt)', position: 'sticky', top: 0, zIndex: 1 }}>
                    <SortHeader label="Sent To" sortKey="email" />
                    <SortHeader label="Sent Date" sortKey="sentDate" />
                    <SortHeader label="Status" sortKey="status" />
                    <SortHeader label="Replied By" sortKey="repliedBy" />
                    <SortHeader label="Reply Date" sortKey="replyDate" />
                    <SortHeader label="Event Status" sortKey="eventStatus" />
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'center', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '0.68rem', borderBottom: '1px solid var(--color-border)', width: '36px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedContacts.map(({ c, i }) => {
                    const isDup = dupKeys.has(contactKey(c));
                    return (
                    <tr key={i} style={{ borderBottom: '1px solid var(--color-border-light)', background: isDup ? '#FFFBEB' : undefined }}>
                      <td style={{ padding: '0.4rem 0.6rem', color: 'var(--color-text)' }}>
                        <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          {c.email}
                          {isDup && <span style={{ padding: '1px 6px', borderRadius: '999px', fontSize: '0.6rem', fontWeight: 700, background: '#FDE68A', color: '#92400E' }} title="This contact appears more than once in this campaign">Duplicate</span>}
                        </div>
                        {c.recipientCount > 1 && <div style={{ fontSize: '0.6rem', color: 'var(--color-text-muted)' }}>{c.recipientCount} recipients</div>}
                      </td>
                      <td style={{ padding: '0.4rem 0.6rem', color: 'var(--color-text-secondary)' }}>{fmtDate(c.sentDate)}</td>
                      <td style={{ padding: '0.4rem 0.6rem' }}>
                        {c.replied
                          ? <span style={{ padding: '1px 6px', borderRadius: '999px', fontSize: '0.65rem', fontWeight: 600, background: '#DCFCE7', color: '#166534' }}>Replied</span>
                          : c.sentDate
                            ? <span style={{ padding: '1px 6px', borderRadius: '999px', fontSize: '0.65rem', fontWeight: 600, background: '#F3F4F6', color: '#6B7280' }}>No Reply</span>
                            : <span style={{ padding: '1px 6px', borderRadius: '999px', fontSize: '0.65rem', fontWeight: 600, background: '#FEF3C7', color: '#92400E' }} title="In this campaign but not yet sent the email">Not Sent</span>
                        }
                      </td>
                      <td style={{ padding: '0.4rem 0.6rem', color: 'var(--color-text-secondary)', fontWeight: c.replied ? 600 : 400 }}>{c.repliedBy || '—'}</td>
                      <td style={{ padding: '0.4rem 0.6rem', color: 'var(--color-text-secondary)' }}>{c.replied ? fmtDate(c.replyDate) : '—'}</td>
                      <td style={{ padding: '0.4rem 0.6rem' }}>
                        {(() => {
                          const EVENT_STATUS_STYLES = {
                            going: { background: '#DCFCE7', color: '#166534', border: '1px solid #86EFAC' },
                            'not-going': { background: '#FEE2E2', color: '#991B1B', border: '1px solid #FCA5A5' },
                            maybe: { background: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A' },
                          };
                          const s = EVENT_STATUS_STYLES[c.eventStatus] || { background: 'var(--color-surface)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' };
                          return (
                            <select
                              value={c.eventStatus || ''}
                              onChange={e => setEventStatus(i, e.target.value)}
                              style={{ padding: '2px 4px', borderRadius: '6px', fontSize: '0.68rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', ...s }}
                            >
                              <option value="">—</option>
                              <option value="going">Going</option>
                              <option value="not-going">Not going</option>
                              <option value="maybe">Maybe</option>
                            </select>
                          );
                        })()}
                      </td>
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
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Saved Campaigns */}
      {savedCampaigns.length > 0 && (
        <div style={{ marginTop: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Saved Campaigns</div>
            <button
              onClick={refreshAllCampaigns}
              disabled={refreshingAll}
              title="Re-pull the latest activity for every saved campaign"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                padding: '0.3rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: '6px',
                background: 'var(--color-surface)', color: 'var(--color-text-secondary)',
                fontSize: '0.7rem', fontWeight: 600, fontFamily: 'inherit',
                cursor: refreshingAll ? 'wait' : 'pointer', opacity: refreshingAll ? 0.7 : 1,
              }}
            >
              <span style={{ display: 'inline-block' }}>↻</span>
              {refreshingAll ? 'Refreshing…' : 'Refresh all'}
            </button>
          </div>
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
                    Saved {fmtDate(c.savedAt)} — {c.uniqueRecipients} of {c.totalContacts ?? c.contacts?.length ?? c.uniqueRecipients} sent, {c.uniqueRepliers} replies
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

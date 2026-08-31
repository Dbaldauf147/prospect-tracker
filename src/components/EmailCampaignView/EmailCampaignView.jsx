import { useState, useEffect, useMemo, useRef } from 'react';
import { apiFetch } from '../../utils/apiFetch';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { addQueuedRecipients } from '../../utils/draftRecipientsQueue';
import { useEmailTracking, trackingByRecipient, normalizeTrackedEmail, sentAtByRecipient } from '../../hooks/useEmailTracking';
import { describeExcludedOpens } from '../../utils/emailOpens';

// `openSubject` lets a sibling tab (Email Tracking) ask for a saved campaign
// to be opened by its subject line; `onOpened` acknowledges the request so
// the same campaign can be asked for again.
export function EmailCampaignView({ openSubject, onOpened }) {
  const { user } = useAuth();
  const [subject, setSubject] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Transient success line for the "Add unsent to Draft" action.
  const [notice, setNotice] = useState('');
  const [results, setResults] = useState(null);
  const [savedCampaigns, setSavedCampaigns] = useState([]);
  const [campaignsLoaded, setCampaignsLoaded] = useState(false);
  const [viewingSaved, setViewingSaved] = useState(null); // index of saved campaign being viewed
  const [saving, setSaving] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null); // index of saved campaign being edited
  const [editTitle, setEditTitle] = useState('');
  const [editSubject, setEditSubject] = useState('');
  const [editingSubjectInline, setEditingSubjectInline] = useState(false); // editing the open campaign's subject from the results header
  const [subjectDraft, setSubjectDraft] = useState('');
  // Draft for the "add an email to this campaign" input. Manually-added
  // addresses are the only way contacts enter a campaign's fixed list.
  const [addEmail, setAddEmail] = useState('');
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
      setCampaignsLoaded(true);
    })();
  }, [user]);

  // Honour an "open this campaign" request from the Email Tracking tab. Waits
  // for the saved list to land, matches on the exact subject line, and opens
  // the campaign the same way clicking it in the saved list would. Requests
  // for a subject with no saved campaign are acknowledged and dropped.
  useEffect(() => {
    if (!openSubject || !campaignsLoaded) return;
    const want = String(openSubject).trim().toLowerCase();
    const idx = savedCampaigns.findIndex(c => String(c?.subject || '').trim().toLowerCase() === want);
    if (idx !== -1) viewCampaign(idx);
    onOpened?.();
    // viewCampaign/onOpened are stable enough for this one-shot handoff;
    // re-running on their identity would re-open the campaign on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSubject, campaignsLoaded, savedCampaigns]);

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
    // The endpoint returns JSON on success and on its own handled errors,
    // but a platform-level failure — the function crashing or timing out
    // while paging a large mailbox — sends back plain text / HTML (e.g.
    // "An error occurred with this application"). Read the body as text
    // first and parse defensively so those never surface as an opaque
    // "Unexpected token" JSON error; give the caller a clean message.
    const body = await res.text();
    let json;
    let parsed = true;
    try { json = body ? JSON.parse(body) : {}; } catch { parsed = false; }
    if (!parsed) {
      const snippet = body.replace(/\s+/g, ' ').trim().slice(0, 100);
      throw new Error(
        res.ok
          ? `the server sent an unexpected response${snippet ? `: “${snippet}”` : ''}`
          : `the server is temporarily unavailable (HTTP ${res.status})`,
      );
    }
    if (!res.ok) throw new Error(json.error || `request failed (HTTP ${res.status})`);
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
  // matched by email. The roster is a FIXED, manually-curated list: every
  // contact in the campaign is one the user put there. Fetched activity for
  // the campaign's subject line is used ONLY to update the send/reply status
  // of contacts already in the roster — recipients HubSpot returns that
  // aren't in the roster are deliberately NOT pulled in. The campaign tracks
  // the emails the user added, not everyone who happened to receive that
  // subject line. Contacts the user manually removed (tombstoned in
  // removedEmails) stay out.
  function mergeContacts(savedContacts, fetchedContacts, removedEmails) {
    const removed = new Set((removedEmails || []).map(normEmail).filter(Boolean));
    // Index fetched activity by each individual recipient email.
    const activityByEmail = new Map();
    for (const fc of (fetchedContacts || [])) {
      for (const e of String(fc.email || '').split(';').map(normEmail).filter(Boolean)) {
        if (!activityByEmail.has(e)) activityByEmail.set(e, fc);
      }
    }
    const merged = [];
    for (const rc of (savedContacts || [])) {
      const key = normEmail(rc.email);
      if (key && removed.has(key)) continue; // manually removed — stay gone
      const act = activityByEmail.get(key);
      if (act) {
        // Keep the roster entry's identity + event status; refresh send/reply.
        merged.push({ ...rc, sentDate: act.sentDate, replied: !!act.replied, replyDate: act.replyDate, repliedBy: act.repliedBy, recipientCount: act.recipientCount || 1 });
      } else {
        // No matching send for this subject → the contact stays in the fixed
        // list as "Not Sent". Nothing new is appended from the search.
        merged.push({ ...rc });
      }
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

  // Re-pull activity for every saved campaign. Campaigns that fail to refresh
  // keep their last saved numbers; everything is persisted in a single write,
  // and the open campaign (if any) is updated to match.
  //
  // One campaign at a time, deliberately: HubSpot's per-second cap is
  // portal-wide, and firing every campaign at once (each of which pages the
  // search API) walks straight into it — the sweep would come back with half
  // the campaigns rate-limited. Sequential takes longer but actually returns
  // fresh numbers for all of them.
  async function refreshAllCampaigns() {
    if (refreshingAll || savedCampaigns.length === 0) return;
    setRefreshingAll(true);
    setError('');
    const current = savedCampaigns;
    const outcomes = [];
    for (const c of current) {
      if (!c.subject) { outcomes.push({ campaign: c, ok: true }); continue; }
      try {
        outcomes.push({ campaign: mergeActivity(c, await fetchCampaignActivity(c.subject)), ok: true });
      } catch {
        outcomes.push({ campaign: c, ok: false });
      }
    }
    const updated = outcomes.map(o => o.campaign);
    await saveCampaigns(updated);
    // Keep the open campaign's view in sync with its refreshed numbers.
    if (viewingSaved != null && updated[viewingSaved]) {
      const c = updated[viewingSaved];
      setResults({ ...c, title: c.title || c.subject, subject: c.subject });
    }
    const failedNames = outcomes.filter(o => !o.ok).map(o => o.campaign.title || o.campaign.subject || '(untitled)');
    if (failedNames.length > 0) {
      setError(`Refreshed ${updated.length - failedNames.length} of ${updated.length} campaigns: couldn’t reach ${failedNames.length} (kept last saved numbers): ${failedNames.join(', ')}.`);
    }
    setRefreshingAll(false);
  }

  async function handleSearch() {
    if (!subject.trim()) return;
    setLoading(true);
    setError('');
    setResults(null);
    setViewingSaved(null);
    setEditingSubjectInline(false);
    setSubjectDraft('');
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
      setNotice('No unsent contacts: everyone in this campaign has already been emailed.');
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

  // Manually add one or more emails to the campaign's fixed roster. This is
  // how the user builds the list the campaign tracks — the subject search
  // never adds contacts on its own (see mergeContacts). Accepts a string of
  // one or more addresses separated by ; , or whitespace. Each new address is
  // appended as a "Not Sent" roster member (deduped against the current
  // roster) and un-tombstoned so a later refresh keeps it. Then the latest
  // activity for the campaign's subject is pulled so any added email that was
  // in fact sent this subject immediately shows its Sent / Replied status.
  async function addContacts(raw) {
    if (!results) return;
    const wanted = String(raw || '')
      .split(/[;,\s]+/)
      .map(e => e.trim())
      .filter(e => /.+@.+\..+/.test(e));
    if (wanted.length === 0) { setError('Enter a valid email address to add.'); return; }
    const existing = new Set((results.contacts || [])
      .flatMap(c => String(c.email || '').split(';').map(normEmail).filter(Boolean)));
    const additions = [];
    const seen = new Set();
    for (const e of wanted) {
      const key = normEmail(e);
      if (!key || existing.has(key) || seen.has(key)) continue;
      seen.add(key);
      additions.push({ email: e, name: '', sentDate: '', replied: false, eventStatus: '', recipientCount: 1 });
    }
    if (additions.length === 0) {
      setError(wanted.length === 1 ? 'That email is already in the campaign.' : 'Those emails are already in the campaign.');
      return;
    }
    setError('');
    const nextContacts = [...(results.contacts || []), ...additions];
    // Un-tombstone any re-added emails so a refresh doesn't drop them again.
    const addedKeys = new Set(additions.map(c => normEmail(c.email)).filter(Boolean));
    const removedEmails = (results.removedEmails || []).filter(e => !addedKeys.has(normEmail(e)));
    const counts = deriveCounts(nextContacts);
    setResults({ ...results, contacts: nextContacts, removedEmails, ...counts });
    if (viewingSaved != null) {
      saveCampaigns(savedCampaigns.map((c, i) => (i === viewingSaved
        ? { ...c, contacts: nextContacts, removedEmails, ...counts }
        : c)));
    }
    // Pull the subject's activity so a freshly-added email that really was
    // sent this subject lights up as Sent / Replied right away. Best-effort:
    // if the fetch fails the contact simply stays "Not Sent" until the next
    // refresh.
    const subj = results.subject;
    if (!subj) return;
    try {
      const json = await fetchCampaignActivity(subj);
      const mergedContacts = mergeContacts(nextContacts, json.contacts, removedEmails);
      const c2 = deriveCounts(mergedContacts);
      setResults(r => (r ? { ...r, contacts: mergedContacts, ...c2 } : r));
      if (viewingSaved != null) {
        saveCampaigns(savedCampaigns.map((c, i) => (i === viewingSaved
          ? { ...c, contacts: mergedContacts, ...c2 }
          : c)));
      }
    } catch { /* leave the added contacts as Not Sent */ }
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
    setEditingSubjectInline(false);
    setSubjectDraft('');
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
        // The reason leads: a rate limit reads as "try again in a moment",
        // which is very different from a broken campaign, and burying it in
        // parentheses mid-sentence hides that.
        const reason = (err.message || 'Unknown error').replace(/\.$/, '');
        setError(`${reason}. Showing the last saved numbers.`);
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
  // Subject line (the email subject matched against sent mail). Subject must be
  // non-empty, but it need not be unique: two campaigns can share a subject to
  // track different contact segments of the same email. Persists to Firestore
  // and keeps the open campaign + the search box in sync when the edited one is
  // being viewed.
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

  // Inline subject editing from the results header, for the currently open saved
  // campaign. Mirrors commitEdit's validation (non-empty; duplicates across
  // campaigns are allowed), and — since the subject is what sent mail is matched
  // against — re-pulls the latest activity once the new subject is saved.
  function startSubjectEdit() {
    if (viewingSaved == null) return;
    setError('');
    setSubjectDraft(displayResults?.subject || '');
    setEditingSubjectInline(true);
  }

  function cancelSubjectEdit() {
    setEditingSubjectInline(false);
    setSubjectDraft('');
  }

  async function commitSubjectEdit() {
    const idx = viewingSaved;
    if (idx == null) { cancelSubjectEdit(); return; }
    const current = savedCampaigns[idx];
    if (!current) { cancelSubjectEdit(); return; }
    const nextSubject = subjectDraft.trim();
    if (!nextSubject) {
      setError('Subject line can’t be empty.');
      return;
    }
    if (nextSubject === current.subject) { cancelSubjectEdit(); return; }
    setError('');
    // Keep a distinct custom title; if the title was just mirroring the old
    // subject, let it follow the new subject.
    const title = (current.title && current.title !== current.subject) ? current.title : nextSubject;
    const updated = savedCampaigns.map((c, i) => (i === idx ? { ...c, subject: nextSubject, title } : c));
    await saveCampaigns(updated);
    setEditingSubjectInline(false);
    setSubjectDraft('');
    setSubject(nextSubject);
    setResults(r => (r ? { ...r, subject: nextSubject, title } : r));
    // The subject drives which sent mail matches, so pull fresh activity for it.
    const token = ++viewTokenRef.current;
    setRefreshing(true);
    try {
      const json = await fetchCampaignActivity(nextSubject);
      if (viewTokenRef.current !== token) return;
      const merged = mergeActivity(updated[idx], json);
      setResults({ ...merged, title, subject: nextSubject });
      saveCampaigns(updated.map((x, i) => (i === idx ? { ...merged, title, subject: nextSubject } : x)));
    } catch (err) {
      if (viewTokenRef.current === token) {
        setError('Couldn’t refresh activity for the new subject (' + (err.message || 'unknown error') + '): showing the last saved numbers.');
      }
    } finally {
      if (viewTokenRef.current === token) setRefreshing(false);
    }
  }

  function fmtDate(d) {
    if (!d) return '-';
    const dt = new Date(d);
    if (isNaN(dt)) return '-';
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // A saved campaign greys out as "Inactive" once it has had no activity —
  // neither a save nor a refresh — for 60 days. A campaign with no usable
  // date stays Active so it never greys out purely for missing a timestamp.
  function isCampaignActive(c) {
    const times = [c?.refreshedAt, c?.savedAt]
      .map(d => (d ? new Date(d).getTime() : 0))
      .filter(t => Number.isFinite(t) && t > 0);
    if (!times.length) return true;
    const last = Math.max(...times);
    return (Date.now() - last) <= 60 * 24 * 60 * 60 * 1000;
  }

  // A manual Active/Inactive override always wins over the 60-day auto rule.
  // `manualActive` is a boolean when the user has set the status by hand, and
  // undefined when the campaign should follow the automatic activity check.
  function effectiveActive(c) {
    return typeof c?.manualActive === 'boolean' ? c.manualActive : isCampaignActive(c);
  }

  // Flip a saved campaign's Active/Inactive status by hand and persist it.
  // Toggling always writes an explicit boolean, so a campaign the auto rule
  // considers stale can be forced Active and a fresh one can be marked
  // Inactive.
  function toggleCampaignActive(index, e) {
    if (e) e.stopPropagation();
    const c = savedCampaigns[index];
    if (!c) return;
    const next = !effectiveActive(c);
    saveCampaigns(savedCampaigns.map((x, i) => (i === index ? { ...x, manualActive: next } : x)));
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

  // Open/click tracking for this campaign. The campaign report never sends
  // mail — HubSpot is the source of the sends — so tracking is joined in
  // from the `emailTracking` docs written when the drafts were generated
  // with "Track opens & clicks" on (Draft Emails). Matched on the campaign
  // subject + recipient address. A contact row can list several addresses
  // ("a@x; b@y"), so every address is checked and the best signal wins.
  const { rows: trackingRows, error: trackingError } = useEmailTracking();
  // When each contact was actually emailed, keyed the same way the tracking
  // rows are. The pixel rides along in the Outlook DRAFT, so it fires while
  // the user is still proof-reading — without this gate a row that HubSpot
  // says was never sent still shows opens. A contact with no send date maps
  // to null on purpose: "known not sent", not "unknown".
  const sentAtByEmail = useMemo(
    () => sentAtByRecipient(displayResults?.contacts),
    [displayResults?.contacts],
  );
  const trackingFor = useMemo(
    () => trackingByRecipient(trackingRows, displayResults?.subject, { sentAtByEmail }),
    [trackingRows, displayResults?.subject, sentAtByEmail],
  );
  const lookupTracking = useMemo(() => (contactEmail) => {
    let best = null;
    for (const part of String(contactEmail || '').split(';')) {
      const hit = trackingFor.get(normalizeTrackedEmail(part));
      if (!hit) continue;
      if (!best || hit.openCount > best.openCount || hit.clickCount > best.clickCount) best = hit;
    }
    return best;
  }, [trackingFor]);
  // Campaign-level roll-up, counted over the contacts actually emailed so
  // the rates line up with the existing Response Rate denominator.
  const trackingStats = useMemo(() => {
    const contacts = displayResults?.contacts || [];
    let tracked = 0, opened = 0, clicked = 0;
    for (const c of contacts) {
      const t = lookupTracking(c.email);
      if (!t) continue;
      tracked++;
      if (t.openCount > 0) opened++;
      if (t.clickCount > 0) clicked++;
    }
    return {
      tracked,
      opened,
      clicked,
      openRate: tracked ? Math.round((opened / tracked) * 100) : 0,
      clickRate: tracked ? Math.round((clicked / tracked) * 100) : 0,
    };
  }, [displayResults?.contacts, lookupTracking]);

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
          {/* auto-fit so the Opened / Clicked tiles flow in alongside the
              original four instead of forcing a ragged second row. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
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
            {/* Opens / clicks, joined from the tracked drafts. Only shown
                once at least one send in this campaign carried tracking —
                otherwise the tiles would read a misleading 0%. */}
            {trackingStats.tracked > 0 && (
              <>
                <div style={{ padding: '0.75rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', borderLeft: '3px solid #F59E0B' }}>
                  <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Opened</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#F59E0B' }} title={`${trackingStats.opened} of ${trackingStats.tracked} tracked send${trackingStats.tracked === 1 ? '' : 's'} opened. Pixel hits before the send (proof-reading the draft), automated fetches and repeat loads within 5 minutes don't count. What's left is still directional: Apple Mail pre-loads the pixel and Outlook blocks it.`}>
                    {trackingStats.opened} <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>({trackingStats.openRate}%)</span>
                  </div>
                </div>
                <div style={{ padding: '0.75rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', borderLeft: '3px solid #0EA5E9' }}>
                  <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Clicked</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#0EA5E9' }} title={`${trackingStats.clicked} of ${trackingStats.tracked} tracked send${trackingStats.tracked === 1 ? '' : 's'} clicked a link. Clicks are the hard signal.`}>
                    {trackingStats.clicked} <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>({trackingStats.clickRate}%)</span>
                  </div>
                </div>
              </>
            )}
          </div>
          {/* Nudge when nothing in this campaign was sent with tracking on. */}
          {trackingStats.tracked === 0 && !trackingError && (
            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', marginBottom: '0.75rem' }}>
              No open/click tracking for this subject. Tracking is added when you generate the drafts from{' '}
              <strong>Draft Emails</strong> with “Track opens &amp; clicks” checked.
            </div>
          )}

          {/* Subject + Save button */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
              {(displayResults.title && displayResults.title !== displayResults.subject) && (
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-text)', marginBottom: '2px' }}>{displayResults.title}</div>
              )}
              {editingSubjectInline ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                  Matching subject:
                  <input
                    type="text"
                    value={subjectDraft}
                    autoFocus
                    onChange={(e) => setSubjectDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commitSubjectEdit(); }
                      else if (e.key === 'Escape') { e.preventDefault(); cancelSubjectEdit(); }
                    }}
                    style={{
                      minWidth: '260px', padding: '0.2rem 0.4rem', border: '1px solid var(--color-accent)',
                      borderRadius: '4px', fontSize: '0.8rem', fontFamily: 'inherit', color: 'var(--color-text)',
                      background: 'var(--color-surface)',
                    }}
                  />
                  <button
                    onClick={commitSubjectEdit}
                    style={{
                      padding: '0.2rem 0.55rem', border: 'none', borderRadius: '4px',
                      background: 'var(--color-accent)', color: '#fff', fontSize: '0.7rem', fontWeight: 600,
                      fontFamily: 'inherit', cursor: 'pointer',
                    }}
                  >Save</button>
                  <button
                    onClick={cancelSubjectEdit}
                    style={{
                      padding: '0.2rem 0.55rem', border: '1px solid var(--color-border)', borderRadius: '4px',
                      background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '0.7rem',
                      fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
                    }}
                  >Cancel</button>
                </span>
              ) : (
                <>
                  Matching subject: <strong>"{displayResults.subject}"</strong>
                  {viewingSaved !== null && (
                    <button
                      onClick={startSubjectEdit}
                      title="Edit this campaign's subject line"
                      style={{
                        marginLeft: '0.4rem', padding: '1px 6px', border: '1px solid var(--color-border)',
                        borderRadius: '4px', background: 'var(--color-surface)', color: 'var(--color-accent)',
                        fontSize: '0.6rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
                      }}
                    >Edit</button>
                  )}
                </>
              )}
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
                      ? 'No unsent contacts: everyone has been emailed'
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
                {extraRows > 0 && <>: {extraRows} extra row{extraRows === 1 ? '' : 's'}</>}. Duplicated rows are flagged below.
              </span>
              <button
                onClick={removeDuplicates}
                style={{ flexShrink: 0, padding: '0.3rem 0.7rem', border: 'none', borderRadius: '6px', background: '#D97706', color: '#fff', fontSize: '0.72rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}
                title="Collapse each duplicated contact to a single row, keeping the copy with the most activity"
              >Remove duplicates</button>
            </div>
          )}

          {/* Manually add an email to the campaign's fixed list. The campaign
              only tracks the emails added here; the subject line is used to
              look up their send/reply status, never to pull in new addresses. */}
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
            <input
              type="text"
              value={addEmail}
              onChange={e => setAddEmail(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addContacts(addEmail); setAddEmail(''); } }}
              placeholder="Add an email to this campaign…"
              style={{ flex: 1, maxWidth: 340, padding: '0.4rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: '6px', fontSize: '0.78rem', fontFamily: 'inherit' }}
            />
            <button
              onClick={() => { addContacts(addEmail); setAddEmail(''); }}
              disabled={!addEmail.trim()}
              title="Add this email to the campaign's fixed list. The subject line is only used to look up whether this address was sent or replied: it never pulls in addresses on its own."
              style={{
                padding: '0.4rem 0.85rem', border: '1px solid var(--color-accent)', borderRadius: '6px',
                background: addEmail.trim() ? 'var(--color-accent)' : 'var(--color-surface)',
                color: addEmail.trim() ? '#fff' : 'var(--color-text-muted)',
                fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
                cursor: addEmail.trim() ? 'pointer' : 'default', opacity: addEmail.trim() ? 1 : 0.6,
              }}
            >Add email</button>
          </div>

          {/* Contact table */}
          {displayResults.contacts && displayResults.contacts.length > 0 && (
            <div style={{ border: '1px solid var(--color-border)', borderRadius: '8px', overflow: 'hidden', maxHeight: '500px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ background: 'var(--color-surface-alt)', position: 'sticky', top: 0, zIndex: 1 }}>
                    <SortHeader label="Sent To" sortKey="email" />
                    <SortHeader label="Sent Date" sortKey="sentDate" />
                    <SortHeader label="Status" sortKey="status" />
                    {/* Only worth a column when something in this campaign
                        was actually sent with tracking on. */}
                    {trackingStats.tracked > 0 && (
                      <th style={{ padding: '0.45rem 0.6rem', textAlign: 'left', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '0.68rem', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap' }}
                        title="Opens exclude pixel hits before the send, automated fetches and repeat loads within 5 minutes — hover a count to see what was dropped. What remains is still directional (Apple Mail pre-loads the pixel, Outlook blocks it); clicks are the hard signal."
                      >Opens / Clicks</th>
                    )}
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
                      {trackingStats.tracked > 0 && (
                        <td style={{ padding: '0.4rem 0.6rem', whiteSpace: 'nowrap' }}>
                          {(() => {
                            const t = lookupTracking(c.email);
                            if (!t) {
                              return <span style={{ color: 'var(--color-text-muted)' }} title="This send didn't carry a tracking pixel">-</span>;
                            }
                            const excluded = describeExcludedOpens(t);
                            const openTitle = [
                              t.firstOpenAt ? `First opened ${new Date(t.firstOpenAt).toLocaleString()}` : 'No opens recorded',
                              excluded,
                              t.sends > 1 ? `${t.sends} tracked drafts were created for this address.` : '',
                            ].filter(Boolean).join(' ');
                            const clickTitle = t.lastClickAt ? `Last click ${new Date(t.lastClickAt).toLocaleString()}` : 'No clicks recorded';
                            return (
                              <span style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center' }}>
                                <span
                                  title={openTitle}
                                  style={{ padding: '1px 6px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700, background: t.openCount ? '#FEF3C7' : '#F3F4F6', color: t.openCount ? '#92400E' : '#6B7280' }}
                                >{t.openCount} open{t.openCount === 1 ? '' : 's'}</span>
                                <span
                                  title={clickTitle}
                                  style={{ padding: '1px 6px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700, background: t.clickCount ? '#E0F2FE' : '#F3F4F6', color: t.clickCount ? '#075985' : '#6B7280' }}
                                >{t.clickCount} click{t.clickCount === 1 ? '' : 's'}</span>
                              </span>
                            );
                          })()}
                        </td>
                      )}
                      <td style={{ padding: '0.4rem 0.6rem', color: 'var(--color-text-secondary)', fontWeight: c.replied ? 600 : 400 }}>{c.repliedBy || '-'}</td>
                      <td style={{ padding: '0.4rem 0.6rem', color: 'var(--color-text-secondary)' }}>{c.replied ? fmtDate(c.replyDate) : '-'}</td>
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
                              <option value="">-</option>
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
          <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: '6px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--color-text-secondary)', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={{ padding: '0.4rem 0.6rem', fontWeight: 700 }}>Campaign</th>
                  <th style={{ padding: '0.4rem 0.6rem', fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap' }}>% Sent</th>
                  <th style={{ padding: '0.4rem 0.6rem', fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap' }}>Response Rate</th>
                  <th style={{ padding: '0.4rem 0.6rem', fontWeight: 700, textAlign: 'center', whiteSpace: 'nowrap' }}>Status</th>
                  <th style={{ padding: '0.4rem 0.6rem', fontWeight: 700 }} aria-label="Actions"></th>
                </tr>
              </thead>
              <tbody>
            {savedCampaigns.map((c, i) => {
              const isEditing = editingIndex === i;
              const sent = c.uniqueRecipients ?? 0;
              const total = c.totalContacts ?? c.contacts?.length ?? c.uniqueRecipients ?? 0;
              const pctSent = total > 0 ? Math.round((sent / total) * 1000) / 10 : 0;
              const active = effectiveActive(c);
              const manualStatus = typeof c.manualActive === 'boolean';
              return (
              <tr
                key={i}
                style={{
                  borderTop: '1px solid var(--color-border)',
                  background: viewingSaved === i ? '#EFF6FF' : 'transparent',
                  cursor: isEditing ? 'default' : 'pointer',
                  opacity: active ? 1 : 0.55,
                }}
                title={active ? undefined : (manualStatus ? 'Manually marked inactive' : 'Inactive: no save or refresh in the last 60 days')}
                onClick={isEditing ? undefined : () => viewCampaign(i)}
              >
                <td style={{ padding: '0.5rem 0.6rem', maxWidth: '340px', verticalAlign: 'top' }}>
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
                    Saved {fmtDate(c.savedAt)}: {c.uniqueRecipients} of {c.totalContacts ?? c.contacts?.length ?? c.uniqueRecipients} sent, {c.uniqueRepliers} replies
                    {c.refreshedAt && <span style={{ color: 'var(--color-text-muted)' }}> · updated {fmtDate(c.refreshedAt)}</span>}
                  </div>
                </td>
                {isEditing ? (
                  <td colSpan={3} />
                ) : (
                  <>
                    <td style={{ padding: '0.5rem 0.6rem', textAlign: 'right', fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap', verticalAlign: 'top' }}>{pctSent}%</td>
                    <td style={{ padding: '0.5rem 0.6rem', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap', verticalAlign: 'top', color: c.responseRate >= 20 ? '#10B981' : c.responseRate >= 10 ? '#F59E0B' : '#DC2626' }}>{c.responseRate}%</td>
                    <td style={{ padding: '0.5rem 0.6rem', textAlign: 'center', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                      <button
                        onClick={e => toggleCampaignActive(i, e)}
                        title={active
                          ? 'Active: click to mark this campaign inactive'
                          : (manualStatus
                            ? 'Manually marked inactive: click to mark active'
                            : 'Inactive (no activity in 60 days): click to mark active')}
                        style={{
                          padding: '2px 8px', borderRadius: '999px', fontSize: '0.62rem', fontWeight: 700,
                          textTransform: 'uppercase', letterSpacing: '0.03em', fontFamily: 'inherit', cursor: 'pointer',
                          border: active ? '1px solid #86EFAC' : '1px solid var(--color-border)',
                          background: active ? '#DCFCE7' : '#F3F4F6', color: active ? '#15803D' : '#6B7280',
                        }}
                      >{active ? 'Active' : 'Inactive'}</button>
                    </td>
                  </>
                )}
                <td style={{ padding: '0.5rem 0.6rem', textAlign: 'right', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }} onClick={e => e.stopPropagation()}>
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
                </td>
              </tr>
              );
            })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

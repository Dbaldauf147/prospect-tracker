import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { apiFetch } from '../../utils/apiFetch';
import { ColumnToggle } from '../common/ColumnToggle';
import {
  isColumnVisible, resetToStarred, applyStar, orderColumns, mergeColumnOrder,
} from '../../utils/tableColumnPrefs';
import { userLsGet, userLsSet } from '../../utils/userLs';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { addQueuedRecipients } from '../../utils/draftRecipientsQueue';
import { useEmailTracking, trackingByRecipient, normalizeTrackedEmail, sentAtByRecipient } from '../../hooks/useEmailTracking';
import { describeExcludedOpens } from '../../utils/emailOpens';
import { deliveryStatus, DELIVERY, DELIVERY_LABEL, DELIVERY_TITLE } from '../../utils/deliveryStatus';
import { isCampaignActive } from '../../utils/campaignOutreach';
import {
  campaignContactsCsv, campaignsSummaryCsv, contactStatusLabel, csvFilename, downloadCsv,
} from '../../utils/campaignExport';
import {
  campaignSubjects, primarySubject, withSubjects, parseSubjectLines,
  subjectLinesText, sameSubjects,
} from '../../utils/campaignSubjects';

// The contact table's columns, and how wide each one starts.
//
// One entry per column the table can show, in the order it ships in. The
// user's own choices — which show, which are starred as their default view,
// what order, how wide — sit on top of this in localStorage, keyed by
// column key, so adding a column here doesn't disturb a layout somebody has
// already set up: anything not on their hidden list simply appears.
//
// "Sent To" is the row's identity, so it can't be hidden; the remove (×)
// button is table scaffolding rather than a column and isn't offered at all.
const CONTACT_COLUMNS = [
  { key: 'email', label: 'Sent To', sortKey: 'email', width: 280 },
  { key: 'sentDate', label: 'Sent Date', sortKey: 'sentDate', width: 110 },
  { key: 'delivery', label: 'Delivery', sortKey: 'delivery', width: 100 },
  { key: 'status', label: 'Status', sortKey: 'status', width: 110 },
  {
    key: 'tracking',
    label: 'Loads / Clicks',
    width: 160,
    // Only worth a column when something in this campaign was actually
    // sent with tracking on.
    needsTracking: true,
    title: 'Image loads exclude pixel hits before the send, automated fetches and repeat loads within 5 minutes; clicks exclude security-gateway link scans. Hover a count to see what was dropped. A load is not a read (Apple Mail pre-loads the pixel, Outlook blocks it) — clicks are the better signal.',
  },
  { key: 'repliedBy', label: 'Replied By', sortKey: 'repliedBy', width: 150 },
  { key: 'replyDate', label: 'Reply Date', sortKey: 'replyDate', width: 110 },
  { key: 'eventStatus', label: 'Event Status', sortKey: 'eventStatus', width: 130 },
];
const CONTACT_COLS_LOCKED = ['email'];
const ACTIONS_COL_WIDTH = 36;
const MIN_COL_WIDTH = 60;

// Column prefs live per user, under one key each.
const COLS_LS = {
  hidden: 'email-campaign:contact-cols-hidden',
  removed: 'email-campaign:contact-cols-removed',
  starred: 'email-campaign:contact-cols-starred',
  order: 'email-campaign:contact-cols-order',
  widths: 'email-campaign:contact-cols-widths',
};
function readCols(key, fallback) {
  try {
    const v = JSON.parse(userLsGet(COLS_LS[key]));
    return v ?? fallback;
  } catch { return fallback; }
}
function writeCols(key, value) {
  try { userLsSet(COLS_LS[key], JSON.stringify(value)); } catch { /* a full or blocked localStorage just means prefs don't persist */ }
}

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
  // The saved-campaign editor's subject lines, one per row of a textarea. A
  // campaign can match on several (an A/B test of two lines, a wave reworded
  // for a second segment) and they are one campaign, one roster, one set of
  // numbers — see src/utils/campaignSubjects.js.
  const [editSubjects, setEditSubjects] = useState('');
  const [editingSubjectInline, setEditingSubjectInline] = useState(false); // editing the open campaign's subject lines from the results header
  const [subjectDraft, setSubjectDraft] = useState('');
  // "New Campaign" form: create a campaign by hand instead of searching for a
  // subject line that has already been sent.
  const [showNewForm, setShowNewForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newSubject, setNewSubject] = useState('');
  const [creating, setCreating] = useState(false); // manual create in flight
  // Draft for the "add an email to this campaign" input. Manually-added
  // addresses are the only way contacts enter a campaign's fixed list.
  const [addEmail, setAddEmail] = useState('');
  const [refreshing, setRefreshing] = useState(false); // auto-refresh of an opened saved campaign in flight
  const [refreshingAll, setRefreshingAll] = useState(false); // "Refresh all" sweep in flight
  // Which column the contact table is sorted by, and the direction. key === null
  // leaves the table in its natural (roster) order.
  const [sortConfig, setSortConfig] = useState({ key: null, dir: 'asc' });
  // Column layout: what's hidden, what's starred as the user's default view,
  // what's been deleted out of the table, the order, and the widths. Stored
  // as the user set it and reapplied on every visit.
  const [colHidden, setColHidden] = useState(() => new Set(readCols('hidden', [])));
  const [colStarred, setColStarred] = useState(() => new Set(readCols('starred', [])));
  const [colRemoved, setColRemoved] = useState(() => new Set(readCols('removed', [])));
  const [colOrder, setColOrder] = useState(() => readCols('order', []));
  const [colWidths, setColWidths] = useState(() => readCols('widths', {}));
  useEffect(() => { writeCols('hidden', [...colHidden]); }, [colHidden]);
  useEffect(() => { writeCols('starred', [...colStarred]); }, [colStarred]);
  useEffect(() => { writeCols('removed', [...colRemoved]); }, [colRemoved]);
  useEffect(() => { writeCols('order', colOrder); }, [colOrder]);
  useEffect(() => { writeCols('widths', colWidths); }, [colWidths]);
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
    // Any of the campaign's subject lines identifies it: the tracking tab
    // hands over the line the send matched, which needn't be the first one.
    const idx = savedCampaigns.findIndex(
      c => campaignSubjects(c).some(sub => sub.toLowerCase() === want),
    );
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

  // Pull the current activity for a campaign's subject line(s) from the live
  // source. Shared by the manual Search and the automatic refresh that runs
  // when a saved campaign is opened. Takes one line or several: the endpoint
  // searches each and pools the results, so mail sent under any of them is
  // this campaign's (and a recipient emailed under two is still one send).
  async function fetchCampaignActivity(subjectLines) {
    const subjects = parseSubjectLines(
      Array.isArray(subjectLines) ? subjectLines.join('\n') : subjectLines,
    );
    const res = await apiFetch('/api/email-campaign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: subjects[0] || '', subjects }),
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
        merged.push({
          ...rc,
          sentDate: act.sentDate,
          replied: !!act.replied,
          replyDate: act.replyDate,
          repliedBy: act.repliedBy,
          // Delivery outcome, classified out of the incoming mail the campaign
          // was already suppressing (api/_lib/autoReply.js). A bounce is an
          // address to fix; an out-of-office is a date to try again on.
          bounced: !!act.bounced,
          bounceDate: act.bounceDate || null,
          outOfOffice: !!act.outOfOffice,
          oooDate: act.oooDate || null,
          oooSubject: act.oooSubject || '',
          recipientCount: act.recipientCount || 1,
        });
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
      suppressed: json.suppressed || null,
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
      const subjects = campaignSubjects(c);
      if (subjects.length === 0) { outcomes.push({ campaign: c, ok: true }); continue; }
      try {
        outcomes.push({ campaign: mergeActivity(c, await fetchCampaignActivity(subjects)), ok: true });
      } catch {
        outcomes.push({ campaign: c, ok: false });
      }
    }
    const updated = outcomes.map(o => o.campaign);
    await saveCampaigns(updated);
    // Keep the open campaign's view in sync with its refreshed numbers.
    if (viewingSaved != null && updated[viewingSaved]) {
      const c = updated[viewingSaved];
      setResults({ ...c, title: c.title || primarySubject(c) });
    }
    const failedNames = outcomes.filter(o => !o.ok).map(o => o.campaign.title || primarySubject(o.campaign) || '(untitled)');
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
    const campaign = withSubjects({
      // Title is the campaign's display name; the subject lines are what sent
      // mail is matched against. A freshly-searched campaign has no separate
      // title yet, so seed it from the first line — the user can split them
      // later by editing the saved campaign.
      title: results.title || primarySubject(results),
      savedAt: new Date().toISOString(),
      ...deriveCounts(results.contacts),
      totalEmails: results.totalEmails,
      autoRepliesSuppressed: results.autoRepliesSuppressed || 0,
      suppressed: results.suppressed || null,
      removedEmails: results.removedEmails || [],
      contacts: results.contacts,
    }, campaignSubjects(results));
    // Replace if a campaign already leads with the same subject, otherwise add
    const existing = savedCampaigns.findIndex(c => primarySubject(c) === campaign.subject);
    const updated = existing >= 0
      ? savedCampaigns.map((c, i) => i === existing ? campaign : c)
      : [campaign, ...savedCampaigns];
    await saveCampaigns(updated);
    setSaving(false);
  }

  // Create a campaign by hand, without searching a subject line first.
  //
  // The search flow can only produce a campaign once mail has already gone out
  // for that subject; this is how one gets set up ahead of the send. The new
  // campaign starts with an empty roster — the same fixed, manually-curated
  // list every campaign has — is saved straight away, and is opened so contacts
  // can be added with "Add an email to this campaign…".
  async function createCampaign() {
    const nextSubjects = parseSubjectLines(newSubject);
    if (nextSubjects.length === 0) {
      setError('Give the new campaign a subject line.');
      return;
    }
    const title = newTitle.trim() || nextSubjects[0];
    setCreating(true);
    setError('');
    const campaign = withSubjects({
      title,
      savedAt: new Date().toISOString(),
      ...deriveCounts([]),
      totalEmails: 0,
      autoRepliesSuppressed: 0,
      suppressed: null,
      removedEmails: [],
      contacts: [],
    }, nextSubjects);
    // Newest first, matching handleSave.
    await saveCampaigns([campaign, ...savedCampaigns]);
    setCreating(false);
    closeNewForm();
    // Open it right away so the next thing the user does is add contacts.
    // Every saved index shifts down one, so drop any edit state that pointed
    // at the old positions, and cancel a refresh still in flight for whichever
    // campaign was open before.
    viewTokenRef.current++;
    setRefreshing(false);
    setEditingIndex(null);
    setEditingSubjectInline(false);
    setSubjectDraft('');
    setSubject(nextSubjects[0]);
    setResults(campaign);
    setViewingSaved(0);
  }

  function openNewForm() {
    setError('');
    setNewTitle('');
    // Seed from the search box: a subject typed there is usually the one the
    // campaign is being created for.
    setNewSubject(subject.trim());
    setShowNewForm(true);
  }

  function closeNewForm() {
    setShowNewForm(false);
    setNewTitle('');
    setNewSubject('');
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
    // Pull the subject lines' activity so a freshly-added email that really
    // was sent one of them lights up as Sent / Replied right away.
    // Best-effort: if the fetch fails the contact simply stays "Not Sent"
    // until the next refresh.
    const subs = campaignSubjects(results);
    if (subs.length === 0) return;
    try {
      const json = await fetchCampaignActivity(subs);
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
    const subjects = campaignSubjects(c);
    setResults({ ...c, ...deriveCounts(c.contacts) });
    setSubject(subjects[0] || '');
    setViewingSaved(index);
    setEditingSubjectInline(false);
    setSubjectDraft('');
    setError('');
    if (subjects.length === 0) return;
    const token = ++viewTokenRef.current;
    setRefreshing(true);
    try {
      const json = await fetchCampaignActivity(subjects);
      // Drop the result if the user has since opened a different campaign.
      if (viewTokenRef.current !== token) return;
      // Merge the live activity into the campaign's roster (keep the
      // campaign's own title/subject) rather than replacing the contact list —
      // so unsent roster members and event statuses survive the refresh.
      const merged = mergeActivity(c, json);
      setResults({ ...merged, title: c.title || subjects[0] });
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
    setEditTitle(c?.title || primarySubject(c) || '');
    setEditSubjects(subjectLinesText(c));
  }

  function cancelEdit(e) {
    if (e) e.stopPropagation();
    setEditingIndex(null);
    setEditTitle('');
    setEditSubjects('');
  }

  // Edit a saved campaign's two fields: the Title (display name) and the
  // Subject lines (the email subjects matched against sent mail — one per row,
  // and mail matching any of them counts). At least one line is required, but
  // they need not be unique: two campaigns can share a subject to track
  // different contact segments of the same email. Persists to Firestore and
  // keeps the open campaign + the search box in sync when the edited one is
  // being viewed.
  async function commitEdit() {
    const idx = editingIndex;
    if (idx == null) return;
    const current = savedCampaigns[idx];
    if (!current) { cancelEdit(); return; }
    const subjects = parseSubjectLines(editSubjects);
    const title = editTitle.trim() || subjects[0] || '';
    if (subjects.length === 0) {
      setError('Add at least one subject line.');
      return;
    }
    const subjectsChanged = !sameSubjects(subjects, campaignSubjects(current));
    if (!subjectsChanged && title === (current.title || primarySubject(current))) { cancelEdit(); return; }
    setError('');
    const updated = savedCampaigns.map((c, i) => (i === idx ? withSubjects({ ...c, title }, subjects) : c));
    await saveCampaigns(updated);
    if (viewingSaved === idx) {
      setSubject(subjects[0]);
      setResults(r => (r ? withSubjects({ ...r, title }, subjects) : r));
    }
    setEditingIndex(null);
    setEditTitle('');
    setEditSubjects('');
    // The subject lines drive which sent mail matches, so a change to them
    // needs the activity re-pulled — same as editing them from the header.
    if (subjectsChanged && viewingSaved === idx) {
      await refreshOpenCampaign({ index: idx, base: updated[idx], subjects, title });
    }
  }

  // Pull activity for a campaign's subject lines and fold it into the open
  // campaign. Shared by both places the lines can be edited — the results
  // header and the saved-list row — since a changed set of lines changes
  // which sent mail matches and the numbers on screen are stale until it is
  // re-pulled. `base` is the campaign the merge starts from (its roster,
  // manual removals and event statuses survive); `index` is its slot in the
  // saved list, or null for a search result that hasn't been saved yet.
  async function refreshOpenCampaign({ index, base, subjects, title }) {
    const token = ++viewTokenRef.current;
    setRefreshing(true);
    try {
      const json = await fetchCampaignActivity(subjects);
      if (viewTokenRef.current !== token) return;
      const merged = withSubjects({ ...mergeActivity(base, json), title }, subjects);
      setResults(merged);
      if (index != null) saveCampaigns(savedCampaigns.map((x, i) => (i === index ? merged : x)));
    } catch (err) {
      if (viewTokenRef.current === token) {
        setError(`Couldn’t refresh activity for the new subject line${subjects.length === 1 ? '' : 's'} (${err.message || 'unknown error'}): showing the last saved numbers.`);
      }
    } finally {
      if (viewTokenRef.current === token) setRefreshing(false);
    }
  }

  // Inline subject editing from the results header, for whatever campaign is
  // open — saved or a search result not yet saved. One line per subject: a
  // campaign can go out under several and mail matching any of them belongs
  // to it. Mirrors commitEdit's validation (at least one line; duplicates
  // across campaigns are allowed), and re-pulls the latest activity once the
  // lines are saved, since they are what sent mail is matched against.
  function startSubjectEdit() {
    if (!displayResults) return;
    setError('');
    setSubjectDraft(subjectLinesText(displayResults));
    setEditingSubjectInline(true);
  }

  function cancelSubjectEdit() {
    setEditingSubjectInline(false);
    setSubjectDraft('');
  }

  async function commitSubjectEdit() {
    const idx = viewingSaved;
    const current = idx == null ? displayResults : savedCampaigns[idx];
    if (!current) { cancelSubjectEdit(); return; }
    const nextSubjects = parseSubjectLines(subjectDraft);
    if (nextSubjects.length === 0) {
      setError('Add at least one subject line.');
      return;
    }
    if (sameSubjects(nextSubjects, campaignSubjects(current))) { cancelSubjectEdit(); return; }
    setError('');
    // Keep a distinct custom title; if the title was just mirroring the old
    // first subject, let it follow the new one.
    const title = (current.title && current.title !== primarySubject(current)) ? current.title : nextSubjects[0];
    const next = withSubjects({ ...current, title }, nextSubjects);
    if (idx != null) await saveCampaigns(savedCampaigns.map((c, i) => (i === idx ? next : c)));
    setEditingSubjectInline(false);
    setSubjectDraft('');
    setSubject(nextSubjects[0]);
    setResults(next);
    await refreshOpenCampaign({ index: idx, base: next, subjects: nextSubjects, title });
  }

  function fmtDate(d) {
    if (!d) return '-';
    const dt = new Date(d);
    if (isNaN(dt)) return '-';
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // A saved campaign greys out as "Inactive" once it has had no activity —
  // neither a save nor a refresh — for 60 days, unless the user has set the
  // status by hand, which always wins. The rule lives in campaignOutreach
  // because the Prospecting ladder marks the same campaigns the same way
  // when it lists the ones still going out; two copies would eventually
  // call the same campaign Active on one page and Inactive on the other.
  const effectiveActive = isCampaignActive;

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
  // column meaningfully: Not Sent < Bounced < No Reply < Out of Office <
  // Replied. A bounce sorts below silence deliberately — it is the worst
  // outcome, because the email never arrived at all — and an out-of-office
  // sorts above it, being a non-answer that is not a no.
  // Delivery ordering, worst first so the addresses that need fixing surface
  // at one end of the sort: Failed < Not sent < Delivered < Confirmed.
  const DELIVERY_RANK = {
    [DELIVERY.FAILED]: 0,
    [DELIVERY.NOT_SENT]: 1,
    [DELIVERY.UNKNOWN]: 2,
    [DELIVERY.DELIVERED]: 3,
    [DELIVERY.CONFIRMED]: 4,
  };

  function statusRank(c) {
    if (c.replied) return 4;
    if (c.outOfOffice) return 3;
    if (c.bounced) return 1;
    if (c.sentDate) return 2;
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
      case 'delivery': return DELIVERY_RANK[deliveryFor(c)] ?? 2;
      case 'repliedBy': return String(c.repliedBy || '').toLowerCase();
      case 'replyDate': return c.replied && c.replyDate ? (new Date(c.replyDate).getTime() || 0) : 0;
      case 'eventStatus': return String(c.eventStatus || '');
      default: return '';
    }
  }

  const displayResults = results;
  // The subject lines the open campaign matches on. Kept as a stable array
  // (keyed off the joined string) so the tracking joins below don't recompute
  // on every render just because the campaign object was rebuilt.
  const subjectsKey = campaignSubjects(displayResults).join('\n');
  const displaySubjects = useMemo(
    () => (subjectsKey ? subjectsKey.split('\n') : []),
    [subjectsKey],
  );
  const { dupKeys, extraRows } = findDuplicates(displayResults?.contacts);

  // Open/click tracking for this campaign. The campaign report never sends
  // mail — HubSpot is the source of the sends — so tracking is joined in
  // from the `emailTracking` docs written when the drafts were generated
  // with "Track image loads & clicks" on (Draft Emails). Matched on the campaign
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
    () => trackingByRecipient(trackingRows, displaySubjects, { sentAtByEmail }),
    [trackingRows, displaySubjects, sentAtByEmail],
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
  // Did it arrive? Same question, same answer as the Email Tracking tab —
  // read off the bounce rather than off the pixel, because a pixel that never
  // loaded is silence and not a failure.
  //
  // Every contact here IS watched: this is the campaign's own roster, so the
  // tracking tab's UNKNOWN state (nobody watching for a bounce) can't occur.
  // Activity uses the RAW click count on purpose — a security gateway's link
  // scan proves nothing about interest and everything about delivery.
  const deliveryFor = useMemo(() => (c) => {
    const t = lookupTracking(c.email);
    return deliveryStatus(c, {
      hasActivity: !!t && ((t.openCount + t.machine) > 0 || t.rawClickCount > 0),
      sentAt: c.sentDate || null,
    });
  }, [lookupTracking]);

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

  // Take the open campaign out as a CSV.
  //
  // Rows come out in whatever order the table is currently sorted into — what
  // you see is what you get — but every column ships regardless of which ones
  // are hidden: this is the campaign's data, not a picture of the table. The
  // delivery verdict and the tracking counts are handed over already computed,
  // since both need the whole tracking collection this view has loaded.
  function exportContactsCsv() {
    if (!displayResults) return;
    const csv = campaignContactsCsv(displayResults, sortedContacts.map(({ c }) => c), {
      deliveryFor: (c) => DELIVERY_LABEL[deliveryFor(c)] || '',
      trackingFor: (c) => lookupTracking(c.email),
    });
    downloadCsv(csvFilename(`Email campaign - ${displayResults.title || displayResults.subject || 'untitled'}`), csv);
  }

  // Take the Saved Campaigns table out as a CSV: one row per campaign, the
  // figures it prints plus the dates behind the Active/Inactive badge.
  function exportSummaryCsv() {
    if (savedCampaigns.length === 0) return;
    downloadCsv(csvFilename('Email campaigns summary'), campaignsSummaryCsv(savedCampaigns));
  }

  // ---- Column layout -----------------------------------------------------
  // The lineup this campaign can show (the tracking column only exists when
  // something here was sent with a pixel), then the user's order, then what
  // survives their hidden / deleted lists.
  const availableColumns = useMemo(
    () => CONTACT_COLUMNS.filter(c => !c.needsTracking || trackingStats.tracked > 0),
    [trackingStats.tracked],
  );
  const orderedColumns = useMemo(
    () => orderColumns(availableColumns.filter(c => !colRemoved.has(c.key)), colOrder),
    [availableColumns, colRemoved, colOrder],
  );
  const removedColumns = useMemo(
    () => availableColumns.filter(c => colRemoved.has(c.key)),
    [availableColumns, colRemoved],
  );
  const visibleColumns = useMemo(
    () => orderedColumns.filter(c => isColumnVisible(c.key, {
      hidden: colHidden, removed: colRemoved, alwaysVisible: CONTACT_COLS_LOCKED,
    })),
    [orderedColumns, colHidden, colRemoved],
  );
  const visibleColKeys = useMemo(() => new Set(visibleColumns.map(c => c.key)), [visibleColumns]);
  const widthOf = useCallback(
    (col) => Number(colWidths[col.key]) || col.width,
    [colWidths],
  );
  // The table is laid out at exactly the width of its columns, and at least
  // the width of its box: resizing then means what it says, and a table
  // narrower than the pane still fills it rather than leaving a gap.
  const tableWidth = useMemo(
    () => visibleColumns.reduce((sum, c) => sum + widthOf(c), 0) + ACTIONS_COL_WIDTH,
    [visibleColumns, widthOf],
  );

  const toggleCol = (key) => setColHidden(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const starCol = (key) => {
    const next = applyStar({ key, starred: colStarred, hidden: colHidden, removed: colRemoved, star: !colStarred.has(key) });
    setColStarred(next.starred);
    setColHidden(next.hidden);
    setColRemoved(next.removed);
  };
  const removeCol = (key) => setColRemoved(prev => new Set(prev).add(key));
  const restoreCol = (key) => setColRemoved(prev => {
    const next = new Set(prev);
    next.delete(key);
    return next;
  });
  const reorderCols = (keys) => setColOrder(prev => mergeColumnOrder(prev, keys));
  // Reset is the way back to a layout that got away from you: the starred
  // columns (or all of them, with nothing starred), the shipped order, and
  // the shipped widths.
  const resetCols = () => {
    const { hidden, removed } = resetToStarred({
      columnKeys: availableColumns.map(c => c.key),
      starred: colStarred,
      alwaysVisible: CONTACT_COLS_LOCKED,
    });
    setColHidden(hidden);
    setColRemoved(removed);
    setColOrder([]);
    setColWidths({});
  };

  // Drag a header's right edge to set that column's width. The key and the
  // start metrics are captured in local scope rather than read back off the
  // ref: a mousemove can land after the mouseup that cleared it, and reading
  // `.key` off null there would blank the page.
  const resizingRef = useRef(null);
  function startColResize(colKey, e) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const col = CONTACT_COLUMNS.find(c => c.key === colKey);
    const startWidth = Number(colWidths[colKey]) || col?.width || 120;
    resizingRef.current = { key: colKey, startX, startWidth };
    const onMove = (ev) => {
      if (!resizingRef.current) return;
      const next = Math.max(MIN_COL_WIDTH, startWidth + (ev.clientX - startX));
      setColWidths(prev => ({ ...prev, [colKey]: next }));
    };
    const onUp = () => {
      resizingRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // One cell, by column key. The markup is the same it has always been —
  // this only moves it behind a key so a column can be hidden, moved or
  // resized without the row and the header drifting out of step.
  function renderContactCell(key, c, i, isDup) {
    switch (key) {
      case 'email':
        return (
          <>
            <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.35rem', minWidth: 0 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }} title={c.email}>{c.email}</span>
              {isDup && <span style={{ padding: '1px 6px', borderRadius: '999px', fontSize: '0.6rem', fontWeight: 700, background: '#FDE68A', color: '#92400E', flexShrink: 0 }} title="This contact appears more than once in this campaign">Duplicate</span>}
            </div>
            {c.recipientCount > 1 && <div style={{ fontSize: '0.6rem', color: 'var(--color-text-muted)' }}>{c.recipientCount} recipients</div>}
          </>
        );
      case 'sentDate':
        return <span style={{ color: 'var(--color-text-secondary)' }}>{fmtDate(c.sentDate)}</span>;
      case 'delivery': {
        const d = deliveryFor(c);
        const tone = d === DELIVERY.FAILED ? { background: '#FEE2E2', color: '#991B1B' }
          : d === DELIVERY.CONFIRMED ? { background: '#DCFCE7', color: '#166534' }
            : d === DELIVERY.DELIVERED ? { background: '#F1F5F9', color: '#334155' }
              : { background: 'transparent', color: 'var(--color-text-muted)' };
        return (
          <span title={DELIVERY_TITLE[d]} style={{ padding: '1px 6px', borderRadius: '999px', fontSize: '0.65rem', fontWeight: 600, whiteSpace: 'nowrap', ...tone }}>
            {DELIVERY_LABEL[d]}
          </span>
        );
      }
      case 'status': {
        // The ladder itself lives in campaignExport, because the CSV prints
        // the same words and the two must not drift; the badge here only
        // decides how each of them looks.
        const label = contactStatusLabel(c);
        const STATUS_TONE = {
          Replied: { background: '#DCFCE7', color: '#166534' },
          Bounced: { background: '#FEE2E2', color: '#991B1B' },
          'Out of Office': { background: '#FEF3C7', color: '#92400E' },
          'No Reply': { background: '#F3F4F6', color: '#6B7280' },
          'Not Sent': { background: '#FEF3C7', color: '#92400E' },
        };
        const STATUS_TITLE = {
          Bounced: 'The mail server rejected this address — nobody saw the email. Fix or remove it before the next send.',
          'Out of Office': c.oooSubject
            ? `Auto-responder: "${c.oooSubject}". Not a no — worth a second send when they're back.`
            : "Their auto-responder answered. Not a no — worth a second send when they're back.",
          'Not Sent': 'In this campaign but not yet sent the email',
        };
        return (
          <span
            title={STATUS_TITLE[label]}
            style={{ padding: '1px 6px', borderRadius: '999px', fontSize: '0.65rem', fontWeight: 600, whiteSpace: 'nowrap', ...STATUS_TONE[label] }}
          >{label}</span>
        );
      }
      case 'tracking': {
        const t = lookupTracking(c.email);
        if (!t) return <span style={{ color: 'var(--color-text-muted)' }} title="This send didn't carry a tracking pixel">-</span>;
        const excluded = describeExcludedOpens(t);
        const openTitle = [
          t.firstOpenAt ? `First opened ${new Date(t.firstOpenAt).toLocaleString()}` : 'No opens recorded',
          excluded,
          t.sends > 1 ? `${t.sends} tracked drafts were created for this address.` : '',
        ].filter(Boolean).join(' ');
        const clickTitle = [
          t.lastClickAt ? `Last click ${new Date(t.lastClickAt).toLocaleString()}` : 'No clicks recorded',
          t.clickMachine ? `${t.clickMachine} link scan${t.clickMachine === 1 ? '' : 's'} by a security gateway${t.scanner ? ` (${t.scanner})` : ''} excluded.` : '',
        ].filter(Boolean).join(' ');
        return (
          <span style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center', whiteSpace: 'nowrap' }}>
            <span
              title={openTitle}
              style={{ padding: '1px 6px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700, background: t.openCount ? '#FEF3C7' : '#F3F4F6', color: t.openCount ? '#92400E' : '#6B7280' }}
            >{t.openCount} load{t.openCount === 1 ? '' : 's'}</span>
            <span
              title={clickTitle}
              style={{ padding: '1px 6px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700, background: t.clickCount ? '#E0F2FE' : '#F3F4F6', color: t.clickCount ? '#075985' : '#6B7280' }}
            >{t.clickCount} click{t.clickCount === 1 ? '' : 's'}</span>
          </span>
        );
      }
      case 'repliedBy':
        return <span style={{ color: 'var(--color-text-secondary)', fontWeight: c.replied ? 600 : 400 }} title={c.repliedBy || ''}>{c.repliedBy || '-'}</span>;
      case 'replyDate':
        return <span style={{ color: 'var(--color-text-secondary)' }}>{c.replied ? fmtDate(c.replyDate) : '-'}</span>;
      case 'eventStatus': {
        const EVENT_STATUS_STYLES = {
          going: { background: '#DCFCE7', color: '#166534', border: '1px solid #86EFAC' },
          'not-going': { background: '#FEE2E2', color: '#991B1B', border: '1px solid #FCA5A5' },
          maybe: { background: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A' },
        };
        const st = EVENT_STATUS_STYLES[c.eventStatus] || { background: 'var(--color-surface)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' };
        return (
          <select
            value={c.eventStatus || ''}
            onChange={e => setEventStatus(i, e.target.value)}
            style={{ padding: '2px 4px', borderRadius: '6px', fontSize: '0.68rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', maxWidth: '100%', ...st }}
          >
            <option value="">-</option>
            <option value="going">Going</option>
            <option value="not-going">Not going</option>
            <option value="maybe">Maybe</option>
          </select>
        );
      }
      default:
        return null;
    }
  }

  const SORT_HEADER_STYLE = { position: 'relative', padding: '0.45rem 0.6rem', textAlign: 'left', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid var(--color-border)', userSelect: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
  const RESIZE_HANDLE = { position: 'absolute', top: 0, right: 0, bottom: 0, width: 6, cursor: 'col-resize', userSelect: 'none' };

  // A column header: sorts on click where the column can be sorted, and
  // always carries the grip on its right edge that sets its width.
  function ColHeader({ col }) {
    const active = col.sortKey && sortConfig.key === col.sortKey;
    return (
      <th
        style={{ ...SORT_HEADER_STYLE, cursor: col.sortKey ? 'pointer' : 'default' }}
        title={col.title || (col.sortKey ? `Sort by ${col.label}` : col.label)}
        onClick={col.sortKey ? () => toggleSort(col.sortKey) : undefined}
      >
        {col.label}
        {col.sortKey && (
          <span style={{ marginLeft: '0.3rem', fontSize: '0.7rem', opacity: active ? 1 : 0.3 }}>
            {active ? (sortConfig.dir === 'asc' ? '▲' : '▼') : '↕'}
          </span>
        )}
        <span
          onMouseDown={e => startColResize(col.key, e)}
          onClick={e => e.stopPropagation()}
          title={`Drag to resize ${col.label}`}
          style={RESIZE_HANDLE}
        />
      </th>
    );
  }

  return (
    // Wide: the campaign's contact table carries nine columns — sent date,
    // delivery, status, loads/clicks, who replied and when, event status —
    // and at the old 1000px cap the last of them fell off the right edge of
    // a container that clipped rather than scrolled. The cap is what keeps
    // the search box and the subject line from stretching across an
    // ultrawide monitor, so it stays, just wide enough for the table.
    <div style={{ padding: '1.5rem', maxWidth: '1600px' }}>
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
        <button
          onClick={() => (showNewForm ? closeNewForm() : openNewForm())}
          title="Create a campaign by hand, before any mail has gone out for it"
          style={{
            padding: '0.5rem 1rem', border: '1px solid var(--color-accent)', borderRadius: '6px',
            background: 'var(--color-surface)', color: 'var(--color-accent)', fontSize: '0.85rem',
            fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >
          {showNewForm ? 'Cancel' : '+ New Campaign'}
        </button>
      </div>

      {/* Create a campaign by hand. The Search box above only finds campaigns
          whose mail has already gone out; this sets one up first, with an empty
          roster to add contacts to. */}
      {showNewForm && (
        <div style={{ padding: '0.75rem', marginBottom: '1rem', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-surface)' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.5rem' }}>New Campaign</div>
          {/* Top-aligned: the subject box is a textarea now and grows
              downwards, and a bottom-aligned row dragged the Title field down
              with it. The buttons carry the label's height so they still sit
              on the fields' first line. */}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 220px' }}>
              <label style={{ display: 'block', fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--color-text-secondary)', marginBottom: '2px' }}>Title</label>
              <input
                autoFocus
                type="text"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); createCampaign(); }
                  else if (e.key === 'Escape') { e.preventDefault(); closeNewForm(); }
                }}
                placeholder="Campaign name (defaults to the subject)"
                style={{ width: '100%', padding: '0.4rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: '6px', fontSize: '0.8rem', fontFamily: 'inherit' }}
              />
            </div>
            <div style={{ flex: '1 1 280px' }}>
              <label style={{ display: 'block', fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--color-text-secondary)', marginBottom: '2px' }}>Subject lines</label>
              {/* One per row: a campaign going out under two lines is set up
                  as one campaign here rather than as two that each hold half
                  the roster. Enter adds a row, so ⌘/Ctrl+Enter creates. */}
              <textarea
                value={newSubject}
                rows={Math.min(6, Math.max(2, newSubject.split('\n').length + 1))}
                onChange={e => setNewSubject(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); createCampaign(); }
                  else if (e.key === 'Escape') { e.preventDefault(); closeNewForm(); }
                }}
                placeholder={'Email subject line to match sent mail on\nAnother line, if it goes out under more than one'}
                style={{ width: '100%', boxSizing: 'border-box', padding: '0.4rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: '6px', fontSize: '0.8rem', fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5 }}
              />
            </div>
            <button
              onClick={createCampaign}
              disabled={creating || !newSubject.trim()}
              style={{
                marginTop: '0.95rem',
                padding: '0.4rem 0.9rem', border: 'none', borderRadius: '6px',
                background: 'var(--color-accent)', color: '#fff', fontSize: '0.8rem',
                fontWeight: 600, fontFamily: 'inherit',
                cursor: creating ? 'wait' : (newSubject.trim() ? 'pointer' : 'default'),
                opacity: newSubject.trim() ? 1 : 0.5,
              }}
            >
              {creating ? 'Creating…' : 'Create'}
            </button>
            <button
              onClick={closeNewForm}
              style={{
                marginTop: '0.95rem',
                padding: '0.4rem 0.9rem', border: '1px solid var(--color-border)', borderRadius: '6px',
                background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '0.8rem',
                fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginTop: '0.5rem' }}>
            The campaign starts empty — add the contacts it tracks with “Add an email to this campaign…”. The subject lines are only used to look up whether those addresses were sent or replied — one per row, and mail matching any of them counts.
          </div>
        </div>
      )}

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
            {/* Image loads / clicks, joined from the tracked drafts. Only shown
                once at least one send in this campaign carried tracking —
                otherwise the tiles would read a misleading 0%. */}
            {trackingStats.tracked > 0 && (
              <>
                <div style={{ padding: '0.75rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', borderLeft: '3px solid #F59E0B' }}>
                  <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Images loaded</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#F59E0B' }} title={`${trackingStats.opened} of ${trackingStats.tracked} tracked send${trackingStats.tracked === 1 ? '' : 's'} had the tracking pixel fetched — which is not the same as being read. Hits before the send (proof-reading the draft), automated fetches and repeat loads within 5 minutes don't count. What's left is still directional: Apple Mail pre-loads the pixel and Outlook blocks it.`}>
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
              No tracking for {displaySubjects.length > 1 ? 'these subjects' : 'this subject'}. Tracking is added when you generate the drafts from{' '}
              <strong>Draft Emails</strong> with “Track image loads &amp; clicks” checked.
            </div>
          )}

          {/* Subject + Save button */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
              {(displayResults.title && displayResults.title !== displaySubjects[0]) && (
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-text)', marginBottom: '2px' }}>{displayResults.title}</div>
              )}
              {editingSubjectInline ? (
                /* One subject line per row. Enter adds a row rather than
                   saving — the whole point of the box is that a campaign can
                   carry several — so ⌘/Ctrl+Enter is the keyboard save. */
                <span style={{ display: 'inline-flex', alignItems: 'flex-start', gap: '0.35rem', flexWrap: 'wrap' }}>
                  <span style={{ paddingTop: '0.25rem' }}>Matching subjects:</span>
                  <span style={{ display: 'inline-flex', flexDirection: 'column', gap: '2px' }}>
                    <textarea
                      value={subjectDraft}
                      autoFocus
                      rows={Math.min(6, Math.max(2, subjectDraft.split('\n').length + 1))}
                      onChange={(e) => setSubjectDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitSubjectEdit(); }
                        else if (e.key === 'Escape') { e.preventDefault(); cancelSubjectEdit(); }
                      }}
                      placeholder={'One subject line per row'}
                      style={{
                        minWidth: '320px', padding: '0.25rem 0.4rem', border: '1px solid var(--color-accent)',
                        borderRadius: '4px', fontSize: '0.8rem', fontFamily: 'inherit', color: 'var(--color-text)',
                        background: 'var(--color-surface)', resize: 'vertical', lineHeight: 1.5,
                      }}
                    />
                    <span style={{ fontSize: '0.62rem', color: 'var(--color-text-muted)' }}>
                      One per row — mail matching any of them counts toward this campaign. ⌘/Ctrl+Enter to save.
                    </span>
                  </span>
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
                  {/* Every line the campaign matches on. One reads as it
                      always did; several are listed so it's obvious at a
                      glance that this campaign pools more than one send. */}
                  {displaySubjects.length > 1 ? 'Matching subjects: ' : 'Matching subject: '}
                  {displaySubjects.length === 0
                    ? <strong>—</strong>
                    : displaySubjects.map((sub, i) => (
                      <span key={sub}>
                        {i > 0 && <span style={{ color: 'var(--color-text-muted)' }}> · </span>}
                        <strong>"{sub}"</strong>
                      </span>
                    ))}
                  <button
                    onClick={startSubjectEdit}
                    title="Edit this campaign's subject lines — a campaign can match on more than one"
                    style={{
                      marginLeft: '0.4rem', padding: '1px 6px', border: '1px solid var(--color-border)',
                      borderRadius: '4px', background: 'var(--color-surface)', color: 'var(--color-accent)',
                      fontSize: '0.6rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
                    }}
                  >Edit</button>
                </>
              )}
              {viewingSaved !== null && <span style={{ marginLeft: '0.5rem', padding: '1px 6px', borderRadius: '999px', fontSize: '0.6rem', fontWeight: 600, background: '#DBEAFE', color: '#1E40AF' }}>Saved</span>}
              {refreshing && <span style={{ marginLeft: '0.5rem', fontSize: '0.6rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>↻ Refreshing…</span>}
              {displayResults.autoRepliesSuppressed > 0 && (
                <span
                  title={(() => {
                    const sup = displayResults.suppressed;
                    const parts = sup
                      ? [
                        sup.bounce && `${sup.bounce} delivery failure${sup.bounce === 1 ? '' : 's'}`,
                        sup.ooo && `${sup.ooo} out-of-office`,
                        sup.other && `${sup.other} other automated`,
                      ].filter(Boolean)
                      : [];
                    const breakdown = parts.length ? ` (${parts.join(', ')})` : '';
                    return `Machine-generated mail is excluded from the response count${breakdown}. Bounces and out-of-office replies are shown against the contact in the Status column.`;
                  })()}
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
              <button
                onClick={exportContactsCsv}
                disabled={!(displayResults.contacts || []).length}
                title="Download this campaign as a CSV: every contact, with send date, delivery, status, image loads, clicks, replies and event status"
                style={{
                  padding: '0.35rem 0.75rem', border: '1px solid var(--color-border)', borderRadius: '6px',
                  background: 'var(--color-surface)', color: 'var(--color-text-secondary)',
                  fontSize: '0.75rem', fontWeight: 600, fontFamily: 'inherit',
                  cursor: (displayResults.contacts || []).length ? 'pointer' : 'default',
                  opacity: (displayResults.contacts || []).length ? 1 : 0.5,
                }}
              >
                Export CSV
              </button>
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

            {/* The same Columns picker the contacts tables use: show / hide,
                star a default set, drag to reorder, Reset to get back. Widths
                are set by dragging a header's right edge. */}
            <div style={{ marginLeft: 'auto' }}>
              <ColumnToggle
                align="right"
                columns={orderedColumns}
                visibleCols={visibleColKeys}
                starredCols={colStarred}
                removedColumns={removedColumns}
                alwaysVisible={CONTACT_COLS_LOCKED}
                colNames={{}}
                onToggle={toggleCol}
                onStar={starCol}
                onRemove={removeCol}
                onRestore={restoreCol}
                onReorder={reorderCols}
                onResetColumns={resetCols}
              />
            </div>
          </div>

          {/* An empty roster — a just-created campaign, or one every contact has
              been removed from. The table renders nothing at all in that case,
              so say what to do next instead of showing a blank panel. */}
          {!(displayResults.contacts || []).length && (
            <div style={{ padding: '1rem', border: '1px dashed var(--color-border)', borderRadius: '8px', textAlign: 'center', fontSize: '0.78rem', color: 'var(--color-text-secondary)' }}>
              No contacts in this campaign yet — add an email above to start tracking who it goes to.
            </div>
          )}

          {/* Contact table */}
          {displayResults.contacts && displayResults.contacts.length > 0 && (
            /* Scrolls both ways. It used to be `overflow: hidden` with only
               the vertical axis opened back up, so on a narrow window the
               Event Status column was cut off with no way to reach it — the
               columns don't compress below minWidth, they just go past the
               edge. */
            <div style={{ border: '1px solid var(--color-border)', borderRadius: '8px', maxHeight: '500px', overflowY: 'auto', overflowX: 'auto' }}>
              {/* Fixed layout, so a column is exactly as wide as it is set to
                  be and a drag on one header edge moves that column and
                  nothing else. The last column has no width of its own: it
                  soaks up whatever is left over, which is what keeps a
                  narrow table filling the pane without the other columns
                  being stretched to do it. Past the pane's width the table
                  simply overflows and the box scrolls. */}
              <table style={{ tableLayout: 'fixed', width: '100%', minWidth: `${tableWidth}px`, borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <colgroup>
                  {visibleColumns.map(col => <col key={col.key} style={{ width: `${widthOf(col)}px` }} />)}
                  <col style={{ width: `${ACTIONS_COL_WIDTH}px` }} />
                  <col />
                </colgroup>
                <thead>
                  <tr style={{ background: 'var(--color-surface-alt)', position: 'sticky', top: 0, zIndex: 1 }}>
                    {visibleColumns.map(col => <ColHeader key={col.key} col={col} />)}
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'center', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '0.68rem', borderBottom: '1px solid var(--color-border)' }} aria-label="Remove" />
                    <th style={{ borderBottom: '1px solid var(--color-border)' }} aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {sortedContacts.map(({ c, i }) => {
                    const isDup = dupKeys.has(contactKey(c));
                    return (
                    <tr key={i} style={{ borderBottom: '1px solid var(--color-border-light)', background: isDup ? '#FFFBEB' : undefined }}>
                      {visibleColumns.map(col => (
                        <td key={col.key} style={{ padding: '0.4rem 0.6rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {renderContactCell(col.key, c, i, isDup)}
                        </td>
                      ))}
                      <td style={{ padding: '0.4rem 0.3rem', textAlign: 'center' }}>
                        <button
                          onClick={() => removeContact(i)}
                          style={{ background: 'none', border: 'none', color: '#CBD5E1', fontSize: '0.85rem', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
                          onMouseEnter={e => e.target.style.color = '#EF4444'}
                          onMouseLeave={e => e.target.style.color = '#CBD5E1'}
                          title="Remove from list"
                        >&times;</button>
                      </td>
                      <td aria-hidden="true" />
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
            <div style={{ display: 'inline-flex', gap: '0.4rem' }}>
              <button
                onClick={exportSummaryCsv}
                title="Download every saved campaign as a CSV: contacts, sent, % sent, replies, response rate and status"
                style={{
                  padding: '0.3rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: '6px',
                  background: 'var(--color-surface)', color: 'var(--color-text-secondary)',
                  fontSize: '0.7rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
                }}
              >
                Export CSV
              </button>
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
              const subs = campaignSubjects(c);
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
                        <label style={{ display: 'block', fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--color-text-secondary)', marginBottom: '2px' }}>Subject lines</label>
                        {/* One per row: a campaign that went out under two
                            lines is still one campaign, one roster, one
                            response rate. Enter adds a row, so ⌘/Ctrl+Enter
                            is the save. */}
                        <textarea
                          value={editSubjects}
                          rows={Math.min(6, Math.max(2, editSubjects.split('\n').length + 1))}
                          onChange={e => setEditSubjects(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitEdit(); }
                            else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                          }}
                          placeholder={'Email subject line\nAnother subject line'}
                          style={{ width: '100%', boxSizing: 'border-box', padding: '0.3rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: '4px', fontSize: '0.78rem', fontFamily: 'inherit', color: 'var(--color-text-secondary)', resize: 'vertical', lineHeight: 1.5 }}
                        />
                        <div style={{ fontSize: '0.6rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                          One per row — mail matching any of them counts toward this campaign.
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title || subs[0]}</div>
                      {/* The lines this campaign matches on, shown when they
                          are not simply the title — and always when there is
                          more than one, since a second line is the kind of
                          thing you need to see without opening the campaign. */}
                      {((c.title && c.title !== subs[0]) || subs.length > 1) && (
                        <div style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', marginTop: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={subs.join('\n')}>
                          {subs.length > 1 ? 'Subjects: ' : 'Subject: '}{subs.join(' · ')}
                        </div>
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
                        title="Edit title & subject lines"
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

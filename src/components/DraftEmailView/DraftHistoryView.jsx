// "Draft History" tab on the Draft Emails page.
//
// Every distinct draft ever saved or sent from the composer, kept
// indefinitely in Firestore (one document each, see utils/emailDraftHistory.js),
// unlike the composer's Saved Drafts card, which only keeps the 5 most recent.
// Each entry can be tied to an email campaign; a draft whose subject carries
// a saved campaign's subject line is tied to it automatically when it is
// saved, and the link can be changed or cleared here.
//
// Drafts saved before the history existed (settings.emailDrafts) are copied
// in once, keeping their original dates.

import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { DataTable } from '../common/DataTable';
import { CampaignPicker } from '../common/CampaignPicker';
import { campaignsByRecency, campaignPickerDetail } from '../../utils/campaignPicker';
import { primarySubject } from '../../utils/campaignSubjects';
import { EMAIL_CAMPAIGNS_UPDATED_EVENT } from '../ProspectModal/ContactCampaignAdd';
import { loadDraftIntoComposer } from '../../utils/draftComposerLoad';
import {
  draftPlainText, findLinkedCampaign, suggestCampaigns,
} from '../../utils/emailDraftHistory';
import {
  subscribeDraftHistory, importSavedDrafts, setDraftCampaign, deleteDraftHistory,
} from '../../utils/emailDraftHistoryStore';

const TABLE_ID = 'email-draft-history';

const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};
const timeOf = (iso) => {
  const t = new Date(iso || 0).getTime();
  return Number.isNaN(t) ? 0 : t;
};
const recipientName = (c) => String(c?.name || [c?.firstName, c?.lastName].filter(Boolean).join(' ') || c?.email || '').trim();

const linkBtn = {
  background: 'none', border: 'none', padding: '0 0.2rem', color: '#1D4ED8',
  fontFamily: 'inherit', fontSize: '0.74rem', fontWeight: 600, cursor: 'pointer',
};

const chipBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 3, maxWidth: '100%', minWidth: 0,
  padding: '1px 7px', border: '1px dashed #93C5FD', borderRadius: 999, background: '#EFF6FF',
  color: '#1D4ED8', fontFamily: 'inherit', fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer',
};

// The guesses for an untied draft, as one-click chips under its picker.
function SuggestionChips({ entry, suggestions, onLink }) {
  if (!suggestions?.length) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3, minWidth: 0, flexWrap: 'wrap' }}>
      <span style={{ fontSize: '0.64rem', color: '#64748B', flexShrink: 0 }}>Suggested:</span>
      {suggestions.slice(0, 2).map(sg => (
        <button
          key={sg.key}
          type="button"
          style={chipBtn}
          onClick={() => onLink(entry, sg.key)}
          title={`Tie to "${sg.label}": ${sg.reason}`}
        >
          <span aria-hidden="true">+</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sg.label}</span>
        </button>
      ))}
    </div>
  );
}

function CampaignCell({ entry, options, campaigns, suggestions, onLink, onOpenCampaign }) {
  const linked = findLinkedCampaign(campaigns, entry.campaign);
  const key = linked ? primarySubject(linked) : '';
  const missing = entry.campaign && !linked;
  return (
    <div style={{ minWidth: 0, padding: '2px 0' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
      <CampaignPicker
        options={options}
        value={key}
        onChange={(k) => { if (k && k !== key) onLink(entry, k); }}
        ariaLabel={`Email campaign for "${entry.subject || 'untitled draft'}"`}
        placeholder={missing ? `${entry.campaign} (deleted)` : 'Tie to a campaign...'}
        title="Type to search saved campaigns, most recent first"
        style={{ flex: 1, minWidth: 0 }}
      />
      {linked && onOpenCampaign && (
        <button type="button" style={linkBtn} onClick={() => onOpenCampaign(linked)} title="Open this campaign on the Email Campaigns tab">Open</button>
      )}
      {entry.campaign && (
        <button type="button" style={{ ...linkBtn, color: '#94A3B8' }} onClick={() => onLink(entry, '')} title="Untie this draft from its campaign" aria-label="Untie from campaign">×</button>
      )}
    </div>
    {!linked && <SuggestionChips entry={entry} suggestions={suggestions} onLink={onLink} />}
    </div>
  );
}

export function DraftHistoryView({ settings, updateSettings, onLoadDraft, onOpenCampaign }) {
  const { user } = useAuth();
  const uid = user?.uid;
  const [entries, setEntries] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [campaigns, setCampaigns] = useState([]);
  const [message, setMessage] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());

  useEffect(() => {
    if (!uid) return undefined;
    return subscribeDraftHistory(uid, (list) => { setEntries(list); setLoadError(''); }, (err) => {
      setEntries([]);
      setLoadError(err?.code === 'permission-denied'
        ? 'Draft History is not allowed by the deployed Firestore rules yet. It starts working once the next deploy publishes them.'
        : `Could not load Draft History: ${err?.message || err}`);
    });
  }, [uid]);

  useEffect(() => {
    if (!uid) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const snap = await getDoc(doc(db, 'emailCampaigns', uid));
        if (!cancelled) setCampaigns(snap.exists() ? (snap.data().campaigns || []) : []);
      } catch { if (!cancelled) setCampaigns([]); }
    };
    load();
    window.addEventListener(EMAIL_CAMPAIGNS_UPDATED_EVENT, load);
    return () => { cancelled = true; window.removeEventListener(EMAIL_CAMPAIGNS_UPDATED_EVENT, load); };
  }, [uid]);

  // One-time copy of the drafts saved before the history existed. Waits for
  // the history to load so a failed subscription doesn't mark it done.
  const legacyDrafts = settings?.emailDrafts;
  const imported = !!settings?.emailDraftHistoryImported;
  useEffect(() => {
    if (!uid || entries === null || loadError || imported || !settings) return;
    let cancelled = false;
    importSavedDrafts(uid, legacyDrafts || []).then((res) => {
      if (cancelled || !res.ok) return;
      updateSettings?.({ emailDraftHistoryImported: true });
    });
    return () => { cancelled = true; };
  }, [uid, entries === null, loadError, imported]); // eslint-disable-line react-hooks/exhaustive-deps

  const flash = (type, text) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const options = useMemo(() => campaignsByRecency(campaigns)
    .map(({ campaign: c }) => ({
      key: primarySubject(c),
      label: primarySubject(c) || '(untitled)',
      text: [c.title, ...(Array.isArray(c.subjects) ? c.subjects : [])].filter(Boolean).join(' '),
      detail: campaignPickerDetail(c),
    }))
    .filter((o, i, all) => o.key && all.findIndex(x => x.key === o.key) === i), [campaigns]);

  async function link(entry, campaign) {
    const res = await setDraftCampaign(uid, entry.id, campaign);
    if (!res.ok) flash('error', `Could not update the campaign: ${res.error}`);
  }

  async function remove(entry) {
    const ok = window.confirm(`Delete "${entry.subject || '(No subject)'}" from Draft History for good? This cannot be undone.`);
    if (!ok) return;
    const res = await deleteDraftHistory(uid, entry.id);
    if (!res.ok) flash('error', `Could not delete: ${res.error}`);
  }

  function load(entry) {
    if (loadDraftIntoComposer(entry)) onLoadDraft?.();
  }

  const toggle = (id) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const rows = useMemo(() => (entries || []).map((e) => {
    const linked = findLinkedCampaign(campaigns, e.campaign);
    return {
      ...e,
      _entry: e,
      campaignName: linked ? primarySubject(linked) : (e.campaign ? `${e.campaign} (deleted)` : ''),
      recipientCount: e.contacts.length,
      recipientNames: e.contacts.map(recipientName).filter(Boolean).join(', '),
      snippet: draftPlainText(e.body).slice(0, 240),
      status: e.sentCount > 0 ? 'Sent' : 'Saved',
      // Only worked out for drafts not tied to a live campaign: a tied
      // draft has its answer.
      suggestions: linked ? [] : suggestCampaigns(campaigns, e),
    };
  }), [entries, campaigns]);

  // Plain, not memoized: the cells close over this render's handlers, and
  // the React Compiler memoizes it on what it actually reads.
  const columns = [
    {
      key: 'subject', label: 'Subject', defaultWidth: 260, sticky: true,
      render: (r) => (
        <button type="button" onClick={() => toggle(r.id)} title={expanded.has(r.id) ? 'Hide the message' : 'Show the message'}
          style={{ ...linkBtn, padding: 0, color: '#1E293B', textAlign: 'left', fontWeight: 600 }}>
          {expanded.has(r.id) ? '▾ ' : '▸ '}{r.subject || '(No subject)'}
        </button>
      ),
    },
    {
      key: 'campaignName', label: 'Email Campaign', defaultWidth: 280,
      getFilterValue: (r) => r.campaignName || '(none)',
      render: (r) => (
        <CampaignCell entry={r._entry} options={options} campaigns={campaigns} suggestions={r.suggestions} onLink={link} onOpenCampaign={onOpenCampaign} />
      ),
    },
    { key: 'status', label: 'Status', defaultWidth: 80 },
    {
      key: 'recipientCount', label: 'Recipients', defaultWidth: 90,
      getFilterValue: (r) => String(r.recipientCount),
      render: (r) => <span title={r.recipientNames || 'No recipients'}>{r.recipientCount}</span>,
    },
    { key: 'recipientNames', label: 'To', defaultWidth: 220, render: (r) => r.recipientNames || '-' },
    {
      key: 'createdAt', label: 'First Saved', defaultWidth: 150,
      getSortValue: (r) => timeOf(r.createdAt), getFilterValue: (r) => fmtDate(r.createdAt),
      exportValue: (r) => fmtDate(r.createdAt), render: (r) => fmtDate(r.createdAt) || '-',
    },
    {
      key: 'lastSavedAt', label: 'Last Saved', defaultWidth: 150,
      getSortValue: (r) => timeOf(r.lastSavedAt), getFilterValue: (r) => fmtDate(r.lastSavedAt),
      exportValue: (r) => fmtDate(r.lastSavedAt), render: (r) => fmtDate(r.lastSavedAt) || '-',
    },
    {
      key: 'lastSentAt', label: 'Last Sent', defaultWidth: 150,
      getSortValue: (r) => timeOf(r.lastSentAt), getFilterValue: (r) => fmtDate(r.lastSentAt),
      exportValue: (r) => fmtDate(r.lastSentAt), render: (r) => fmtDate(r.lastSentAt) || '-',
    },
    { key: 'sentCount', label: 'Times Sent', defaultWidth: 85, getFilterValue: (r) => String(r.sentCount) },
    { key: 'snippet', label: 'Message', defaultWidth: 320, render: (r) => <span style={{ color: '#64748B' }}>{r.snippet || '-'}</span> },
    {
      key: '_actions', label: 'Actions', defaultWidth: 90, exportValue: () => '',
      render: (r) => (
        <div style={{ display: 'flex', gap: 2 }}>
          <button type="button" style={linkBtn} onClick={() => load(r._entry)} title="Open this draft in the composer on the Drafts tab">Load</button>
          <button type="button" style={{ ...linkBtn, color: '#DC2626' }} onClick={() => remove(r._entry)} title="Delete from Draft History" aria-label="Delete from Draft History">×</button>
        </div>
      ),
    },
  ];

  const renderExpansion = (r) => (
    <div style={{ padding: '0.6rem 0.9rem', background: '#F8FAFC', borderTop: '1px solid #E2E8F0' }}>
      <div style={{ fontSize: '0.74rem', color: '#475569', marginBottom: 6 }}>
        <strong>To:</strong> {r.recipientNames || 'No recipients'}
        {r.cc.length > 0 && <> · <strong>CC:</strong> {r.cc.join(', ')}</>}
        {r.saveCount > 1 && <> · saved {r.saveCount} times</>}
      </div>
      <div
        style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 6, padding: '0.6rem 0.8rem', fontSize: '0.82rem', maxHeight: 420, overflow: 'auto' }}
        // The draft's own body, as typed into the composer by this user.
        dangerouslySetInnerHTML={{ __html: r.body }}
      />
    </div>
  );

  if (!uid) return <p style={{ color: '#64748B', fontSize: '0.85rem' }}>Sign in to see your draft history.</p>;

  const linkedCount = rows.filter(r => r.campaign).length;
  const suggested = rows.filter(r => r.suggestions.length > 0);

  async function acceptAll() {
    const ok = window.confirm(`Tie ${suggested.length} draft${suggested.length === 1 ? '' : 's'} to ${suggested.length === 1 ? 'its' : 'their'} top suggested campaign?\n\n${suggested.map(r => `${r.subject || '(No subject)'}  ->  ${r.suggestions[0].label}`).join('\n')}`);
    if (!ok) return;
    let failed = 0;
    for (const r of suggested) {
      const res = await setDraftCampaign(uid, r.id, r.suggestions[0].key);
      if (!res.ok) failed += 1;
    }
    flash(failed ? 'error' : 'success', failed
      ? `${suggested.length - failed} tied, ${failed} failed. Try those again.`
      : `Tied ${suggested.length} draft${suggested.length === 1 ? '' : 's'} to ${suggested.length === 1 ? 'its' : 'their'} suggested campaign.`);
  }
  // DataTable fills a bounded flex column (it scrolls its own body); the
  // Draft Emails page around this is a plain block, so bound it here.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 140px)', minHeight: 420 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1.05rem', color: '#1E293B' }}>Draft History</h2>
        {entries && (
          <span style={{ fontSize: '0.78rem', color: '#64748B' }}>
            {rows.length} draft{rows.length === 1 ? '' : 's'}, {linkedCount} tied to a campaign
          </span>
        )}
        {suggested.length > 0 && (
          <button
            type="button"
            onClick={acceptAll}
            title="Tie every untied draft that has a suggestion to its top suggested campaign. You see the list before anything changes."
            style={{ ...chipBtn, border: '1px solid #1D4ED8', background: '#fff', fontSize: '0.74rem', padding: '2px 10px' }}
          >Accept all suggestions ({suggested.length})</button>
        )}
      </div>
      <p style={{ margin: '0 0 10px', fontSize: '0.78rem', color: '#64748B', maxWidth: 820, lineHeight: 1.4 }}>
        Every draft you save or send from the Drafts tab is kept here for good. Saving the same draft again updates its row; any edit makes a new row, so earlier versions stay.
        A draft whose subject carries a campaign&apos;s subject line is tied to that campaign automatically, and moving a draft&apos;s contacts to a campaign ties it too. Untied drafts get suggestions from the campaigns whose rosters hold their recipients or whose subjects share their words; click one to tie it. Change or clear any link in the Email Campaign column.
      </p>
      {loadError && <p style={{ color: '#B91C1C', fontSize: '0.8rem' }}>{loadError}</p>}
      {message && <p style={{ color: message.type === 'error' ? '#B91C1C' : '#15803D', fontSize: '0.8rem' }}>{message.text}</p>}
      {entries === null ? (
        <p style={{ color: '#64748B', fontSize: '0.85rem' }}>Loading draft history...</p>
      ) : (
        <DataTable
          tableId={TABLE_ID}
          exportFileName="Email Draft History"
          columns={columns}
          rows={rows}
          defaultSort={{ key: 'lastSavedAt', direction: 'desc' }}
          alwaysVisible={['subject']}
          defaultHidden={['recipientNames', 'lastSentAt']}
          expandedRowIds={expanded}
          renderExpansion={renderExpansion}
          variableRowHeight
          emptyMessage="No drafts yet. Save or send one from the Drafts tab and it will be kept here."
          settings={settings}
          updateSettings={updateSettings}
        />
      )}
    </div>
  );
}

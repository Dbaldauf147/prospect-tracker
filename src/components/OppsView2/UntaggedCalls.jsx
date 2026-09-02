// "Calls to map" — the untriaged calls, on the page where the deals are.
//
// A synced call that nobody has tagged is a to-do: either it belongs to
// an opportunity (and its summary should be on that deal) or it belongs
// to none. Until now that decision could only be made on the Call
// Recordings page, which is the wrong place to be standing — the opp you
// are trying to name is over here.
//
// So the queue surfaces under the To do list, each row carrying the opps
// it probably belongs to, matched from the call's title, its attendees'
// email domains, and the opps' own accounts and notes. Suggestions are
// offered, never applied: the cost of a wrong guess is a call summary
// pushed onto somebody else's deal.
//
// Tagging one from here does everything tagging it on the Call Recordings
// page does — the call's follow-ups go onto that opp's Next Steps
// checklist, and the opp starts naming it as its last conversation. The
// write itself belongs to the parent (see `onTagged`), because this page
// holds the opps dataset in state.
//
// Renders nothing when the queue is empty, so a user who doesn't record
// calls sees one Firestore read and no UI.

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { loadCallRecords, saveCallRecord } from '../../utils/callRecordingsStore';
import { oppLabel } from '../../utils/callRecordShape';
import { oppTagStateOf, OPP_TAG_NONE, tagOppPatch, markOppNaPatch } from '../../utils/callOppTag';
import { suggestOppsForCall } from '../../utils/callOppSuggest';
import { isActiveOppStage } from '../../utils/oppStages';

function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const btn = {
  padding: '0.2rem 0.55rem', borderRadius: 6, border: '1px solid var(--color-border)',
  background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: '0.72rem',
  fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
};

const suggestBtn = {
  ...btn, border: '1px solid #86EFAC', background: '#F0FDF4', color: '#166534', fontWeight: 600,
};

/** One untagged call, its suggestions, and the two ways to settle it. */
function CallRow({ call, opps, closedOpps, onTag, onNa, busy }) {
  const [search, setSearch] = useState('');
  const [picking, setPicking] = useState(false);

  const suggestions = useMemo(() => suggestOppsForCall(call, opps), [call, opps]);

  // The manual picker: every live opp, filtered by what's typed. Capped —
  // the list is a shortcut to one row, not a second opps table.
  const hits = (list, term) => (list || [])
    .filter(o => `${o?.['Account'] || ''} ${o?.['Scope'] || ''} ${o?.['Stage'] || ''}`.toLowerCase().includes(term));
  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return [];
    return hits(opps, term).slice(0, 8);
  }, [opps, search]);
  // Closed opps the same search would have found. Counted rather than
  // listed: they aren't taggable here, but a silent no-results on a deal
  // the user can see on the table reads as the search being broken.
  const closedHidden = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return 0;
    return hits(closedOpps, term).length;
  }, [closedOpps, search]);

  const when = fmtWhen(call.recordedAt || call.createdAt);

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: '0.5rem', flexWrap: 'wrap',
      padding: '0.45rem 0.6rem', borderTop: '1px solid var(--color-border-light)',
      opacity: busy ? 0.5 : 1,
    }}>
      <div style={{ minWidth: 210, flex: '1 1 260px' }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text)' }}>
          {call.name || 'Untitled call'}
        </div>
        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
          {[when, call.company, call.granolaSummary ? 'summarised' : ''].filter(Boolean).join(' · ')}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap', flex: '2 1 420px' }}>
        {suggestions.map(({ opp, reasons }) => (
          <button
            key={opp._id}
            type="button"
            disabled={busy}
            onClick={() => onTag(call, opp)}
            title={`Tag this call to ${oppLabel(opp)}\n\nSuggested because ${reasons.join('; ')}`}
            style={suggestBtn}
          >{opp['Account'] || 'Untitled opp'}{opp['Scope'] ? ` · ${opp['Scope']}` : ''}</button>
        ))}
        {suggestions.length === 0 && !picking && (
          <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
            No likely live opp from the title or who was on it
          </span>
        )}

        {picking ? (
          <div style={{ position: 'relative' }}>
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') { setPicking(false); setSearch(''); } }}
              placeholder="Search opps…"
              style={{ ...btn, cursor: 'text', width: 200 }}
            />
            {matches.length === 0 && closedHidden > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, zIndex: 20, marginTop: 2,
                background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                borderRadius: 6, boxShadow: '0 6px 18px rgba(15,23,42,0.18)', width: 320,
                padding: '0.35rem 0.5rem', fontSize: '0.72rem', color: 'var(--color-text-muted)',
              }}>
                {closedHidden} closed opp{closedHidden === 1 ? '' : 's'} match, but only live deals can be tagged here.
              </div>
            )}
            {matches.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, zIndex: 20, marginTop: 2,
                background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                borderRadius: 6, boxShadow: '0 6px 18px rgba(15,23,42,0.18)', width: 320, maxHeight: 220, overflowY: 'auto',
              }}>
                {matches.map(o => (
                  <button
                    key={o._id}
                    type="button"
                    onClick={() => { setPicking(false); setSearch(''); onTag(call, o); }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left', border: 'none',
                      background: 'transparent', padding: '0.35rem 0.5rem', fontSize: '0.75rem',
                      fontFamily: 'inherit', cursor: 'pointer', color: 'var(--color-text)',
                    }}
                  >{oppLabel(o)}</button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <button type="button" style={btn} disabled={busy} onClick={() => setPicking(true)}>
            {suggestions.length > 0 ? 'Another opp…' : 'Find an opp…'}
          </button>
        )}

        <button
          type="button"
          style={btn}
          disabled={busy}
          onClick={() => onNa(call)}
          title="This call belongs to no opportunity — an internal meeting, a training session. It leaves the queue rather than sitting in it."
        >Not a deal</button>
      </div>
    </div>
  );
}

export function UntaggedCalls({ opps = [], onTagged }) {
  const { user } = useAuth();
  // Only live deals are offered. A call summary belongs on a deal somebody
  // is still working; pushing one onto a Sold or Not Sold opp isn't a
  // decision anyone is trying to make here, and on an established account
  // the closed deals outnumber the open ones badly enough to bury them.
  // The caller hands over every record, so the split happens here.
  const activeOpps = useMemo(() => (opps || []).filter(o => isActiveOppStage(o?.['Stage'])), [opps]);
  const closedOpps = useMemo(() => (opps || []).filter(o => !isActiveOppStage(o?.['Stage'])), [opps]);
  const uid = user?.uid;
  const [calls, setCalls] = useState([]);
  const [collapsed, setCollapsed] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  // What the last tag actually did to the opp. The row leaves the queue
  // the moment it is settled, so without this the steps land on a deal
  // the user is no longer looking at, silently.
  const [note, setNote] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!uid) { setCalls([]); return; }
      const stored = await loadCallRecords(uid);
      if (cancelled) return;
      const queue = Object.values(stored || {})
        .filter(r => r?.id && oppTagStateOf(r) === OPP_TAG_NONE)
        // Newest first: the call somebody is still thinking about is the
        // one they just had.
        .sort((a, b) => String(b.recordedAt || b.createdAt || '').localeCompare(String(a.recordedAt || a.createdAt || '')));
      setCalls(queue);
    })();
    return () => { cancelled = true; };
  }, [uid]);

  // Both actions write the same shape the Call Recordings page writes, so
  // a decision made here is the same decision made there — including the
  // undo, which lives on that page's queue filter.
  async function settle(call, patch) {
    if (!uid) return null;
    setBusyId(call.id);
    setError('');
    setNote('');
    const saved = await saveCallRecord(uid, call.id, patch, call);
    setBusyId('');
    if (!saved) {
      setError(`Couldn’t save that: ${call.name || 'the call'} is still untagged.`);
      return null;
    }
    setCalls(prev => prev.filter(c => c.id !== call.id));
    return saved;
  }

  /**
   * Tagging a call here does what tagging it on the Call Recordings page
   * does: it says which deal the call belongs to, AND it puts what the
   * call produced onto that deal.
   *
   * Until now this queue only wrote the tag. The follow-ups stayed on the
   * call record, so a call mapped from the Opps page — the page whose
   * whole point is the checklist — was the one way of mapping a call that
   * left the checklist untouched, and the difference was invisible: same
   * button, same wording, different outcome.
   *
   * The write onto the opp goes through the parent, because this page
   * holds the opps dataset in state and saves it back on every change; a
   * write straight to the store would be overwritten by the next cell
   * edit. When there is no parent handler the tag still saves — the
   * mapping is the thing the user asked for, and the Call Recordings
   * page's own push covers the steps on the next summarise.
   */
  async function onTag(call, opp) {
    const saved = await settle(call, tagOppPatch(opp, {
      label: oppLabel(opp),
      company: call.company || '',
    }));
    if (!saved || !onTagged) return;
    const account = opp['Account'] || 'the opp';
    try {
      const added = await onTagged(opp._id, saved);
      setNote(added > 0
        ? `${added} next step${added === 1 ? '' : 's'} from “${saved.name || 'that call'}” added to ${account}.`
        : `Tagged to ${account}. No next steps yet — summarize the call and they’ll follow.`);
      // Same stamp the Call Recordings page writes, so its card can say
      // this call's steps already landed rather than offering to push
      // them again.
      if (added > 0) await saveCallRecord(uid, saved.id, { nextStepsPushed: added }, saved);
    } catch (err) {
      // The tag itself is saved; only the copy onto the opp failed. Say
      // which, so the user doesn't re-tag chasing a step that landed.
      setNote('');
      setError(`Tagged to ${account}, but its next steps didn’t reach the opp: ${err?.message || err}`);
    }
  }

  const onNa = (call) => settle(call, markOppNaPatch());

  const strip = (text, color, background) => (
    <div style={{ padding: '0.3rem 0.6rem', fontSize: '0.72rem', color, background }}>{text}</div>
  );

  // An emptied queue keeps only what the tag that emptied it did — a
  // header counting zero calls is a frame around nothing.
  if (calls.length === 0) {
    if (!note && !error) return null;
    return (
      <div style={{ margin: '0 1.25rem 0.75rem', border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden' }}>
        {error && strip(error, '#B91C1C', '#FEF2F2')}
        {note && strip(note, '#166534', '#F0FDF4')}
      </div>
    );
  }

  return (
    <div style={{ margin: '0 1.25rem 0.75rem', border: '1px solid var(--color-border)', borderRadius: 8, background: 'var(--color-bg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.4rem 0.6rem' }}>
        <button
          type="button"
          onClick={() => setCollapsed(c => !c)}
          title={collapsed ? 'Show the calls waiting to be mapped' : 'Hide the calls waiting to be mapped'}
          style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--color-text-muted)', padding: 0, width: 14, lineHeight: 1 }}
        >{collapsed ? '▸' : '▾'}</button>
        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-text)', flex: 1 }}>
          Calls to map <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>({calls.length})</span>
        </span>
        <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
          Tagging one puts its next steps on that opportunity
        </span>
      </div>
      {error && strip(error, '#B91C1C', '#FEF2F2')}
      {note && strip(note, '#166534', '#F0FDF4')}
      {!collapsed && calls.map(call => (
        <CallRow
          key={call.id}
          call={call}
          opps={activeOpps}
          closedOpps={closedOpps}
          onTag={onTag}
          onNa={onNa}
          busy={busyId === call.id}
        />
      ))}
    </div>
  );
}

export default UntaggedCalls;

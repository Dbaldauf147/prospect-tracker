// The drafts tied to an open campaign, from the Draft History (see
// utils/emailDraftHistory.js). Sits in the campaign's header so the wording
// that went out under it is one click away: Load puts a draft back in the
// composer, and the subject toggles a preview of the message.

import { useState } from 'react';
import { draftPlainText } from '../../utils/emailDraftHistory';

const fmt = (iso) => {
  const d = new Date(iso || 0);
  return Number.isNaN(d.getTime()) || !iso ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const btn = {
  background: 'none', border: 'none', padding: '0 0.25rem', color: 'var(--color-accent, #1D4ED8)',
  fontFamily: 'inherit', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer',
};

export function CampaignLinkedDrafts({ drafts, onLoad, onOpenHistory }) {
  const [open, setOpen] = useState(() => new Set());
  const [showAll, setShowAll] = useState(false);
  const toggle = (id) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const list = showAll ? drafts : drafts.slice(0, 3);
  return (
    <div style={{ marginTop: '0.35rem', fontSize: '0.72rem', color: 'var(--color-text-secondary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span>
          {drafts.length === 0 ? 'No drafts tied to this campaign yet.' : <>Drafts: <strong>{drafts.length}</strong></>}
        </span>
        {onOpenHistory && (
          <button type="button" style={btn} onClick={onOpenHistory} title="Tie drafts to campaigns, or see every draft, on the Draft History tab">
            {drafts.length === 0 ? 'Tie one on Draft History' : 'Open Draft History'}
          </button>
        )}
      </div>
      {list.length > 0 && (
        <ul style={{ listStyle: 'none', margin: '0.2rem 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {list.map(d => (
            <li key={d.id}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
                <button
                  type="button"
                  onClick={() => toggle(d.id)}
                  style={{ ...btn, padding: 0, color: 'var(--color-text)', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 420 }}
                  title={open.has(d.id) ? 'Hide the message' : draftPlainText(d.body).slice(0, 300)}
                >{open.has(d.id) ? '▾ ' : '▸ '}{d.subject || '(No subject)'}</button>
                <span style={{ color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                  {d.sentCount > 0 ? `sent ${fmt(d.lastSentAt)}` : `saved ${fmt(d.lastSavedAt)}`} · {d.contacts.length} recipient{d.contacts.length === 1 ? '' : 's'}
                </span>
                <button type="button" style={btn} onClick={() => onLoad(d)} title="Open this draft in the composer on the Drafts tab">Load</button>
              </div>
              {open.has(d.id) && (
                <div
                  style={{ margin: '0.25rem 0 0.35rem 0.9rem', padding: '0.45rem 0.6rem', background: '#fff', border: '1px solid var(--color-border)', borderRadius: 6, color: 'var(--color-text)', fontSize: '0.78rem', maxHeight: 280, overflow: 'auto' }}
                  // The draft's own body, as typed into the composer by this user.
                  dangerouslySetInnerHTML={{ __html: d.body }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {drafts.length > 3 && (
        <button type="button" style={{ ...btn, padding: 0, marginTop: 2 }} onClick={() => setShowAll(v => !v)}>
          {showAll ? 'Show fewer' : `Show all ${drafts.length}`}
        </button>
      )}
    </div>
  );
}

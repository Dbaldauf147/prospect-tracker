// "Calls" section inside the opp detail popup: every call recording
// tagged to this opp on the Call Recordings page, newest first.
//
// Read-only by design. Tagging and transcribing happen on the Call
// Recordings page where the audio is; this is the view from the deal's
// side — "what was said on this opportunity, and when". Summarizing no
// longer needs that trip: a transcribed call is summarised by the
// app-level background pass, so this fills itself in.
//
// Renders nothing at all when the opp has no tagged calls, so it costs a
// user who doesn't use recordings a single Firestore read and no visual
// noise.

import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { loadCallRecords } from '../../utils/callRecordingsStore';
import { autoSummaryGaveUp } from '../../utils/autoSummarize';

function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const labelStyle = {
  fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.03em',
  color: 'var(--color-text-muted)', fontWeight: 600, marginBottom: '0.15rem',
};

export function LinkedCalls({ oppId }) {
  const { user } = useAuth();
  const [calls, setCalls] = useState([]);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    const uid = user?.uid;
    let cancelled = false;
    (async () => {
      if (!uid || !oppId) {
        if (!cancelled) setCalls([]);
        return;
      }
      const stored = await loadCallRecords(uid);
      if (cancelled) return;
      const mine = Object.values(stored)
        .filter(r => String(r?.oppId || '') === String(oppId))
        .sort((a, b) => String(b.recordedAt || b.createdAt || '').localeCompare(String(a.recordedAt || a.createdAt || '')));
      setCalls(mine);
    })();
    return () => { cancelled = true; };
  }, [user?.uid, oppId]);

  if (calls.length === 0) return null;

  return (
    <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--color-border-light)' }}>
      <div style={{ ...labelStyle, marginBottom: '0.4rem' }}>
        Calls ({calls.length})
      </div>
      {calls.map((c) => {
        const open = expanded === c.id;
        const when = fmtWhen(c.recordedAt || c.createdAt);
        return (
          <div
            key={c.id}
            style={{
              border: '1px solid var(--color-border-light)',
              borderRadius: 4,
              padding: '0.5rem 0.6rem',
              marginBottom: '0.4rem',
              background: 'var(--color-bg)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600, fontSize: '0.82rem' }}>{c.name || 'Recording'}</span>
              {when && <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>{when}</span>}
              {c.sentiment && (
                <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'capitalize' }}>
                  · {c.sentiment}
                </span>
              )}
              {(c.summary || c.transcript) && (
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : c.id)}
                  style={{
                    marginLeft: 'auto', padding: '0.15rem 0.5rem',
                    background: 'transparent', border: '1px solid var(--color-border)',
                    borderRadius: 4, fontSize: '0.72rem', fontFamily: 'inherit',
                    color: 'var(--color-text-muted)', cursor: 'pointer',
                  }}
                >{open ? 'Hide' : 'Details'}</button>
              )}
            </div>

            {c.summary && (
              <p style={{
                margin: '0.35rem 0 0', fontSize: '0.8rem', lineHeight: 1.5,
                color: 'var(--color-text)',
                // Collapsed, the summary is a two-line teaser; expanded it
                // shows in full alongside the items below.
                ...(open ? {} : {
                  display: '-webkit-box', WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }),
              }}>{c.summary}</p>
            )}

            {open && (
              <>
                {c.nextSteps && (
                  <p style={{ margin: '0.4rem 0 0', fontSize: '0.8rem', lineHeight: 1.5 }}>
                    <strong>Next step:</strong> {c.nextSteps}
                  </p>
                )}
                {c.keyItems?.length > 0 && (
                  <>
                    <div style={{ ...labelStyle, marginTop: '0.5rem' }}>Key items</div>
                    <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.8rem', lineHeight: 1.5 }}>
                      {c.keyItems.map((k, i) => <li key={i}>{k}</li>)}
                    </ul>
                  </>
                )}
                {c.followUps?.length > 0 && (
                  <>
                    <div style={{ ...labelStyle, marginTop: '0.5rem' }}>Follow-ups</div>
                    <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.8rem', lineHeight: 1.5 }}>
                      {c.followUps.map((f, i) => (
                        <li key={i}>
                          {f.text}
                          {f.owner && <span style={{ color: 'var(--color-text-muted)' }}>: {f.owner}</span>}
                          {f.due && <span style={{ color: 'var(--color-text-muted)' }}> ({f.due})</span>}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {!c.summary && c.transcript && (
                  <p style={{ margin: '0.4rem 0 0', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                    {autoSummaryGaveUp(c)
                      ? `Couldn’t be summarized automatically${c.autoSummaryError ? `: ${String(c.autoSummaryError).replace(/[.\s]+$/, '')}` : ''}. Open the Call Recordings page and run Summarize to try again.`
                      : 'Transcribed. The summary is written automatically within the hour — or run Summarize on the Call Recordings page now.'}
                  </p>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default LinkedCalls;

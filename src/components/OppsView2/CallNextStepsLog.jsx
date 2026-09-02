// "Call Notes" — the Opp details subtab where every call's next steps are
// logged over time.
//
// The Activity tab's Calls section answers "what was said on this
// opportunity": each call, its summary, its details on demand. This
// answers the other half of that question — "what did we say we'd DO, and
// when did we say it" — as one continuous list down the deal's history.
//
// It reads the call records rather than the opp's Next Steps field. The
// checklist is a merged, edited, ticked-off working list; the records
// keep each call's own follow-ups unchanged forever. So a step finished
// and deleted from the checklist in March is still here under the call
// that raised it, which is the whole point of a log.
//
// Same lines the push onto the checklist adds, through the same helper,
// so the log can never disagree with what landed.

import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { loadCallRecordsResult } from '../../utils/callRecordingsStore';
import { describeReadFailure } from '../../utils/callStoreError';
import { callNextStepsLog, callNextStepsSummary } from '../../utils/callNextStepsLog';
import { NOTE_LINEBREAK } from '../../utils/nextSteps';

function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const labelStyle = {
  fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em',
  color: 'var(--color-text-muted)', fontWeight: 700,
};

const emptyStyle = {
  padding: '0.75rem 0.85rem', border: '1px dashed var(--color-border)', borderRadius: 6,
  fontSize: '0.8rem', lineHeight: 1.5, color: 'var(--color-text-muted)',
};

/** One call, and what it said to do next. */
function LogEntry({ entry, last }) {
  const when = fmtWhen(entry.at);
  return (
    <div style={{ display: 'flex', gap: '0.6rem' }}>
      {/* The spine: a dot per call and a line joining them, so a run of
          entries reads as one timeline rather than as separate cards. */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, paddingTop: 4 }}>
        <span style={{
          width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
          background: entry.steps.length > 0 ? '#7C3AED' : 'var(--color-border)',
        }} />
        {!last && <span style={{ flex: 1, width: 1, background: 'var(--color-border)', marginTop: 2 }} />}
      </div>

      <div style={{ flex: 1, minWidth: 0, paddingBottom: last ? 0 : '0.85rem' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.83rem', fontWeight: 600, color: 'var(--color-text)' }}>{entry.name}</span>
          <span style={{ fontSize: '0.73rem', color: '#64748B' }}>{when || 'No date'}</span>
          {entry.url && (
            <a
              href={entry.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: '0.71rem', color: '#1D4ED8', textDecoration: 'underline' }}
            >Open in Granola ↗</a>
          )}
        </div>

        {entry.steps.length > 0 ? (
          <ul style={{
            margin: '0.25rem 0 0', paddingLeft: '1.1rem',
            fontSize: '0.81rem', lineHeight: 1.5, color: 'var(--color-text)',
          }}>
            {entry.steps.map((line, i) => (
              // Steps carry their own internal newlines as U+2028 so a
              // multi-line follow-up stays one step; put them back for
              // display rather than running the lines together.
              <li key={i} style={{ whiteSpace: 'pre-wrap' }}>{line.split(NOTE_LINEBREAK).join('\n')}</li>
            ))}
          </ul>
        ) : (
          <div style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
            {entry.summarized
              ? 'No follow-ups came out of this call.'
              : 'Not summarized yet — run Summarize on the Call Recordings page and its follow-ups will appear here.'}
          </div>
        )}
      </div>
    </div>
  );
}

export function CallNextStepsLog({ oppId }) {
  const { user } = useAuth();
  const uid = user?.uid;
  const [state, setState] = useState({ status: 'loading', entries: [], error: '' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!uid || !oppId) {
        if (!cancelled) setState({ status: 'ready', entries: [], error: '' });
        return;
      }
      setState(s => ({ ...s, status: 'loading' }));
      const { records, ok, error, code } = await loadCallRecordsResult(uid);
      if (cancelled) return;
      // A failed read comes back as no records, which renders identically
      // to a deal nobody has recorded a call on. Saying which is the
      // difference between "there's nothing here" and "we couldn't look".
      if (!ok) {
        const failure = describeReadFailure({ ok, error, code });
        setState({
          status: 'error', entries: [],
          error: `Couldn’t read the call history: ${error}${failure ? ` ${failure.advice}` : ''}`,
        });
        return;
      }
      setState({ status: 'ready', entries: callNextStepsLog(records, oppId), error: '' });
    })();
    return () => { cancelled = true; };
  }, [uid, oppId]);

  if (state.status === 'loading') {
    return <div style={{ ...emptyStyle, border: 'none' }}>Reading the call history…</div>;
  }
  if (state.status === 'error') {
    return (
      <div style={{
        padding: '0.6rem 0.8rem', border: '1px solid #FCA5A5', borderRadius: 6,
        background: '#FEF2F2', color: '#B91C1C', fontSize: '0.79rem', lineHeight: 1.5,
      }}>{state.error}</div>
    );
  }
  if (state.entries.length === 0) {
    return (
      <div style={emptyStyle}>
        No call recordings are mapped to this deal yet. Tag one from{' '}
        <strong>Calls to map</strong> above the opps table, or on the Call Recordings page —
        its follow-ups land on this deal’s Next Steps and are logged here.
      </div>
    );
  }

  const { calls, steps, unsummarized } = callNextStepsSummary(state.entries);

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap',
        marginBottom: '0.6rem',
      }}>
        <span style={labelStyle}>Next steps from calls</span>
        <span style={{ fontSize: '0.73rem', color: 'var(--color-text-muted)' }}>
          {steps} step{steps === 1 ? '' : 's'} across {calls} call{calls === 1 ? '' : 's'}
        </span>
        {unsummarized > 0 && (
          <span
            title="These calls are mapped to this deal but have never been summarized, so whatever was agreed on them is still sitting in a transcript."
            style={{
              fontSize: '0.7rem', fontWeight: 600, color: '#92400E',
              background: '#FFFBEB', border: '1px solid #FDE68A',
              borderRadius: 999, padding: '0.05rem 0.45rem',
            }}
          >{unsummarized} not summarized</span>
        )}
      </div>

      {state.entries.map((entry, i) => (
        <LogEntry key={entry.id} entry={entry} last={i === state.entries.length - 1} />
      ))}
    </div>
  );
}

export default CallNextStepsLog;

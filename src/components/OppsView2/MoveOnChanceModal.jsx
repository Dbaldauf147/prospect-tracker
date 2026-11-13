import { useEffect, useMemo } from 'react';
import { DataTable } from '../common/DataTable';
import { stintsBehind, MOVE_ON_MIN_N } from '../../utils/moveOnChance';
import { MIN_TRAINING } from '../../utils/closeLikelihood';
import { toISODate } from '../../utils/oppsCallIn';

// The popup behind the Opps table's "Chance of moving on" cell: how the
// figure was worked out, step by step, and the past deals it was read off.
// Same reading as Opps > Close Rates > 6 (see utils/moveOnChance).
//
// Styled inline, like the other popups this folder opens (see
// PricingAnalysisModal); the view's CSS module carries no modal vocabulary.

const muted = { color: 'var(--color-text-muted)' };
const fmtPct = (v) => (v == null ? '-' : `${Math.round(v)}%`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const fmtDay = (iso) => {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const stepRow = { display: 'flex', gap: 10, alignItems: 'baseline', padding: '5px 0' };
const stepNum = {
  flexShrink: 0, width: 20, height: 20, borderRadius: '50%', display: 'inline-flex',
  alignItems: 'center', justifyContent: 'center', fontSize: '0.68rem', fontWeight: 700,
  background: 'var(--color-accent)', color: '#fff',
};
const sectionHead = {
  fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
  color: 'var(--color-text-muted)', margin: '14px 0 4px',
};

export function MoveOnChanceModal({ scored, prog, model, settings, updateSettings, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const behind = useMemo(() => (scored ? stintsBehind(prog, scored.stage, scored.days) : null), [scored, prog]);
  const rows = useMemo(() => (behind?.stints || []).map((s, i) => ({ ...s, id: `${s.r?._id ?? 'x'}-${s.exitedAt}-${i}` })), [behind]);
  const columns = useMemo(() => [
    { key: 'account', label: 'Account', defaultWidth: 200, getFilterValue: (s) => String(s.r?.Account || '').trim(), exportValue: (s) => String(s.r?.Account || '').trim(), render: (s) => String(s.r?.Account || '').trim() || '-' },
    { key: 'scope', label: 'Scope', defaultWidth: 180, getFilterValue: (s) => String(s.r?.Scope || ''), exportValue: (s) => String(s.r?.Scope || ''), render: (s) => s.r?.Scope || '-' },
    { key: 'days', label: `Days in ${scored?.stage || 'stage'}`, defaultWidth: 110, getSortValue: (s) => s.days, getFilterValue: (s) => String(s.days), exportValue: (s) => s.days, render: (s) => s.days },
    { key: 'left', label: 'Left stage on', defaultWidth: 120, getSortValue: (s) => s.exitedAt || '', getFilterValue: (s) => fmtDay(s.exitedAt), exportValue: (s) => s.exitedAt, render: (s) => fmtDay(s.exitedAt) || '-' },
    { key: 'next', label: 'Went to', defaultWidth: 120, getFilterValue: (s) => s.next, exportValue: (s) => s.next, render: (s) => s.next || '-' },
    {
      key: 'moved', label: 'Moved on?', defaultWidth: 100,
      getSortValue: (s) => (s.progressed ? 1 : 0), getFilterValue: (s) => (s.progressed ? 'Yes' : 'No'), exportValue: (s) => (s.progressed ? 'Yes' : 'No'),
      render: (s) => <span style={{ fontWeight: 600, color: s.progressed ? '#15803D' : '#B91C1C' }}>{s.progressed ? 'Yes' : 'No'}</span>,
    },
    { key: 'silence', label: 'Days since heard from', defaultWidth: 150, getSortValue: (s) => s.silence ?? -1, getFilterValue: (s) => (s.silence == null ? '' : String(s.silence)), exportValue: (s) => s.silence ?? '', render: (s) => (s.silence == null ? <span style={muted}>-</span> : s.silence) },
  ], [scored?.stage]);

  if (!scored) return null;
  const o = scored;
  const account = String(o.r?.Account || '').trim() || 'this opp';
  const enteredIso = toISODate(o.r?._stageEnteredAt);
  const startIso = toISODate(o.r?.['Start Date']);
  const sinceText = enteredIso
    ? `it entered ${o.stage} on ${fmtDay(enteredIso)}`
    : `no stage entry date is logged, so it counts from the Start Date (${fmtDay(startIso)})`;
  const few = o.n > 0 && o.n < MOVE_ON_MIN_N;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10020,
      }}
    >
      <div
        role="dialog"
        aria-label={`Chance of moving on - ${account}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(920px, 96vw)', maxHeight: '90vh',
          background: '#fff', borderRadius: 8, boxShadow: '0 20px 50px rgba(15, 23, 42, 0.3)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          fontSize: '0.8rem', color: 'var(--color-text)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--color-border)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.95rem', fontWeight: 700 }}>Chance of moving on - {account}</div>
            {o.r?.Scope && <div style={{ ...muted, marginTop: 2 }}>{o.r.Scope}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ border: 'none', background: 'none', fontSize: '1.2rem', lineHeight: 1, cursor: 'pointer', color: 'var(--color-text-muted)' }}
          >&times;</button>
        </div>

        <div style={{ padding: '12px 16px', overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '1.8rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', opacity: few ? 0.6 : 1 }}>{o.n ? fmtPct(o.rate) : '-'}</span>
            <span>chance it moves on from <strong>{o.stage}</strong> to <strong>{o.next}</strong> or later</span>
          </div>
          {few && <div style={{ color: '#B45309', marginTop: 2 }}>Only {plural(o.n, 'past deal')} to go on, so read this with care.</div>}

          <div style={sectionHead}>How it was worked out</div>
          <div style={stepRow}>
            <span style={stepNum}>1</span>
            <span>It is in <strong>{o.stage}</strong> and has been for <strong>{plural(o.days, 'day')}</strong> ({sinceText}).</span>
          </div>
          <div style={stepRow}>
            <span style={stepNum}>2</span>
            <span>
              {o.days} days falls in the <strong>{o.band}</strong> band, so we look at every past deal that sat in {o.stage} for <strong>at least {plural(behind.min, 'day')}</strong> before leaving it:
              {' '}<strong>{plural(o.n, 'deal')}</strong>.
            </span>
          </div>
          <div style={stepRow}>
            <span style={stepNum}>3</span>
            <span>
              {o.n
                ? <>Of those, <strong>{behind.moved}</strong> moved on to a later stage. {behind.moved} / {o.n} = <strong>{fmtPct(o.rate)}</strong>.</>
                : <>No past deal stayed in {o.stage} that long, so there is nothing to read a chance off yet.</>}
              {' '}<span style={muted}>Going back a stage or Not Sold counts as not moving on; a sideways move (Quoted to Repricing) counts as neither.</span>
            </span>
          </div>

          <div style={sectionHead}>Other reads on the same deal</div>
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
            <li>
              <strong>By days since heard from:</strong>{' '}
              {o.silence == null
                ? <span style={muted}>no Last Client Heard From Us date on this opp.</span>
                : o.silenceN
                  ? <>last heard from {plural(o.silence, 'day')} ago ({o.silenceBand}); of {plural(o.silenceN, 'past deal')} in {o.stage} that went at least that long without hearing back, <strong>{fmtPct(o.silenceRate)}</strong> moved on.</>
                  : <>last heard from {plural(o.silence, 'day')} ago; no past deal in {o.stage} went that long without hearing back.</>}
            </li>
            <li>
              <strong>Model:</strong>{' '}
              {o.moveOn == null
                ? <span style={muted}>needs {MIN_TRAINING}+ past stage moves with both outcomes to learn from ({prog?.stints?.length || 0} so far).</span>
                : <><strong>{fmtPct(o.moveOn * 100)}</strong>, from a model of {model?.trainedOn} past stage moves that weighs the stage, days in stage (read separately for each stage, since a long wait is normal in some and a bad sign in others), days since heard from and the opp&apos;s age by how much each mattered before.</>}
            </li>
          </ul>

          <div style={sectionHead}>Likelihood to close</div>
          {o.likelihood == null ? (
            <div style={muted}>
              Needs {MIN_TRAINING}+ past stage moves with both outcomes to learn from ({prog?.stints?.length || 0} so far).
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: '1.4rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                  color: o.likelihood * 100 >= 40 ? '#15803D' : o.likelihood * 100 >= 15 ? '#B45309' : '#B91C1C',
                }}>{fmtPct(o.likelihood * 100)}</span>
                <span>chance it goes all the way to <strong>Sold</strong></span>
              </div>
              <div style={{ ...muted, margin: '2px 0 4px' }}>
                The model&apos;s chance it moves on from {o.stage} now, times each later stage&apos;s usual moved-on rate up to Sold.
              </div>
              {o.steps.map((st, i) => (
                <div key={st.stage} style={stepRow}>
                  <span style={stepNum}>{i ? 'x' : i + 1}</span>
                  <span>
                    {st.stage} to {st.next}: <strong>{fmtPct(st.chance * 100)}</strong>{' '}
                    <span style={muted}>{st.from === 'model' ? '(model, for this deal now)' : `(usual rate: ${(() => { const s = prog?.stages?.find(x => x.stage === st.stage); return s?.stints ? `${s.progressed} of ${s.stints} past deals moved on` : 'no history, pooled rate of all stages'; })()})`}</span>
                  </span>
                </div>
              ))}
              <div style={stepRow}>
                <span style={stepNum}>=</span>
                <span>{o.steps.map(st => fmtPct(st.chance * 100)).join(' x ')} = <strong>{fmtPct(o.likelihood * 100)}</strong> to close</span>
              </div>
              {o.n > 0 && Math.abs(o.rate - o.moveOn * 100) >= 15 && (
                <div style={{ marginTop: 6, padding: '8px 10px', borderRadius: 6, background: '#FEF3C7', color: '#78350F', lineHeight: 1.5 }}>
                  <strong>Why this is not {fmtPct(o.rate)}:</strong> the {fmtPct(o.rate)} at the top is a straight count of the{' '}
                  {plural(o.n, 'past deal')} that sat in {o.stage} at least {plural(behind.min, 'day')}. This figure starts from the model
                  instead ({fmtPct(o.moveOn * 100)}), which learns from all {model?.trainedOn} past stage moves and also weighs days since
                  heard from and the opp&apos;s age. A count of {o.n < 20 ? 'so few deals' : 'one stage'} can swing a lot on a single deal;
                  the model is steadier but can miss what is particular to this one stage. When the two are far apart, treat the true
                  chance as somewhere between them.
                </div>
              )}
            </>
          )}

          <div style={sectionHead}>The {plural(o.n, 'past deal')} behind the {fmtPct(o.rate)}</div>
          <div style={muted}>
            Read from the stage history of every opp, stints that ended at any time; pull-throughs left out. The same history drives Close Rates &gt; 6.
          </div>
          {rows.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', height: Math.min(420, 132 + rows.length * 37), marginTop: 6 }}>
              <DataTable
                tableId="opps2-move-on-behind"
                columns={columns}
                rows={rows}
                alwaysVisible={['account']}
                defaultSort={{ key: 'days', direction: 'desc' }}
                emptyMessage="No past deals."
                exportFileName={`Chance of moving on - ${account}`}
                settings={settings}
                updateSettings={updateSettings}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

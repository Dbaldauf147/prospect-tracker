// "What does delivering this deal look like, starting today?"
//
// The Notes and Update Status popups already know the deal's Scope. The
// Timelines page already knows each service's plan, and the Services page
// already knows which services have to be rolled out before which. This
// puts the three together on one chart: a band per service, sequenced by
// its dependencies, kicked off this month.
//
// The composition lives in utils/dealTimeline; the chart and the workbook
// are the Timelines page's own renderers, handed the composed template. So
// a change to how a timeline draws lands here too, and the Excel that comes
// out of this popup is the same Excel the Timelines page produces.
import { useMemo, useState } from 'react';
import { buildDealTimeline } from '../../utils/dealTimeline';
import { getTimelineTemplates } from '../../utils/timelineTemplatesStore';
import { buildTimelineSvg, TIMELINE_FORMATS } from '../../utils/timelineGraphic';
import { currentMonthAnchor } from '../../utils/timelineDates';
import { exportTimelineXlsx } from '../../utils/timelineXlsx';

const btnStyle = {
  padding: '0.35rem 0.7rem', borderRadius: 4, fontSize: '0.78rem', fontFamily: 'inherit',
  border: '1px solid var(--color-border)', background: '#fff', color: 'var(--color-text)',
  cursor: 'pointer', whiteSpace: 'nowrap',
};

// Why a band is the length it is. A plan whose bars came from three
// different places should say which is which — a bar sized from a Rollout
// Time is a much weaker claim than one drawn from an authored timeline, and
// a placeholder is barely a claim at all.
const SOURCE_NOTE = {
  template: (s) => `From the “${s.templateName}” timeline`,
  rollout: () => 'No timeline attached — sized from the service’s Rollout Time',
  unknown: () => 'No timeline and no Rollout Time — shown as one month as a placeholder',
};

export function DealTimelineModal({ account = '', scopeServices = [], settings, serviceOverrides, onClose }) {
  const [format, setFormat] = useState('phased');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Kickoff is this month, so month 1 is the month we're in and the
  // renderers put their today marker in the first column.
  const anchorMonth = useMemo(() => currentMonthAnchor(), []);
  const templates = useMemo(() => getTimelineTemplates(settings), [settings]);
  const plan = useMemo(() => buildDealTimeline({
    scopeServices,
    templates,
    serviceOverrides,
    anchorMonth,
    name: account ? `${account} — rollout` : 'Deal rollout',
    clientName: account,
  }), [scopeServices, templates, serviceOverrides, anchorMonth, account]);

  // The format switch only changes how the same plan is drawn, so it lives
  // here rather than in the composer.
  const template = useMemo(() => ({ ...plan.template, format }), [plan.template, format]);
  const svg = useMemo(() => {
    try { return buildTimelineSvg(template, { branded: true }); }
    catch (err) { console.error('Deal timeline render failed', err); return ''; }
  }, [template]);

  const prerequisites = plan.services.filter(s => !s.inScope);
  const weak = plan.services.filter(s => s.source !== 'template');
  const multi = plan.services.filter(s => s.extraTemplates.length > 0);

  async function handleExcel() {
    setBusy(true);
    setError('');
    try {
      await exportTimelineXlsx(template);
    } catch (err) {
      console.error('Deal timeline Excel export failed', err);
      setError(`Could not build the workbook: ${err?.message || 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        // Above both popups this opens from.
        zIndex: 10020,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }}
        style={{
          width: 'min(1360px, 96vw)', maxHeight: '94vh',
          background: '#fff', borderRadius: 8, boxShadow: '0 20px 50px rgba(15, 23, 42, 0.3)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{
          padding: '0.85rem 1rem', borderBottom: '1px solid var(--color-border-light)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem',
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Rollout timeline{account ? `: ${account}` : ''}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
              {plan.services.length === 0
                ? 'Nothing in this deal’s Scope to plan.'
                : <>
                    Kickoff this month · {plan.services.length} service{plan.services.length === 1 ? '' : 's'}
                    {prerequisites.length > 0 && <> ({prerequisites.length} pulled in as prerequisite{prerequisites.length === 1 ? '' : 's'})</>}
                    {/* The plan's own length, not the chart's — the window
                        carries an extra column so trailing step labels have
                        somewhere to go, and reporting that would overstate
                        the work by a month. The axis shows the dates. */}
                    {plan.monthsNeeded > 0 && <> · {plan.monthsNeeded} month{plan.monthsNeeded === 1 ? '' : 's'} to deliver</>}
                  </>}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              title="How the plan is drawn. The Excel follows the same choice."
              style={{ ...btnStyle, padding: '0.35rem 0.4rem' }}
            >
              {TIMELINE_FORMATS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
            <button
              type="button"
              onClick={handleExcel}
              disabled={busy || plan.services.length === 0}
              title="Download this plan as a Schneider-formatted workbook"
              style={{ ...btnStyle, opacity: (busy || plan.services.length === 0) ? 0.55 : 1 }}
            >{busy ? 'Building…' : '⬇ Excel'}</button>
            <button type="button" onClick={onClose} style={btnStyle}>Close</button>
          </div>
        </div>

        <div style={{ padding: '0.85rem 1rem', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
          {error && (
            <div style={{ padding: '0.5rem 0.7rem', background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 4, fontSize: '0.8rem', color: '#991B1B' }}>
              {error}
            </div>
          )}

          {/* A plan built on guesses should say so before the chart, not
              after — the chart looks equally confident either way. */}
          {plan.cycleBroken && (
            <div style={{ padding: '0.5rem 0.7rem', background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 4, fontSize: '0.78rem', color: '#92400E' }}>
              These services depend on each other in a loop, so there’s no order that satisfies every
              dependency. The loop was broken at one service to lay the rest out — fix the Dependent
              Rollout Services on Dropdowns › Services and this will sequence properly.
            </div>
          )}
          {weak.length > 0 && (
            <div style={{ padding: '0.5rem 0.7rem', background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 4, fontSize: '0.78rem', color: '#92400E' }}>
              {weak.length === 1 ? 'One service has' : `${weak.length} services have`} no timeline attached
              on Dropdowns › Timelines, so {weak.length === 1 ? 'its band is' : 'their bands are'} sized from
              Rollout Time rather than a real plan: {weak.map(s => s.name).join(', ')}.
            </div>
          )}
          {multi.length > 0 && (
            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
              {multi.map(s => `${s.name} has ${s.extraTemplates.length + 1} timelines attached — using “${s.templateName}”`).join(' · ')}.
            </div>
          )}

          {plan.services.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
              This deal’s Scope doesn’t name any services yet. Fill in Scope and the rollout plan builds itself.
            </div>
          ) : (
            <>
              <div style={{ overflow: 'auto', border: '1px solid var(--color-border-light)', borderRadius: 4, background: '#fff' }}>
                {svg
                  ? <div style={{ minWidth: 'min-content' }} dangerouslySetInnerHTML={{ __html: svg }} />
                  : <div style={{ padding: '1.5rem', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
                      This plan can’t be drawn in the {format} format. Try another.
                    </div>}
              </div>

              {/* The order, in words. The chart shows when; this says why —
                  which service is waiting on what, and where each band's
                  length came from. */}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr>
                    {['Service', 'Months', 'Waits on', 'Plan'].map((h, i) => (
                      <th
                        key={h}
                        style={{
                          textAlign: i === 1 ? 'right' : 'left', padding: '0.3rem 0.4rem',
                          borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap',
                          fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase',
                          letterSpacing: '0.03em', color: 'var(--color-text-muted)',
                        }}
                      >{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {plan.services.map(s => (
                    <tr key={s.name} style={{ borderBottom: '1px solid var(--color-border-light)' }}>
                      <td style={{ padding: '0.3rem 0.4rem' }}>
                        {s.name}
                        {!s.inScope && (
                          <span
                            title="Not in this deal’s Scope — pulled in because something here depends on it"
                            style={{
                              marginLeft: 6, padding: '1px 6px', borderRadius: 999, fontSize: '0.66rem',
                              fontWeight: 700, background: '#EEF2FF', color: '#3730A3', border: '1px solid #C7D2FE',
                            }}
                          >prerequisite</span>
                        )}
                      </td>
                      <td style={{ padding: '0.3rem 0.4rem', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {s.startMonth === s.endMonth ? `${s.startMonth}` : `${s.startMonth}–${s.endMonth}`}
                      </td>
                      <td style={{ padding: '0.3rem 0.4rem', color: s.dependsOn.length ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                        {s.dependsOn.length ? s.dependsOn.join(', ') : '—'}
                      </td>
                      <td style={{ padding: '0.3rem 0.4rem', color: s.source === 'template' ? 'var(--color-text)' : '#92400E' }}>
                        {(SOURCE_NOTE[s.source] || SOURCE_NOTE.unknown)(s)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

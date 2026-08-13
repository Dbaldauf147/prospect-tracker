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
  // The deal's own services only, by default. A deal whose services depend
  // on half the catalog draws mostly bands nobody sold, and the question
  // being asked here is about this opportunity. The prerequisites still set
  // the dates — hiding them takes the bands out, not the wait — and the
  // toggle brings them back when the sequencing is what's being checked.
  const [showPrerequisites, setShowPrerequisites] = useState(false);
  // 'weeks' keeps the week ticks under the month band; 'months' drops them
  // and reads a column per month. Long engagements don't need the day-level
  // scale, and past a dozen columns the week labels are too tight to print.
  const [axis, setAxis] = useState('weeks');
  // Services the user has clicked off the chart, by lowercased name. Purely a
  // presentation filter: the schedule is computed over every service first,
  // so taking a band out never lets the ones waiting on it start earlier.
  const [excluded, setExcluded] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function toggleService(name) {
    const key = String(name || '').trim().toLowerCase();
    if (!key) return;
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // Kickoff is this month, so month 1 is the month we're in and the
  // renderers put their today marker in the first column.
  const anchorMonth = useMemo(() => currentMonthAnchor(), []);
  const kickoffDate = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);
  const templates = useMemo(() => getTimelineTemplates(settings), [settings]);
  const plan = useMemo(() => buildDealTimeline({
    scopeServices,
    templates,
    serviceOverrides,
    anchorMonth,
    kickoffDate,
    // The chart's own title, which is also the Excel's. Just the account —
    // the chart is plainly a timeline without a word saying so.
    name: account || 'Timeline',
    clientName: account,
    showPrerequisites,
    excludeServices: [...excluded],
  }), [scopeServices, templates, serviceOverrides, anchorMonth, kickoffDate, account, showPrerequisites, excluded]);

  // The chart's services and the ones clicked off it, back in one list in the
  // chart's own order. Hidden services have to stay listed or there'd be
  // nothing left to click to bring them back.
  const rows = useMemo(
    () => [...plan.services, ...plan.excluded].sort((a, b) => a.order - b.order),
    [plan.services, plan.excluded],
  );

  // The format switch only changes how the same plan is drawn, so it lives
  // here rather than in the composer.
  const template = useMemo(() => ({ ...plan.template, format, axis }), [plan.template, format, axis]);
  const svg = useMemo(() => {
    try { return buildTimelineSvg(template, { branded: true }); }
    catch (err) { console.error('Deal timeline render failed', err); return ''; }
  }, [template]);

  // Only ever about the bands actually drawn: a warning naming a service
  // the user can't see is a warning about nothing.
  const prerequisites = plan.services.filter(s => !s.inScope);
  const weak = plan.services.filter(s => s.source !== 'template');
  const multi = plan.services.filter(s => s.extraTemplates.length > 0);
  // Only worth mentioning where the pin actually moved something — a
  // service with no prerequisites has its agreement at kickoff anyway.
  const pinned = plan.services.filter(s => s.pinnedAgreement && s.startMonth > 1);

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
              {plan.services.length === 0 && plan.hidden.length === 0
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
            {/* Clicking rows off one at a time needs one click to undo them
                all, or a chart hidden down to nothing is a puzzle. */}
            {plan.excluded.length > 0 && (
              <button
                type="button"
                onClick={() => setExcluded(new Set())}
                title="Draw every service again"
                style={{ ...btnStyle, background: '#EEF2FF', borderColor: '#C7D2FE', color: '#3730A3', fontWeight: 700 }}
              >Show {plan.excluded.length} hidden</button>
            )}
            {/* Shown whenever prerequisites exist, in either direction, so
                the chart never quietly omits work. */}
            {(plan.hidden.length > 0 || prerequisites.length > 0) && (
              <button
                type="button"
                onClick={() => setShowPrerequisites(v => !v)}
                title={showPrerequisites
                  ? 'Show only the services this opportunity sold. The ones they depend on still set the dates.'
                  : 'Also draw the services this deal doesn’t sell but has to wait on. They already set the dates either way.'}
                style={{
                  ...btnStyle,
                  background: showPrerequisites ? '#EEF2FF' : '#fff',
                  borderColor: showPrerequisites ? '#C7D2FE' : 'var(--color-border)',
                  color: showPrerequisites ? '#3730A3' : 'var(--color-text)',
                  fontWeight: showPrerequisites ? 700 : 400,
                }}
              >
                {showPrerequisites
                  ? `Hide ${prerequisites.length} prerequisite${prerequisites.length === 1 ? '' : 's'}`
                  : `Show ${plan.hidden.length} prerequisite${plan.hidden.length === 1 ? '' : 's'}`}
              </button>
            )}
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              title="How the plan is drawn. The Excel follows the same choice."
              style={{ ...btnStyle, padding: '0.35rem 0.4rem' }}
            >
              {TIMELINE_FORMATS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
            {/* Only the implementation format carries a week row, so this is
                the only format the choice can change anything in. */}
            {format === 'phased' && (
              <select
                value={axis}
                onChange={(e) => setAxis(e.target.value)}
                title="Weekly keeps the week ticks under each month; monthly reads one column per month. The Excel follows the same choice."
                style={{ ...btnStyle, padding: '0.35rem 0.4rem' }}
              >
                <option value="weeks">Weekly</option>
                <option value="months">Monthly</option>
              </select>
            )}
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
          {/* An agreement step sitting months ahead of the band it belongs
              to needs explaining, or it reads as a stray bar. */}
          {pinned.length > 0 && (
            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
              Agreement signed today: the contract step
              {pinned.length === 1 ? '' : 's'} on {pinned.map(s => s.name).join(', ')} sit
              {pinned.length === 1 ? 's' : ''} at kickoff rather than behind the delivery
              {pinned.length === 1 ? ' it waits' : ' they wait'} on.
            </div>
          )}
          {/* The hidden work is still in the dates. Saying so is what keeps a
              service that starts in month 6 from looking like a mistake —
              the Waits on column below names what it's waiting for. */}
          {plan.hidden.length > 0 && (
            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
              Showing this opportunity’s services only. {plan.hidden.length} service
              {plan.hidden.length === 1 ? '' : 's'} it depends on {plan.hidden.length === 1 ? 'is' : 'are'} not
              drawn but still set the start dates: {plan.hidden.map(s => s.name).join(', ')}.
            </div>
          )}

          {/* Same promise the prerequisites note makes: what's off the chart
              is still in the dates, so a band starting in month 6 with
              nothing visible before it isn't a mistake. */}
          {plan.excluded.length > 0 && (
            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
              {plan.excluded.length} service{plan.excluded.length === 1 ? '' : 's'} hidden by hand and left out of the
              chart and the Excel — still scheduled, so nothing waiting on {plan.excluded.length === 1 ? 'it' : 'them'} moved:
              {' '}{plan.excluded.map(s => s.name).join(', ')}.
            </div>
          )}

          {/* The table renders whenever the plan has any services at all —
              including when every one of them is hidden, since its rows are
              the only thing left to click to bring them back. */}
          {rows.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
              This deal’s Scope doesn’t name any services yet. Fill in Scope and the rollout plan builds itself.
            </div>
          ) : (
            <>
              <div style={{ overflow: 'auto', border: '1px solid var(--color-border-light)', borderRadius: 4, background: '#fff' }}>
                {plan.services.length === 0
                  ? <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
                      Every service is hidden. Click one in the list below — or “Show {plan.excluded.length} hidden” above — to draw it again.
                    </div>
                  : svg
                  ? <div style={{ minWidth: 'min-content' }} dangerouslySetInnerHTML={{ __html: svg }} />
                  : <div style={{ padding: '1.5rem', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
                      This plan can’t be drawn in the {format} format. Try another.
                    </div>}
              </div>

              {/* The order, in words. The chart shows when; this says why —
                  which service is waiting on what, and where each band's
                  length came from. Rows are also the hide control: a chart
                  with nothing to click can't say it's clickable, so the list
                  that names the services is where that lives. */}
              <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                Click a service to hide its band from the chart and the Excel. The dates don’t move — a hidden
                service still holds back everything that waits on it.
              </div>
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
                  {rows.map(s => {
                    const off = excluded.has(s.name.trim().toLowerCase());
                    return (
                    <tr
                      key={s.name}
                      onClick={() => toggleService(s.name)}
                      title={off
                        ? `Click to draw ${s.name} on the timeline again`
                        : `Click to hide ${s.name} from the timeline. Its dates still hold everything that waits on it.`}
                      style={{
                        borderBottom: '1px solid var(--color-border-light)',
                        cursor: 'pointer',
                        background: off ? 'var(--color-bg)' : 'transparent',
                        color: off ? 'var(--color-text-muted)' : 'inherit',
                      }}
                    >
                      <td style={{ padding: '0.3rem 0.4rem', textDecoration: off ? 'line-through' : 'none' }}>
                        {s.name}
                        {off && (
                          <span
                            title="Hidden from the chart and the Excel. Still scheduled — the services waiting on it didn’t move."
                            style={{
                              marginLeft: 6, padding: '1px 6px', borderRadius: 999, fontSize: '0.66rem',
                              fontWeight: 700, background: 'var(--color-bg)', color: 'var(--color-text-muted)',
                              border: '1px solid var(--color-border)', textDecoration: 'none', display: 'inline-block',
                            }}
                          >hidden</span>
                        )}
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
                      <td style={{ padding: '0.3rem 0.4rem', color: (off || !s.dependsOn.length) ? 'var(--color-text-muted)' : 'var(--color-text)' }}>
                        {s.dependsOn.length ? s.dependsOn.join(', ') : '—'}
                      </td>
                      <td style={{ padding: '0.3rem 0.4rem', color: off ? 'inherit' : s.source === 'template' ? 'var(--color-text)' : '#92400E' }}>
                        {(SOURCE_NOTE[s.source] || SOURCE_NOTE.unknown)(s)}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

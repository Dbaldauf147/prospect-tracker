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
import { useEffect, useMemo, useState } from 'react';
import { buildDealTimeline } from '../../utils/dealTimeline';
import { getTimelineTemplates } from '../../utils/timelineTemplatesStore';
import { buildTimelineSvg, TIMELINE_FORMATS } from '../../utils/timelineGraphic';
import { currentMonthAnchor, parseMonthAnchor, anchorPlus } from '../../utils/timelineDates';
import { exportTimelineXlsx } from '../../utils/timelineXlsx';
import { loadHiddenServices, saveHiddenServices } from '../../utils/dealTimelineHiddenStore';
import { describeServiceRef } from '../../utils/serviceStepDeps';

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

export function DealTimelineModal({
  account = '', scopeServices = [], settings, serviceOverrides, planKey = '',
  // The deal's Target Signature Date and how to change it. The date belongs
  // to the opp, not to this popup: it's a date being negotiated, it has to
  // survive the popup closing, and the Notes and Update Status screens show
  // it too. Blank means nobody has set one — the plan then reads as "if we
  // signed today" without writing that assumption down as a decision.
  signDate = '', onChangeSignDate,
  onClose,
}) {
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
  // Draw the months between today and kickoff, so the today line is on the
  // chart rather than off its left edge. Off by default: the plan is the
  // engagement, and most of the time nobody wants dead months in front of it.
  const [showRunIn, setShowRunIn] = useState(false);
  // Services the user has clicked off the chart, by lowercased name. Purely a
  // presentation filter: the schedule is computed over every service first,
  // so taking a band out never lets the ones waiting on it start earlier.
  //
  // Seeded from what this deal was left showing last time. The popup is
  // mounted fresh on every open, so reading once at mount is the whole of it.
  const [excluded, setExcluded] = useState(() => loadHiddenServices(planKey));
  useEffect(() => { saveHiddenServices(planKey, excluded); }, [planKey, excluded]);
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

  // The agreement is what starts the engagement, so the date it's signed is
  // the plan's month 1. With none set the plan reads as "if we signed this
  // now"; setting one re-dates the whole plan against the target you're
  // actually negotiating towards, and keeps it there.
  const todayISO = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);
  const setSignDate = (next) => onChangeSignDate?.(next);
  // An unset (or cleared) date falls back to today rather than drawing nothing.
  const kickoffDate = signDate || todayISO;
  const anchorMonth = useMemo(() => {
    const anchor = kickoffDate.slice(0, 7);
    return parseMonthAnchor(anchor) ? anchor : currentMonthAnchor();
  }, [kickoffDate]);
  // Trimming first-month bars back to today is right for a plan starting now
  // and wrong for one back-dated, where the early work really did happen.
  const clampBarsToToday = kickoffDate >= todayISO;
  const signLabel = useMemo(() => {
    const d = new Date(`${kickoffDate}T00:00:00`);
    return Number.isNaN(d.getTime())
      ? kickoffDate
      : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }, [kickoffDate]);
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
    clampBarsToToday,
  }), [scopeServices, templates, serviceOverrides, anchorMonth, kickoffDate, account, showPrerequisites, excluded, clampBarsToToday]);

  // The chart's services and the ones clicked off it, back in one list in the
  // chart's own order. Hidden services have to stay listed or there'd be
  // nothing left to click to bring them back.
  const rows = useMemo(
    () => [...plan.services, ...plan.excluded].sort((a, b) => a.order - b.order),
    [plan.services, plan.excluded],
  );

  // Months between the chart's first month and the one a week before today.
  // A week of margin so the today line lands inside its column rather than
  // hard against the left edge, which is the whole point of showing it.
  //
  // Zero when today is already inside the window — a plan that kicked off in
  // the past draws today already, and there's nothing to run in from.
  const runInMonths = useMemo(() => {
    const ord = (ym) => {
      const parsed = parseMonthAnchor(ym);
      return parsed ? parsed.y * 12 + (parsed.m - 1) : null;
    };
    const back = new Date(`${todayISO}T00:00:00`);
    if (Number.isNaN(back.getTime())) return 0;
    back.setDate(back.getDate() - 7);
    const from = ord(`${back.getFullYear()}-${String(back.getMonth() + 1).padStart(2, '0')}`);
    const at = ord(anchorMonth);
    if (from == null || at == null) return 0;
    return Math.max(0, at - from);
  }, [todayISO, anchorMonth]);

  // The format switch only changes how the same plan is drawn, so it lives
  // here rather than in the composer — and so does the run-in, which moves
  // the window the plan is drawn against without changing the plan. Every
  // step shifts by the months added at the front, so the work keeps the dates
  // it had; only the axis starts earlier.
  const lead = showRunIn ? runInMonths : 0;
  const template = useMemo(() => {
    const base = { ...plan.template, format, axis };
    if (!lead) return base;
    const a = anchorPlus(base.anchorMonth, -lead);
    return {
      ...base,
      anchorMonth: a ? `${a.y}-${String(a.m).padStart(2, '0')}` : base.anchorMonth,
      // Blank means "fit the steps", which still fits them once they've moved.
      monthCount: Number(base.monthCount) > 0 ? Number(base.monthCount) + lead : '',
      // The signature moves with the work it dates. Left behind it would
      // mark the first run-in column, which is a week before today, not the
      // day the contract is signed.
      signatureMonth: Number(base.signatureMonth) > 0 ? Number(base.signatureMonth) + lead : base.signatureMonth,
      stages: base.stages.map(st => ({ ...st, startMonth: (Number(st.startMonth) || 1) + lead })),
    };
  }, [plan.template, format, axis, lead]);
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
                    Kickoff {signLabel}{kickoffDate === todayISO ? ' (today)' : ''} · {plan.services.length} service{plan.services.length === 1 ? '' : 's'}
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
            {/* First control in the row because it re-dates everything to its
                right: the whole plan hangs off when the paperwork lands. */}
            <label
              title="Target date the agreement is signed. The plan starts from it, so every band and the Excel move with it — and it's saved on the opp, so it's here next time and on the Notes and Update Status popups. Unset plans from today."
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}
            >
              Target signature
              <input
                type="date"
                value={signDate}
                onChange={(e) => setSignDate(e.target.value)}
                style={{ ...btnStyle, padding: '0.3rem 0.4rem', color: 'var(--color-text)' }}
              />
            </label>
            {signDate && (
              <button
                type="button"
                onClick={() => setSignDate('')}
                title="Clear the target date and plan from today again"
                style={{ ...btnStyle, padding: '0.35rem 0.5rem' }}
              >Today</button>
            )}
            {/* Only worth offering when there are months to show: a plan that
                kicked off in the past already has today on it. */}
            {runInMonths > 0 && (
              <button
                type="button"
                onClick={() => setShowRunIn(v => !v)}
                title={showRunIn
                  ? 'Start the chart at kickoff again'
                  : `Start the chart a week before today instead of at kickoff, so the today line is on it (${runInMonths} month${runInMonths === 1 ? '' : 's'} of run-in)`}
                // Full `border` rather than borderColor: btnStyle sets the
                // shorthand, and React warns when a rerender changes one of
                // the two forms while the other is also set.
                style={{ ...btnStyle, padding: '0.35rem 0.5rem', ...(showRunIn
                  ? { background: '#EEF2FF', border: '1px solid #C7D2FE', color: '#3730A3', fontWeight: 700 }
                  : null) }}
              >{showRunIn ? 'Start at kickoff' : 'Show today'}</button>
            )}
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
              Agreement signed {signLabel}: the contract step
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
                {/* Only worth explaining where something actually waits on
                    more than one thing, which is where the distinction bites. */}
                {rows.some(s => s.waitsOn.length > 1) && (
                  <> Under <strong>Waits on</strong>, the <strong>bold</strong> prerequisite is the one setting that
                  service’s start — shortening any of the others won’t move it.</>
                )}
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
                      {/* Naming the step, where the wait has been refined to
                          one, is what explains a band that starts partway
                          through the one above it rather than after it.

                          A service starts after the LAST of its
                          prerequisites, so on a service waiting for five of
                          them only one is actually setting the date — and
                          shortening any of the others moves nothing. That one
                          is carried in bold with the month it frees this
                          service; the rest are muted. Without it, refining a
                          prerequisite that wasn't the constraint reads as the
                          refinement having been ignored. */}
                      <td style={{ padding: '0.3rem 0.4rem', color: (off || !s.dependsOn.length) ? 'var(--color-text-muted)' : 'var(--color-text)' }}>
                        {s.waitsOn.length ? s.waitsOn.map((w, i) => (
                          <span
                            key={`${w.service}-${i}`}
                            title={w.until == null ? undefined : w.governs
                              ? `Free from month ${w.until + 1} — this is what sets the start of ${s.name}. Shortening any other prerequisite won't move it.`
                              : `Free from month ${w.until + 1}, which is earlier than ${s.name} can start, so this one isn't the constraint.`}
                            style={{
                              fontWeight: !off && w.governs && s.waitsOn.length > 1 ? 700 : 400,
                              color: off || w.governs ? 'inherit' : 'var(--color-text-muted)',
                            }}
                          >
                            {i > 0 && <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>, </span>}
                            {describeServiceRef(w.service, w.stepName)}
                            {/* Which step of THIS service is the one waiting.
                                Without saying so the row reads as though the
                                whole band waits, when the point of an anchor
                                is that only part of it does. */}
                            {w.localStepName && (
                              <span
                                title={`Only ${w.localStepName} waits on this. Everything before it in ${s.name} runs alongside ${w.service}.`}
                                style={{ color: 'var(--color-text-muted)' }}
                              > → {w.localStepName}</span>
                            )}
                            {w.stale && (
                              <span
                                title={`This waits on a step of ${w.service} that no longer exists, so it is planned after the whole service. Re-pick the step on Dropdowns › Services.`}
                                style={{ marginLeft: 4, color: '#92400E', fontWeight: 700 }}
                              >(step missing)</span>
                            )}
                            {w.localStale && (
                              <span
                                title={`This is anchored to a step of ${s.name} that no longer exists, so the whole band waits. Re-pick the step on Dropdowns › Services.`}
                                style={{ marginLeft: 4, color: '#92400E', fontWeight: 700 }}
                              >(anchor missing)</span>
                            )}
                          </span>
                        )) : '—'}
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

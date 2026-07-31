import { useMemo, useState, useEffect, useId } from 'react';
import {
  TIMELINE_STAGE_OWNERS,
  DEFAULT_STAGE_OWNER,
  TIMELINE_STAGE_KINDS,
  DEFAULT_STAGE_KIND,
  STAGE_KIND_LABELS,
  getTimelineTemplates,
  makeTimelineId,
  summarizeStageOwners,
  shortOwnerLabel,
} from '../../utils/timelineTemplatesStore';
import { buildTimelineSvg, STAGE_ICONS, TIMELINE_FORMATS } from '../../utils/timelineGraphic';
import { getStageRange, getStageMonths, currentMonthAnchor } from '../../utils/timelineDates';
import { openTimelineReport, downloadTimelineSvg, downloadTimelinePng } from '../../utils/timelineExport';
import { exportTimelineXlsx } from '../../utils/timelineXlsx';
import styles from './DropdownsView.module.css';

// Which pill style each owner gets. Keeps the owner readable at a glance
// when scanning a long stage table for the hand-offs.
// Month-count choices for the implementation format. "Auto" (blank) fits the
// steps, with a floor of 12 so a short timeline still reads as a year.
const MONTH_COUNT_OPTIONS = [3, 6, 9, 12, 18, 24, 36];

const OWNER_PILL_CLASS = {
  'Schneider Electric': styles.ownerPillSe,
  'Client': styles.ownerPillClient,
  'Both': styles.ownerPillBoth,
};

// Text field that holds a local draft so typing is instant and only tells
// the parent on commit (blur / Enter) — one settings write per edit, not per
// keystroke. Escape reverts. Same contract as the option rows on the Lists
// tab so the whole page feels alike.
function DraftInput({ value, onCommit, placeholder, className, style, title, multiline }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  function commit() {
    const trimmed = draft.trim();
    if (trimmed === value) return;
    onCommit(trimmed);
  }
  const shared = {
    value: draft,
    placeholder,
    title,
    className,
    style,
    onChange: (e) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e) => {
      if (e.key === 'Enter' && (!multiline || !e.shiftKey)) { e.preventDefault(); e.currentTarget.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); setDraft(value); e.currentTarget.blur(); }
    },
  };
  return multiline ? <textarea rows={1} {...shared} /> : <input type="text" {...shared} />;
}

// Small numeric cell for the implementation format's Month / Span. Blank
// means "work it out from the dates", so an empty string is a real value
// here rather than a zero.
function NumberCell({ value, onCommit, min = 1, placeholder, title }) {
  const asText = value === '' || value == null ? '' : String(value);
  const [draft, setDraft] = useState(asText);
  // Re-sync during render rather than in an effect: adjusting state when a
  // prop changes is a render-phase job, and an effect here would cost an
  // extra render pass on every keystroke elsewhere in the row.
  const [lastValue, setLastValue] = useState(asText);
  if (asText !== lastValue) {
    setLastValue(asText);
    setDraft(asText);
  }
  function commit() {
    const raw = draft.trim();
    if (raw === '') { if (asText !== '') onCommit(''); return; }
    const n = Math.max(min, Math.floor(Number(raw)));
    if (!Number.isFinite(n)) { setDraft(asText); return; }
    if (String(n) !== asText) onCommit(n);
  }
  return (
    <input
      type="number"
      min={min}
      value={draft}
      placeholder={placeholder}
      title={title}
      className={styles.numberCell}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); setDraft(asText); e.currentTarget.blur(); }
      }}
    />
  );
}

// One stage inside a timeline. Text cells commit on blur; the selects commit
// immediately since there's no half-typed state to protect. The arrows move
// the stage within its timeline — order is the sequence the work happens in,
// and in the implementation format it's also the step numbering. Which
// columns appear follows the timeline's format, so each layout shows only
// the controls that drive it.
function StageRow({ index, total, stage, format, mode, priorSteps, onChange, onMove, onRemove }) {
  // Effective calendar range: the explicit dates when set, otherwise whatever
  // the Timing text parses to. `auto` means nothing was typed into the date
  // cells — they're mirroring the label.
  const range = getStageRange(stage);
  const auto = !!range && range.derivedStart && range.derivedEnd;
  // Placeholder values for the Month / Span cells: what the renderer would
  // work out on its own, so a blank cell shows what it's actually doing.
  const months = getStageMonths(stage, null, mode);
  const byDates = mode === 'dates';
  return (
    <tr>
      <td className={styles.stageOrderCell}>{index + 1}</td>
      <td>
        <DraftInput
          value={stage.name}
          placeholder="Stage name"
          className={styles.stageInput}
          onCommit={(next) => onChange({ ...stage, name: next })}
        />
      </td>
      <td>
        <select
          value={stage.owner}
          onChange={(e) => onChange({ ...stage, owner: e.target.value })}
          title="Who owns this stage?"
          className={`${styles.ownerSelect} ${OWNER_PILL_CLASS[stage.owner] || ''}`}
        >
          {TIMELINE_STAGE_OWNERS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </td>
      {format === 'milestone' && (
        <td>
          <select
            value={stage.icon || 'number'}
            onChange={(e) => onChange({ ...stage, icon: e.target.value })}
            title="Marker artwork on the visual"
            className={styles.iconSelect}
          >
            {STAGE_ICONS.map(i => <option key={i.key} value={i.key}>{i.label}</option>)}
          </select>
        </td>
      )}
      {format === 'phased' && (
        <>
          <td>
            {/* Timeline (a duration, drawn as a bar) vs Milestone (a moment,
                drawn as a diamond in its start month). */}
            <select
              value={stage.kind || DEFAULT_STAGE_KIND}
              onChange={(e) => onChange({ ...stage, kind: e.target.value })}
              title="Timeline spans its months as a bar; Milestone marks a single month with a diamond"
              className={styles.ownerSelect}
            >
              {TIMELINE_STAGE_KINDS.map(k => (
                <option key={k} value={k}>{STAGE_KIND_LABELS[k]}</option>
              ))}
            </select>
          </td>
          <td>
            <DraftInput
              value={stage.phase}
              placeholder="Phase / stage band"
              title="Steps sharing a phase name are grouped into one band"
              className={styles.stageInput}
              onCommit={(next) => onChange({ ...stage, phase: next })}
            />
          </td>
          <td className={`${styles.stageDatesCell} ${byDates ? '' : styles.inactiveCell}`}>
            <input
              type="date"
              className={styles.dateInput}
              value={range?.start || ''}
              onChange={(e) => onChange({ ...stage, start: e.target.value })}
              title={byDates
                ? 'Start date — drives where this step sits on the chart'
                : 'Start date (the chart is positioned by month numbers)'}
            />
            <span className={styles.dateSep}>→</span>
            <input
              type="date"
              className={styles.dateInput}
              value={range?.end || ''}
              onChange={(e) => onChange({ ...stage, end: e.target.value })}
              title={byDates
                ? 'End date — drives how wide the bar is'
                : 'End date (the chart is positioned by month numbers)'}
            />
            {auto && (
              <span className={styles.autoTag} title="Read from the Timing column. Pick a date to override; clear it to go back to automatic.">auto</span>
            )}
            {!range && (
              <span className={styles.undatedTag} title="Without dates this step falls back to month 1. Give it dates, or position by months.">no date</span>
            )}
          </td>
          <td className={`${styles.monthCell} ${byDates ? styles.inactiveCell : ''}`}>
            <NumberCell
              value={stage.startMonth}
              placeholder={String(months.month)}
              title={byDates
                ? 'Not in use — the chart is positioned by dates'
                : 'Month from kickoff. Blank uses the stage\'s dates.'}
              onCommit={(next) => onChange({ ...stage, startMonth: next })}
            />
            <span className={styles.dateSep}>×</span>
            <NumberCell
              value={stage.months}
              placeholder={String(months.span)}
              title={byDates
                ? 'Not in use — the chart is positioned by dates'
                : 'How many months the bar spans'}
              onCommit={(next) => onChange({ ...stage, months: next })}
            />
          </td>
          <td>
            <select
              value={stage.dependsOn || ''}
              onChange={(e) => onChange({ ...stage, dependsOn: e.target.value })}
              title="The earlier step this one waits on"
              className={styles.dependsSelect}
            >
              <option value="">—</option>
              {priorSteps.map(p => (
                <option key={p.id} value={p.id}>{p.number}. {p.name || 'Untitled step'}</option>
              ))}
            </select>
          </td>
        </>
      )}
      <td>
        <DraftInput
          value={stage.timing}
          placeholder="7/31/2026 · Aug–Sep 2026 · Q3 2026"
          className={styles.stageInput}
          onCommit={(next) => onChange({ ...stage, timing: next })}
        />
      </td>
      {format === 'gantt' && (
      <td className={styles.stageDatesCell}>
        <input
          type="date"
          className={styles.dateInput}
          value={range?.start || ''}
          onChange={(e) => onChange({ ...stage, start: e.target.value })}
          title={auto ? 'Read from Timing — pick a date to override' : 'Start date'}
        />
        <span className={styles.dateSep}>→</span>
        <input
          type="date"
          className={styles.dateInput}
          value={range?.end || ''}
          onChange={(e) => onChange({ ...stage, end: e.target.value })}
          title={auto ? 'Read from Timing — pick a date to override' : 'End date'}
        />
        {auto && (
          <span className={styles.autoTag} title="Dates read from the Timing column. Pick a date to override; clear it to go back to automatic.">auto</span>
        )}
        {!range && (
          <span className={styles.undatedTag} title="This stage can't be placed on the Gantt until it has dates.">no date</span>
        )}
      </td>
      )}
      <td>
        <DraftInput
          value={stage.description}
          placeholder="What happens at this stage"
          className={styles.stageInput}
          multiline
          onCommit={(next) => onChange({ ...stage, description: next })}
        />
      </td>
      <td className={styles.stageActionsCell}>
        <button
          type="button"
          className={styles.stageMoveBtn}
          onClick={() => onMove(-1)}
          disabled={index === 0}
          title="Move stage earlier"
          aria-label="Move stage earlier"
        >↑</button>
        <button
          type="button"
          className={styles.stageMoveBtn}
          onClick={() => onMove(1)}
          disabled={index === total - 1}
          title="Move stage later"
          aria-label="Move stage later"
        >↓</button>
        <button
          type="button"
          className={styles.stageRemoveBtn}
          onClick={onRemove}
          title="Remove this stage"
          aria-label="Remove this stage"
        >×</button>
      </td>
    </tr>
  );
}

// The services a timeline is attached to, as removable chips plus a
// predictive box listing the Solutions-catalog services it isn't attached to
// yet. This is the hook for saving a timeline against specific services.
function ServiceChips({ services, serviceOptions, onAdd, onRemove }) {
  const [draft, setDraft] = useState('');
  // Each timeline gets its own datalist so the "already attached" filtering
  // is per-card; useId keeps the ids unique without a render-time random.
  const listId = `timeline-services-${useId()}`;

  const available = useMemo(() => {
    const attached = new Set(services.map(s => s.toLowerCase()));
    return (serviceOptions || [])
      .map(s => String(s || '').trim())
      .filter(s => s && !attached.has(s.toLowerCase()))
      .sort((a, b) => a.localeCompare(b));
  }, [services, serviceOptions]);

  function commit() {
    const value = draft.trim();
    setDraft('');
    if (!value) return;
    if (services.some(s => s.toLowerCase() === value.toLowerCase())) return;
    onAdd(value);
  }

  return (
    <div className={styles.timelineServices}>
      <span className={styles.timelineServicesLabel}>Saves to</span>
      {services.length === 0 && (
        <span className={styles.timelineServicesEmpty}>no services yet</span>
      )}
      {services.map(svc => (
        <span key={svc} className={styles.serviceChip}>
          {svc}
          <button
            type="button"
            className={styles.serviceChipRemove}
            onClick={() => onRemove(svc)}
            title={`Detach ${svc}`}
            aria-label={`Detach ${svc}`}
          >×</button>
        </span>
      ))}
      <input
        type="text"
        list={listId}
        value={draft}
        placeholder="+ attach a service…"
        className={styles.serviceChipInput}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          else if (e.key === 'Escape') { e.preventDefault(); setDraft(''); e.currentTarget.blur(); }
        }}
      />
      <datalist id={listId}>
        {available.map(s => <option key={s} value={s} />)}
      </datalist>
    </div>
  );
}

// The Schneider-Electric-formatted visual, live off the current stages, plus
// the export row. The SVG is generated by our own builder from escaped
// values, so injecting it as markup is the same trick the compliance report
// uses — it keeps screen and export pixel-identical.
function TimelineVisual({ template, onChangeFormat }) {
  const [busy, setBusy] = useState('');
  const svg = useMemo(() => buildTimelineSvg(template, { branded: true }), [template]);

  function handleReport() {
    if (!openTimelineReport(template)) {
      window.alert('Allow pop-ups for this site to open the printable timeline report.');
    }
  }
  async function handlePng() {
    setBusy('png');
    try {
      await downloadTimelinePng(template);
    } catch (err) {
      console.error('Timeline PNG export failed', err);
      window.alert('Could not build the PNG: ' + (err?.message || 'unknown error'));
    } finally {
      setBusy('');
    }
  }
  async function handleExcel() {
    setBusy('xlsx');
    try {
      await exportTimelineXlsx(template);
    } catch (err) {
      console.error('Timeline Excel export failed', err);
      window.alert('Could not build the workbook: ' + (err?.message || 'unknown error'));
    } finally {
      setBusy('');
    }
  }

  return (
    <div className={styles.visualPanel}>
      <div className={styles.visualToolbar}>
        <span className={styles.visualLabel}>Visual</span>
        <div className={styles.formatToggle}>
          {TIMELINE_FORMATS.map(f => (
            <button
              key={f.key}
              type="button"
              className={(template.format || 'gantt') === f.key ? styles.formatBtnActive : styles.formatBtn}
              onClick={() => onChangeFormat(f.key)}
              title={f.hint}
            >{f.label}</button>
          ))}
        </div>
        <span className={styles.visualHint}>Schneider Electric format — exports match this exactly</span>
        <button type="button" className={styles.exportBtn} onClick={handleReport} disabled={!svg}>
          Open report
        </button>
        <button type="button" className={styles.exportBtn} onClick={() => downloadTimelineSvg(template)} disabled={!svg}>
          SVG
        </button>
        <button type="button" className={styles.exportBtn} onClick={handlePng} disabled={!svg || busy === 'png'}>
          {busy === 'png' ? 'Building…' : 'PNG'}
        </button>
        <button
          type="button"
          className={styles.exportBtn}
          onClick={handleExcel}
          disabled={!template.stages?.length || busy === 'xlsx'}
          title="Native Excel Gantt plus a filterable stage table"
        >
          {busy === 'xlsx' ? 'Building…' : 'Excel'}
        </button>
      </div>
      <div className={styles.visualScroll}>
        {svg
          ? <div className={styles.visualSvg} dangerouslySetInnerHTML={{ __html: svg }} />
          : <div className={styles.serviceEmpty}>Add a stage to see the timeline visual.</div>}
      </div>
    </div>
  );
}

// One timeline: an editable name, the services it's attached to, and its
// ordered stages. The parent owns the array and hands down a single
// onChange so every edit lands as one settings write.
function TimelineCard({ template, serviceOptions, filter, onChange, onRemove }) {
  const { stages } = template;
  const counts = summarizeStageOwners(stages);
  const format = template.format || 'gantt';
  const mode = template.positionMode === 'months' ? 'months' : 'dates';

  function updateStage(idx, next) {
    onChange({ ...template, stages: stages.map((s, i) => (i === idx ? next : s)) });
  }
  function moveStage(idx, delta) {
    const target = idx + delta;
    if (target < 0 || target >= stages.length) return;
    const next = [...stages];
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange({ ...template, stages: next });
  }
  function removeStage(idx) {
    onChange({ ...template, stages: stages.filter((_, i) => i !== idx) });
  }
  function addStage() {
    onChange({
      ...template,
      stages: [...stages, { id: makeTimelineId('st'), name: '', owner: DEFAULT_STAGE_OWNER, timing: '', description: '', icon: 'number', kind: DEFAULT_STAGE_KIND }],
    });
  }
  function addService(name) {
    onChange({ ...template, services: [...template.services, name] });
  }
  function removeService(name) {
    onChange({ ...template, services: template.services.filter(s => s !== name) });
  }
  function handleRemove() {
    const label = template.name.trim() || 'this timeline';
    if (!window.confirm(`Delete "${label}" and its ${stages.length} stage${stages.length === 1 ? '' : 's'}? This can't be undone.`)) return;
    onRemove();
  }

  // Filter narrows the visible stages but edits still address the real
  // index, so a filtered view stays safe to edit.
  const term = filter.trim().toLowerCase();
  const visibleStages = stages
    .map((stage, idx) => ({ stage, idx }))
    .filter(({ stage }) => !term || [stage.name, stage.owner, stage.timing, stage.description]
      .some(v => String(v || '').toLowerCase().includes(term)));

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <DraftInput
          value={template.name}
          placeholder="Untitled timeline"
          title="Click to rename"
          className={styles.cardTitle}
          style={{ flex: 1, minWidth: 0, padding: '2px 4px', border: '1px solid transparent', borderRadius: 4, background: 'transparent', fontFamily: 'inherit' }}
          onCommit={(next) => onChange({ ...template, name: next })}
        />
        <span className={styles.cardCount}>{stages.length} stage{stages.length === 1 ? '' : 's'}</span>
        {TIMELINE_STAGE_OWNERS.filter(o => counts[o] > 0).map(o => (
          <span key={o} className={`${styles.ownerPill} ${OWNER_PILL_CLASS[o]}`}>
            {counts[o]} {shortOwnerLabel(o)}
          </span>
        ))}
        <button
          type="button"
          className={styles.timelineDeleteBtn}
          onClick={handleRemove}
          title="Delete this timeline"
          aria-label="Delete this timeline"
        >🗑</button>
      </div>

      <ServiceChips
        services={template.services}
        serviceOptions={serviceOptions}
        onAdd={addService}
        onRemove={removeService}
      />

      {format === 'phased' && (
        <div className={styles.phasedSettings}>
          <span className={styles.timelineServicesLabel}>Client workstream</span>
          <DraftInput
            value={template.clientName}
            placeholder="Client"
            title="Names the client's workstream in the legend, e.g. PROLOGIS"
            className={styles.settingInput}
            onCommit={(next) => onChange({ ...template, clientName: next })}
          />
          <span className={styles.timelineServicesLabel}>Position by</span>
          <select
            value={mode}
            onChange={(e) => onChange({ ...template, positionMode: e.target.value })}
            title="Dates place each step on the chart. Months lets you type the month numbers instead — for a proposal written before any date is fixed."
            className={styles.settingSelect}
          >
            <option value="dates">Start / end dates</option>
            <option value="months">Month numbers</option>
          </select>
          <span className={styles.timelineServicesLabel}>Months</span>
          <select
            value={template.monthCount === '' || template.monthCount == null ? '' : String(template.monthCount)}
            onChange={(e) => onChange({
              ...template,
              monthCount: e.target.value === '' ? '' : Number(e.target.value),
            })}
            title="How many month columns to show — applies to the visual and every export"
            className={styles.settingSelect}
          >
            <option value="">Auto (fit the steps)</option>
            {MONTH_COUNT_OPTIONS.map(n => <option key={n} value={n}>{n} months</option>)}
            {/* A value typed before this became a picker still shows. */}
            {template.monthCount !== '' && template.monthCount != null
              && !MONTH_COUNT_OPTIONS.includes(Number(template.monthCount)) && (
              <option value={String(template.monthCount)}>{template.monthCount} months</option>
            )}
          </select>
          <select
            value={template.monthMode === 'calendar' ? 'calendar' : 'numbers'}
            onChange={(e) => {
              const mode = e.target.value;
              // Switching to calendar with no anchor yet starts at this month,
              // which is what "show today" means for a timeline starting now.
              onChange({
                ...template,
                monthMode: mode,
                anchorMonth: mode === 'calendar' && !template.anchorMonth
                  ? currentMonthAnchor()
                  : template.anchorMonth,
              });
            }}
            title="Number the months from kickoff, or pin them to the calendar"
            className={styles.settingSelect}
          >
            <option value="numbers">Numbered 1…N</option>
            <option value="calendar">Calendar months</option>
          </select>
          {template.monthMode === 'calendar' && (
            <>
              <span className={styles.timelineServicesLabel}>Month 1 =</span>
              <input
                type="month"
                value={template.anchorMonth || ''}
                onChange={(e) => onChange({ ...template, anchorMonth: e.target.value })}
                title="Which real month is month 1"
                className={styles.settingInput}
              />
              <button
                type="button"
                className={styles.thisMonthBtn}
                onClick={() => onChange({ ...template, anchorMonth: currentMonthAnchor() })}
                title="Start the timeline at the current month"
              >This month</button>
            </>
          )}
          <span className={styles.timelineServicesLabel}>Caveat</span>
          <DraftInput
            value={template.note}
            placeholder="*All timelines are subject to…"
            title="Shown in the box at the top-left of the slide"
            className={`${styles.settingInput} ${styles.settingInputWide}`}
            onCommit={(next) => onChange({ ...template, note: next })}
          />
        </div>
      )}

      <div className={styles.timelineTableWrap}>
        <table className={styles.stageTable}>
          <colgroup>
            <col style={{ width: 34 }} />
            <col />
            <col style={{ width: 170 }} />
            {format === 'milestone' && <col style={{ width: 118 }} />}
            {format === 'phased' && <col style={{ width: 170 }} />}
            {format === 'phased' && <col style={{ width: 270 }} />}
            {format === 'phased' && <col style={{ width: 108 }} />}
            {format === 'phased' && <col style={{ width: 150 }} />}
            <col style={{ width: 150 }} />
            {format === 'gantt' && <col style={{ width: 290 }} />}
            <col />
            <col style={{ width: 84 }} />
          </colgroup>
          <thead>
            <tr>
              <th>#</th>
              <th>{format === 'phased' ? 'Step' : 'Stage'}</th>
              <th>{format === 'phased' ? 'Workstream' : 'Owner'}</th>
              {format === 'milestone' && <th>Icon</th>}
              {format === 'phased' && <th>Type</th>}
              {format === 'phased' && <th>Phase</th>}
              {format === 'phased' && (
                <th className={mode === 'dates' ? undefined : styles.inactiveHead}
                    title="Start and end dates. The standard way to place a step.">Start → End</th>
              )}
              {format === 'phased' && (
                <th className={mode === 'dates' ? styles.inactiveHead : undefined}
                    title="Start month from kickoff × how many months it spans">Month × Span</th>
              )}
              {format === 'phased' && <th title="The earlier step this one waits on">Depends on</th>}
              <th>Timing</th>
              {format === 'gantt' && <th>Dates</th>}
              <th>Description</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {visibleStages.length === 0 ? (
              <tr>
                <td colSpan={format === 'phased' ? 11 : 8} className={styles.serviceEmpty}>
                  {stages.length === 0 ? 'No stages yet — add the first one below.' : 'No stages match the search.'}
                </td>
              </tr>
            ) : (
              visibleStages.map(({ stage, idx }) => (
                <StageRow
                  key={stage.id}
                  index={idx}
                  total={stages.length}
                  stage={stage}
                  format={format}
                  mode={mode}
                  priorSteps={stages.slice(0, idx).map((st, i) => ({ id: st.id, number: i + 1, name: st.name }))}
                  onChange={(next) => updateStage(idx, next)}
                  onMove={(delta) => moveStage(idx, delta)}
                  onRemove={() => removeStage(idx)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className={styles.timelineFooter}>
        <button type="button" className={styles.addStageBtn} onClick={addStage}>+ Add stage</button>
      </div>

      <TimelineVisual
        template={template}
        onChangeFormat={(format) => onChange({ ...template, format })}
      />
    </div>
  );
}

// Dropdowns → Timelines. Builds the reusable timeline templates — a named
// sequence of stages, each owned by the client or Schneider Electric — that
// get attached to services. Everything persists under
// settings.timelineTemplates and syncs alongside the other dropdown data.
export function TimelinesTab({ settings, updateSettings, serviceOptions = [] }) {
  const [search, setSearch] = useState('');
  // Narrow to the one settings key we read so the memo only re-runs when the
  // timelines themselves change, not on every unrelated settings write.
  const saved = settings?.timelineTemplates;
  const templates = useMemo(() => getTimelineTemplates({ timelineTemplates: saved }), [saved]);

  function saveTemplates(next) {
    updateSettings?.({ timelineTemplates: next });
  }
  function updateTemplate(id, next) {
    saveTemplates(templates.map(t => (t.id === id ? next : t)));
  }
  function removeTemplate(id) {
    saveTemplates(templates.filter(t => t.id !== id));
  }
  function addTimeline() {
    const name = window.prompt('Name for the new timeline:', '');
    if (name === null) return;
    saveTemplates([
      ...templates,
      { id: makeTimelineId('tl'), name: (name || '').trim(), services: [], stages: [] },
    ]);
  }

  const term = search.trim().toLowerCase();
  // A timeline stays visible when its name, one of its services, or one of
  // its stages matches — the card itself then dims the non-matching stages.
  const visible = templates.filter(tpl => {
    if (!term) return true;
    if (tpl.name.toLowerCase().includes(term)) return true;
    if (tpl.services.some(s => s.toLowerCase().includes(term))) return true;
    return tpl.stages.some(s => [s.name, s.owner, s.timing, s.description]
      .some(v => String(v || '').toLowerCase().includes(term)));
  });

  const totalStages = templates.reduce((a, t) => a + t.stages.length, 0);

  return (
    <>
      <div className={styles.searchRow}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search timelines, stages, owners…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          type="button"
          onClick={addTimeline}
          title="Create a new timeline"
          style={{
            padding: '0.4rem 0.8rem',
            background: 'var(--color-accent)', color: '#fff',
            border: 'none', borderRadius: 'var(--radius-md)',
            fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >+ New timeline</button>
        <span className={styles.resultCount}>
          {term
            ? `${visible.length} of ${templates.length} timelines`
            : `${templates.length} timeline${templates.length === 1 ? '' : 's'} · ${totalStages} stage${totalStages === 1 ? '' : 's'}`}
        </span>
      </div>

      <div className={styles.scroll}>
        {templates.length === 0 ? (
          <div className={styles.timelineEmptyState}>
            <p><strong>No timelines yet.</strong></p>
            <p>
              Build a timeline for the work you deliver repeatedly, then add the stages in the
              order they happen and mark each one as owned by <em>Schneider Electric</em>, the{' '}
              <em>Client</em>, or <em>Both</em>. Attach the finished timeline to the services it
              applies to so it can be reused from there.
            </p>
          </div>
        ) : visible.length === 0 ? (
          <div className={styles.timelineEmptyState}>
            <p>No timelines match “{search.trim()}”.</p>
          </div>
        ) : (
          visible.map(tpl => (
            <div key={tpl.id} className={styles.section}>
              <TimelineCard
                template={tpl}
                serviceOptions={serviceOptions}
                filter={search}
                onChange={(next) => updateTemplate(tpl.id, next)}
                onRemove={() => removeTemplate(tpl.id)}
              />
            </div>
          ))
        )}
      </div>
    </>
  );
}

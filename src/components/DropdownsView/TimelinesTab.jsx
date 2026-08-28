import { useMemo, useState, useEffect, useId } from 'react';
import {
  TIMELINE_STAGE_OWNERS,
  DEFAULT_STAGE_OWNER,
  TIMELINE_STAGE_KINDS,
  DEFAULT_STAGE_KIND,
  STAGE_KIND_LABELS,
  getTimelineTemplates,
  makeTimelineId,
  makeTimelineStage,
  setStagePreKickoff,
  canSwapStages,
  summarizeStageOwners,
  shortOwnerLabel,
  libraryEntries,
  saveToLibrary,
  removeFromLibrary,
  instantiateTimeline,
  LIBRARY_ID_PREFIX,
  legalReviewMonths,
  setLegalReviewMonths,
  LEGAL_REVIEW_DEFAULT_MONTHS,
} from '../../utils/timelineTemplatesStore';
import { buildTimelineSvg, STAGE_ICONS, TIMELINE_FORMATS } from '../../utils/timelineGraphic';
import { PriorStepsPicker } from './PriorStepsPicker';
import {
  getStageRange, currentMonthAnchor, formatStepDuration,
  STEP_DURATION_UNITS, STEP_DURATION_UNIT_LABELS, DEFAULT_DURATION_UNIT,
  getTimelineRange, resolveMonthWindow, describeMonthWindow, stagesOutsideWindow,
  timelineBaseMonth, placeStages, placementBaseMonth, parseDependsOn,
} from '../../utils/timelineDates';
import { openTimelineReport, downloadTimelineSvg, downloadTimelinePng } from '../../utils/timelineExport';
import { exportTimelineXlsx } from '../../utils/timelineXlsx';
import {
  stageTableColumnsForMode, resolveStageTableColumns,
  loadStageTableLayout, saveStageTableLayout,
  STAGE_TABLE_LAYOUT_EVENT, MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH,
} from '../../utils/stageTableColumns';
import styles from './DropdownsView.module.css';

// Which pill style each owner gets. Keeps the owner readable at a glance
// when scanning a long stage table for the hand-offs.
// Month-count choices for the implementation format. "Auto" (blank) fits the
// steps, with a floor of 12 so a short timeline still reads as a year.
const MONTH_COUNT_OPTIONS = [3, 6, 9, 12, 18, 24, 36];

// Header tooltips, by column key — the explanations that used to sit inline
// on the <th>s.
const COLUMN_TITLES = {
  range: 'Start and end dates. The standard way to place a step.',
  monthSpan: 'Start month from kickoff × how many months it spans',
  depends: 'The earlier steps this one waits on. A step can wait on several.',
  side: 'Which side of contract signature this step happens on',
  duration: 'How long the step lasts, in the unit it is counted in',
};

// Columns the implementation format greys out because the other positioning
// mode is in charge — dates when positioning by months, and vice versa.
const INACTIVE_COLUMN = {
  range: (mode) => mode !== 'dates',
  monthSpan: (mode) => mode === 'dates',
};

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
function StageRow({ index, siblings, stage, mode, columns, priorSteps, placed, onChange, onSetSide, onMove, onRemove }) {
  // Effective calendar range: the explicit dates when set, otherwise whatever
  // the Timing text parses to. `auto` means nothing was typed into the date
  // cells — they're mirroring the label.
  const range = getStageRange(stage);
  const auto = !!range && range.derivedStart && range.derivedEnd;
  // Placeholder values for the Month / Span cells: where the CHART puts this
  // step, so a blank cell shows what it's actually doing. Passed in rather
  // than worked out here, because a step with no month of its own is placed
  // by the steps it waits on — which this row can't see on its own.
  const months = placed;
  const byDates = mode === 'dates';
  // "3 weeks" when the step carries a duration, '' when it doesn't. Set in
  // the Services popup; shown here so the Span cell can say what it's
  // deferring to.
  const durationLabel = formatStepDuration(stage?.duration, stage?.durationUnit);
  // The arrows only ever swap within a side, so they go dim at the edges of
  // one — `siblings` is the whole list, which StageRow needs for nothing else.
  const canMoveUp = canSwapStages(siblings, index, index - 1);
  const canMoveDown = canSwapStages(siblings, index, index + 1);
  // One entry per column key. The header, the <colgroup> and this map are all
  // driven by the same column list, so a hidden column drops out of every one
  // of them at once and they can't fall out of step.
  const cells = {};
  cells.n = <td key="n" className={styles.stageOrderCell}>{index + 1}</td>;
  cells.name = (
      <td key="name">
        <DraftInput
          value={stage.name}
          placeholder="Stage name"
          className={styles.stageInput}
          onCommit={(next) => onChange({ ...stage, name: next })}
        />
      </td>
  );
  cells.owner = (
      <td key="owner">
        <select
          value={stage.owner}
          onChange={(e) => onChange({ ...stage, owner: e.target.value })}
          title="Who owns this stage?"
          className={`${styles.ownerSelect} ${OWNER_PILL_CLASS[stage.owner] || ''}`}
        >
          {TIMELINE_STAGE_OWNERS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </td>
  );
  cells.icon = (
        <td key="icon">
          <select
            value={stage.icon || 'number'}
            onChange={(e) => onChange({ ...stage, icon: e.target.value })}
            title="Marker artwork on the visual"
            className={styles.iconSelect}
          >
            {STAGE_ICONS.map(i => <option key={i.key} value={i.key}>{i.label}</option>)}
          </select>
        </td>
  );
  cells.kind = (
          <td key="kind">
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
  );
  cells.side = (
          <td key="side">
            {/* Changing this moves the step to the other side of the
                signature, not just relabels it — the array's order is the
                order the chart numbers and stacks in, so the run-up has to
                physically precede the engagement. */}
            <select
              value={stage.preKickoff ? 'pre' : 'post'}
              onChange={(e) => onSetSide(e.target.value === 'pre')}
              title={stage.preKickoff
                ? 'Happens before the contract is signed. Moves to the end of the run-up.'
                : 'Happens after the contract is signed. Moves to the head of the engagement.'}
              className={styles.ownerSelect}
            >
              <option value="pre">Before</option>
              <option value="post">After</option>
            </select>
          </td>
  );
  cells.duration = (
          <td key="duration" className={styles.stageDurationCell}>
            <NumberCell
              value={stage.duration}
              min={0}
              placeholder="—"
              title={durationLabel
                ? `This step lasts ${durationLabel} (${months.span} month${months.span === 1 ? '' : 's'} on the chart)`
                : 'How long the step lasts. Blank leaves its length to the dates or the Span cell.'}
              onCommit={(next) => onChange({ ...stage, duration: next })}
            />
            <select
              value={stage.durationUnit || DEFAULT_DURATION_UNIT}
              onChange={(e) => onChange({ ...stage, durationUnit: e.target.value })}
              title="The unit the duration is counted in"
              className={styles.durationUnitSelect}
            >
              {STEP_DURATION_UNITS.map(u => (
                <option key={u} value={u}>{STEP_DURATION_UNIT_LABELS[u]}</option>
              ))}
            </select>
          </td>
  );
  // Only rendered when the chart is positioned by dates —
  // stageTableColumnsForMode drops this column under month numbers rather than
  // leaving two dead date pickers greyed out in every row.
  cells.range = (
          <td key="range" className={styles.stageDatesCell}>
            <input
              type="date"
              className={styles.dateInput}
              value={range?.start || ''}
              onChange={(e) => onChange({ ...stage, start: e.target.value })}
              title="Start date: drives where this step sits on the chart"
            />
            <span className={styles.dateSep}>→</span>
            <input
              type="date"
              className={styles.dateInput}
              value={range?.end || ''}
              onChange={(e) => onChange({ ...stage, end: e.target.value })}
              title="End date: drives how wide the bar is"
            />
            {auto && (
              <span className={styles.autoTag} title="Read from the Timing column. Pick a date to override; clear it to go back to automatic.">auto</span>
            )}
            {!range && (
              <span className={styles.undatedTag} title={stage.dependsOn
                ? `Undated: placed after the step${parseDependsOn(stage.dependsOn).length === 1 ? '' : 's'} it waits on — month ${months.month}. Give it dates or a month to pin it instead.`
                : 'Without dates this step falls back to month 1. Give it dates, position it by months, or say which step it waits on.'}>no date</span>
            )}
          </td>
  );
  cells.monthSpan = (
          <td key="monthSpan" className={`${styles.monthCell} ${byDates ? styles.inactiveCell : ''}`}>
            <NumberCell
              value={stage.startMonth}
              placeholder={String(months.month)}
              title={byDates
                ? 'Not in use: the chart is positioned by dates'
                : 'Month from kickoff. Blank uses the stage\'s dates.'}
              onCommit={(next) => onChange({ ...stage, startMonth: next })}
            />
            <span className={styles.dateSep}>×</span>
            <NumberCell
              value={stage.months}
              placeholder={String(months.span)}
              // A step can carry a duration set in the Services popup ("3
              // weeks"), which sizes it unless this cell is filled in. Named
              // here, because typing a number over it is how that gets
              // overridden and the cell would otherwise look empty rather
              // than deferring to something.
              title={byDates
                ? (durationLabel
                  ? `Not in use for placement: the chart is positioned by dates. This step lasts ${durationLabel}.`
                  : 'Not in use: the chart is positioned by dates')
                : (durationLabel
                  ? `How many months the bar spans. Blank uses this step's ${durationLabel} duration (${months.span}). Type a number to override it.`
                  : 'How many months the bar spans')}
              onCommit={(next) => onChange({ ...stage, months: next })}
            />
          </td>
  );
  cells.depends = (
          <td key="depends">
            <PriorStepsPicker
              priorSteps={priorSteps}
              value={stage.dependsOn}
              onChange={(next) => onChange({ ...stage, dependsOn: next })}
              disabled={index === 0}
              compact
            />
          </td>
  );
  cells.timing = (
      <td key="timing">
        <DraftInput
          value={stage.timing}
          placeholder="7/31/2026 · Aug–Sep 2026 · Q3 2026"
          className={styles.stageInput}
          onCommit={(next) => onChange({ ...stage, timing: next })}
        />
      </td>
  );
  cells.dates = (
      <td key="dates" className={styles.stageDatesCell}>
        <input
          type="date"
          className={styles.dateInput}
          value={range?.start || ''}
          onChange={(e) => onChange({ ...stage, start: e.target.value })}
          title={auto ? 'Read from Timing: pick a date to override' : 'Start date'}
        />
        <span className={styles.dateSep}>→</span>
        <input
          type="date"
          className={styles.dateInput}
          value={range?.end || ''}
          onChange={(e) => onChange({ ...stage, end: e.target.value })}
          title={auto ? 'Read from Timing: pick a date to override' : 'End date'}
        />
        {auto && (
          <span className={styles.autoTag} title="Dates read from the Timing column. Pick a date to override; clear it to go back to automatic.">auto</span>
        )}
        {!range && (
          <span className={styles.undatedTag} title="This stage can't be placed on the Gantt until it has dates.">no date</span>
        )}
      </td>
  );
  cells.description = (
      <td key="description">
        <DraftInput
          value={stage.description}
          placeholder="What happens at this stage"
          className={styles.stageInput}
          multiline
          onCommit={(next) => onChange({ ...stage, description: next })}
        />
      </td>
  );
  cells.actions = (
      <td key="actions" className={styles.stageActionsCell}>
        <button
          type="button"
          className={styles.stageMoveBtn}
          onClick={() => onMove(-1)}
          // Off at the top of the list and at the top of a side: the arrows
          // shuffle within the run-up or within the engagement, and a button
          // that looks live but silently refuses is worse than a dim one.
          disabled={!canMoveUp}
          title={canMoveUp ? 'Move stage earlier' : 'First step on this side of signature — use the Signature cell to move it across'}
          aria-label="Move stage earlier"
        >↑</button>
        <button
          type="button"
          className={styles.stageMoveBtn}
          onClick={() => onMove(1)}
          disabled={!canMoveDown}
          title={canMoveDown ? 'Move stage later' : 'Last step on this side of signature — use the Signature cell to move it across'}
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
  );
  return <tr>{columns.map(col => cells[col.key]).filter(Boolean)}</tr>;
}

// Which stage-table columns are showing and how wide each one is, kept in
// localStorage per format. Re-reads on the in-tab change event and on
// cross-tab storage writes, so every open timeline card agrees.
function useStageTableLayout(format) {
  const [layout, setLayout] = useState(() => loadStageTableLayout(format));
  // Re-read when the format changes during render rather than in an effect —
  // the same render-phase resync the number cells use, and it avoids a wasted
  // pass showing the previous format's columns.
  const [lastFormat, setLastFormat] = useState(format);
  if (format !== lastFormat) {
    setLastFormat(format);
    setLayout(loadStageTableLayout(format));
  }
  useEffect(() => {
    const refresh = () => setLayout(loadStageTableLayout(format));
    window.addEventListener(STAGE_TABLE_LAYOUT_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(STAGE_TABLE_LAYOUT_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [format]);

  // Persist and update in one step. The event handler above re-reads for the
  // other cards; setting it here too keeps this one instant.
  const commit = (next) => {
    setLayout(next);
    saveStageTableLayout(format, next);
  };
  return [layout, commit];
}

// Header cell with a drag handle on its right edge. The drag reports every
// move so the column resizes live, and only writes to storage on release —
// one save per drag rather than one per pixel.
function StageHeadCell({ column, label, title, className, onResize, onResizeEnd }) {
  const start = (e) => {
    // Ignore anything but a primary press, so a right-click doesn't latch.
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = column.width;
    const handle = e.currentTarget;
    handle.setPointerCapture?.(e.pointerId);
    const width = (ev) => Math.min(
      MAX_COLUMN_WIDTH,
      Math.max(MIN_COLUMN_WIDTH, Math.round(startWidth + (ev.clientX - startX))),
    );
    const move = (ev) => onResize(column.key, width(ev));
    const up = (ev) => {
      handle.releasePointerCapture?.(e.pointerId);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      onResizeEnd(column.key, width(ev));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };
  return (
    <th className={`${styles.stageHeadCell} ${className || ''}`} title={title}>
      <span className={styles.stageHeadLabel}>{label}</span>
      <span
        className={styles.colResizer}
        onPointerDown={start}
        onDoubleClick={() => onResizeEnd(column.key, null)}
        title="Drag to resize this column · double-click to reset it"
        role="presentation"
      />
    </th>
  );
}

// "Columns" menu: a checkbox per hideable column. Closes on Escape or a click
// outside, like the other popovers on this page.
function ColumnPicker({ format, mode, layout, onChange }) {
  const [open, setOpen] = useState(false);
  const all = stageTableColumnsForMode(format, mode);
  const hideable = all.filter(c => !c.fixed);
  const hiddenCount = hideable.filter(c => layout.hidden[c.key]).length;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onClick = (e) => {
      if (!e.target.closest?.(`.${styles.columnPicker}`)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    // Deferred so the click that opened the menu doesn't immediately close it.
    const id = setTimeout(() => window.addEventListener('click', onClick), 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClick);
    };
  }, [open]);

  const toggle = (key) => {
    const hidden = { ...layout.hidden };
    if (hidden[key]) delete hidden[key];
    else hidden[key] = true;
    onChange({ ...layout, hidden });
  };

  return (
    <div className={styles.columnPicker}>
      <button
        type="button"
        className={styles.columnPickerBtn}
        onClick={() => setOpen(v => !v)}
        title="Choose which columns the stage table shows"
      >
        Columns{hiddenCount ? ` · ${hideable.length - hiddenCount}/${hideable.length}` : ''}
      </button>
      {open && (
        <div className={styles.columnPickerMenu}>
          {hideable.map(col => (
            <label key={col.key} className={styles.columnPickerRow}>
              <input
                type="checkbox"
                checked={!layout.hidden[col.key]}
                onChange={() => toggle(col.key)}
              />
              {col.label}
            </label>
          ))}
          <button
            type="button"
            className={styles.columnPickerReset}
            onClick={() => onChange({ hidden: {}, widths: {} })}
          >Reset columns and widths</button>
        </div>
      )}
    </div>
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
  // Steps the window leaves out are drawn nowhere and exported nowhere, so
  // this is the only place the user is told about them. Same helper the
  // renderers filter with, so the warning can't drift from what's missing.
  const outside = useMemo(() => {
    const stages = template.stages || [];
    const mode = template.positionMode === 'months' ? 'months' : 'dates';
    const window = resolveMonthWindow(template, null);
    return stagesOutsideWindow(template, {
      baseMonth: timelineBaseMonth(stages),
      mode,
      monthCount: window.monthCount,
    });
  }, [template]);
  const windowLabel = useMemo(() => {
    const window = resolveMonthWindow(template, null);
    return describeMonthWindow(window.anchor, window.monthCount);
  }, [template]);

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
        <span className={styles.visualHint}>Schneider Electric format: exports match this exactly</span>
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
      {outside.length > 0 && (
        <div className={styles.visualOutsideNote} role="status">
          <strong>{outside.length} step{outside.length === 1 ? '' : 's'}</strong>
          {' '}fall{outside.length === 1 ? 's' : ''} outside{windowLabel ? ` ${windowLabel.split(' · ')[0]}` : ' the timeline range'}
          {' '}and {outside.length === 1 ? 'is' : 'are'} left off the visual and every export:{' '}
          {outside.map(st => st.name || 'Untitled step').join(', ')}.
          {' '}Widen the range to include {outside.length === 1 ? 'it' : 'them'}.
        </div>
      )}
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
function TimelineCard({ template, serviceOptions, filter, onChange, onRemove, onSaveToLibrary, savedInLibrary }) {
  const { stages } = template;
  const counts = summarizeStageOwners(stages);
  const format = template.format || 'gantt';
  const mode = template.positionMode === 'months' ? 'months' : 'dates';
  const legalReview = legalReviewMonths(template);
  // Where each step lands on the chart, dependencies included — the Month
  // and Span cells show these as their placeholders, so the table says the
  // same thing the visual below it draws.
  const placedStages = placeStages(stages, placementBaseMonth(template, stages), mode);

  function updateStage(idx, next) {
    onChange({ ...template, stages: stages.map((s, i) => (i === idx ? next : s)) });
  }
  function moveStage(idx, delta) {
    const target = idx + delta;
    if (target < 0 || target >= stages.length) return;
    // The arrows shuffle within a side; crossing the signature is what the
    // Signature cell is for, and it reorders as it goes.
    if (!canSwapStages(stages, idx, target)) return;
    const next = [...stages];
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange({ ...template, stages: next });
  }
  // Changing a step's side moves it, so this replaces the whole array rather
  // than patching one row (see setStagePreKickoff).
  function setStageSide(idx, preKickoff) {
    onChange({ ...template, stages: setStagePreKickoff(stages, idx, preKickoff) });
  }
  function removeStage(idx) {
    onChange({ ...template, stages: stages.filter((_, i) => i !== idx) });
  }
  function addStage() {
    onChange({
      ...template,
      stages: [...stages, makeTimelineStage()],
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

  // The declared date range, and the months it resolves to. Both ends have to
  // be set before it takes effect, so the hint can say which state we're in.
  const hasRange = !!getTimelineRange(template);
  const rangeWindow = hasRange ? resolveMonthWindow(template, null) : null;
  const rangeSummary = rangeWindow
    ? describeMonthWindow(rangeWindow.anchor, rangeWindow.monthCount)
    : '';

  // Filter narrows the visible stages but edits still address the real
  // index, so a filtered view stays safe to edit.
  const term = filter.trim().toLowerCase();
  const visibleStages = stages
    .map((stage, idx) => ({ stage, idx }))
    .filter(({ stage }) => !term || [stage.name, stage.owner, stage.timing, stage.description]
      .some(v => String(v || '').toLowerCase().includes(term)));

  // Stage-table columns: which are showing and how wide, per format.
  const [layout, setLayout] = useStageTableLayout(format);
  // A width being dragged right now. Kept out of the saved layout so the
  // table tracks the pointer without a storage write per frame.
  const [dragWidth, setDragWidth] = useState(null);
  const columns = useMemo(() => {
    const resolved = resolveStageTableColumns(format, layout, mode);
    if (!dragWidth) return resolved;
    return resolved.map(c => (c.key === dragWidth.key ? { ...c, width: dragWidth.width } : c));
  }, [format, layout, mode, dragWidth]);
  const totalColumnWidth = columns.reduce((sum, c) => sum + c.width, 0);

  const resizeColumn = (key, width) => setDragWidth({ key, width });
  // Release: persist, or clear the override back to the default when the
  // handle was double-clicked (width === null).
  const commitColumnWidth = (key, width) => {
    setDragWidth(null);
    const widths = { ...layout.widths };
    if (width == null) delete widths[key];
    else widths[key] = width;
    setLayout({ ...layout, widths });
  };

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
        {/* Put this timeline on the library shelf, so the next engagement
            can start from it. A snapshot: what's on the shelf stops here, and
            carrying on editing below doesn't rewrite it.
            
            Once this timeline HAS an entry — it was taken off the shelf, or
            put there earlier — the two things you might mean are different
            enough to be separate buttons. Tailoring a standard plan to one
            client and saving it should not quietly replace the standard, so
            "Save as new" is there rather than inferred from whether the name
            changed. */}
        {savedInLibrary ? (
          <>
            <button
              type="button"
              className={styles.librarySaveBtn}
              onClick={() => onSaveToLibrary?.(template, { asNew: false })}
              title="Replace this timeline&rsquo;s library copy with how it reads now"
            >Update in library</button>
            <button
              type="button"
              className={styles.librarySaveBtn}
              onClick={() => onSaveToLibrary?.(template, { asNew: true })}
              title="Put this on the library shelf as its own entry, leaving the one it came from alone"
            >Save as new</button>
          </>
        ) : (
          <button
            type="button"
            className={styles.librarySaveBtn}
            onClick={() => onSaveToLibrary?.(template, { asNew: false })}
            title="Save this timeline to the library, to start future ones from"
          >Save to library</button>
        )}
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

      {/* The line under the title on every export — what this timeline is
          for, in the words it gets presented in. Outside the per-format
          settings because the header carries it whichever layout is drawn. */}
      <div className={styles.phasedSettings}>
        <span className={styles.timelineServicesLabel}>Subtitle</span>
        <DraftInput
          value={template.subtitle}
          placeholder="What this timeline is for"
          title="Drawn under the title on the visual and every export"
          className={`${styles.settingInput} ${styles.settingInputWide}`}
          onCommit={(next) => onChange({ ...template, subtitle: next })}
        />
      </div>

      {/* The window the whole timeline is drawn against. Set both ends and
          every surface — the grid on this page, the .xlsx, the .svg / .png —
          covers exactly those months, including empty ones, instead of
          shrink-wrapping whichever stages happen to be dated. The milestone
          format spaces its markers evenly and has no axis to align, so the
          control only shows on the two date-scaled formats. */}
      {(format === 'gantt' || format === 'phased') && (
        <div className={styles.phasedSettings}>
          <span className={styles.timelineServicesLabel}>Timeline range</span>
          <input
            type="date"
            value={template.rangeStart || ''}
            max={template.rangeEnd || undefined}
            onChange={(e) => onChange({ ...template, rangeStart: e.target.value })}
            title="First date the timeline covers: the chart starts at this month"
            className={styles.settingInput}
          />
          <span className={styles.timelineServicesLabel}>to</span>
          <input
            type="date"
            value={template.rangeEnd || ''}
            min={template.rangeStart || undefined}
            onChange={(e) => onChange({ ...template, rangeEnd: e.target.value })}
            title="Last date the timeline covers: the chart ends at this month"
            className={styles.settingInput}
          />
          {hasRange ? (
            <>
              <span className={styles.settingHint}>{rangeSummary}</span>
              <button
                type="button"
                className={styles.thisMonthBtn}
                onClick={() => onChange({ ...template, rangeStart: '', rangeEnd: '' })}
                title="Drop the fixed range and go back to fitting the dated stages"
              >Clear range</button>
            </>
          ) : (
            <span className={styles.settingHint}>
              {template.rangeStart || template.rangeEnd
                ? 'Set both ends to fix the range'
                : 'Unset: fits the dated stages'}
            </span>
          )}
        </div>
      )}

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
            title="Dates place each step on the chart. Months lets you type the month numbers instead: for a proposal written before any date is fixed."
            className={styles.settingSelect}
          >
            <option value="dates">Start / end dates</option>
            <option value="months">Month numbers</option>
          </select>
          <span className={styles.timelineServicesLabel}>Months</span>
          <select
            value={hasRange ? '' : (template.monthCount === '' || template.monthCount == null ? '' : String(template.monthCount))}
            disabled={hasRange}
            onChange={(e) => onChange({
              ...template,
              monthCount: e.target.value === '' ? '' : Number(e.target.value),
            })}
            title={hasRange
              ? `The timeline range sets this: ${rangeSummary}. Clear the range to pick a month count instead.`
              : 'How many month columns to show: applies to the visual and every export. Auto ends the chart one month after the last step, and grows as steps are added.'}
            className={styles.settingSelect}
          >
            <option value="">Auto (steps + 1 month)</option>
            {MONTH_COUNT_OPTIONS.map(n => <option key={n} value={n}>{n} months</option>)}
            {/* A value typed before this became a picker still shows. */}
            {template.monthCount !== '' && template.monthCount != null
              && !MONTH_COUNT_OPTIONS.includes(Number(template.monthCount)) && (
              <option value={String(template.monthCount)}>{template.monthCount} months</option>
            )}
          </select>
          <select
            value={hasRange || template.monthMode === 'calendar' ? 'calendar' : 'numbers'}
            disabled={hasRange}
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
            title={hasRange
              ? 'A timeline range always reads as calendar months. Clear the range to number them from kickoff.'
              : 'Number the months from kickoff, or pin them to the calendar'}
            className={styles.settingSelect}
          >
            <option value="numbers">Numbered 1…N</option>
            <option value="calendar">Calendar months</option>
          </select>
          {template.monthMode === 'calendar' && !hasRange && (
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
          {/* The months a deal spends in legal before anyone signs. Written
              as a step (see setLegalReviewMonths) rather than held here, so
              it draws, exports and reads like the rest of the plan — this is
              the shortcut for authoring it, and it reads its value back off
              that step. */}
          <span className={styles.timelineServicesLabel}>Legal review</span>
          <input
            type="number"
            min={0}
            step={1}
            value={legalReview || ''}
            placeholder="0"
            title={`Months of contract legal review before signature. 0 (or empty) for none; ${LEGAL_REVIEW_DEFAULT_MONTHS} is the usual.`}
            onChange={(e) => onChange(setLegalReviewMonths(template, e.target.value === '' ? 0 : Number(e.target.value)))}
            className={styles.settingNumber}
          />
          <span className={styles.settingHint}>
            {legalReview
              ? `${legalReview} month${legalReview === 1 ? '' : 's'} before signature`
              : 'months before signature (0 = none)'}
          </span>
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

      <div className={styles.stageTableTools}>
        <ColumnPicker format={format} mode={mode} layout={layout} onChange={setLayout} />
      </div>

      <div className={styles.timelineTableWrap}>
        {/* Fixed layout and an explicit total width: the columns then hold the
            widths they were dragged to instead of the browser redistributing
            the slack, and the wrapper scrolls when they add up to more than
            the card. */}
        <table
          className={styles.stageTable}
          style={{ tableLayout: 'fixed', width: totalColumnWidth }}
        >
          <colgroup>
            {columns.map(col => <col key={col.key} style={{ width: col.width }} />)}
          </colgroup>
          <thead>
            <tr>
              {columns.map(col => (
                <StageHeadCell
                  key={col.key}
                  column={col}
                  label={col.key === 'actions' ? '' : col.label}
                  title={COLUMN_TITLES[col.key]}
                  className={INACTIVE_COLUMN[col.key]?.(mode) ? styles.inactiveHead : undefined}
                  onResize={resizeColumn}
                  onResizeEnd={commitColumnWidth}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleStages.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className={styles.serviceEmpty}>
                  {stages.length === 0 ? 'No stages yet: add the first one below.' : 'No stages match the search.'}
                </td>
              </tr>
            ) : (
              visibleStages.map(({ stage, idx }) => (
                <StageRow
                  key={stage.id}
                  index={idx}
                  siblings={stages}
                  stage={stage}
                  mode={mode}
                  columns={columns}
                  priorSteps={stages.slice(0, idx).map((st, i) => ({ id: st.id, number: i + 1, name: st.name }))}
                  placed={placedStages[idx]}
                  onChange={(next) => updateStage(idx, next)}
                  onSetSide={(pre) => setStageSide(idx, pre)}
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

// The library shelf, offered next to "+ New timeline": the timelines that
// ship with the app, and the ones the user has saved from their own list.
//
// Clicking one adds a COPY — new ids throughout — so the same standard plan
// can be pulled off the shelf once per engagement without the two copies
// being edited and deleted as one. Which is why entries stay listed after
// they've been used; a row whose name is already in the list says so rather
// than disappearing.
function LibraryPicker({ entries, templates, onAdd, onRemove }) {
  const [open, setOpen] = useState(false);
  // Names already in the list, so a row can warn before it's added twice.
  const present = useMemo(
    () => new Set(templates.map(t => t.name.trim().toLowerCase()).filter(Boolean)),
    [templates],
  );

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onClick = (e) => {
      if (!e.target.closest?.(`.${styles.libraryPicker}`)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    // Deferred so the click that opened the menu doesn't immediately close it.
    const id = setTimeout(() => window.addEventListener('click', onClick), 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClick);
    };
  }, [open]);

  if (!entries.length) return null;

  function remove(entry) {
    const label = entry.name.trim() || 'this timeline';
    if (!window.confirm(`Take "${label}" off the library shelf? The copies already in your list are untouched.`)) return;
    onRemove(entry);
  }

  return (
    <div className={styles.libraryPicker}>
      <button
        type="button"
        className={styles.libraryPickerBtn}
        onClick={() => setOpen(v => !v)}
        title="Start a timeline from one on the library shelf"
      >+ From library · {entries.length}</button>
      {open && (
        <div className={styles.libraryPickerMenu}>
          {entries.map(entry => {
            const already = present.has(entry.name.trim().toLowerCase());
            return (
              <div key={entry.libraryId} className={styles.libraryPickerItem}>
                <button
                  type="button"
                  className={styles.libraryPickerRow}
                  onClick={() => { setOpen(false); onAdd(entry); }}
                  title={entry.subtitle || `Add a copy of ${entry.name}`}
                >
                  <span className={styles.libraryPickerName}>
                    {entry.name || 'Untitled timeline'}
                    {already && <span className={styles.libraryPickerNote}>already in your list</span>}
                  </span>
                  <span className={styles.libraryPickerMeta}>
                    {entry.stages.length} stage{entry.stages.length === 1 ? '' : 's'}
                  </span>
                </button>
                {entry.builtIn ? null : (
                  <button
                    type="button"
                    className={styles.libraryPickerRemove}
                    onClick={() => remove(entry)}
                    title="Take this off the library shelf"
                    aria-label={`Remove ${entry.name || 'timeline'} from the library`}
                  >×</button>
                )}
              </div>
            );
          })}
        </div>
      )}
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
  const savedLibrary = settings?.timelineLibrary;
  const entries = useMemo(() => libraryEntries({ timelineLibrary: savedLibrary }), [savedLibrary]);
  const savedIds = useMemo(
    () => new Set(entries.map(e => e.libraryId).filter(Boolean)),
    [entries],
  );

  function saveTemplates(next) {
    updateSettings?.({ timelineTemplates: next });
  }
  // Saving to the library writes both halves at once: the shelf gains (or
  // refreshes) its entry, and the timeline in the list records which entry
  // it is, so the next save updates that one rather than shelving a second
  // near-copy beside it.
  function saveTemplateToLibrary(tpl, { asNew = false } = {}) {
    const withId = tpl.libraryId && !asNew
      ? tpl
      : { ...tpl, libraryId: makeTimelineId(LIBRARY_ID_PREFIX) };
    updateSettings?.({
      timelineLibrary: saveToLibrary({ timelineLibrary: savedLibrary }, withId),
      timelineTemplates: templates.map(t => (t.id === withId.id ? withId : t)),
    });
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
      // Positioning is recorded rather than inferred: a new timeline is
      // placed by its start / end dates, and stays that way even if someone
      // later types a value into Month × Span to see what it does.
      {
        id: makeTimelineId('tl'), name: (name || '').trim(),
        services: [], stages: [], positionMode: 'dates',
      },
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
        <LibraryPicker
          entries={entries}
          templates={templates}
          onAdd={(entry) => saveTemplates([...templates, instantiateTimeline(entry)])}
          onRemove={(entry) => updateSettings?.({
            timelineLibrary: removeFromLibrary({ timelineLibrary: savedLibrary }, entry.libraryId),
          })}
        />
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
                onSaveToLibrary={saveTemplateToLibrary}
                savedInLibrary={!!tpl.libraryId && savedIds.has(tpl.libraryId)}
              />
            </div>
          ))
        )}
      </div>
    </>
  );
}

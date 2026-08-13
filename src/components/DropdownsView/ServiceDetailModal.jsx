import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { parseMulti } from '../common/columnLinks';
import { rolloutWeeks } from '../../data/serviceCatalog';
import {
  TIMELINE_STAGE_OWNERS,
  makeTimelineStage,
  makeTimelineForService,
  parseDependsOn,
  formatDependsOn,
} from '../../utils/timelineTemplatesStore';
import {
  STEP_DURATION_UNITS,
  STEP_DURATION_UNIT_LABELS,
  DEFAULT_DURATION_UNIT,
  durationToMonths,
} from '../../utils/timelineDates';
import { PriorStepsPicker } from './PriorStepsPicker';
import styles from './DropdownsView.module.css';

// One service, all of it, on one screen. The Services table carries twelve
// columns behind a horizontal scrollbar, so reading a single row means
// scrolling sideways and losing the name off the left edge. Clicking the row
// opens this instead: every field for that service in one place, editable
// through the same save path the table cells use, plus the two things the
// table can't show — the full dependency list (the cell shows one chip and a
// count) and which services depend on THIS one, which no column holds at all.

// A labelled free-text field. Always an input rather than the table's
// click-to-edit span: in a detail panel there's room to show what's editable,
// and a row of identical boxes reads faster than a row of bare text.
// Commits on blur / Enter, reverts on Escape, and only writes when the value
// actually changed so opening and closing the popup can't blank a field.
function TextField({ label, value, placeholder, onCommit }) {
  const [draft, setDraft] = useState(value || '');
  const [seen, setSeen] = useState(value || '');
  // Re-sync when the stored value changes under us — a save from another
  // device, or the same service reopened after an edit. Adjusted during
  // render rather than in an effect so the box never paints the stale value
  // for a frame first.
  if ((value || '') !== seen) {
    setSeen(value || '');
    setDraft(value || '');
  }

  function commit() {
    const trimmed = draft.trim();
    if (trimmed === (value || '')) return;
    onCommit(trimmed);
  }

  return (
    <label className={styles.detailField}>
      <span className={styles.detailLabel}>{label}</span>
      <input
        type="text"
        className={styles.detailInput}
        value={draft}
        placeholder={placeholder || '—'}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
          else if (e.key === 'Escape') { e.preventDefault(); setDraft(value || ''); e.currentTarget.blur(); }
        }}
      />
    </label>
  );
}

// Timeline Driven. Same three states as the table's cell: unset, Yes, No.
function YesNoField({ label, value, onCommit }) {
  return (
    <label className={styles.detailField}>
      <span className={styles.detailLabel}>{label}</span>
      <select
        className={styles.detailInput}
        value={value || ''}
        onChange={e => { if (e.target.value !== (value || '')) onCommit(e.target.value); }}
      >
        <option value="">—</option>
        <option value="Yes">Yes</option>
        <option value="No">No</option>
      </select>
    </label>
  );
}

// Rollout Time, in weeks. Mirrors the table cell's handling of legacy free
// text ("4-6 weeks" and the like): it isn't a number, so it isn't guessed at
// — the old text stays as the placeholder of an empty box until the user
// replaces it with a number.
function WeeksField({ label, value, onCommit }) {
  const weeks = rolloutWeeks(value);
  const legacy = !!value && weeks === null;
  const initial = weeks === null ? '' : String(weeks);
  const [draft, setDraft] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) { setSeen(initial); setDraft(initial); }

  function commit() {
    const typed = draft.trim();
    if (typed === initial) return;
    if (typed === '') { onCommit(''); return; }
    const n = Number(typed);
    // Not a usable week count: leave what's stored alone.
    if (!Number.isFinite(n) || n < 0) { setDraft(initial); return; }
    onCommit(String(n));
  }

  return (
    <label className={styles.detailField}>
      <span className={styles.detailLabel}>{label}</span>
      <span className={styles.detailWeeksRow}>
        <input
          type="number"
          min="0"
          step="0.5"
          inputMode="decimal"
          className={styles.detailInput}
          value={draft}
          placeholder={legacy ? value : '—'}
          title={legacy ? `"${value}" isn't a number of weeks — type one to replace it` : undefined}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
            else if (e.key === 'Escape') { e.preventDefault(); setDraft(initial); e.currentTarget.blur(); }
          }}
        />
        <span className={styles.detailUnit}>weeks</span>
      </span>
    </label>
  );
}

// The dependency editor. The table cell shows the first name and "+N" because
// a row has one line to spend; here there's room for the whole list, so every
// dependency is a removable chip and the picker sits open underneath instead
// of in a popover.
//
// Same storage as the cell — a comma-separated list of Solutions names, held
// in the Solutions list's own order so two services with the same
// dependencies read identically. A name the Solutions list no longer carries
// is kept and flagged rather than dropped.
function DependsEditor({ value, options, selfName, onCommit }) {
  const [query, setQuery] = useState('');
  // The picker is 139 services long. Open by default it would push the
  // section below — which services wait on THIS one — off the bottom of the
  // panel, and reading the dependencies both ways is most of the point of
  // the popup. So it stays behind a button until there's something to pick.
  const [picking, setPicking] = useState(false);

  const selected = useMemo(() => parseMulti(value), [value]);
  const selectedSet = useMemo(
    () => new Set(selected.map(s => s.trim().toLowerCase())), [selected]);
  const pickable = useMemo(
    () => options.filter(o => o.trim().toLowerCase() !== String(selfName).trim().toLowerCase()),
    [options, selfName]);
  const liveSet = useMemo(
    () => new Set(pickable.map(o => o.trim().toLowerCase())), [pickable]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? pickable.filter(o => o.toLowerCase().includes(q)) : pickable;
  }, [pickable, query]);

  function toggle(name) {
    const key = name.trim().toLowerCase();
    const next = selectedSet.has(key)
      ? selected.filter(s => s.trim().toLowerCase() !== key)
      : [...selected, name];
    const nextKeys = new Set(next.map(s => s.trim().toLowerCase()));
    const ordered = [
      ...pickable.filter(o => nextKeys.has(o.trim().toLowerCase())),
      ...next.filter(s => !liveSet.has(s.trim().toLowerCase())),
    ];
    onCommit(ordered.join(', '));
  }

  return (
    <div className={styles.detailSection}>
      <div className={styles.detailSectionHead}>
        <span className={styles.detailSectionTitle}>Rolled out before this one</span>
        <span className={styles.detailSectionCount}>{selected.length}</span>
        <button
          type="button"
          className={styles.serviceLinkEditBtn}
          onClick={() => { setPicking(p => !p); setQuery(''); }}
        >{picking ? 'Done' : '+ Add'}</button>
        {selected.length > 0 && (
          <button type="button" className={styles.serviceLinkEditBtn} onClick={() => onCommit('')}>
            Clear
          </button>
        )}
      </div>
      {selected.length === 0 ? (
        <p className={styles.detailEmpty}>
          Nothing has to be rolled out before {selfName}.
        </p>
      ) : (
        <div className={styles.detailChips}>
          {selected.map(name => {
            const stale = !liveSet.has(name.trim().toLowerCase());
            return (
              <span
                key={name}
                className={stale ? styles.serviceDepChipStale : styles.serviceDepChip}
                title={stale ? `"${name}" isn't in the Solutions list any more` : name}
              >
                {name}
                <button
                  type="button"
                  className={styles.detailChipRemove}
                  onClick={() => toggle(name)}
                  title={`Remove ${name}`}
                  aria-label={`Remove ${name}`}
                >×</button>
              </span>
            );
          })}
        </div>
      )}
      {picking && (
        <>
          <input
            type="text"
            autoFocus
            className={styles.detailInput}
            value={query}
            placeholder="Search services…"
            onChange={e => setQuery(e.target.value)}
          />
          <div className={styles.detailPickList}>
            {shown.length === 0 ? (
              <div className={styles.detailEmpty}>No services match “{query}”.</div>
            ) : shown.map(name => {
              const on = selectedSet.has(name.trim().toLowerCase());
              return (
                <label key={name} className={on ? styles.detailPickRowOn : styles.detailPickRow}>
                  <input type="checkbox" checked={on} onChange={() => toggle(name)} />
                  <span>{name}</span>
                </label>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// How long one step lasts, in the unit that suits it: a survey is a
// fortnight, a rollout is four months. Both halves are the step's own — the
// number is stored as typed and the unit beside it says what it counts, so a
// three-week step reads as three weeks rather than as the 0.75 months it
// works out to.
//
// The chart's grid is months, so the conversion is spelled out next to the
// control rather than left to be discovered from a bar that didn't move: two
// weeks and three weeks both occupy the column they start in.
function StepDuration({ stage, onChange }) {
  const asText = stage.duration === '' || stage.duration == null ? '' : String(stage.duration);
  const [draft, setDraft] = useState(asText);
  const [seen, setSeen] = useState(asText);
  if (asText !== seen) { setSeen(asText); setDraft(asText); }

  function commit() {
    const raw = draft.trim();
    if (raw === asText) return;
    if (raw === '') { onChange({ ...stage, duration: '' }); return; }
    const n = Number(raw);
    // Not a length: leave what's stored alone rather than writing a zero or a
    // NaN the placement would then have to defend against.
    if (!Number.isFinite(n) || n <= 0) { setDraft(asText); return; }
    onChange({ ...stage, duration: n });
  }

  const months = durationToMonths(stage.duration, stage.durationUnit);
  return (
    <div className={styles.detailStepDuration}>
      <span className={styles.detailStepDurationLabel}>Duration</span>
      <input
        type="number"
        min="0"
        step="any"
        className={styles.detailStepDurationNum}
        value={draft}
        placeholder="—"
        aria-label={`Duration of step: ${stage.name || 'untitled'}`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
          else if (e.key === 'Escape') { e.preventDefault(); setDraft(asText); e.currentTarget.blur(); }
        }}
      />
      <select
        className={styles.detailStepDurationUnit}
        value={stage.durationUnit || DEFAULT_DURATION_UNIT}
        aria-label={`Time unit for step: ${stage.name || 'untitled'}`}
        title="The unit the duration is counted in"
        onChange={(e) => onChange({ ...stage, durationUnit: e.target.value })}
      >
        {STEP_DURATION_UNITS.map(u => (
          <option key={u} value={u}>{STEP_DURATION_UNIT_LABELS[u]}</option>
        ))}
      </select>
      {months != null && (
        <span
          className={styles.detailStepDurationHint}
          title="The chart is drawn in month columns, so a step shorter than a month still fills the one it starts in."
        >
          {stage.durationUnit === 'months'
            ? `${months} column${months === 1 ? '' : 's'} on the chart`
            : `≈ ${months} month${months === 1 ? '' : 's'} on the chart`}
        </span>
      )}
    </div>
  );
}

// The steps of this service's timeline, editable from the popup.
//
// These aren't a second copy of anything: they're the stages of a timeline
// template attached to this service — the same records the Timelines tab
// edits and the same ones getTimelineTemplatesForService hands to every
// surface that draws "the timeline for this service". A step added here shows
// up on the chart, and one added there shows up in this list.
//
// A service with no timeline yet gets one on the first step added, named
// after the service and attached to it. From then on it's an ordinary
// template: the Timelines tab can rename it, attach it to more services, set
// its dates and format, and pick the marker artwork. This list stays
// deliberately short — the four things a step needs to exist and sit in
// order — because a popup is the wrong place to hold the whole stage table.
//
// "Waits on" offers only the steps ABOVE the one being edited. A timeline
// step waits on something earlier by definition, and the renderer draws the
// connector that way; letting a step point forward would draw an arrow
// backwards through the plan.
function TimelineStepsEditor({ serviceName, templates, onSaveTemplates, onOpenTimelines }) {
  const key = String(serviceName ?? '').trim().toLowerCase();
  const attached = useMemo(
    () => templates.filter(t => t.services.some(s => s.trim().toLowerCase() === key)),
    [templates, key],
  );

  // Which attached timeline the steps below belong to. A service usually has
  // one; when it has several, editing them all at once in a popup would be
  // noise, so one is in front of the user at a time.
  const [pickedId, setPickedId] = useState('');
  const active = attached.find(t => t.id === pickedId) || attached[0] || null;
  const stages = active?.stages || [];

  // Replace the active template in the full set — everything below writes
  // through here, so the save path is the same one the Timelines tab uses.
  function writeStages(next) {
    onSaveTemplates(templates.map(t => (t.id === active.id ? { ...t, stages: next } : t)));
  }

  function addStep() {
    if (!active) {
      // First step on a service with no timeline: the timeline comes into
      // existence with it, rather than making the user go build one on
      // another tab first and come back.
      const created = makeTimelineForService(serviceName);
      created.stages = [makeTimelineStage()];
      setPickedId(created.id);
      onSaveTemplates([...templates, created]);
      return;
    }
    writeStages([...stages, makeTimelineStage()]);
  }

  function updateStep(idx, next) {
    writeStages(stages.map((s, i) => (i === idx ? next : s)));
  }

  // Removing a step takes its id out of circulation, so anything waiting on
  // it is left pointing at nothing. Dropped from every list here rather than
  // left dangling: the renderer skips a link it can't resolve, which would
  // leave the data claiming a dependency the chart doesn't draw. A step
  // waiting on two keeps the other one.
  function removeStep(idx) {
    const goneId = stages[idx]?.id;
    writeStages(
      stages
        .filter((_, i) => i !== idx)
        .map(s => {
          const kept = parseDependsOn(s.dependsOn).filter(id => id !== goneId);
          return kept.length === parseDependsOn(s.dependsOn).length
            ? s
            : { ...s, dependsOn: formatDependsOn(kept) };
        }),
    );
  }

  // Reordering can leave a dependency pointing at a step that's no longer
  // earlier. "Waits on" means "waits on something before it", so a link that
  // stops being backwards stops holding — dropped rather than drawn as an
  // arrow running the wrong way through the plan. Only the links that stopped
  // pointing backwards go; the rest of the step's list survives the move.
  function moveStep(idx, delta) {
    const target = idx + delta;
    if (target < 0 || target >= stages.length) return;
    const next = [...stages];
    [next[idx], next[target]] = [next[target], next[idx]];
    const indexById = new Map(next.map((s, i) => [s.id, i]));
    writeStages(next.map((s, i) => {
      const ids = parseDependsOn(s.dependsOn);
      const kept = ids.filter(id => {
        const at = indexById.get(id);
        return at != null && at < i;
      });
      return kept.length === ids.length ? s : { ...s, dependsOn: formatDependsOn(kept) };
    }));
  }

  // Editing a template attached to more than one service edits it for all of
  // them. Said out loud, because nothing else on this popup hints that the
  // steps in front of the user are shared.
  const alsoOn = (active?.services || []).filter(s => s.trim().toLowerCase() !== key);

  // Only the implementation format draws the connectors between dependent
  // steps. Timelines created here are that format, but one built earlier on
  // the Timelines tab, or switched since, may not be — and a "waits on" that
  // draws nothing looks like it didn't save. Only worth saying once a
  // dependency actually exists to be drawn.
  const dependencyDrawn = (active?.format || 'gantt') === 'phased';
  const anyDependency = stages.some(s => s.dependsOn);

  return (
    <div className={styles.detailSection}>
      <div className={styles.detailSectionHead}>
        <span className={styles.detailSectionTitle}>Timeline steps</span>
        <span className={styles.detailSectionCount}>{stages.length}</span>
        <button type="button" className={styles.serviceLinkEditBtn} onClick={addStep}>+ Add step</button>
        {active && onOpenTimelines && (
          <button
            type="button"
            className={styles.serviceLinkEditBtn}
            onClick={() => onOpenTimelines(active.id)}
            title="Open this timeline on the Timelines tab for dates, months, format and marker artwork"
          >Open timeline ↗</button>
        )}
      </div>

      {attached.length > 1 && (
        <label className={styles.detailStepPick}>
          <span className={styles.detailLabel}>Timeline</span>
          <select
            className={styles.detailInput}
            value={active?.id || ''}
            onChange={(e) => setPickedId(e.target.value)}
            title={`${serviceName} has ${attached.length} timelines attached — pick which one these steps belong to`}
          >
            {attached.map(t => (
              <option key={t.id} value={t.id}>{t.name || 'Untitled timeline'} ({t.stages.length})</option>
            ))}
          </select>
        </label>
      )}

      {!active ? (
        <p className={styles.detailEmpty}>
          No timeline is attached to {serviceName} yet. Adding a step creates one,
          named after the service, and the steps you add here draw on its chart.
        </p>
      ) : (
        <>
          {alsoOn.length > 0 && (
            <p className={styles.detailStepShared}>
              These steps belong to “{active.name || 'Untitled timeline'}”, which is also
              attached to {alsoOn.join(', ')} — editing them here changes it for those too.
            </p>
          )}
          {anyDependency && !dependencyDrawn && (
            <p className={styles.detailStepShared}>
              “{active.name || 'Untitled timeline'}” is drawn in the {active.format === 'milestone' ? 'Milestone' : 'Gantt'} format,
              which doesn’t draw the arrows between dependent steps. The order below is
              still what it renders; switch it to Implementation on the Timelines tab to
              see what waits on what.
            </p>
          )}
          {stages.length === 0 ? (
            <p className={styles.detailEmpty}>
              “{active.name || 'Untitled timeline'}” has no steps yet.
            </p>
          ) : (
            <ol className={styles.detailStepList}>
              {stages.map((stage, idx) => (
                <li key={stage.id} className={styles.detailStep}>
                  <div className={styles.detailStepTop}>
                    <span className={styles.detailStepNum}>{idx + 1}</span>
                    <input
                      type="text"
                      className={styles.detailInput}
                      value={stage.name}
                      placeholder="Step name"
                      onChange={(e) => updateStep(idx, { ...stage, name: e.target.value })}
                    />
                    <button
                      type="button"
                      className={styles.serviceLinkEditBtn}
                      onClick={() => moveStep(idx, -1)}
                      disabled={idx === 0}
                      title="Move this step earlier"
                      aria-label={`Move step ${idx + 1} earlier`}
                    >↑</button>
                    <button
                      type="button"
                      className={styles.serviceLinkEditBtn}
                      onClick={() => moveStep(idx, 1)}
                      disabled={idx === stages.length - 1}
                      title="Move this step later"
                      aria-label={`Move step ${idx + 1} later`}
                    >↓</button>
                    <button
                      type="button"
                      className={styles.serviceLinkEditBtn}
                      onClick={() => removeStep(idx)}
                      title="Remove this step"
                      aria-label={`Remove step ${idx + 1}`}
                    >×</button>
                  </div>
                  <div className={styles.detailStepMeta}>
                    <select
                      className={styles.detailStepSelect}
                      value={stage.owner}
                      onChange={(e) => updateStep(idx, { ...stage, owner: e.target.value })}
                      title="Who owns this step?"
                    >
                      {TIMELINE_STAGE_OWNERS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                    <input
                      type="text"
                      className={styles.detailStepSelect}
                      value={stage.timing}
                      placeholder="Timing — Aug 2026, Q3, 2 weeks"
                      onChange={(e) => updateStep(idx, { ...stage, timing: e.target.value })}
                    />
                    <PriorStepsPicker
                      priorSteps={stages.slice(0, idx).map((p, i) => ({ id: p.id, number: i + 1, name: p.name }))}
                      value={stage.dependsOn}
                      onChange={(next) => updateStep(idx, { ...stage, dependsOn: next })}
                      disabled={idx === 0}
                    />
                  </div>
                  <StepDuration
                    stage={stage}
                    onChange={(next) => updateStep(idx, next)}
                  />
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}

// The per-service link the Solutions column renders the name as. Editable
// here too, so the popup is a complete view of the service rather than one
// that sends the user back to the table for the one field it left out.
function LinkField({ name, url, onSaveUrl }) {
  const [draft, setDraft] = useState(url || '');
  const [seen, setSeen] = useState(url || '');
  if ((url || '') !== seen) { setSeen(url || ''); setDraft(url || ''); }

  function commit() {
    const next = draft.trim();
    if (next === (url || '')) return;
    onSaveUrl(name, next);
  }

  return (
    <label className={styles.detailFieldWide}>
      <span className={styles.detailLabel}>Link</span>
      <span className={styles.detailWeeksRow}>
        <input
          type="url"
          className={styles.detailInput}
          value={draft}
          placeholder="https://example.com"
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
            else if (e.key === 'Escape') { e.preventDefault(); setDraft(url || ''); e.currentTarget.blur(); }
          }}
        />
        {url && (
          <a href={url} target="_blank" rel="noreferrer" className={styles.serviceLink} title={url}>Open ↗</a>
        )}
      </span>
    </label>
  );
}

/**
 * The Services row popup.
 *
 * Props:
 *   service     - { name, meta } for the clicked row, read live off the
 *                 catalog + overrides so edits show without reopening
 *   url         - the service's saved hyperlink, '' when it has none
 *   hidden      - whether the service is retired from circulation
 *   dependents  - names of the services that depend on this one
 *   options     - every Solutions name, for the dependency picker
 *   templates   - every timeline template, normalized; the ones attached to
 *                 this service are what the step editor edits
 *   onSaveField - (name, field, value) => void, the table's own save path
 *   onSaveUrl   - (name, url) => void
 *   onToggleHide- (name) => void
 *   onSaveTemplates - (next) => void, the Timelines tab's own save path
 *   onOpenTimelines - (templateId) => void, optional; hands the user to the
 *                 full stage table for dates, format and marker artwork
 *   onClose     - () => void
 */
export function ServiceDetailModal({
  service,
  url,
  hidden,
  dependents,
  options,
  templates = [],
  onSaveField,
  onSaveUrl,
  onToggleHide,
  onSaveTemplates,
  onOpenTimelines,
  onClose,
}) {
  const panelRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Focus the panel on open so Escape works before the user clicks anything
  // and so a screen reader lands inside the dialog rather than behind it.
  useEffect(() => { panelRef.current?.focus(); }, []);

  if (!service) return null;
  const { name, meta } = service;
  const save = (field) => (value) => onSaveField(name, field, value);

  return createPortal(
    <div
      className={styles.detailOverlay}
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        className={styles.detailPanel}
        role="dialog"
        aria-modal="true"
        aria-label={`${name} details`}
        tabIndex={-1}
        // The overlay closes on click; without this every click inside the
        // panel would close it too.
        onClick={e => e.stopPropagation()}
      >
        <div className={styles.detailHeader}>
          <div className={styles.detailTitleWrap}>
            <h3 className={styles.detailTitle} title={name}>{name}</h3>
            <div className={styles.detailBadges}>
              {meta?.graveyard && (
                <span className={styles.detailBadgeMuted} title="Retired in the seed catalog">Retired</span>
              )}
              {hidden && (
                <span className={styles.detailBadgeMuted} title="Hidden from this list, the company card's services board, and the Opps Scope picker">Hidden</span>
              )}
              {meta?.bfoTag && meta.bfoTag !== '-' && (
                <span className={styles.detailBadge}>{meta.bfoTag}</span>
              )}
            </div>
          </div>
          <button
            type="button"
            className={styles.detailClose}
            onClick={onClose}
            title="Close"
            aria-label="Close"
          >×</button>
        </div>

        <div className={styles.detailBody}>
          {/* The service name itself isn't editable here for the same reason
              it isn't in the table: it's the key every override, link and
              dependency is stored under. Renaming happens on the Lists tab,
              which owns the Solutions vocabulary. */}
          <div className={styles.detailGrid}>
            <LinkField name={name} url={url} onSaveUrl={onSaveUrl} />
            <TextField label="BFO Tag" value={meta?.bfoTag} onCommit={save('bfoTag')} />
            <TextField label="Region" value={meta?.region} onCommit={save('region')} />
            <TextField label="Years" value={meta?.years} onCommit={save('years')} />
            <TextField label="Service Type" value={meta?.serviceType} onCommit={save('serviceType')} />
            <TextField label="Product Line" value={meta?.productLine} onCommit={save('productLine')} />
            <TextField label="Local Project Name" value={meta?.localProjectName} onCommit={save('localProjectName')} />
            <YesNoField label="Timeline Driven" value={meta?.timelineDriven} onCommit={save('timelineDriven')} />
            <WeeksField label="Rollout Time" value={meta?.rolloutTime} onCommit={save('rolloutTime')} />
            <TextField label="SME" value={meta?.sme} onCommit={save('sme')} />
          </div>

          {/* The steps of this service's own timeline. Sits above the
              service-level dependency sections because it's the finer grain:
              what happens inside this service, before what has to happen
              around it. */}
          {onSaveTemplates && (
            <TimelineStepsEditor
              serviceName={name}
              templates={templates}
              onSaveTemplates={onSaveTemplates}
              onOpenTimelines={onOpenTimelines}
            />
          )}

          <DependsEditor
            value={meta?.dependsOn}
            options={options}
            selfName={name}
            onCommit={save('dependsOn')}
          />

          {/* The other direction. No column holds it — it's derived from
              every other row's dependency list — so removing or retiring a
              service is otherwise done blind. */}
          <div className={styles.detailSection}>
            <div className={styles.detailSectionHead}>
              <span className={styles.detailSectionTitle}>Waiting on this one</span>
              <span className={styles.detailSectionCount}>{dependents.length}</span>
            </div>
            {dependents.length === 0 ? (
              <p className={styles.detailEmpty}>No service lists {name} as a dependency.</p>
            ) : (
              <div className={styles.detailChips}>
                {dependents.map(dep => (
                  <span key={dep} className={styles.serviceDepChip} title={`${dep} can't start until ${name} is rolled out`}>{dep}</span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className={styles.detailFooter}>
          <button
            type="button"
            className={styles.detailFooterBtn}
            onClick={() => onToggleHide(name)}
            title={hidden
              ? 'Show it again here, on the company card\'s services board, and in the Opps Scope picker'
              : 'Take it out of this list, the company card\'s services board, and the Opps Scope picker'}
          >{hidden ? 'Show service' : 'Hide service'}</button>
          <span className={styles.detailFooterNote}>Changes save as you type — no Save button.</span>
          <button type="button" className={styles.detailFooterPrimary} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

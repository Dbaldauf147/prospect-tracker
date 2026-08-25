import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { rolloutWeeks, SERVICE_BUCKETS } from '../../data/serviceCatalog';
import {
  TIMELINE_STAGE_OWNERS,
  makeTimelineStage,
  makeTimelineForService,
  parseDependsOn,
  formatDependsOn,
  groupStagesByPhase,
  phaseNames,
  setStagePreKickoff,
  canSwapStages,
} from '../../utils/timelineTemplatesStore';
import {
  STEP_DURATION_UNITS,
  STEP_DURATION_UNIT_LABELS,
  DEFAULT_DURATION_UNIT,
  durationToMonths,
} from '../../utils/timelineDates';
import { PriorStepsPicker } from './PriorStepsPicker';
import {
  parseServiceRefs, formatServiceRef, setRefStep, setRefLocalStep,
  findTemplateStepIndex, templatesForService,
} from '../../utils/serviceStepDeps';
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
// A picker over a fixed vocabulary. Any value that isn't in it (typed in
// before the list existed, or a heading since renamed) is kept as an
// option so opening the popup can't quietly wipe it.
function SelectField({ label, value, options, onCommit }) {
  const current = value || '';
  const opts = current && !options.includes(current) ? [current, ...options] : options;
  return (
    <label className={styles.detailField}>
      <span className={styles.detailLabel}>{label}</span>
      <select
        className={styles.detailInput}
        value={current}
        onChange={e => { if (e.target.value !== current) onCommit(e.target.value); }}
      >
        <option value="">—</option>
        {opts.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

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
function DependsEditor({ value, options, selfName, templates, onCommit }) {
  const [query, setQuery] = useState('');
  // The picker is 139 services long. Open by default it would push the
  // section below — which services wait on THIS one — off the bottom of the
  // panel, and reading the dependencies both ways is most of the point of
  // the popup. So it stays behind a button until there's something to pick.
  const [picking, setPicking] = useState(false);

  // Each dependency is { service, step }: the step is which point of that
  // service unblocks this one, '' meaning wait for all of it.
  const refs = useMemo(() => parseServiceRefs(value), [value]);
  // This service's own timeline, for picking the step on the waiting side.
  const ownTemplate = useMemo(
    () => templatesForService(templates, selfName)[0] || null,
    [templates, selfName],
  );
  const ownSteps = ownTemplate?.stages || [];
  const selected = useMemo(() => refs.map(r => r.service), [refs]);
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

  // Adding or removing a service must carry every other entry's step through
  // untouched — otherwise picking one more dependency silently re-plans the
  // deals that were waiting on a step.
  function toggle(name) {
    const key = name.trim().toLowerCase();
    const next = selectedSet.has(key)
      ? refs.filter(r => r.service.trim().toLowerCase() !== key)
      : [...refs, { service: name, step: '' }];
    const byName = new Map(next.map(r => [r.service.trim().toLowerCase(), r]));
    const ordered = [
      ...pickable.filter(o => byName.has(o.trim().toLowerCase())).map(o => byName.get(o.trim().toLowerCase())),
      ...next.filter(r => !liveSet.has(r.service.trim().toLowerCase())),
    ];
    // r.localStep travels with r.step: toggling one dependency must not
    // quietly drop the step another one is anchored to.
    onCommit(ordered.map(r => formatServiceRef(r.service, r.step, r.localStep)).join(', '));
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
        <div className={styles.detailDepRows}>
          {refs.map(({ service: name, step, localStep }) => {
            const stale = !liveSet.has(name.trim().toLowerCase());
            const tpl = templatesForService(templates, name)[0] || null;
            const steps = tpl?.stages || [];
            // A step that no longer exists must stay visible and selected, or
            // the control would silently read as "after all of it" while the
            // stored value still said otherwise.
            const missing = !!step && findTemplateStepIndex(tpl, step) < 0;
            const localMissing = !!localStep && findTemplateStepIndex(ownTemplate, localStep) < 0;
            return (
              <div key={name} className={styles.detailDepRow}>
                <span
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
                {/* Which point of that service unblocks this one. Only
                    offered where the service has a timeline to pick from —
                    one sized from its Rollout Time has no steps to wait for. */}
                {steps.length > 0 ? (
                  <select
                    className={styles.detailStepSelect}
                    value={step}
                    onChange={e => onCommit(setRefStep(value, name, e.target.value))}
                    title={`When ${selfName} can start relative to ${name}`}
                  >
                    <option value="">after all of {name}</option>
                    {steps.map(st => (
                      <option key={st.id} value={st.id}>after {st.name}</option>
                    ))}
                    {missing && <option value={step}>after a step that no longer exists</option>}
                  </select>
                ) : (
                  <span
                    className={styles.detailDepNoSteps}
                    title={`${name} has no timeline attached, so there are no steps to wait for — ${selfName} waits for all of it.`}
                  >after all of it</span>
                )}
                {/* And which step of THIS service is the one that waits.
                    Without it the whole band sits behind the prerequisite,
                    which drags the preparation with it — the inputs and the
                    kickoff don't need the other service's go-live, only the
                    work that follows them does. Naming that step anchors it
                    and lets everything before it overlap. */}
                {ownSteps.length > 0 && (
                  <select
                    className={styles.detailStepSelect}
                    value={localStep}
                    onChange={e => onCommit(setRefLocalStep(value, name, e.target.value))}
                    title={`Which step of ${selfName} is waiting. Anything before it can run alongside ${name}.`}
                  >
                    <option value="">— and all of {selfName} waits</option>
                    {ownSteps.map(st => (
                      <option key={st.id} value={st.id}>— and {st.name} is what waits</option>
                    ))}
                    {localMissing && <option value={localStep}>— and a step that no longer exists waits</option>}
                  </select>
                )}
              </div>
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
function StepDuration({ stage, onChange, groupNames, onSetGroup }) {
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
      {/* Which group heading this step sits under. A group is a run of
          consecutive steps sharing a name, so putting a step in one that
          isn't next to its other steps starts a second run of the same name
          — same heading, same colour, two bands. Moving the step with the
          arrows is what merges them. */}
      <select
        className={styles.detailStepGroupPick}
        value={String(stage.phase || '').trim()}
        aria-label={`Group for step: ${stage.name || 'untitled'}`}
        title="The group heading this step sits under"
        onChange={(e) => {
          const picked = e.target.value;
          if (picked !== '__new') { onSetGroup(picked); return; }
          const name = window.prompt('Name for the new group:', '');
          const trimmed = (name || '').trim();
          if (trimmed) onSetGroup(trimmed);
        }}
      >
        <option value="">No group</option>
        {groupNames.map(n => <option key={n} value={n}>{n}</option>)}
        <option value="__new">+ New group…</option>
      </select>
    </div>
  );
}

// The heading over a run of steps: the group's name, its colour, and how many
// steps are under it.
//
// Renaming rewrites the phase on every step in the run rather than editing a
// record of its own — a group IS the name its steps share, so there's nothing
// else to rename. The colour override travels with it, since overrides are
// keyed by name and leaving the old key behind would strand the colour.
function GroupHeader({ group, onRename, onRecolor, onUngroup }) {
  const [draft, setDraft] = useState(group.phase);
  const [seen, setSeen] = useState(group.phase);
  if (group.phase !== seen) { setSeen(group.phase); setDraft(group.phase); }

  function commit() {
    const next = draft.trim();
    if (!next) { setDraft(group.phase); return; }
    if (next === group.phase) return;
    onRename(next);
  }

  return (
    <div className={styles.detailGroupHead} style={{ borderLeftColor: group.color }}>
      <input
        type="color"
        className={styles.detailGroupSwatch}
        value={group.color}
        title={`Colour for “${group.phase}” — used for this heading and its band on the timeline`}
        aria-label={`Colour for group ${group.phase}`}
        onChange={(e) => onRecolor(e.target.value)}
      />
      <input
        type="text"
        className={styles.detailGroupName}
        style={{ color: group.color }}
        value={draft}
        aria-label={`Name of group ${group.phase}`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
          else if (e.key === 'Escape') { e.preventDefault(); setDraft(group.phase); e.currentTarget.blur(); }
        }}
      />
      <span className={styles.detailSectionCount}>{group.steps.length}</span>
      <button
        type="button"
        className={styles.serviceLinkEditBtn}
        onClick={onUngroup}
        title={`Take these ${group.steps.length} step${group.steps.length === 1 ? '' : 's'} out of “${group.phase}”. The steps stay; only the grouping goes.`}
      >Ungroup</button>
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
  // Stages and the group colours change together often enough — renaming a
  // group moves its override — that they need to land in one write.
  function writeTemplate(patch) {
    onSaveTemplates(templates.map(t => (t.id === active.id ? { ...t, ...patch } : t)));
  }

  // The runs of consecutive steps sharing a group name, with their colours.
  // The same grouper the chart bands with, so what's bracketed here is what
  // gets a band there.
  // Grouped separately either side of the signature, so a group never spans
  // the divide — the chart can't draw a band that starts before the contract
  // and finishes after it, and a heading that claimed to would be a lie.
  const preGroups = useMemo(
    () => groupStagesByPhase(stages.filter(s => s.preKickoff), active?.phaseColors),
    [stages, active?.phaseColors],
  );
  const postGroups = useMemo(
    () => groupStagesByPhase(stages.filter(s => !s.preKickoff), active?.phaseColors),
    [stages, active?.phaseColors],
  );
  // groupStagesByPhase numbers within the list it was handed, so the indexes
  // above are into the filtered arrays. Map them back to the real positions in
  // `stages`, which is what every edit addresses.
  const indexOfStage = useMemo(() => {
    const m = new Map();
    stages.forEach((s, i) => m.set(s.id, i));
    return m;
  }, [stages]);
  const groupNames = useMemo(() => phaseNames(stages), [stages]);
  const preCount = useMemo(() => stages.filter(s => s.preKickoff).length, [stages]);
  // The run-up section only appears once there's something in it, or once the
  // user has asked for it — a timeline with no pre-signature work shouldn't
  // carry an empty half.
  const [addingPre, setAddingPre] = useState(false);

  const signatureLabel = active?.signatureLabel || 'Contract signature';
  const [signatureDraft, setSignatureDraft] = useState(signatureLabel);
  const [seenSignature, setSeenSignature] = useState(signatureLabel);
  if (signatureLabel !== seenSignature) {
    setSeenSignature(signatureLabel);
    setSignatureDraft(signatureLabel);
  }
  function commitSignature() {
    const next = signatureDraft.trim();
    if (!next) { setSignatureDraft(signatureLabel); return; }
    if (next === signatureLabel) return;
    writeTemplate({ signatureLabel: next });
  }

  // The stages array IS the plan order — the chart numbers the steps from it
  // and stacks its rows in it — so the run-up has to physically precede the
  // engagement in the array, not just be flagged. Changing a step's side
  // moves it to the end of the run-up or the head of the engagement
  // accordingly; without that, a step added to the run-up drew first on the
  // chart but numbered last, and sat below every delivery row.
  function setStepSide(idx, preKickoff) {
    writeStages(setStagePreKickoff(stages, idx, preKickoff));
  }
  // Adding to either side. On a service with no timeline the timeline comes
  // into existence with the step, rather than making the user go build one on
  // another tab first and come back.
  function addStep(preKickoff) {
    if (!active) {
      const created = makeTimelineForService(serviceName);
      created.stages = [makeTimelineStage({ preKickoff })];
      setPickedId(created.id);
      onSaveTemplates([...templates, created]);
      return;
    }
    // A run-up step lands at the end of the run-up, not the end of the plan,
    // for the same reason: the array's order is the order the chart draws and
    // numbers in.
    const step = makeTimelineStage({ preKickoff });
    if (!preKickoff) { writeStages([...stages, step]); return; }
    const boundary = stages.findIndex(s => !s.preKickoff);
    const at = boundary === -1 ? stages.length : boundary;
    writeStages([...stages.slice(0, at), step, ...stages.slice(at)]);
  }

  function setStepGroup(idx, phase) {
    writeStages(stages.map((s, i) => (i === idx ? { ...s, phase } : s)));
  }

  // A group is the name its steps share, so renaming it is a rewrite across
  // that run — and the colour override, which is keyed by name, has to move
  // with it or the group silently reverts to its palette colour.
  function renameGroup(from, to) {
    const colors = { ...(active.phaseColors || {}) };
    if (colors[from]) { colors[to] = colors[from]; delete colors[from]; }
    writeTemplate({
      phaseColors: colors,
      stages: stages.map(s => (String(s.phase || '').trim() === from ? { ...s, phase: to } : s)),
    });
  }

  function recolorGroup(name, color) {
    writeTemplate({ phaseColors: { ...(active.phaseColors || {}), [name]: color } });
  }

  // Drops the grouping, keeps the steps. The colour override goes too — it
  // belongs to a group that no longer exists, and leaving it would silently
  // reapply itself to any later group that reused the name.
  function ungroup(name) {
    const colors = { ...(active.phaseColors || {}) };
    delete colors[name];
    writeTemplate({
      phaseColors: colors,
      stages: stages.map(s => (String(s.phase || '').trim() === name ? { ...s, phase: '' } : s)),
    });
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
    if (!canSwapStages(stages, idx, target)) return;
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

  // One section's worth of steps: the group headings and the runs under them.
  // Used for the run-up and the engagement alike, so the two read identically
  // and a group behaves the same whichever side of signature it's on.
  function renderRuns(runs) {
    return (
                <div className={styles.detailStepList}>
                  {runs.map((group, gi) => (
                    <Fragment key={group.phase || `ungrouped-${gi}`}>
                      {group.phase && (
                        <GroupHeader
                          group={group}
                          onRename={(to) => renameGroup(group.phase, to)}
                          onRecolor={(color) => recolorGroup(group.phase, color)}
                          onUngroup={() => ungroup(group.phase)}
                        />
                      )}
                      {/* The run itself, ruled in the group's colour so the steps
                          under a heading read as belonging to it — the same thing
                          the band's left edge does on the chart. */}
                      <ol
                        className={group.phase ? styles.detailStepGroup : styles.detailStepRun}
                        style={group.phase ? { borderLeftColor: group.color } : undefined}
                      >
                      {group.steps.map(({ stage }) => {
                        const idx = indexOfStage.get(stage.id);
                        return (
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
                          disabled={!canSwapStages(stages, idx, idx - 1)}
                          title={canSwapStages(stages, idx, idx - 1)
                            ? 'Move this step earlier'
                            : 'First step on this side of signature — use the button below to move it across'}
                          aria-label={`Move step ${idx + 1} earlier`}
                        >↑</button>
                        <button
                          type="button"
                          className={styles.serviceLinkEditBtn}
                          onClick={() => moveStep(idx, 1)}
                          disabled={!canSwapStages(stages, idx, idx + 1)}
                          title={canSwapStages(stages, idx, idx + 1)
                            ? 'Move this step later'
                            : 'Last step on this side of signature — use the button below to move it across'}
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
                        {/* Which side of signature the step is on. A button
                            rather than a checkbox: it moves the step between
                            the two sections, which is an action, not a
                            property to tick and then go hunting for. */}
                        <button
                          type="button"
                          className={styles.serviceLinkEditBtn}
                          onClick={() => setStepSide(idx, !stage.preKickoff)}
                          title={stage.preKickoff
                            ? `Move this into the engagement — after ${signatureLabel.toLowerCase()}`
                            : `Move this into the run-up — before ${signatureLabel.toLowerCase()}`}
                        >{stage.preKickoff ? '↓ After signature' : '↑ Before signature'}</button>
                      </div>
                      <StepDuration
                        stage={stage}
                        onChange={(next) => updateStep(idx, next)}
                        groupNames={groupNames}
                        onSetGroup={(phase) => setStepGroup(idx, phase)}
                      />
                    </li>
                        );
                      })}
                      </ol>
                    </Fragment>
                  ))}
                </div>
    );
  }

  // Editing a template attached to more than one service edits it for all of
  // them. Said out loud, because nothing else on this popup hints that the
  // steps in front of the user are shared.
  const alsoOn = (active?.services || []).filter(s => s.trim().toLowerCase() !== key);

  // Three of the things this editor sets are drawn by the implementation
  // format alone: the arrows between dependent steps, the bar length a
  // duration gives a step, and the signature rule the run-up sits before.
  // Timelines created here are that format, but one built earlier on the
  // Timelines tab, or switched since, may not be — and a control that draws
  // nothing looks like it didn't save. Only worth saying once the user has
  // actually set one of them.
  const implementationFormat = (active?.format || 'gantt') === 'phased';
  const unusedHere = implementationFormat ? [] : [
    stages.some(s => s.dependsOn) && 'the arrows between dependent steps',
    stages.some(s => s.duration !== '' && s.duration != null) && 'the length a duration gives a step',
    preCount > 0 && 'the contract signature line',
  ].filter(Boolean);

  return (
    <div className={styles.detailSection}>
      <div className={styles.detailSectionHead}>
        <span className={styles.detailSectionTitle}>Timeline steps</span>
        <span className={styles.detailSectionCount}>{stages.length}</span>
        <button type="button" className={styles.serviceLinkEditBtn} onClick={() => addStep(false)}>+ Add step</button>
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
          {unusedHere.length > 0 && (
            <p className={styles.detailStepShared}>
              “{active.name || 'Untitled timeline'}” is drawn in the {active.format === 'milestone' ? 'Milestone' : 'Gantt'} format,
              which doesn’t draw {unusedHere.length === 1
                ? unusedHere[0]
                : `${unusedHere.slice(0, -1).join(', ')} or ${unusedHere[unusedHere.length - 1]}`}.
              What you set here is saved either way; switch it to Implementation on the
              Timelines tab to see it drawn.
            </p>
          )}
          {/* The run-up: everything that has to happen before the contract
              is signed. Empty on every timeline that predates this, and it
              stays out of the way until there's something in it. */}
          {(preCount > 0 || addingPre) && (
            <div className={styles.detailPreSection}>
              <div className={styles.detailSectionHead}>
                <span className={styles.detailSectionTitle}>Before contract signature</span>
                <span className={styles.detailSectionCount}>{preCount}</span>
                <button type="button" className={styles.serviceLinkEditBtn} onClick={() => addStep(true)}>+ Add step</button>
              </div>
              {preCount === 0
                ? <p className={styles.detailEmpty}>Nothing yet — add the work that leads up to signature.</p>
                : renderRuns(preGroups)}
            </div>
          )}

          {/* The signature itself: the point the plan is built around, and
              the divide the chart draws. Named here because a deck doesn't
              always call it the same thing. */}
          <div className={styles.detailSignature}>
            <span className={styles.detailSignatureRule} />
            <input
              type="text"
              className={styles.detailSignatureName}
              value={signatureDraft}
              aria-label="What the contract signature point is called"
              title="The label drawn on the chart where the run-up ends and the engagement begins"
              onChange={(e) => setSignatureDraft(e.target.value)}
              onBlur={commitSignature}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
                else if (e.key === 'Escape') { e.preventDefault(); setSignatureDraft(active.signatureLabel); e.currentTarget.blur(); }
              }}
            />
            <span className={styles.detailSignatureRule} />
            {preCount === 0 && !addingPre && (
              <button
                type="button"
                className={styles.serviceLinkEditBtn}
                onClick={() => setAddingPre(true)}
                title="Add the work that happens before the contract is signed"
              >+ Add run-up</button>
            )}
          </div>

          {stages.length === 0 ? (
            <p className={styles.detailEmpty}>
              “{active.name || 'Untitled timeline'}” has no steps yet.
            </p>
          ) : postGroups.length === 0 ? (
            <p className={styles.detailEmpty}>Nothing after signature yet.</p>
          ) : renderRuns(postGroups)}
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
            {/* One field, not two: BFO Tag and Local Project Name always
                held the same tag, and the catalog now derives the Local
                Project Name from this value. */}
            <TextField label="BFO Tag / Local Project Name" value={meta?.bfoTag} onCommit={save('bfoTag')} />
            <SelectField
              label="Service Bucket"
              value={meta?.serviceBucket}
              options={SERVICE_BUCKETS}
              onCommit={save('serviceBucket')}
            />
            <TextField label="Region" value={meta?.region} onCommit={save('region')} />
            <TextField label="Years" value={meta?.years} onCommit={save('years')} />
            <TextField label="Service Type" value={meta?.serviceType} onCommit={save('serviceType')} />
            <TextField label="Product Line" value={meta?.productLine} onCommit={save('productLine')} />
            <YesNoField label="Timeline Driven" value={meta?.timelineDriven} onCommit={save('timelineDriven')} />
            <WeeksField label="Rollout Time" value={meta?.rolloutTime} onCommit={save('rolloutTime')} />
            <TextField label="SME" value={meta?.sme} onCommit={save('sme')} />
            <TextField label="KTM" value={meta?.ktm} onCommit={save('ktm')} />
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
            templates={templates}
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

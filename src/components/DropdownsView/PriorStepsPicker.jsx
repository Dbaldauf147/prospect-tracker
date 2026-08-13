import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { parseDependsOn, formatDependsOn } from '../../utils/timelineTemplatesStore';
import styles from './DropdownsView.module.css';

// "Waits on": which earlier steps a timeline step is gated on.
//
// A step can wait on more than one — a sign-off that needs both the data pull
// and the client's approval is gated on two — so this is a checklist rather
// than a single choice. It's shared by the two editors that set it: the
// Timelines tab's stage table, where it has one narrow cell, and the Services
// popup's step list. The list of steps is long enough and the space tight
// enough in the table that the checklist is portalled rather than inline; the
// same control then behaves identically in both places.
//
// Only steps ABOVE the one being edited are offered. A step waits on
// something earlier by definition, and the renderer draws each connector that
// way; a forward link would draw an arrow running backwards through the plan.
//
// `priorSteps` is [{ id, number, name }] in plan order. `value` is the stored
// comma-separated id list; `onChange` is handed the same shape back.
export function PriorStepsPicker({ priorSteps, value, onChange, compact = false, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState(null);
  const btnRef = useRef(null);

  const selected = useMemo(() => parseDependsOn(value), [value]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  // Only the picked ids that still name a step above this one. A predecessor
  // that was removed, or reordered to sit later, is dropped from the summary
  // rather than counted — the chart won't draw it either.
  const live = useMemo(
    () => priorSteps.filter(p => selectedSet.has(p.id)),
    [priorSteps, selectedSet],
  );

  function toggle(id) {
    const next = selectedSet.has(id)
      ? selected.filter(s => s !== id)
      // Held in plan order, so two steps waiting on the same pair read
      // identically and the stored string doesn't churn on re-pick.
      : priorSteps.filter(p => p.id === id || selectedSet.has(p.id)).map(p => p.id);
    onChange(formatDependsOn(next));
  }

  useEffect(() => {
    if (!open) return undefined;
    // Capture phase, and propagation stopped: this picker can be open inside
    // the Services popup, which closes itself on Escape from its own document
    // listener. Escape should shut the checklist first and leave the popup up.
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);

  // What the trigger says: nothing, the one step, or the numbers of the
  // several. Numbers rather than names once there's more than one — the names
  // don't fit any of the places this renders, and the number is what the
  // chart draws in the marker.
  const summary = live.length === 0
    ? '-'
    : live.length === 1
      ? `${live[0].number}. ${live[0].name || 'Untitled step'}`
      : `${live.length} steps: ${live.map(p => p.number).join(', ')}`;

  const title = disabled
    ? 'The first step has nothing before it to wait on'
    : live.length === 0
      ? 'Pick the earlier steps this one waits on'
      : `Waits on ${live.map(p => `${p.number}. ${p.name || 'Untitled step'}`).join(', ')}. Click to change.`;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled || priorSteps.length === 0}
        className={compact ? styles.dependsTriggerCompact : styles.dependsTrigger}
        title={title}
        onClick={(e) => {
          e.stopPropagation();
          const el = btnRef.current;
          if (el) setRect(el.getBoundingClientRect());
          setOpen(o => !o);
        }}
      >
        <span className={live.length === 0 ? styles.serviceMutedCell : undefined}>
          {compact ? summary : (live.length === 0 ? 'Waits on: nothing' : `Waits on: ${summary}`)}
        </span>
      </button>
      {open && rect && createPortal(
        <>
          {/* Click-away catcher. Stops its click as well as closing: this can
              sit inside the Services popup, whose overlay closes it on any
              click that reaches it. */}
          <div
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
            style={{ position: 'fixed', inset: 0, zIndex: 9600, background: 'transparent' }}
          />
          <div
            onClick={(e) => e.stopPropagation()}
            className={styles.dependsPop}
            style={{
              left: Math.max(8, Math.min(rect.left, window.innerWidth - 288)),
              ...(window.innerHeight - rect.bottom < 240 && rect.top > window.innerHeight - rect.bottom
                ? { bottom: Math.round(window.innerHeight - rect.top + 4) }
                : { top: Math.round(rect.bottom + 4) }),
            }}
          >
            <div className={styles.dependsPopHead}>
              <span>Waits on</span>
              {selected.length > 0 && (
                <button
                  type="button"
                  className={styles.serviceLinkEditBtn}
                  onClick={() => onChange('')}
                >Clear</button>
              )}
            </div>
            <div className={styles.dependsPopList}>
              {priorSteps.map(p => (
                <label key={p.id} className={styles.dependsPopRow}>
                  <input
                    type="checkbox"
                    checked={selectedSet.has(p.id)}
                    onChange={() => toggle(p.id)}
                  />
                  <span className={styles.dependsPopNum}>{p.number}</span>
                  <span className={styles.dependsPopName}>{p.name || 'Untitled step'}</span>
                </label>
              ))}
            </div>
            <div className={styles.dependsPopFoot}>
              <span>{live.length} selected</span>
              <button type="button" className={styles.serviceLinkEditBtn} onClick={() => setOpen(false)}>Done</button>
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

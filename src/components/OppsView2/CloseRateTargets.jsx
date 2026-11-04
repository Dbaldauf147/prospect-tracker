import { useEffect, useRef, useState } from 'react';
import { ColourPickDot } from '../common/ColourPickDot';
import { cleanTarget, nextTargetColour, targetLabel } from '../../utils/closeRateChartPrefs';
import styles from './CloseRateDeepDive.module.css';

// A chart's targets: a "Targets" button that opens a small editor, one row
// per target line (colour, %, optional name, remove) and "+ Add target".
// Rows are a draft while the menu is open; each change that leaves a valid
// list is handed to onChange, which saves it (utils/closeRateChartPrefs).

const newId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function TargetsMenu({ targets = [], onChange }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(() => targets.map(t => ({ ...t, value: String(t.value) })));
  const ref = useRef(null);

  // Opening starts from what is saved.
  const toggle = () => {
    if (!open) setRows(targets.map(t => ({ ...t, value: String(t.value) })));
    setOpen(v => !v);
  };
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  // Save the rows that have a valid value; a half-typed row waits.
  const commit = (next) => {
    setRows(next);
    onChange(next.filter(r => cleanTarget(r.value) != null).map(r => ({ ...r, value: cleanTarget(r.value) })));
  };
  const patch = (id, p, save = true) => {
    const next = rows.map(r => (r.id === id ? { ...r, ...p } : r));
    if (save) commit(next); else setRows(next);
  };
  const add = () => setRows(prev => [...prev, { id: newId(), value: '', colour: nextTargetColour(prev), name: '' }]);
  const remove = (id) => commit(rows.filter(r => r.id !== id));

  const count = targets.length;
  return (
    <div className={styles.targetsWrap} ref={ref}>
      <button
        type="button"
        className={styles.smallBtn}
        aria-expanded={open}
        onClick={toggle}
        title={count ? targets.map(targetLabel).join(', ') : 'Add target lines to this chart'}
      >
        {count > 0 && (
          <span className={styles.targetDots} aria-hidden="true">
            {targets.slice(0, 4).map(t => <span key={t.id} style={{ background: t.colour }} />)}
          </span>
        )}
        Targets{count ? ` (${count})` : ''} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className={styles.targetsMenu} role="dialog" aria-label="Targets">
          {rows.length === 0 && <div className={styles.savedEmpty}>No targets yet.</div>}
          {rows.map((r, i) => {
            const bad = r.value.trim() !== '' && cleanTarget(r.value) == null;
            return (
              <div key={r.id} className={styles.targetRow}>
                <ColourPickDot colour={r.colour} label={`target ${i + 1}`} size={12} onChange={(hex) => patch(r.id, { colour: hex })} />
                <input
                  className={bad ? `${styles.targetValue} ${styles.targetBad}` : styles.targetValue}
                  inputMode="decimal"
                  value={r.value}
                  placeholder="%"
                  aria-label={`Target ${i + 1} %`}
                  autoFocus={r.value === '' && i === rows.length - 1}
                  onChange={e => patch(r.id, { value: e.target.value }, false)}
                  onBlur={() => commit(rows)}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                />
                <span className={styles.muted}>%</span>
                <input
                  className={styles.targetName}
                  value={r.name}
                  placeholder="Name (optional)"
                  maxLength={40}
                  aria-label={`Target ${i + 1} name`}
                  onChange={e => patch(r.id, { name: e.target.value }, false)}
                  onBlur={() => commit(rows)}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                />
                <button type="button" className={styles.savedDelete} onClick={() => remove(r.id)} aria-label={`Remove target ${i + 1}`} title="Remove this target">×</button>
              </div>
            );
          })}
          {rows.some(r => r.value.trim() !== '' && cleanTarget(r.value) == null) && (
            <div className={styles.targetHint}>A target is a number from 0 to 100.</div>
          )}
          <button type="button" className={styles.targetAdd} onClick={add}>+ Add target</button>
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { parseMoney } from '../../utils/servicePricing';
import styles from './DropdownsView.module.css';

// The cell editors the two pricing subtabs share. Services Pricing edits the
// rate card with them and Deal Pricing edits the estimate, so they live here
// rather than in either tab: a rate typed on one and a count typed on the
// other should commit, cancel and refuse a bad number by exactly the same
// rules, and two copies of these would drift.

// Every cell in these tables edits something, so no click inside one should
// reach the row underneath it. Not exported: a non-component export here
// costs the file its fast refresh, and a caller that needs it is one line
// away from its own.
const swallow = (e) => e.stopPropagation();

// A number cell that shows a formatted figure and edits as a bare number.
// Commits on blur / Enter, cancels on Escape, and only writes when the value
// actually changed — clicking in and back out again can't blank a rate.
export function NumberCell({ value, display, placeholder, step = '1', title, onCommit }) {
  const [draft, setDraft] = useState(null);
  const inputRef = useRef(null);
  const editing = draft !== null;
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const initial = value === null || value === undefined ? '' : String(value);

  function commit() {
    const typed = (draft ?? '').trim();
    setDraft(null);
    if (typed === initial) return;
    if (typed === '') { onCommit(''); return; }
    const n = parseMoney(typed);
    // Not a number: leave what's stored alone rather than clearing it.
    if (n === null || n < 0) return;
    onCommit(n);
  }

  if (!editing) {
    return (
      <span
        onClick={(e) => { swallow(e); setDraft(initial); }}
        title={title}
        style={{ display: 'inline-block', width: '100%', cursor: 'text', minHeight: '1em' }}
      >
        {display || <span className={styles.serviceMutedCell}>-</span>}
      </span>
    );
  }
  return (
    <input
      ref={inputRef}
      type="number"
      min="0"
      step={step}
      inputMode="decimal"
      value={draft}
      placeholder={placeholder}
      onClick={swallow}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); setDraft(null); }
      }}
      style={{
        width: '100%', padding: '3px 6px',
        border: '1px solid var(--color-accent)', borderRadius: 4,
        fontSize: '0.75rem', fontFamily: 'inherit',
        background: '#fff', color: 'var(--color-text)', boxSizing: 'border-box',
      }}
    />
  );
}

// Free-text cell for the pricing notes — the assumptions behind a number,
// which is the part a rate on its own always loses.
export function NotesCell({ value, onCommit }) {
  const [draft, setDraft] = useState(null);
  const inputRef = useRef(null);
  const editing = draft !== null;
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  function commit() {
    const trimmed = (draft ?? '').trim();
    setDraft(null);
    if (trimmed === (value || '')) return;
    onCommit(trimmed);
  }

  if (!editing) {
    return (
      <span
        onClick={(e) => { swallow(e); setDraft(value || ''); }}
        title={value || 'Click to add a note'}
        style={{ display: 'inline-block', width: '100%', cursor: 'text', minHeight: '1em' }}
      >
        {value || <span className={styles.serviceMutedCell}>-</span>}
      </span>
    );
  }
  return (
    <input
      ref={inputRef}
      type="text"
      value={draft}
      onClick={swallow}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); setDraft(null); }
      }}
      style={{
        width: '100%', padding: '3px 6px',
        border: '1px solid var(--color-accent)', borderRadius: 4,
        fontSize: '0.75rem', fontFamily: 'inherit',
        background: '#fff', color: 'var(--color-text)', boxSizing: 'border-box',
      }}
    />
  );
}

// Which of the pricing bases a service is charged on. Clearing it takes the
// rate and floor with it (see setPricingField) — a rate with no basis has
// nothing to multiply.
export function BasisCell({ value, bases, onCommit }) {
  return (
    <select
      value={value || ''}
      onClick={swallow}
      onChange={(e) => { if (e.target.value !== (value || '')) onCommit(e.target.value); }}
      title="How this service is priced"
      style={{
        width: '100%', padding: '3px 4px',
        border: '1px solid transparent', borderRadius: 4,
        fontSize: '0.75rem', fontFamily: 'inherit',
        background: 'transparent', color: 'var(--color-text)',
        cursor: 'pointer', boxSizing: 'border-box',
      }}
    >
      <option value="">-</option>
      {bases.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
    </select>
  );
}

// One count box in the estimator bar. Held as text while the user types so a
// half-typed number doesn't re-run the whole estimate on every keystroke as
// a different figure; commits on blur / Enter.
export function CountInput({ label, value, onCommit, placeholder, wide, title }) {
  const [draft, setDraft] = useState(null);
  const shown = draft !== null ? draft : (value === '' || value == null ? '' : String(value));
  function commit() {
    if (draft === null) return;
    const typed = draft.trim();
    setDraft(null);
    onCommit(typed === '' ? '' : (parseMoney(typed) ?? ''));
  }
  return (
    <label className={styles.pricingField} title={title}>
      <span className={styles.pricingFieldLabel}>{label}</span>
      <input
        type="number"
        min="0"
        inputMode="decimal"
        className={wide ? styles.pricingInputWide : styles.pricingInput}
        placeholder={placeholder || '0'}
        value={shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
          else if (e.key === 'Escape') { e.preventDefault(); setDraft(null); e.currentTarget.blur(); }
        }}
      />
    </label>
  );
}

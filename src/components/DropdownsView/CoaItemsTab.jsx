import { useEffect, useRef, useState } from 'react';
import {
  loadCoaItemOptions, saveCoaItemOptions, COA_ITEM_OPTIONS_EVENT,
} from '../../utils/coaItemOptions';
import styles from './DropdownsView.module.css';

// The COA Items tab: the list of COA (Conditions of Approval) exceptions
// every opp is asked about.
//
// The Opp details page's Stage 6 tab carries a COA Approval Items table —
// one row per exception, with the date it was requested and the date it came
// back. Which exceptions those are used to be whatever had been typed on some
// earlier opp: "3% esc" shipped as the one row every opp started with, and
// anything typed into an item cell joined the dropdown for next time. That
// makes the list a by-product of typing, and it means an exception the team
// checks on every deal is only on the deals somebody remembered it on.
//
// So the list lives here, and every item on it shows as a row on every opp,
// carrying whatever that opp recorded against it. Nothing is written to an
// opp until somebody fills a date in or marks the row N/A, so adding an item
// here doesn't touch a single opp record — it just asks the question.
//
// Order matters: it is the order the rows appear in on every opp, which is
// why the rows move rather than sort themselves.
export function CoaItemsTab() {
  const [items, setItems] = useState(loadCoaItemOptions);
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState('');
  const addInputRef = useRef(null);

  // Another tab — or the Firestore mirror hydrating at login — can change the
  // list under us. Same refresh contract the opp table's datalist uses.
  useEffect(() => {
    const refresh = () => setItems(loadCoaItemOptions());
    window.addEventListener(COA_ITEM_OPTIONS_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(COA_ITEM_OPTIONS_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  useEffect(() => { if (adding) addInputRef.current?.focus(); }, [adding]);

  // Save first, then read back what the store made of it — the store trims,
  // drops blanks and de-dupes, so the rows on screen are the rows an opp will
  // show rather than what was typed at them.
  function commitList(next) {
    saveCoaItemOptions(next);
    setItems(loadCoaItemOptions());
  }

  function renameItem(idx, next) {
    const trimmed = next.trim();
    // An emptied cell is a removal — the same contract as an option row on
    // the Lists tab, so the two lists behave alike.
    if (!trimmed) { removeItem(idx); return; }
    if (trimmed === items[idx]) return;
    commitList(items.map((it, i) => (i === idx ? trimmed : it)));
  }

  function removeItem(idx) {
    const name = items[idx];
    // Worth a confirm: the item stops being asked on every opp at once.
    // Dates already recorded against it are safe — they stay on the opps that
    // recorded them — and that is what the message says, so the answer isn't
    // a guess about what is about to be lost.
    if (!window.confirm(
      `Remove "${name}" from the COA items?\n\n`
      + 'It stops appearing on opps that have recorded nothing against it. '
      + 'Opps that already carry dates or an N/A for it keep them.'
    )) return;
    commitList(items.filter((_, i) => i !== idx));
  }

  function moveItem(idx, delta) {
    const to = idx + delta;
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    [next[idx], next[to]] = [next[to], next[idx]];
    commitList(next);
  }

  function commitAdd() {
    const v = addDraft.trim();
    setAddDraft('');
    setAdding(false);
    if (!v) return;
    if (items.some(o => o.toLowerCase() === v.toLowerCase())) return;
    commitList([...items, v]);
  }

  return (
    <div className={styles.scroll}>
      <div className={styles.grid}>
        <div className={styles.card} style={{ gridColumn: 'span 2' }}>
          <div className={styles.cardHeader}>
            <span className={styles.cardTitle}>COA Approval Items</span>
            <span className={styles.cardCount}>{items.length}</span>
          </div>
          <div className={`${styles.cardBody} ${styles.questionsCardBody}`}>
            {items.length === 0 ? (
              <div className={styles.optionEmpty}>
                (no items — opps show an empty COA table until one is added)
              </div>
            ) : (
              items.map((item, idx) => (
                <CoaItemRow
                  key={`${idx}-${item}`}
                  value={item}
                  first={idx === 0}
                  last={idx === items.length - 1}
                  onCommit={(next) => renameItem(idx, next)}
                  onRemove={() => removeItem(idx)}
                  onMove={(delta) => moveItem(idx, delta)}
                />
              ))
            )}
            {adding ? (
              <input
                ref={addInputRef}
                type="text"
                value={addDraft}
                placeholder="e.g. Non-standard payment terms"
                onChange={(e) => setAddDraft(e.target.value)}
                onBlur={commitAdd}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
                  else if (e.key === 'Escape') {
                    e.preventDefault();
                    setAddDraft(''); setAdding(false);
                  }
                }}
                style={{
                  width: '100%', boxSizing: 'border-box', marginTop: 4,
                  padding: '3px 6px', border: '1px solid var(--color-border)',
                  borderRadius: 4, fontSize: '0.78rem', fontFamily: 'inherit',
                  color: 'var(--color-text)', background: '#fff',
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => setAdding(true)}
                style={{
                  marginTop: 6, padding: '0.25rem 0.6rem',
                  border: '1px dashed var(--color-border)', borderRadius: 6,
                  background: 'transparent', fontSize: '0.72rem', fontWeight: 500,
                  color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'inherit',
                }}
              >+ Add item</button>
            )}
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>How these are used</h3>
        <div style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)', lineHeight: 1.5, maxWidth: '46rem' }}>
          Every item here shows as a row in the <strong>COA Approval Items</strong> table on the
          Opp details <strong>Stage 6 — Negotiate to Win</strong> tab, on every opp. Record the
          date it was requested and the date it came back approved, or press <strong>N/A</strong>
          {' '}when it doesn't apply to that deal.
          <br /><br />
          Nothing is written to an opp until one of those happens, so adding an item here changes
          no records — it asks the question. An opp at <strong>Agreement Sent</strong> that still
          has items neither approved nor marked N/A carries the{' '}
          <strong>COA approvals needed</strong> flag, so the list is also the checklist that has
          to be clear before a signature comes back.
          <br /><br />
          An exception typed straight into an opp's table joins this list too, and an item removed
          here leaves the dates already recorded against it on the opps that recorded them.
        </div>
      </div>
    </div>
  );
}

// One item: rename in place (blur / Enter commits, Escape reverts, emptying
// removes), move up or down, or remove outright. Same feel as an option row
// on the Lists tab.
function CoaItemRow({ value, first, last, onCommit, onRemove, onMove }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  const arrow = {
    flex: '0 0 auto', width: 20, height: 20, lineHeight: 1, padding: 0,
    background: 'transparent', border: '1px solid transparent', borderRadius: 4,
    color: '#94A3B8', fontSize: '0.7rem', cursor: 'pointer', fontFamily: 'inherit',
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 0' }}>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onCommit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
          else if (e.key === 'Escape') { e.preventDefault(); setDraft(value); e.currentTarget.blur(); }
        }}
        style={{
          flex: 1, minWidth: 0, padding: '3px 6px',
          border: '1px solid transparent', borderRadius: 4,
          fontSize: '0.78rem', fontFamily: 'inherit',
          color: 'var(--color-text)', background: 'transparent',
        }}
        onFocus={(e) => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = 'var(--color-border)'; }}
        onBlurCapture={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}
      />
      <button
        type="button" style={arrow} disabled={first}
        onClick={() => onMove(-1)}
        title="Move up — the order here is the order the rows appear in on every opp"
      >▲</button>
      <button
        type="button" style={arrow} disabled={last}
        onClick={() => onMove(1)}
        title="Move down — the order here is the order the rows appear in on every opp"
      >▼</button>
      <button
        type="button" onClick={onRemove} title="Remove this COA item"
        style={{ ...arrow, fontSize: '0.9rem' }}
        onMouseEnter={(e) => { e.currentTarget.style.color = '#B91C1C'; e.currentTarget.style.borderColor = '#FCA5A5'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = '#94A3B8'; e.currentTarget.style.borderColor = 'transparent'; }}
      >×</button>
    </div>
  );
}

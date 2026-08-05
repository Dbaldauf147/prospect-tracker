// The running agenda for the Keith meeting, above the opps waiting on him.
//
// The list the tab below it shows is what the data says; this is what you mean
// to bring up. They're different things — a talking point ("PE overlap deals")
// isn't a row in the table — so the agenda is free text rather than anything
// derived from the opps.
//
// Lives in user settings, so it syncs across devices and survives a reload. The
// three starting lines are a default, not a seed write: an untouched agenda
// stores nothing, and only materializes on the first edit. That keeps an empty
// agenda (every line deleted) distinguishable from one never opened —
// `keithAgenda: []` means empty, absent means show the defaults.

import { useEffect, useRef, useState } from 'react';
import styles from './OppsView2.module.css';

const KEITH_AGENDA_DEFAULTS = [
  'Stage 6 deals',
  'Collaboration deals',
  'PE overlap deals',
  'Business travel',
  'New opportunities',
];

const newId = () => `ka_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// Settings → the rows to render. Anything malformed is dropped rather than
// thrown on: a half-written array from an older shape shouldn't blank the tab.
//
// Stable ids matter here, not just unique ones — this runs on every render, so
// minting a fresh id per call would rekey every line and pull the focus out of
// the input mid-edit. The defaults get fixed ids and a stored line with no id
// falls back to its position.
function readAgenda(settings) {
  const raw = settings?.keithAgenda;
  if (!Array.isArray(raw)) return KEITH_AGENDA_DEFAULTS.map((text, i) => ({ id: `ka_default_${i}`, text }));
  return raw
    .filter(it => it && typeof it === 'object' && typeof it.text === 'string')
    .map((it, i) => ({ id: it.id || `ka_row_${i}`, text: it.text }));
}

export function KeithAgenda({ settings, updateSettings }) {
  const items = readAgenda(settings);
  // Which line is open for editing, and the text as it's being typed. Held
  // here rather than written through on every keystroke — a settings write
  // per character would round-trip to Firestore and fight the cursor.
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState('');
  const editRef = useRef(null);
  // The id to focus once it renders — set when a line is opened for editing,
  // since the input doesn't exist yet at click time.
  const focusRef = useRef(null);

  useEffect(() => {
    if (editingId && focusRef.current === editingId && editRef.current) {
      editRef.current.focus();
      editRef.current.select();
      focusRef.current = null;
    }
  }, [editingId]);

  const commit = (next) => updateSettings({ keithAgenda: next.map(({ id, text }) => ({ id, text })) });

  function startEdit(item) {
    focusRef.current = item.id;
    setEditingId(item.id);
    setDraft(item.text);
  }

  // An edit that empties the line deletes it — the same gesture as clearing a
  // cell, and it saves hunting for the × when the point is just "drop this".
  function saveEdit() {
    if (!editingId) return;
    const text = draft.trim();
    const next = text
      ? items.map(it => (it.id === editingId ? { ...it, text } : it))
      : items.filter(it => it.id !== editingId);
    setEditingId(null);
    setDraft('');
    commit(next);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft('');
  }

  function addItem() {
    const text = adding.trim();
    if (!text) return;
    setAdding('');
    commit([...items, { id: newId(), text }]);
  }

  function removeItem(id) {
    commit(items.filter(it => it.id !== id));
  }

  // Swap a line with its neighbour. The order in the array is the order on the
  // page and the order stored, so there is nothing else to keep in step — and
  // reordering the untouched defaults materializes them, same as any edit.
  function move(id, dir) {
    const i = items.findIndex(it => it.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= items.length) return;
    const next = items.slice();
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  }

  return (
    <div className={styles.agendaWrap}>
      <div className={styles.agendaHead}>
        <span className={styles.agendaTitle}>Agenda</span>
        <span className={styles.agendaHint}>click a line to edit it</span>
      </div>
      {items.length > 0 && (
        <ol className={styles.agendaList}>
          {items.map((item, i) => (
            <li key={item.id} className={styles.agendaItem}>
              <div className={styles.agendaRow}>
                {editingId === item.id ? (
                  <input
                    ref={editRef}
                    className={styles.agendaEditInput}
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onBlur={saveEdit}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
                      if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                    }}
                  />
                ) : (
                  <>
                    <button
                      type="button"
                      className={styles.agendaText}
                      onClick={() => startEdit(item)}
                      title="Edit this line"
                    >
                      {item.text}
                    </button>
                    <button
                      type="button"
                      className={styles.agendaMove}
                      onClick={() => move(item.id, -1)}
                      disabled={i === 0}
                      title={`Move "${item.text}" up`}
                      aria-label={`Move ${item.text} up`}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      className={styles.agendaMove}
                      onClick={() => move(item.id, 1)}
                      disabled={i === items.length - 1}
                      title={`Move "${item.text}" down`}
                      aria-label={`Move ${item.text} down`}
                    >
                      ▼
                    </button>
                    <button
                      type="button"
                      className={styles.agendaRemove}
                      onClick={() => removeItem(item.id)}
                      title={`Remove "${item.text}"`}
                      aria-label={`Remove ${item.text}`}
                    >
                      ×
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      <div className={styles.agendaAddRow}>
        <input
          className={styles.agendaAddInput}
          type="text"
          placeholder="Add an agenda item…"
          value={adding}
          onChange={e => setAdding(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }}
        />
        <button type="button" className={styles.agendaAddBtn} onClick={addItem} disabled={!adding.trim()}>
          Add
        </button>
      </div>
    </div>
  );
}

export default KeithAgenda;

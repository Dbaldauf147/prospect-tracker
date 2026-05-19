import { useState, useMemo, useRef, useEffect } from 'react';
import { STAGE_AGE_GUIDANCE } from '../../data/dropdownLists';
import {
  BUILTIN_DROPDOWN_LISTS,
  getEffectiveDropdownLists,
} from '../../utils/dropdownListsStore';
import styles from './DropdownsView.module.css';

// Reference + edit page for the Dropdowns vocabulary that the rest of
// the app uses (Opps 2 column linking, Deals column linking). Each
// list card is now editable in-place: options commit on blur / Enter,
// the × button removes a single option, and "+ Add option" appends a
// new entry. Edits live under settings.dropdownLists so they sync
// across devices through Firestore.

// Single editable option row. Holds a local draft so typing is
// instant; the parent only learns about the change on commit (blur
// or Enter), which keeps Firestore writes per-edit not per-keystroke.
function OptionRow({ value, onCommit, onRemove }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  function commit() {
    const trimmed = draft.trim();
    if (trimmed === value) return; // no-op
    if (trimmed === '') { onRemove(); return; }
    onCommit(trimmed);
  }
  function cancel() {
    setDraft(value);
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 0' }}>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
          else if (e.key === 'Escape') { e.preventDefault(); cancel(); e.currentTarget.blur(); }
        }}
        style={{
          flex: 1, minWidth: 0,
          padding: '3px 6px',
          border: '1px solid transparent', borderRadius: 4,
          fontSize: '0.78rem', fontFamily: 'inherit',
          color: 'var(--color-text)', background: 'transparent',
        }}
        onFocus={(e) => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = 'var(--color-border)'; }}
        onBlurCapture={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}
      />
      <button
        type="button"
        onClick={onRemove}
        title="Remove this option"
        style={{
          flex: '0 0 auto',
          padding: '0', width: 20, height: 20, lineHeight: 1,
          background: 'transparent', border: '1px solid transparent', borderRadius: 4,
          color: '#94A3B8', fontSize: '0.9rem', cursor: 'pointer', fontFamily: 'inherit',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = '#B91C1C'; e.currentTarget.style.borderColor = '#FCA5A5'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = '#94A3B8'; e.currentTarget.style.borderColor = 'transparent'; }}
      >×</button>
    </div>
  );
}

// Single editable list card. Filters its option list to whatever
// matches the global search term but always edits against the full
// underlying array.
function ListCard({ list, filter, wide, onChange }) {
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState('');
  const addInputRef = useRef(null);

  useEffect(() => {
    if (adding) addInputRef.current?.focus();
  }, [adding]);

  function commitOption(idx, next) {
    const out = [...list.options];
    out[idx] = next;
    onChange(list.key, out);
  }
  function removeOption(idx) {
    const out = list.options.filter((_, i) => i !== idx);
    onChange(list.key, out);
  }
  function commitAdd() {
    const v = addDraft.trim();
    setAddDraft('');
    setAdding(false);
    if (!v) return;
    // No-op if the value already exists (case-insensitive).
    if (list.options.some(o => o.toLowerCase() === v.toLowerCase())) return;
    onChange(list.key, [...list.options, v]);
  }
  function cancelAdd() {
    setAddDraft('');
    setAdding(false);
  }

  const filterLower = filter.trim().toLowerCase();
  // Walk the original list so each entry keeps its real index — the
  // edit / remove handlers refer back to the underlying array, not
  // the filtered subset.
  const visible = list.options
    .map((opt, idx) => ({ opt, idx }))
    .filter(({ opt }) => !filterLower || String(opt).toLowerCase().includes(filterLower));

  return (
    <div className={styles.card} style={wide ? { gridColumn: 'span 2' } : undefined}>
      <div className={styles.cardHeader}>
        <span className={styles.cardTitle}>{list.label}</span>
        <span className={styles.cardCount}>{list.options.length}</span>
      </div>
      <div className={`${styles.cardBody} ${wide ? styles.cardBodyTall : ''}`}>
        {visible.length === 0 ? (
          <div className={styles.optionEmpty}>
            {list.options.length === 0 ? '— no options —' : '— no matches —'}
          </div>
        ) : (
          visible.map(({ opt, idx }) => (
            <OptionRow
              key={`${idx}-${opt}`}
              value={opt}
              onCommit={(next) => commitOption(idx, next)}
              onRemove={() => removeOption(idx)}
            />
          ))
        )}
        {adding && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 0' }}>
            <input
              ref={addInputRef}
              type="text"
              value={addDraft}
              placeholder="New option…"
              onChange={(e) => setAddDraft(e.target.value)}
              onBlur={commitAdd}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitAdd(); }
                else if (e.key === 'Escape') { e.preventDefault(); cancelAdd(); }
              }}
              style={{
                flex: 1, minWidth: 0,
                padding: '3px 6px',
                border: '1px solid var(--color-accent)', borderRadius: 4,
                fontSize: '0.78rem', fontFamily: 'inherit',
                color: 'var(--color-text)', background: '#fff',
              }}
            />
          </div>
        )}
      </div>
      <div style={{ padding: '0.3rem 0.6rem 0.5rem', borderTop: '1px solid var(--color-border-light)', background: 'var(--color-bg)' }}>
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={adding}
          style={{
            width: '100%', padding: '0.3rem 0.5rem',
            background: 'transparent',
            border: '1px dashed var(--color-border)', borderRadius: 4,
            fontSize: '0.72rem', fontWeight: 600, fontFamily: 'inherit',
            color: 'var(--color-text-muted)',
            cursor: adding ? 'default' : 'pointer',
            opacity: adding ? 0.5 : 1,
          }}
        >+ Add option</button>
      </div>
    </div>
  );
}

export function DropdownsView({ settings, updateSettings }) {
  const [search, setSearch] = useState('');
  const lists = useMemo(() => getEffectiveDropdownLists(settings), [settings?.dropdownLists]);

  // Save a list's full options array back to settings. We always
  // store the override even if the user happened to type the
  // built-in vocabulary back in — they may want to "lock" a list to
  // freeze it from future seed changes. Empty list overrides are
  // preserved (the user explicitly emptied it).
  function saveList(key, options) {
    const current = settings?.dropdownLists || {};
    const next = { ...current, [key]: options };
    updateSettings?.({ dropdownLists: next });
  }

  // Solutions is shown in a wide card; the other lists in the small
  // grid. Split here so the JSX below stays readable.
  const namedLists = lists.filter(l => l.key !== 'solutions');
  const solutions = lists.find(l => l.key === 'solutions');

  const term = search.trim().toLowerCase();
  // Hide cards whose label and options both fail the search filter.
  // Editing remains available on visible cards.
  const cardMatches = (list) => {
    if (!term) return true;
    if (list.label.toLowerCase().includes(term)) return true;
    return list.options.some(o => String(o).toLowerCase().includes(term));
  };
  const visibleNamed = namedLists.filter(cardMatches);
  const solutionsVisible = solutions && cardMatches(solutions);

  const totalOptions = useMemo(
    () => BUILTIN_DROPDOWN_LISTS.reduce((a, l) => {
      const ov = settings?.dropdownLists?.[l.key];
      return a + (Array.isArray(ov) ? ov.length : l.options.length);
    }, 0),
    [settings?.dropdownLists]
  );
  const shownOptions = useMemo(
    () => lists.reduce((a, l) => {
      if (!cardMatches(l)) return a;
      if (!term) return a + l.options.length;
      return a + l.options.filter(o => String(o).toLowerCase().includes(term)).length;
    }, 0),
    [lists, term]
  );

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <h2 className={styles.title}>Dropdowns</h2>
        <span className={styles.lastSync}>
          Edit the picklist vocabulary the Opps 2 and Deals tabs use when a column is linked to a list. Changes save automatically and sync across devices.
        </span>
      </div>

      <div className={styles.searchRow}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search options or list name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <span className={styles.resultCount}>
          {term ? `${shownOptions} of ${totalOptions} options` : `${totalOptions} options across ${BUILTIN_DROPDOWN_LISTS.length} lists`}
        </span>
      </div>

      <div className={styles.scroll}>
        <div className={styles.grid}>
          {visibleNamed.map(list => (
            <ListCard
              key={list.key}
              list={list}
              filter={search}
              onChange={saveList}
            />
          ))}

          {solutionsVisible && (
            <ListCard
              key={solutions.key}
              list={solutions}
              filter={search}
              wide
              onChange={saveList}
            />
          )}
        </div>

        {!term && (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Stage age guidance</h3>
            <table className={styles.guidanceTable}>
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>Max Target Age</th>
                  <th>Next Move</th>
                </tr>
              </thead>
              <tbody>
                {STAGE_AGE_GUIDANCE.map(row => (
                  <tr key={row.stage}>
                    <td>{row.stage}</td>
                    <td>{row.maxAge}</td>
                    <td>{row.nextMove}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

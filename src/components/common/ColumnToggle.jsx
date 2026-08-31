// The Columns popup: which columns show, which are starred as the user's
// own default view, which have been deleted out of the table, and (where
// the table can express it) what order they sit in.
//
// Lifted out of DataTable so a page that draws its own table can offer the
// same picker. The contacts pages do: they render a CSS-grid table of their
// own and had a plain checkbox list, which meant the same button did two
// different things depending on which tab you were looking at.
//
// Purely presentational — every piece of state is the caller's, and the
// rules behind it (what Reset restores, what starring implies) live in
// utils/tableColumnPrefs so both callers apply them identically.
import { useState, useRef, useEffect } from 'react';
import styles from './DataTable.module.css';

export function ColumnToggle({ columns, visibleCols, starredCols, removedColumns = [], onToggle, onStar, onRemove, onRestore, alwaysVisible, colNames, onRename, onReorder, removable, onResetColumns, align = 'left' }) {
  const [open, setOpen] = useState(false);
  const [editingKey, setEditingKey] = useState(null);
  const [editName, setEditName] = useState('');
  // Drag-to-reorder state: the key being dragged and the key it's
  // currently hovering over (for the drop-position highlight).
  const [dragKey, setDragKey] = useState(null);
  const [overKey, setOverKey] = useState(null);
  // Removable mode tucks hidden columns into a collapsed section so the
  // main list only shows the columns in play; this toggles it open.
  const [showHidden, setShowHidden] = useState(false);
  // Same, for the columns deleted out of the table.
  const [showRemoved, setShowRemoved] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function startRename(col) {
    setEditingKey(col.key);
    setEditName(colNames[col.key] || col.label);
  }

  function saveRename() {
    if (editingKey && editName.trim()) {
      onRename(editingKey, editName.trim());
    }
    setEditingKey(null);
  }

  // Drop `dragKey` at the position of `targetKey`, emit the full new
  // key order to the parent.
  function handleDrop(targetKey) {
    setOverKey(null);
    const from = dragKey;
    setDragKey(null);
    if (!from || from === targetKey || !onReorder) return;
    const keys = columns.map(c => c.key);
    const fromIdx = keys.indexOf(from);
    const toIdx = keys.indexOf(targetKey);
    if (fromIdx === -1 || toIdx === -1) return;
    keys.splice(fromIdx, 1);
    keys.splice(toIdx, 0, from);
    onReorder(keys);
  }

  const labelOf = (col) => colNames[col.key] || col.label;

  // The editable name field, shared by both modes.
  function renderName(col) {
    return editingKey === col.key ? (
      <input
        className={styles.colRenameInput}
        value={editName}
        onChange={e => setEditName(e.target.value)}
        onBlur={saveRename}
        onKeyDown={e => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setEditingKey(null); }}
        autoFocus
        onClick={e => e.stopPropagation()}
      />
    ) : (
      <span className={styles.colToggleLabel} onDoubleClick={() => startRename(col)}>
        {labelOf(col) || <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>(unnamed)</span>}
      </span>
    );
  }

  const dragHandle = (col) => onReorder && (
    <span
      draggable
      onDragStart={(e) => { setDragKey(col.key); e.dataTransfer.effectAllowed = 'move'; }}
      onDragEnd={() => { setDragKey(null); setOverKey(null); }}
      title="Drag to reorder"
      style={{ cursor: 'grab', color: 'var(--color-text-muted)', fontSize: '0.8rem', lineHeight: 1, userSelect: 'none', padding: '0 2px' }}
    >⠿</span>
  );

  // The star marks a column as part of the user's own default view: Reset
  // puts exactly the starred columns back. Shown on every row so the
  // default set is visible at a glance, not just discoverable by resetting.
  const starButton = (col) => {
    const starred = starredCols?.has(col.key);
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onStar(col.key); }}
        title={starred
          ? `${labelOf(col)} is one of your default columns: Reset brings it back. Click to unstar.`
          : `Make ${labelOf(col)} one of your default columns: Reset brings back every starred column and hides the rest.`}
        aria-label={starred ? `Unstar ${labelOf(col)}` : `Star ${labelOf(col)}`}
        aria-pressed={!!starred}
        style={{
          background: 'transparent', border: 'none', padding: '0 2px', lineHeight: 1,
          fontSize: '0.8rem', cursor: 'pointer',
          color: starred ? '#F59E0B' : 'var(--color-text-muted)',
          opacity: starred ? 1 : 0.45,
        }}
      >{starred ? '★' : '☆'}</button>
    );
  };

  const deleteButton = (col) => (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onRemove(col.key); }}
      title={`Delete ${labelOf(col)} from this table. It moves to the Deleted list at the bottom, where you can restore it.`}
      aria-label={`Delete ${labelOf(col)}`}
      style={{
        background: 'transparent', border: 'none', padding: '0 2px', lineHeight: 1,
        fontSize: '0.8rem', cursor: 'pointer', color: '#B91C1C', opacity: 0.7,
      }}
    >×</button>
  );

  const rowDragProps = (col) => onReorder ? {
    onDragOver: (e) => { e.preventDefault(); if (overKey !== col.key) setOverKey(col.key); },
    onDrop: () => handleDrop(col.key),
    style: {
      ...(dragKey === col.key ? { opacity: 0.4 } : null),
      ...(overKey === col.key && dragKey && dragKey !== col.key ? { borderTop: '2px solid var(--color-accent)' } : null),
    },
  } : {};

  // Active (shown) and hidden columns for removable mode. alwaysVisible
  // columns can never be removed, so they always live in the active list.
  const starCount = columns.filter(c => starredCols?.has(c.key)).length;
  const activeCols = removable ? columns.filter(c => visibleCols.has(c.key) || alwaysVisible?.includes(c.key)) : columns;
  const hiddenCols = removable ? columns.filter(c => !visibleCols.has(c.key) && !alwaysVisible?.includes(c.key)) : [];

  return (
    <div className={styles.colToggleWrap} ref={ref}>
      <button className={styles.colToggleBtn} onClick={() => setOpen(p => !p)}>
        Columns ({visibleCols.size}/{columns.length})
      </button>
      {open && (
        <div className={align === 'right' ? `${styles.colToggleDropdown} ${styles.colToggleDropdownRight}` : styles.colToggleDropdown}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '2px 6px 6px', borderBottom: '1px solid var(--color-border-light)', marginBottom: 4 }}>
            <span style={{ fontSize: '0.62rem', color: 'var(--color-text-muted)', lineHeight: 1.35 }} title={`★ marks your default columns${onReorder ? '. Drag ⠿ to reorder.' : ''} Reset shows the starred ones, hides the rest and restores anything deleted.`}>
              {starCount > 0
                ? `★ ${starCount} default${starCount === 1 ? '' : 's'} · Reset restores`
                : '★ = your defaults · Reset restores'}
            </span>
            {onResetColumns && (
              <button
                type="button"
                onClick={onResetColumns}
                style={{ background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.62rem', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '1px 6px', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                title={starCount > 0
                  ? `Show your ${starCount} starred column${starCount === 1 ? '' : 's'}, hide the rest, restore every deleted column and the default order`
                  : `Show every column${removedColumns.length ? ` (incl. ${removedColumns.length} deleted)` : ''} and restore the default order. Star columns first to reset to those instead.`}
              >{`Reset${removedColumns.length ? ` (${removedColumns.length} deleted)` : ''}`}</button>
            )}
          </div>

          {removable ? (
            <>
              {activeCols.map(col => {
                const locked = alwaysVisible?.includes(col.key);
                return (
                  <div key={col.key} className={styles.colToggleItem} {...rowDragProps(col)}>
                    {dragHandle(col)}
                    {starButton(col)}
                    {renderName(col)}
                    {locked ? (
                      <span title="This column can't be hidden or removed" style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem', padding: '0 2px' }}>🔒</span>
                    ) : (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <button
                          type="button"
                          onClick={() => onToggle(col.key)}
                          title="Hide this column: moves it to the Hidden list, where you can restore it with “+ Show”"
                          aria-label={`Hide ${labelOf(col)}`}
                          style={{ background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.62rem', fontWeight: 600, color: 'var(--color-text-muted)', cursor: 'pointer', padding: '1px 6px', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                        >Hide</button>
                        <button
                          type="button"
                          onClick={() => (onRemove ? onRemove(col.key) : onToggle(col.key))}
                          title="Remove this column from the table: it won’t show in the Hidden list. Restore it with Reset."
                          aria-label={`Remove ${labelOf(col)}`}
                          style={{ background: 'transparent', border: '1px solid #FECACA', borderRadius: 4, fontSize: '0.62rem', fontWeight: 600, color: '#B91C1C', cursor: 'pointer', padding: '1px 6px', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                        >Remove</button>
                      </span>
                    )}
                  </div>
                );
              })}

              {hiddenCols.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowHidden(s => !s)}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', textAlign: 'left', background: 'var(--color-surface-alt)', border: 'none', borderTop: '1px solid var(--color-border-light)', marginTop: 4, padding: '0.35rem 0.5rem', fontSize: '0.65rem', fontWeight: 700, color: 'var(--color-text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    <span style={{ fontSize: '0.6rem' }}>{showHidden ? '▾' : '▸'}</span>
                    Hidden columns ({hiddenCols.length})
                  </button>
                  {showHidden && hiddenCols.map(col => (
                    <div key={col.key} className={styles.colToggleItem} style={{ opacity: 0.85 }}>
                      <span className={styles.colToggleLabel} style={{ color: 'var(--color-text-muted)' }}>{labelOf(col)}</span>
                      <button
                        type="button"
                        onClick={() => onToggle(col.key)}
                        title="Restore this column"
                        style={{ background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.62rem', fontWeight: 600, color: 'var(--color-accent)', cursor: 'pointer', padding: '1px 6px', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                      >+ Show</button>
                    </div>
                  ))}
                </>
              )}
            </>
          ) : (
            columns.map(col => {
              const locked = alwaysVisible?.includes(col.key);
              return (
                <div key={col.key} className={styles.colToggleItem} {...rowDragProps(col)}>
                  {dragHandle(col)}
                  <input
                    type="checkbox"
                    checked={visibleCols.has(col.key)}
                    onChange={() => onToggle(col.key)}
                    disabled={locked}
                    title={locked ? "This column can't be hidden" : `Show / hide ${labelOf(col)}`}
                  />
                  {starButton(col)}
                  {renderName(col)}
                  {locked
                    ? <span title="This column can't be hidden or deleted" style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem', padding: '0 2px' }}>🔒</span>
                    : deleteButton(col)}
                </div>
              );
            })
          )}
          {removedColumns.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowRemoved(r => !r)}
                style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', textAlign: 'left', background: 'var(--color-surface-alt)', border: 'none', borderTop: '1px solid var(--color-border-light)', marginTop: 4, padding: '0.35rem 0.5rem', fontSize: '0.65rem', fontWeight: 700, color: 'var(--color-text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                <span style={{ fontSize: '0.6rem' }}>{showRemoved ? '▾' : '▸'}</span>
                Deleted columns ({removedColumns.length})
              </button>
              {showRemoved && removedColumns.map(col => (
                <div key={col.key} className={styles.colToggleItem} style={{ opacity: 0.85 }}>
                  <span className={styles.colToggleLabel} style={{ color: 'var(--color-text-muted)' }}>{labelOf(col)}</span>
                  <button
                    type="button"
                    onClick={() => onRestore(col.key)}
                    title="Put this column back in the table"
                    style={{ background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.62rem', fontWeight: 600, color: 'var(--color-accent)', cursor: 'pointer', padding: '1px 6px', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                  >+ Restore</button>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

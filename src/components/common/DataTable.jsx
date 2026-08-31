import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import styles from './DataTable.module.css';
import {
  resolveHiddenKeys, isColumnVisible, resetToStarred, applyStar, pickLegacyBucket,
} from '../../utils/tableColumnPrefs';

const COL_WIDTHS_PREFIX = 'prospect-col-widths-';
const COL_VISIBLE_PREFIX = 'prospect-col-visible-';
const COL_NAMES_PREFIX = 'prospect-col-names-';
const COL_ORDER_PREFIX = 'prospect-col-order-';
const COL_REMOVED_PREFIX = 'prospect-col-removed-';
// Columns the user has hidden, and the ones they've starred as their own
// default view. `visible` (the old model) is still read for the one-time
// conversion in resolveHiddenKeys — see utils/tableColumnPrefs.
const COL_HIDDEN_PREFIX = 'prospect-col-hidden-';
const COL_STARRED_PREFIX = 'prospect-col-starred-';

function loadColNames(tableId) {
  try { return JSON.parse(localStorage.getItem(COL_NAMES_PREFIX + tableId)) || {}; } catch { return {}; }
}
function saveColNames(tableId, names) { localStorage.setItem(COL_NAMES_PREFIX + tableId, JSON.stringify(names)); }

function loadColOrder(tableId) {
  try { const v = JSON.parse(localStorage.getItem(COL_ORDER_PREFIX + tableId)); return Array.isArray(v) ? v : []; } catch { return []; }
}
function saveColOrder(tableId, order) { localStorage.setItem(COL_ORDER_PREFIX + tableId, JSON.stringify(order)); }

// Reorder the columns array by a saved key order. Keys in `order` lead
// (in that order); any column not in the saved order — e.g. a column
// added to the code after the user last arranged the table — keeps its
// original relative position at the tail so it never goes missing.
function orderColumns(columns, order) {
  let out;
  if (!Array.isArray(order) || order.length === 0) {
    out = columns;
  } else {
    const byKey = new Map(columns.map(c => [c.key, c]));
    out = [];
    const used = new Set();
    for (const k of order) {
      const c = byKey.get(k);
      if (c) { out.push(c); used.add(k); }
    }
    for (const c of columns) {
      if (!used.has(c.key)) out.push(c);
    }
  }
  // A selection checkbox column always belongs at the far left, even when a
  // stale saved order (from before the column was added) would push it to
  // the tail. Non-mutating so the caller's array is untouched.
  const selIdx = out.findIndex(c => c.key === '__select__');
  if (selIdx > 0) out = [out[selIdx], ...out.slice(0, selIdx), ...out.slice(selIdx + 1)];
  return out;
}

function loadColWidths(tableId) {
  try { return JSON.parse(localStorage.getItem(COL_WIDTHS_PREFIX + tableId)) || {}; } catch { return {}; }
}
function saveColWidths(tableId, w) { localStorage.setItem(COL_WIDTHS_PREFIX + tableId, JSON.stringify(w)); }

// The pre-hidden-list visible set, as stored. Null when there's nothing to
// read: an empty array is the "no columns visible" state that renders a
// blank table, and reads as "no preference" the way it always has.
function loadColVisibleRaw(tableId) {
  try {
    const saved = JSON.parse(localStorage.getItem(COL_VISIBLE_PREFIX + tableId));
    return Array.isArray(saved) && saved.length > 0 ? saved : null;
  } catch { return null; }
}

// Removed columns (removableColumns mode only): keys the user has taken
// out of the table layout entirely. Unlike hidden columns these don't
// appear in the Columns dropdown's "Hidden" list — they come back only
// via Reset. Stored as a plain key array; absent / unparseable reads as
// "nothing removed".
function loadColRemoved(tableId) {
  try { const v = JSON.parse(localStorage.getItem(COL_REMOVED_PREFIX + tableId)); return new Set(Array.isArray(v) ? v : []); } catch { return new Set(); }
}
function saveColRemoved(tableId, set) { localStorage.setItem(COL_REMOVED_PREFIX + tableId, JSON.stringify([...set])); }

// Hidden / starred column keys. Both read back as plain arrays (or null when
// the table has no entry yet, which resolveHiddenKeys treats as "not set"
// rather than "nothing hidden" — the difference is what lets an old
// `visible` list still be honoured).
function loadColHidden(tableId) {
  try { const v = JSON.parse(localStorage.getItem(COL_HIDDEN_PREFIX + tableId)); return Array.isArray(v) ? v : null; } catch { return null; }
}
function saveColHidden(tableId, set) { localStorage.setItem(COL_HIDDEN_PREFIX + tableId, JSON.stringify([...set])); }
function loadColStarred(tableId) {
  try { const v = JSON.parse(localStorage.getItem(COL_STARRED_PREFIX + tableId)); return new Set(Array.isArray(v) ? v : []); } catch { return new Set(); }
}
function saveColStarred(tableId, set) { localStorage.setItem(COL_STARRED_PREFIX + tableId, JSON.stringify([...set])); }

// Every stranded prefs bucket for a table whose id used to encode its column
// list: `${tableId}:<column>|<column>|…`. Returns { id, keys } entries for
// pickLegacyBucket to choose between. Reads the visible-key lists, which is
// what the old model stored.
function legacyBucketsFor(tableId, remoteTablePrefs) {
  const entries = [];
  const seen = new Set();
  const prefix = `${tableId}:`;
  // The id itself lists the columns the table had when that layout was
  // saved, which is both the better match signal and — in the adoption
  // below — the way to tell a column the user hid from one that didn't
  // exist yet.
  const add = (id) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    entries.push({ id, keys: id.slice(prefix.length).split('|').filter(Boolean) });
  };
  for (const [id, entry] of Object.entries(remoteTablePrefs || {})) {
    if (id.startsWith(prefix) && entry && typeof entry === 'object') add(id);
  }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const storageKey = localStorage.key(i);
      if (!storageKey?.startsWith(COL_VISIBLE_PREFIX + prefix)) continue;
      add(storageKey.slice(COL_VISIBLE_PREFIX.length));
    }
  } catch { /* an unreadable localStorage just means nothing to adopt */ }
  return entries;
}

// Combobox-style per-column filter. Holds an array of "picked" values that
// the row's column value must match (substring). A text input drives both
// free-text search and an autocomplete dropdown of unique column values
// gathered from the visible row set; pressing Enter adds the typed value
// as a free-text chip, clicking a suggestion adds it as a chip.
// Parse a colFilters value into normalized {picks, draft}. Backwards
// compatible with the older array-only and string forms.
function readFilterValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return {
      picks: Array.isArray(value.picks) ? value.picks : [],
      draft: typeof value.draft === 'string' ? value.draft : '',
    };
  }
  if (Array.isArray(value)) return { picks: value, draft: '' };
  if (typeof value === 'string' && value.trim()) return { picks: [value.trim()], draft: '' };
  return { picks: [], draft: '' };
}
function writeFilterValue(picks, draft) {
  // Collapse to the simpler array form when there's no draft so the
  // shape stays clean for callers that haven't been updated.
  if (!draft) return picks;
  return { picks, draft };
}

// Hard cap on the dropdown list so a column with thousands of unique
// values doesn't ship a 10k-button popover. Past this, the footer
// nudges the user to type to narrow.
const FILTER_DROPDOWN_CAP = 500;

// Synthetic column-filter option (like Excel's) for matching a column's
// empty cells. Picking it filters the column down to rows whose value is
// blank. Compared case-insensitively; a cell counts as blank when it trims
// to the empty string.
const BLANKS_TOKEN = '(Blanks)';
const isBlanksToken = (p) => String(p ?? '').trim().toLowerCase() === BLANKS_TOKEN.toLowerCase();

function ColumnFilterCell({ value, onChange, suggestions, hasBlanks = false }) {
  const { picks, draft: incomingDraft } = readFilterValue(value);
  // We mirror the parent-controlled draft so typing feels instant
  // even when the parent re-render is async (e.g. inside a useMemo
  // chain). Sync down whenever the parent changes the draft.
  const [draft, setDraft] = useState(incomingDraft);
  useEffect(() => { setDraft(incomingDraft); }, [incomingDraft]);
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState(null);
  const wrapRef = useRef(null);
  const dropdownRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    function onDocMouseDown(e) {
      // Closes when the click lands outside both the filter cell and
      // the portal-rendered dropdown. Without checking the dropdown
      // too, the mousedown on a value button would close the dropdown
      // before the click reaches it.
      const inWrap = wrapRef.current && wrapRef.current.contains(e.target);
      const inDropdown = dropdownRef.current && dropdownRef.current.contains(e.target);
      if (!inWrap && !inDropdown) setOpen(false);
    }
    function reposition() {
      if (wrapRef.current) setAnchorRect(wrapRef.current.getBoundingClientRect());
    }
    document.addEventListener('mousedown', onDocMouseDown);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open]);

  function openDropdown() {
    if (wrapRef.current) setAnchorRect(wrapRef.current.getBoundingClientRect());
    setOpen(true);
  }

  const { matches, totalAvailable } = useMemo(() => {
    const q = draft.trim().toLowerCase();
    const seen = new Set(picks.map(p => p.toLowerCase()));
    const out = [];
    let totalAvailable = 0;
    // Offer the "(Blanks)" option first — only when the column actually has
    // empty cells and it isn't already picked. It matches an empty query or
    // anything the user types toward "(blanks)" / "blank".
    if (hasBlanks && !seen.has(BLANKS_TOKEN.toLowerCase())
        && (!q || BLANKS_TOKEN.toLowerCase().includes(q) || 'blanks'.includes(q))) {
      out.push(BLANKS_TOKEN);
      totalAvailable += 1;
    }
    for (const s of suggestions) {
      const sl = s.toLowerCase();
      if (seen.has(sl)) continue;
      if (q && !sl.includes(q)) continue;
      totalAvailable += 1;
      if (out.length < FILTER_DROPDOWN_CAP) out.push(s);
    }
    return { matches: out, totalAvailable };
  }, [suggestions, draft, picks, hasBlanks]);

  function pushDraft(next) {
    setDraft(next);
    onChange(writeFilterValue(picks, next));
  }
  function addPick(s) {
    const t = String(s || '').trim();
    if (!t) return;
    if (picks.some(p => p.toLowerCase() === t.toLowerCase())) {
      setDraft('');
      onChange(writeFilterValue(picks, ''));
      return;
    }
    setDraft('');
    onChange(writeFilterValue([...picks, t], ''));
  }
  function removePick(s) {
    onChange(writeFilterValue(picks.filter(p => p !== s), draft));
  }
  function onKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      // First match wins on Enter — picks the highlighted suggestion or
      // commits the typed text when nothing matches.
      if (matches.length > 0) addPick(matches[0]);
      else if (draft.trim()) addPick(draft);
    } else if (e.key === 'Backspace' && !draft && picks.length > 0) {
      removePick(picks[picks.length - 1]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      setOpen(true);
    }
  }

  // Portal-rendered dropdown: the sticky table header / horizontal
  // scroll container both clip absolutely-positioned children, so the
  // list disappeared under the table body. Fixed-positioning against
  // viewport coordinates side-steps that and lets the list be wider
  // than the (often narrow) filter column.
  const dropdownStyle = anchorRect ? (() => {
    const minWidth = Math.max(anchorRect.width, 220);
    const left = Math.min(anchorRect.left, window.innerWidth - minWidth - 8);
    const spaceBelow = window.innerHeight - anchorRect.bottom;
    const flipAbove = spaceBelow < 200 && anchorRect.top > spaceBelow;
    return {
      position: 'fixed',
      top: flipAbove ? undefined : anchorRect.bottom + 1,
      bottom: flipAbove ? window.innerHeight - anchorRect.top + 1 : undefined,
      left,
      minWidth,
      maxWidth: Math.min(420, window.innerWidth - left - 8),
      maxHeight: flipAbove ? Math.min(320, anchorRect.top - 8) : Math.min(320, spaceBelow - 8),
      zIndex: 10000,
      background: '#fff',
      border: '1px solid var(--color-border)',
      borderRadius: 4,
      overflowY: 'auto',
      boxShadow: '0 8px 24px rgba(15, 23, 42, 0.18)',
    };
  })() : null;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div
        onClick={openDropdown}
        style={{
          display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center',
          padding: '1px 3px',
          border: '1px solid var(--color-border)', borderRadius: 4,
          background: '#fff', minHeight: 22, cursor: 'text',
        }}
      >
        {picks.map(p => (
          <span
            key={p}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 2, background: '#DBEAFE', border: '1px solid #93C5FD', color: '#1E3A8A', borderRadius: 999, padding: '0 4px 0 6px', fontSize: '0.62rem', fontWeight: 600, lineHeight: 1.5, maxWidth: '100%' }}
            title={p}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>{p}</span>
            <button
              type="button"
              onClick={e => { e.stopPropagation(); removePick(p); }}
              style={{ background: 'transparent', border: 'none', color: '#1E3A8A', cursor: 'pointer', padding: 0, lineHeight: 1, fontSize: '0.85rem' }}
              title="Remove filter"
            >×</button>
          </span>
        ))}
        <input
          type="text"
          value={draft}
          onChange={e => { pushDraft(e.target.value); openDropdown(); }}
          onFocus={openDropdown}
          onKeyDown={onKeyDown}
          placeholder={picks.length === 0 ? 'Filter…' : ''}
          style={{ border: 'none', outline: 'none', flex: '1 0 60px', minWidth: 40, fontSize: '0.68rem', fontFamily: 'inherit', padding: '1px 2px', background: 'transparent' }}
        />
      </div>
      {open && dropdownStyle && createPortal(
        <div
          ref={dropdownRef}
          style={dropdownStyle}
          onMouseDown={e => e.preventDefault() /* keep input focused */}
        >
          {matches.length === 0 ? (
            <div style={{ padding: '6px 10px', fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
              {suggestions.length === 0 ? 'No values to filter by.' : 'No match: keep typing to filter.'}
            </div>
          ) : (
            <>
              {matches.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => addPick(s)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '4px 8px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.72rem', color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#F1F5F9'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  title={s}
                >{s}</button>
              ))}
              {totalAvailable > matches.length && (
                <div style={{ position: 'sticky', bottom: 0, padding: '4px 8px', fontSize: '0.65rem', color: 'var(--color-text-muted)', background: '#F8FAFC', borderTop: '1px solid var(--color-border-light)' }}>
                  Showing {matches.length} of {totalAvailable}: type to narrow.
                </div>
              )}
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

function ColumnToggle({ columns, visibleCols, starredCols, removedColumns = [], onToggle, onStar, onRemove, onRestore, alwaysVisible, colNames, onRename, onReorder, removable, onResetColumns }) {
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
        <div className={styles.colToggleDropdown}>
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

// Firestore rejects map field names that both start AND end with "__"
// (e.g. UploadedListView's helper columns __select__, __myAccountsList__).
// We prefix those keys with a sentinel before persisting and strip it
// back off on read so the rest of the app sees the original key.
const REMOTE_KEY_PREFIX = '_x_';
function encodeRemoteKey(k) {
  return /^__.*__$/.test(k) ? REMOTE_KEY_PREFIX + k : k;
}
function decodeRemoteKey(k) {
  return k.startsWith(REMOTE_KEY_PREFIX) ? k.slice(REMOTE_KEY_PREFIX.length) : k;
}
function encodeRemoteMap(m) {
  if (!m || typeof m !== 'object') return m;
  const out = {};
  for (const [k, v] of Object.entries(m)) out[encodeRemoteKey(k)] = v;
  return out;
}
function decodeRemoteMap(m) {
  if (!m || typeof m !== 'object') return m;
  const out = {};
  for (const [k, v] of Object.entries(m)) out[decodeRemoteKey(k)] = v;
  return out;
}

// When settings + updateSettings are provided, column prefs (widths,
// visibility, renames) are mirrored to Firestore at
// settings.tablePrefs[tableId]. Localstorage continues to be written
// as a fast/offline mirror. This makes the prefs survive a browser
// "Clear site data" — Firestore reseeds localStorage on the next
// load. Tables not wired to settings keep the legacy localStorage-only
// behavior.
function persistPrefs(tableId, settings, updateSettings, prefsUpdate) {
  if (prefsUpdate.widths !== undefined) saveColWidths(tableId, prefsUpdate.widths);
  if (prefsUpdate.names !== undefined) saveColNames(tableId, prefsUpdate.names);
  if (prefsUpdate.order !== undefined) saveColOrder(tableId, prefsUpdate.order);
  if (prefsUpdate.removed !== undefined) saveColRemoved(tableId, prefsUpdate.removed);
  if (prefsUpdate.hidden !== undefined) saveColHidden(tableId, prefsUpdate.hidden);
  if (prefsUpdate.starred !== undefined) saveColStarred(tableId, prefsUpdate.starred);
  if (!settings || !updateSettings || !tableId) return;
  const current = settings.tablePrefs?.[tableId] || {};
  const nextEntry = { ...current };
  if (prefsUpdate.widths !== undefined) nextEntry.widths = encodeRemoteMap(prefsUpdate.widths);
  if (prefsUpdate.names !== undefined) nextEntry.names = encodeRemoteMap(prefsUpdate.names);
  // Order is a plain array of column keys — stored as-is (no map-key
  // encoding needed, and keys like `_select` are fine as array values).
  if (prefsUpdate.order !== undefined) nextEntry.order = [...prefsUpdate.order];
  if (prefsUpdate.removed !== undefined) nextEntry.removed = [...prefsUpdate.removed];
  if (prefsUpdate.hidden !== undefined) nextEntry.hidden = [...prefsUpdate.hidden];
  if (prefsUpdate.starred !== undefined) nextEntry.starred = [...prefsUpdate.starred];
  updateSettings({
    tablePrefs: { ...(settings.tablePrefs || {}), [tableId]: nextEntry },
  });
}

/**
 * Reusable data table with resizable columns and column visibility toggle.
 *
 * Props:
 *   tableId      - unique string for persisting settings (e.g. 'main', 'accounts', 'hubspot')
 *   columns      - array of { key, label, defaultWidth, render(row) }
 *   rows         - array of data objects
 *   onSort       - (key) => void, optional
 *   sortConfig   - { key, direction }, optional
 *   alwaysVisible - array of column keys that can't be hidden
 *   onRowClick   - (row) => void, optional
 *   emptyMessage - string
 */
export function DataTable({
  tableId,
  columns,
  rows,
  onSort: externalSort,
  sortConfig: externalSortConfig,
  defaultSort,
  // Imperative sort trigger: { key, direction, nonce }. Bumping nonce
  // re-applies the given sort through the same path as a header click
  // (incl. the freeze snapshot). Lets a parent re-rank on demand
  // without owning sort state. Ignored when an external sort is wired.
  sortSignal,
  alwaysVisible = [],
  onRowClick,
  rowClassName,
  rowStyle,
  // Optional primary ordering, applied ahead of whatever sort is active:
  // rowGroup(row) returns a number and lower groups render first. Lets a
  // table pin a class of rows to the bottom — expired deals, say — no
  // matter which column the user sorts by, which a comparator on one
  // column can't do because the next header click replaces it. Stable:
  // rows within a group keep the order the sort gave them.
  rowGroup,
  // Inline expansion: when both are provided, rows whose id is in
  // expandedRowIds get a follow-up <tr> rendered immediately below
  // them with the JSX returned by renderExpansion(row). Virtualization
  // is disabled in this mode since expansion rows have variable height.
  expandedRowIds,
  renderExpansion,
  emptyMessage = 'No data found',
  exportFileName,
  exportPrimarySheetName,
  // Extra sheets appended to the exported workbook. Each entry is
  // { name, rows: [{ header: value }] }. Column widths auto-fit from
  // the row keys.
  exportExtraSheets,
  // When provided, clicking Export Excel calls onExport with the full
  // export context instead of running the default XLSX writer. Lets a
  // consumer render a fully-branded workbook (Schneider Electric
  // formatting, etc.) while reusing the table's sort / visibility /
  // rename state.
  onExport,
  // Extra buttons rendered beside Export Excel, as
  // [{ key, label, title, onClick, disabled }]. Kept as data rather than
  // nodes so they pick up the toolbar's own button styling and a consumer
  // can't drift from it.
  toolbarActions,
  // Column keys that should always land in the default Excel export even
  // when the user has hidden them on screen. Included in their natural
  // column order; ignored when a custom onExport is supplied.
  exportExtraColumnKeys,
  // When true, every visible column gets a compact text input under
  // its header. Rows are filtered (substring, case-insensitive) by
  // the raw cell value for each column that has a non-empty filter.
  enableColumnFilters = false,
  // Fires with the rows currently passing the in-table column filters,
  // so a parent can sync its own "select all visible" / "rows on
  // screen" UI against the same set the user sees.
  onFilteredRowsChange,
  // Fires with the rows in the exact order they're displayed (after
  // column filters AND the active sort). Same membership as
  // onFilteredRowsChange, but ordered — a parent that needs the visible
  // order (e.g. shift-click range selection) reads this instead.
  onDisplayedRowsChange,
  // Opt out of fixed-rowHeight virtualization. Consumers whose rows
  // can grow taller than a single line (Opps 2's Alt+Enter Next Steps,
  // Notes, etc.) set this so the table renders every row instead — the
  // JS spacer math assumes a constant row height, and a single tall
  // row breaks scrolling for everything below it. The browser still
  // skips painting off-screen rows via `content-visibility: auto`, so
  // scroll perf stays close to the virtualized path.
  variableRowHeight = false,
  // Optional Firestore-backed settings store. When provided, column
  // prefs (widths, visibility, renames) persist to settings.tablePrefs[tableId]
  // in addition to localStorage so they survive a clear-site-data.
  settings,
  updateSettings,
  // When true, the Columns dropdown lets the user remove columns (× →
  // collapsed "Hidden columns" section with restore) instead of the
  // classic checkbox show/hide list. Visibility still drives what
  // renders; this is purely a friendlier remove/restore affordance.
  removableColumns = false,
}) {
  const rawRemotePrefs = settings?.tablePrefs?.[tableId];
  const remotePrefs = useMemo(() => {
    if (!rawRemotePrefs) return rawRemotePrefs;
    return {
      ...rawRemotePrefs,
      widths: decodeRemoteMap(rawRemotePrefs.widths),
      names: decodeRemoteMap(rawRemotePrefs.names),
    };
  }, [rawRemotePrefs]);
  // settings._lastWriteAt is the canonical "Firestore subscription has
  // produced data" signal — it's stamped by every saveUserSettings call.
  // We use it to distinguish "Firestore has no entry for this table"
  // (don't sync, leave defaults / localStorage) from "Firestore is
  // still loading" (don't do anything; wait).
  const settingsLoaded = !!(settings && settings._lastWriteAt);
  const [colWidths, setColWidths] = useState(() => remotePrefs?.widths || loadColWidths(tableId));
  // What the user has hidden, as a stored list — null until they hide
  // something, which is what lets an older `visible` list still be read
  // (see resolveHiddenKeys). Storing hidden rather than visible is what
  // keeps a column added by an update from arriving pre-hidden.
  const [hiddenPref, setHiddenPref] = useState(() => (
    Array.isArray(remotePrefs?.hidden) ? remotePrefs.hidden : loadColHidden(tableId)
  ));
  // The pre-hidden-list visible set, read once so a layout saved under the
  // old model still shows the same columns.
  const [legacyVisible, setLegacyVisible] = useState(() => (
    Array.isArray(remotePrefs?.visible) && remotePrefs.visible.length > 0
      ? remotePrefs.visible
      : loadColVisibleRaw(tableId)
  ));
  // The user's own default view: Reset puts these back and hides the rest.
  const [starredCols, setStarredCols] = useState(() => (
    Array.isArray(remotePrefs?.starred) ? new Set(remotePrefs.starred) : loadColStarred(tableId)
  ));
  const [colNames, setColNames] = useState(() => remotePrefs?.names || loadColNames(tableId));
  const [colOrder, setColOrder] = useState(() => (
    Array.isArray(remotePrefs?.order) ? remotePrefs.order : loadColOrder(tableId)
  ));
  const [removedCols, setRemovedCols] = useState(() => (
    Array.isArray(remotePrefs?.removed) ? new Set(remotePrefs.removed) : loadColRemoved(tableId)
  ));
  const [colFilters, setColFilters] = useState({});
  const resizingRef = useRef(null);

  // Columns the user hasn't removed from the layout. Removed columns
  // (removableColumns mode) are dropped here so they don't render, don't
  // export, and don't appear in the Columns dropdown — they return only
  // via Reset. Tables without removable mode never populate removedCols,
  // so this is a no-op for them.
  const presentColumns = useMemo(
    () => (removedCols.size === 0 ? columns : columns.filter(c => !removedCols.has(c.key))),
    [columns, removedCols],
  );
  // The deleted ones, for the picker's restore list. Dropped from
  // presentColumns above, so the picker needs them handed over separately.
  const removedColumnList = useMemo(
    () => (removedCols.size === 0 ? [] : columns.filter(c => removedCols.has(c.key))),
    [columns, removedCols],
  );

  // The columns in the user's saved order (defaults to prop order). All
  // rendering — header, body, visibility list, export — runs off this.
  const orderedColumns = useMemo(() => orderColumns(presentColumns, colOrder), [presentColumns, colOrder]);

  // The hidden set, resolved from whichever of the two stored shapes this
  // table has (see utils/tableColumnPrefs), and the visible set the rest of
  // the table — header, body, export, the picker's checkboxes — reads.
  const hiddenColsSet = useMemo(
    () => resolveHiddenKeys({
      hidden: hiddenPref,
      legacyVisible,
      columnKeys: orderedColumns.map(c => c.key),
    }),
    [hiddenPref, legacyVisible, orderedColumns],
  );
  const visibleCols = useMemo(
    () => new Set(orderedColumns
      .filter(c => isColumnVisible(c.key, { hidden: hiddenColsSet, removed: removedCols, alwaysVisible }))
      .map(c => c.key)),
    [orderedColumns, hiddenColsSet, removedCols, alwaysVisible],
  );

  // Sync local state when Firestore-backed prefs arrive or change on
  // another device. Stringify-compare so we don't churn state when the
  // values are equivalent. Only acts once settings is loaded — guards
  // against an early-render where settings={} reads as "no entry"
  // and races with a later real value.
  useEffect(() => {
    if (!settingsLoaded) return;
    if (!remotePrefs) return;
    if (remotePrefs.widths && JSON.stringify(remotePrefs.widths) !== JSON.stringify(colWidths)) {
      setColWidths(remotePrefs.widths);
    }
    if (Array.isArray(remotePrefs.hidden)) {
      if (JSON.stringify(remotePrefs.hidden) !== JSON.stringify(hiddenPref)) setHiddenPref(remotePrefs.hidden);
    } else if (Array.isArray(remotePrefs.visible) && remotePrefs.visible.length > 0) {
      // A device that hasn't hidden anything since the model changed still
      // syncs its old visible list; convert on read, not on write.
      if (JSON.stringify(remotePrefs.visible) !== JSON.stringify(legacyVisible)) setLegacyVisible(remotePrefs.visible);
    }
    if (Array.isArray(remotePrefs.starred)) {
      const incoming = new Set(remotePrefs.starred);
      const same = incoming.size === starredCols.size && [...incoming].every(k => starredCols.has(k));
      if (!same) setStarredCols(incoming);
    }
    if (remotePrefs.names && JSON.stringify(remotePrefs.names) !== JSON.stringify(colNames)) {
      setColNames(remotePrefs.names);
    }
    if (Array.isArray(remotePrefs.order) && JSON.stringify(remotePrefs.order) !== JSON.stringify(colOrder)) {
      setColOrder(remotePrefs.order);
    }
    if (Array.isArray(remotePrefs.removed)) {
      const incoming = new Set(remotePrefs.removed);
      const same = incoming.size === removedCols.size && [...incoming].every(k => removedCols.has(k));
      if (!same) setRemovedCols(incoming);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded, remotePrefs]);

  // Tables that used to key their prefs on their column list (Deals, Sites,
  // the uploaded lists…) have stable ids now, which leaves their old layout
  // stranded under `${tableId}:<column>|<column>|…`. Adopt the closest one,
  // once, so this change doesn't itself cost the user the layout it exists
  // to protect. Runs only for a table with no prefs of its own, and only
  // once its columns are known — several build them from loaded data.
  const adoptedRef = useRef(false);
  useEffect(() => {
    if (adoptedRef.current) return;
    if (!tableId || columns.length === 0) return;
    if (settings && !settingsLoaded) return;
    const untouched = hiddenPref === null && legacyVisible === null
      && starredCols.size === 0 && removedCols.size === 0
      && colOrder.length === 0 && Object.keys(colWidths).length === 0;
    adoptedRef.current = true;
    if (!untouched) return;
    const buckets = legacyBucketsFor(tableId, settings?.tablePrefs);
    const columnKeys = columns.map(c => c.key);
    const legacyId = pickLegacyBucket(buckets, columnKeys);
    if (!legacyId) return;
    const legacyKnown = new Set(buckets.find(b => b.id === legacyId)?.keys || []);
    const remoteLegacy = settings?.tablePrefs?.[legacyId];
    const visible = Array.isArray(remoteLegacy?.visible) && remoteLegacy.visible.length > 0
      ? remoteLegacy.visible
      : loadColVisibleRaw(legacyId);
    const widths = decodeRemoteMap(remoteLegacy?.widths) || loadColWidths(legacyId);
    const names = decodeRemoteMap(remoteLegacy?.names) || loadColNames(legacyId);
    const order = Array.isArray(remoteLegacy?.order) ? remoteLegacy.order : loadColOrder(legacyId);
    const removed = Array.isArray(remoteLegacy?.removed) ? new Set(remoteLegacy.removed) : loadColRemoved(legacyId);
    // Hide what that layout hid — the columns it knew about and left out.
    // Columns it never saw are ones the page has gained since, so they
    // show rather than arriving pre-hidden.
    const hidden = resolveHiddenKeys({
      legacyVisible: visible,
      columnKeys: columnKeys.filter(k => legacyKnown.has(k)),
    });
    setHiddenPref([...hidden]);
    setColWidths(widths);
    setColNames(names);
    setColOrder(order);
    setRemovedCols(removed);
    persistPrefs(tableId, settings, updateSettings, { hidden, widths, names, order, removed });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId, columns, settingsLoaded]);

  function reorderCols(nextKeys) {
    setColOrder(nextKeys);
    persistPrefs(tableId, settings, updateSettings, { order: nextKeys });
  }
  // Reset: every deleted column back, the default order back, and
  // visibility set to the user's starred view — or to everything when they
  // haven't starred anything, which is what Reset has always done.
  function resetColumns() {
    const { hidden, removed } = resetToStarred({
      columnKeys: columns.map(c => c.key),
      starred: starredCols,
      alwaysVisible,
    });
    setHiddenPref([...hidden]);
    setLegacyVisible(null);
    setRemovedCols(removed);
    setColOrder([]);
    persistPrefs(tableId, settings, updateSettings, { hidden, removed, order: [] });
  }

  function renameCol(key, name) {
    setColNames(prev => {
      const next = { ...prev, [key]: name };
      persistPrefs(tableId, settings, updateSettings, { names: next });
      return next;
    });
  }

  // Built-in sort state (used when no external sort is provided)
  const [internalSort, setInternalSort] = useState(() => ({
    key: defaultSort?.key ?? null,
    direction: defaultSort?.direction === 'desc' ? 'desc' : 'asc',
  }));
  const sortConfig = externalSortConfig || internalSort;

  // Snapshot of row-id order captured when the user sorts by a column
  // flagged `freezeSortOrder`. While the snapshot is active, sortedRows
  // re-uses this order instead of re-running the comparator — so a
  // value edit that would otherwise re-rank the row (e.g. typing into
  // Follow Up while sorted by the computed Call In column) leaves the
  // row in place. Clicking the same header again resnapshots.
  const [sortSnapshot, setSortSnapshot] = useState(null);

  function applySort(key, direction) {
    setInternalSort({ key, direction });
    const col = colByKey.get(key);
    if (col?.freezeSortOrder) {
      const sortGetter = col.getSortValue;
      const sorted = [...filteredRows].sort((a, b) => {
        let aVal = sortGetter ? sortGetter(a) : a[key];
        let bVal = sortGetter ? sortGetter(b) : b[key];
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        const aNum = parseFloat(String(aVal).replace(/[,$%]/g, ''));
        const bNum = parseFloat(String(bVal).replace(/[,$%]/g, ''));
        if (!isNaN(aNum) && !isNaN(bNum)) {
          return direction === 'asc' ? aNum - bNum : bNum - aNum;
        }
        aVal = String(aVal).toLowerCase();
        bVal = String(bVal).toLowerCase();
        if (aVal < bVal) return direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return direction === 'asc' ? 1 : -1;
        return 0;
      });
      setSortSnapshot({
        key, direction,
        ids: sorted.map(r => (r?.id != null ? String(r.id) : null)).filter(Boolean),
      });
    } else {
      setSortSnapshot(null);
    }
  }

  function handleSort(key) {
    if (externalSort) {
      externalSort(key);
      return;
    }
    const isSame = internalSort.key === key;
    const nextDirection = isSame && internalSort.direction === 'asc' ? 'desc' : 'asc';
    applySort(key, nextDirection);
  }

  // Lets a parent imperatively trigger a sort (e.g. re-rank by Call In
  // after an edit) without taking over sort state. The parent bumps
  // `sortSignal.nonce` to fire; we apply the requested key + direction
  // through the same path as a header click, including the
  // freeze-snapshot capture for `freezeSortOrder` columns. Ignored when
  // an external sort controls the table.
  const lastSortNonce = useRef(sortSignal?.nonce);
  useEffect(() => {
    if (externalSort || externalSortConfig) return;
    const nonce = sortSignal?.nonce;
    if (nonce == null || nonce === lastSortNonce.current) return;
    lastSortNonce.current = nonce;
    if (sortSignal.key) {
      applySort(sortSignal.key, sortSignal.direction === 'desc' ? 'desc' : 'asc');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortSignal?.nonce]);

  // Sort rows internally if no external sort.
  // Apply per-column filters on top of the externally-filtered rows prop.
  // Each colFilters[key] is either a string (legacy) or array of strings
  // (chips from ColumnFilterCell). A row passes if, for each filtered
  // column, the cell value (case-insensitive) contains at least one of
  // the picked values. Columns that supply getFilterValue use that
  // instead of row[key] so derived/custom-render columns can still
  // filter on what the user actually sees.
  const colByKey = useMemo(() => {
    const m = new Map();
    for (const c of columns) m.set(c.key, c);
    return m;
  }, [columns]);
  const filteredRows = useMemo(() => {
    const active = [];
    for (const [key, raw] of Object.entries(colFilters)) {
      let picks = [];
      let draft = '';
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        if (Array.isArray(raw.picks)) picks = raw.picks.map(s => String(s || '').trim()).filter(Boolean);
        if (typeof raw.draft === 'string') draft = raw.draft.trim();
      } else if (Array.isArray(raw)) {
        picks = raw.map(s => String(s || '').trim()).filter(Boolean);
      } else if (typeof raw === 'string' && raw.trim()) {
        picks = [raw.trim()];
      }
      if (picks.length > 0 || draft.length > 0) active.push({ key, picks, draft });
    }
    if (active.length === 0) return rows;
    return rows.filter(row => {
      for (const { key, picks, draft } of active) {
        const col = colByKey.get(key);
        const getter = col?.getFilterValue;
        const raw = getter ? getter(row) : row[key];
        const hay = String(raw ?? '').toLowerCase();
        // Combine committed picks (OR) with the live-typed draft (also OR).
        // The row passes the column's filter if any pick matches as a
        // substring OR the draft matches as a substring. The "(Blanks)"
        // token is special: it matches only rows whose value is empty.
        const candidates = [...picks];
        if (draft) candidates.push(draft);
        if (!candidates.some(p => isBlanksToken(p) ? hay.trim() === '' : hay.includes(p.toLowerCase()))) return false;
      }
      return true;
    });
  }, [rows, colFilters, colByKey]);

  // Notify the consumer whenever the filtered-row set changes so it can
  // sync its own "select all visible" state against what's actually on
  // screen. Skipped when the prop isn't provided.
  useEffect(() => {
    if (onFilteredRowsChange) onFilteredRowsChange(filteredRows);
  }, [filteredRows, onFilteredRowsChange]);

  // Distinct values per column from the current row pool, used to feed
  // the column-filter autocomplete suggestions. Computed lazily and
  // cached so opening the dropdown is cheap on big lists.
  const filterSuggestions = useMemo(() => {
    const cache = new Map();
    return (key) => {
      if (cache.has(key)) return cache.get(key);
      const col = colByKey.get(key);
      const getter = col?.getFilterValue;
      const seen = new Set();
      const out = [];
      for (const row of rows) {
        const raw = getter ? getter(row) : row[key];
        const v = String(raw ?? '').trim();
        if (!v) continue;
        const lower = v.toLowerCase();
        if (seen.has(lower)) continue;
        seen.add(lower);
        out.push(v);
      }
      out.sort((a, b) => a.localeCompare(b));
      cache.set(key, out);
      return out;
    };
  }, [rows, colByKey]);

  // Whether a column has any blank cell in the current row pool — gates the
  // "(Blanks)" filter option so it only shows on columns that actually have
  // empties. Uses the same getFilterValue/row[key] source as the filter.
  const columnHasBlanks = useMemo(() => {
    const cache = new Map();
    return (key) => {
      if (cache.has(key)) return cache.get(key);
      const col = colByKey.get(key);
      const getter = col?.getFilterValue;
      let has = false;
      for (const row of rows) {
        const raw = getter ? getter(row) : row[key];
        if (String(raw ?? '').trim() === '') { has = true; break; }
      }
      cache.set(key, has);
      return has;
    };
  }, [rows, colByKey]);

  const baseSortedRows = useMemo(() => {
    if (externalSortConfig || !internalSort.key) return filteredRows;
    // When the active sort was captured against a `freezeSortOrder`
    // column, use the snapshotted ID order rather than re-running the
    // comparator. New rows (not in the snapshot) tail the list so they
    // remain visible until the next manual resort.
    if (
      sortSnapshot
      && sortSnapshot.key === internalSort.key
      && sortSnapshot.direction === internalSort.direction
    ) {
      const order = new Map();
      sortSnapshot.ids.forEach((id, i) => order.set(id, i));
      const fallback = sortSnapshot.ids.length;
      return [...filteredRows].sort((a, b) => {
        const ai = order.has(String(a?.id)) ? order.get(String(a.id)) : fallback;
        const bi = order.has(String(b?.id)) ? order.get(String(b.id)) : fallback;
        return ai - bi;
      });
    }
    // Columns can supply a getSortValue(row) that returns a number
    // (e.g. epoch ms for a date) — overrides the default raw-cell
    // numeric/string comparison so date columns sort chronologically
    // instead of as alphabetical text on the displayed format.
    const col = colByKey.get(internalSort.key);
    const sortGetter = col?.getSortValue;
    const sorted = [...filteredRows];
    sorted.sort((a, b) => {
      let aVal = sortGetter ? sortGetter(a) : a[internalSort.key];
      let bVal = sortGetter ? sortGetter(b) : b[internalSort.key];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      // Try numeric comparison
      const aNum = parseFloat(String(aVal).replace(/[,$%]/g, ''));
      const bNum = parseFloat(String(bVal).replace(/[,$%]/g, ''));
      if (!isNaN(aNum) && !isNaN(bNum)) {
        return internalSort.direction === 'asc' ? aNum - bNum : bNum - aNum;
      }
      // String comparison
      aVal = String(aVal).toLowerCase();
      bVal = String(bVal).toLowerCase();
      if (aVal < bVal) return internalSort.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return internalSort.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [filteredRows, internalSort, externalSortConfig, colByKey, sortSnapshot]);

  // Group ordering sits on top of the sort rather than inside it, so it
  // applies to all three exits above — unsorted, freeze snapshot, and the
  // comparator alike — and every consumer of the ordered rows (the table
  // body, the Excel export, the row count) sees the same arrangement.
  const sortedRows = useMemo(() => {
    if (!rowGroup) return baseSortedRows;
    // Decorate with the pre-group index so rows sharing a group keep the
    // order the sort just gave them. Array#sort is stable in modern
    // engines, but saying so explicitly beats depending on it.
    return baseSortedRows
      .map((row, i) => ({ row, i, group: Number(rowGroup(row)) || 0 }))
      .sort((a, b) => (a.group - b.group) || (a.i - b.i))
      .map(entry => entry.row);
  }, [baseSortedRows, rowGroup]);

  // Report the rows in their on-screen order (post-filter, post-sort) so a
  // parent can do order-aware work like shift-click range selection.
  useEffect(() => {
    if (onDisplayedRowsChange) onDisplayedRowsChange(sortedRows);
  }, [sortedRows, onDisplayedRowsChange]);

  const headerRef = useRef(null);
  const bodyRef = useRef(null);
  const firstRowRef = useRef(null);

  // Virtualization. Only render rows in (or near) the viewport when the
  // dataset is large enough that the savings outweigh the wrapper-row
  // overhead. Row height is measured from the first rendered row so the
  // spacers stay aligned even if the design's padding changes. Below
  // VIRTUALIZE_THRESHOLD, behavior is identical to the legacy table.
  const VIRTUALIZE_THRESHOLD = 50;
  const ROW_BUFFER = 8;
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [rowHeight, setRowHeight] = useState(33);

  function handleBodyScroll(e) {
    if (headerRef.current) headerRef.current.scrollLeft = e.target.scrollLeft;
    setScrollTop(e.target.scrollTop);
  }

  useEffect(() => {
    if (!bodyRef.current) return;
    const el = bodyRef.current;
    const update = () => setViewportHeight(el.clientHeight);
    update();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(update);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Measure row height once on first paint and freeze it. Re-measuring
  // on every render (or only ratcheting up) breaks scrolling on tables
  // with variable-height rows: when the user scrolls past a tall row
  // (e.g. an Opps 2 Next Steps cell with several Alt+Enter lines), that
  // row becomes the new firstRowRef, the estimate balloons, and the
  // virtualization spacer math drops the visible window into a "ghost"
  // zone where no rendered rows live. A single measurement avoids both
  // that bug and the original oscillation / infinite re-render loop the
  // ratcheting was meant to dodge — at the cost of slight under- or
  // over-estimation if the very first row isn't representative.
  const rowHeightMeasuredRef = useRef(false);
  useEffect(() => {
    if (rowHeightMeasuredRef.current) return;
    if (!firstRowRef.current) return;
    const h = firstRowRef.current.offsetHeight;
    if (h > 0) {
      rowHeightMeasuredRef.current = true;
      if (Math.abs(h - rowHeight) > 0.5) setRowHeight(h);
    }
  });

  const getWidth = (col) => colWidths[col.key] || col.defaultWidth || 120;
  // Filter to user-visible columns. Safety net: when the persisted
  // visibility set was saved against a different column lineup (e.g.
  // an older Firestore-synced list whose keys don't match the current
  // tableId), the filter can shrink to empty — at which point the
  // table renders as a blank panel even though `visibleCols.size`
  // looks healthy. Fall back to showing every column so the data is
  // never invisible. The user's toggle still works on the next
  // interaction; this just refuses to render an unusable empty state.
  let visibleColumns = orderedColumns.filter(c => visibleCols.has(c.key));
  if (visibleColumns.length === 0 && orderedColumns.length > 0) visibleColumns = orderedColumns;

  // Where each pinned column parks while the table scrolls sideways: the
  // summed width of the pinned columns to its left. Any column can carry
  // `sticky: true` and a table can pin several — without an offset they all
  // anchor at 0 and stack on top of each other.
  //
  // Measured off `visibleColumns` and the live widths, so hiding or resizing
  // a pinned column moves the ones after it rather than leaving a gap or an
  // overlap. The last pinned column keeps the edge shadow that separates the
  // frozen block from the scrolling one; the ones inside it don't, or the
  // block reads as several panes instead of one.
  const stickyLefts = new Map();
  let lastStickyKey = null;
  {
    let left = 0;
    for (const col of visibleColumns) {
      if (!col.sticky) continue;
      stickyLefts.set(col.key, left);
      lastStickyKey = col.key;
      left += getWidth(col);
    }
  }
  // `position` is restated here because the header cell sets
  // `position: relative` inline (for its resize handle) and an inline
  // declaration beats the class's `position: sticky`. A sticky box is itself
  // a positioned ancestor, so the handle still anchors to it.
  const stickyStyle = (col) => (col.sticky
    ? {
        position: 'sticky',
        left: stickyLefts.get(col.key),
        ...(col.key === lastStickyKey ? null : { boxShadow: 'none' }),
      }
    : null);

  // Persist the hidden set and drop the older visible list, so the table
  // stops reading the pre-conversion shape from here on.
  function commitHidden(nextHidden, extra) {
    setHiddenPref([...nextHidden]);
    setLegacyVisible(null);
    persistPrefs(tableId, settings, updateSettings, { hidden: nextHidden, ...extra });
  }

  function toggleCol(key) {
    if (alwaysVisible.includes(key)) return;
    const next = new Set(hiddenColsSet);
    if (next.has(key)) next.delete(key); else next.add(key);
    // Un-hiding a column that was deleted has to un-delete it too, or the
    // checkbox would tick with nothing appearing.
    const nextRemoved = new Set(removedCols);
    if (!next.has(key) && nextRemoved.delete(key)) {
      setRemovedCols(nextRemoved);
      commitHidden(next, { removed: nextRemoved });
      return;
    }
    commitHidden(next);
  }

  // Star / un-star a column: the starred set is the user's own default
  // view, restored by Reset. Starring shows the column, since a default
  // you can't see isn't one.
  function toggleStar(key) {
    const star = !starredCols.has(key);
    const next = applyStar({ key, star, starred: starredCols, hidden: hiddenColsSet, removed: removedCols });
    setStarredCols(next.starred);
    setRemovedCols(next.removed);
    setHiddenPref([...next.hidden]);
    setLegacyVisible(null);
    persistPrefs(tableId, settings, updateSettings, {
      starred: next.starred, hidden: next.hidden, removed: next.removed,
    });
  }

  // Delete a column from the layout. Unlike hiding it doesn't stay in the
  // picker's main list — it moves to the "Deleted" section, restorable from
  // there or with Reset.
  function removeCol(key) {
    if (alwaysVisible.includes(key)) return;
    // Drop any active filter on the column so it doesn't keep silently
    // filtering rows once its header (and filter input) are gone.
    setColFilters(prev => {
      if (!(key in prev)) return prev;
      const next = { ...prev }; delete next[key];
      return next;
    });
    const next = new Set(removedCols); next.add(key);
    setRemovedCols(next);
    persistPrefs(tableId, settings, updateSettings, { removed: next });
  }

  // Bring a deleted column back.
  function restoreCol(key) {
    const nextRemoved = new Set(removedCols);
    if (!nextRemoved.delete(key)) return;
    setRemovedCols(nextRemoved);
    // It was deleted, not hidden — restoring it should show it.
    const nextHidden = new Set(hiddenColsSet);
    nextHidden.delete(key);
    setHiddenPref([...nextHidden]);
    setLegacyVisible(null);
    persistPrefs(tableId, settings, updateSettings, { removed: nextRemoved, hidden: nextHidden });
  }

  const handleResizeStart = useCallback((e, colKey) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = colWidths[colKey] || columns.find(c => c.key === colKey)?.defaultWidth || 120;
    resizingRef.current = colKey;

    function onMouseMove(ev) {
      const diff = ev.clientX - startX;
      const newWidth = Math.max(50, startWidth + diff);
      setColWidths(prev => {
        const next = { ...prev, [colKey]: newWidth };
        persistPrefs(tableId, settings, updateSettings, { widths: next });
        return next;
      });
    }

    function onMouseUp() {
      resizingRef.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [colWidths, columns, tableId, settings, updateSettings]);

  return (
    <div className={styles.outerWrap}>
      <div className={styles.toolbar}>
        <ColumnToggle
          columns={orderedColumns}
          visibleCols={visibleCols}
          starredCols={starredCols}
          removedColumns={removedColumnList}
          onToggle={toggleCol}
          onStar={toggleStar}
          onRemove={removeCol}
          onRestore={restoreCol}
          alwaysVisible={alwaysVisible}
          colNames={colNames}
          onRename={renameCol}
          onReorder={reorderCols}
          removable={removableColumns}
          onResetColumns={resetColumns}
        />
        <button className={styles.resetBtn} onClick={() => { setColWidths({}); persistPrefs(tableId, settings, updateSettings, { widths: {} }); }}>
          Reset widths
        </button>
        <button className={styles.exportBtn} onClick={async () => {
          if (typeof onExport === 'function') {
            onExport({
              columns: visibleColumns,
              rows: sortedRows,
              colNames,
              extraSheets: exportExtraSheets,
            });
            return;
          }
          const XLSX = await import('xlsx');
          // Start from the on-screen columns, then fold in any
          // exportExtraColumnKeys the caller wants in the file even when
          // hidden — kept in natural column order via orderedColumns.
          const extraKeys = new Set(exportExtraColumnKeys || []);
          let exportCols = extraKeys.size
            ? orderedColumns.filter(c => visibleCols.has(c.key) || alwaysVisible.includes(c.key) || extraKeys.has(c.key))
            : visibleColumns;
          if (exportCols.length === 0 && orderedColumns.length > 0) exportCols = orderedColumns;
          const data = sortedRows.map(row => {
            const obj = {};
            for (const col of exportCols) {
              const label = colNames[col.key] || col.label;
              let val;
              // Columns with derived data (e.g. values stored under
              // __electricCost__ while the column key is electricCost)
              // can provide an exportValue mapper so the export matches
              // what's on screen.
              if (typeof col.exportValue === 'function') {
                val = col.exportValue(row);
              } else {
                val = row[col.key];
                // Render-only columns hold nothing on the row — mapping
                // cells like __myAccountsList__ derive what they show from
                // lookups, so row[col.key] is undefined and the cell
                // exported blank. getFilterValue already returns exactly
                // the visible text (it's what column filtering matches
                // against), so fall back to it before giving up.
                if ((val == null || val === '') && typeof col.getFilterValue === 'function') {
                  const derived = col.getFilterValue(row);
                  if (derived != null && typeof derived !== 'object') val = derived;
                }
              }
              obj[label] = Array.isArray(val) ? val.join(', ') : (val ?? '');
            }
            return obj;
          });
          const ws = XLSX.utils.json_to_sheet(data);
          ws['!cols'] = exportCols.map(col => ({ wch: Math.max((colNames[col.key] || col.label).length, 12) }));
          const wb = XLSX.utils.book_new();
          const primarySheetName = (exportPrimarySheetName || exportFileName || tableId || 'Export').replace(/[\\/:*?\[\]]+/g, '-').slice(0, 31);
          XLSX.utils.book_append_sheet(wb, ws, primarySheetName);
          if (Array.isArray(exportExtraSheets)) {
            for (const extra of exportExtraSheets) {
              if (!extra || !Array.isArray(extra.rows) || extra.rows.length === 0) continue;
              const extraWs = XLSX.utils.json_to_sheet(extra.rows);
              const extraHeaders = Object.keys(extra.rows[0]);
              extraWs['!cols'] = extraHeaders.map(h => ({ wch: Math.max(h.length + 2, 14) }));
              const extraName = String(extra.name || 'Sheet').replace(/[\\/:*?\[\]]+/g, '-').slice(0, 31);
              XLSX.utils.book_append_sheet(wb, extraWs, extraName);
            }
          }
          const safeName = (exportFileName || tableId || 'export').replace(/[\\/:*?"<>|]+/g, '-');
          XLSX.writeFile(wb, `${safeName} - ${new Date().toISOString().slice(0, 10)}.xlsx`);
        }}>
          Export Excel
        </button>
        {(toolbarActions || []).map(action => (
          <button
            key={action.key || action.label}
            className={styles.exportBtn}
            // .exportBtn carries margin-left:auto so Export Excel floats
            // right of the column controls. Extra actions sit flush against
            // it instead of each claiming the free space again.
            style={{ marginLeft: 0 }}
            title={action.title}
            disabled={action.disabled}
            onClick={action.onClick}
          >{action.label}</button>
        ))}
        {/* Defensive row-count indicator: surfaces what the table
            actually sees right next to the export controls. If the
            parent says 'showing 42' but this badge shows '0 rows',
            the bug is upstream of the table; if it shows '42 rows'
            but the body is blank, the bug is in the body render. */}
        <span
          title={`${sortedRows.length} of ${rows.length} rows rendered`}
          style={{ marginLeft: 'auto', padding: '0.25rem 0.5rem', borderRadius: 4, background: sortedRows.length === 0 ? '#FEF3C7' : '#F1F5F9', color: sortedRows.length === 0 ? '#92400E' : '#475569', fontSize: '0.65rem', fontWeight: 600 }}
        >
          {sortedRows.length} row{sortedRows.length === 1 ? '' : 's'}
        </span>
      </div>
      {/* Always render the table header + body shell so the column
          headers stay visible when a search / column filter zeros out
          the rows — users need to see which columns exist (and clear
          their filter) instead of staring at a blank panel. */}
      <>
        <div className={styles.headerWrap} ref={headerRef}>
            <table className={styles.table} style={{ tableLayout: 'fixed', width: visibleColumns.reduce((s, c) => s + getWidth(c), 0) }}>
              <colgroup>
                {visibleColumns.map(col => (
                  <col key={col.key} style={{ width: getWidth(col) }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {visibleColumns.map(col => {
                    const headerLabel = colNames[col.key] || col.label;
                    // Native hover tooltip on every header so users can
                    // read the full column name even when the cell text
                    // is truncated by the fixed column width. A column may
                    // supply its own `headerTitle` (e.g. a warning column
                    // listing which rows the ⚠ flag is for), which takes
                    // precedence over the plain label.
                    const headerTitle = col.headerTitle || (typeof headerLabel === 'string' ? headerLabel : undefined);
                    return (
                    <th
                      key={col.key}
                      style={{ width: getWidth(col), position: 'relative', ...stickyStyle(col) }}
                      onClick={() => handleSort(col.key)}
                      className={col.sticky ? styles.stickyCol : undefined}
                      title={headerTitle}
                    >
                      {col.renderHeader
                        ? col.renderHeader(headerLabel)
                        : headerLabel}
                      {sortConfig?.key === col.key && (
                        <span className={styles.sortArrow}>
                          {sortConfig.direction === 'asc' ? '\u25B2' : '\u25BC'}
                        </span>
                      )}
                      <span
                        className={styles.resizeHandle}
                        onMouseDown={e => handleResizeStart(e, col.key)}
                        onClick={e => e.stopPropagation()}
                      />
                    </th>
                    );
                  })}
                </tr>
                {enableColumnFilters && (
                  <tr>
                    {visibleColumns.map(col => {
                      // Skip filtering on the leftmost helper / select / row-action
                      // columns. Their key starts with "_" by convention.
                      const filterable = !String(col.key || '').startsWith('_') || !!col.getFilterValue;
                      return (
                        <th
                          key={col.key}
                          style={{ width: getWidth(col), padding: '2px 4px', background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border-light)', ...stickyStyle(col) }}
                          onClick={e => e.stopPropagation()}
                          className={col.sticky ? styles.stickyCol : undefined}
                        >
                          {filterable ? (
                            <ColumnFilterCell
                              value={colFilters[col.key]}
                              onChange={(next) => setColFilters(prev => {
                                const out = { ...prev };
                                if (Array.isArray(next) && next.length === 0) delete out[col.key];
                                else out[col.key] = next;
                                return out;
                              })}
                              suggestions={filterSuggestions(col.key)}
                              hasBlanks={columnHasBlanks(col.key)}
                            />
                          ) : null}
                        </th>
                      );
                    })}
                  </tr>
                )}
              </thead>
            </table>
          </div>
          {sortedRows.length === 0 ? (
            // Wrap the empty message in a scrollable container the
            // same width as the column total so horizontal scrolling
            // still works when a filter narrows the view to zero rows
            // (the user can otherwise lose access to off-screen
            // columns just because no rows match the current filter).
            // Syncs scrollLeft to the header so the column titles
            // track the user's pan even with no body rows.
            <div className={styles.scrollWrap} ref={bodyRef} onScroll={handleBodyScroll}>
              <div style={{ minWidth: visibleColumns.reduce((s, c) => s + getWidth(c), 0) }}>
                <div className={styles.empty}>{emptyMessage}</div>
              </div>
            </div>
          ) : (() => {
            const total = sortedRows.length;
            const expandable = typeof renderExpansion === 'function';
            const expandedSet = expandable
              ? (expandedRowIds instanceof Set ? expandedRowIds : new Set(expandedRowIds || []))
              : null;
            // Expansion rows have variable height and would corrupt the
            // fixed-rowHeight virtualization math; render every row when
            // expansion is enabled.
            const virtualize = !expandable && !variableRowHeight && total > VIRTUALIZE_THRESHOLD && rowHeight > 0;
            let startIdx = 0;
            let endIdx = total;
            if (virtualize) {
              const visibleCount = Math.max(1, Math.ceil(viewportHeight / rowHeight));
              startIdx = Math.max(0, Math.floor(scrollTop / rowHeight) - ROW_BUFFER);
              endIdx = Math.min(total, startIdx + visibleCount + ROW_BUFFER * 2);
            }
            let topPad = virtualize ? startIdx * rowHeight : 0;
            let bottomPad = virtualize ? Math.max(0, (total - endIdx) * rowHeight) : 0;
            let visibleRows = virtualize ? sortedRows.slice(startIdx, endIdx) : sortedRows;
            // Belt-and-braces: if the virtualization math ever produces
            // an empty slice while data exists (stale scrollTop after
            // a dataset shrinks, weird rowHeight measurement, etc.),
            // render everything rather than show a blank body.
            if (visibleRows.length === 0 && total > 0) {
              visibleRows = sortedRows;
              topPad = 0;
              bottomPad = 0;
            }
            return (
              <div className={styles.scrollWrap} ref={bodyRef} onScroll={handleBodyScroll}>
                <table className={styles.table} style={{ tableLayout: 'fixed', width: visibleColumns.reduce((s, c) => s + getWidth(c), 0) }}>
                  <colgroup>
                    {visibleColumns.map(col => (
                      <col key={col.key} style={{ width: getWidth(col) }} />
                    ))}
                  </colgroup>
                  <tbody>
                    {topPad > 0 && (
                      <tr aria-hidden="true" style={{ height: topPad }}>
                        <td colSpan={visibleColumns.length} style={{ padding: 0, border: 'none' }} />
                      </tr>
                    )}
                    {visibleRows.map((row, ri) => {
                      const absoluteIdx = startIdx + ri;
                      const rowKey = row.id ?? absoluteIdx;
                      // Compute the rowStyle once and apply it to both
                      // the <tr> AND every <td>: tr-level backgrounds
                      // can't tint cells whose CSS sets an explicit
                      // background (e.g. the sticky Account column), so
                      // mirroring the style onto each cell guarantees
                      // visible row tints on `.stickyCol` too.
                      const computedRowStyle = rowStyle ? rowStyle(row) : undefined;
                      // In variable-row-height mode we render every row
                      // and let the browser skip painting the ones off
                      // screen via content-visibility. The reserved
                      // ~33px keeps the scrollbar accurate before each
                      // row is laid out.
                      const variableRowStyle = variableRowHeight
                        ? { contentVisibility: 'auto', containIntrinsicSize: '0 33px' }
                        : undefined;
                      const rowTr = (
                        <tr
                          key={expandable ? `r:${rowKey}` : rowKey}
                          ref={ri === 0 ? firstRowRef : undefined}
                          className={rowClassName ? rowClassName(row) : undefined}
                          onClick={onRowClick ? () => onRowClick(row) : undefined}
                          style={{ ...(onRowClick ? { cursor: 'pointer' } : undefined), ...variableRowStyle, ...computedRowStyle }}
                        >
                          {visibleColumns.map(col => (
                            <td
                              key={col.key}
                              className={col.sticky ? styles.stickyCol : undefined}
                              // Pass the row style straight through when the
                              // column isn't pinned: this runs for every cell
                              // of every rendered row, and merging into a
                              // fresh object per cell is a cost the common
                              // case shouldn't pay.
                              style={col.sticky ? { ...computedRowStyle, ...stickyStyle(col) } : computedRowStyle}
                            >
                              {col.render ? col.render(row) : (row[col.key] ?? '-')}
                            </td>
                          ))}
                        </tr>
                      );
                      if (!expandable) return rowTr;
                      const isExpanded = expandedSet.has(row.id);
                      // Two adjacent <tr>s when expanded; React handles
                      // a returned array directly inside tbody.
                      return isExpanded
                        ? [
                            rowTr,
                            (
                              <tr key={`x:${rowKey}`}>
                                <td colSpan={visibleColumns.length} style={{ padding: 0, background: '#F8FAFC', borderTop: '1px solid #E2E8F0' }}>
                                  {renderExpansion(row)}
                                </td>
                              </tr>
                            ),
                          ]
                        : rowTr;
                    })}
                    {bottomPad > 0 && (
                      <tr aria-hidden="true" style={{ height: bottomPad }}>
                        <td colSpan={visibleColumns.length} style={{ padding: 0, border: 'none' }} />
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </>
    </div>
  );
}

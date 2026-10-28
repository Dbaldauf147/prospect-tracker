import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import styles from './DataTable.module.css';
import { ColumnToggle } from './ColumnToggle';
import {
  resolveHiddenKeys, isColumnVisible, resetToStarred, applyStar, pickLegacyBucket,
  orderColumns, mergeColumnOrder,
} from '../../utils/tableColumnPrefs';
import {
  tablePrefsKeys, persistTablePrefs, readRemoteTablePrefs, settingsHaveLoaded,
  loadColWidths as readColWidths, loadColNames as readColNames,
  loadColOrder as readColOrder, loadColRemoved as readColRemoved,
  loadColHidden as readColHidden, loadColStarred as readColStarred,
  loadColVisibleRaw as readColVisibleRaw,
  loadColChosen as readColChosen, saveColChosen as writeColChosen,
} from '../../utils/tablePrefsSync';
import {
  BLANKS_FILTER, suggestionMatches, readPickFilter, pickFilterIsActive, pickFilterMatches, pickListOptions,
} from '../../utils/columnFilter';

// The shared persistence (utils/tablePrefsSync) is keyed by explicit
// localStorage names so a table with its own established names can adopt it
// without stranding the layout its users already have. This component has
// always used the per-table-id defaults, so it just builds them.
const COL_VISIBLE_PREFIX = 'prospect-col-visible-';
const loadColWidths = (tableId) => readColWidths(tablePrefsKeys(tableId));
const loadColNames = (tableId) => readColNames(tablePrefsKeys(tableId));
const loadColOrder = (tableId) => readColOrder(tablePrefsKeys(tableId));
const loadColRemoved = (tableId) => readColRemoved(tablePrefsKeys(tableId));
const loadColHidden = (tableId) => readColHidden(tablePrefsKeys(tableId));
const loadColStarred = (tableId) => readColStarred(tablePrefsKeys(tableId));
const loadColVisibleRaw = (tableId) => readColVisibleRaw(tablePrefsKeys(tableId));
const loadColChosen = (tableId) => readColChosen(tablePrefsKeys(tableId));
const saveColChosen = (tableId, chosen) => writeColChosen(tablePrefsKeys(tableId), chosen);
import { resolveSortSignal } from '../../utils/tableSortSignal';
import { tableRowKey } from '../../utils/tableRowKey';
import { useColumnPresets } from '../../hooks/useColumnPresets';
import { applyPreset } from '../../utils/columnPresets';

// The saved key order applied (see utils/tableColumnPrefs), plus one rule
// of this table's own: a selection checkbox column always belongs at the
// far left, even when a stale saved order — from before that column
// existed — would push it to the tail. Non-mutating, so the caller's array
// is untouched.
function orderTableColumns(columns, order) {
  let out = orderColumns(columns, order);
  const selIdx = out.findIndex(c => c.key === '__select__');
  if (selIdx > 0) out = [out[selIdx], ...out.slice(0, selIdx), ...out.slice(selIdx + 1)];
  return out;
}

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

function writeFilterValue(picks, draft) {
  // Collapse to the simpler array form when there's no draft so the
  // shape stays clean for callers that haven't been updated.
  if (!draft) return picks;
  return { picks, draft };
}

// Spreadsheet-style per-column filter, the one under every DataTable header.
//
// The box is a search: typing narrows the rows live (substring) and narrows
// the list that drops down under it. The list is the column's values, each
// with a checkbox and how many rows hold it, drawn from the rows the OTHER
// columns' filters leave on screen, so it only offers what can actually be
// picked. Ticking values filters the column to exactly those (several at
// once, as an OR); once anything is ticked the search box only narrows the
// list. "Select all" ticks everything the search is showing, so "type warb,
// Enter" picks every Warburg spelling in one go. The matching rules are
// utils/columnFilter.js's pick-list ones, shared with PE Portfolio.
//
// The value it hands back is a bare array of ticks, or { picks, draft }
// while something is in the search box (readPickFilter reads both).

// Hard cap on the dropdown list so a column with thousands of unique
// values doesn't ship a 10k-row popover. Past this, the footer
// nudges the user to type to narrow.
const FILTER_DROPDOWN_CAP = 500;

const BLANKS_TOKEN = BLANKS_FILTER;
const isBlanksToken = (p) => String(p ?? '').trim().toLowerCase() === BLANKS_TOKEN.toLowerCase();

// Past this many ticks the box shows one "N selected" chip instead of a
// chip per value, so a narrow column doesn't grow a wall of chips.
const MAX_CHIPS = 2;

const CHECK_ROW_STYLE = {
  display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left',
  padding: '3px 8px', background: 'transparent', border: 'none', cursor: 'pointer',
  fontFamily: 'inherit', fontSize: '0.72rem', color: 'var(--color-text)',
};

// `options`, when given, is called only while the list is open and returns
// { suggestions, counts, blanks } (pickListOptions' shape) - DataTable uses
// it so the per-column value lists are only worked out for the column being
// filtered. Without it, `suggestions` / `hasBlanks` are used as they are.
export function ColumnFilterCell({ value, onChange, suggestions = [], hasBlanks = false, options, label }) {
  const { picks, draft: incomingDraft } = readPickFilter(value);
  // We mirror the parent-controlled draft so typing feels instant
  // even when the parent re-render is async (e.g. inside a useMemo
  // chain). Sync down whenever the parent changes the draft.
  const [draft, setDraft] = useState(incomingDraft);
  useEffect(() => { setDraft(incomingDraft); }, [incomingDraft]);
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState(null);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);
  const selectAllRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    function onDocMouseDown(e) {
      // Closes when the click lands outside both the filter cell and
      // the portal-rendered dropdown. Without checking the dropdown
      // too, the mousedown on a value would close the dropdown
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

  // The column's values, only worked out while the list is open.
  const source = useMemo(() => {
    if (!open) return null;
    if (typeof options === 'function') {
      const o = options() || {};
      return { values: o.suggestions || [], counts: o.counts || null, blanks: o.blanks || 0 };
    }
    return { values: suggestions, counts: null, blanks: hasBlanks ? 1 : 0 };
  }, [open, options, suggestions, hasBlanks]);

  const pickedKeys = useMemo(() => new Set(picks.map(p => p.toLowerCase())), [picks]);

  const { matches, totalAvailable } = useMemo(() => {
    if (!source) return { matches: [], totalAvailable: 0 };
    const q = draft.trim().toLowerCase();
    const all = [];
    // "(Blanks)" leads, only when the column has empty cells (or it is
    // already ticked, so it can be unticked).
    if (source.blanks > 0 || pickedKeys.has(BLANKS_TOKEN.toLowerCase())) all.push(BLANKS_TOKEN);
    const listed = new Set();
    for (const s of source.values) { all.push(s); listed.add(s.toLowerCase()); }
    // A tick whose value the other filters have since taken off screen
    // stays in the list so it can still be unticked.
    for (const p of picks) {
      if (!listed.has(p.toLowerCase()) && !isBlanksToken(p)) all.push(p);
    }
    const hits = q
      ? suggestionMatches(all.filter(s => !isBlanksToken(s)), q)
        .concat(all.some(isBlanksToken) && 'blanks'.includes(q.replace(/[()]/g, '')) ? [BLANKS_TOKEN] : [])
      : all;
    return { matches: hits.slice(0, FILTER_DROPDOWN_CAP), totalAvailable: hits.length };
  }, [source, draft, picks, pickedKeys]);

  const countOf = (s) => {
    if (!source?.counts) return null;
    if (isBlanksToken(s)) return source.blanks;
    return source.counts.get(s.toLowerCase()) || 0;
  };

  const matchedPicked = matches.filter(s => pickedKeys.has(s.toLowerCase())).length;
  const allMatchesPicked = matches.length > 0 && matchedPicked === matches.length;
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = matchedPicked > 0 && !allMatchesPicked;
  }, [matchedPicked, allMatchesPicked]);

  function pushDraft(next) {
    setDraft(next);
    onChange(writeFilterValue(picks, next));
  }
  function setPicks(next) {
    onChange(writeFilterValue(next, draft));
  }
  function togglePick(s) {
    if (pickedKeys.has(s.toLowerCase())) setPicks(picks.filter(p => p.toLowerCase() !== s.toLowerCase()));
    else setPicks([...picks, s]);
  }
  // Tick (or untick) everything the search is currently showing.
  function toggleAllMatches() {
    const shown = new Set(matches.map(s => s.toLowerCase()));
    if (allMatchesPicked) setPicks(picks.filter(p => !shown.has(p.toLowerCase())));
    else setPicks([...picks, ...matches.filter(s => !pickedKeys.has(s.toLowerCase()))]);
  }
  function clearAll() {
    setDraft('');
    onChange([]);
  }
  function onKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Enter on a search ticks everything it matches and clears the box,
      // ready for the next search.
      if (draft.trim() && matches.length > 0) {
        const add = matches.filter(s => !pickedKeys.has(s.toLowerCase()));
        setDraft('');
        onChange(writeFilterValue([...picks, ...add], ''));
      } else {
        setOpen(false);
      }
    } else if (e.key === 'Backspace' && !draft && picks.length > 0) {
      setPicks(picks.slice(0, -1));
    } else if (e.key === 'Escape') {
      setOpen(false);
      e.currentTarget.blur();
    } else if (e.key === 'ArrowDown') {
      openDropdown();
    }
  }

  // Portal-rendered dropdown: the sticky table header / horizontal
  // scroll container both clip absolutely-positioned children, so the
  // list disappeared under the table body. Fixed-positioning against
  // viewport coordinates side-steps that and lets the list be wider
  // than the (often narrow) filter column.
  const dropdownStyle = anchorRect ? (() => {
    const minWidth = Math.max(anchorRect.width, 240);
    const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - minWidth - 8));
    const spaceBelow = window.innerHeight - anchorRect.bottom;
    const flipAbove = spaceBelow < 200 && anchorRect.top > spaceBelow;
    return {
      position: 'fixed',
      top: flipAbove ? undefined : anchorRect.bottom + 1,
      bottom: flipAbove ? window.innerHeight - anchorRect.top + 1 : undefined,
      left,
      minWidth,
      maxWidth: Math.min(420, window.innerWidth - left - 8),
      maxHeight: flipAbove ? Math.min(340, anchorRect.top - 8) : Math.min(340, spaceBelow - 8),
      zIndex: 10000,
      background: '#fff',
      border: '1px solid var(--color-border)',
      borderRadius: 4,
      overflowY: 'auto',
      boxShadow: '0 8px 24px rgba(15, 23, 42, 0.18)',
      textAlign: 'left',
      textTransform: 'none',
      fontWeight: 400,
    };
  })() : null;

  const chipStyle = { display: 'inline-flex', alignItems: 'center', gap: 2, background: '#DBEAFE', border: '1px solid #93C5FD', color: '#1E3A8A', borderRadius: 999, padding: '0 4px 0 6px', fontSize: '0.62rem', fontWeight: 600, lineHeight: 1.5, maxWidth: '100%' };
  const chipX = { background: 'transparent', border: 'none', color: '#1E3A8A', cursor: 'pointer', padding: 0, lineHeight: 1, fontSize: '0.85rem' };
  const what = label ? `the ${label} filter` : 'this filter';

  return (
    <div ref={wrapRef} style={{ position: 'relative', textAlign: 'left', textTransform: 'none', fontWeight: 400 }}>
      <div
        onClick={() => { openDropdown(); inputRef.current?.focus(); }}
        style={{
          display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center',
          padding: '1px 3px',
          border: `1px solid ${picks.length || draft ? 'var(--color-accent)' : 'var(--color-border)'}`, borderRadius: 4,
          background: '#fff', minHeight: 22, cursor: 'text',
        }}
      >
        {picks.length > MAX_CHIPS ? (
          <span style={chipStyle} title={picks.join(', ')}>
            <span style={{ whiteSpace: 'nowrap' }}>{picks.length} selected</span>
            <button type="button" onClick={e => { e.stopPropagation(); setPicks([]); }} style={chipX} title={`Clear ${what}`} aria-label={`Clear ${what}`}>×</button>
          </span>
        ) : picks.map(p => (
          <span key={p} style={chipStyle} title={p}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>{p}</span>
            <button
              type="button"
              onClick={e => { e.stopPropagation(); togglePick(p); }}
              style={chipX}
              title="Remove filter"
              aria-label={`Remove ${p}`}
            >×</button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={e => { pushDraft(e.target.value); openDropdown(); }}
          onFocus={openDropdown}
          onKeyDown={onKeyDown}
          placeholder={picks.length === 0 ? 'Search…' : ''}
          aria-label={label ? `Search or pick ${label} values` : 'Search or pick values'}
          title="Type to search this column, or tick values in the list to filter by them"
          autoComplete="off"
          style={{ border: 'none', outline: 'none', flex: '1 0 50px', minWidth: 36, fontSize: '0.68rem', fontFamily: 'inherit', padding: '1px 2px', background: 'transparent' }}
        />
      </div>
      {open && dropdownStyle && createPortal(
        <div
          ref={dropdownRef}
          style={dropdownStyle}
          onMouseDown={e => e.preventDefault() /* keep input focused */}
          role="listbox"
          aria-multiselectable="true"
        >
          {matches.length === 0 ? (
            <div style={{ padding: '6px 10px', fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
              {draft.trim() ? 'No match: try another search.' : 'No values to filter by.'}
            </div>
          ) : (
            <>
              <div style={{ position: 'sticky', top: 0, zIndex: 1, display: 'flex', alignItems: 'center', background: '#F8FAFC', borderBottom: '1px solid var(--color-border-light)' }}>
                <label style={{ ...CHECK_ROW_STYLE, fontWeight: 600, flex: 1 }}>
                  <input ref={selectAllRef} type="checkbox" checked={allMatchesPicked} onChange={toggleAllMatches} style={{ margin: 0 }} />
                  {draft.trim() ? `Select all matching (${totalAvailable})` : `Select all (${totalAvailable})`}
                </label>
                {(picks.length > 0 || draft) && (
                  <button
                    type="button"
                    onClick={clearAll}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-accent)', fontSize: '0.68rem', fontFamily: 'inherit', padding: '3px 8px', whiteSpace: 'nowrap' }}
                    title={`Clear ${what}`}
                  >Clear</button>
                )}
              </div>
              {matches.map(s => {
                const on = pickedKeys.has(s.toLowerCase());
                const n = countOf(s);
                return (
                  <label
                    key={s}
                    role="option"
                    aria-selected={on}
                    style={CHECK_ROW_STYLE}
                    onMouseEnter={e => { e.currentTarget.style.background = '#F1F5F9'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                    title={s}
                  >
                    <input type="checkbox" checked={on} onChange={() => togglePick(s)} style={{ margin: 0, flex: '0 0 auto' }} />
                    <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontStyle: isBlanksToken(s) ? 'italic' : undefined }}>{s}</span>
                    {n != null && <span style={{ flex: '0 0 auto', color: 'var(--color-text-muted)', fontSize: '0.65rem' }}>{n}</span>}
                  </label>
                );
              })}
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

// Column layout persistence lives in utils/tablePrefsSync — local copy plus
// the Firestore one at settings.tablePrefs[tableId], so a layout follows the
// user to their other machine. This wrapper only supplies this component's
// localStorage key names.
function persistPrefs(tableId, settings, updateSettings, prefsUpdate) {
  persistTablePrefs(tablePrefsKeys(tableId), tableId, settings, updateSettings, prefsUpdate);
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
 *   defaultHidden - array of column keys the table ships switched off: in
 *                   the Columns menu, but not on screen until the user asks
 *                   for them. A default, not a rule — switching one on (or
 *                   off) is remembered from then on.
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
  // Imperative sort trigger: { key, direction, nonce, force }. Bumping
  // nonce re-applies the given sort through the same path as a header
  // click (incl. the freeze snapshot). Lets a parent re-rank on demand
  // without owning sort state. Ignored when an external sort is wired.
  // `force` lands the sort whatever column the user is on, and is only
  // for a signal they asked for by name - see resolveSortSignal.
  sortSignal,
  alwaysVisible = [],
  defaultHidden = [],
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
  // Every visible column gets a filter under its header (part of Dan's
  // column formatting, so on by default): type to search the column, or
  // tick values in its list to filter to exactly those. Pass false for a
  // table that shouldn't have the filter row.
  enableColumnFilters = true,
  // When true, the columns are scaled to fill the table's width exactly:
  // stretched when there is room to spare, squeezed when there isn't, so
  // the table never scrolls sideways. Widths keep their proportions, and a
  // dragged column keeps its share. Off by default, since most tables here
  // are wider than any screen on purpose.
  fitWidth = false,
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
  // Vertical lines between the columns as well as the row lines every
  // table has. Off by default: on a table of six columns the row lines
  // alone are enough and the verticals are clutter. On a wide one - a
  // contact roster seventeen columns across, read left to right across a
  // row of phone numbers and cities - they are what keeps a value under
  // its own heading.
  gridLines = false,
  // The toolbar's own Export Excel button. Off for a table whose page
  // already carries an export of its own, so the two don't sit a few
  // pixels apart offering the same file.
  showExport = true,
}) {
  const rawRemotePrefs = settings?.tablePrefs?.[tableId];
  const remotePrefs = useMemo(() => readRemoteTablePrefs(settings, tableId), [rawRemotePrefs]); // eslint-disable-line react-hooks/exhaustive-deps
  // settings._lastWriteAt is the canonical "Firestore subscription has
  // produced data" signal — it's stamped by every saveUserSettings call.
  // We use it to distinguish "Firestore has no entry for this table"
  // (don't sync, leave defaults / localStorage) from "Firestore is
  // still loading" (don't do anything; wait).
  const settingsLoaded = settingsHaveLoaded(settings);
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
  // Which of the table's switched-off columns this user has decided about.
  // Until a key is in here the table's default wins; after, the hidden list
  // does. See loadColChosen for why it stays on the machine.
  const [chosenCols, setChosenCols] = useState(() => loadColChosen(tableId));
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
  //
  // An always-visible column is never dropped, even when its key sits in
  // the saved removed list: a key can outlive the column it was deleted
  // under (the Utility Lookup's old "Lookup City" and its always-on City
  // share 'city'), and a stale deletion must not hide a column the table
  // says can't be hidden. Keyed on the joined string so the default []
  // doesn't recompute every render.
  const alwaysVisibleKey = alwaysVisible.join('\u0000');
  const isRemoved = useCallback(
    (key) => removedCols.has(key) && !alwaysVisible.includes(key),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [removedCols, alwaysVisibleKey],
  );
  const presentColumns = useMemo(
    () => (removedCols.size === 0 ? columns : columns.filter(c => !isRemoved(c.key))),
    [columns, removedCols, isRemoved],
  );
  // The deleted ones, for the picker's restore list. Dropped from
  // presentColumns above, so the picker needs them handed over separately.
  const removedColumnList = useMemo(
    () => (removedCols.size === 0 ? [] : columns.filter(c => isRemoved(c.key))),
    [columns, removedCols, isRemoved],
  );

  // The columns in the user's saved order (defaults to prop order). All
  // rendering — header, body, visibility list, export — runs off this.
  const orderedColumns = useMemo(() => orderTableColumns(presentColumns, colOrder), [presentColumns, colOrder]);

  // The hidden set, resolved from whichever of the two stored shapes this
  // table has (see utils/tableColumnPrefs), and the visible set the rest of
  // the table — header, body, export, the picker's checkboxes — reads.
  const hiddenColsSet = useMemo(
    () => resolveHiddenKeys({
      hidden: hiddenPref,
      legacyVisible,
      columnKeys: orderedColumns.map(c => c.key),
      defaultHidden,
      chosen: chosenCols,
    }),
    [hiddenPref, legacyVisible, orderedColumns, defaultHidden, chosenCols],
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
    const legacyRemote = readRemoteTablePrefs(settings, legacyId);
    const widths = legacyRemote?.widths || loadColWidths(legacyId);
    const names = legacyRemote?.names || loadColNames(legacyId);
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
    // The picker only lists the columns it shows, so the keys it hands back
    // leave out anything deleted. Merge rather than replace, or a restored
    // column would come back at the far right instead of where it sat.
    const merged = mergeColumnOrder(colOrder, nextKeys);
    setColOrder(merged);
    persistPrefs(tableId, settings, updateSettings, { order: merged });
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
    // Reset means the table as it ships, which includes the columns it
    // ships switched off — so the decisions made about those are dropped
    // too, rather than surviving a reset of everything around them.
    if (chosenCols.size > 0) {
      setChosenCols(new Set());
      saveColChosen(tableId, new Set());
    }
    setHiddenPref([...hidden]);
    setLegacyVisible(null);
    setRemovedCols(removed);
    setColOrder([]);
    persistPrefs(tableId, settings, updateSettings, { hidden, removed, order: [] });
  }

  // Saved column views. Applying one shows exactly its columns in its
  // order; it doesn't touch stars, widths or anything deleted.
  const columnPresets = useColumnPresets({ tableId, settings, updateSettings });
  function applyColumnPreset(preset) {
    const { hidden, order } = applyPreset(preset, {
      columnKeys: orderedColumns.map(c => c.key),
      alwaysVisible,
    });
    // A column the preset shows that the user hadn't decided about yet is
    // now decided, or a defaultHidden one would stay switched off.
    const shown = defaultHidden.filter(k => !hidden.includes(k) && !chosenCols.has(k));
    if (shown.length) {
      const chosen = new Set(chosenCols);
      shown.forEach(k => chosen.add(k));
      setChosenCols(chosen);
      saveColChosen(tableId, chosen);
    }
    if (order) {
      const merged = mergeColumnOrder(colOrder, order);
      setColOrder(merged);
      commitHidden(new Set(hidden), { order: merged });
    } else {
      commitHidden(new Set(hidden));
    }
  }
  function saveColumnPreset(name) {
    columnPresets.save({
      name,
      cols: orderedColumns.filter(c => visibleCols.has(c.key)).map(c => c.key),
      order: orderedColumns.map(c => c.key),
    });
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
      // Snapshot every row, not just the ones passing the column filters.
      // The filters are applied on top of this order anyway, and a
      // snapshot taken through a filter has no place for the rows it
      // hid - they all tie on the fallback index and pile up at the
      // bottom the moment the filter comes off.
      const sorted = [...rows].sort((a, b) => {
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
  //
  // `resolveSortSignal` decides whether the signal applies at all — it is
  // a correction to an ordering already on screen, so a user sorted by
  // some other column is left alone. See that helper for the full rule.
  const lastSortNonce = useRef(sortSignal?.nonce);
  useEffect(() => {
    if (externalSort || externalSortConfig) return;
    const nonce = sortSignal?.nonce;
    if (nonce == null || nonce === lastSortNonce.current) return;
    lastSortNonce.current = nonce;
    const next = resolveSortSignal(internalSort, sortSignal);
    if (next) applySort(next.key, next.direction);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortSignal?.nonce]);

  // Sort rows internally if no external sort.
  // Apply per-column filters on top of the externally-filtered rows prop.
  // Each colFilters[key] is what ColumnFilterCell hands back (ticked
  // values, plus whatever is in its search box), matched by the shared
  // pick-list rules in utils/columnFilter. Columns that supply
  // getFilterValue use that instead of row[key] so derived/custom-render
  // columns can still filter on what the user actually sees.
  const colByKey = useMemo(() => {
    const m = new Map();
    for (const c of columns) m.set(c.key, c);
    return m;
  }, [columns]);
  const filterValueOf = useCallback((row, key) => {
    const getter = colByKey.get(key)?.getFilterValue;
    return getter ? getter(row) : row[key];
  }, [colByKey]);
  const activeColFilters = useMemo(
    () => Object.entries(colFilters).filter(([, raw]) => pickFilterIsActive(raw)),
    [colFilters],
  );
  // Rows passing every column filter except `skipKey`'s: what that
  // column's pick list offers, so it only shows values that are on screen.
  const rowsPassing = useCallback((skipKey) => {
    const active = skipKey == null ? activeColFilters : activeColFilters.filter(([k]) => k !== skipKey);
    if (active.length === 0) return rows;
    return rows.filter(row => active.every(([key, raw]) => pickFilterMatches(filterValueOf(row, key), raw)));
  }, [rows, activeColFilters, filterValueOf]);
  const filteredRows = useMemo(() => rowsPassing(null), [rowsPassing]);

  // Notify the consumer whenever the filtered-row set changes so it can
  // sync its own "select all visible" state against what's actually on
  // screen. Skipped when the prop isn't provided.
  useEffect(() => {
    if (onFilteredRowsChange) onFilteredRowsChange(filteredRows);
  }, [filteredRows, onFilteredRowsChange]);

  // Each column's pick list: its values with counts, from the rows the
  // other columns' filters leave. Worked out only when that column's list
  // is opened (ColumnFilterCell calls it), and cached until rows or
  // filters change.
  const filterOptions = useMemo(() => {
    const cache = new Map();
    return (key) => {
      if (!cache.has(key)) cache.set(key, pickListOptions(rowsPassing(key).map(row => filterValueOf(row, key))));
      return cache.get(key);
    };
  }, [rowsPassing, filterValueOf]);

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

  // The width fitWidth scales to: the header strip's width less however
  // wide the body's vertical scrollbar is, re-read whenever the table is
  // resized.
  const [fitSpace, setFitSpace] = useState(0);
  useEffect(() => {
    if (!fitWidth) return undefined;
    const el = headerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      const body = bodyRef.current;
      const scrollbar = body ? Math.max(0, body.offsetWidth - body.clientWidth) : 0;
      const next = Math.max(0, el.clientWidth - scrollbar);
      setFitSpace(prev => (Math.abs(prev - next) > 1 ? next : prev));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (bodyRef.current) ro.observe(bodyRef.current);
    return () => ro.disconnect();
  }, [fitWidth, rows.length]);
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

  // ...and the other way round, which only one thing does: clicking into a
  // column filter far off to the right. The browser scrolls the focused
  // input into view, and the input lives in the header strip - so the
  // header pans and the rows underneath do not, leaving every value sitting
  // under somebody else's heading until the next body scroll puts them
  // back. Guarded against the loop the pair would otherwise make: each side
  // only writes the other when it is actually out of step.
  function handleHeaderScroll(e) {
    const body = bodyRef.current;
    if (body && body.scrollLeft !== e.target.scrollLeft) body.scrollLeft = e.target.scrollLeft;
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

  const rawWidth = (col) => colWidths[col.key] || col.defaultWidth || 120;
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

  // fitWidth: one factor for every column, so the sum lands on the space
  // the table has (less the body's vertical scrollbar). Floored, so the
  // rounding can only leave a pixel or two spare, never force a scroll.
  const rawTotal = visibleColumns.reduce((sum, c) => sum + rawWidth(c), 0);
  const fitScale = fitWidth && fitSpace > 0 && rawTotal > 0 ? fitSpace / rawTotal : 1;
  const getWidth = fitScale === 1
    ? rawWidth
    : (col) => Math.max(40, Math.floor(rawWidth(col) * fitScale));

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
    // Ticking one of the table's switched-off columns is the user deciding
    // about it: from here on their own list says whether it shows, so
    // turning it on sticks rather than being overruled on the next load.
    if (defaultHidden.includes(key) && !chosenCols.has(key)) {
      const chosen = new Set(chosenCols).add(key);
      setChosenCols(chosen);
      saveColChosen(tableId, chosen);
    }
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
    <div className={gridLines ? `${styles.outerWrap} ${styles.gridLines}` : styles.outerWrap}>
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
          presets={{
            list: columnPresets.list,
            onApply: applyColumnPreset,
            onSave: saveColumnPreset,
            onDelete: columnPresets.remove,
          }}
        />
        <button className={styles.resetBtn} onClick={() => { setColWidths({}); persistPrefs(tableId, settings, updateSettings, { widths: {} }); }}>
          Reset widths
        </button>
        {showExport && (
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
        )}
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
          the rows - users need to see which columns exist (and clear
          their filter) instead of staring at a blank panel. */}
      <>
        <div className={styles.headerWrap} ref={headerRef} onScroll={handleHeaderScroll}>
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
                              options={() => filterOptions(col.key)}
                              label={typeof col.label === 'string' ? col.label : undefined}
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
                      const rowKey = tableRowKey(row, absoluteIdx);
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
